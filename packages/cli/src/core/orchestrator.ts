/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import pc from 'picocolors'
import type { Workspace } from './workspace.js'
import { HELPER_FILE, type AppConfig } from './config.js'
import { checkBuiltSingletons, describeShipped } from './federation.js'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { runCaptured, runShell, spawnProcess, killTree } from '../util/exec.js'
import { waitForManifest } from '../util/net.js'
import { CliError } from '../util/errors.js'
import { log } from '../util/logger.js'
import { COLORS, DevOutput, type ServeMode, type TrackMeta } from './output.js'

/*
 *   TYPES
 ***************************************************************************************************/

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
	const ladle = mode === 'dev' && !only?.length ? detectLadle(ws) : undefined
	const session = new ServeSession(ws, mode, new DevOutput(apps.length + (ladle ? 1 : 0), mode))

	session.trapSignals()
	log.step(`starting ${apps.length} app(s), remotes first`)

	remotes.forEach((remote, i) => session.start(remote, i))
	if (ladle) session.startLadle(ladle, apps.length)

	await Promise.race([Promise.all(remotes.map(waitForRemote)), session.crashed])
	hosts.forEach((host, i) => session.start(host, remotes.length + i))

	await session.crashed
}

class ServeSession {
	private readonly children: ChildProcess[] = []
	private shuttingDown = false
	private reportCrash!: (err: Error) => void

	readonly crashed: Promise<never>

	constructor(
		private readonly ws: Workspace,
		private readonly mode: ServeMode,
		private readonly output: DevOutput
	) {
		this.crashed = new Promise<never>((_, reject) => {
			this.reportCrash = reject
		})
	}

	trapSignals(): void {
		const onSignal = (): void => {
			this.stopAll()
			process.exit(0)
		}

		process.on('SIGINT', onSignal)
		process.on('SIGTERM', onSignal)
	}

	stopAll(): void {
		if (this.shuttingDown) return

		this.shuttingDown = true
		this.output.dispose()

		for (const child of this.children) {
			killTree(child)

			child.stdout?.destroy()
			child.stderr?.destroy()
		}
	}

	start(named: NamedApp, colorIndex: number): void {
		const child = spawnApp(
			this.ws,
			named,
			COLORS[colorIndex % COLORS.length]!,
			this.output,
			this.mode
		)

		child.on('exit', code => {
			if (this.shuttingDown || code === 0 || code === null) return

			setImmediate(() => {
				if (this.shuttingDown) return
				// The buffered startup output is the only clue to why it died.
				this.output.flushAll(named.name)
				this.stopAll()
				this.reportCrash(
					new CliError(
						`${named.name} stopped unexpectedly (exit ${code}). Shutting down the others.`
					)
				)
			})
		})

		this.children.push(child)
	}

	startLadle(info: LadleProcess, colorIndex: number): void {
		const child = spawnProcess(this.ws.manifest.packageManager, ['run', info.script], {
			cwd: join(this.ws.root, info.dir),
		})
		const status = this.output.track(
			info.name,
			{ role: 'component workshop', port: info.port, order: 2, readyOnUrl: true },
			COLORS[colorIndex % COLORS.length]!
		)

		child.stdout?.on('data', (d: Buffer) => this.output.chunk(status, d, false))
		child.stderr?.on('data', (d: Buffer) => this.output.chunk(status, d, true))
		child.on('exit', code => {
			if (this.shuttingDown || code === 0 || code === null) return

			// Ladle is auxiliary -- a failed workshop must not take the app servers down.
			setImmediate(() => {
				if (this.shuttingDown) return
				this.output.drop(info.name)
				log.warn(`ladle stopped (exit ${code}). The app servers are still running.`)
			})
		})

		this.children.push(child)
	}
}

/*
 *   LADLE
 ***************************************************************************************************/
const LADLE_PORT = 61000

interface LadleProcess {
	name: string
	dir: string
	script: string
	port: number
}

function detectLadle(ws: Workspace): LadleProcess | undefined {
	const dir = 'packages/ui'
	const pkgPath = join(ws.root, dir, 'package.json')
	if (!existsSync(pkgPath)) return undefined
	try {
		const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
			scripts?: Record<string, string>
		}
		if (!pkg.scripts?.ladle) return undefined
	} catch {
		return undefined
	}
	return { name: 'ladle', dir, script: 'ladle', port: LADLE_PORT }
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

	const meta: TrackMeta = {
		role: `${app.type} · ${app.framework}`,
		port: app.port,
		order: app.type === 'host' ? 0 : 1,
	}
	const status = output.track(name, meta, color)
	child.stdout?.on('data', (d: Buffer) => output.chunk(status, d, false))
	child.stderr?.on('data', (d: Buffer) => output.chunk(status, d, true))
	return child
}

/*
 *   BUILD
 ***************************************************************************************************/
function defaultConcurrency(): number {
	return Math.max(1, availableParallelism() - 1)
}

export async function buildAll(
	ws: Workspace,
	only?: string[],
	env?: string,
	concurrency = defaultConcurrency()
): Promise<void> {
	const apps = selectApps(ws, only)
	if (env !== undefined) requireEnvSupport(ws, apps, env)
	// SPOOL_ENV picks each remote's `urls` entry inside spool.vite.ts.
	const spawnEnv = env === undefined ? {} : { env: { ...process.env, SPOOL_ENV: env } }
	const tiers = [remotesOf(apps), hostsOf(apps)].filter(tier => tier.length)

	for (const tier of tiers) {
		await buildTier(ws, tier, spawnEnv, env, concurrency)
	}

	log.success(`built ${apps.length} app(s)`)
	verifySingletons(ws, apps)
}

function verifySingletons(ws: Workspace, apps: NamedApp[]): void {
	const conflicts = checkBuiltSingletons(
		ws,
		apps.map(({ name }) => name)
	)

	if (!conflicts.length) return

	for (const conflict of conflicts) {
		const blocked = conflict.unsatisfied
			.map(entry => `${entry.app} needs ${entry.requiredVersion}`)
			.join(', ')

		log.error(
			`"${conflict.dep}" shipped as ${describeShipped(conflict)}. Federation loads ${conflict.chosen}, which ${blocked}.`
		)
	}

	throw new CliError(
		`${conflicts.length} shared dep(s) resolved to versions the apps cannot agree on, so they would load more than one copy at runtime. Run \`spool doctor --fix\` to align them, reinstall, and build again.`
	)
}

interface BuildFailure {
	name: string
	output: string
}

async function buildTier(
	ws: Workspace,
	tier: NamedApp[],
	spawnEnv: { env?: NodeJS.ProcessEnv },
	env: string | undefined,
	concurrency: number
): Promise<void> {
	const queue = [...tier]
	const failures: BuildFailure[] = []

	const worker = async (): Promise<void> => {
		for (;;) {
			const next = queue.shift()
			if (!next) return

			const { name, app } = next
			log.step(`building ${pc.bold(name)} (${app.type})${env ? pc.dim(` for ${env}`) : ''}`)

			const { code, output } = await runCaptured(
				ws.manifest.packageManager,
				['run', 'build'],
				{ cwd: join(ws.root, app.path), ...spawnEnv }
			)

			if (code !== 0) {
				failures.push({ name, output })
				continue
			}

			if (output.trim()) log.plain(output.trimEnd())
		}
	}

	const workers = Math.max(1, Math.min(concurrency, tier.length))
	await Promise.all(Array.from({ length: workers }, worker))

	if (!failures.length) return

	for (const failure of failures) {
		log.error(`${failure.name} failed to build:`)
		if (failure.output.trim()) log.plain(failure.output.trimEnd())
	}

	const names = failures.map(failure => `"${failure.name}"`).join(', ')
	const reproduce = filterBuildCommand(ws.manifest.packageManager, failures[0]!.name)

	throw new CliError(
		failures.length === 1
			? `Build failed for ${names}. Run \`${reproduce}\` to reproduce it.`
			: `Builds failed for ${names}.`
	)
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
