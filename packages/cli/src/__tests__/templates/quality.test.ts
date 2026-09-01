/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { transform } from 'esbuild'
import { ADDONS } from '../../core/addons.js'
import { appFiles, hostWiringFiles, workspaceScripts } from '../../core/generators.js'
import { ALIAS_FILE } from '../../core/templates/quality.js'
import { appDependencies, rootDevDependencies } from '../../core/versions.js'
import { host, remote, makeManifest } from '../helpers.js'
import type { Manifest } from '../../core/config.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
function workspace(addons: string[], overrides: Parameters<typeof makeManifest>[0] = {}): Manifest {
	const manifest = makeManifest({
		shell: host({ remotes: ['browse'] }),
		browse: remote({ path: 'apps/browse' }),
		...overrides,
	})
	manifest.addons = addons
	return manifest
}

const parses = (source: string, loader: 'ts' | 'tsx' = 'ts') =>
	transform(source, { loader, jsx: 'automatic' })

/*
 *   TYPE CHECK
 ***************************************************************************************************/
describe('type-check wiring', () => {
	it('gives every app and the root a type-check script', () => {
		const manifest = workspace([])
		const app = JSON.parse(appFiles(manifest, 'browse', manifest.apps.browse!)['package.json']!)

		expect(app.scripts['type-check']).toBe('tsc --noEmit')
		expect(workspaceScripts(manifest)['type-check']).toBe('pnpm -r type-check')
	})

	it('spells the recursive run the way each package manager wants', () => {
		for (const [pm, expected] of [
			['npm', 'npm run type-check --workspaces --if-present'],
			['yarn', 'yarn workspaces foreach -A run type-check'],
		] as const) {
			const manifest = workspace([])
			manifest.packageManager = pm

			expect(workspaceScripts(manifest)['type-check']).toBe(expected)
		}
	})
})

/*
 *   LINT ADDON
 ***************************************************************************************************/
describe('lint addon', () => {
	it('writes one flat config that compiles', async () => {
		const manifest = workspace(['lint'])
		const config = ADDONS.lint.files(manifest)['eslint.config.js']!

		expect(config).toContain('typescript-eslint')
		await expect(parses(config, 'tsx')).resolves.toBeDefined()
	})

	it('pulls in a plugin only for the frameworks in use', () => {
		const react = ADDONS.lint.files(workspace(['lint']))['eslint.config.js']!
		const mixed = ADDONS.lint.files(
			workspace(['lint'], { widget: remote({ framework: 'svelte', path: 'apps/widget' }) })
		)['eslint.config.js']!

		expect(react).toContain('eslint-plugin-react-hooks')
		expect(react).not.toContain('eslint-plugin-svelte')
		expect(mixed).toContain('eslint-plugin-svelte')
	})

	it('adds its deps and script only when enabled', () => {
		expect(rootDevDependencies(workspace(['lint']))).toHaveProperty('eslint')
		expect(rootDevDependencies(workspace([]))).not.toHaveProperty('eslint')
		expect(workspaceScripts(workspace(['lint'])).lint).toBe('eslint .')
		expect(workspaceScripts(workspace([])).lint).toBeUndefined()
	})
})

/*
 *   TEST ADDON
 ***************************************************************************************************/
describe('test addon', () => {
	it('stubs every remote a host consumes', () => {
		const manifest = workspace(['test'])
		const aliases = appFiles(manifest, 'shell', manifest.apps.shell!)[ALIAS_FILE]!

		expect(aliases).toContain('"browse/App": resolvePath')
		expect(aliases).toContain('remote-component.tsx')
	})

	it('writes a stub per contract, not per remote', () => {
		const manifest = workspace(['test'], {
			shell: host({ remotes: ['browse', 'widget'] }),
			browse: remote({ path: 'apps/browse' }),
			widget: remote({ framework: 'svelte', path: 'apps/widget' }),
		})
		const files = appFiles(manifest, 'shell', manifest.apps.shell!)

		expect(files['src/test/remote-component.tsx']).toBeDefined()
		expect(files['src/test/remote-mount.ts']).toBeDefined()
	})

	it('gives a remote a config with no stubs to alias', () => {
		const manifest = workspace(['test'])
		const files = appFiles(manifest, 'browse', manifest.apps.browse!)

		expect(files['vitest.config.ts']).toContain('"@": resolvePath')
		expect(files[ALIAS_FILE]).not.toContain('/App"')
	})

	it('regenerates a host config when its remotes change', () => {
		const manifest = workspace(['test'])
		manifest.apps.shell!.remotes = []
		const files = hostWiringFiles(manifest, manifest.apps.shell!)

		expect(files['vitest.config.ts']).toBeUndefined()
		expect(files[ALIAS_FILE]).toBeDefined()
		expect(files[ALIAS_FILE]).not.toContain('browse/App')
	})

	it('emits configs and stubs that compile', async () => {
		const manifest = workspace(['test'])
		const files = appFiles(manifest, 'shell', manifest.apps.shell!)

		await expect(parses(files['vitest.config.ts']!)).resolves.toBeDefined()
		await expect(parses(files[ALIAS_FILE]!)).resolves.toBeDefined()
		await expect(parses(files['src/test/remote-component.tsx']!, 'tsx')).resolves.toBeDefined()
	})

	it('adds its deps and scripts only when enabled', () => {
		const on = workspace(['test'])
		const off = workspace([])

		expect(appDependencies(on, on.apps.shell!).devDependencies).toHaveProperty('vitest')
		expect(appDependencies(on, on.apps.shell!).devDependencies).toHaveProperty(
			'@testing-library/react'
		)
		expect(appDependencies(off, off.apps.shell!).devDependencies).not.toHaveProperty('vitest')

		const scripts = JSON.parse(appFiles(on, 'shell', on.apps.shell!)['package.json']!).scripts
		expect(scripts['test:run']).toBe('vitest run')
	})

	it('picks the testing library for each app’s framework', () => {
		const manifest = workspace(['test'], {
			widget: remote({ framework: 'svelte', path: 'apps/widget' }),
		})
		const deps = appDependencies(manifest, manifest.apps.widget!).devDependencies

		expect(deps).toHaveProperty('@testing-library/svelte')
		expect(deps).not.toHaveProperty('@testing-library/react')
	})
})
