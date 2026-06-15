/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { create } from '../commands/create.js'
import { run } from '../util/exec.js'
import { freshDir, removeDir } from './helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('@clack/prompts', () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn(() => false),
	text: vi.fn(),
	select: vi.fn().mockResolvedValue('pnpm'),
	spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

vi.mock('../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

beforeEach(() => {
	dir = freshDir('spool-prompt-')
	cwd = process.cwd()
	process.chdir(dir)
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)
	vi.clearAllMocks()
	vi.restoreAllMocks()
})

/*
 *   PROMPTS
 ***************************************************************************************************/
describe('create (interactive)', () => {
	it('asks for the names when no options are given', async () => {
		vi.mocked(p.text)
			.mockResolvedValueOnce('myapp')
			.mockResolvedValueOnce('host1')
			.mockResolvedValueOnce('one, two')

		await create(undefined, { here: true })

		expect(p.text).toHaveBeenCalledTimes(3)
		const manifest = JSON.parse(
			(await import('node:fs')).readFileSync(join(dir, 'spool.json'), 'utf8')
		)
		expect(manifest.name).toBe('myapp')
		expect(Object.keys(manifest.apps).sort()).toEqual(['host1', 'one', 'two'])
	})

	it('aborts without writing anything when a prompt is cancelled', async () => {
		vi.mocked(p.isCancel).mockReturnValueOnce(true)
		vi.mocked(p.text).mockResolvedValueOnce('whatever')

		await create(undefined, { here: true })

		expect(existsSync(join(dir, 'spool.json'))).toBe(false)
		expect(p.cancel).toHaveBeenCalled()
	})
})

/*
 *   INSTALL
 ***************************************************************************************************/
describe('create (install)', () => {
	it('installs dependencies by default', async () => {
		await create(undefined, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: 'dashboard', here: true })
		expect(run).toHaveBeenCalledWith('pnpm', ['install'], expect.objectContaining({ cwd: dir }))
	})

	it('survives a failed install without throwing', async () => {
		vi.mocked(run).mockRejectedValueOnce(new Error('offline'))
		await expect(
			create(undefined, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', here: true })
		).resolves.toBeUndefined()
	})
})
