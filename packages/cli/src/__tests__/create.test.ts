/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../commands/create.js'
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
			pm: 'pnpm',
			host: 'shell',
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

	it('writes each app plus the runtime helper the configs read from', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			install: false,
		})

		expect(existsSync(join(dir, 'spool.vite.ts'))).toBe(true)
		expect(existsSync(join(dir, 'apps/shell/vite.config.ts'))).toBe(true)
		expect(existsSync(join(dir, 'apps/dashboard/vite.config.ts'))).toBe(true)
		// Wiring is resolved at startup from spool.json, never baked in.
		expect(read('apps/shell/vite.config.ts')).toContain("spoolApp('shell'")
		expect(read('apps/shell/vite.config.ts')).not.toContain('localhost')
	})

	it('writes files already formatted to the shipped prettier config', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard',
			install: false,
		})

		// House style: tabs, single quotes, no trailing semicolons.
		const viteConfig = read('apps/shell/vite.config.ts')
		expect(viteConfig).toContain("import { defineConfig } from 'vite'")
		expect(viteConfig).not.toMatch(/;\r?\n/)
		expect(read('spool.vite.ts')).toContain('\t')
		expect(read('spool.json')).toContain('\t')
	})

	it('scaffolds per-app frameworks from name:framework specs', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell:svelte',
			remotes: 'dashboard:vue, profile',
			install: false,
		})

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.apps.shell.framework).toBe('svelte')
		expect(manifest.apps.dashboard.framework).toBe('vue')
		// Remotes without an explicit framework follow the host.
		expect(manifest.apps.profile.framework).toBe('svelte')
		expect(manifest.shared).toEqual(expect.arrayContaining(['svelte', 'vue']))
		expect(new Set(manifest.shared).size).toBe(manifest.shared.length)
		expect(existsSync(join(dir, 'apps/shell/src/App.svelte'))).toBe(true)
		expect(existsSync(join(dir, 'apps/dashboard/src/App.vue'))).toBe(true)
	})

	it('uses --framework as the default for apps without a spec', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard:react',
			framework: 'vue',
			install: false,
		})

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.apps.shell.framework).toBe('vue')
		expect(manifest.apps.dashboard.framework).toBe('react')
	})

	it('rejects an unknown framework in a spec', async () => {
		await expect(
			create(dir, {
				name: 'acme',
				pm: 'pnpm',
				host: 'shell:angular',
				remotes: '',
				install: false,
			})
		).rejects.toThrow('Unknown framework')
	})

	it('scaffolds the requested addons', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard, profile',
			addons: 'ladle, playwright',
			install: false,
		})

		expect(
			JSON.parse(read('packages/ui/package.json')).devDependencies['@ladle/react']
		).toBeDefined()
		expect(existsSync(join(dir, 'packages/ui/src/Button.stories.tsx'))).toBe(true)

		const spec = read('packages/e2e/tests/shell.spec.ts')
		expect(spec).toContain('shell (host)')
		expect(spec).toContain("name: 'dashboard'")
		expect(spec).toContain("name: 'profile'")
		expect(spec).toContain('toHaveCount(2)')
		expect(read('packages/e2e/playwright.config.ts')).toContain('http://localhost:5173')
		expect(read('packages/e2e/playwright.config.ts')).toContain('pnpm run dev')

		expect(read('pnpm-workspace.yaml')).toContain("'@swc/core': true")
		expect(read('pnpm-workspace.yaml')).toContain("- '@swc/core'")
	})

	it('wires the shared-state addon through spool.json and every app', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard, widget:svelte',
			addons: 'state',
			install: false,
		})

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.shared).toContain('@bkincz/clutch')
		expect(manifest.shared).toContain('@bkincz/clutch/react')

		for (const app of ['shell', 'dashboard', 'widget']) {
			const pkg = JSON.parse(read(`apps/${app}/package.json`))
			expect(pkg.dependencies['@bkincz/clutch']).toBeDefined()
			expect(read(`apps/${app}/src/state/counter.ts`)).toContain("'acme:counter'")
		}
	})

	it('shares only the clutch core when no app is react', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell:vue',
			remotes: 'widget:svelte',
			addons: 'state',
			install: false,
		})

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.shared).toContain('@bkincz/clutch')
		expect(manifest.shared).not.toContain('@bkincz/clutch/react')
	})

	it('scaffolds the shared-counter example when state is picked at create', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dash, widget:svelte',
			addons: 'ladle, playwright, state',
			install: false,
		})

		expect(read('apps/shell/src/App.tsx')).toContain('shell-count')
		const dash = read('apps/dash/src/App.tsx')
		expect(dash).toContain("import { Button } from 'ui'")
		expect(dash).toContain('<Button onClick={increment}>Increment</Button>')
		expect(JSON.parse(read('apps/dash/package.json')).dependencies.ui).toBe('workspace:*')
		expect(read('apps/widget/src/App.svelte')).toContain('counterMachine.mutate')
		expect(read('packages/e2e/tests/shell.spec.ts')).toContain('shared state')
	})

	it('falls back to a plain button when ladle is not picked', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dash',
			addons: 'state',
			install: false,
		})

		const dash = read('apps/dash/src/App.tsx')
		expect(dash).toContain('<button onClick={increment}>Increment</button>')
		expect(dash).not.toContain("from 'ui'")
		expect(JSON.parse(read('apps/dash/package.json')).dependencies.ui).toBeUndefined()
	})

	it('rejects an unknown addon', async () => {
		await expect(
			create(dir, {
				name: 'acme',
				pm: 'pnpm',
				host: 'shell',
				remotes: '',
				addons: 'storybook',
				install: false,
			})
		).rejects.toThrow('Unknown addon')
	})

	it('rejects ladle in a workspace with no react app', async () => {
		await expect(
			create(dir, {
				name: 'acme',
				pm: 'pnpm',
				host: 'shell:svelte',
				remotes: '',
				addons: 'ladle',
				install: false,
			})
		).rejects.toThrow('react-based')
	})

	it('treats --addons none as no addons', async () => {
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: '',
			addons: 'none',
			install: false,
		})
		expect(existsSync(join(dir, 'packages'))).toBe(false)
	})

	it('scaffolds an npm workspace when --pm npm is chosen', async () => {
		await create(dir, { name: 'acme', pm: 'npm', host: 'shell', remotes: '', install: false })

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.packageManager).toBe('npm')
		expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(false)
		expect(JSON.parse(read('package.json')).workspaces).toEqual(['apps/*', 'packages/*'])
	})

	it('rejects an unknown package manager', async () => {
		await expect(
			create(dir, { name: 'acme', pm: 'bun', host: 'shell', remotes: '', install: false })
		).rejects.toThrow('Unknown package manager')
	})

	it('ships the house prettier config into the workspace', async () => {
		await create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		expect(existsSync(join(dir, '.prettierrc'))).toBe(true)
	})

	it('rejects an invalid workspace name', async () => {
		await expect(
			create(dir, {
				name: 'Bad Name',
				pm: 'pnpm',
				host: 'shell',
				remotes: '',
				install: false,
			})
		).rejects.toThrow('Invalid workspace name')
	})

	it('rejects a remote that collides with the host name', async () => {
		await expect(
			create(dir, {
				name: 'acme',
				pm: 'pnpm',
				host: 'shell',
				remotes: 'shell',
				install: false,
			})
		).rejects.toThrow('unique')
	})

	it('refuses to overwrite an existing workspace', async () => {
		await create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		await expect(
			create(dir, { name: 'acme', pm: 'pnpm', host: 'shell', remotes: '', install: false })
		).rejects.toThrow('already a spool workspace')
	})

	it('blames the folder name when a derived workspace name is invalid', async () => {
		await expect(
			create(join(dir, 'Bad Folder'), {
				pm: 'pnpm',
				host: 'shell',
				remotes: '',
				install: false,
			})
		).rejects.toThrow('pass --name')
	})
})
