/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../commands/create.js'
import { add } from '../commands/add.js'
import { run } from '../util/exec.js'
import { log } from '../util/logger.js'
import { freshDir, removeDir } from './helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

beforeEach(async () => {
	dir = freshDir('spool-add-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => {})
	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard',
		install: false,
	})
	process.chdir(dir)
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)
	vi.restoreAllMocks()
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

/*
 *   ADD
 ***************************************************************************************************/
describe('add', () => {
	it('adds a remote and wires it into the host', async () => {
		await add('settings', { install: false })

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.apps.settings).toMatchObject({ type: 'remote', port: 5175 })
		expect(manifest.apps.shell.remotes).toContain('settings')
		expect(existsSync(join(dir, 'apps/settings/vite.config.ts'))).toBe(true)
		expect(read('apps/shell/vite.config.ts')).toContain('settings')
	})

	it('prints exact instructions for mounting the new remote', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})
		await add('settings', { install: false })
		expect(step).toHaveBeenCalledWith(expect.stringContaining('apps/shell/src/App.tsx'))
		expect(plain).toHaveBeenCalledWith(expect.stringContaining('import("settings/App")'))
		expect(plain).toHaveBeenCalledWith(expect.stringContaining('Settings'))
	})

	it('adds a host without wiring it as a remote', async () => {
		await add('admin', { type: 'host', install: false })

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.apps.admin.type).toBe('host')
		expect(manifest.apps.shell.remotes).not.toContain('admin')
	})

	it('picks the next free port by default', async () => {
		await add('one', { install: false })
		await add('two', { install: false })
		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.apps.one.port).toBe(5175)
		expect(manifest.apps.two.port).toBe(5176)
	})

	/*
	 *   INSTALL
	 ***************************************************************************************************/
	it('installs the new app so it is ready for dev', async () => {
		vi.mocked(run).mockResolvedValue(undefined)
		await add('settings', {})
		expect(run).toHaveBeenCalledWith('pnpm', ['install'], expect.objectContaining({ cwd: dir }))
	})

	it('warns but does not throw when the install fails', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		vi.mocked(run).mockRejectedValueOnce(new Error('offline'))
		await expect(add('settings', {})).resolves.toBeUndefined()
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Install failed'))
	})

	/*
	 *   FAILURES
	 ***************************************************************************************************/
	it('rejects a duplicate name', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(add('dashboard', { install: false })).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('already exists'))
	})

	it('rejects an unknown type', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(add('widgetapp', { type: 'widget', install: false })).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown app type'))
	})

	it('rejects an invalid app name', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(add('Bad Name', { install: false })).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid app name'))
	})

	it('rejects a non-numeric port', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(add('reports', { port: 'abc', install: false })).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid port'))
	})

	it('rejects a port already in use', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(add('reports', { port: '5173', install: false })).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('already used by'))
	})
})
