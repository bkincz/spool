/*
 *   TOOLCHAIN VERSIONS
 ***************************************************************************************************/
import { createRequire } from 'node:module'
import { DEFAULT_FRAMEWORK, type AppConfig, type Framework, type Manifest } from './config.js'
import { packageName } from '../util/names.js'

export const PNPM_VERSION = '11.25.0'

const requirePackage = createRequire(import.meta.url)

/** The CLI's own version; the bundled dist and the src tree sit at different
 * depths from package.json, so both are tried. */
function readCliVersion(): string {
	for (const rel of ['../package.json', '../../package.json']) {
		try {
			return (requirePackage(rel) as { version: string }).version
		} catch {
			continue
		}
	}
	return '0.0.0'
}

export const CLI_VERSION = readCliVersion()

/**
 * Dependency ranges for every scaffolded app, kept in one place so a
 * toolchain bump is a single edit. The CI smoke job builds a real scaffold on
 * every change, so a bump here gets verified end to end.
 */
export const TOOLCHAIN = {
	react: '^19.2.8',
	'react-dom': '^19.2.8',
	'@types/react': '^19.2.0',
	'@types/react-dom': '^19.2.0',
	svelte: '^5.57.0',
	'@sveltejs/vite-plugin-svelte': '^7.1.0',
	vue: '^3.5.42',
	'@vitejs/plugin-vue': '^6.0.0',
	'@types/node': '^26.0.0',
	'@module-federation/vite': '^1.16.0',
	'@vitejs/plugin-react': '^6.0.0',
	typescript: '^6.0.3',
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
	vue: {
		dependencies: ['vue'],
		devDependencies: ['@vitejs/plugin-vue'],
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

export const SHARED_EXTRAS: Record<string, string> = {
	'@bkincz/clutch': '^3.5.0',
}

export const SENTRY_SDK: Record<Framework, string> = {
	react: '@sentry/react',
	svelte: '@sentry/svelte',
	vue: '@sentry/vue',
}

export const LINT_DEPS: Record<string, string> = {
	eslint: '^10.9.1',
	'@eslint/js': '^10.0.1',
	'typescript-eslint': '^8.69.0',
	globals: '^17.11.0',
}

export const LINT_FRAMEWORK_DEPS: Record<Framework, Record<string, string>> = {
	react: { 'eslint-plugin-react-hooks': '^7.1.1' },
	svelte: { 'eslint-plugin-svelte': '^3.23.0' },
	vue: { 'eslint-plugin-vue': '^10.10.0' },
}

export const TEST_DEPS: Record<string, string> = {
	vitest: '^4.1.11',
	'@vitest/coverage-v8': '^4.1.11',
	'happy-dom': '^20.12.0',
}

export const TEST_FRAMEWORK_DEPS: Record<Framework, Record<string, string>> = {
	react: {
		'@testing-library/react': '^16.3.3',
		'@testing-library/dom': '^10.4.1',
	},
	svelte: { '@testing-library/svelte': '^5.4.2' },
	vue: { '@testing-library/vue': '^8.1.0' },
}

export const SENTRY_VERSION = '^10.64.0'
export const SENTRY_VITE_PLUGIN_VERSION = '^5.3.0'

export function rootDevDependencies(m: Manifest): Record<string, string> {
	const deps: Record<string, string> = {
		typescript: TOOLCHAIN.typescript,
		'@types/node': TOOLCHAIN['@types/node'],
		'@bkincz/spool': `^${CLI_VERSION}`,
	}

	if (m.addons.includes('lint')) {
		Object.assign(deps, LINT_DEPS)
		for (const framework of new Set(Object.values(m.apps).map(app => app.framework))) {
			Object.assign(deps, LINT_FRAMEWORK_DEPS[framework])
		}
	}

	return deps
}

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
				.map(name => m.apps[name]?.framework ?? DEFAULT_FRAMEWORK)
				.filter(framework => framework !== app.framework)
		)
		for (const framework of foreign) {
			put(FRAMEWORK_DEPS[framework].bridgeDependencies, dependencies)
			put(FRAMEWORK_DEPS[framework].bridgeDevDependencies, devDependencies)
		}
	}
	const sharedPackages = new Set(m.shared.map(packageName))
	for (const [dep, range] of Object.entries(SHARED_EXTRAS)) {
		if (sharedPackages.has(dep)) dependencies[dep] = range
	}
	if (m.addons.includes('sentry')) {
		dependencies[SENTRY_SDK[app.framework]] = SENTRY_VERSION
		devDependencies['@sentry/vite-plugin'] = SENTRY_VITE_PLUGIN_VERSION
	}
	if (m.addons.includes('test')) {
		Object.assign(devDependencies, TEST_DEPS, TEST_FRAMEWORK_DEPS[app.framework])
	}
	put(COMMON_DEV_DEPS, devDependencies)
	return { dependencies, devDependencies }
}
