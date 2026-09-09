/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { satisfies } from '../util/semver.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface DeployRecord {
	sha: string
	url: string
	at: string
	shared: Record<string, string>
}

export type DeployStore = Record<string, Record<string, DeployRecord[]>>

export interface SharedEntry {
	name: string
	/** The version installed at build time, not the range asked for. */
	version: string
	requiredVersion?: string
}

export interface SharedConflict {
	dep: string
	otherApp: string
	otherVersion: string
	requiredVersion: string
}

const HISTORY_CAP = 10

/*
 *   PATH
 ***************************************************************************************************/
function storePath(ws: Workspace): string {
	return join(ws.root, '.spool', 'deploys.json')
}

/*
 *   READ / WRITE
 ***************************************************************************************************/
export function readDeployStore(ws: Workspace): DeployStore {
	const target = storePath(ws)
	if (!existsSync(target)) return {}

	try {
		return JSON.parse(readFileSync(target, 'utf8')) as DeployStore
	} catch {
		return {}
	}
}

function writeDeployStore(ws: Workspace, store: DeployStore): void {
	mkdirSync(join(ws.root, '.spool'), { recursive: true })
	writeFileSync(storePath(ws), `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

export function deployHistory(store: DeployStore, env: string, appName: string): DeployRecord[] {
	return store[env]?.[appName] ?? []
}

/** Prepends the new record so index 0 is always the current deploy for that env. */
export function recordDeploy(
	ws: Workspace,
	env: string,
	appName: string,
	record: DeployRecord
): void {
	const store = readDeployStore(ws)
	const forEnv = (store[env] ??= {})

	forEnv[appName] = [record, ...(forEnv[appName] ?? [])].slice(0, HISTORY_CAP)
	writeDeployStore(ws, store)
}

/*
 *   BUILT MANIFEST
 ***************************************************************************************************/
export function readBuiltSharedEntries(root: string, appPath: string): SharedEntry[] {
	const target = join(root, appPath, 'dist', 'mf-manifest.json')
	if (!existsSync(target)) return []

	try {
		const parsed = JSON.parse(readFileSync(target, 'utf8')) as { shared?: SharedEntry[] }
		return parsed.shared ?? []
	} catch {
		return []
	}
}

/*
 *   COMPATIBILITY GATE
 ***************************************************************************************************/
export function sharedConflicts(
	store: DeployStore,
	env: string,
	appName: string,
	entries: SharedEntry[]
): SharedConflict[] {
	const others = store[env] ?? {}
	const conflicts: SharedConflict[] = []

	for (const entry of entries) {
		if (!entry.requiredVersion) continue

		for (const [otherApp, history] of Object.entries(others)) {
			if (otherApp === appName) continue

			const otherVersion = history[0]?.shared[entry.name]
			if (!otherVersion) continue

			if (satisfies(otherVersion, entry.requiredVersion) === false) {
				conflicts.push({
					dep: entry.name,
					otherApp,
					otherVersion,
					requiredVersion: entry.requiredVersion,
				})
			}
		}
	}

	return conflicts
}
