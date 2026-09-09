/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import { requireWorkspace, type Workspace } from '../core/workspace.js'
import { readPackageJson } from '../core/packages.js'
import { workspaceMembers } from '../core/packages-glob.js'
import type { AppConfig } from '../core/config.js'
import { runCaptured } from '../util/exec.js'
import { log, fail } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface AffectedOptions {
	since?: string
	json?: boolean
}

/*
 *   AFFECTED
 ***************************************************************************************************/
export async function affected(opts: AffectedOptions): Promise<void> {
	if (!opts.since) fail('Usage: spool affected --since <ref>')

	const ws = await requireWorkspace()
	const changed = await changedFiles(ws.root, opts.since)
	const apps = affectedApps(ws, changed)

	if (opts.json) {
		log.plain(JSON.stringify({ since: opts.since, changed, apps }, null, 2))
		return
	}

	if (!apps.length) {
		log.success(`no apps affected since ${opts.since}`)
		return
	}

	log.info(`apps affected since ${opts.since}:`)
	for (const name of apps) log.plain(`  ${name}`)
}

/*
 *   GIT
 ***************************************************************************************************/
async function changedFiles(root: string, since: string): Promise<string[]> {
	const result = await runCaptured('git', ['diff', '--name-only', since], { cwd: root })
	if (result.code !== 0) {
		fail(`\`git diff --name-only ${since}\` failed:\n${result.output.trim()}`)
	}

	return result.output
		.split(/\r?\n/)
		.map(line => line.trim().split(/[\\/]/).join('/'))
		.filter(Boolean)
}

/*
 *   MAPPING
 ***************************************************************************************************/
function under(file: string, dir: string): boolean {
	const normalised = dir.replace(/\/$/, '')
	return file === normalised || file.startsWith(`${normalised}/`)
}

function isWorkspaceLevel(dirs: string[], file: string): boolean {
	return !dirs.some(dir => under(file, dir))
}

function importablePackages(ws: Workspace, app: AppConfig): Set<string> {
	const pkg = readPackageJson(join(ws.root, app.path, 'package.json'))
	if (pkg === 'missing' || pkg === 'invalid') return new Set()

	return new Set([
		...Object.keys(pkg.dependencies ?? {}),
		...Object.keys(pkg.devDependencies ?? {}),
	])
}

/** Workspace package (npm) name -> its path, for every non-app member spool can see. */
function packagesByName(ws: Workspace): Map<string, string> {
	const byName = new Map<string, string>()

	for (const path of workspaceMembers(ws)) {
		const pkg = readPackageJson(join(ws.root, path, 'package.json'))
		if (pkg === 'missing' || pkg === 'invalid') continue

		const name = pkg.name
		if (typeof name === 'string') byName.set(name, path)
	}

	return byName
}

export function affectedApps(ws: Workspace, changed: string[]): string[] {
	const packages = packagesByName(ws)
	const allDirs = [...Object.values(ws.manifest.apps).map(app => app.path), ...packages.values()]
	const workspaceLevel = changed.some(file => isWorkspaceLevel(allDirs, file))

	const affected = new Set<string>()

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		if (workspaceLevel || changed.some(file => under(file, app.path))) {
			affected.add(name)
			continue
		}

		for (const dep of importablePackages(ws, app)) {
			const path = packages.get(dep)
			if (path && changed.some(file => under(file, path))) {
				affected.add(name)
				break
			}
		}
	}

	return [...affected].sort()
}
