/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../../commands/create.js'
import { eject } from '../../commands/eject.js'
import { log } from '../../util/logger.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

const readJson = (rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8'))

beforeEach(async () => {
	dir = freshDir('spool-eject-')
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

/*
 *   EJECT
 ***************************************************************************************************/
describe('eject', () => {
	it('removes the spool dependency and rewrites dev/build to native scripts', async () => {
		await eject({ yes: true })

		const pkg = readJson('package.json')
		expect(pkg.devDependencies['@bkincz/spool']).toBeUndefined()
		expect(pkg.scripts.dev).not.toContain('spool')
		expect(pkg.scripts.build).not.toContain('spool')
		expect(pkg.scripts.dev).toContain('pnpm')
	})

	it('drops spool-only scripts that have no native equivalent', async () => {
		await eject({ yes: true })

		const pkg = readJson('package.json')
		expect(pkg.scripts.doctor).toBeUndefined()
		expect(pkg.scripts.preview).toBeUndefined()
	})

	it('deletes .spool', async () => {
		await eject({ yes: true })
		expect(existsSync(join(dir, '.spool'))).toBe(false)
	})

	it('leaves spool.json, spool.vite.ts and generated app files alone', async () => {
		await eject({ yes: true })

		expect(existsSync(join(dir, 'spool.json'))).toBe(true)
		expect(existsSync(join(dir, 'spool.vite.ts'))).toBe(true)
		expect(existsSync(join(dir, 'apps/shell/vite.config.ts'))).toBe(true)
	})

	it('prints what stays and notes remotes-before-hosts ordering is now on the user', async () => {
		const step = vi.spyOn(log, 'step').mockImplementation(() => {})
		await eject({ yes: true })

		expect(step).toHaveBeenCalledWith(expect.stringContaining('remotes before hosts'))
		expect(step).toHaveBeenCalledWith(expect.stringContaining('kept'))
	})

	it('proceeds without asking when there is no tty, same as remove --files', async () => {
		await eject({})

		const pkg = readJson('package.json')
		expect(pkg.devDependencies['@bkincz/spool']).toBeUndefined()
		expect(existsSync(join(dir, '.spool'))).toBe(false)
	})

	it('leaves an already-customized script alone', async () => {
		writeFileSync(
			join(dir, 'package.json'),
			JSON.stringify({
				...readJson('package.json'),
				scripts: { ...readJson('package.json').scripts, dev: 'turbo run dev' },
			})
		)

		await eject({ yes: true })

		expect(readJson('package.json').scripts.dev).toBe('turbo run dev')
	})
})
