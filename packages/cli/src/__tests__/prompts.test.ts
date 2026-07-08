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
	select: vi.fn((opts: { message: string }) =>
		Promise.resolve(opts.message.startsWith('Framework') ? 'react' : 'pnpm')
	),
	multiselect: vi.fn(() => Promise.resolve([])),
	spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

vi.mock('../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string
let stdinTTY: boolean | undefined

beforeEach(() => {
	dir = freshDir('spool-prompt-')
	cwd = process.cwd()
	process.chdir(dir)
	// Prompts only fire on a TTY; vitest's stdin is not one.
	stdinTTY = process.stdin.isTTY
	process.stdin.isTTY = true
})

afterEach(() => {
	process.stdin.isTTY = stdinTTY as boolean
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

	it('asks a framework per app and records each choice', async () => {
		vi.mocked(p.text)
			.mockResolvedValueOnce('myapp')
			.mockResolvedValueOnce('host1')
			.mockResolvedValueOnce('one, two')
		vi.mocked(p.select)
			.mockResolvedValueOnce('vue') // host1
			.mockResolvedValueOnce('svelte') // one
			.mockResolvedValueOnce('react') // two
			.mockResolvedValueOnce('pnpm') // package manager

		await create(undefined, { here: true })

		const manifest = JSON.parse(
			(await import('node:fs')).readFileSync(join(dir, 'spool.json'), 'utf8')
		)
		expect(manifest.apps.host1.framework).toBe('vue')
		expect(manifest.apps.one.framework).toBe('svelte')
		expect(manifest.apps.two.framework).toBe('react')
	})

	it('asks the host framework even when --host is a flag, if the session prompts', async () => {
		vi.mocked(p.text).mockResolvedValueOnce('myapp').mockResolvedValueOnce('one')
		vi.mocked(p.select)
			.mockResolvedValueOnce('svelte') // shell (name given via --host)
			.mockResolvedValueOnce('vue') // one
			.mockResolvedValueOnce('pnpm') // package manager

		await create(undefined, { here: true, host: 'shell' })

		const manifest = JSON.parse(
			(await import('node:fs')).readFileSync(join(dir, 'spool.json'), 'utf8')
		)
		expect(manifest.apps.shell.framework).toBe('svelte')
		expect(manifest.apps.one.framework).toBe('vue')
	})

	it('skips the framework prompts when --framework is given', async () => {
		vi.mocked(p.text)
			.mockResolvedValueOnce('myapp')
			.mockResolvedValueOnce('host1')
			.mockResolvedValueOnce('one')

		await create(undefined, { here: true, framework: 'svelte' })

		const frameworkPrompts = vi
			.mocked(p.select)
			.mock.calls.filter(([opts]) =>
				(opts as { message: string }).message.startsWith('Framework')
			)
		expect(frameworkPrompts).toHaveLength(0)
		const manifest = JSON.parse(
			(await import('node:fs')).readFileSync(join(dir, 'spool.json'), 'utf8')
		)
		expect(manifest.apps.host1.framework).toBe('svelte')
		expect(manifest.apps.one.framework).toBe('svelte')
	})

	it('scaffolds the extras picked in the addons prompt', async () => {
		vi.mocked(p.text)
			.mockResolvedValueOnce('myapp')
			.mockResolvedValueOnce('host1')
			.mockResolvedValueOnce('one')
		vi.mocked(p.multiselect).mockResolvedValueOnce(['ladle', 'playwright'])

		await create(undefined, { here: true })

		expect(existsSync(join(dir, 'packages/ui/src/Button.stories.tsx'))).toBe(true)
		expect(existsSync(join(dir, 'packages/e2e/playwright.config.ts'))).toBe(true)
	})

	it('asks for addons even in fully flag-driven runs', async () => {
		await create(undefined, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			here: true,
		})

		expect(p.multiselect).toHaveBeenCalled()
		expect(existsSync(join(dir, 'packages'))).toBe(false)
	})

	it('skips the addons prompt without a TTY, where it could never resolve', async () => {
		process.stdin.isTTY = false as never

		await create(undefined, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			here: true,
		})

		expect(p.multiselect).not.toHaveBeenCalled()
		expect(existsSync(join(dir, 'spool.json'))).toBe(true)
	})

	it('skips the addons prompt when --addons is passed', async () => {
		await create(undefined, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			addons: 'none',
			here: true,
		})

		expect(p.multiselect).not.toHaveBeenCalled()
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
		await create(undefined, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			here: true,
		})
		expect(run).toHaveBeenCalledWith('pnpm', ['install'], expect.objectContaining({ cwd: dir }))
	})

	it('survives a failed install without throwing', async () => {
		vi.mocked(run).mockRejectedValueOnce(new Error('offline'))
		await expect(
			create(undefined, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', here: true })
		).resolves.toBeUndefined()
	})
})
