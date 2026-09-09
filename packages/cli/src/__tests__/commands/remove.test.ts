/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../../commands/create.js'
import { add } from '../../commands/add.js'
import { remove } from '../../commands/remove.js'
import { upgrade } from '../../commands/upgrade.js'
import * as p from '@clack/prompts'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@clack/prompts', async importOriginal => {
	const actual = (await importOriginal()) as typeof p
	return { ...actual, confirm: vi.fn() }
})

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

beforeEach(async () => {
	dir = freshDir('spool-remove-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => {})
	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard, profile',
		install: false,
	})
	process.chdir(dir)
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)
	vi.restoreAllMocks()
})

const manifest = () => JSON.parse(readFileSync(join(dir, 'spool.json'), 'utf8'))

/*
 *   REMOVE
 ***************************************************************************************************/
describe('remove', () => {
	it('removes a remote from the manifest and unwires it from hosts', async () => {
		await remove('dashboard', {})

		const m = manifest()
		expect(m.apps.dashboard).toBeUndefined()
		expect(m.apps.shell.remotes).toEqual(['profile'])
	})

	it('regenerates host typings without the removed remote', async () => {
		await remove('dashboard', {})

		const typings = readFileSync(join(dir, 'apps/shell/src/remotes.d.ts'), 'utf8')
		expect(typings).toContain('profile/App')
		expect(typings).not.toContain('dashboard/App')
	})

	it('deletes the typings file when the last remote is removed', async () => {
		await remove('dashboard', {})
		await remove('profile', {})

		expect(existsSync(join(dir, 'apps/shell/src/remotes.d.ts'))).toBe(false)
		expect(manifest().apps.shell.remotes).toEqual([])
	})

	it('keeps the app folder unless --files is passed', async () => {
		await remove('dashboard', {})

		expect(existsSync(join(dir, 'apps/dashboard'))).toBe(true)
	})

	it('deletes the app folder with --files', async () => {
		await remove('dashboard', { files: true })

		expect(existsSync(join(dir, 'apps/dashboard'))).toBe(false)
	})

	it('removes a host without touching its former remotes', async () => {
		await remove('shell', {})

		const m = manifest()
		expect(m.apps.shell).toBeUndefined()
		expect(m.apps.dashboard).toBeDefined()
		expect(m.apps.profile).toBeDefined()
	})

	it('round-trips with add', async () => {
		await remove('dashboard', { files: true })
		await add('dashboard', { install: false })

		const m = manifest()
		expect(m.apps.dashboard.type).toBe('remote')
		expect(m.apps.shell.remotes).toContain('dashboard')
	})

	it('rejects an unknown app', async () => {
		await expect(remove('ghost', {})).rejects.toThrow('No app named "ghost"')
	})

	it('refuses to delete files outside the workspace', async () => {
		const m = manifest()
		m.apps.dashboard.path = '../outside'
		writeFileSync(join(dir, 'spool.json'), JSON.stringify(m))

		await expect(remove('dashboard', { files: true })).rejects.toThrow('invalid path')
	})

	it('unwires a remote from another remote that consumes it, not just from hosts', async () => {
		const m = manifest()
		m.apps.widget = {
			type: 'remote',
			framework: 'react',
			path: 'apps/widget',
			port: 5199,
			remotes: [],
			exposes: { './App': './src/app/app.tsx' },
		}
		m.apps.dashboard.remotes = ['widget']
		writeFileSync(join(dir, 'spool.json'), JSON.stringify(m))
		mkdirSync(join(dir, 'apps/widget/src/app'), { recursive: true })
		writeFileSync(join(dir, 'apps/widget/src/app/app.tsx'), 'export default function App() {}')

		await remove('widget', {})

		expect(manifest().apps.dashboard.remotes).toEqual([])
	})
})

/*
 *   REMOVE: A REMOTE THAT CONSUMES ANOTHER REMOTE
 ***************************************************************************************************/
describe('remove: a remote consuming another remote', () => {
	let chainDir: string
	let chainCwd: string

	beforeEach(async () => {
		chainDir = freshDir('spool-remove-chain-')
		chainCwd = process.cwd()
		vi.spyOn(console, 'log').mockImplementation(() => {})

		await create(chainDir, {
			name: 'acme',
			pm: 'pnpm',
			host: 'shell',
			remotes: 'dashboard, widget',
			addons: 'federation',
			install: false,
		})
		process.chdir(chainDir)

		const m = JSON.parse(readFileSync(join(chainDir, 'spool.json'), 'utf8'))
		m.apps.dashboard.remotes = ['widget']
		writeFileSync(join(chainDir, 'spool.json'), JSON.stringify(m))
		await upgrade({ force: true })
	})

	afterEach(() => {
		process.chdir(chainCwd)
		removeDir(chainDir)
	})

	it('unwires the remote from its remote consumer', async () => {
		await remove('widget', {})

		const m = JSON.parse(readFileSync(join(chainDir, 'spool.json'), 'utf8'))
		expect(m.apps.dashboard.remotes).toEqual([])
	})

	it('regenerates the consumer’s registry instead of leaving a stale one', async () => {
		const before = readFileSync(
			join(chainDir, 'apps/dashboard/src/federation/remotes.ts'),
			'utf8'
		)
		expect(before).toContain('widget')

		await remove('widget', {})

		const after = readFileSync(
			join(chainDir, 'apps/dashboard/src/federation/remotes.ts'),
			'utf8'
		)
		expect(after).not.toContain('widget')
	})
})

/*
 *   DELETE CONFIRMATION
 ***************************************************************************************************/
describe('remove --files confirmation', () => {
	const asTty = () =>
		Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })

	afterEach(() => {
		Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
	})

	it('keeps the folder and the app when the answer is no', async () => {
		asTty()
		vi.mocked(p.confirm).mockResolvedValue(false)

		await remove('dashboard', { files: true })

		expect(existsSync(join(dir, 'apps/dashboard'))).toBe(true)
		expect(manifest().apps.dashboard).toBeDefined()
	})

	it('deletes when the answer is yes', async () => {
		asTty()
		vi.mocked(p.confirm).mockResolvedValue(true)

		await remove('dashboard', { files: true })

		expect(existsSync(join(dir, 'apps/dashboard'))).toBe(false)
	})

	it('does not ask with --yes', async () => {
		asTty()

		await remove('dashboard', { files: true, yes: true })

		expect(p.confirm).not.toHaveBeenCalled()
		expect(existsSync(join(dir, 'apps/dashboard'))).toBe(false)
	})

	it('does not ask without a tty', async () => {
		await remove('dashboard', { files: true })

		expect(p.confirm).not.toHaveBeenCalled()
		expect(existsSync(join(dir, 'apps/dashboard'))).toBe(false)
	})
})
