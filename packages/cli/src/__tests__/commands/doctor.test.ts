/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../../commands/create.js'
import { doctor } from '../../commands/doctor.js'
import { log } from '../../util/logger.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const readJson = (rel: string) => JSON.parse(read(rel))
const writeJson = (rel: string, value: unknown) =>
	writeFileSync(join(dir, rel), JSON.stringify(value))

const ROOT = 'package.json'

/** Set a range in devDependencies, where the toolchain deps live. */
function setDevDep(rel: string, dep: string, range: string) {
	const pkg = readJson(rel)

	pkg.devDependencies[dep] = range

	writeJson(rel, pkg)
}

/** Add a package to the manifest’s shared list. */
function share(dep: string) {
	const manifest = readJson('spool.json')

	manifest.shared = [...manifest.shared, dep]

	writeJson('spool.json', manifest)
}

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

		expect(readJson(DASHBOARD).dependencies['react-dom']).toBe('^19.2.8')
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
		expect(readJson(SHELL).dependencies.react).toBe('^19.2.8')
	})

	it('writes nothing with --dry-run', async () => {
		setDep(DASHBOARD, 'react-dom', null)
		const before = read(DASHBOARD)

		await doctor({ fix: true, dryRun: true })

		expect(read(DASHBOARD)).toBe(before)
	})

	it('clears the diagnostic it fixed', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		setDep(DASHBOARD, 'react-dom', null)

		await doctor({ fix: true })

		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('"react-dom" is not in'))
		expect(step).toHaveBeenCalledWith(expect.stringContaining('react-dom'))
	})

	it('points at --fix instead of fixing when the flag is absent', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})
		setDep(DASHBOARD, 'react-dom', null)

		await doctor({})

		expect(readJson(DASHBOARD).dependencies['react-dom']).toBeUndefined()
		expect(step).toHaveBeenCalledWith(expect.stringContaining('rerun with --fix'))
	})

	it('says nothing about --fix when no diagnostic carries one', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})

		await doctor({})

		expect(step).not.toHaveBeenCalledWith(expect.stringContaining('rerun with --fix'))
	})
})

/*
 *   MANAGED DEPS
 ***************************************************************************************************/
describe('doctor --fix on deps spool writes itself', () => {
	// An app added by an older CLI keeps whatever that version pinned, and
	// typescript is not in "shared", so nothing used to report it.
	it('aligns an app left behind on an older toolchain pin', async () => {
		setDevDep(DASHBOARD, 'typescript', '^5.6.3')

		await doctor({ fix: true })

		expect(readJson(DASHBOARD).devDependencies.typescript).toBe('^6.0.3')
	})

	it('names the apps that disagree', async () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		setDevDep(DASHBOARD, 'typescript', '^5.6.3')

		await doctor({})

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('"typescript" is on more than one version')
		)
	})

	// The root carries typescript too, and it is not an app.
	it('raises the workspace root when it is the one behind', async () => {
		setDevDep(ROOT, 'typescript', '^5.6.3')

		await doctor({ fix: true })

		expect(readJson(ROOT).devDependencies.typescript).toBe('^6.0.3')
	})

	it('leaves a dep every package already agrees on alone', async () => {
		const before = read(DASHBOARD)

		await doctor({ fix: true })

		expect(read(DASHBOARD)).toBe(before)
	})
})

/*
 *   WORKSPACE LINKS
 ***************************************************************************************************/
describe('doctor --fix on shared workspace packages', () => {
	// workspace:* cannot be compared, but when every package that declares it
	// says the same thing there is nothing to compare in the first place.
	it('adds a shared workspace link that every other package agrees on', async () => {
		share('mylib')
		setDep(SHELL, 'mylib', 'workspace:*')

		await doctor({ fix: true })

		expect(readJson(DASHBOARD).dependencies.mylib).toBe('workspace:*')
	})

	it('adds nothing when the packages disagree on the link', async () => {
		share('mylib')
		setDep(SHELL, 'mylib', 'workspace:*')
		setDep(DASHBOARD, 'mylib', 'link:../mylib')

		await doctor({ fix: true })

		expect(readJson(SHELL).dependencies.mylib).toBe('workspace:*')
		expect(readJson(DASHBOARD).dependencies.mylib).toBe('link:../mylib')
	})
})
