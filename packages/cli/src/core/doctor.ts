/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { HELPER_FILE, type Manifest } from './config.js'

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
 * Shared deps are federation singletons: every app must have them, at the
 * same version range. Apps without a package.json are skipped; checkPaths
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

/** "@scope/pkg/subpath" and "pkg/subpath" resolve to the installable package. */
function packageName(specifier: string): string {
	const parts = specifier.split('/')
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

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
		for (const dep of sharedPackages) {
			const range = deps[dep]
			if (!range) {
				issues.push(
					warn(name, `Shared dep "${dep}" is not in its package.json dependencies.`)
				)
				continue
			}
			const byRange = ranges.get(dep) ?? new Map<string, string[]>()
			byRange.set(range, [...(byRange.get(range) ?? []), name])
			ranges.set(dep, byRange)
		}
	}
	return ranges
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
