/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkBuiltSingletons, describeShipped } from '../core/federation.js'
import { satisfies } from '../util/semver.js'
import { freshDir, removeDir, makeWorkspace, host, remote } from './helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

beforeEach(() => {
	root = freshDir('spool-fed-')
})

afterEach(() => {
	removeDir(root)
})

interface Share {
	name: string
	version: string
	requiredVersion?: string
}

function built(path: string, shared: Share[]) {
	const dir = join(root, path, 'dist')
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, 'mf-manifest.json'), JSON.stringify({ shared }))
}

const workspace = () =>
	makeWorkspace(root, {
		shell: host({ remotes: ['dashboard'] }),
		dashboard: remote(),
	})

const check = () => checkBuiltSingletons(workspace(), ['shell', 'dashboard'])

/*
 *   RANGE SATISFACTION
 ***************************************************************************************************/
describe('satisfies', () => {
	it('reads the caret the way npm does', () => {
		expect(satisfies('19.2.8', '^19.2.0')).toBe(true)
		expect(satisfies('20.0.0', '^19.2.0')).toBe(false)
		expect(satisfies('19.1.0', '^19.2.0')).toBe(false)
	})

	// Below 1.0.0 a caret stops at the leftmost non-zero part.
	it('narrows the caret for a zero major', () => {
		expect(satisfies('0.2.9', '^0.2.3')).toBe(true)
		expect(satisfies('0.3.0', '^0.2.3')).toBe(false)
	})

	it('handles tilde, gte and an exact pin', () => {
		expect(satisfies('1.2.9', '~1.2.3')).toBe(true)
		expect(satisfies('1.3.0', '~1.2.3')).toBe(false)
		expect(satisfies('9.0.0', '>=1.0.0')).toBe(true)
		expect(satisfies('1.0.1', '1.0.0')).toBe(false)
	})

	it('gives up on a range it cannot read', () => {
		expect(satisfies('1.0.0', 'workspace:*')).toBeNull()
		expect(satisfies('1.0.0', '^1.0.0 || ^2.0.0')).toBeNull()
	})
})

/*
 *   SINGLETON VERIFICATION
 ***************************************************************************************************/
describe('checkBuiltSingletons', () => {
	it('says nothing when every app shipped the same version', () => {
		built('apps/shell', [{ name: 'react', version: '19.2.8', requiredVersion: '^19.2.0' }])
		built('apps/dashboard', [{ name: 'react', version: '19.2.8', requiredVersion: '^19.2.0' }])

		expect(check()).toEqual([])
	})

	it('accepts different versions the ranges still agree on', () => {
		built('apps/shell', [{ name: 'react', version: '19.2.8', requiredVersion: '^19.2.0' }])
		built('apps/dashboard', [{ name: 'react', version: '19.2.7', requiredVersion: '^19.2.0' }])

		expect(check()).toEqual([])
	})

	it('reports a version one app cannot accept', () => {
		built('apps/shell', [{ name: 'react', version: '20.0.0', requiredVersion: '^20.0.0' }])
		built('apps/dashboard', [{ name: 'react', version: '19.2.8', requiredVersion: '^19.2.0' }])

		const [conflict] = check()

		expect(conflict?.dep).toBe('react')
		expect(conflict?.chosen).toBe('20.0.0')
		expect(conflict?.unsatisfied).toEqual([{ app: 'dashboard', requiredVersion: '^19.2.0' }])
	})

	it('names who shipped what', () => {
		built('apps/shell', [{ name: 'react', version: '20.0.0', requiredVersion: '^20.0.0' }])
		built('apps/dashboard', [{ name: 'react', version: '19.2.8', requiredVersion: '^19.2.0' }])

		expect(describeShipped(check()[0]!)).toContain('20.0.0 (shell)')
		expect(describeShipped(check()[0]!)).toContain('19.2.8 (dashboard)')
	})

	it('stays quiet about a range it cannot read', () => {
		built('apps/shell', [{ name: 'ui', version: '2.0.0', requiredVersion: 'workspace:*' }])
		built('apps/dashboard', [{ name: 'ui', version: '1.0.0', requiredVersion: 'workspace:*' }])

		expect(check()).toEqual([])
	})

	it('skips an app with no built manifest', () => {
		built('apps/shell', [{ name: 'react', version: '20.0.0', requiredVersion: '^20.0.0' }])

		expect(check()).toEqual([])
	})

	it('survives a manifest it cannot parse', () => {
		built('apps/shell', [{ name: 'react', version: '19.2.8' }])
		mkdirSync(join(root, 'apps/dashboard/dist'), { recursive: true })
		writeFileSync(join(root, 'apps/dashboard/dist/mf-manifest.json'), '{ not json')

		expect(check()).toEqual([])
	})
})
