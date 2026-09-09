/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { build } from '../../commands/build.js'
import { buildAll } from '../../core/orchestrator.js'
import { makeWorkspace, remote } from '../helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../../core/orchestrator.js', () => ({ buildAll: vi.fn() }))
vi.mock('../../core/workspace.js', () => ({
	requireWorkspace: vi.fn(async () => makeWorkspace('/ws', { dashboard: remote() })),
}))

beforeEach(() => {
	vi.mocked(buildAll).mockResolvedValue(undefined)
})

/*
 *   BUILD
 ***************************************************************************************************/
describe('build', () => {
	it('rejects a non-numeric concurrency', async () => {
		await expect(build({ concurrency: 'lots' })).rejects.toThrow('--concurrency needs')
		expect(buildAll).not.toHaveBeenCalled()
	})

	it('prints one JSON line per app to stdout when --json is set', async () => {
		vi.mocked(buildAll).mockImplementation(async (_ws, _only, _env, _concurrency, onResult) => {
			onResult?.({ name: 'dashboard', ok: true, duration: 42 })
		})
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await build({ json: true })

		expect(write).toHaveBeenCalledWith(
			`${JSON.stringify({ name: 'dashboard', ok: true, duration: 42 })}\n`
		)
	})

	it('still prints results collected before a rejection, then re-throws', async () => {
		vi.mocked(buildAll).mockImplementation(async (_ws, _only, _env, _concurrency, onResult) => {
			onResult?.({ name: 'dashboard', ok: false, duration: 1, error: 'boom' })
			throw new Error('Build failed')
		})
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		await expect(build({ json: true })).rejects.toThrow('Build failed')
		expect(write).toHaveBeenCalledWith(expect.stringContaining('"ok":false'))
	})

	it('does not touch stdout without --json', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		await build({})
		expect(write).not.toHaveBeenCalled()
	})
})
