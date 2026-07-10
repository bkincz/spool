/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { workspaceFiles, appFiles, hostWiringFiles, ciWorkflows } from '../core/generators.js'
import { NO_EXTRAS } from '../core/templates/index.js'
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

	it('carries spool as a dev dependency so fresh clones can run the scripts', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.devDependencies['@bkincz/spool']).toMatch(/^\^\d+\.\d+\.\d+/)
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

	it('pins the pnpm version so CI and corepack agree', () => {
		expect(JSON.parse(files['package.json']!).packageManager).toMatch(/^pnpm@\d/)
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

	it('does not ship CORS headers, since nothing fetches a host cross-origin', () => {
		expect(files['public/_headers']).toBeUndefined()
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

	it('ships CORS headers so deployed hosts can fetch it cross-origin', () => {
		expect(files['public/_headers']).toContain('Access-Control-Allow-Origin: *')
	})

	it('passes the vite command through so deployed urls only apply to builds', () => {
		expect(files['vite.config.ts']).toContain('({ command })')
		expect(files['vite.config.ts']).toContain('command)')
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
		const files = hostWiringFiles(m, m.apps.shell!)
		expect(Object.keys(files)).toEqual(['src/remotes.d.ts'])
		expect(files['src/remotes.d.ts']).toContain('declare module "dashboard/App"')
	})

	it('writes nothing when a host has no remotes', () => {
		const m = makeManifest({ shell: host() })
		expect(hostWiringFiles(m, m.apps.shell!)).toEqual({})
	})
})

/*
 *   APP FILES - SVELTE
 ***************************************************************************************************/
describe('appFiles (svelte remote)', () => {
	const m = makeManifest({
		shell: host({ remotes: ['widget'] }),
		widget: remote({
			framework: 'svelte',
			path: 'apps/widget',
			exposes: { './App': './src/mount.ts' },
		}),
	})
	const files = appFiles(m, 'widget', m.apps.widget!)

	it('scaffolds svelte sources and the mount contract', () => {
		expect(files['src/App.svelte']).toContain('Svelte remote')
		expect(files['src/mount.ts']).toContain('export default function mountApp')
		expect(files['src/main.ts']).toContain('mount(App')
		expect(files['src/App.tsx']).toBeUndefined()
		expect(files['src/main.tsx']).toBeUndefined()
	})

	it('uses the svelte vite plugin and entry point', () => {
		expect(files['vite.config.ts']).toContain('@sveltejs/vite-plugin-svelte')
		expect(files['vite.config.ts']).not.toContain('@vitejs/plugin-react')
		expect(files['index.html']).toContain('/src/main.ts"')
	})

	it('declares svelte deps and no react deps', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies.svelte).toBeDefined()
		expect(pkg.dependencies.react).toBeUndefined()
		expect(pkg.devDependencies['@sveltejs/vite-plugin-svelte']).toBeDefined()
	})

	it('lets plain tsc resolve .svelte imports', () => {
		expect(files['src/vite-env.d.ts']).toContain('declare module "*.svelte"')
	})
})

describe('appFiles (react host with a svelte remote)', () => {
	const m = makeManifest({
		shell: host({ remotes: ['dashboard', 'widget'] }),
		dashboard: remote(),
		widget: remote({
			framework: 'svelte',
			path: 'apps/widget',
			port: 5175,
			exposes: { './App': './src/mount.ts' },
		}),
	})
	const files = appFiles(m, 'shell', m.apps.shell!)

	it('renders react remotes with lazy and mount remotes with a wrapper', () => {
		expect(files['src/App.tsx']).toContain('lazy(() => import("dashboard/App"))')
		expect(files['src/App.tsx']).toContain('function MountRemote')
		expect(files['src/App.tsx']).toContain('<MountRemote load={loadWidget} />')
	})

	it('types each remote by its contract', () => {
		const typings = files['src/remotes.d.ts']!
		expect(typings).toContain('const Component: React.ComponentType')
		expect(typings).toContain('const mount: (target: HTMLElement) => () => void')
	})

	it('needs no svelte deps, since mount-contract remotes are self-contained', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies.svelte).toBeUndefined()
		expect(pkg.devDependencies['@sveltejs/vite-plugin-svelte']).toBeUndefined()
	})
})

describe('appFiles (svelte host with a react remote)', () => {
	const m = makeManifest({
		shell: host({ framework: 'svelte', remotes: ['dashboard'] }),
		dashboard: remote(),
	})
	const files = appFiles(m, 'shell', m.apps.shell!)

	it('bridges react remotes and ships both frameworks', () => {
		expect(files['src/react-bridge.ts']).toContain('createRoot')
		expect(files['src/App.svelte']).toContain('mountReact(m.default')
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies.svelte).toBeDefined()
		expect(pkg.dependencies.react).toBeDefined()
		expect(pkg.dependencies['react-dom']).toBeDefined()
	})

	it('takes the react types for the bridge but not the react vite plugin', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.devDependencies['@types/react']).toBeDefined()
		expect(pkg.devDependencies['@vitejs/plugin-react']).toBeUndefined()
	})

	it('guards mounts against unmounting before a remote import resolves', () => {
		expect(files['src/App.svelte']).toContain('cancelled')
	})
})

/*
 *   APP FILES - VUE
 ***************************************************************************************************/
describe('appFiles (vue remote)', () => {
	const m = makeManifest({
		shell: host({ remotes: ['widget'] }),
		widget: remote({
			framework: 'vue',
			path: 'apps/widget',
			exposes: { './App': './src/mount.ts' },
		}),
	})
	const files = appFiles(m, 'widget', m.apps.widget!)

	it('scaffolds vue sources and the mount contract', () => {
		expect(files['src/App.vue']).toContain('Vue remote')
		expect(files['src/mount.ts']).toContain('export default function mountApp')
		expect(files['src/main.ts']).toContain('createApp(App)')
		expect(files['src/App.tsx']).toBeUndefined()
		expect(files['src/main.tsx']).toBeUndefined()
	})

	it('uses the vue vite plugin and entry point', () => {
		expect(files['vite.config.ts']).toContain('@vitejs/plugin-vue')
		expect(files['vite.config.ts']).not.toContain('@vitejs/plugin-react')
		expect(files['index.html']).toContain('/src/main.ts"')
	})

	it('declares vue deps and no react deps', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies.vue).toBeDefined()
		expect(pkg.dependencies.react).toBeUndefined()
		expect(pkg.devDependencies['@vitejs/plugin-vue']).toBeDefined()
	})

	it('lets plain tsc resolve .vue imports', () => {
		expect(files['src/vite-env.d.ts']).toContain('declare module "*.vue"')
	})
})

describe('appFiles (react host with a vue remote)', () => {
	const m = makeManifest({
		shell: host({ remotes: ['widget'] }),
		widget: remote({
			framework: 'vue',
			path: 'apps/widget',
			exposes: { './App': './src/mount.ts' },
		}),
	})
	const files = appFiles(m, 'shell', m.apps.shell!)

	it('mounts the vue remote through the mount contract wrapper', () => {
		expect(files['src/App.tsx']).toContain('function MountRemote')
		expect(files['src/App.tsx']).toContain('<MountRemote load={loadWidget} />')
	})

	it('needs no vue deps, since mount-contract remotes are self-contained', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies.vue).toBeUndefined()
		expect(pkg.devDependencies['@vitejs/plugin-vue']).toBeUndefined()
	})
})

describe('appFiles (vue host with mixed remotes)', () => {
	const m = makeManifest({
		shell: host({ framework: 'vue', remotes: ['dashboard', 'widget'] }),
		dashboard: remote(),
		widget: remote({
			framework: 'svelte',
			path: 'apps/widget',
			port: 5175,
			exposes: { './App': './src/mount.ts' },
		}),
	})
	const files = appFiles(m, 'shell', m.apps.shell!)

	it('bridges react remotes and mounts contract remotes directly', () => {
		expect(files['src/react-bridge.ts']).toContain('createRoot')
		expect(files['src/App.vue']).toContain('mountReact(m.default')
		expect(files['src/App.vue']).toContain('import("widget/App")')
	})

	it('ships the react bridge runtime but neither vite plugin nor svelte', () => {
		const pkg = JSON.parse(files['package.json']!)
		expect(pkg.dependencies.vue).toBeDefined()
		expect(pkg.dependencies.react).toBeDefined()
		expect(pkg.devDependencies['@types/react']).toBeDefined()
		expect(pkg.devDependencies['@vitejs/plugin-react']).toBeUndefined()
		expect(pkg.dependencies.svelte).toBeUndefined()
	})

	it('guards mounts against unmounting before a remote import resolves', () => {
		expect(files['src/App.vue']).toContain('cancelled')
	})

	it('types each remote by its contract', () => {
		const typings = files['src/remotes.d.ts']!
		expect(typings).toContain('const Component: React.ComponentType')
		expect(typings).toContain('const mount: (target: HTMLElement) => () => void')
	})
})

describe('appFiles (mount-contract hosts with no remotes)', () => {
	it('imports nothing, so fresh scaffolds pass unused-import lint', () => {
		const svelteM = makeManifest({ shell: host({ framework: 'svelte' }) })
		expect(appFiles(svelteM, 'shell', svelteM.apps.shell!)['src/App.svelte']).not.toContain(
			'import'
		)
		const vueM = makeManifest({ shell: host({ framework: 'vue' }) })
		expect(appFiles(vueM, 'shell', vueM.apps.shell!)['src/App.vue']).not.toContain('import')
	})
})

/*
 *   APP FILES - STATE EXAMPLE EXTRAS
 ***************************************************************************************************/
describe('appFiles (state example extras)', () => {
	const plain = { ...NO_EXTRAS, stateExample: true }
	const withUi = { ...NO_EXTRAS, stateExample: true, uiButton: true }
	const m = makeManifest({
		shell: host({ remotes: ['dash', 'widget', 'vapp'] }),
		dash: remote({ path: 'apps/dash' }),
		widget: remote({
			framework: 'svelte',
			path: 'apps/widget',
			port: 5175,
			exposes: { './App': './src/mount.ts' },
		}),
		vapp: remote({
			framework: 'vue',
			path: 'apps/vapp',
			port: 5176,
			exposes: { './App': './src/mount.ts' },
		}),
	})

	it('gives react remotes a counter with a plain button by default', () => {
		const app = appFiles(m, 'dash', m.apps.dash!, plain)['src/App.tsx']!
		expect(app).toContain('useMachine(counterMachine)')
		expect(app).toContain('<button onClick={increment}>Increment</button>')
		expect(app).not.toContain('from "ui"')
	})

	it('uses the ladle ui button when both addons are picked', () => {
		const files = appFiles(m, 'dash', m.apps.dash!, withUi)
		expect(files['src/App.tsx']).toContain('import { Button } from "ui";')
		expect(files['src/App.tsx']).toContain('<Button onClick={increment}>Increment</Button>')
		expect(JSON.parse(files['package.json']!).dependencies.ui).toBe('workspace:*')
	})

	it('never puts the ui dep on hosts or non-react apps', () => {
		expect(
			JSON.parse(appFiles(m, 'shell', m.apps.shell!, withUi)['package.json']!).dependencies.ui
		).toBeUndefined()
		expect(
			JSON.parse(appFiles(m, 'widget', m.apps.widget!, withUi)['package.json']!).dependencies
				.ui
		).toBeUndefined()
	})

	it('shows the shared count on the host with a stable test id', () => {
		const app = appFiles(m, 'shell', m.apps.shell!, plain)['src/App.tsx']!
		expect(app).toContain('data-testid="shell-count"')
		expect(app).toContain('useMachine(counterMachine)')
	})

	it('wires the counter into svelte and vue remotes with their own syntax', () => {
		const svelteApp = appFiles(m, 'widget', m.apps.widget!, plain)['src/App.svelte']!
		expect(svelteApp).toContain('counterMachine.mutate')
		expect(svelteApp).toContain('<button on:click={increment}>Increment</button>')

		const vueApp = appFiles(m, 'vapp', m.apps.vapp!, plain)['src/App.vue']!
		expect(vueApp).toContain('counterMachine.mutate')
		expect(vueApp).toContain('<button @click="increment">Increment</button>')
	})

	it('shows the shared count on svelte and vue hosts too', () => {
		const svelteM = makeManifest({ shell: host({ framework: 'svelte' }) })
		expect(appFiles(svelteM, 'shell', svelteM.apps.shell!, plain)['src/App.svelte']).toContain(
			'data-testid="shell-count"'
		)
		const vueM = makeManifest({ shell: host({ framework: 'vue' }) })
		expect(appFiles(vueM, 'shell', vueM.apps.shell!, plain)['src/App.vue']).toContain(
			'data-testid="shell-count"'
		)
	})

	it('changes nothing when no extras are passed', () => {
		const app = appFiles(m, 'dash', m.apps.dash!)['src/App.tsx']!
		expect(app).not.toContain('counterMachine')
		expect(
			JSON.parse(appFiles(m, 'dash', m.apps.dash!)['package.json']!).dependencies.ui
		).toBeUndefined()
	})
})

/*
 *   TSCONFIG - PER-FRAMEWORK COMPILER OPTIONS
 ***************************************************************************************************/
describe('app tsconfig', () => {
	it('keeps the JSX runtime per react app, out of the shared base', () => {
		const m = makeManifest({
			shell: host({ remotes: ['widget'] }),
			widget: remote({ framework: 'svelte', path: 'apps/widget' }),
		})
		expect(workspaceFiles(m)['tsconfig.base.json']).not.toContain('jsx')
		expect(appFiles(m, 'shell', m.apps.shell!)['tsconfig.json']).toContain('react-jsx')
		expect(appFiles(m, 'widget', m.apps.widget!)['tsconfig.json']).not.toContain('jsx')
	})
})

/*
 *   CI WORKFLOWS
 ***************************************************************************************************/
describe('ciWorkflows', () => {
	const m = makeManifest({
		shell: host({ remotes: ['dashboard'], deploy: 'deploy-shell-cmd' }),
		dashboard: remote({ deploy: 'wrangler pages deploy dist --project-name=dash' }),
		orphan: remote({ path: 'apps/orphan', port: 5175 }),
	})
	const files = ciWorkflows(m)

	it('generates one workflow per app that has a deploy command', () => {
		expect(Object.keys(files).sort()).toEqual([
			'.github/workflows/deploy-dashboard.yml',
			'.github/workflows/deploy-shell.yml',
		])
	})

	it('path-filters to the app folder plus the workspace-level files', () => {
		const yml = files['.github/workflows/deploy-dashboard.yml']!
		expect(yml).toContain("'apps/dashboard/**'")
		expect(yml).toContain("'spool.json'")
		expect(yml).toContain("'spool.vite.ts'")
		expect(yml).toContain("'pnpm-lock.yaml'")
		expect(yml).not.toContain("'apps/shell/**'")
	})

	it('bakes the deploy command in and builds in the app folder', () => {
		const yml = files['.github/workflows/deploy-dashboard.yml']!
		expect(yml).toContain('wrangler pages deploy dist --project-name=dash')
		expect(yml).toContain('working-directory: apps/dashboard')
		expect(yml).toContain('pnpm run build')
	})

	it('supports manual runs', () => {
		expect(files['.github/workflows/deploy-shell.yml']).toContain('workflow_dispatch')
	})

	it('adapts the setup to the package manager', () => {
		const npm = ciWorkflows(
			parseManifest({
				name: 'acme',
				packageManager: 'npm',
				apps: { dash: { ...remote(), deploy: 'x' } },
			})
		)['.github/workflows/deploy-dash.yml']!
		expect(npm).toContain('npm ci')
		expect(npm).toContain("'package-lock.json'")
		expect(npm).not.toContain('pnpm/action-setup')

		const pnpm = files['.github/workflows/deploy-dashboard.yml']!
		expect(pnpm).toContain('pnpm/action-setup')
		expect(pnpm).toContain('pnpm install --frozen-lockfile')
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
