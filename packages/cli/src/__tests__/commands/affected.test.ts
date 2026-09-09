/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../../commands/create.js'
import { affected, affectedApps } from '../../commands/affected.js'
import { requireWorkspace } from '../../core/workspace.js'
import { log } from '../../util/logger.js'
import { runCaptured } from '../../util/exec.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../util/exec.js', () => ({ runCaptured: vi.fn() }))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

beforeEach(async () => {
	dir = freshDir('spool-affected-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => {})
	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard',
		install: false,
	})

	mkdirSync(join(dir, 'packages/ui'), { recursive: true })
	writeFileSync(
		join(dir, 'packages/ui/package.json'),
		JSON.stringify({ name: 'ui', version: '0.0.0' })
	)

	const shellPkgPath = join(dir, 'apps/shell/package.json')
	const shellPkg = JSON.parse(readFileSync(shellPkgPath, 'utf8'))
	shellPkg.dependencies.ui = 'workspace:*'
	writeFileSync(shellPkgPath, JSON.stringify(shellPkg))

	process.chdir(dir)
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)
	vi.restoreAllMocks()
})

function mockDiff(files: string[]): void {
	vi.mocked(runCaptured).mockResolvedValue({ code: 0, output: files.join('\n') })
}

/*
 *   MAPPING
 ***************************************************************************************************/
describe('affectedApps', () => {
	it('flags an app whose own path changed', async () => {
		const ws = await requireWorkspace()
		expect(affectedApps(ws, ['apps/dashboard/src/app/app.tsx'])).toEqual(['dashboard'])
	})

	it('flags an app that imports a changed workspace package', async () => {
		const ws = await requireWorkspace()
		expect(affectedApps(ws, ['packages/ui/src/button.tsx'])).toEqual(['shell'])
	})

	it('flags every app when a workspace-level file changed', async () => {
		const ws = await requireWorkspace()
		expect(affectedApps(ws, ['spool.json'])).toEqual(['dashboard', 'shell'])
	})

	it('flags nothing for a change under an unrelated app or package', async () => {
		const ws = await requireWorkspace()
		expect(affectedApps(ws, ['apps/shell/src/app/app.tsx'])).toEqual(['shell'])
	})
})

/*
 *   COMMAND
 ***************************************************************************************************/
describe('affected', () => {
	it('prints the affected apps from a git diff against the given ref', async () => {
		mockDiff(['apps/dashboard/src/app/app.tsx'])
		const info = vi.spyOn(log, 'info').mockImplementation(() => {})
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})

		await affected({ since: 'main' })

		expect(runCaptured).toHaveBeenCalledWith('git', ['diff', '--name-only', 'main'], {
			cwd: dir,
		})
		expect(info).toHaveBeenCalledWith(expect.stringContaining('main'))
		expect(plain).toHaveBeenCalledWith(expect.stringContaining('dashboard'))
	})

	it('reports nothing affected as a success, not a warning', async () => {
		mockDiff([])
		const success = vi.spyOn(log, 'success').mockImplementation(() => {})

		await affected({ since: 'main' })

		expect(success).toHaveBeenCalledWith(expect.stringContaining('no apps affected'))
	})

	it('--json prints the changed files and affected apps together', async () => {
		mockDiff(['spool.json'])
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})

		await affected({ since: 'main', json: true })

		const data = JSON.parse(String(plain.mock.calls[0]![0])) as {
			since: string
			changed: string[]
			apps: string[]
		}
		expect(data.since).toBe('main')
		expect(data.changed).toEqual(['spool.json'])
		expect(data.apps.sort()).toEqual(['dashboard', 'shell'])
	})

	it('fails with a clear message when git itself fails', async () => {
		vi.mocked(runCaptured).mockResolvedValue({ code: 128, output: 'unknown revision' })

		await expect(affected({ since: 'ghost' })).rejects.toThrow('unknown revision')
	})

	it('requires --since', async () => {
		await expect(affected({})).rejects.toThrow('--since')
	})
})
