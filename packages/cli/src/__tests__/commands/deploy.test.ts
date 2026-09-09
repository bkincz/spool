/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { deploy } from '../../commands/deploy.js'
import { deployAll } from '../../core/orchestrator.js'
import { makeWorkspace, remote } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../core/orchestrator.js', () => ({ deployAll: vi.fn() }))
vi.mock('../../core/workspace.js', () => ({
	requireWorkspace: vi.fn(async () => makeWorkspace('/ws', { dashboard: remote() })),
}))

beforeEach(() => {
	vi.mocked(deployAll).mockResolvedValue(undefined)
})

/*
 *   DEPLOY
 ***************************************************************************************************/
describe('deploy', () => {
	it('prints one JSON line per app to stdout when --json is set', async () => {
		vi.mocked(deployAll).mockImplementation(async (_ws, _only, _env, onResult) => {
			onResult?.({ name: 'dashboard', ok: true, duration: 10 })
		})
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await deploy({ json: true })

		expect(write).toHaveBeenCalledWith(
			`${JSON.stringify({ name: 'dashboard', ok: true, duration: 10 })}\n`
		)
	})

	it('does not touch stdout without --json', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		await deploy({})
		expect(write).not.toHaveBeenCalled()
	})
})
