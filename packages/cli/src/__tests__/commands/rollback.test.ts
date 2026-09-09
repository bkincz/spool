/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rollback } from '../../commands/rollback.js'
import { rollbackApp } from '../../core/orchestrator.js'
import { makeWorkspace, remote } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../core/orchestrator.js', () => ({ rollbackApp: vi.fn() }))
vi.mock('../../core/workspace.js', () => ({
	requireWorkspace: vi.fn(async () => makeWorkspace('/ws', { dashboard: remote() })),
}))

beforeEach(() => {
	vi.mocked(rollbackApp).mockResolvedValue(undefined)
})

/*
 *   ROLLBACK
 ***************************************************************************************************/
describe('rollback', () => {
	it('forwards the app name and env to the orchestrator', async () => {
		await rollback('dashboard', { env: 'production' })
		expect(rollbackApp).toHaveBeenCalledWith(
			expect.objectContaining({ root: '/ws' }),
			'production',
			'dashboard'
		)
	})
})
