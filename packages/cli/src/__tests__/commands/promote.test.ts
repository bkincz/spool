/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promote } from '../../commands/promote.js'
import { promoteApp } from '../../core/orchestrator.js'
import { makeWorkspace, remote } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../core/orchestrator.js', () => ({ promoteApp: vi.fn() }))
vi.mock('../../core/workspace.js', () => ({
	requireWorkspace: vi.fn(async () => makeWorkspace('/ws', { dashboard: remote() })),
}))

beforeEach(() => {
	vi.mocked(promoteApp).mockResolvedValue(undefined)
})

/*
 *   PROMOTE
 ***************************************************************************************************/
describe('promote', () => {
	it('splits "app@sha" and forwards it to the orchestrator', async () => {
		await promote('dashboard@abc1234', { env: 'production' })
		expect(promoteApp).toHaveBeenCalledWith(
			expect.objectContaining({ root: '/ws' }),
			'production',
			'dashboard',
			'abc1234'
		)
	})

	it('rejects a target with no "@sha"', async () => {
		await expect(promote('dashboard', { env: 'production' })).rejects.toThrow('app@sha')
		expect(promoteApp).not.toHaveBeenCalled()
	})
})
