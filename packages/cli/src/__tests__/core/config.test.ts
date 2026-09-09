/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi } from 'vitest'
import {
	MANIFEST_FILE,
	parseManifest,
	emptyManifest,
	appPort,
	validateName,
	type AppConfig,
} from '../../core/config.js'
import { log } from '../../util/logger.js'
import { host, remote } from '../helpers.js'

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
			shareStrategy: 'loaded-first',
			addons: [],
			apps: {},
			overrides: false,
		})
	})
})

/*
 *   PARSE MANIFEST
 ***************************************************************************************************/
describe('parseManifest', () => {
	it('rejects the rspack bundler with a friendly message', () => {
		expect(() => parseManifest({ name: 'acme', bundler: 'rspack', apps: {} })).toThrow(
			'not supported yet'
		)
	})

	it('accepts per-environment urls on a remote', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: {
				dash: {
					...remote(),
					urls: { staging: 'https://staging.example.com/mf-manifest.json' },
				},
			},
		})
		expect(manifest.apps.dash!.urls).toEqual({
			staging: 'https://staging.example.com/mf-manifest.json',
		})
	})

	it('rejects a urls entry that is not a url', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { dash: { ...remote(), urls: { staging: 'not-a-url' } } },
			})
		).toThrow('Invalid')
	})

	it('fills per-app defaults for remotes and exposes', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: { shell: { type: 'host', path: 'apps/shell', port: 5173 } },
		})
		expect(manifest.apps.shell).toEqual({
			type: 'host',
			framework: 'react',
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
				apps: { dash: { ...remote(), expose: { './App': './src/app/app.tsx' } } },
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
 *   NEW SCHEMA FIELDS
 ***************************************************************************************************/
describe('headers, frameAncestors and overrides', () => {
	it('accepts per-app headers and frameAncestors', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: {
				shell: {
					...host(),
					headers: { 'X-Frame-Options': 'DENY' },
					frameAncestors: ['self'],
				},
			},
		})
		expect(manifest.apps.shell!.headers).toEqual({ 'X-Frame-Options': 'DENY' })
		expect(manifest.apps.shell!.frameAncestors).toEqual(['self'])
	})

	it('rejects a non-string header value', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { shell: { ...host(), headers: { 'X-Test': 42 } } },
			})
		).toThrow()
	})

	it('defaults overrides to false and accepts an explicit true', () => {
		expect(emptyManifest('acme').overrides).toBe(false)
		expect(parseManifest({ name: 'acme', apps: {}, overrides: true }).overrides).toBe(true)
	})
})

/*
 *   ADDONS
 ***************************************************************************************************/
describe('addons', () => {
	it('accepts every known addon name', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: {},
			addons: [
				'navigation',
				'federation',
				'sentry',
				'test',
				'lint',
				'turbo',
				'state',
				'ladle',
				'playwright',
			],
		})
		expect(manifest.addons).toHaveLength(9)
	})

	it('rejects an unknown addon name', () => {
		expect(() => parseManifest({ name: 'acme', apps: {}, addons: ['bogus'] })).toThrow()
	})

	it('normalises the retired "shell" alias into navigation and federation, with one warning', () => {
		const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
		const manifest = parseManifest({ name: 'acme', apps: {}, addons: ['shell'] })

		expect(manifest.addons).toEqual(['navigation', 'federation'])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('shell'))
	})

	it('does not duplicate navigation/federation already listed alongside "shell"', () => {
		vi.spyOn(log, 'warn').mockImplementation(() => {})
		const manifest = parseManifest({ name: 'acme', apps: {}, addons: ['shell', 'federation'] })

		expect(manifest.addons).toEqual(['federation', 'navigation'])
	})
})

/*
 *   PATH CONFINEMENT
 ***************************************************************************************************/
describe('app path confinement', () => {
	it('rejects an absolute path', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { shell: { ...host(), path: '/etc/apps/shell' } } })
		).toThrow(/invalid path/)
	})

	it('rejects a path with a ".." segment', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { shell: { ...host(), path: '../outside' } } })
		).toThrow(/invalid path/)
	})

	it('rejects a trailing slash', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { shell: { ...host(), path: 'apps/shell/' } } })
		).toThrow(/invalid path/)
	})

	it('names the offending app in the message', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { shell: { ...host(), path: '..' } } })
		).toThrow(/App "shell"/)
	})
})

/*
 *   REMOTES VALIDATION
 ***************************************************************************************************/
describe('remotes validation', () => {
	it('rejects an app that lists itself as a remote', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { shell: host({ remotes: ['shell'] }) } })
		).toThrow(/lists itself/)
	})

	it('rejects a remote listed twice', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: {
					shell: host({ remotes: ['dashboard', 'dashboard'] }),
					dashboard: remote(),
				},
			})
		).toThrow(/more than once/)
	})

	it('rejects a remote that is not in the manifest', () => {
		expect(() =>
			parseManifest({ name: 'acme', apps: { shell: host({ remotes: ['ghost'] }) } })
		).toThrow(/not in this workspace/)
	})

	it('detects and reports a two-app cycle', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: {
					a: remote({ path: 'apps/a', port: 1, remotes: ['b'] }),
					b: remote({ path: 'apps/b', port: 2, remotes: ['a'] }),
				},
			})
		).toThrow(/cycle: a -> b -> a/)
	})

	it('allows a remote that consumes another remote, with no cycle', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: {
				shell: host({ remotes: ['dashboard'] }),
				dashboard: remote({ remotes: ['widget'] }),
				widget: remote({ path: 'apps/widget', port: 5175 }),
			},
		})
		expect(manifest.apps.dashboard!.remotes).toEqual(['widget'])
	})
})

/*
 *   EXPOSES VALIDATION
 ***************************************************************************************************/
describe('exposes validation', () => {
	it('rejects a key that does not start with "./"', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { dash: { ...remote(), exposes: { App: './src/app/app.tsx' } } },
			})
		).toThrow(/must start with/)
	})

	it('rejects a source that escapes the app folder', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { dash: { ...remote(), exposes: { './App': '../shared/App.tsx' } } },
			})
		).toThrow(/must stay inside/)
	})

	it('rejects an absolute source', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { dash: { ...remote(), exposes: { './App': '/abs/App.tsx' } } },
			})
		).toThrow(/must stay inside/)
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

describe('frameAncestors edge token', () => {
	it('accepts edge on its own', () => {
		const manifest = parseManifest({
			name: 'acme',
			apps: { shell: { ...host(), frameAncestors: ['edge'] } },
		})
		expect(manifest.apps.shell!.frameAncestors).toEqual(['edge'])
	})

	it('rejects edge mixed with origins', () => {
		expect(() =>
			parseManifest({
				name: 'acme',
				apps: { shell: { ...host(), frameAncestors: ['edge', 'https://a.test'] } },
			})
		).toThrow(/stands alone/)
	})
})
