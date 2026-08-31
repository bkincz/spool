/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../commands/create.js'
import { doctor } from '../commands/doctor.js'
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

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const readJson = (rel: string) => JSON.parse(read(rel))
const writeJson = (rel: string, value: unknown) =>
	writeFileSync(join(dir, rel), JSON.stringify(value))

const SHELL = 'apps/shell/package.json'
const DASHBOARD = 'apps/dashboard/package.json'

function setDep(rel: string, dep: string, range: string | null) {
	const pkg = readJson(rel)

	if (range === null) delete pkg.dependencies[dep]
	else pkg.dependencies[dep] = range

	writeJson(rel, pkg)
}

beforeEach(async () => {
	dir = freshDir('spool-doctor-fix-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => { })

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

	process.exitCode = undefined
	vi.restoreAllMocks()
})

/*
 *   DOCTOR --FIX
 ***************************************************************************************************/
describe('doctor --fix', () => {
	it('adds a shared dep an app is missing', async () => {
		setDep(DASHBOARD, 'react-dom', null)

		await doctor({ fix: true })

		expect(readJson(DASHBOARD).dependencies['react-dom']).toBe('^19.2.0')
	})

	it('aligns a mismatched shared dep on the highest range in the workspace', async () => {
		setDep(DASHBOARD, 'react', '^21.0.0')

		await doctor({ fix: true })

		expect(readJson(SHELL).dependencies.react).toBe('^21.0.0')
		expect(readJson(DASHBOARD).dependencies.react).toBe('^21.0.0')
	})

	it('adds a framework runtime back to shared in spool.json', async () => {
		const manifest = readJson('spool.json')
		manifest.shared = ['react']
		writeJson('spool.json', manifest)

		await doctor({ fix: true })

		expect(readJson('spool.json').shared).toContain('react-dom')
	})

	it('leaves an uncomparable specifier and the apps around it alone', async () => {
		setDep(DASHBOARD, 'react', 'workspace:*')

		await doctor({ fix: true })

		expect(readJson(DASHBOARD).dependencies.react).toBe('workspace:*')
		expect(readJson(SHELL).dependencies.react).toBe('^19.2.0')
	})

	it('writes nothing with --dry-run', async () => {
		setDep(DASHBOARD, 'react-dom', null)
		const before = read(DASHBOARD)

		await doctor({ fix: true, dryRun: true })

		expect(read(DASHBOARD)).toBe(before)
	})

	it('clears the diagnostic it fixed', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => { })
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => { })
		setDep(DASHBOARD, 'react-dom', null)

		await doctor({ fix: true })

		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"react-dom" is not in'))
		expect(step).toHaveBeenCalledWith(expect.stringContaining('react-dom'))
	})

	it('points at --fix instead of fixing when the flag is absent', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => { })
		setDep(DASHBOARD, 'react-dom', null)

		await doctor({})

		expect(readJson(DASHBOARD).dependencies['react-dom']).toBeUndefined()
		expect(step).toHaveBeenCalledWith(expect.stringContaining('rerun with --fix'))
	})

	it('says nothing about --fix when no diagnostic carries one', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => { })

		await doctor({})

		expect(step).not.toHaveBeenCalledWith(expect.stringContaining('rerun with --fix'))
	})
})
