/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { ADDONS } from '../core/addons.js'
import { workspaceScripts } from '../core/generators.js'
import { rootDevDependencies } from '../core/versions.js'
import { host, remote, makeManifest } from './helpers.js'
import type { Manifest } from '../core/config.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
function workspace(addons: string[]): Manifest {
	const manifest = makeManifest({
		shell: host({ remotes: ['browse'] }),
		browse: remote({ path: 'apps/browse' }),
	})
	manifest.addons = addons
	return manifest
}

const config = (addons: string[] = ['turbo']) =>
	JSON.parse(ADDONS.turbo.files(workspace(addons))['turbo.json']!)

/*
 *   TURBO ADDON
 ***************************************************************************************************/
describe('turbo addon', () => {
	it('puts the manifest and helpers in the global hash', () => {
		expect(config().globalDependencies).toEqual([
			'spool.json',
			'spool.vite.ts',
			'spool.workspace.ts',
		])
	})

	it('declares the variables that change what a build emits', () => {
		const turbo = config()

		expect(turbo.globalEnv).toContain('SPOOL_ENV')
		expect(turbo.tasks.build.env).toContain('SPOOL_REMOTE_*')
		expect(turbo.tasks.build.env).toContain('VITE_*')
	})

	it('adds the sentry variables only with that addon', () => {
		expect(config(['turbo', 'sentry']).tasks.build.env).toContain('SENTRY_AUTH_TOKEN')
		expect(config().tasks.build.env).not.toContain('SENTRY_AUTH_TOKEN')
	})

	it('hashes env files on top of the default inputs', () => {
		expect(config().tasks.build.inputs).toEqual(['$TURBO_DEFAULT$', '.env', '.env.*'])
	})

	it('caches builds and never the long-running tasks', () => {
		const { tasks } = config()

		expect(tasks.build.outputs).toEqual(['dist/**'])
		expect(tasks.dev).toEqual({ cache: false, persistent: true })
		expect(tasks.preview).toEqual({ cache: false, persistent: true })
	})

	it('orders package dependencies without coupling hosts to remotes', () => {
		expect(config().tasks.build.dependsOn).toEqual(['^build'])
	})

	it('declares the tasks spool does not orchestrate', () => {
		const { tasks } = config()

		for (const task of ['type-check', 'test', 'lint']) {
			expect(tasks[task]).toBeDefined()
		}
	})

	it('adds turbo to the root only when enabled', () => {
		expect(rootDevDependencies(workspace(['turbo']))).toHaveProperty('turbo')
		expect(rootDevDependencies(workspace([]))).not.toHaveProperty('turbo')
	})

	it('leaves the spool scripts alone', () => {
		expect(workspaceScripts(workspace(['turbo'])).build).toBe('spool build')
	})

	it('lets pnpm run the platform binary postinstall', () => {
		expect(ADDONS.turbo.allowBuilds).toContain('turbo')
	})
})
