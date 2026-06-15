/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	findWorkspaceRoot,
	loadWorkspace,
	requireWorkspace,
	saveManifest,
} from '../core/workspace.js'
import { freshDir, removeDir, makeManifest, makeWorkspace, host, remote } from './helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

beforeEach(() => {
	root = freshDir('spool-ws-')
})

afterEach(() => {
	removeDir(root)
})

function seedManifest() {
	const manifest = makeManifest({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
	writeFileSync(join(root, 'spool.json'), JSON.stringify(manifest, null, 2))
	return manifest
}

/*
 *   FIND WORKSPACE ROOT
 ***************************************************************************************************/
describe('findWorkspaceRoot', () => {
	it('finds the nearest spool.json walking up from a nested folder', () => {
		seedManifest()
		const nested = join(root, 'apps', 'shell', 'src')
		mkdirSync(nested, { recursive: true })
		expect(findWorkspaceRoot(nested)).toBe(root)
	})

	it('returns null when there is no workspace', () => {
		expect(findWorkspaceRoot(root)).toBeNull()
	})
})

/*
 *   LOAD WORKSPACE
 ***************************************************************************************************/
describe('loadWorkspace', () => {
	it('loads the manifest and root', async () => {
		const manifest = seedManifest()
		const ws = await loadWorkspace(root)
		expect(ws?.root).toBe(root)
		expect(ws?.manifest).toEqual(manifest)
	})

	it('returns null when there is no workspace', async () => {
		expect(await loadWorkspace(root)).toBeNull()
	})
})

/*
 *   REQUIRE WORKSPACE
 ***************************************************************************************************/
describe('requireWorkspace', () => {
	it('throws a guiding error when there is no workspace', async () => {
		await expect(requireWorkspace(root)).rejects.toThrow('spool create')
	})
})

/*
 *   SAVE MANIFEST
 ***************************************************************************************************/
describe('saveManifest', () => {
	it('writes the manifest so it can be loaded back', async () => {
		const ws = makeWorkspace(root, { shell: host() })
		ws.manifest.apps.added = remote({ path: 'apps/added', port: 5199 })
		await saveManifest(ws)

		const reloaded = await loadWorkspace(root)
		expect(reloaded?.manifest.apps.added?.port).toBe(5199)
	})
})
