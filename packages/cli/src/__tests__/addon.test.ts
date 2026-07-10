/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { create } from '../commands/create.js'
import { addon } from '../commands/addon.js'
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
let stdinTTY: boolean | undefined

beforeEach(async () => {
	dir = freshDir('spool-addon-')
	cwd = process.cwd()
	stdinTTY = process.stdin.isTTY
	process.stdin.isTTY = true
	vi.spyOn(console, 'log').mockImplementation(() => {})
	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard',
		addons: 'none',
		install: false,
	})
	process.chdir(dir)
})

afterEach(() => {
	process.stdin.isTTY = stdinTTY as boolean
	process.chdir(cwd)
	removeDir(dir)
	vi.clearAllMocks()
	vi.restoreAllMocks()
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

/*
 *   ADDON
 ***************************************************************************************************/
describe('addon', () => {
	it('adds ladle retroactively and allowlists its build scripts', async () => {
		await addon(['ladle'], { install: false })

		expect(existsSync(join(dir, 'packages/ui/src/Button.stories.tsx'))).toBe(true)
		expect(read('pnpm-workspace.yaml')).toContain("'@swc/core': true")
		expect(read('pnpm-workspace.yaml')).toContain("- '@swc/core'")
	})

	it('adds shared state to the manifest, every app, and their deps', async () => {
		await addon(['state'], { install: false })

		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.shared).toContain('@bkincz/clutch')
		expect(manifest.shared).toContain('@bkincz/clutch/react')

		for (const app of ['shell', 'dashboard']) {
			const pkg = JSON.parse(read(`apps/${app}/package.json`))
			expect(pkg.dependencies['@bkincz/clutch']).toBeDefined()
			const counter = read(`apps/${app}/src/state/counter.ts`)
			expect(counter).toContain("'acme:counter'")
			expect(counter).toContain('validate<CounterState>')
			expect(counter).toContain('version: 1')
			// Retroactive adds never rewrite app components with the example.
			expect(read(`apps/${app}/src/App.tsx`)).not.toContain('counterMachine')
		}
	})

	it('is idempotent', async () => {
		await addon(['ladle,', 'state'], { install: false })
		const before = read('pnpm-workspace.yaml')

		await addon(['ladle,', 'state'], { install: false })

		expect(read('pnpm-workspace.yaml')).toBe(before)
		const manifest = JSON.parse(read('spool.json'))
		expect(manifest.shared.filter((d: string) => d === '@bkincz/clutch')).toHaveLength(1)
	})

	it('hides already-present addons from the prompt', async () => {
		await addon(['ladle'], { install: false })

		await addon([], { install: false })

		const call = vi.mocked(p.multiselect).mock.calls.at(-1)?.[0] as {
			options: { value: string }[]
		}
		expect(call.options.map(option => option.value)).not.toContain('ladle')
		expect(call.options.map(option => option.value)).toContain('state')
	})

	it('rejects an unknown addon', async () => {
		await expect(addon(['storybook'], { install: false })).rejects.toThrow('Unknown addon')
	})

	it('adds exact allowlist entries even when similar names already exist', async () => {
		const seeded = read('pnpm-workspace.yaml').replace(
			/allowBuilds:\r?\n/,
			"allowBuilds:\n    'msw-storybook-addon': true\n"
		)
		writeFileSync(join(dir, 'pnpm-workspace.yaml'), seeded)

		await addon(['ladle'], { install: false })

		const yaml = read('pnpm-workspace.yaml')
		expect(yaml).toMatch(/\bmsw: true/)
		expect(yaml).toContain("'@swc/core': true")
		expect(yaml).toContain("'msw-storybook-addon': true")
	})

	it('rejects ladle in a workspace with no react app', async () => {
		process.chdir(cwd)
		removeDir(dir)
		dir = freshDir('spool-addon-')
		await create(dir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell:svelte',
			remotes: '',
			addons: 'none',
			install: false,
		})
		process.chdir(dir)

		await expect(addon(['ladle'], { install: false })).rejects.toThrow('react-based')
	})
})
