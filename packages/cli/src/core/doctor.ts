/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { HELPER_FILE, type Framework, type Manifest } from './config.js'
import { FRAMEWORK_DEPS, SENTRY_SDK } from './versions.js'
import { readPackageJson } from './packages.js'
import { labelledMembers } from './packages-glob.js'
import { resolveRanges, type RangeInfo } from './ranges.js'
import { appConfigFiles, hostWiringFiles } from './generators.js'
import { exposeDeclarationPath, typesOutDir } from './types.js'
import { hashContent, Provenance } from './provenance.js'
import { isUpgrade } from '../util/semver.js'
import { packageName, remoteEnvVar } from '../util/names.js'
import { portOwner } from '../util/net.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface DepWrite {
	app: string
	dep: string
	range: string
}

export type DiagnosticFix =
	{ kind: 'share'; dep: string } | { kind: 'set-deps'; writes: DepWrite[] }

export interface Diagnostic {
	level: 'error' | 'warn'
	/** Stable, machine-readable identifier for --json consumers. */
	code: string
	app: string
	message: string
	/** Present only when doctor can repair this on its own. */
	fix?: DiagnosticFix
}

type Apps = Manifest['apps']

const error = (app: string, code: string, message: string): Diagnostic => ({
	level: 'error',
	code,
	app,
	message,
})
const warn = (app: string, code: string, message: string, fix?: DiagnosticFix): Diagnostic =>
	fix === undefined
		? { level: 'warn', code, app, message }
		: { level: 'warn', code, app, message, fix }

/*
 *   DIAGNOSE
 ***************************************************************************************************/
export function diagnose(ws: Workspace): Diagnostic[] {
	const { apps } = ws.manifest
	const targets = resolveRanges(ws)
	return [
		...checkHelper(ws.root),
		...checkPorts(apps),
		...checkPaths(ws.root, apps),
		...checkRemotes(apps),
		...checkExposure(apps),
		...checkExposedFiles(ws.root, apps),
		...checkSharedDeps(ws, targets),
		...checkManagedVersions(ws, targets),
		...checkFrameworkShared(ws),
		...checkGenerated(ws),
	]
}

export async function diagnosePorts(ws: Workspace): Promise<Diagnostic[]> {
	const issues: Diagnostic[] = []
	const owners = await Promise.all(
		Object.entries(ws.manifest.apps).map(
			async ([name, app]) => [name, app.port, await portOwner(app.port)] as const
		)
	)

	for (const [name, port, owner] of owners) {
		if (!owner) continue

		issues.push(
			warn(
				name,
				'port-in-use',
				`Port ${port} is already in use by pid ${owner.pid}${owner.command ? ` (${owner.command})` : ''}. Run \`spool dev --kill\` to free it, or change the port.`
			)
		)
	}

	return issues
}

/*
 *   CHECKS
 ***************************************************************************************************/
/** Every app's vite config imports the workspace-root helper at startup. */
function checkHelper(root: string): Diagnostic[] {
	if (existsSync(join(root, HELPER_FILE))) return []
	return [
		error(
			'',
			'missing-helper',
			`${HELPER_FILE} is missing from the workspace root. App vite configs import it; restore it from version control, or run \`spool add\` which recreates it.`
		),
	]
}

function checkPorts(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	const owners = new Map<number, string>()

	for (const [name, app] of Object.entries(apps)) {
		const owner = owners.get(app.port)

		if (owner) {
			issues.push(
				error(name, 'port-conflict', `Port ${app.port} is already taken by "${owner}".`)
			)
		} else owners.set(app.port, name)
	}

	return issues
}

function checkPaths(root: string, apps: Apps): Diagnostic[] {
	return Object.entries(apps)
		.filter(([, app]) => !existsSync(join(root, app.path)))
		.map(([name, app]) => error(name, 'missing-folder', `Its folder "${app.path}" is missing.`))
}

function checkRemotes(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	for (const [name, host] of Object.entries(apps)) {
		for (const remote of host.remotes) {
			const target = apps[remote]
			if (target?.type === 'remote') continue

			issues.push(
				error(
					name,
					'remote-type-mismatch',
					`"${remote}" is wired as a remote but it is typed "${target?.type}".`
				)
			)
		}
	}
	return issues
}

/**
 * Shared deps are federation singletons: apps that have them must agree on
 * the version range, and an app missing one silently bundles a private copy.
 * Another framework's runtime is the one legitimate absence, so a svelte app
 * without react is fine. Apps without a package.json are skipped; checkPaths
 * already reports missing folders.
 */
function checkSharedDeps(ws: Workspace, targets: Map<string, RangeInfo>): Diagnostic[] {
	const issues: Diagnostic[] = []
	const ranges = collectSharedRanges(ws, issues, targets)
	issues.push(...findRangeMismatches(ranges, targets))

	return issues
}

function checkManagedVersions(ws: Workspace, targets: Map<string, RangeInfo>): Diagnostic[] {
	const shared = new Set(ws.manifest.shared.map(packageName))
	const issues: Diagnostic[] = []

	for (const [dep, info] of targets) {
		if (shared.has(dep) || info.sources.size < 2) continue

		const detail = [...info.sources.entries()].map(([r, who]) => `${who.join(', ')}: ${r}`)
		const writes = alignmentWrites(dep, info.target, info.sources)

		issues.push(
			warn(
				'',
				'version-mismatch',
				`"${dep}" is on more than one version (${detail.join('; ')}). Spool keeps the deps it writes aligned across the workspace.`,
				writes.length ? { kind: 'set-deps', writes } : undefined
			)
		)
	}

	return issues
}

function alignmentWrites(
	dep: string,
	target: string | undefined,
	current: Iterable<[string, string[]]>
): DepWrite[] {
	if (target === undefined) return []
	return [...current]
		.filter(([range]) => isUpgrade(range, target))
		.flatMap(([, apps]) => apps.map(app => ({ app, dep, range: target })))
}

/** dep -> version range -> apps using that range. */
type SharedRanges = Map<string, Map<string, string[]>>

function collectSharedRanges(
	ws: Workspace,
	issues: Diagnostic[],
	targets: Map<string, RangeInfo>
): SharedRanges {
	const sharedPackages = [...new Set(ws.manifest.shared.map(packageName))]
	const ranges: SharedRanges = new Map()

	for (const [name, path] of labelledMembers(ws)) {
		const deps = declaredRanges(ws, name, path, issues)

		if (!deps) continue

		const app = ws.manifest.apps[name]
		const foreign = foreignRuntimes(app?.framework)

		for (const dep of sharedPackages) {
			const range = deps[dep]

			if (range === undefined) {
				if (app && !foreign.has(dep)) issues.push(missingShared(name, dep, targets))
				continue
			}

			recordRange(ranges, dep, range, name)
		}
	}

	return ranges
}

function declaredRanges(
	ws: Workspace,
	name: string,
	path: string,
	issues: Diagnostic[]
): Record<string, string> | undefined {
	const pkg = readPackageJson(join(ws.root, path, 'package.json'))

	if (pkg === 'missing') return undefined
	if (pkg === 'invalid') {
		issues.push(
			warn(
				name,
				'package-json-invalid',
				'Its package.json could not be parsed; shared deps unchecked.'
			)
		)
		return undefined
	}

	return { ...pkg.dependencies, ...pkg.devDependencies }
}

function foreignRuntimes(framework: Framework | undefined): Set<string> {
	const runtimes = Object.entries(FRAMEWORK_DEPS)
		.filter(([name]) => name !== framework)
		.flatMap(([, deps]) => deps.dependencies)
	const sentrySdks = Object.entries(SENTRY_SDK)
		.filter(([name]) => name !== framework)
		.map(([, sdk]) => sdk)

	return new Set([...runtimes, ...sentrySdks])
}

function missingShared(app: string, dep: string, targets: Map<string, RangeInfo>): Diagnostic {
	const target = targets.get(dep)?.target
	const writes: DepWrite[] = target === undefined ? [] : [{ app, dep, range: target }]

	return warn(
		app,
		'shared-missing',
		`Shared dep "${dep}" is not in its package.json dependencies.`,
		writes.length ? { kind: 'set-deps', writes } : undefined
	)
}

function recordRange(ranges: SharedRanges, dep: string, range: string, app: string): void {
	const byRange = ranges.get(dep) ?? new Map<string, string[]>()

	byRange.set(range, [...(byRange.get(range) ?? []), app])
	ranges.set(dep, byRange)
}
/**
 * Every framework in use needs its runtime in `shared`, or each of its apps
 * bundles a private copy and the singleton promise quietly breaks.
 */
function checkFrameworkShared(ws: Workspace): Diagnostic[] {
	const sharedPackages = new Set(ws.manifest.shared.map(packageName))
	const frameworks = new Set(Object.values(ws.manifest.apps).map(app => app.framework))
	const issues: Diagnostic[] = []

	for (const framework of frameworks) {
		for (const dep of FRAMEWORK_DEPS[framework].dependencies) {
			if (sharedPackages.has(dep)) continue

			issues.push(
				warn(
					'',
					'framework-not-shared',
					`"${dep}" is not in "shared", so every ${framework} app bundles its own copy. Add it to "shared" in spool.json.`,
					{ kind: 'share', dep }
				)
			)
		}
	}
	return issues
}

function findRangeMismatches(ranges: SharedRanges, targets: Map<string, RangeInfo>): Diagnostic[] {
	const issues: Diagnostic[] = []

	for (const [dep, byRange] of ranges) {
		if (byRange.size < 2) continue

		const detail = [...byRange.entries()].map(([r, names]) => `${names.join(', ')}: ${r}`)
		const writes = alignmentWrites(dep, targets.get(dep)?.target, byRange)

		issues.push(
			warn(
				'',
				'shared-mismatch',
				`Shared dep "${dep}" has mismatched versions (${detail.join('; ')}). Singletons across the federation boundary should agree.`,
				writes.length ? { kind: 'set-deps', writes } : undefined
			)
		)
	}

	return issues
}

/*
 *   REMOTE CHECKS
 ***************************************************************************************************/
/**
 * Fetches each deployed remote's manifest url, resolved the way a production
 * build resolves it: SPOOL_REMOTE_<NAME> override first, then the urls entry
 * for env, then url. Catches the two production failures a static host hides:
 * the SPA fallback answering 200 with HTML when mf-manifest.json is missing,
 * and absent CORS headers that make browsers block cross-origin hosts.
 */
export async function diagnoseRemotes(ws: Workspace, env?: string): Promise<Diagnostic[]> {
	const remotes = Object.entries(ws.manifest.apps).filter(([, app]) => app.type === 'remote')
	const issues: Diagnostic[] = []

	if (env !== undefined && !remotes.some(([, app]) => app.urls?.[env])) {
		issues.push(
			warn(
				'',
				'remote-no-env-url',
				`No remote has a "urls.${env}" entry in spool.json; checking each remote's "url" instead.`
			)
		)
	}

	const results = await Promise.all(
		remotes.map(([name, app]) => {
			const url =
				process.env[remoteEnvVar(name)] ||
				((env === undefined ? undefined : app.urls?.[env]) ?? app.url)
			return url ? checkDeployedRemote(name, url) : Promise.resolve([noUrl(name, env)])
		})
	)

	return [...issues, ...results.flat()]
}

const noUrl = (name: string, env?: string): Diagnostic =>
	warn(
		name,
		'remote-no-url',
		env === undefined
			? 'It has no "url" in spool.json, so there is no deployed manifest to check.'
			: `It has no "urls.${env}" or "url" in spool.json, so there is no deployed manifest to check.`
	)

async function checkDeployedRemote(name: string, url: string): Promise<Diagnostic[]> {
	let response: Response

	try {
		response = await fetch(url, {
			headers: { Origin: 'https://spool-doctor.invalid' },
			signal: AbortSignal.timeout(8000),
		})
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause)
		return [error(name, 'remote-unreachable', `Could not fetch ${url} (${reason}).`)]
	}

	if (!response.ok) {
		return [
			error(
				name,
				'remote-bad-status',
				`${url} responded ${response.status}. Deploy the remote, or fix the url.`
			),
		]
	}

	const issues: Diagnostic[] = []
	let body: string
	try {
		body = await response.text()
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause)
		return [
			error(
				name,
				'remote-unreadable',
				`Could not read the response from ${url} (${reason}).`
			),
		]
	}

	try {
		JSON.parse(body)
	} catch {
		issues.push(
			error(
				name,
				'remote-not-json',
				`${url} did not return JSON; this is usually the host's SPA fallback page, meaning mf-manifest.json is not deployed at that path.`
			)
		)
	}

	if (!response.headers.get('access-control-allow-origin')) {
		issues.push(
			warn(
				name,
				'remote-no-cors',
				`${url} sends no Access-Control-Allow-Origin header, so browsers will block hosts on other origins. Deploy the remote's public/_headers file, or configure the header on your host.`
			)
		)
	}

	return issues
}

function checkExposedFiles(root: string, apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []

	for (const [name, app] of Object.entries(apps)) {
		if (!existsSync(join(root, app.path))) continue

		for (const [key, source] of Object.entries(app.exposes)) {
			if (existsSync(join(root, app.path, source))) continue

			issues.push(
				error(
					name,
					'expose-missing-source',
					`It exposes "${key}" from "${source}", which is not there. The build cannot emit a remote entry for it.`
				)
			)
		}
	}

	return issues
}

function checkExposure(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	const consumed = new Set(Object.values(apps).flatMap(app => app.remotes))
	for (const [name, app] of Object.entries(apps)) {
		if (app.type !== 'remote') continue

		if (Object.keys(app.exposes).length === 0) {
			issues.push(
				warn(name, 'remote-empty-exposes', 'It exposes nothing, so no host can import it.')
			)
		}

		if (!consumed.has(name)) {
			issues.push(warn(name, 'remote-unused', 'No host imports this remote yet.'))
		}
	}

	return issues
}

/*
 *   GENERATED FILE CHECKS
 ***************************************************************************************************/
function checkGenerated(ws: Workspace): Diagnostic[] {
	const provenance = Provenance.load(ws.root)
	return [
		...checkProvenanceDrift(ws, provenance),
		...checkUntrackedGenerated(ws, provenance),
		...checkHostHeaders(ws.root, ws.manifest.apps),
		...checkUnusedShared(ws),
		...checkSentryEnv(ws),
		...checkStaleTypes(ws.root, ws.manifest.apps),
	]
}

function checkProvenanceDrift(ws: Workspace, provenance: Provenance): Diagnostic[] {
	const issues: Diagnostic[] = []

	for (const [rel, hash] of provenance.entries()) {
		const target = join(ws.root, rel)
		if (!existsSync(target)) continue

		let actual: string
		try {
			actual = readFileSync(target, 'utf8')
		} catch {
			continue
		}

		if (hashContent(actual) !== hash) {
			issues.push(
				warn(
					ownerOf(ws, rel),
					'file-edited',
					`${rel} has local changes since spool last generated it. \`spool upgrade\` will ask before overwriting it.`
				)
			)
		}
	}

	return issues
}

function checkUntrackedGenerated(ws: Workspace, provenance: Provenance): Diagnostic[] {
	const issues: Diagnostic[] = []
	const sentry = ws.manifest.addons.includes('sentry')

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const dir = join(ws.root, app.path)
		if (!existsSync(dir)) continue

		const expected = {
			...appConfigFiles(name, app, sentry),
			...hostWiringFiles(ws.manifest, app, ws.root),
		}

		for (const rel of Object.keys(expected)) {
			const full = `${app.path}/${rel}`
			if (!existsSync(join(ws.root, full)) || provenance.tracks(full)) continue

			issues.push(
				warn(
					name,
					'file-untracked',
					`${full} looks generated but spool has no record of writing it. Run \`spool upgrade\` to start tracking it.`
				)
			)
		}
	}

	return issues
}

function ownerOf(ws: Workspace, rel: string): string {
	const owner = Object.entries(ws.manifest.apps).find(
		([, app]) => rel === app.path || rel.startsWith(`${app.path}/`)
	)
	return owner?.[0] ?? ''
}

function checkHostHeaders(root: string, apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []

	for (const [name, app] of Object.entries(apps)) {
		if (app.type !== 'host') continue

		const target = join(root, app.path, 'public/_headers')
		if (!existsSync(target)) continue

		let content: string
		try {
			content = readFileSync(target, 'utf8')
		} catch {
			continue
		}

		if (/access-control-allow-origin/i.test(content)) {
			issues.push(
				warn(
					name,
					'host-cors-headers',
					'public/_headers sends Access-Control-Allow-Origin, which is for a remote serving assets cross-origin. A host does not need it.'
				)
			)
		}
	}

	return issues
}

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|svelte|vue)$/

function collectSourceText(dir: string): string {
	if (!existsSync(dir)) return ''

	let entries: Dirent[]
	try {
		entries = readdirSync(dir, { recursive: true, withFileTypes: true })
	} catch {
		return ''
	}

	let text = ''
	for (const entry of entries) {
		if (!entry.isFile() || !SOURCE_EXTENSIONS.test(entry.name)) continue

		try {
			text += readFileSync(join(entry.parentPath, entry.name), 'utf8')
		} catch {
			continue
		}
	}
	return text
}

function checkUnusedShared(ws: Workspace): Diagnostic[] {
	const issues: Diagnostic[] = []

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const dir = join(ws.root, app.path)
		if (!existsSync(dir)) continue

		const exempt = new Set([
			...foreignRuntimes(app.framework),
			...FRAMEWORK_DEPS[app.framework].dependencies,
		])
		const source = collectSourceText(join(dir, 'src'))
		const unused = ws.manifest.shared.filter(
			dep =>
				!exempt.has(packageName(dep)) &&
				!source.includes(`"${dep}`) &&
				!source.includes(`'${dep}`)
		)
		if (!unused.length) continue

		const shown = unused.slice(0, 3).join(', ')
		const more = unused.length > 3 ? ` and ${unused.length - 3} more` : ''
		issues.push(
			warn(
				name,
				'shared-unused',
				`Shares ${unused.length} entr${unused.length === 1 ? 'y' : 'ies'} nothing under src imports (${shown}${more}). Harmless, but trimming "shared" keeps its manifest smaller.`
			)
		)
	}

	return issues
}

/** Sentry reports nowhere without a DSN, so a workspace with the addon on and no
 * VITE_SENTRY_DSN anywhere for an app is initialised but silent. */
function checkSentryEnv(ws: Workspace): Diagnostic[] {
	if (!ws.manifest.addons.includes('sentry')) return []
	const issues: Diagnostic[] = []

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const dir = join(ws.root, app.path)
		if (!existsSync(dir)) continue

		let envFiles: string[]
		try {
			envFiles = readdirSync(dir).filter(f => f === '.env' || f.startsWith('.env.'))
		} catch {
			continue
		}

		const hasDsn = envFiles.some(file => {
			try {
				return readFileSync(join(dir, file), 'utf8').includes('VITE_SENTRY_DSN')
			} catch {
				return false
			}
		})

		if (!hasDsn) {
			issues.push(
				warn(
					name,
					'sentry-env-missing',
					'Sentry is on but no .env file here sets VITE_SENTRY_DSN; it will report to nowhere until you set it.'
				)
			)
		}
	}

	return issues
}

/** .spool/types is build output from `spool types`. If it is stale, not wrong,
 * so this only hints at a refresh rather than failing the run. */
function checkStaleTypes(root: string, apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []

	for (const [name, app] of Object.entries(apps)) {
		const exposes = Object.entries(app.exposes)
		if (!exposes.length || !existsSync(join(root, typesOutDir(name)))) continue

		const stale = exposes.some(([, source]) => {
			const sourcePath = join(root, app.path, source)
			const declPath = exposeDeclarationPath(root, name, app.path, source)
			if (!existsSync(sourcePath) || !existsSync(declPath)) return false

			return statSync(sourcePath).mtimeMs > statSync(declPath).mtimeMs
		})

		if (stale) {
			issues.push(
				warn(
					name,
					'types-stale',
					'.spool/types looks older than an exposed source file. Run `spool types` to refresh it.'
				)
			)
		}
	}

	return issues
}
