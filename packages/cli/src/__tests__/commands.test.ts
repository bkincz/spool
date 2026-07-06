/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { create } from '../commands/create.js'
import { dev } from '../commands/dev.js'
import { build } from '../commands/build.js'
import { deploy } from '../commands/deploy.js'
import { doctor } from '../commands/doctor.js'
import { devAll, buildAll, deployAll } from '../core/orchestrator.js'
import { log } from '../util/logger.js'
import { freshDir, removeDir } from './helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../core/orchestrator.js', () => ({
	devAll: vi.fn().mockResolvedValue(undefined),
	buildAll: vi.fn().mockResolvedValue(undefined),
	deployAll: vi.fn().mockResolvedValue(undefined),
}))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

beforeEach(async () => {
	dir = freshDir('spool-cmd-')
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
	vi.clearAllMocks()
	vi.restoreAllMocks()
})

/*
 *   DEV
 ***************************************************************************************************/
describe('dev', () => {
	it('runs every app by default', async () => {
		await dev({})
		expect(devAll).toHaveBeenCalledWith(expect.objectContaining({ root: dir }), undefined)
	})

	it('passes the only filter through', async () => {
		await dev({ only: 'shell, dashboard' })
		expect(devAll).toHaveBeenCalledWith(expect.anything(), ['shell', 'dashboard'])
	})
})

/*
 *   BUILD
 ***************************************************************************************************/
describe('build', () => {
	it('builds every app by default', async () => {
		await build({})
		expect(buildAll).toHaveBeenCalledWith(expect.objectContaining({ root: dir }), undefined)
	})

	it('passes the only filter through', async () => {
		await build({ only: 'dashboard' })
		expect(buildAll).toHaveBeenCalledWith(expect.anything(), ['dashboard'])
	})
})

/*
 *   DEPLOY
 ***************************************************************************************************/
describe('deploy', () => {
	it('deploys every app by default', async () => {
		await deploy({})
		expect(deployAll).toHaveBeenCalledWith(expect.objectContaining({ root: dir }), undefined)
	})

	it('passes the only filter through', async () => {
		await deploy({ only: 'dashboard' })
		expect(deployAll).toHaveBeenCalledWith(expect.anything(), ['dashboard'])
	})
})

/*
 *   DOCTOR
 ***************************************************************************************************/
describe('doctor', () => {
	it('reports a healthy workspace', async () => {
		const success = vi.spyOn(log, 'success').mockImplementation(() => {})
		await doctor()
		expect(success).toHaveBeenCalledWith(expect.stringContaining('no problems found'))
	})

	it('reports warnings without failing the run', async () => {
		const manifest = JSON.parse(readFileSync(join(dir, 'spool.json'), 'utf8'))
		manifest.apps.extra = {
			type: 'remote',
			path: 'apps/extra',
			port: 5199,
			exposes: { './App': './src/App.tsx' },
		}
		writeFileSync(join(dir, 'spool.json'), JSON.stringify(manifest))
		mkdirSync(join(dir, 'apps/extra'), { recursive: true })

		vi.spyOn(log, 'warn').mockImplementation(() => {})
		const info = vi.spyOn(log, 'info').mockImplementation(() => {})

		await doctor()
		expect(info).toHaveBeenCalledWith(expect.stringContaining('warning'))
		expect(process.exitCode).toBeUndefined()
	})

	it('sets a non-zero exit code when it finds an error', async () => {
		const manifest = JSON.parse(readFileSync(join(dir, 'spool.json'), 'utf8'))
		manifest.apps.dashboard.port = manifest.apps.shell.port
		writeFileSync(join(dir, 'spool.json'), JSON.stringify(manifest))

		vi.spyOn(log, 'error').mockImplementation(() => {})
		vi.spyOn(log, 'info').mockImplementation(() => {})

		await doctor()
		expect(process.exitCode).toBe(1)
	})
})
