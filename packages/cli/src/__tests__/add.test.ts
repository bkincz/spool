/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
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
		// The vite config reads spool.json at startup, so only the ambient
		// typings need regenerating on the host.
		expect(read('apps/shell/src/remotes.d.ts')).toContain('settings/App')
	})

	it('never rewrites the host vite config, which reads the manifest itself', async () => {
		const before = read('apps/shell/vite.config.ts')
		await add('settings', { install: false })
		expect(read('apps/shell/vite.config.ts')).toBe(before)
	})

	it('regenerates the shell remote registry when a remote joins', async () => {
		process.chdir(cwd)
		removeDir(dir)
		dir = freshDir('spool-add-')
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			addons: 'shell',
			install: false,
		})
		process.chdir(dir)

		await add('checkout', { install: false })
		expect(read('apps/shell/src/shell/remotes.ts')).toContain('checkout/App')
	})

	it('prints a mount hint for svelte and vue hosts, for both remote contracts', async () => {
		for (const fw of ['svelte', 'vue'] as const) {
			process.chdir(cwd)
			removeDir(dir)
			dir = freshDir('spool-add-')
			await create(dir, {
				name: 'acme',
				pm: 'pnpm',
				host: `shell:${fw}`,
				remotes: '',
				install: false,
			})
			process.chdir(dir)

			await add('rreact', { install: false, framework: 'react' })
			await add('rsvelte', { install: false, framework: 'svelte' })
			expect(existsSync(join(dir, 'apps/rreact'))).toBe(true)
			expect(existsSync(join(dir, 'apps/rsvelte'))).toBe(true)
		}
	})

	it('gives a host the bridge runtime deps when a foreign-framework remote joins', async () => {
		process.chdir(cwd)
		removeDir(dir)
		dir = freshDir('spool-add-')
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell:svelte',
			remotes: '',
			install: false,
		})
		process.chdir(dir)

		await add('widget', { framework: 'react', install: false })
		const hostPkg = JSON.parse(read('apps/shell/package.json'))
		expect(hostPkg.dependencies.react).toBeDefined()
		expect(hostPkg.devDependencies['@types/react']).toBeDefined()
	})

	it('restores a missing runtime helper and warns about pre-helper apps', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		rmSync(join(dir, 'spool.vite.ts'))
		await add('settings', { install: false })
		expect(existsSync(join(dir, 'spool.vite.ts'))).toBe(true)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('restored'))
	})

	it('leaves an existing runtime helper untouched and quiet', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		await add('settings', { install: false })
		expect(warn).not.toHaveBeenCalled()
	})

	it('adds a svelte remote with the mount contract wired end to end', async () => {
		await add('widget', { framework: 'svelte', install: false })

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.apps.widget.framework).toBe('svelte')
		expect(manifest.apps.widget.exposes).toEqual({ './App': './src/mount.ts' })
		expect(read('apps/widget/src/mount.ts')).toContain('mountApp')
		expect(read('apps/widget/vite.config.ts')).toContain('@sveltejs/vite-plugin-svelte')
		expect(read('apps/shell/src/remotes.d.ts')).toContain(
			'const mount: (target: HTMLElement) => () => void'
		)
	})

	it('shares the new framework runtime so its apps stay singletons', async () => {
		await add('widget', { framework: 'svelte', install: false })
		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.shared).toContain('svelte')
		expect(manifest.shared).toContain('react')
	})

	it('hints the MountRemote wrapper for a mount-contract remote in a react host', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})
		await add('widget', { framework: 'svelte', install: false })
		expect(step).toHaveBeenCalledWith(expect.stringContaining('apps/shell/src/App.tsx'))
		expect(plain).toHaveBeenCalledWith(expect.stringContaining('function MountRemote'))
	})

	it('writes the react bridge when a react remote joins a svelte host', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})
		await add('panel', { type: 'host', framework: 'svelte', install: false })
		await add('billing', { host: 'panel', install: false })

		expect(read('apps/panel/src/react-bridge.ts')).toContain('mountReact')
		expect(step).toHaveBeenCalledWith(expect.stringContaining('apps/panel/src/App.svelte'))
	})

	it('rejects an unknown framework', async () => {
		await expect(add('widget', { framework: 'angular', install: false })).rejects.toThrow(
			'Unknown framework'
		)
	})

	it('warns that --host is ignored when adding a host', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		await add('admin', { type: 'host', host: 'shell', install: false })
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('--host only applies'))
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
		await expect(add('dashboard', { install: false })).rejects.toThrow('already exists')
	})

	it('rejects an unknown type', async () => {
		await expect(add('widgetapp', { type: 'widget', install: false })).rejects.toThrow(
			'Unknown app type'
		)
	})

	it('rejects an invalid app name', async () => {
		await expect(add('Bad Name', { install: false })).rejects.toThrow('Invalid app name')
	})

	it('rejects a non-numeric port', async () => {
		await expect(add('reports', { port: 'abc', install: false })).rejects.toThrow(
			'Invalid port'
		)
	})

	it('rejects a port already in use', async () => {
		await expect(add('reports', { port: '5173', install: false })).rejects.toThrow(
			'already used by'
		)
	})
})
