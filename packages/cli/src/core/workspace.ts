/*
 *   IMPORTS
 ***************************************************************************************************/
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
	DEFAULT_FRAMEWORK,
	MANIFEST_FILE,
	MANIFEST_VERSION,
	parseManifest,
	type AppConfig,
	type Manifest,
} from './config.js'
import { formatFile } from './format.js'
import { CliError } from '../util/errors.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface Workspace {
	/** Absolute path to the workspace root (dir containing spool.json). */
	root: string
	manifestPath: string
	manifest: Manifest
	/** spool.json as last read from disk, before schema defaults were applied.
	 * saveManifest diffs against this so an unrelated edit never reorders keys
	 * or writes back defaults the user never asked for. */
	raw: unknown
}

/*
 *   WORKSPACE
 ***************************************************************************************************/
export function findWorkspaceRoot(cwd = process.cwd()): string | null {
	let dir = resolve(cwd)

	while (true) {
		if (existsSync(join(dir, MANIFEST_FILE))) return dir
		const parent = dirname(dir)
		if (parent === dir) return null
		dir = parent
	}
}

export async function loadWorkspace(cwd = process.cwd()): Promise<Workspace | null> {
	const root = findWorkspaceRoot(cwd)
	if (!root) return null
	const manifestPath = join(root, MANIFEST_FILE)
	const raw = JSON.parse(await readFile(manifestPath, 'utf8'))
	return { root, manifestPath, manifest: parseManifest(raw), raw }
}

export async function requireWorkspace(cwd = process.cwd()): Promise<Workspace> {
	const ws = await loadWorkspace(cwd)
	if (!ws) {
		throw new CliError(
			`No ${MANIFEST_FILE} found. Run \`spool create\` first, or cd into a spool workspace.`
		)
	}
	return ws
}

export async function saveManifest(ws: Workspace): Promise<void> {
	const payload = manifestForWrite(ws.manifest, ws.raw)
	// Same formatter as the scaffold path, so `spool add` rewrites never
	// churn the manifest's style.
	const content = await formatFile(MANIFEST_FILE, JSON.stringify(payload))
	await writeFile(ws.manifestPath, content, 'utf8')
	ws.raw = payload
}

/*
 *   RAW-PRESERVING SERIALIZATION
 ***************************************************************************************************/
const MANIFEST_DEFAULTS: Partial<Record<keyof Manifest, unknown>> = {
	version: MANIFEST_VERSION,
	packageManager: 'pnpm',
	bundler: 'vite',
	shared: ['react', 'react-dom'],
	shareStrategy: 'loaded-first',
	addons: [],
	overrides: false,
}

const MANIFEST_FIELD_ORDER: (keyof Manifest)[] = [
	'name',
	'version',
	'packageManager',
	'bundler',
	'shared',
	'shareStrategy',
	'server',
	'addons',
	'apps',
	'overrides',
]

const APP_DEFAULTS: Partial<Record<keyof AppConfig, unknown>> = {
	framework: DEFAULT_FRAMEWORK,
	remotes: [],
	exposes: {},
}

const APP_FIELD_ORDER: (keyof AppConfig)[] = [
	'type',
	'framework',
	'path',
	'port',
	'url',
	'urls',
	'deploy',
	'remotes',
	'exposes',
	'headers',
	'frameAncestors',
]

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Raw's own keys first (its original order), then anything new, in `fallback` order. */
function orderedKeys(raw: Record<string, unknown>, fallback: string[]): string[] {
	const known = new Set(Object.keys(raw))
	return [...Object.keys(raw), ...fallback.filter(key => !known.has(key))]
}

function deepEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

export function manifestForWrite(manifest: Manifest, raw: unknown): unknown {
	const rawObj = isRecord(raw) ? raw : {}
	const out: Record<string, unknown> = {}

	for (const key of orderedKeys(rawObj, MANIFEST_FIELD_ORDER)) {
		if (key === 'apps') {
			out.apps = appsForWrite(manifest.apps, rawObj.apps)
			continue
		}

		const value = (manifest as unknown as Record<string, unknown>)[key]
		if (value === undefined) continue
		if (
			key in MANIFEST_DEFAULTS &&
			!(key in rawObj) &&
			deepEqual(value, MANIFEST_DEFAULTS[key as keyof Manifest])
		) {
			continue
		}
		out[key] = value
	}

	return out
}

function appsForWrite(apps: Manifest['apps'], rawApps: unknown): Record<string, unknown> {
	const rawObj = isRecord(rawApps) ? rawApps : {}
	const out: Record<string, unknown> = {}

	for (const name of orderedKeys(rawObj, Object.keys(apps))) {
		const app = apps[name]
		if (!app) continue
		out[name] = appForWrite(app, rawObj[name])
	}

	return out
}

function appForWrite(app: AppConfig, rawApp: unknown): Record<string, unknown> {
	const rawObj = isRecord(rawApp) ? rawApp : {}
	const out: Record<string, unknown> = {}

	for (const key of orderedKeys(rawObj, APP_FIELD_ORDER)) {
		const value = (app as unknown as Record<string, unknown>)[key]
		if (value === undefined) continue
		if (
			key in APP_DEFAULTS &&
			!(key in rawObj) &&
			deepEqual(value, APP_DEFAULTS[key as keyof AppConfig])
		) {
			continue
		}
		out[key] = value
	}

	return out
}
