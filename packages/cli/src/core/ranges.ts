/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { readPackageJson, type PackageJsonDeps } from './packages.js'
import { appDependencies, rootDevDependencies } from './versions.js'
import { packageName } from '../util/names.js'
import { maxRange } from '../util/semver.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface RangeInfo {
	/** What every package.json in the workspace should carry for this dep. */
	target: string
	/** Range -> the packages already on it. */
	sources: Map<string, string[]>
}

export const ROOT_LABEL = 'workspace'

/*
 *   RESOLVE
 ***************************************************************************************************/
export function resolveRanges(ws: Workspace): Map<string, RangeInfo> {
	const ours = spoolRanges(ws)
	const managed = new Set([...ours.keys(), ...ws.manifest.shared.map(packageName)])
	const found = collectSources(ws, managed)

	const resolved = new Map<string, RangeInfo>()

	for (const dep of managed) {
		const sources = found.get(dep) ?? new Map<string, string[]>()
		const pin = ours.get(dep)
		const target =
			maxRange(pin ? [pin, ...sources.keys()] : [...sources.keys()]) ?? unanimous(sources)

		if (target) resolved.set(dep, { target, sources })
	}

	return resolved
}

function unanimous(sources: Map<string, string[]>): string | undefined {
	if (sources.size !== 1) return undefined

	return [...sources.keys()][0]
}

function spoolRanges(ws: Workspace): Map<string, string> {
	const ours = new Map<string, string>()
	const put = (deps: Record<string, string>): void => {
		for (const [dep, range] of Object.entries(deps)) {
			const current = ours.get(dep)
			ours.set(dep, current === undefined ? range : (maxRange([current, range]) ?? range))
		}
	}

	put(rootDevDependencies())
	for (const app of Object.values(ws.manifest.apps)) {
		const { dependencies, devDependencies } = appDependencies(ws.manifest, app)
		put(dependencies)
		put(devDependencies)
	}

	return ours
}

function collectSources(ws: Workspace, managed: Set<string>): Map<string, Map<string, string[]>> {
	const sources = new Map<string, Map<string, string[]>>()
	const record = (label: string, pkg: PackageJsonDeps): void => {
		for (const [dep, range] of Object.entries({
			...pkg.dependencies,
			...pkg.devDependencies,
		})) {
			if (!managed.has(dep)) continue
			const byRange = sources.get(dep) ?? new Map<string, string[]>()
			byRange.set(range, [...(byRange.get(range) ?? []), label])
			sources.set(dep, byRange)
		}
	}

	const root = readPackageJson(join(ws.root, 'package.json'))
	if (typeof root !== 'string') record(ROOT_LABEL, root)

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const pkg = readPackageJson(join(ws.root, app.path, 'package.json'))
		if (typeof pkg !== 'string') record(name, pkg)
	}

	return sources
}
