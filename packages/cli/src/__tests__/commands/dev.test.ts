/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dev } from '../../commands/dev.js'
import { devAll, killRunning } from '../../core/orchestrator.js'
import { makeWorkspace, remote } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../core/orchestrator.js', () => ({ devAll: vi.fn(), killRunning: vi.fn() }))
vi.mock('../../core/workspace.js', () => ({
	requireWorkspace: vi.fn(async () => makeWorkspace('/ws', { dashboard: remote() })),
}))

beforeEach(() => {
	vi.mocked(devAll).mockResolvedValue(undefined)
	vi.mocked(killRunning).mockResolvedValue(undefined)
})

/*
 *   DEV
 ***************************************************************************************************/
describe('dev', () => {
	it('routes --kill to killRunning and skips devAll entirely', async () => {
		await dev({ kill: true })
		expect(killRunning).toHaveBeenCalledWith(expect.objectContaining({ root: '/ws' }), 'dev')
		expect(devAll).not.toHaveBeenCalled()
	})

	it('parses --rest built', async () => {
		await dev({ rest: 'built' })
		expect(devAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ rest: { kind: 'built' } })
		)
	})

	it('parses --rest <env-name>', async () => {
		await dev({ rest: 'staging' })
		expect(devAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ rest: { kind: 'env', env: 'staging' } })
		)
	})

	it('converts --timeout to seconds', async () => {
		await dev({ timeout: '5' })
		expect(devAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ timeoutSeconds: 5 })
		)
	})

	it('rejects a non-positive --timeout', async () => {
		await expect(dev({ timeout: '0' })).rejects.toThrow('--timeout needs')
		expect(devAll).not.toHaveBeenCalled()
	})

	it('passes --no-ladle through as ladle: false', async () => {
		await dev({ ladle: false })
		expect(devAll).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ ladle: false })
		)
	})
})
