/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { workspaceFiles, appFiles, hostWiringFiles } from '../core/generators.js'
import { parseManifest, type Manifest } from '../core/config.js'
import { host, remote, makeManifest } from './helpers.js'

/*
 *   FIXTURES
 ***************************************************************************************************/
const manifest = (): Manifest =>
	makeManifest({
		shell: host({ remotes: ['dashboard'] }),
		dashboard: remote(),
	})

/*
 *   WORKSPACE FILES
 ***************************************************************************************************/
describe('workspaceFiles', () => {
	const files = workspaceFiles(manifest())

	it('generates the expected root files', () => {
		expect(Object.keys(files).sort()).toEqual(
			[
				'.gitignore',
				'.prettierignore',
				'.prettierrc',
				'README.md',
				'package.json',
				'pnpm-workspace.yaml',
				'spool.json',
				'spool.vite.ts',
				'tsconfig.base.json',
				'tsconfig.json',
			].sort()
		)
	})

	it('ships the runtime helper that reads spool.json at config load time', () => {
		const helper = files['spool.vite.ts']!
		expect(helper).toContain('export function spoolApp')
		expect(helper).toContain('spool.json')
		expect(helper).toContain('SPOOL_REMOTE_')
		expect(helper).toContain('mf-manifest.json')
	})

	it('writes spool.json as the manifest', () => {
		expect(JSON.parse(files['spool.json']!)).toEqual(manifest())
	})

	it('emits valid JSON for every json file', () => {
		for (const name of ['spool.json', 'package.json', 'tsconfig.base.json', '.prettierrc']) {
			expect(() => JSON.parse(files[name]!)).not.toThrow()
		}
	})

	it('ships the house prettier config', () => {
		const prettier = JSON.parse(files['.prettierrc']!)
		expect(prettier).toMatchObject({
			useTabs: true,
			semi: false,
			singleQuote: true,
			tabWidth: 4,
		})
	})

	it('allows the esbuild build script for both pnpm 10 and 11', () => {
		expect(files['pnpm-workspace.yaml']).toContain('allowBuilds:')
		expect(files['pnpm-workspace.yaml']).toContain('esbuild: true')
		expect(files['pnpm-workspace.yaml']).toContain('onlyBuiltDependencies:')
		expect(files['pnpm-workspace.yaml']).toContain('- esbuild')
		expect(files['pnpm-workspace.yaml']).toContain('apps/*')
	})

	it('does not add the cli as a workspace dependency', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.devDependencies?.['@bkincz/spool']).toBeUndefined()
		expect(pkg.scripts).toMatchObject({ dev: 'spool dev', build: 'spool build' })
	})

	it('names the workspace in the readme', () => {
		expect(files['README.md']).toContain('# acme')
	})

	it('uses pnpm-workspace.yaml and a pnpm install hint for pnpm', () => {
		expect(files['pnpm-workspace.yaml']).toBeDefined()
		expect(JSON.parse(files['package.json']!).workspaces).toBeUndefined()
		expect(files['README.md']).toContain('pnpm install')
	})
})

/*
 *   WORKSPACE FILES - NPM / YARN
 ***************************************************************************************************/
describe.each(['npm', 'yarn'] as const)('workspaceFiles (%s)', pm => {
	const files = workspaceFiles(
		parseManifest({
			name: 'acme',
			packageManager: pm,
			apps: { shell: host({ remotes: ['dashboard'] }), dashboard: remote() },
		})
	)

	it('declares workspaces in package.json instead of pnpm-workspace.yaml', () => {
		expect(files['pnpm-workspace.yaml']).toBeUndefined()
		expect(JSON.parse(files['package.json']!).workspaces).toEqual(['apps/*', 'packages/*'])
	})

	it('uses the chosen package manager in the readme install hint', () => {
		expect(files['README.md']).toContain(`${pm} install`)
	})
})

/*
 *   WORKSPACE FILES - YARN (v1 + Berry)
 ***************************************************************************************************/
describe('workspaceFiles (yarn)', () => {
	const files = workspaceFiles(
		parseManifest({
			name: 'acme',
			packageManager: 'yarn',
			apps: { shell: host() },
		})
	)

	it('pins the node_modules linker so Berry works with Vite and federation', () => {
		expect(files['.yarnrc.yml']).toBeDefined()
		expect(files['.yarnrc.yml']).toContain('nodeLinker: node-modules')
	})

	it('ignores Berry cache and PnP artifacts in .gitignore', () => {
		expect(files['.gitignore']).toContain('.yarn/*')
		expect(files['.gitignore']).toContain('.pnp.*')
	})

	it('does not emit a yarnrc for npm or pnpm', () => {
		const npm = workspaceFiles(parseManifest({ name: 'acme', packageManager: 'npm', apps: {} }))
		const pnpm = workspaceFiles(parseManifest({ name: 'acme', apps: {} }))
		expect(npm['.yarnrc.yml']).toBeUndefined()
		expect(pnpm['.yarnrc.yml']).toBeUndefined()
	})
})

/*
 *   APP FILES - HOST
 ***************************************************************************************************/
describe('appFiles (host)', () => {
	const m = manifest()
	const files = appFiles(m, 'shell', m.apps.shell!)

	it('includes the host source and config', () => {
		expect(Object.keys(files).sort()).toEqual(
			[
				'index.html',
				'package.json',
				'src/App.tsx',
				'src/main.tsx',
				'src/remotes.d.ts',
				'src/vite-env.d.ts',
				'tsconfig.json',
				'vite.config.ts',
			].sort()
		)
	})

	it('reads its wiring from the runtime helper instead of baking it in', () => {
		expect(files['vite.config.ts']).toContain('spoolApp("shell"')
		expect(files['vite.config.ts']).toContain('from "../../spool.vite"')
		// No generated federation config that could drift from spool.json.
		expect(files['vite.config.ts']).not.toContain('localhost')
		expect(files['vite.config.ts']).not.toContain('remotes:')
	})

	it('lazy-imports each remote in App.tsx', () => {
		expect(files['src/App.tsx']).toContain('import("dashboard/App")')
		expect(files['src/App.tsx']).toContain('lazy(')
	})

	it('declares ambient modules for the remotes', () => {
		expect(files['src/remotes.d.ts']).toContain('declare module "dashboard/App"')
	})

	it('locks the build target for top-level await', () => {
		expect(files['vite.config.ts']).toContain('target: "esnext"')
	})
})

/*
 *   APP FILES - HOST WITHOUT REMOTES
 ***************************************************************************************************/
describe('appFiles (host with no remotes)', () => {
	const m = makeManifest({ shell: host() })
	const files = appFiles(m, 'shell', m.apps.shell!)

	it('omits the remotes typing file', () => {
		expect(files['src/remotes.d.ts']).toBeUndefined()
	})

	it('leaves a hint in App.tsx', () => {
		expect(files['src/App.tsx']).toContain('No remotes wired yet')
		expect(files['src/App.tsx']).toContain('spool add')
	})
})

/*
 *   APP FILES - REMOTE
 ***************************************************************************************************/
describe('appFiles (remote)', () => {
	const m = manifest()
	const files = appFiles(m, 'dashboard', m.apps.dashboard!)

	it('derives its exposes from the manifest at startup', () => {
		expect(files['vite.config.ts']).toContain('spoolApp("dashboard"')
		expect(files['src/remotes.d.ts']).toBeUndefined()
	})

	it('pins the modern federation toolchain', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.devDependencies.vite).toBe('^8.0.0')
		expect(pkg.devDependencies['@vitejs/plugin-react']).toBe('^6.0.0')
		expect(pkg.devDependencies['@module-federation/vite']).toBe('^1.16.0')
	})
})

/*
 *   HOST WIRING FILES
 ***************************************************************************************************/
describe('hostWiringFiles', () => {
	it('regenerates only the typings when a host has remotes', () => {
		const m = manifest()
		const files = hostWiringFiles(m.apps.shell!)
		expect(Object.keys(files)).toEqual(['src/remotes.d.ts'])
		expect(files['src/remotes.d.ts']).toContain('declare module "dashboard/App"')
	})

	it('writes nothing when a host has no remotes', () => {
		const m = makeManifest({ shell: host() })
		expect(hostWiringFiles(m.apps.shell!)).toEqual({})
	})
})

/*
 *   STYLE GUARANTEES
 ***************************************************************************************************/
describe('generated content', () => {
	it('never contains an em dash', () => {
		const m = manifest()
		const all = [
			...Object.values(workspaceFiles(m)),
			...Object.values(appFiles(m, 'shell', m.apps.shell!)),
			...Object.values(appFiles(m, 'dashboard', m.apps.dashboard!)),
		].join('\n')
		expect(all).not.toContain('—')
	})
})
