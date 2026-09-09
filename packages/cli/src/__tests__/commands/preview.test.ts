/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { preview } from '../../commands/preview.js'
import { previewAll, killRunning } from '../../core/orchestrator.js'
import { makeWorkspace, remote } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../core/orchestrator.js', () => ({ previewAll: vi.fn(), killRunning: vi.fn() }))
vi.mock('../../core/workspace.js', () => ({
	requireWorkspace: vi.fn(async () => makeWorkspace('/ws', { dashboard: remote() })),
}))

beforeEach(() => {
	vi.mocked(previewAll).mockResolvedValue(undefined)
	vi.mocked(killRunning).mockResolvedValue(undefined)
})

/*
 *   PREVIEW
 ***************************************************************************************************/
describe('preview', () => {
	it('routes --kill to killRunning and skips previewAll entirely', async () => {
		await preview({ kill: true })
		expect(killRunning).toHaveBeenCalledWith(
			expect.objectContaining({ root: '/ws' }),
			'preview'
		)
		expect(previewAll).not.toHaveBeenCalled()
	})

	it('otherwise runs previewAll with the parsed --only list', async () => {
		await preview({ only: 'dashboard,shell' })
		expect(previewAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ only: ['dashboard', 'shell'] })
		)
	})
})
