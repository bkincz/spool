/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../commands/create.js'
import { add } from '../commands/add.js'
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

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const readJson = (rel: string) => JSON.parse(read(rel))

beforeEach(async () => {
	dir = freshDir('spool-quality-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => { })

	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard',
		addons: 'lint, test',
		install: false,
	})

	process.chdir(dir)
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)
	vi.restoreAllMocks()
})

/*
 *   SCAFFOLD
 ***************************************************************************************************/
describe('a workspace scaffolded with lint and test', () => {
	it('lands the config files', () => {
		expect(existsSync(join(dir, 'eslint.config.js'))).toBe(true)
		expect(existsSync(join(dir, 'apps/shell/vitest.config.ts'))).toBe(true)
		expect(existsSync(join(dir, 'apps/dashboard/vitest.config.ts'))).toBe(true)
		expect(existsSync(join(dir, 'apps/shell/src/test/remote-component.tsx'))).toBe(true)
	})

	it('wires the scripts at the root and in every app', () => {
		expect(readJson('package.json').scripts).toMatchObject({
			lint: 'eslint .',
			test: 'pnpm -r test',
			'type-check': 'pnpm -r type-check',
		})
		expect(readJson('apps/dashboard/package.json').scripts).toMatchObject({
			test: 'vitest',
			'type-check': 'tsc --noEmit',
		})
	})

	it('installs the deps each one needs', () => {
		expect(readJson('package.json').devDependencies).toHaveProperty('eslint')
		expect(readJson('apps/shell/package.json').devDependencies).toHaveProperty('vitest')
	})

	it('stubs the remotes the host consumes', () => {
		expect(read('apps/shell/src/test/remotes.alias.ts')).toContain('dashboard/App')
	})

	it('restubs the host when a remote is added later', async () => {
		await add('reports', { type: 'remote', install: false })

		expect(read('apps/shell/src/test/remotes.alias.ts')).toContain('reports/App')
	})
})

/*
 *   WITHOUT THE ADDONS
 ***************************************************************************************************/
describe('a workspace scaffolded without them', () => {
	it('still gets type-check, and nothing else', async () => {
		const plain = freshDir('spool-plain-')
		try {
			await create(plain, {
				name: 'acme',
				pm: 'pnpm',
				host: 'shell',
				remotes: 'dashboard',
				addons: 'none',
				install: false,
			})
			const root = JSON.parse(readFileSync(join(plain, 'package.json'), 'utf8'))

			expect(root.scripts['type-check']).toBe('pnpm -r type-check')
			expect(root.scripts.lint).toBeUndefined()
			expect(existsSync(join(plain, 'eslint.config.js'))).toBe(false)
			expect(existsSync(join(plain, 'apps/shell/vitest.config.ts'))).toBe(false)
		} finally {
			removeDir(plain)
		}
	})
})
