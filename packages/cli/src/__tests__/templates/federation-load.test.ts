/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import { federationFiles } from '../../core/templates/composition.js'
import { freshDir, host, makeManifest, remote, removeDir } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
interface LoadModule {
	remoteName(id: string): string
	forceReregister(id: string): void
	loadRemote<T>(id: string, importRemote: () => Promise<T>): Promise<T>
}

interface RegisteredRemote {
	name: string
	alias?: string
	entry: string
}

const INSTANCE_KEY = '__spoolTestFederationInstance'

const IMPORT_ENTRY_KEY = '__spoolTestImportEntry'
// esbuild may move or drop the @vite-ignore comment, so match the call itself.
const ENTRY_IMPORT = /import\(\s*(?:\/\*[^*]*\*\/\s*)?url\.href\s*\)/
const ENTRY = 'https://remote.example/remoteEntry.js'

let dir: string
let loadUrl: string
let loaded = 0
// Stands in for the browser's import() of a remoteEntry, so the url it asks for can be checked.
const importEntry = (url: string) => Promise.resolve({ url })

beforeAll(async () => {
	dir = freshDir('spool-load-')
	const manifest = makeManifest({
		shell: host({ remotes: ['assessments'] }),
		assessments: remote({ path: 'apps/assessments' }),
	})
	manifest.addons = ['federation']
	const source = federationFiles(manifest, manifest.apps.shell!)['src/federation/load.ts']!
	const { code } = await transform(source, { loader: 'ts', format: 'esm' })

	// Stands in for @module-federation/runtime: getInstance() returns whatever the test installs.
	writeFileSync(
		join(dir, 'runtime.mjs'),
		`export const getInstance = () => globalThis.${INSTANCE_KEY} ?? null;\n`
	)
	expect(code).toMatch(ENTRY_IMPORT)
	writeFileSync(
		join(dir, 'load.mjs'),
		code
			.replace('"@module-federation/runtime"', JSON.stringify('./runtime.mjs'))
			.replace(ENTRY_IMPORT, `globalThis.${IMPORT_ENTRY_KEY}(url.href)`)
	)
	loadUrl = pathToFileURL(join(dir, 'load.mjs')).href
	;(globalThis as Record<string, unknown>)[IMPORT_ENTRY_KEY] = importEntry
})

afterAll(() => {
	delete (globalThis as Record<string, unknown>)[IMPORT_ENTRY_KEY]
	removeDir(dir)
})

afterEach(() => {
	delete (globalThis as Record<string, unknown>)[INSTANCE_KEY]
})

/** A fresh copy of the generated module, so the failure bookkeeping starts empty. */
async function freshLoad(): Promise<LoadModule> {
	return (await import(`${loadUrl}?copy=${++loaded}`)) as LoadModule
}

interface EntryRetryPlugin {
	name: string
	loadEntry(args: { remoteInfo: { name: string; entry: string; type: string } }): unknown
}

function installInstance(remotes: RegisteredRemote[]) {
	const instance = {
		options: { remotes },
		moduleCache: new Map<string, { remoteEntryExports?: object }>(),
		registerRemotes: vi.fn(),
		registerPlugins: vi.fn<(plugins: EntryRetryPlugin[]) => void>(),
		loadRemote: vi.fn((id: string) => Promise.resolve({ default: `runtime:${id}` })),
	}
	;(globalThis as Record<string, unknown>)[INSTANCE_KEY] = instance
	return instance
}

function entryRetryPlugin(instance: ReturnType<typeof installInstance>): EntryRetryPlugin {
	const plugin = instance.registerPlugins.mock.calls.at(-1)?.[0][0]
	if (!plugin) throw new Error('no runtime plugin was registered')
	return plugin
}

// How @module-federation/vite registers a remote: its own name, the app name as alias.
const assessments: RegisteredRemote = {
	name: '__mfe_internal__assessments',
	alias: 'assessments',
	entry: 'http://localhost:5175/mf-manifest.json',
}

const failingImport = () => vi.fn(() => Promise.reject(new Error('Failed to get manifest')))

/*
 *   NAME RESOLUTION
 ***************************************************************************************************/
describe('generated load.ts: remoteName', () => {
	it.each([
		['staff', 'staff'],
		['staff/App', 'staff'],
		['assessments/NewAssessment', 'assessments'],
		['my-app/Nested/Expose', 'my-app'],
	])('resolves %s to the remote %s', async (id, name) => {
		const { remoteName } = await freshLoad()
		expect(remoteName(id)).toBe(name)
	})
})

describe('generated load.ts: forceReregister', () => {
	it('re-registers the remote an expose belongs to, found by its alias', async () => {
		const instance = installInstance([assessments])
		const { forceReregister } = await freshLoad()

		forceReregister('assessments/NewAssessment')

		expect(instance.registerRemotes).toHaveBeenCalledExactlyOnceWith([assessments], {
			force: true,
		})
	})

	it('finds a remote registered under the app name itself', async () => {
		const staff = {
			name: 'staff',
			alias: 'staff',
			entry: 'http://localhost:5174/mf-manifest.json',
		}
		const instance = installInstance([staff])
		const { forceReregister } = await freshLoad()

		forceReregister('staff')

		expect(instance.registerRemotes).toHaveBeenCalledExactlyOnceWith([staff], { force: true })
	})

	it('loads an entry that never loaded from a fresh url on the next attempt', async () => {
		const instance = installInstance([assessments])
		const { forceReregister } = await freshLoad()

		forceReregister('assessments')
		const plugin = entryRetryPlugin(instance)
		const entry = await plugin.loadEntry({
			remoteInfo: { name: assessments.name, entry: ENTRY, type: 'module' },
		})

		expect(plugin.name).toBe('spool-entry-retry')
		expect((entry as { url: string }).url).toBe(`${ENTRY}?spool-retry=1`)
	})

	it('gives each retry its own url until one loads, then keeps it', async () => {
		const instance = installInstance([assessments])
		const { forceReregister } = await freshLoad()
		const remoteInfo = { name: assessments.name, entry: ENTRY, type: 'module' }

		forceReregister('assessments')
		forceReregister('assessments')
		const second = (await entryRetryPlugin(instance).loadEntry({ remoteInfo })) as {
			url: string
		}
		expect(second.url).toBe(`${ENTRY}?spool-retry=2`)

		// The entry loaded from that url, so later retries must not evaluate it again elsewhere.
		instance.moduleCache.set(assessments.name, { remoteEntryExports: second })
		forceReregister('assessments')
		instance.moduleCache.clear()
		forceReregister('assessments')
		const kept = (await entryRetryPlugin(instance).loadEntry({ remoteInfo })) as { url: string }
		expect(kept.url).toBe(`${ENTRY}?spool-retry=2`)
	})

	it('never refreshes an entry that already loaded from its own url', async () => {
		const instance = installInstance([assessments])
		instance.moduleCache.set(assessments.name, { remoteEntryExports: {} })
		const { forceReregister } = await freshLoad()

		forceReregister('assessments')
		instance.moduleCache.clear()
		forceReregister('assessments')

		expect(instance.registerPlugins).not.toHaveBeenCalled()
		expect(instance.registerRemotes).toHaveBeenCalledTimes(2)
	})

	it('leaves script-type entries to the runtime', async () => {
		const instance = installInstance([assessments])
		const { forceReregister } = await freshLoad()

		forceReregister('assessments')

		expect(
			entryRetryPlugin(instance).loadEntry({
				remoteInfo: { name: assessments.name, entry: ENTRY, type: 'var' },
			})
		).toBeUndefined()
	})

	it('does nothing for a remote the runtime does not know, or with no runtime', async () => {
		const instance = installInstance([assessments])
		const { forceReregister } = await freshLoad()

		forceReregister('staff')
		expect(instance.registerRemotes).not.toHaveBeenCalled()

		delete (globalThis as Record<string, unknown>)[INSTANCE_KEY]
		expect(() => forceReregister('assessments')).not.toThrow()
	})
})

/*
 *   LOADING
 ***************************************************************************************************/
describe('generated load.ts: loadRemote', () => {
	it('uses the bundler import while it works', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importRemote = vi.fn(() => Promise.resolve({ default: 'bundled' }))

		await expect(loadRemote('assessments/App', importRemote)).resolves.toEqual({
			default: 'bundled',
		})
		await loadRemote('assessments/App', importRemote)

		expect(importRemote).toHaveBeenCalledTimes(2)
		expect(instance.loadRemote).not.toHaveBeenCalled()
		expect(instance.registerRemotes).not.toHaveBeenCalled()
	})

	it('asks the runtime once the import has failed, re-registering the remote first', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		await expect(loadRemote('assessments/NewAssessment', importRemote)).rejects.toThrow(
			'Failed to get manifest'
		)
		await expect(loadRemote('assessments/NewAssessment', importRemote)).resolves.toEqual({
			default: 'runtime:assessments/NewAssessment',
		})

		expect(importRemote).toHaveBeenCalledOnce()
		expect(instance.registerRemotes).toHaveBeenCalledExactlyOnceWith([assessments], {
			force: true,
		})
		expect(instance.registerRemotes.mock.invocationCallOrder[0]).toBeLessThan(
			instance.loadRemote.mock.invocationCallOrder[0]!
		)
	})

	it('stays on the runtime after recovering, without re-registering again', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		await loadRemote('assessments/App', importRemote).catch(() => undefined)
		await loadRemote('assessments/App', importRemote)
		await loadRemote('assessments/App', importRemote)

		expect(importRemote).toHaveBeenCalledOnce()
		expect(instance.loadRemote).toHaveBeenCalledTimes(2)
		expect(instance.registerRemotes).toHaveBeenCalledOnce()
	})

	it('keeps re-registering while the runtime keeps failing', async () => {
		const instance = installInstance([assessments])
		instance.loadRemote.mockRejectedValue(new Error('still down'))
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		for (let attempt = 0; attempt < 3; attempt++) {
			await loadRemote('assessments/App', importRemote).catch(() => undefined)
		}

		expect(instance.registerRemotes).toHaveBeenCalledTimes(2)
	})

	it('re-registers a remote before loading another of its exposes after one failed', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importExpose = vi.fn(() => Promise.resolve({ default: 'expose' }))

		await loadRemote('assessments/App', failingImport()).catch(() => undefined)
		await expect(loadRemote('assessments/NewAssessment', importExpose)).resolves.toEqual({
			default: 'expose',
		})

		expect(instance.registerRemotes).toHaveBeenCalledOnce()
		expect(importExpose).toHaveBeenCalledOnce()
	})

	it('goes back to the import when the runtime never registered the remote', async () => {
		const instance = installInstance([])
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		await loadRemote('assessments/App', importRemote).catch(() => undefined)
		await loadRemote('assessments/App', importRemote).catch(() => undefined)

		expect(importRemote).toHaveBeenCalledTimes(2)
		expect(instance.loadRemote).not.toHaveBeenCalled()
	})

	it('rejects when the runtime resolves to nothing', async () => {
		const instance = installInstance([assessments])
		instance.loadRemote.mockResolvedValue(null as never)
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		await loadRemote('assessments/App', importRemote).catch(() => undefined)
		await expect(loadRemote('assessments/App', importRemote)).rejects.toThrow(
			'remote "assessments/App" loaded nothing'
		)
	})

	it('only ever uses the import without a federation runtime, as in tests', async () => {
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		await loadRemote('assessments/App', importRemote).catch(() => undefined)
		await loadRemote('assessments/App', importRemote).catch(() => undefined)

		expect(importRemote).toHaveBeenCalledTimes(2)
	})
})

/*
 *   REGISTRY
 ***************************************************************************************************/
describe('generated remotes.ts', () => {
	it('sends every loader through loadRemote, keeping the static import the bundler needs', () => {
		const manifest = makeManifest({
			shell: host({ remotes: ['assessments'] }),
			assessments: remote({
				path: 'apps/assessments',
				exposes: { './App': './src/app/app.tsx', './NewAssessment': './src/new.tsx' },
			}),
		})
		manifest.addons = ['federation']
		const registry = federationFiles(manifest, manifest.apps.shell!)[
			'src/federation/remotes.ts'
		]!

		expect(registry).toContain('import { loadRemote } from "./load"')
		expect(registry).toContain(
			'"assessments": { contract: "component", load: () => loadRemote("assessments/App", () => import("assessments/App")) }'
		)
		expect(registry).toContain(
			'"assessments/NewAssessment": { contract: "component", load: () => loadRemote("assessments/NewAssessment", () => import("assessments/NewAssessment")) }'
		)
	})
})
