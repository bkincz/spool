/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { workspaceMembers } from '../../core/packages-glob.js'
import { resolveRanges } from '../../core/ranges.js'
import { diagnose } from '../../core/doctor.js'
import { freshDir, removeDir, makeWorkspace, host, remote } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

beforeEach(() => {
	root = freshDir('spool-scope-')
})

afterEach(() => {
	removeDir(root)
})

function pkg(dir: string, contents: Record<string, unknown>) {
	mkdirSync(join(root, dir), { recursive: true })
	writeFileSync(join(root, dir, 'package.json'), JSON.stringify(contents))
}

function workspace() {
	writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n')
	pkg('.', { name: 'acme' })

	for (const app of ['shell', 'dashboard']) {
		mkdirSync(join(root, `apps/${app}/src/app`), { recursive: true })
		writeFileSync(join(root, `apps/${app}/src/app/app.tsx`), 'export default function App() {}')
		pkg(`apps/${app}`, { name: app })
	}

	return makeWorkspace(root, {
		shell: host({ remotes: ['dashboard'] }),
		dashboard: remote(),
	})
}

/*
 *   WORKSPACE MEMBERS
 ***************************************************************************************************/
describe('workspaceMembers', () => {
	it('expands the globs a package manager was given', () => {
		const ws = workspace()
		pkg('packages/ui', { name: 'ui' })
		pkg('packages/api', { name: 'api' })

		expect(workspaceMembers(ws)).toEqual([
			'apps/dashboard',
			'apps/shell',
			'packages/api',
			'packages/ui',
		])
	})

	it('reads the workspaces field when the manager is not pnpm', () => {
		const ws = workspace()
		ws.manifest.packageManager = 'npm'
		pkg('.', { name: 'acme', workspaces: ['packages/*'] })
		pkg('packages/ui', { name: 'ui' })

		expect(workspaceMembers(ws)).toEqual(['packages/ui'])
	})

	it('ignores a directory with no package.json', () => {
		const ws = workspace()
		mkdirSync(join(root, 'packages/scratch'), { recursive: true })

		expect(workspaceMembers(ws)).not.toContain('packages/scratch')
	})
})

/*
 *   A LOCAL PACKAGE IS A SINGLETON TOO
 ***************************************************************************************************/
describe('resolveRanges across the whole workspace', () => {
	it('sees a version only a local package declares', () => {
		const ws = workspace()
		pkg('apps/shell', { name: 'shell', dependencies: { react: '^19.2.0' } })
		pkg('apps/dashboard', { name: 'dashboard', dependencies: { react: '^19.2.0' } })
		pkg('packages/ui', { name: 'ui', dependencies: { react: '^21.0.0' } })

		expect(resolveRanges(ws).get('react')?.target).toBe('^21.0.0')
	})

	it('names a package by its path and an app by its manifest name', () => {
		const ws = workspace()
		pkg('apps/shell', { name: 'shell', dependencies: { react: '^19.2.0' } })
		pkg('packages/ui', { name: 'ui', dependencies: { react: '^21.0.0' } })

		const sources = resolveRanges(ws).get('react')!.sources

		expect(sources.get('^19.2.0')).toContain('shell')
		expect(sources.get('^21.0.0')).toContain('packages/ui')
	})
})

/*
 *   EXPOSED FILES
 ***************************************************************************************************/
describe('exposed file checks', () => {
	it('errors when an exposed source is not there', () => {
		const ws = workspace()
		ws.manifest.apps.dashboard!.exposes = { './App': './src/app/gone.tsx' }

		const issue = diagnose(ws).find(d => d.message.includes('which is not there'))

		expect(issue).toMatchObject({ level: 'error', app: 'dashboard' })
	})

	it('says nothing when every exposed source exists', () => {
		const ws = workspace()

		expect(diagnose(ws).filter(d => d.message.includes('which is not there'))).toEqual([])
	})

	it('leaves it alone when the app folder is missing entirely', () => {
		const ws = workspace()
		ws.manifest.apps.ghost = remote({ path: 'apps/ghost' })

		const issues = diagnose(ws).filter(d => d.app === 'ghost')

		expect(issues.some(d => d.message.includes('is missing'))).toBe(true)
		expect(issues.some(d => d.message.includes('which is not there'))).toBe(false)
	})
})
