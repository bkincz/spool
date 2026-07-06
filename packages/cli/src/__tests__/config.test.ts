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

	it('rejects an unsupported schema version with an upgrade hint', () => {
		expect(() => parseManifest({ name: 'acme', version: 2, apps: {} })).toThrow('Upgrade spool')
	})

	it('rejects an unknown top-level key instead of silently dropping it', () => {
		expect(() => parseManifest({ name: 'acme', apps: {}, sharde: ['react'] })).toThrow(/sharde/)
	})

	it('rejects a typoed app key such as "expose"', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { dash: { ...remote(), expose: { './App': './src/App.tsx' } } },
			})
		).toThrow(/expose/)
	})

	it('accepts a deploy command on any app and rejects a non-string one', () => {
		const ok = parseManifest({
			name: 'acme',
			apps: { dash: { ...remote(), deploy: 'wrangler pages deploy dist' } },
		})
		expect(ok.apps.dash?.deploy).toBe('wrangler pages deploy dist')
		expect(() =>
			parseManifest({ name: 'acme', apps: { dash: { ...remote(), deploy: 42 } } })
		).toThrow(/apps\.dash\.deploy/)
	})

	it('accepts a deployed url on a remote and rejects a malformed one', () => {
		const ok = parseManifest({
			name: 'acme',
			apps: { dash: { ...remote(), url: 'https://cdn.example.com/mf-manifest.json' } },
		})
		expect(ok.apps.dash?.url).toBe('https://cdn.example.com/mf-manifest.json')
		expect(() =>
			parseManifest({ name: 'acme', apps: { dash: { ...remote(), url: 'not a url' } } })
		).toThrow()
	})

	it('reports the offending path in a readable message', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { dash: { ...remote(), port: 'high' } } })
		).toThrow(/apps\.dash\.port/)
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
