/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { compareVersions, rangeFloor, satisfies } from '../util/semver.js'

/*
 *   TYPES
 ***************************************************************************************************/
/** Where module federation writes what a build actually resolved. */
const BUILT_MANIFEST = join('dist', 'mf-manifest.json')

interface SharedEntry {
	name: string
	/** The version installed at build time, not the range asked for. */
	version: string
	requiredVersion?: string
}

interface BuiltManifest {
	shared?: SharedEntry[]
}

interface Shipped {
	app: string
	version: string
	requiredVersion: string | undefined
}

export interface SingletonConflict {
	dep: string
	/** What federation settles on at runtime: the highest version shipped. */
	chosen: string
	/** Apps whose requiredVersion that version does not meet. */
	unsatisfied: { app: string; requiredVersion: string }[]
	/** Version -> the apps that shipped it. */
	shipped: Map<string, string[]>
}

/*
 *   READ
 ***************************************************************************************************/
function readBuiltManifest(root: string, path: string): BuiltManifest | undefined {
	const target = join(root, path, BUILT_MANIFEST)

	if (!existsSync(target)) return undefined

	try {
		return JSON.parse(readFileSync(target, 'utf8')) as BuiltManifest
	} catch {
		return undefined
	}
}

/*
 *   VERIFY
 ***************************************************************************************************/
export function checkBuiltSingletons(ws: Workspace, names: string[]): SingletonConflict[] {
	const byDep = new Map<string, Shipped[]>()

	for (const name of names) {
		const app = ws.manifest.apps[name]
		const manifest = app && readBuiltManifest(ws.root, app.path)

		if (!manifest) continue

		for (const entry of manifest.shared ?? []) {
			const shipped = byDep.get(entry.name) ?? []
			shipped.push({
				app: name,
				version: entry.version,
				requiredVersion: entry.requiredVersion,
			})
			byDep.set(entry.name, shipped)
		}
	}

	const conflicts: SingletonConflict[] = []
	for (const [dep, shipped] of byDep) {
		const conflict = conflictFor(dep, shipped)
		if (conflict) conflicts.push(conflict)
	}

	return conflicts
}

function conflictFor(dep: string, shipped: Shipped[]): SingletonConflict | undefined {
	const byVersion = new Map<string, string[]>()
	for (const entry of shipped) {
		byVersion.set(entry.version, [...(byVersion.get(entry.version) ?? []), entry.app])
	}

	if (byVersion.size < 2) return undefined

	const chosen = highest([...byVersion.keys()])
	if (chosen === undefined) return undefined

	const unsatisfied = shipped
		// Null means spool cannot read the range, so it says nothing rather than just guessing.
		.filter(
			entry => entry.requiredVersion && satisfies(chosen, entry.requiredVersion) === false
		)
		.map(entry => ({ app: entry.app, requiredVersion: entry.requiredVersion! }))

	if (!unsatisfied.length) return undefined

	return { dep, chosen, unsatisfied, shipped: byVersion }
}

function highest(versions: string[]): string | undefined {
	let best: string | undefined
	let bestParsed: ReturnType<typeof rangeFloor> = null

	for (const version of versions) {
		const parsed = rangeFloor(version)

		if (!parsed) continue
		if (!bestParsed || compareVersions(parsed, bestParsed) > 0) {
			best = version
			bestParsed = parsed
		}
	}

	return best
}

export function describeShipped(conflict: SingletonConflict): string {
	return [...conflict.shipped.entries()]
		.map(([version, apps]) => `${version} (${apps.join(', ')})`)
		.join('; ')
}
