/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { diagnose } from '../core/doctor.js'
import { freshDir, removeDir, makeWorkspace, host, remote } from './helpers.js'
import type { AppConfig } from '../core/config.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

beforeEach(() => {
	root = freshDir('spool-doctor-')
	// Every workspace ships this helper; its absence is itself a diagnostic.
	writeFileSync(join(root, 'spool.vite.ts'), '// stub\n')
})

afterEach(() => {
	removeDir(root)
})

function withFolders(apps: Record<string, AppConfig>) {
	for (const app of Object.values(apps)) mkdirSync(join(root, app.path), { recursive: true })
	return makeWorkspace(root, apps)
}

const messages = (issues: ReturnType<typeof diagnose>) => issues.map(i => i.message)

/*
 *   CLEAN WORKSPACE
 ***************************************************************************************************/
describe('diagnose', () => {
	it('reports nothing for a healthy workspace', () => {
		const ws = withFolders({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
		expect(diagnose(ws)).toEqual([])
	})

	/*
	 *   PORT COLLISIONS
	 ***************************************************************************************************/
	it('flags two apps sharing a port', () => {
		const ws = withFolders({
			shell: host({ remotes: ['dashboard'], port: 5173 }),
			dashboard: remote({ port: 5173 }),
		})
		const ports = diagnose(ws).filter(i => i.message.includes('Port 5173'))
		expect(ports[0]).toMatchObject({ level: 'error', app: 'dashboard' })
	})

	/*
	 *   MISSING FOLDERS
	 ***************************************************************************************************/
	it('flags an app whose folder is missing', () => {
		const ws = makeWorkspace(root, {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		// no folders created on disk
		expect(messages(diagnose(ws))).toContain('Its folder "apps/shell" is missing.')
	})

	/*
	 *   REMOTE WIRING
	 ***************************************************************************************************/
	it('flags a host pointing at a remote that does not exist', () => {
		const ws = withFolders({ shell: host({ remotes: ['ghost'] }) })
		const issue = diagnose(ws).find(i => i.message.includes('ghost'))
		expect(issue).toMatchObject({ level: 'error', app: 'shell' })
	})

	it('flags a host wiring a non-remote app as a remote', () => {
		const ws = withFolders({
			shell: host({ remotes: ['admin'] }),
			admin: host({ path: 'apps/admin', port: 5180 }),
		})
		const issue = diagnose(ws).find(i => i.message.includes('wired as a remote'))
		expect(issue).toMatchObject({ level: 'error', app: 'shell' })
	})

	/*
	 *   EXPOSURE WARNINGS
	 ***************************************************************************************************/
	it('warns about a remote that exposes nothing', () => {
		const ws = withFolders({
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote({ exposes: {} }),
		})
		const issue = diagnose(ws).find(i => i.message.includes('exposes nothing'))
		expect(issue).toMatchObject({ level: 'warn', app: 'dashboard' })
	})

	it('warns about a remote no host imports', () => {
		const ws = withFolders({ shell: host(), dashboard: remote() })
		const issue = diagnose(ws).find(i => i.message.includes('No host imports'))
		expect(issue).toMatchObject({ level: 'warn', app: 'dashboard' })
	})

	/*
	 *   RUNTIME HELPER
	 ***************************************************************************************************/
	it('flags a missing spool.vite.ts helper', () => {
		rmSync(join(root, 'spool.vite.ts'))
		const ws = withFolders({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
		const issue = diagnose(ws).find(i => i.message.includes('spool.vite.ts'))
		expect(issue).toMatchObject({ level: 'error' })
	})

	/*
	 *   SHARED DEPS
	 ***************************************************************************************************/
	const appPackageJson = (path: string, deps: Record<string, string>) => {
		writeFileSync(
			join(root, path, 'package.json'),
			JSON.stringify({ name: 'x', dependencies: deps })
		)
	}

	it('warns when an app is missing a shared dep', () => {
		const ws = withFolders({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
		appPackageJson('apps/shell', { react: '^18.3.1', 'react-dom': '^18.3.1' })
		appPackageJson('apps/dashboard', { react: '^18.3.1' })
		const issue = diagnose(ws).find(i => i.message.includes('"react-dom" is not in'))
		expect(issue).toMatchObject({ level: 'warn', app: 'dashboard' })
	})

	it('warns when apps disagree on a shared dep version', () => {
		const ws = withFolders({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
		appPackageJson('apps/shell', { react: '^18.3.1', 'react-dom': '^18.3.1' })
		appPackageJson('apps/dashboard', { react: '^19.0.0', 'react-dom': '^18.3.1' })
		const issue = diagnose(ws).find(i => i.message.includes('mismatched versions'))
		expect(issue).toMatchObject({ level: 'warn' })
		expect(issue?.message).toContain('react')
	})

	it('checks subpath share entries against their package, not the subpath', () => {
		const ws = withFolders({ dashboard: remote() })
		ws.manifest.shared = ['react', '@bkincz/clutch', '@bkincz/clutch/react']
		appPackageJson('apps/dashboard', { react: '^18.3.1', '@bkincz/clutch': '^3.0.0' })
		const issues = diagnose(ws).filter(i => i.message.includes('Shared dep'))
		expect(issues).toEqual([])
	})

	it('stays quiet when shared deps are present and agree', () => {
		const ws = withFolders({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
		appPackageJson('apps/shell', { react: '^18.3.1', 'react-dom': '^18.3.1' })
		appPackageJson('apps/dashboard', { react: '^18.3.1', 'react-dom': '^18.3.1' })
		expect(diagnose(ws)).toEqual([])
	})

	it('warns instead of staying silent when a package.json is unparsable', () => {
		const ws = withFolders({ shell: host({ remotes: ['dashboard'] }), dashboard: remote() })
		appPackageJson('apps/shell', { react: '^18.3.1', 'react-dom': '^18.3.1' })
		writeFileSync(join(root, 'apps/dashboard/package.json'), '{ not json')
		const issue = diagnose(ws).find(i => i.message.includes('could not be parsed'))
		expect(issue).toMatchObject({ level: 'warn', app: 'dashboard' })
	})

	/*
	 *   AGGREGATION
	 ***************************************************************************************************/
	it('collects problems from every check at once', () => {
		const ws = makeWorkspace(root, {
			shell: host({ remotes: ['ghost'], port: 4000 }),
			orphan: remote({ path: 'apps/orphan', port: 4000 }),
		})
		const issues = diagnose(ws)
		expect(issues.length).toBeGreaterThanOrEqual(3)
		expect(issues.some(i => i.level === 'error')).toBe(true)
		expect(issues.some(i => i.level === 'warn')).toBe(true)
	})
})
