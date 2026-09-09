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
import {
	runCaptured,
	runShell,
	spawnProcess,
	killTree,
	killTreeSync,
	killPid,
} from '../util/exec.js'
import { waitForManifest, portOwner } from '../util/net.js'
import { remoteEnvVar } from '../util/names.js'
import { CliError } from '../util/errors.js'
import { log } from '../util/logger.js'
import { COLORS, DevOutput, type ServeMode, type TrackMeta } from './output.js'
import { writePidfile, readPidfile, removePidfile, type TrackedChild } from './pidfile.js'
import {
	readDeployStore,
	recordDeploy,
	deployHistory,
	readBuiltSharedEntries,
	sharedConflicts,
	type DeployRecord,
} from './deploys.js'

/*
 *   TYPES
 ***************************************************************************************************/

interface NamedApp {
	name: string
	app: AppConfig
}

export interface AppRunResult {
	name: string
	ok: boolean
	duration: number
	error?: string
}

/** "built" previews an unselected remote's dist; an env name points hosts at its deployed url. */
export type RestSpec = { kind: 'built' } | { kind: 'env'; env: string }

export interface ServeOptions {
	only?: string[]
	rest?: RestSpec
	/** Seconds to wait for each remote's manifest before starting hosts anyway. */
	timeoutSeconds?: number
	/** Ladle runs by default, including under --only; --no-ladle sets this false. */
	ladle?: boolean
}

const DEFAULT_REMOTE_TIMEOUT_SECONDS = 20

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

function missingRemotes(app: AppConfig, selectedNames: Set<string>): string[] {
	return app.remotes.filter(r => !selectedNames.has(r))
}

/**
 * A host (or a remote consuming another remote) started without its remotes
 * fails at runtime when it imports them. Warn up front instead of leaving it
 * to the browser console.
 */
function warnExcludedRemotes(selected: NamedApp[]): void {
	const names = new Set(selected.map(a => a.name))
	for (const { name, app } of selected) {
		const missing = missingRemotes(app, names)
		if (missing.length) {
			log.warn(
				`${name} expects remote(s) ${missing.join(', ')} that are not selected. Start them separately, or use \`spool dev --rest\`.`
			)
		}
	}
}

/** The remotes a selection needs but did not include; candidates for --rest. */
function excludedRemotes(ws: Workspace, selected: NamedApp[]): NamedApp[] {
	const names = new Set(selected.map(a => a.name))
	const needed = new Set<string>()

	for (const { app } of selected) {
		for (const name of missingRemotes(app, names)) needed.add(name)
	}

	return [...needed]
		.map(name => ({ name, app: ws.manifest.apps[name] }))
		.filter((a): a is NamedApp => a.app !== undefined)
}

const remotesOf = (apps: NamedApp[]): NamedApp[] => apps.filter(a => a.app.type === 'remote')
const hostsOf = (apps: NamedApp[]): NamedApp[] => apps.filter(a => a.app.type === 'host')

/*
 *   DEV / PREVIEW
 ***************************************************************************************************/
export function devAll(ws: Workspace, opts: ServeOptions = {}): Promise<void> {
	return serveAll(ws, 'dev', opts)
}

export function previewAll(ws: Workspace, opts: ServeOptions = {}): Promise<void> {
	return serveAll(ws, 'preview', opts)
}

interface RestResolution {
	builtRemotes: NamedApp[]
	envVars: NodeJS.ProcessEnv
}

/** Resolves --rest for the remotes a selection needs but excluded. */
function resolveRest(
	ws: Workspace,
	excluded: NamedApp[],
	rest: RestSpec | undefined
): RestResolution {
	if (!rest || !excluded.length) return { builtRemotes: [], envVars: {} }

	if (rest.kind === 'built') {
		const missingDist = excluded.filter(
			({ app }) => !existsSync(join(ws.root, app.path, 'dist'))
		)
		if (missingDist.length) {
			const names = missingDist.map(a => a.name).join(',')
			throw new CliError(
				`--rest built needs a dist folder for ${missingDist.map(a => a.name).join(', ')}. Run \`spool build --only ${names}\` first.`
			)
		}
		return { builtRemotes: excluded, envVars: {} }
	}

	const envVars: NodeJS.ProcessEnv = {}
	const unresolved: string[] = []

	for (const { name, app } of excluded) {
		const url = app.urls?.[rest.env] ?? app.url
		if (!url) {
			unresolved.push(name)
			continue
		}
		envVars[remoteEnvVar(name)] = url
	}

	if (unresolved.length) {
		throw new CliError(
			`--rest ${rest.env} needs a "urls.${rest.env}" or "url" for ${unresolved.join(', ')} in spool.json.`
		)
	}

	return { builtRemotes: [], envVars }
}

async function serveAll(ws: Workspace, mode: ServeMode, opts: ServeOptions = {}): Promise<void> {
	const apps = selectApps(ws, opts.only)

	if (!apps.length) {
		log.warn('No apps to run.')
		return
	}

	if (mode === 'preview') {
		requireDists(ws, apps)
		warnStalePreview(ws)
		warnDeployedUrls(apps)
	}

	const excluded = excludedRemotes(ws, apps)
	const rest = resolveRest(ws, excluded, opts.rest)
	if (!opts.rest) warnExcludedRemotes(apps)

	const remotes = remotesOf(apps)
	const hosts = hostsOf(apps)
	const ladle = mode === 'dev' && opts.ladle !== false ? detectLadle(ws) : undefined
	const runningCount = apps.length + rest.builtRemotes.length
	const total = runningCount + (ladle ? 1 : 0)
	const session = new ServeSession(ws, mode, new DevOutput(total, mode))

	session.trapSignals()
	log.step(`starting ${runningCount} app(s), remotes first`)

	let index = 0
	for (const remote of remotes) session.start(remote, index++, rest.envVars)
	for (const built of rest.builtRemotes) session.startBuilt(built, index++)
	if (ladle) session.startLadle(ladle, index++)

	const timeoutSeconds = opts.timeoutSeconds ?? DEFAULT_REMOTE_TIMEOUT_SECONDS
	const controller = new AbortController()
	session.crashed.catch(() => controller.abort())

	await Promise.race([
		Promise.all(
			remotes.map(remote => waitForRemote(remote, timeoutSeconds, controller.signal))
		),
		session.crashed,
	])

	for (const host of hosts) session.start(host, index++, rest.envVars)

	await session.crashed
}

export async function killRunning(ws: Workspace, mode: ServeMode): Promise<void> {
	const pidfile = readPidfile(ws, mode)
	const targets = new Map<number, string>()

	if (pidfile !== undefined && pidfile.parentPid !== process.pid) {
		targets.set(pidfile.parentPid, `${mode} session`)
	}
	for (const child of pidfile?.children ?? []) targets.set(child.pid, child.name)

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const owner = await portOwner(app.port)
		if (owner && !targets.has(owner.pid)) targets.set(owner.pid, owner.command ?? name)
	}

	removePidfile(ws, mode)

	if (!targets.size) {
		log.info(`Nothing to kill: no ${mode} pidfile and none of the manifest ports are in use.`)
		return
	}

	for (const [pid, name] of targets) {
		const ok = killPid(pid)
		if (ok) log.step(`stopped ${name} (pid ${pid})`)
		else log.warn(`could not stop ${name} (pid ${pid}); it may need killing by hand.`)
	}

	log.success(`stopped ${targets.size} process(es)`)
}

class ServeSession {
	private readonly children: ChildProcess[] = []
	private readonly tracked: TrackedChild[] = []
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

	private readonly onGracefulSignal = (): void => {
		void this.exitAfterStop(0)
	}

	private readonly onFatal = (err: unknown): void => {
		log.error(err instanceof Error ? err.message : String(err))
		void this.exitAfterStop(1)
	}

	private readonly onProcessExit = (): void => {
		if (this.shuttingDown) return

		this.output.dispose()
		for (const child of this.children) killTreeSync(child)

		removePidfile(this.ws, this.mode)
	}

	trapSignals(): void {
		process.on('SIGINT', this.onGracefulSignal)
		process.on('SIGTERM', this.onGracefulSignal)
		process.on('SIGHUP', this.onGracefulSignal)
		if (process.platform === 'win32') process.on('SIGBREAK', this.onGracefulSignal)
		process.on('uncaughtException', this.onFatal)
		process.on('unhandledRejection', this.onFatal)
		process.on('exit', this.onProcessExit)
	}

	private async exitAfterStop(code: number): Promise<void> {
		const ok = await this.stopAll()
		process.exit(ok ? code : 1)
	}

	/** Kills every tracked child and confirms it. Resolves false if any kill failed. */
	async stopAll(): Promise<boolean> {
		if (this.shuttingDown) return true

		this.shuttingDown = true
		this.output.dispose()
		removePidfile(this.ws, this.mode)

		const results = await Promise.all(
			this.children.map(async child => {
				const ok = await killTree(child)
				child.stdout?.destroy()
				child.stderr?.destroy()

				return ok
			})
		)

		return results.every(Boolean)
	}

	private trackChild(name: string, port: number, child: ChildProcess): void {
		this.children.push(child)
		if (child.pid !== undefined) this.tracked.push({ name, port, pid: child.pid })

		writePidfile(this.ws, this.mode, this.tracked)
	}

	private handleSpawnFailure(name: string, err: NodeJS.ErrnoException): void {
		if (this.shuttingDown) return

		this.output.flushAll(name)
		void this.stopAll()

		const hint =
			err.code === 'ENOENT'
				? `Could not run "${this.ws.manifest.packageManager}". Make sure it is installed and on your PATH.`
				: err.message
		this.reportCrash(new CliError(`${name} failed to start: ${hint}`))
	}

	private handleAppExit(name: string, code: number | null): void {
		if (this.shuttingDown || code === 0) return

		setImmediate(() => {
			if (this.shuttingDown) return
			// The buffered startup output is the only clue to why it died.
			this.output.flushAll(name)
			void this.stopAll()
			this.reportCrash(
				new CliError(
					code === null
						? `${name} was killed unexpectedly. Shutting down the others.`
						: `${name} stopped unexpectedly (exit ${code}). Shutting down the others.`
				)
			)
		})
	}

	start(named: NamedApp, colorIndex: number, extraEnv?: NodeJS.ProcessEnv): void {
		const child = spawnApp(
			this.ws,
			named,
			COLORS[colorIndex % COLORS.length]!,
			this.output,
			this.mode,
			extraEnv
		)

		child.on('error', err => this.handleSpawnFailure(named.name, err as NodeJS.ErrnoException))
		child.on('exit', code => this.handleAppExit(named.name, code))

		this.trackChild(named.name, named.app.port, child)
	}

	/** Previews an unselected remote's dist for `--rest built`, regardless of the session's own mode. */
	startBuilt(named: NamedApp, colorIndex: number): void {
		const child = spawnProcess(this.ws.manifest.packageManager, ['run', 'preview'], {
			cwd: join(this.ws.root, named.app.path),
		})

		child.on('error', err => this.handleSpawnFailure(named.name, err as NodeJS.ErrnoException))
		child.on('exit', code => this.handleAppExit(named.name, code))

		const meta: TrackMeta = {
			role: `${named.app.type} · preview (--rest built)`,
			port: named.app.port,
			order: 1,
		}
		const status = this.output.track(named.name, meta, COLORS[colorIndex % COLORS.length]!)
		child.stdout?.on('data', (d: Buffer) => this.output.chunk(status, d, false))
		child.stderr?.on('data', (d: Buffer) => this.output.chunk(status, d, true))

		this.trackChild(named.name, named.app.port, child)
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

		child.on('error', (err: NodeJS.ErrnoException) => {
			if (this.shuttingDown) return

			this.output.drop(info.name)
			log.warn(
				`ladle failed to start (${err.code ?? err.message}). The app servers are still running.`
			)
		})

		child.on('exit', code => {
			if (this.shuttingDown || code === 0 || code === null) return

			// Ladle is auxiliary -- a failed workshop must not take the app servers down.
			setImmediate(() => {
				if (this.shuttingDown) return

				this.output.drop(info.name)
				log.warn(`ladle stopped (exit ${code}). The app servers are still running.`)
			})
		})

		this.trackChild(info.name, info.port, child)
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
	if (helperLacks(ws, 'cors')) {
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

async function waitForRemote(
	{ name, app }: NamedApp,
	timeoutSeconds: number,
	signal: AbortSignal
): Promise<void> {
	const url = `http://localhost:${app.port}/mf-manifest.json`
	try {
		await waitForManifest(url, { timeoutMs: timeoutSeconds * 1000, signal })
	} catch {
		// A sibling crash aborted the poll; that failure is reported elsewhere.
		if (signal.aborted) return
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
	mode: ServeMode,
	extraEnv?: NodeJS.ProcessEnv
): ChildProcess {
	const child = spawnProcess(ws.manifest.packageManager, ['run', mode], {
		cwd: join(ws.root, app.path),
		...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
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
	concurrency = defaultConcurrency(),
	onResult?: (result: AppRunResult) => void
): Promise<void> {
	const apps = selectApps(ws, only)
	if (env !== undefined) requireEnvSupport(ws, apps, env)
	// SPOOL_ENV picks each remote's `urls` entry inside spool.vite.ts.
	const spawnEnv = env === undefined ? {} : { env: { ...process.env, SPOOL_ENV: env } }
	const tiers = [remotesOf(apps), hostsOf(apps)].filter(tier => tier.length)

	for (const tier of tiers) {
		await buildTier(ws, tier, spawnEnv, env, concurrency, onResult)
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
	concurrency: number,
	onResult?: (result: AppRunResult) => void
): Promise<void> {
	const queue = [...tier]
	const failures: BuildFailure[] = []

	const worker = async (): Promise<void> => {
		for (; ;) {
			const next = queue.shift()
			if (!next) return

			const { name, app } = next
			log.step(`building ${pc.bold(name)} (${app.type})${env ? pc.dim(` for ${env}`) : ''}`)

			const started = Date.now()
			const { code, output } = await runCaptured(
				ws.manifest.packageManager,
				['run', 'build'],
				{ cwd: join(ws.root, app.path), ...spawnEnv }
			)
			const duration = Date.now() - started

			if (code !== 0) {
				failures.push({ name, output })
				onResult?.({
					name,
					ok: false,
					duration,
					error: output.trim() || `exit code ${code}`,
				})
				continue
			}

			onResult?.({ name, ok: true, duration })
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
async function gitHeadSha(cwd: string): Promise<string> {
	const { code, output } = await runCaptured('git', ['rev-parse', 'HEAD'], { cwd })
	if (code !== 0) {
		throw new CliError(
			'Could not read the current git commit (`git rev-parse HEAD` failed). Deploy records need a git repository.'
		)
	}
	return output.trim()
}

const shortSha = (sha: string): string => sha.slice(0, 7)

function requireDeployableApp(ws: Workspace, name: string): AppConfig {
	const app = ws.manifest.apps[name]
	if (!app) {
		throw new CliError(
			`No app named "${name}" in this workspace. Check the names in spool.json.`
		)
	}
	if (!app.deploy) {
		throw new CliError(`"${name}" has no "deploy" command in spool.json.`)
	}
	return app
}

async function ensureHeadMatches(ws: Workspace, sha: string): Promise<void> {
	const head = await gitHeadSha(ws.root)
	if (head.startsWith(sha)) return
	throw new CliError(
		`The working tree is at ${shortSha(head)}, not ${shortSha(sha)}. Check out that commit (and its build) before promoting or rolling back.`
	)
}

async function runAppDeploy(
	ws: Workspace,
	name: string,
	app: AppConfig,
	env: string,
	spawnEnv: { env?: NodeJS.ProcessEnv }
): Promise<DeployRecord> {
	const entries = readBuiltSharedEntries(ws.root, app.path)
	const store = readDeployStore(ws)
	const conflicts = sharedConflicts(store, env, name, entries)

	if (conflicts.length) {
		const details = conflicts
			.map(
				c =>
					`"${c.dep}" needs ${c.requiredVersion}, but "${c.otherApp}" last shipped ${c.otherVersion} to "${env}"`
			)
			.join('; ')
		throw new CliError(
			`${name} would ship a shared dep another app cannot load: ${details}. Align the versions and rebuild before deploying.`
		)
	}

	await runShell(app.deploy!, { cwd: join(ws.root, app.path), ...spawnEnv })

	const sha = await gitHeadSha(ws.root)
	return {
		sha,
		url: app.urls?.[env] ?? app.url ?? '',
		at: new Date().toISOString(),
		shared: Object.fromEntries(entries.map(entry => [entry.name, entry.version])),
	}
}

export async function deployAll(
	ws: Workspace,
	only?: string[],
	env?: string,
	onResult?: (result: AppRunResult) => void
): Promise<void> {
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

		const started = Date.now()
		try {
			if (env !== undefined) {
				const record = await runAppDeploy(ws, name, app, env, spawnEnv)
				recordDeploy(ws, env, name, record)
			} else {
				await runShell(app.deploy!, { cwd: dir, ...spawnEnv })
			}

			onResult?.({ name, ok: true, duration: Date.now() - started })
		} catch (err) {
			onResult?.({
				name,
				ok: false,
				duration: Date.now() - started,
				error: err instanceof Error ? err.message : String(err),
			})

			throw err instanceof CliError
				? err
				: new CliError(`Deploy failed for "${name}". Its command: ${app.deploy}`)
		}

		if (app.type === 'remote' && !app.url) {
			log.warn(
				`${name} has no "url" in spool.json, so host production builds still point at localhost. Set it to the deployed mf-manifest.json.`
			)
		}
	}
	log.success(`deployed ${deployable.length} app(s)`)
}

export async function promoteApp(
	ws: Workspace,
	env: string,
	name: string,
	sha: string
): Promise<void> {
	const app = requireDeployableApp(ws, name)
	await ensureHeadMatches(ws, sha)

	const record = await runAppDeploy(ws, name, app, env, {
		env: { ...process.env, SPOOL_ENV: env },
	})
	recordDeploy(ws, env, name, record)
	log.success(`promoted ${name}@${shortSha(record.sha)} to "${env}"`)
}

export async function rollbackApp(ws: Workspace, env: string, name: string): Promise<void> {
	const app = requireDeployableApp(ws, name)
	const history = deployHistory(readDeployStore(ws), env, name)
	const target = history[1]

	if (!target) {
		throw new CliError(`No earlier deploy of "${name}" recorded for "${env}" to roll back to.`)
	}

	await ensureHeadMatches(ws, target.sha)

	const record = await runAppDeploy(ws, name, app, env, {
		env: { ...process.env, SPOOL_ENV: env },
	})
	recordDeploy(ws, env, name, record)
	log.success(`rolled ${name} back to ${shortSha(record.sha)} on "${env}"`)
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
