/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { ADDONS, templateExtras } from '../core/addons.js'
import {
	sentryFiles,
	sentryEnvFiles,
	sentryVitePlugin,
	sentryNotes,
} from '../core/templates/sentry.js'
import { remotesRegistry, shellNotes } from '../core/templates/shell.js'
import { NO_EXTRAS } from '../core/templates/index.js'
import { appFiles, hostWiringFiles } from '../core/generators.js'
import { validateDsn } from '../commands/create.js'
import { host, remote, makeManifest } from './helpers.js'

/*
 *   DSN VALIDATION
 ***************************************************************************************************/
describe('validateDsn', () => {
	it('accepts a blank value (skip) and a well-formed DSN', () => {
		expect(validateDsn('')).toBeUndefined()
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
		expect(templateExtras(['sentry'])).toMatchObject({ sentry: true, shell: false })
		expect(templateExtras(['shell'])).toMatchObject({ sentry: false, shell: true })
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
 *   SHELL
 ***************************************************************************************************/
describe('shell addon', () => {
	const build = () =>
		makeManifest({
			shell: host({ remotes: ['browse'] }),
			browse: remote({ path: 'apps/browse', framework: 'svelte' }),
		})

	it('needs a host app', () => {
		expect(ADDONS.shell.unavailable(makeManifest({ solo: remote() }))).toMatch(/host/)
		expect(ADDONS.shell.unavailable(build())).toBeUndefined()
	})

	it('enables through the manifest without touching apps', () => {
		const m = build()
		ADDONS.shell.apply?.(m)
		expect(m.addons).toContain('shell')
		expect(m.apps.browse).not.toHaveProperty('route')
	})

	it('writes the history substrate everywhere and the registry + primitive on hosts', () => {
		const m = build()
		const files = ADDONS.shell.files(m)
		expect(files['apps/shell/src/shell/history.ts']).toContain('export function matchRoute')
		expect(files['apps/browse/src/shell/location.ts']).toContain('svelte/store')
		expect(files['apps/shell/src/shell/remotes.ts']).toContain('import("browse/App")')
		expect(files['apps/shell/src/shell/remotes.ts']).toContain('contract: "mount"')
		expect(files['apps/shell/src/shell/remote.tsx']).toContain('export function Remote')
		// Remotes get the substrate but not the registry or primitive.
		expect(files['apps/browse/src/shell/remotes.ts']).toBeUndefined()
	})

	it('gives the react <Remote> no bridge and the svelte one a bridge for react remotes', () => {
		const reactHost = ADDONS.shell.files(build())['apps/shell/src/shell/remote.tsx']!
		expect(reactHost).not.toContain('mountReact')

		const svelteMixed = makeManifest({
			shell: host({ framework: 'svelte', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'react' }),
		})
		expect(ADDONS.shell.files(svelteMixed)['apps/shell/src/shell/Remote.svelte']).toContain(
			'mountReact'
		)

		const svelteOnly = makeManifest({
			shell: host({ framework: 'svelte', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'svelte' }),
		})
		expect(ADDONS.shell.files(svelteOnly)['apps/shell/src/shell/Remote.svelte']).not.toContain(
			'mountReact'
		)
	})

	it('generates the vue <Remote> and binding, with a bridge only for react remotes', () => {
		const withReact = makeManifest({
			shell: host({ framework: 'vue', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'react' }),
		})
		const files = ADDONS.shell.files(withReact)
		expect(files['apps/shell/src/shell/Remote.vue']).toContain('mountReact')
		expect(files['apps/shell/src/shell/use-location.ts']).toContain('shallowRef')

		const noReact = makeManifest({
			shell: host({ framework: 'vue', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'svelte' }),
		})
		expect(ADDONS.shell.files(noReact)['apps/shell/src/shell/Remote.vue']).not.toContain(
			'mountReact'
		)
	})

	it('regenerates the registry and primitive for hosts only, never for remotes', () => {
		const m = build()
		ADDONS.shell.apply?.(m)
		expect(hostWiringFiles(m, m.apps.shell!)['src/shell/remotes.ts']).toBeDefined()
		expect(hostWiringFiles(m, m.apps.browse!)['src/shell/remotes.ts']).toBeUndefined()
	})

	it('regenerates the primitive with a bridge once a react remote is wired in', () => {
		const m = makeManifest({
			shell: host({ framework: 'svelte', remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: 'react' }),
		})
		m.addons.push('shell')
		expect(hostWiringFiles(m, m.apps.shell!)['src/shell/Remote.svelte']).toContain('mountReact')
	})

	it('replaces the host app with the starter shell', () => {
		const m = build()
		const shellHost = appFiles(m, 'shell', m.apps.shell!, { ...NO_EXTRAS, shell: true })[
			'src/App.tsx'
		]!
		expect(shellHost).toContain('matchRoute')
		expect(shellHost).toContain('<Remote name={active} />')
		expect(shellHost).toContain('./shell/remote')
	})

	it('has distinct notes for create and retroactive add', () => {
		expect(shellNotes(true)[0]).toContain('routed shell')
		expect(shellNotes(false)[0]).toContain('Remote')
	})
})

/*
 *   SHELL HOSTS PER FRAMEWORK
 ***************************************************************************************************/
describe('starter shell per framework', () => {
	const shell = { ...NO_EXTRAS, shell: true }
	const shellHost = (fw: 'svelte' | 'vue', remoteFw: 'react' | 'svelte') => {
		const m = makeManifest({
			shell: host({ framework: fw, remotes: ['r'] }),
			r: remote({ path: 'apps/r', framework: remoteFw }),
		})
		return appFiles(m, 'shell', m.apps.shell!, shell)[
			fw === 'svelte' ? 'src/App.svelte' : 'src/App.vue'
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
