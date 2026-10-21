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
const ENTRIES_KEY = '__spoolRemoteEntries'
// esbuild may move or drop the @vite-ignore comment, so match the call itself.
const ENTRY_IMPORT = /import\(\s*(?:\/\*[^*]*\*\/\s*)?url\s*\)/
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
			.replace(ENTRY_IMPORT, `globalThis.${IMPORT_ENTRY_KEY}(url)`)
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
	delete (globalThis as Record<string, unknown>)[ENTRIES_KEY]
})

/** A fresh copy of the generated module, as another host's bundle on the same page has. */
async function freshLoad(): Promise<LoadModule> {
	return (await import(`${loadUrl}?copy=${++loaded}`)) as LoadModule
}

interface RemoteInfo {
	name: string
	entry: string
	type: string
}

interface EntriesPlugin {
	name: string
	loadEntry(args: { remoteInfo: RemoteInfo }): unknown
	afterLoadEntry(args: { remoteInfo: RemoteInfo; remoteEntryExports?: object | undefined }): void
}

interface CachedModule {
	remoteInfo: { entry: string }
	remoteEntryExports?: object | undefined
}

function installInstance(remotes: RegisteredRemote[]) {
	const instance = {
		options: { remotes },
		moduleCache: new Map<string, CachedModule>(),
		registerRemotes: vi.fn(),
		registerPlugins: vi.fn<(plugins: EntriesPlugin[]) => void>(),
		loadRemote: vi.fn((id: string) => Promise.resolve({ default: `runtime:${id}` })),
	}
	;(globalThis as Record<string, unknown>)[INSTANCE_KEY] = instance
	return instance
}

type Instance = ReturnType<typeof installInstance>

function entriesPlugin(instance: Instance): EntriesPlugin {
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

const remoteInfo: RemoteInfo = { name: assessments.name, entry: ENTRY, type: 'module' }

/** What the runtime leaves behind once it resolved the manifest and tried the entry. */
function cacheModule(instance: Instance, remoteEntryExports?: object): void {
	instance.moduleCache.set(assessments.name, { remoteInfo: { entry: ENTRY }, remoteEntryExports })
}

/** One entry load as the runtime runs it: loadEntry, then afterLoadEntry with the outcome. */
async function attempt(plugin: EntriesPlugin, outcome: 'loads' | 'fails'): Promise<string> {
	const exports = (await plugin.loadEntry({ remoteInfo })) as { url: string } | undefined
	const url = exports?.url ?? ENTRY
	plugin.afterLoadEntry({
		remoteInfo,
		remoteEntryExports: outcome === 'loads' ? { url } : undefined,
	})
	return url
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

/*
 *   ENTRY URLS
 ***************************************************************************************************/
describe('generated load.ts: remote entry plugin', () => {
	it('is registered once, before the first load', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importRemote = vi.fn(() => Promise.resolve({ default: 'bundled' }))

		await loadRemote('assessments', importRemote)
		await loadRemote('assessments/NewAssessment', importRemote)

		expect(instance.registerPlugins).toHaveBeenCalledOnce()
		expect(instance.registerPlugins.mock.invocationCallOrder[0]).toBeLessThan(
			importRemote.mock.invocationCallOrder[0]!
		)
		expect(entriesPlugin(instance).name).toBe('spool-remote-entries')
	})

	it('leaves an entry that has not failed to the runtime', async () => {
		const instance = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))

		expect(entriesPlugin(instance).loadEntry({ remoteInfo })).toBeUndefined()
	})

	it('moves each attempt after a failure to a fresh url, then keeps the one that loaded', async () => {
		const instance = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		const plugin = entriesPlugin(instance)

		expect(await attempt(plugin, 'fails')).toBe(ENTRY)
		expect(await attempt(plugin, 'fails')).toBe(`${ENTRY}?spool-retry=1`)
		expect(await attempt(plugin, 'loads')).toBe(`${ENTRY}?spool-retry=2`)
		expect(await attempt(plugin, 'loads')).toBe(`${ENTRY}?spool-retry=2`)
	})

	it('counts a failure once, however many hosts were waiting on it', async () => {
		const instance = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		const plugin = entriesPlugin(instance)

		await plugin.loadEntry({ remoteInfo })
		plugin.afterLoadEntry({ remoteInfo })
		plugin.afterLoadEntry({ remoteInfo })

		expect(await attempt(plugin, 'loads')).toBe(`${ENTRY}?spool-retry=1`)
	})

	it('shares urls with every other host bundle on the page', async () => {
		const shell = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		const shellPlugin = entriesPlugin(shell)
		const staff = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		const staffPlugin = entriesPlugin(staff)

		await attempt(shellPlugin, 'fails')
		await attempt(staffPlugin, 'fails')
		expect(await attempt(staffPlugin, 'loads')).toBe(`${ENTRY}?spool-retry=2`)

		// The shell imports the container staff evaluated, not one of its own.
		expect(await attempt(shellPlugin, 'loads')).toBe(`${ENTRY}?spool-retry=2`)
	})

	it('leaves script-type entries to the runtime', async () => {
		const instance = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		const plugin = entriesPlugin(instance)
		const script = { ...remoteInfo, type: 'var' }

		await plugin.loadEntry({ remoteInfo: script })
		plugin.afterLoadEntry({ remoteInfo: script })

		expect(plugin.loadEntry({ remoteInfo: script })).toBeUndefined()
	})
})

/*
 *   RE-REGISTERING
 ***************************************************************************************************/
describe('generated load.ts: forceReregister', () => {
	it('re-registers a remote whose entry failed, found by its alias', async () => {
		const instance = installInstance([assessments])
		cacheModule(instance)
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
		instance.moduleCache.set('staff', { remoteInfo: { entry: ENTRY } })
		const { forceReregister } = await freshLoad()

		forceReregister('staff')

		expect(instance.registerRemotes).toHaveBeenCalledExactlyOnceWith([staff], { force: true })
	})

	it('leaves a remote that never got as far as its entry', async () => {
		const instance = installInstance([assessments])
		const { forceReregister } = await freshLoad()

		forceReregister('assessments')

		expect(instance.registerRemotes).not.toHaveBeenCalled()
	})

	it('leaves a remote whose entry loaded, so a failed expose does not tear it down', async () => {
		const instance = installInstance([assessments])
		cacheModule(instance, {})
		const { forceReregister } = await freshLoad()

		forceReregister('assessments/NewAssessment')

		expect(instance.registerRemotes).not.toHaveBeenCalled()
	})

	it('leaves a remote another host on the page has since loaded', async () => {
		const staff = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		await attempt(entriesPlugin(staff), 'loads')

		const shell = installInstance([assessments])
		cacheModule(shell)
		;(await freshLoad()).forceReregister('assessments')

		expect(shell.registerRemotes).not.toHaveBeenCalled()
	})

	it('leaves a remote whose entry another host is loading', async () => {
		const staff = installInstance([assessments])
		await (await freshLoad()).loadRemote('assessments', () => Promise.resolve({}))
		await entriesPlugin(staff).loadEntry({ remoteInfo })

		const shell = installInstance([assessments])
		cacheModule(shell)
		;(await freshLoad()).forceReregister('assessments')

		expect(shell.registerRemotes).not.toHaveBeenCalled()
	})

	it('does nothing for a remote the runtime does not know, or with no runtime', async () => {
		const instance = installInstance([assessments])
		cacheModule(instance)
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

	it('asks the runtime once the import has failed, re-registering a failed entry first', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importRemote = vi.fn(() => {
			cacheModule(instance)
			return Promise.reject(new Error('Failed to fetch remoteEntry.js'))
		})

		await expect(loadRemote('assessments/NewAssessment', importRemote)).rejects.toThrow(
			'Failed to fetch remoteEntry.js'
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

	it('retries a failed manifest through the runtime without re-registering', async () => {
		const instance = installInstance([assessments])
		const { loadRemote } = await freshLoad()
		const importRemote = failingImport()

		await loadRemote('assessments/App', importRemote).catch(() => undefined)
		await loadRemote('assessments/App', importRemote)

		expect(instance.loadRemote).toHaveBeenCalledOnce()
		expect(instance.registerRemotes).not.toHaveBeenCalled()
	})

	it('retries a failed expose of a loaded remote without re-registering it', async () => {
		const instance = installInstance([assessments])
		cacheModule(instance, {})
		const { loadRemote } = await freshLoad()
		const importExpose = vi.fn(() => Promise.reject(new Error('Failed to fetch expose')))

		await loadRemote('assessments/NewAssessment', importExpose).catch(() => undefined)
		await loadRemote('assessments/App', () => Promise.resolve({ default: 'app' }))
		await expect(loadRemote('assessments/NewAssessment', importExpose)).resolves.toEqual({
			default: 'runtime:assessments/NewAssessment',
		})

		expect(instance.registerRemotes).not.toHaveBeenCalled()
	})

	it('does not re-register a remote while one of its loads is still in flight', async () => {
		const instance = installInstance([assessments])
		cacheModule(instance)
		const { loadRemote, forceReregister } = await freshLoad()
		let finish!: () => void
		instance.loadRemote.mockImplementationOnce(
			() =>
				new Promise(resolve => {
					finish = () => resolve({ default: 'runtime' })
				})
		)
		const failed = () => Promise.reject(new Error('Failed to fetch remoteEntry.js'))
		await loadRemote('assessments', failed).catch(() => undefined)
		await loadRemote('assessments/NewAssessment', failed).catch(() => undefined)
		instance.registerRemotes.mockClear()

		const first = loadRemote('assessments', failed)
		forceReregister('assessments/NewAssessment')
		const second = loadRemote('assessments/NewAssessment', failed)
		finish()
		await Promise.all([first, second])

		expect(instance.registerRemotes).toHaveBeenCalledOnce()
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
