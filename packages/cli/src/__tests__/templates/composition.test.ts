/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { transform } from 'esbuild'
import { federationFiles } from '../../core/templates/composition.js'
import { host, remote, makeManifest } from '../helpers.js'
import type { AddonName, Manifest } from '../../core/config.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
function reactPrimitive(addons: AddonName[] = ['federation']): string {
	const manifest = makeManifest({
		shell: host({ remotes: ['browse'] }),
		browse: remote({ path: 'apps/browse' }),
	})
	manifest.addons = addons

	return federationFiles(manifest, manifest.apps.shell!)['src/federation/remote.tsx']!
}

function framework(name: 'svelte' | 'vue'): string {
	const manifest = makeManifest({
		shell: host({ framework: name, remotes: ['browse'] }),
		browse: remote({ framework: name, path: 'apps/browse' }),
	})
	manifest.addons = ['federation']
	const file = name === 'svelte' ? 'src/federation/Remote.svelte' : 'src/federation/Remote.vue'

	return federationFiles(manifest, manifest.apps.shell!)[file]!
}

/*
 *   REMOTE FAILURE HANDLING
 ***************************************************************************************************/
describe('<Remote> failure handling', () => {
	it('wraps the react primitive in an error boundary', () => {
		const source = reactPrimitive()

		expect(source).toContain('class RemoteBoundary')
		expect(source).toContain('getDerivedStateFromError')
		expect(source).toContain('componentDidCatch')
	})

	it('drops the cached lazy wrapper when retrying', () => {
		expect(reactPrimitive()).toContain('delete cache[name]')
	})

	it('rethrows a failed mount-contract load during render', () => {
		const source = reactPrimitive()

		expect(source).toContain('if (failure) throw failure')
		expect(source).toContain('setFailure(asError(cause))')
	})

	it('reports to sentry only when that addon is on', () => {
		expect(reactPrimitive(['federation', 'sentry'])).toContain('@sentry/react')
		expect(reactPrimitive(['federation', 'sentry'])).toContain('Sentry.captureException')
		expect(reactPrimitive()).not.toContain('Sentry')
	})

	it('lets the host replace the failure UI and observe the error', () => {
		const source = reactPrimitive()

		expect(source).toContain('renderError')
		expect(source).toContain('onError')
	})

	it('catches a failed load in the svelte and vue primitives', () => {
		for (const source of [framework('svelte'), framework('vue')]) {
			expect(source).toContain('catch (cause)')
			expect(source).toContain('Try again')
		}
	})

	it('emits react source that actually compiles', async () => {
		const source = reactPrimitive(['federation', 'sentry'])

		await expect(transform(source, { loader: 'tsx', jsx: 'automatic' })).resolves.toBeDefined()
	})

	it('drops the runtime-cached remote before retrying, in every framework', () => {
		expect(reactPrimitive()).toContain('forceReregister(name)')
		expect(framework('svelte')).toContain('forceReregister(name)')
		expect(framework('vue')).toContain('forceReregister(attrs.name)')
	})

	it('guards the svelte and vue swap against a race with a cancellation token', () => {
		for (const source of [framework('svelte'), framework('vue')]) {
			expect(source).toContain('swapToken')
			expect(source).toContain('if (token !== swapToken) return')
		}
	})

	it('warns once in dev for an unknown remote name', () => {
		expect(reactPrimitive()).toContain('warnUnknownRemote')
		for (const source of [framework('svelte'), framework('vue')]) {
			expect(source).toContain('no remote named')
		}
	})
})

/*
 *   PROPS FORWARDING
 ***************************************************************************************************/
describe('<Remote> props', () => {
	it('makes Remote generic and spreads props onto the component contract', () => {
		const source = reactPrimitive()
		expect(source).toContain('export interface RemoteProps<P extends Record<string, unknown>')
		expect(source).toContain('export function Remote<P extends Record<string, unknown>')
		expect(source).toContain('<View {...(props ?? {})} />')
	})

	it('forwards props as mount(el, props) on the mount contract', () => {
		const source = reactPrimitive()
		expect(source).toContain('mount(ref.current, latestProps.current)')
	})

	it('honours fallback while a mount-contract remote is still loading', () => {
		const source = reactPrimitive()
		expect(source).toContain('{ready ? null : fallback}')
	})
})

/*
 *   RUNTIME OVERRIDES
 ***************************************************************************************************/
describe('src/federation/overrides.ts', () => {
	function overridesFile(overrides: boolean): string {
		const manifest: Manifest = makeManifest({
			shell: host({ remotes: ['browse'] }),
			browse: remote({ path: 'apps/browse' }),
		})
		manifest.addons = ['federation']
		manifest.overrides = overrides
		return federationFiles(manifest, manifest.apps.shell!)['src/federation/overrides.ts']!
	}

	it('is always on in dev, and never reads the query string', () => {
		const source = overridesFile(false)
		expect(source).toContain('import.meta.env.DEV')
		expect(source).not.toContain('location.search')
		expect(source).not.toContain('URLSearchParams')
	})

	it('gates production on the manifest overrides flag', () => {
		expect(overridesFile(false)).toContain('import.meta.env.DEV || false')
		expect(overridesFile(true)).toContain('import.meta.env.DEV || true')
	})

	it('exposes console helpers to set and list overrides', () => {
		const source = overridesFile(false)
		expect(source).toContain('export function setRemoteOverride(')
		expect(source).toContain('export function listRemoteOverrides(')
		expect(source).toContain('localStorage.setItem(overrideKey(name), url)')
	})

	it('barrels the console helpers and preloadRemote from src/federation', () => {
		const manifest = makeManifest({
			shell: host({ remotes: ['browse'] }),
			browse: remote({ path: 'apps/browse' }),
		})
		manifest.addons = ['federation']
		const barrel = federationFiles(manifest, manifest.apps.shell!)['src/federation/index.ts']!
		expect(barrel).toContain(
			'export { setRemoteOverride, listRemoteOverrides } from "./overrides"'
		)
		expect(barrel).toContain(
			'export { remotes, type RemoteEntry, preloadRemote } from "./remotes"'
		)
	})
})
