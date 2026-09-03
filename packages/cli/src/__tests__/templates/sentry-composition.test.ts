/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { ADDONS, templateExtras } from '../../core/addons.js'
import {
	sentryFiles,
	sentryEnvFiles,
	sentryVitePlugin,
	sentryNotes,
} from '../../core/templates/sentry.js'
import { remotesRegistry, federationNotes } from '../../core/templates/composition.js'
import { NO_EXTRAS } from '../../core/templates/index.js'
import { appFiles, hostWiringFiles } from '../../core/generators.js'
import { validateDsn } from '../../commands/create.js'
import { host, remote, makeManifest } from '../helpers.js'

import type { Manifest } from '../../core/config.js'

/** The two addons that used to be one, merged so path assertions stay in one place. */
const compositionFiles = (m: Manifest) => ({
	...ADDONS.navigation.files(m),
	...ADDONS.federation.files(m),
})

/*
 *   DSN VALIDATION
 ***************************************************************************************************/
describe('validateDsn', () => {
	it('accepts a blank or undefined value (skip) and a well-formed DSN', () => {
		expect(validateDsn('')).toBeUndefined()
		expect(validateDsn(undefined)).toBeUndefined()
		expect(validateDsn('https://key@o1.ingest.sentry.io/42')).toBeUndefined()
	})

	it('rejects a value that is not a DSN', () => {
		expect(validateDsn('not-a-dsn')).toMatch(/Sentry DSN/)
	})
})

/*
 *   TEMPLATE EXTRAS
 ***************************************************************************************************/
describe('templateExtras', () => {
	it('flags sentry and shell from the addon list', () => {
		expect(templateExtras(['sentry'])).toMatchObject({ sentry: true, composed: false })
		expect(templateExtras(['federation'])).toMatchObject({ sentry: false, composed: true })
	})
})

/*
 *   SENTRY
 ***************************************************************************************************/
describe('sentry addon', () => {
	const mixed = makeManifest({
		shell: host({ remotes: ['dash'] }),
		dash: remote({ path: 'apps/dash', framework: 'vue' }),
	})

	it('is available anywhere and enables through the manifest', () => {
		const m = makeManifest({ shell: host() })
		expect(ADDONS.sentry.unavailable(m)).toBeUndefined()
		ADDONS.sentry.apply?.(m)
		expect(m.addons).toContain('sentry')
		expect(ADDONS.sentry.present('', m)).toBe(true)
		ADDONS.sentry.apply?.(m)
		expect(m.addons.filter(a => a === 'sentry')).toHaveLength(1)
	})

	it('writes an init per app with the framework SDK and app tag', () => {
		const files = sentryFiles(mixed)
		expect(files['apps/shell/src/sentry.ts']).toContain('@sentry/react')
		expect(files['apps/shell/src/sentry.ts']).toContain('mfe: "shell"')
		const vue = files['apps/dash/src/sentry.ts']!
		expect(vue).toContain('@sentry/vue')
		expect(vue).toContain('initSentry(app: App)')
	})

	it('writes one shared DSN into every app .env', () => {
		const env = sentryEnvFiles(mixed, 'https://k@o.ingest.sentry.io/1')
		expect(env['apps/shell/.env']).toBe('VITE_SENTRY_DSN=https://k@o.ingest.sentry.io/1\n')
		expect(env['apps/dash/.env']).toBeDefined()
	})

	it('gates the vite plugin on the auth token', () => {
		const plugin = sentryVitePlugin()
		expect(plugin.importLine).toContain('@sentry/vite-plugin')
		expect(plugin.entry).toContain('process.env.SENTRY_AUTH_TOKEN')
	})

	it('has distinct notes for create and retroactive add', () => {
		expect(sentryNotes(true)[0]).toContain('.env')
		expect(sentryNotes(false)[0]).toContain('initSentry')
	})

	it('adds the SDK, the vite plugin, and sourcemaps to an app', () => {
		const m = makeManifest({ shell: host() })
		ADDONS.sentry.apply?.(m)
		const files = appFiles(m, 'shell', m.apps.shell!)
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies['@sentry/react']).toBeDefined()
		expect(pkg.devDependencies['@sentry/vite-plugin']).toBeDefined()
		expect(files['vite.config.ts']).toContain('sentryVitePlugin')
		expect(files['vite.config.ts']).toContain('sourcemap: true')
	})

	it('leaves the vite config untouched without the addon', () => {
		const vite = appFiles(makeManifest({ shell: host() }), 'shell', host())['vite.config.ts']!
		expect(vite).not.toContain('sentryVitePlugin')
		expect(vite).not.toContain('sourcemap')
	})

	it('composes initSentry into every framework entry', () => {
		const extras = { ...NO_EXTRAS, sentry: true }
		const reactMain = appFiles(makeManifest({ shell: host() }), 'shell', host(), extras)[
			'src/main.tsx'
		]!
		expect(reactMain).toContain('initSentry()')
		const svelteMain = appFiles(
			makeManifest({ shell: host({ framework: 'svelte' }) }),
			'shell',
			host({ framework: 'svelte' }),
			extras
		)['src/main.ts']!
		expect(svelteMain).toContain('initSentry()')
		const vueMain = appFiles(
			makeManifest({ shell: host({ framework: 'vue' }) }),
			'shell',
			host({ framework: 'vue' }),
			extras
		)['src/main.ts']!
		expect(vueMain).toContain('initSentry(app)')
	})
})

/*
 *   COMPOSITION
 ***************************************************************************************************/
describe('navigation and federation addons', () => {
	const build = () =>
		makeManifest({
			shell: host({ remotes: ['browse'] }),
			browse: remote({ path: 'apps/browse', framework: 'svelte' }),
		})

	it('needs a host app', () => {
		expect(ADDONS.federation.unavailable(makeManifest({ solo: remote() }))).toMatch(/host/)
		expect(ADDONS.federation.unavailable(build())).toBeUndefined()
	})

	it('enables through the manifest without touching apps', () => {
		const m = build()
		const appsBefore = structuredClone(m.apps)
		ADDONS.navigation.apply?.(m)
		ADDONS.federation.apply?.(m)
		expect(m.addons).toContain('navigation')
		expect(m.addons).toContain('federation')
		expect(m.apps).toEqual(appsBefore)
	})

	it('writes the history substrate everywhere and the registry + primitive on hosts', () => {
		const m = build()
		const files = compositionFiles(m)
		expect(files['apps/shell/src/navigation/history.ts']).toContain(
			'export function matchRoute'
		)
		expect(files['apps/browse/src/navigation/location.ts']).toContain('svelte/store')
		expect(files['apps/shell/src/federation/remotes.ts']).toContain('import("browse/App")')
		expect(files['apps/shell/src/federation/remotes.ts']).toContain('contract: "mount"')
		expect(files['apps/shell/src/federation/remote.tsx']).toContain('export function Remote')
		// Remotes get the substrate but not the registry or primitive.
		expect(files['apps/browse/src/federation/remotes.ts']).toBeUndefined()
	})

	it('gives the react <Remote> no bridge and the svelte one a bridge for react remotes', () => {
		const reactHost = compositionFiles(build())['apps/shell/src/federation/remote.tsx']!
		expect(reactHost).not.toContain('mountReact')

		const svelteMixed = makeManifest({
			shell: host({ framework: 'svelte', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'react' }),
		})
		expect(compositionFiles(svelteMixed)['apps/shell/src/federation/Remote.svelte']).toContain(
			'mountReact'
		)

		const svelteOnly = makeManifest({
			shell: host({ framework: 'svelte', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'svelte' }),
		})
		expect(
			compositionFiles(svelteOnly)['apps/shell/src/federation/Remote.svelte']
		).not.toContain('mountReact')
	})

	it('generates the vue <Remote> and binding, with a bridge only for react remotes', () => {
		const withReact = makeManifest({
			shell: host({ framework: 'vue', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'react' }),
		})
		const files = compositionFiles(withReact)
		expect(files['apps/shell/src/federation/Remote.vue']).toContain('mountReact')
		expect(files['apps/shell/src/navigation/use-location.ts']).toContain('shallowRef')

		const noReact = makeManifest({
			shell: host({ framework: 'vue', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'svelte' }),
		})
		expect(compositionFiles(noReact)['apps/shell/src/federation/Remote.vue']).not.toContain(
			'mountReact'
		)
	})

	it('regenerates the registry and primitive for hosts only, never for remotes', () => {
		const m = build()
		ADDONS.navigation.apply?.(m)
		ADDONS.federation.apply?.(m)
		expect(hostWiringFiles(m, m.apps.shell!)['src/federation/remotes.ts']).toBeDefined()
		expect(hostWiringFiles(m, m.apps.browse!)['src/federation/remotes.ts']).toBeUndefined()
	})

	it('regenerates the primitive with a bridge once a react remote is wired in', () => {
		const m = makeManifest({
			shell: host({ framework: 'svelte', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'react' }),
		})
		m.addons.push('federation')
		expect(hostWiringFiles(m, m.apps.shell!)['src/federation/Remote.svelte']).toContain(
			'mountReact'
		)
	})

	it('replaces the host app with the starter shell that imports the split primitives', () => {
		const m = build()
		const shellHost = appFiles(m, 'shell', m.apps.shell!, { ...NO_EXTRAS, composed: true })[
			'src/app/app.tsx'
		]!
		expect(shellHost).toContain('matchRoute')
		expect(shellHost).toContain('<Remote name={active} />')
		expect(shellHost).toContain('from "@/navigation"')
		expect(shellHost).toContain('from "@/federation"')
	})

	it('barrels navigation everywhere and federation on hosts only', () => {
		const files = compositionFiles(build())

		const hostNav = files['apps/shell/src/navigation/index.ts']!
		expect(hostNav).toContain('export * from "./history"')
		expect(hostNav).toContain('export { useLocation } from "./use-location"')
		expect(hostNav).not.toContain('Remote')

		const hostFederation = files['apps/shell/src/federation/index.ts']!
		expect(hostFederation).toContain('export { Remote } from "./remote"')
		expect(hostFederation).toContain('export { remotes, type RemoteEntry } from "./remotes"')

		const remoteNav = files['apps/browse/src/navigation/index.ts']!
		expect(remoteNav).toContain('export { location } from "./location"')
		expect(files['apps/browse/src/federation/index.ts']).toBeUndefined()
	})

	it('re-exports the framework component the right way in the barrel', () => {
		const svelte = compositionFiles(makeManifest({ shell: host({ framework: 'svelte' }) }))
		expect(svelte['apps/shell/src/federation/index.ts']).toContain(
			'export { default as Remote } from "./Remote.svelte"'
		)
		const vue = compositionFiles(makeManifest({ shell: host({ framework: 'vue' }) }))
		expect(vue['apps/shell/src/federation/index.ts']).toContain(
			'export { default as Remote } from "./Remote.vue"'
		)
	})

	it('wires the @ alias into every app tsconfig and vite config', () => {
		const files = appFiles(build(), 'shell', build().apps.shell!)
		const tsconfig = JSON.parse(files['tsconfig.json']!)
		expect(tsconfig.compilerOptions.baseUrl).toBeUndefined()
		expect(tsconfig.compilerOptions.paths['@/*']).toEqual(['./src/*'])
		expect(files['vite.config.ts']).toContain('alias: { "@": resolvePath(import.meta.dirname')
	})

	it('has distinct notes for create and retroactive add', () => {
		expect(federationNotes(true)[0]).toContain('routed shell')
		expect(federationNotes(false)[0]).toContain('Remote')
	})
})

/*
 *   SHELL HOSTS PER FRAMEWORK
 ***************************************************************************************************/
describe('starter shell per framework', () => {
	const shell = { ...NO_EXTRAS, composed: true }
	const shellHost = (fw: 'svelte' | 'vue', remoteFw: 'react' | 'svelte') => {
		const m = makeManifest({
			shell: host({ framework: fw, remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: remoteFw }),
		})
		return appFiles(m, 'shell', m.apps.shell!, shell)[
			fw === 'svelte' ? 'src/app/app.svelte' : 'src/app/app.vue'
		]!
	}

	it('maps the first remote to "/" and drives the shared history', () => {
		for (const app of [shellHost('svelte', 'react'), shellHost('vue', 'svelte')]) {
			expect(app).toContain('matchRoute')
			expect(app).toContain('navigate')
			expect(app).toContain('"/": "r"')
		}
	})
})

/*
 *   REGISTRY
 ***************************************************************************************************/
describe('remotesRegistry', () => {
	it('records each remote by name with its contract and loader', () => {
		const registry = remotesRegistry([
			{ name: 'a', framework: 'react', contract: 'component' },
			{ name: 'b', framework: 'vue', contract: 'mount' },
		])
		expect(registry).toContain('"a": { contract: "component"')
		expect(registry).toContain('"b": { contract: "mount"')
		expect(registry).toContain('import("a/App")')
	})
})
