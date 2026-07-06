/*
 *   IMPORTS
 ***************************************************************************************************/
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseManifest, type AppConfig, type Manifest } from '../core/config.js'
import type { Workspace } from '../core/workspace.js'

/*
 *   TEMP DIRS
 ***************************************************************************************************/
export function freshDir(prefix = 'spool-test-'): string {
	return mkdtempSync(join(tmpdir(), prefix))
}

export function removeDir(dir: string): void {
	rmSync(dir, { recursive: true, force: true })
}

/*
 *   MANIFEST FACTORIES
 ***************************************************************************************************/
export function host(overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		type: 'host',
		framework: 'react',
		path: 'apps/shell',
		port: 5173,
		remotes: [],
		exposes: {},
		...overrides,
	}
}

export function remote(overrides: Partial<AppConfig> = {}): AppConfig {
	return {
		type: 'remote',
		framework: 'react',
		path: 'apps/dashboard',
		port: 5174,
		remotes: [],
		exposes: { './App': './src/App.tsx' },
		...overrides,
	}
}

export function makeManifest(apps: Record<string, AppConfig>): Manifest {
	return parseManifest({ name: 'acme', apps })
}

export function makeWorkspace(root: string, apps: Record<string, AppConfig>): Workspace {
	return { root, manifestPath: join(root, 'spool.json'), manifest: makeManifest(apps) }
}
