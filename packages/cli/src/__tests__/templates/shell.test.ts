/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { transform } from 'esbuild'
import { shellHostFiles } from '../../core/templates/shell.js'
import { host, remote, makeManifest } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
function reactPrimitive(addons: string[] = ['shell']): string {
	const manifest = makeManifest({
		shell: host({ remotes: ['browse'] }),
		browse: remote({ path: 'apps/browse' }),
	})
	manifest.addons = addons

	return shellHostFiles(manifest, manifest.apps.shell!)['src/shell/remote.tsx']!
}

function framework(name: 'svelte' | 'vue'): string {
	const manifest = makeManifest({
		shell: host({ framework: name, remotes: ['browse'] }),
		browse: remote({ framework: name, path: 'apps/browse' }),
	})
	manifest.addons = ['shell']
	const file = name === 'svelte' ? 'src/shell/Remote.svelte' : 'src/shell/Remote.vue'

	return shellHostFiles(manifest, manifest.apps.shell!)[file]!
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
		expect(reactPrimitive(['shell', 'sentry'])).toContain('@sentry/react')
		expect(reactPrimitive(['shell', 'sentry'])).toContain('Sentry.captureException')
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
		const source = reactPrimitive(['shell', 'sentry'])

		await expect(transform(source, { loader: 'tsx', jsx: 'automatic' })).resolves.toBeDefined()
	})
})
