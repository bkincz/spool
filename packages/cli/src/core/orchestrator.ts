/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import pc from 'picocolors'
import type { Workspace } from './workspace.js'
import { HELPER_FILE, type AppConfig } from './config.js'
import { existsSync, readFileSync } from 'node:fs'
import { run, runShell, spawnProcess, killTree } from '../util/exec.js'
import { waitForManifest } from '../util/net.js'
import { CliError } from '../util/errors.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
const COLORS = [pc.cyan, pc.magenta, pc.green, pc.yellow, pc.blue, pc.red]

interface NamedApp {
	name: string
	app: AppConfig
}

/*
 *   SELECTION
 ***************************************************************************************************/
function selectApps(ws: Workspace, only?: string[]): NamedApp[] {
	const all = Object.entries(ws.manifest.apps).map(([name, app]) => ({ name, app }))
	if (!only?.length) return all

	const known = new Set(all.map(a => a.name))
	const unknown = only.filter(name => !known.has(name))
	if (unknown.length) {
		throw new CliError(
			`Unknown app(s) in --only: ${unknown.join(', ')}. Check the names in spool.json.`
		)
	}
	return all.filter(a => only.includes(a.name))
}

/**
 * A host started without its remotes fails at runtime when it imports them.
 * Warn up front instead of leaving it to the browser console.
 */
function warnExcludedRemotes(selected: NamedApp[]): void {
	const names = new Set(selected.map(a => a.name))
	for (const { name, app } of hostsOf(selected)) {
		const missing = app.remotes.filter(r => !names.has(r))
		if (missing.length) {
			log.warn(
				`${name} expects remote(s) ${missing.join(', ')} that are not selected. Start them separately or the host will fail to load them.`
			)
		}
	}
}

const remotesOf = (apps: NamedApp[]): NamedApp[] => apps.filter(a => a.app.type === 'remote')
const hostsOf = (apps: NamedApp[]): NamedApp[] => apps.filter(a => a.app.type === 'host')

/*
 *   DEV OUTPUT
 ***************************************************************************************************/
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;?]*[a-zA-Z]/g

interface AppStatus {
	name: string
	app: AppConfig
	color: (s: string) => string
	buffer: { line: string; err: boolean }[]
	/** Trailing partial line of the last chunk; a banner split mid-line must still match. */
	tail: string
	dropped: number
	ready: boolean
	viteVersion?: string
	readyMs?: string
	url?: string
}

/** Startup chatter is capped per app; a crash or slow start flushes what is kept. */
const BUFFER_CAP = 400

/** dev runs each app's dev server; preview serves the built dist folders. */
export type ServeMode = 'dev' | 'preview'

/**
 * Buffers each app's startup output, prints one summary panel once every
 * server is ready, then streams logs with prefixes. A clean start drops the
 * buffered noise on purpose; a crash or slow start flushes it, so failures
 * are never hidden.
 */
class DevOutput {
	private readonly statuses = new Map<string, AppStatus>()
	private streaming = false
	private readonly timer: NodeJS.Timeout
	private pending: NodeJS.Timeout | undefined
	private anchored = false
	private panel: string[] = []
	private readonly onResize = (): void => {
		if (this.anchored) this.paint()
	}

	constructor(
		private readonly total: number,
		private readonly mode: ServeMode
	) {
		this.timer = setTimeout(() => {
			log.warn('The servers have not reported ready yet. Streaming their logs.')
			this.startStreaming()
		}, 15_000)
	}

	track(name: string, app: AppConfig, color: (s: string) => string): AppStatus {
		const status: AppStatus = {
			name,
			app,
			color,
			buffer: [],
			tail: '',
			dropped: 0,
			ready: false,
		}
		this.statuses.set(name, status)
		return status
	}

	chunk(status: AppStatus, data: Buffer, err: boolean): void {
		if (this.streaming) {
			for (const line of data.toString().split('\n')) {
				if (line.trim()) this.write(status, line, err)
			}
			return
		}

		const lines = (status.tail + data.toString()).split('\n')
		status.tail = lines.pop() ?? ''
		for (const line of lines) {
			if (line.trim()) this.line(status, line, err)
		}
		this.maybeSummarize()
	}

	private line(status: AppStatus, line: string, err: boolean): void {
		if (status.buffer.length >= BUFFER_CAP) {
			status.buffer.shift()
			status.dropped++
		}
		status.buffer.push({ line, err })

		const plain = line.replace(ANSI, '')
		const ready = plain.match(/VITE v([\d.]+)\s+ready in (\d+) ?ms/i)
		if (ready) {
			status.viteVersion = ready[1]!
			status.readyMs = ready[2]!
		}
		const local = plain.match(/Local:\s+(http\S+)/)
		if (local) status.url = local[1]!

		// vite preview prints no version banner, so the url alone marks ready.
		const versionSeen = this.mode === 'preview' || status.viteVersion !== undefined
		if (versionSeen && status.url !== undefined) status.ready = true
	}

	/**
	 * Crash path: the buffered output across ALL apps is the only clue to why
	 * (a sibling may show the port the crasher collided with), so dump
	 * everything, the crashing app last where it is easiest to see.
	 */
	flushAll(lastName: string): void {
		if (this.streaming) return
		const ordered = [...this.statuses.values()].sort((a, b) =>
			a.name === lastName ? 1 : b.name === lastName ? -1 : 0
		)
		for (const status of ordered) this.drain(status)
	}

	private drain(status: AppStatus): void {
		if (status.dropped) {
			this.write(status, pc.dim(`(${status.dropped} earlier line(s) truncated)`), false)
		}
		for (const { line, err } of status.buffer) this.write(status, line, err)
		if (status.tail.trim()) this.write(status, status.tail, false)
		status.buffer = []
		status.tail = ''
		status.dropped = 0
	}

	dispose(): void {
		clearTimeout(this.timer)
		clearTimeout(this.pending)
		if (this.anchored) {
			const rows = process.stdout.rows ?? 0
			this.unanchor()
			// Park the cursor at the bottom so the shell prompt lands cleanly.
			process.stdout.write(`${rows ? `\x1b[${rows};1H` : ''}\n`)
		}
	}

	private unanchor(): void {
		if (!this.anchored) return
		this.anchored = false
		process.stdout.off('resize', this.onResize)
		process.stdout.write('\x1b[r')
	}

	private write(status: AppStatus, line: string, err: boolean): void {
		const stream = err ? process.stderr : process.stdout
		stream.write(`${status.color(`[${status.name}]`)} ${line}\n`)
	}

	private maybeSummarize(): void {
		if (this.streaming || this.pending || this.statuses.size < this.total) return
		if (![...this.statuses.values()].every(status => status.ready)) return

		// A short grace window catches the tail of vite's banner (the Network
		// line often lands in its own chunk right after Local).
		this.pending = setTimeout(() => {
			if (this.streaming) return
			clearTimeout(this.timer)
			this.printSummary()
			this.streaming = true
			for (const status of this.statuses.values()) {
				status.buffer = []
				status.tail = ''
			}
		}, 200)
	}

	private startStreaming(): void {
		if (this.streaming) return
		clearTimeout(this.timer)
		for (const status of this.statuses.values()) this.drain(status)
		this.streaming = true
	}

	private printSummary(): void {
		const ordered = [...this.statuses.values()].sort((a, b) =>
			a.app.type === b.app.type ? 0 : a.app.type === 'host' ? -1 : 1
		)

		// One vite version across apps moves to the footer; a mix stays per row.
		const versions = new Set(ordered.map(status => status.viteVersion))
		const sharedVite = versions.size === 1 ? [...versions][0] : undefined

		const cells = ordered.map(status => ({
			status,
			name: status.name,
			role: `${status.app.type} · ${status.app.framework}`,
			url: status.url ?? `http://localhost:${status.app.port}/`,
			meta: [
				sharedVite === undefined && status.viteVersion !== undefined
					? `vite ${status.viteVersion}`
					: undefined,
				status.readyMs === undefined
					? undefined
					: `${(Number(status.readyMs) / 1000).toFixed(1)}s`,
			]
				.filter(Boolean)
				.join(' · '),
		}))
		const width = {
			name: Math.max(...cells.map(cell => cell.name.length)),
			role: Math.max(...cells.map(cell => cell.role.length)),
			url: Math.max(...cells.map(cell => cell.url.length)),
			meta: Math.max(...cells.map(cell => cell.meta.length)),
		}

		// The plain row sets the box width; the colored row mirrors it exactly.
		type Cell = (typeof cells)[number]
		const segments = (cell: Cell): string[] => [
			`  ● ${cell.name.padEnd(width.name)}`,
			`  ${cell.role.padEnd(width.role)}`,
			`  ${cell.url.padEnd(width.url)}`,
			`  ${cell.meta.padEnd(width.meta)}  `,
		]
		const inner = segments(cells[0]!).join('').length
		const colored = (cell: Cell): string => {
			const [name, role, url, meta] = segments(cell)
			return `${cell.status.color(name!)}${pc.dim(role!)}${pc.cyan(url!)}${pc.dim(meta!)}`
		}

		const title = this.mode === 'dev' ? ' dev servers ready ' : ' preview servers ready '
		const fill = Math.max(inner - title.length - 1, 0)
		const footer = [
			sharedVite === undefined ? undefined : `vite ${sharedVite}`,
			this.mode === 'dev' ? 'watching for changes' : 'serving production builds',
			'press ctrl+c to stop',
		]
			.filter(Boolean)
			.join(' · ')

		this.panel = [
			`  ${pc.dim('╭─')}${pc.bold(title)}${pc.dim(`${'─'.repeat(fill)}╮`)}`,
			...cells.map(cell => `  ${pc.dim('│')}${colored(cell)}${pc.dim('│')}`),
			`  ${pc.dim(`╰${'─'.repeat(inner)}╯`)}`,
			`  ${pc.dim(footer)}`,
		]

		const fits =
			process.stdout.isTTY &&
			(process.stdout.columns ?? 0) >= inner + 4 &&
			(process.stdout.rows ?? 0) > this.panel.length + 4
		if (fits) {
			this.anchored = true
			process.stdout.on('resize', this.onResize)
			this.paint(true)
			return
		}
		log.plain('')
		for (const line of this.panel) log.plain(line)
		log.plain('')
	}

	/** Draws the panel at the top and confines scrolling to the rows below it. */
	private paint(initial = false): void {
		const rows = process.stdout.rows ?? 0
		const top = this.panel.length + 2
		if (!rows || rows <= top + 2) {
			this.unanchor()
			return
		}
		if (initial) {
			process.stdout.write(
				`\x1b[2J\x1b[H\n${this.panel.join('\n')}\n\x1b[${top};${rows}r\x1b[${top};1H`
			)
			return
		}

		const lines = this.panel.map(line => `${line}\x1b[K`).join('\n')
		process.stdout.write(`\x1b[r\x1b[H\n${lines}\n\x1b[${top};${rows}r\x1b[${rows};1H`)
	}
}

/*
 *   DEV / PREVIEW
 ***************************************************************************************************/
export function devAll(ws: Workspace, only?: string[]): Promise<void> {
	return serveAll(ws, 'dev', only)
}

export function previewAll(ws: Workspace, only?: string[]): Promise<void> {
	return serveAll(ws, 'preview', only)
}

async function serveAll(ws: Workspace, mode: ServeMode, only?: string[]): Promise<void> {
	const apps = selectApps(ws, only)
	if (!apps.length) {
		log.warn('No apps to run.')
		return
	}

	warnExcludedRemotes(apps)
	if (mode === 'preview') {
		requireDists(ws, apps)
		warnStalePreview(ws)
		warnDeployedUrls(apps)
	}

	const remotes = remotesOf(apps)
	const hosts = hostsOf(apps)
	const children: ChildProcess[] = []
	const output = new DevOutput(apps.length, mode)
	let shuttingDown = false

	let reportCrash!: (err: Error) => void
	const crashed = new Promise<never>((_, reject) => {
		reportCrash = reject
	})

	const stopAll = (): void => {
		if (shuttingDown) return
		shuttingDown = true
		output.dispose()
		for (const child of children) {
			killTree(child)

			child.stdout?.destroy()
			child.stderr?.destroy()
		}
	}
	const onSignal = (): void => {
		stopAll()
		process.exit(0)
	}
	process.on('SIGINT', onSignal)
	process.on('SIGTERM', onSignal)

	const start = (named: NamedApp, colorIndex: number): void => {
		const child = spawnApp(ws, named, COLORS[colorIndex % COLORS.length]!, output, mode)
		child.on('exit', code => {
			if (shuttingDown || code === 0 || code === null) return

			setImmediate(() => {
				if (shuttingDown) return
				// The buffered startup output is the only clue to why it died.
				output.flushAll(named.name)
				stopAll()
				reportCrash(
					new CliError(
						`${named.name} stopped unexpectedly (exit ${code}). Shutting down the others.`
					)
				)
			})
		})
		children.push(child)
	}

	log.step(`starting ${apps.length} app(s), remotes first`)

	remotes.forEach((remote, i) => start(remote, i))
	await Promise.race([Promise.all(remotes.map(waitForRemote)), crashed])
	hosts.forEach((host, i) => start(host, remotes.length + i))

	await crashed
}

/** Preview serves dist folders; failing up front beats vite's per-app error. */
function requireDists(ws: Workspace, apps: NamedApp[]): void {
	const missing = apps.filter(({ app }) => !existsSync(join(ws.root, app.path, 'dist')))
	if (missing.length) {
		throw new CliError(
			`No dist folder for ${missing.map(a => a.name).join(', ')}. Run \`spool build\` first.`
		)
	}
}

/** Workspaces keep their scaffolded spool.vite.ts until `spool upgrade` regenerates it. */
function helperLacks(ws: Workspace, token: string): boolean {
	const helper = join(ws.root, HELPER_FILE)
	return existsSync(helper) && !readFileSync(helper, 'utf8').includes(token)
}

/** Old helpers serve preview without CORS headers, and _headers files are inert here. */
function warnStalePreview(ws: Workspace): void {
	if (helperLacks(ws, 'cors: true')) {
		log.warn(
			`This workspace's ${HELPER_FILE} predates preview CORS support, so browsers may block hosts fetching remotes cross-origin. Run \`spool upgrade\`.`
		)
	}
}

/** Host dists bake remote urls at build time; preview cannot rewire them. */
function warnDeployedUrls(apps: NamedApp[]): void {
	if (!hostsOf(apps).length) return
	const deployed = remotesOf(apps).filter(
		({ app }) => app.url !== undefined || app.urls !== undefined
	)
	if (!deployed.length) return
	log.warn(
		`${deployed.map(a => a.name).join(', ')} carry a deployed url in spool.json, so hosts built with \`spool build\` load the deployed manifests instead of these local servers. Rebuild with SPOOL_REMOTE_<NAME>=http://localhost:<port>/mf-manifest.json to preview the local artifacts.`
	)
}

async function waitForRemote({ name, app }: NamedApp): Promise<void> {
	const url = `http://localhost:${app.port}/mf-manifest.json`
	try {
		await waitForManifest(url)
	} catch {
		log.warn(
			`${name} is not serving its federation manifest on port ${app.port} yet. Hosts may need one reload.`
		)
	}
}

function spawnApp(
	ws: Workspace,
	{ name, app }: NamedApp,
	color: (s: string) => string,
	output: DevOutput,
	mode: ServeMode
): ChildProcess {
	const child = spawnProcess(ws.manifest.packageManager, ['run', mode], {
		cwd: join(ws.root, app.path),
	})

	const status = output.track(name, app, color)
	child.stdout?.on('data', (d: Buffer) => output.chunk(status, d, false))
	child.stderr?.on('data', (d: Buffer) => output.chunk(status, d, true))
	return child
}

/*
 *   BUILD
 ***************************************************************************************************/
export async function buildAll(ws: Workspace, only?: string[], env?: string): Promise<void> {
	const apps = selectApps(ws, only)
	const ordered = [...remotesOf(apps), ...hostsOf(apps)]
	if (env !== undefined) requireEnvSupport(ws, apps, env)
	// SPOOL_ENV picks each remote's `urls` entry inside spool.vite.ts.
	const spawnEnv = env === undefined ? {} : { env: { ...process.env, SPOOL_ENV: env } }

	for (const { name, app } of ordered) {
		log.step(`building ${pc.bold(name)} (${app.type})${env ? pc.dim(` for ${env}`) : ''}`)
		try {
			await run(ws.manifest.packageManager, ['run', 'build'], {
				cwd: join(ws.root, app.path),
				...spawnEnv,
			})
		} catch {
			throw new CliError(
				`Build failed for "${name}". Run \`${filterBuildCommand(ws.manifest.packageManager, name)}\` to see the full output.`
			)
		}
	}
	log.success(`built ${ordered.length} app(s)`)
}

/** --env resolves inside the generated helper, so an old helper would silently ignore it. */
function requireEnvSupport(ws: Workspace, apps: NamedApp[], env: string): void {
	if (helperLacks(ws, 'SPOOL_ENV')) {
		throw new CliError(
			`This workspace's ${HELPER_FILE} predates environments, so --env would be silently ignored. Run \`spool upgrade\` first.`
		)
	}
	if (!remotesOf(apps).some(({ app }) => app.urls?.[env])) {
		log.warn(
			`No selected remote has a "urls.${env}" entry in spool.json, so every remote falls back to its "url" or localhost.`
		)
	}
}

/*
 *   DEPLOY
 ***************************************************************************************************/
export async function deployAll(ws: Workspace, only?: string[], env?: string): Promise<void> {
	const apps = selectApps(ws, only)
	const ordered = [...remotesOf(apps), ...hostsOf(apps)]
	const deployable = ordered.filter(a => a.app.deploy)
	// Deploy commands are the user's own; SPOOL_ENV lets them branch per env.
	const spawnEnv = env === undefined ? {} : { env: { ...process.env, SPOOL_ENV: env } }

	for (const { name } of ordered.filter(a => !a.app.deploy)) {
		log.warn(`${name} has no "deploy" command in spool.json; skipping it.`)
	}
	if (!deployable.length) {
		throw new CliError(
			'Nothing to deploy. Give each app a "deploy" command in spool.json, e.g. "wrangler pages deploy dist".'
		)
	}

	for (const { name, app } of deployable) {
		const dir = join(ws.root, app.path)
		if (!existsSync(join(dir, 'dist'))) {
			log.warn(
				`${name} has no dist folder. Run \`spool build\` first if its deploy expects one.`
			)
		}
		log.step(`deploying ${pc.bold(name)} (${app.type})${env ? pc.dim(` for ${env}`) : ''}`)
		try {
			await runShell(app.deploy!, { cwd: dir, ...spawnEnv })
		} catch {
			throw new CliError(`Deploy failed for "${name}". Its command: ${app.deploy}`)
		}
		if (app.type === 'remote' && !app.url) {
			log.warn(
				`${name} has no "url" in spool.json, so host production builds still point at localhost. Set it to the deployed mf-manifest.json.`
			)
		}
	}
	log.success(`deployed ${deployable.length} app(s)`)
}

function filterBuildCommand(pm: Workspace['manifest']['packageManager'], name: string): string {
	switch (pm) {
		case 'npm':
			return `npm run build -w ${name}`
		case 'yarn':
			return `yarn workspace ${name} build`
		default:
			return `pnpm --filter ${name} build`
	}
}
