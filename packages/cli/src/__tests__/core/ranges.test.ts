/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRanges } from '../../core/ranges.js'
import { freshDir, removeDir, host, remote, makeWorkspace } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

beforeEach(() => {
	root = freshDir('spool-ranges-')
})

afterEach(() => {
	removeDir(root)
})

function writeApp(path: string, deps: Record<string, string>): void {
	mkdirSync(join(root, path), { recursive: true })
	writeFileSync(join(root, path, 'package.json'), JSON.stringify({ dependencies: deps }))
}

/*
 *   LOCAL OVERRIDES
 ***************************************************************************************************/
describe('resolveRanges: local overrides', () => {
	it('never resolves a lone file: override as the target for a shared dep', () => {
		writeApp('apps/shell', { mylib: 'file:../mylib' })
		const ws = makeWorkspace(root, { shell: host() })
		ws.manifest.shared = ['mylib']

		expect(resolveRanges(ws).get('mylib')).toBeUndefined()
	})

	it('resolves a lone workspace: link as the target once every declarer agrees', () => {
		writeApp('apps/shell', { mylib: 'workspace:*' })
		const ws = makeWorkspace(root, { shell: host() })
		ws.manifest.shared = ['mylib']

		expect(resolveRanges(ws).get('mylib')?.target).toBe('workspace:*')
	})

	it('reports no target when declared ranges genuinely disagree', () => {
		writeApp('apps/shell', { mylib: 'workspace:*' })
		writeApp('apps/dashboard', { mylib: 'link:../mylib' })
		const ws = makeWorkspace(root, {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote({ path: 'apps/dashboard', port: 5174 }),
		})
		ws.manifest.shared = ['mylib']

		expect(resolveRanges(ws).get('mylib')).toBeUndefined()
	})
})
