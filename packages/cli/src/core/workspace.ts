/*
 *   IMPORTS
 ***************************************************************************************************/
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { MANIFEST_FILE, parseManifest, type Manifest } from './config.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface Workspace {
	/** Absolute path to the workspace root (dir containing spool.json). */
	root: string
	manifestPath: string
	manifest: Manifest
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
	return { root, manifestPath, manifest: parseManifest(raw) }
}

export async function requireWorkspace(cwd = process.cwd()): Promise<Workspace> {
	const ws = await loadWorkspace(cwd)
	if (!ws) {
		throw new Error(
			`No ${MANIFEST_FILE} found. Run \`spool create\` first, or cd into a spool workspace.`
		)
	}
	return ws
}

export async function saveManifest(ws: Workspace): Promise<void> {
	await writeFile(ws.manifestPath, `${JSON.stringify(ws.manifest, null, 2)}\n`, 'utf8')
}
