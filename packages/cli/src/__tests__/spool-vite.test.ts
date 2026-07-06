/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { workspaceFiles } from '../core/generators.js'
import { HELPER_FILE } from '../core/config.js'
import { host, remote, makeManifest, freshDir, removeDir } from './helpers.js'

/*
 *   TYPES
 ***************************************************************************************************/
/** What the emitted helper's spoolApp returns; asserted structurally below. */
interface HelperModule {
	spoolApp: (
		name: string,
		from?: string,
		command?: 'build' | 'serve'
	) => {
		server: { port: number; strictPort: boolean }
		federation: {
			name: string
			filename?: string
			manifest?: boolean
			remotes?: Record<string, string>
			exposes?: Record<string, string>
			shared: string[]
		}
	}
}

/*
 *   FIXTURE
 ***************************************************************************************************/
// Built through the real zod schema, so a shape change in config.ts that the
// template does not understand fails here.
const manifest = makeManifest({
	shell: host({ remotes: ['dashboard', 'billing'] }),
	dashboard: remote(),
	billing: remote({
		path: 'apps/billing',
		port: 5175,
		url: 'https://cdn.example.com/mf-manifest.json',
	}),
})

let dir: string
let helper: HelperModule

/** Shared entries only survive when the app declares them, so plant a package.json. */
function plantDeclaredDeps(root: string, deps: string[]) {
	writeFileSync(
		join(root, 'package.json'),
		JSON.stringify({ dependencies: Object.fromEntries(deps.map(dep => [dep, '*'])) })
	)
}

// The template is just a string to the CLI's compiler. Compiling and
// importing it here is what actually parses and executes it.
beforeAll(async () => {
	dir = freshDir('spool-helper-')
	plantDeclaredDeps(dir, ['react', 'react-dom'])
	const source = workspaceFiles(manifest)[HELPER_FILE]!
	const { code } = await transform(source, { loader: 'ts', format: 'esm' })
	writeFileSync(join(dir, 'spool.vite.mjs'), code)
	writeFileSync(join(dir, 'spool.json'), JSON.stringify(manifest))
	helper = (await import(pathToFileURL(join(dir, 'spool.vite.mjs')).href)) as HelperModule
})

afterAll(() => {
	removeDir(dir)
})

afterEach(() => {
	delete process.env.SPOOL_REMOTE_DASHBOARD
})

/*
 *   SPOOL APP
 ***************************************************************************************************/
describe('generated spool.vite.ts', () => {
	it('derives a host config with local dev URLs for its remotes', () => {
		const app = helper.spoolApp('shell', dir)
		expect(app.server).toEqual({ port: 5173, strictPort: true })
		expect(app.federation.name).toBe('shell')
		expect(app.federation.remotes?.dashboard).toBe('http://localhost:5174/mf-manifest.json')
		expect(app.federation.shared).toEqual(['react', 'react-dom'])
		expect(app.federation.filename).toBeUndefined()
	})

	it("uses a remote's deployed url for production builds", () => {
		const app = helper.spoolApp('shell', dir, 'build')
		expect(app.federation.remotes?.billing).toBe('https://cdn.example.com/mf-manifest.json')
	})

	it('keeps dev on the local server even when a deployed url is set', () => {
		const app = helper.spoolApp('shell', dir, 'serve')
		expect(app.federation.remotes?.billing).toBe('http://localhost:5175/mf-manifest.json')
	})

	it('lets a SPOOL_REMOTE env var override everything, dev included', () => {
		process.env.SPOOL_REMOTE_DASHBOARD = 'https://staging.example.com/mf-manifest.json'
		const app = helper.spoolApp('shell', dir)
		expect(app.federation.remotes?.dashboard).toBe(
			'https://staging.example.com/mf-manifest.json'
		)
	})

	it('derives a remote config with its exposes and entry filename', () => {
		const app = helper.spoolApp('dashboard', dir)
		expect(app.server).toEqual({ port: 5174, strictPort: true })
		expect(app.federation.filename).toBe('remoteEntry.js')
		expect(app.federation.exposes).toEqual({ './App': './src/App.tsx' })
		expect(app.federation.remotes).toBeUndefined()
		// Without this flag, production builds never emit mf-manifest.json and
		// deployed hosts cannot resolve the remote.
		expect(app.federation.manifest).toBe(true)
	})

	it('names an unknown app in its error', () => {
		expect(() => helper.spoolApp('ghost', dir)).toThrow('no app named "ghost"')
	})

	it('names an unknown remote reference in its error', () => {
		const bad = freshDir('spool-helper-bad-')
		writeFileSync(
			join(bad, 'spool.json'),
			JSON.stringify(makeManifest({ shell: host({ remotes: ['ghost'] }) }))
		)
		expect(() => helper.spoolApp('shell', bad)).toThrow('unknown remote "ghost"')
		removeDir(bad)
	})

	it('drops shared entries the app does not declare', () => {
		const bare = freshDir('spool-helper-bare-')
		plantDeclaredDeps(bare, ['react'])
		writeFileSync(join(bare, 'spool.json'), JSON.stringify(manifest))

		const app = helper.spoolApp('shell', bare)
		expect(app.federation.shared).toEqual(['react'])
		removeDir(bare)
	})

	it('shares nothing and warns when the app package.json is unreadable', () => {
		const broken = freshDir('spool-helper-broken-')
		writeFileSync(join(broken, 'spool.json'), JSON.stringify(manifest))
		writeFileSync(join(broken, 'package.json'), '{ not json')
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

		const app = helper.spoolApp('shell', broken)
		expect(app.federation.shared).toEqual([])
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('package.json'))

		warn.mockRestore()
		removeDir(broken)
	})
})
