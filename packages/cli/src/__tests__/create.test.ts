/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../commands/create.js'
import { log } from '../util/logger.js'
import { freshDir, removeDir } from './helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string

beforeEach(() => {
	dir = freshDir('spool-create-')
	vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
	removeDir(dir)
	vi.restoreAllMocks()
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

/*
 *   CREATE
 ***************************************************************************************************/
describe('create', () => {
	it('scaffolds a workspace with a host and remotes', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm', host: 'shell',
			remotes: 'dashboard, profile',
			install: false,
		})

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.name).toBe('acme')
		expect(manifest.apps.shell).toMatchObject({
			type: 'host',
			port: 5173,
			remotes: ['dashboard', 'profile'],
		})
		expect(manifest.apps.dashboard).toMatchObject({ type: 'remote', port: 5174 })
		expect(manifest.apps.profile).toMatchObject({ type: 'remote', port: 5175 })
	})

	it('writes each app and wires the host config', async () => {
		await create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: 'dashboard', install: false })

		expect(existsSync(join(dir, 'apps/shell/vite.config.ts'))).toBe(true)
		expect(existsSync(join(dir, 'apps/dashboard/vite.config.ts'))).toBe(true)
		expect(read('apps/shell/vite.config.ts')).toContain(
			'http://localhost:5174/mf-manifest.json'
		)
	})

	it('scaffolds an npm workspace when --pm npm is chosen', async () => {
		await create(dir, { name: 'acme', pm: 'npm', host: 'shell', remotes: '', install: false })

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.packageManager).toBe('npm')
		expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(false)
		expect(JSON.parse(read('package.json')).workspaces).toEqual(['apps/*', 'packages/*'])
	})

	it('rejects an unknown package manager', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(
			create(dir, { name: 'acme', pm: 'bun', host: 'shell', remotes: '', install: false })
		).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown package manager'))
	})

	it('ships the house prettier config into the workspace', async () => {
		await create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		expect(existsSync(join(dir, '.prettierrc'))).toBe(true)
	})

	it('rejects an invalid workspace name', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(
			create(dir, { name: 'Bad Name', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid workspace name'))
	})

	it('rejects a remote that collides with the host name', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('exit')
		}) as never)

		await expect(
			create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: 'shell', install: false })
		).rejects.toThrow()
		expect(error).toHaveBeenCalledWith(expect.stringContaining('unique'))
	})

	it('refuses to overwrite an existing workspace', async () => {
		const error = vi.spyOn(log, 'error').mockImplementation(() => {})
		await create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		await create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		expect(error).toHaveBeenCalledWith(expect.stringContaining('already a spool workspace'))
	})
})
