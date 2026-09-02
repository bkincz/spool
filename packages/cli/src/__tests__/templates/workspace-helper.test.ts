/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { create } from '../../commands/create.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string

const readJson = (rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8'))
const writeJson = (rel: string, value: unknown) =>
	writeFileSync(join(dir, rel), JSON.stringify(value, null, '\t'))

const load = (rel: string) => import(/* @vite-ignore */ pathToFileURL(join(dir, rel)).href)

beforeEach(async () => {
	dir = freshDir('spool-ws-')
	vi.spyOn(console, 'log').mockImplementation(() => {})
	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard, reports',
		install: false,
	})
})

afterEach(() => {
	removeDir(dir)
	vi.restoreAllMocks()
})

/*
 *   WORKSPACE HELPER
 ***************************************************************************************************/
describe('spool.workspace.ts', () => {
	it('reports every app with resolved paths', async () => {
		const ws = await load('spool.workspace.ts')

		expect(ws.apps.map((a: { name: string }) => a.name).sort()).toEqual([
			'dashboard',
			'reports',
			'shell',
		])
		expect(ws.app('shell').src).toBe(join(dir, 'apps/shell', 'src'))
		expect(ws.root).toBe(dir)
	})

	it('splits hosts from remotes and lists every src folder', async () => {
		const ws = await load('spool.workspace.ts')

		expect(ws.hosts.map((a: { name: string }) => a.name)).toEqual(['shell'])
		expect(ws.remotes.map((a: { name: string }) => a.name).sort()).toEqual([
			'dashboard',
			'reports',
		])
		expect(ws.srcDirs).toHaveLength(3)
	})

	it('picks up an app added to the manifest with no regeneration', async () => {
		const manifest = readJson('spool.json')
		manifest.apps.billing = {
			type: 'remote',
			framework: 'react',
			path: 'apps/billing',
			port: 5199,
			remotes: [],
			exposes: { './App': './src/app/app.tsx' },
		}
		writeJson('spool.json', manifest)

		const ws = await load('spool.workspace.ts')

		expect(ws.apps).toHaveLength(4)
		expect(ws.app('billing').port).toBe(5199)
	})

	it('names an app it does not have', async () => {
		const ws = await load('spool.workspace.ts')

		expect(() => ws.app('nope')).toThrow('no app named "nope"')
	})
})

/*
 *   SHARED DEV SERVER CONFIG
 ***************************************************************************************************/
describe('manifest server config', () => {
	const withServer = (server: unknown) => {
		const manifest = readJson('spool.json')
		manifest.server = server
		writeJson('spool.json', manifest)
	}

	it('reaches every app without touching a vite config', async () => {
		withServer({ proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } } })
		const { spoolApp } = await load('spool.vite.ts')

		for (const name of ['shell', 'dashboard']) {
			const app = spoolApp(name, join(dir, 'apps', name === 'shell' ? 'shell' : 'dashboard'))
			expect(app.server.proxy['/api'].target).toBe('http://localhost:3000')
		}
	})

	it('keeps the port the app entry owns and spool’s own defaults', async () => {
		withServer({ headers: { 'X-Frame-Options': 'DENY' } })
		const { spoolApp } = await load('spool.vite.ts')
		const app = spoolApp('dashboard', join(dir, 'apps/dashboard'))

		expect(app.server.port).toBe(5174)
		expect(app.server.strictPort).toBe(true)
		expect(app.server.cors).toBe(true)
		expect(app.server.headers['X-Frame-Options']).toBe('DENY')
	})

	it('lets the manifest override a spool default', async () => {
		withServer({ cors: false })
		const { spoolApp } = await load('spool.vite.ts')

		expect(spoolApp('dashboard', join(dir, 'apps/dashboard')).server.cors).toBe(false)
	})

	it('expands the environment, with a fallback when it is unset', async () => {
		withServer({ proxy: { '/api': { target: '${ACME_BACKEND:-http://localhost:3000}' } } })
		const { spoolApp } = await load('spool.vite.ts')

		expect(spoolApp('dashboard', join(dir, 'apps/dashboard')).server.proxy['/api'].target).toBe(
			'http://localhost:3000'
		)

		process.env.ACME_BACKEND = 'https://api.example.com'
		try {
			expect(
				spoolApp('dashboard', join(dir, 'apps/dashboard')).server.proxy['/api'].target
			).toBe('https://api.example.com')
		} finally {
			delete process.env.ACME_BACKEND
		}
	})

	it('adds nothing when the manifest says nothing', async () => {
		const { spoolApp } = await load('spool.vite.ts')
		const app = spoolApp('dashboard', join(dir, 'apps/dashboard'))

		expect(app.server).toEqual({ port: 5174, strictPort: true, cors: true })
	})
})
