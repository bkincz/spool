/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { HELPER_FILE, type Manifest } from './config.js'
import { FRAMEWORK_DEPS } from './versions.js'
import { packageName, remoteEnvVar } from '../util/names.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface Diagnostic {
	level: 'error' | 'warn'
	app: string
	message: string
}

type Apps = Manifest['apps']

const error = (app: string, message: string): Diagnostic => ({ level: 'error', app, message })
const warn = (app: string, message: string): Diagnostic => ({ level: 'warn', app, message })

/*
 *   DIAGNOSE
 ***************************************************************************************************/
export function diagnose(ws: Workspace): Diagnostic[] {
	const { apps } = ws.manifest
	return [
		...checkHelper(ws.root),
		...checkPorts(apps),
		...checkPaths(ws.root, apps),
		...checkRemotes(apps),
		...checkExposure(apps),
		...checkSharedDeps(ws),
		...checkFrameworkShared(ws),
	]
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
			`${HELPER_FILE} is missing from the workspace root. App vite configs import it; restore it from version control, or run \`spool add\` which recreates it.`
		),
	]
}

function checkPorts(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	const owners = new Map<number, string>()
	for (const [name, app] of Object.entries(apps)) {
		const owner = owners.get(app.port)
		if (owner) issues.push(error(name, `Port ${app.port} is already taken by "${owner}".`))
		else owners.set(app.port, name)
	}
	return issues
}

function checkPaths(root: string, apps: Apps): Diagnostic[] {
	return Object.entries(apps)
		.filter(([, app]) => !existsSync(join(root, app.path)))
		.map(([name, app]) => error(name, `Its folder "${app.path}" is missing.`))
}

function checkRemotes(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	for (const [name, host] of Object.entries(apps)) {
		if (host.type !== 'host') continue
		for (const remote of host.remotes) {
			const target = apps[remote]
			if (!target) {
				issues.push(
					error(name, `Remote "${remote}" does not match any app in this workspace.`)
				)
			} else if (target.type !== 'remote') {
				issues.push(
					error(
						name,
						`"${remote}" is wired as a remote but it is typed "${target.type}".`
					)
				)
			}
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
function checkSharedDeps(ws: Workspace): Diagnostic[] {
	const issues: Diagnostic[] = []
	const ranges = collectSharedRanges(ws, issues)
	issues.push(...findRangeMismatches(ranges))
	return issues
}

/** dep -> version range -> apps using that range. */
type SharedRanges = Map<string, Map<string, string[]>>

function collectSharedRanges(ws: Workspace, issues: Diagnostic[]): SharedRanges {
	const sharedPackages = [...new Set(ws.manifest.shared.map(packageName))]
	const ranges: SharedRanges = new Map()
	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const pkg = readPackageJson(join(ws.root, app.path, 'package.json'))
		if (pkg === 'missing') continue
		if (pkg === 'invalid') {
			issues.push(warn(name, 'Its package.json could not be parsed; shared deps unchecked.'))
			continue
		}
		const deps = { ...pkg.dependencies, ...pkg.devDependencies }
		// Another framework's runtime is expected to be absent; anything else
		// missing means the runtime helper silently drops the singleton for
		// this app and it bundles a private copy.
		const foreignRuntimes = new Set<string>(
			Object.entries(FRAMEWORK_DEPS)
				.filter(([framework]) => framework !== app.framework)
				.flatMap(([, frameworkDeps]) => frameworkDeps.dependencies)
		)
		for (const dep of sharedPackages) {
			const range = deps[dep]
			if (!range) {
				if (!foreignRuntimes.has(dep)) {
					issues.push(
						warn(name, `Shared dep "${dep}" is not in its package.json dependencies.`)
					)
				}
				continue
			}
			const byRange = ranges.get(dep) ?? new Map<string, string[]>()
			byRange.set(range, [...(byRange.get(range) ?? []), name])
			ranges.set(dep, byRange)
		}
	}
	return ranges
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
					`"${dep}" is not in "shared", so every ${framework} app bundles its own copy. Add it to "shared" in spool.json.`
				)
			)
		}
	}
	return issues
}

function findRangeMismatches(ranges: SharedRanges): Diagnostic[] {
	const issues: Diagnostic[] = []
	for (const [dep, byRange] of ranges) {
		if (byRange.size < 2) continue
		const detail = [...byRange.entries()].map(([r, names]) => `${names.join(', ')}: ${r}`)
		issues.push(
			warn(
				'',
				`Shared dep "${dep}" has mismatched versions (${detail.join('; ')}). Singletons across the federation boundary should agree.`
			)
		)
	}
	return issues
}

interface PackageJsonDeps {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

function readPackageJson(path: string): PackageJsonDeps | 'missing' | 'invalid' {
	if (!existsSync(path)) return 'missing'
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as PackageJsonDeps
	} catch {
		return 'invalid'
	}
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
		return [error(name, `Could not fetch ${url} (${reason}).`)]
	}

	if (!response.ok) {
		return [
			error(name, `${url} responded ${response.status}. Deploy the remote, or fix the url.`),
		]
	}

	const issues: Diagnostic[] = []
	let body: string
	try {
		body = await response.text()
	} catch (cause) {
		const reason = cause instanceof Error ? cause.message : String(cause)
		return [error(name, `Could not read the response from ${url} (${reason}).`)]
	}
	try {
		JSON.parse(body)
	} catch {
		issues.push(
			error(
				name,
				`${url} did not return JSON; this is usually the host's SPA fallback page, meaning mf-manifest.json is not deployed at that path.`
			)
		)
	}

	if (!response.headers.get('access-control-allow-origin')) {
		issues.push(
			warn(
				name,
				`${url} sends no Access-Control-Allow-Origin header, so browsers will block hosts on other origins. Deploy the remote's public/_headers file, or configure the header on your host.`
			)
		)
	}

	return issues
}

function checkExposure(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	const consumed = new Set(
		Object.values(apps).flatMap(app => (app.type === 'host' ? app.remotes : []))
	)
	for (const [name, app] of Object.entries(apps)) {
		if (app.type !== 'remote') continue
		if (Object.keys(app.exposes).length === 0) {
			issues.push(warn(name, 'It exposes nothing, so no host can import it.'))
		}
		if (!consumed.has(name)) {
			issues.push(warn(name, 'No host imports this remote yet.'))
		}
	}
	return issues
}
