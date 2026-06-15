/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import {
	MANIFEST_FILE,
	parseManifest,
	emptyManifest,
	appPort,
	validateName,
	type AppConfig,
} from '../core/config.js'
import { host, remote } from './helpers.js'

/*
 *   MANIFEST FILE
 ***************************************************************************************************/
describe('MANIFEST_FILE', () => {
	it('is spool.json', () => {
		expect(MANIFEST_FILE).toBe('spool.json')
	})
})

/*
 *   EMPTY MANIFEST
 ***************************************************************************************************/
describe('emptyManifest', () => {
	it('applies the schema defaults', () => {
		const manifest = emptyManifest('acme')
		expect(manifest).toEqual({
			name: 'acme',
			version: 1,
			packageManager: 'pnpm',
			bundler: 'vite',
			shared: ['react', 'react-dom'],
			apps: {},
		})
	})
})

/*
 *   PARSE MANIFEST
 ***************************************************************************************************/
describe('parseManifest', () => {
	it('fills per-app defaults for remotes and exposes', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: { shell: { type: 'host', path: 'apps/shell', port: 5173 } },
		})
		expect(manifest.apps.shell).toEqual({
			type: 'host',
			path: 'apps/shell',
			port: 5173,
			remotes: [],
			exposes: {},
		})
	})

	it('rejects a missing name', () => {
		expect(() => parseManifest({ apps: {} })).toThrow()
	})

	it('rejects an unknown app type', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { x: { type: 'widget', path: 'apps/x', port: 1 } },
			})
		).toThrow()
	})

	it('rejects a non-integer port', () => {
		expect(() => parseManifest({ name: 'acme', apps: { x: host({ port: 1.5 }) } })).toThrow()
	})

	it('rejects a negative port', () => {
		expect(() => parseManifest({ name: 'acme', apps: { x: host({ port: -1 }) } })).toThrow()
	})

	it('rejects an unsupported schema version', () => {
		expect(() => parseManifest({ name: 'acme', version: 2, apps: {} })).toThrow()
	})

	it('rejects a name with a path traversal segment', () => {
		expect(() => parseManifest({ name: '../evil', apps: {} })).toThrow()
	})

	it('rejects an app key that is not a safe name', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { 'a/b': host({ port: 5173 }) } })
		).toThrow()
	})

	it('rejects a port above the valid range', () => {
		expect(() => parseManifest({ name: 'acme', apps: { x: host({ port: 70000 }) } })).toThrow()
	})
})

/*
 *   VALIDATE NAME
 ***************************************************************************************************/
describe('validateName', () => {
	it('accepts lowercase, digits and single hyphens', () => {
		for (const name of ['acme', 'dashboard', 'acme-frontend', 'app1', 'a']) {
			expect(validateName(name)).toBeUndefined()
		}
	})

	it('rejects empty, spaces, slashes, traversal, uppercase and leading digits', () => {
		for (const name of ['', '  ', 'Bad', 'a b', 'a/b', '../x', '1app', '-x', 'x-']) {
			expect(validateName(name)).toBeDefined()
		}
	})

	it('labels the offending value in the message', () => {
		expect(validateName('Bad Name', 'app name')).toContain('Invalid app name')
	})
})

/*
 *   APP PORT
 ***************************************************************************************************/
describe('appPort', () => {
	it('returns the port of a known app', () => {
		const manifest = parseManifest({ name: 'acme', apps: { dashboard: remote() } })
		expect(appPort(manifest, 'dashboard')).toBe(5174)
	})

	it('throws a helpful error for an unknown app', () => {
		const manifest = emptyManifest('acme')
		expect(() => appPort(manifest, 'ghost')).toThrow('No app named "ghost"')
	})
})

/*
 *   TYPES
 ***************************************************************************************************/
describe('AppConfig typing', () => {
	it('accepts host and remote shapes from the factories', () => {
		const apps: AppConfig[] = [host(), remote()]
		expect(apps).toHaveLength(2)
	})
})
