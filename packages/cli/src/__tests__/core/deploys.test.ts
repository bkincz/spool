/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	readDeployStore,
	recordDeploy,
	deployHistory,
	readBuiltSharedEntries,
	sharedConflicts,
	type DeployRecord,
} from '../../core/deploys.js'
import { makeWorkspace, remote, freshDir, removeDir } from '../helpers.js'

/*
 *   TESTS
 ***************************************************************************************************/
let root: string

afterEach(() => {
	if (root) removeDir(root)
})

const aRecord = (overrides: Partial<DeployRecord> = {}): DeployRecord => ({
	sha: 'abc1234',
	url: 'https://d.example.com/mf-manifest.json',
	at: new Date().toISOString(),
	shared: { react: '18.2.0' },
	...overrides,
})

describe('readDeployStore / recordDeploy', () => {
	it('returns an empty store when nothing has been recorded yet', () => {
		root = freshDir('spool-deploys-empty-')
		const ws = makeWorkspace(root, { dashboard: remote() })
		expect(readDeployStore(ws)).toEqual({})
	})

	it('prepends new deploys so index 0 is always the current one', () => {
		root = freshDir('spool-deploys-history-')
		const ws = makeWorkspace(root, { dashboard: remote() })

		recordDeploy(ws, 'production', 'dashboard', aRecord({ sha: 'first' }))
		recordDeploy(ws, 'production', 'dashboard', aRecord({ sha: 'second' }))

		const history = deployHistory(readDeployStore(ws), 'production', 'dashboard')
		expect(history.map(r => r.sha)).toEqual(['second', 'first'])
	})

	it('keeps envs and apps separate', () => {
		root = freshDir('spool-deploys-envs-')
		const ws = makeWorkspace(root, {
			dashboard: remote(),
			shell: remote({ path: 'apps/shell' }),
		})

		recordDeploy(ws, 'staging', 'dashboard', aRecord({ sha: 'staging-sha' }))
		recordDeploy(ws, 'production', 'dashboard', aRecord({ sha: 'prod-sha' }))
		recordDeploy(ws, 'production', 'shell', aRecord({ sha: 'shell-sha' }))

		expect(deployHistory(readDeployStore(ws), 'staging', 'dashboard')[0]?.sha).toBe(
			'staging-sha'
		)
		expect(deployHistory(readDeployStore(ws), 'production', 'dashboard')[0]?.sha).toBe(
			'prod-sha'
		)
		expect(deployHistory(readDeployStore(ws), 'production', 'shell')[0]?.sha).toBe('shell-sha')
	})

	it('caps the history so it does not grow forever', () => {
		root = freshDir('spool-deploys-cap-')
		const ws = makeWorkspace(root, { dashboard: remote() })

		for (let i = 0; i < 15; i++) {
			recordDeploy(ws, 'production', 'dashboard', aRecord({ sha: `sha-${i}` }))
		}

		expect(
			deployHistory(readDeployStore(ws), 'production', 'dashboard').length
		).toBeLessThanOrEqual(10)
	})

	it('returns an empty store instead of throwing on a corrupt file', () => {
		root = freshDir('spool-deploys-corrupt-')
		mkdirSync(join(root, '.spool'), { recursive: true })
		writeFileSync(join(root, '.spool', 'deploys.json'), 'not json')
		const ws = makeWorkspace(root, { dashboard: remote() })

		expect(readDeployStore(ws)).toEqual({})
	})
})

describe('readBuiltSharedEntries', () => {
	it('reads the shared array out of the built mf-manifest.json', () => {
		root = freshDir('spool-deploys-manifest-')
		mkdirSync(join(root, 'apps/dashboard/dist'), { recursive: true })
		writeFileSync(
			join(root, 'apps/dashboard/dist/mf-manifest.json'),
			JSON.stringify({
				shared: [{ name: 'react', version: '18.2.0', requiredVersion: '^18.0.0' }],
			})
		)

		expect(readBuiltSharedEntries(root, 'apps/dashboard')).toEqual([
			{ name: 'react', version: '18.2.0', requiredVersion: '^18.0.0' },
		])
	})

	it('returns an empty array when there is no dist yet', () => {
		root = freshDir('spool-deploys-nodist-')
		expect(readBuiltSharedEntries(root, 'apps/dashboard')).toEqual([])
	})
})

describe('sharedConflicts', () => {
	it('flags a dep whose required range the last deployed version does not satisfy', () => {
		const store = {
			production: {
				shell: [aRecord({ shared: { react: '17.0.0' } })],
			},
		}

		const conflicts = sharedConflicts(store, 'production', 'dashboard', [
			{ name: 'react', version: '18.2.0', requiredVersion: '^18.0.0' },
		])

		expect(conflicts).toEqual([
			{ dep: 'react', otherApp: 'shell', otherVersion: '17.0.0', requiredVersion: '^18.0.0' },
		])
	})

	it('passes when the other app last shipped a version inside the range', () => {
		const store = {
			production: {
				shell: [aRecord({ shared: { react: '18.3.0' } })],
			},
		}

		const conflicts = sharedConflicts(store, 'production', 'dashboard', [
			{ name: 'react', version: '18.2.0', requiredVersion: '^18.0.0' },
		])

		expect(conflicts).toEqual([])
	})

	it('ignores its own app and deps without a requiredVersion', () => {
		const store = {
			production: {
				dashboard: [aRecord({ shared: { react: '17.0.0' } })],
			},
		}

		const conflicts = sharedConflicts(store, 'production', 'dashboard', [
			{ name: 'react', version: '18.2.0' },
		])

		expect(conflicts).toEqual([])
	})
})
