/*
 *   TOOLCHAIN VERSIONS
 ***************************************************************************************************/
import type { AppConfig, Framework, Manifest } from './config.js'

/** Written to scaffolded package.json so corepack and CI resolve the same pnpm. */
export const PNPM_VERSION = '11.6.0'

/**
 * Dependency ranges for every scaffolded app, kept in one place so a
 * toolchain bump is a single edit. The CI smoke job builds a real scaffold on
 * every change, so a bump here gets verified end to end.
 */
export const TOOLCHAIN = {
	react: '^19.2.0',
	'react-dom': '^19.2.0',
	'@types/react': '^19.2.0',
	'@types/react-dom': '^19.2.0',
	svelte: '^5.56.0',
	'@sveltejs/vite-plugin-svelte': '^7.1.0',
	'@types/node': '^26.0.0',
	'@module-federation/vite': '^1.16.0',
	'@vitejs/plugin-react': '^6.0.0',
	typescript: '^5.6.3',
	vite: '^8.0.0',
} as const

export type ToolchainDep = keyof typeof TOOLCHAIN

interface FrameworkDeps {
	dependencies: ToolchainDep[]
	devDependencies: ToolchainDep[]
	/** What a host on another framework needs to mount this framework's remotes. */
	bridgeDependencies: ToolchainDep[]
	bridgeDevDependencies: ToolchainDep[]
}

/** Per-framework dependency sets, on top of the common vite toolchain. */
export const FRAMEWORK_DEPS: Record<Framework, FrameworkDeps> = {
	react: {
		dependencies: ['react', 'react-dom'],
		devDependencies: ['@types/react', '@types/react-dom', '@vitejs/plugin-react'],
		// The react bridge renders with createElement, so hosts on other
		// frameworks need the runtime and its types but not the vite plugin.
		bridgeDependencies: ['react', 'react-dom'],
		bridgeDevDependencies: ['@types/react', '@types/react-dom'],
	},
	svelte: {
		dependencies: ['svelte'],
		devDependencies: ['@sveltejs/vite-plugin-svelte'],
		// Svelte remotes expose a self-contained mount function; hosts need nothing.
		bridgeDependencies: [],
		bridgeDevDependencies: [],
	},
}

export const COMMON_DEV_DEPS: ToolchainDep[] = [
	'@module-federation/vite',
	'@types/node',
	'typescript',
	'vite',
]

/**
 * Dependency ranges an app's package.json should carry: its own framework's
 * toolchain, bridge deps for foreign-framework remotes a host mounts, and
 * the common vite toolchain. `create`, `add` and `upgrade` all derive their
 * expectations from here.
 */
export function appDependencies(
	m: Manifest,
	app: AppConfig
): { dependencies: Record<string, string>; devDependencies: Record<string, string> } {
	const dependencies: Record<string, string> = {}
	const devDependencies: Record<string, string> = {}
	const put = (deps: ToolchainDep[], into: Record<string, string>): void => {
		for (const dep of deps) into[dep] = TOOLCHAIN[dep]
	}

	put(FRAMEWORK_DEPS[app.framework].dependencies, dependencies)
	put(FRAMEWORK_DEPS[app.framework].devDependencies, devDependencies)
	if (app.type === 'host') {
		const foreign = new Set<Framework>(
			app.remotes
				.map(name => m.apps[name]?.framework ?? 'react')
				.filter(framework => framework !== app.framework)
		)
		for (const framework of foreign) {
			put(FRAMEWORK_DEPS[framework].bridgeDependencies, dependencies)
			put(FRAMEWORK_DEPS[framework].bridgeDevDependencies, devDependencies)
		}
	}
	put(COMMON_DEV_DEPS, devDependencies)
	return { dependencies, devDependencies }
}
