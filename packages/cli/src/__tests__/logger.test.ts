/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, afterEach } from 'vitest'
import { log, fail } from '../util/logger.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
afterEach(() => {
	vi.restoreAllMocks()
})

/*
 *   LOG
 ***************************************************************************************************/
describe('log', () => {
	it('writes info, step, success and warn through console.log', () => {
		const out = vi.spyOn(console, 'log').mockImplementation(() => {})
		log.info('hi')
		log.step('walk')
		log.success('done')
		log.warn('careful')
		log.plain('raw')
		expect(out).toHaveBeenCalledTimes(5)
	})

	it('writes errors through console.error', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {})
		log.error('boom')
		expect(err).toHaveBeenCalledOnce()
	})
})

/*
 *   FAIL
 ***************************************************************************************************/
describe('fail', () => {
	it('logs the message and exits with code 1', () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {})
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
		// process.exit is stubbed, so fail returns here instead of ending the run
		const invoke = fail as (msg: string) => void
		invoke('nope')
		expect(err).toHaveBeenCalledOnce()
		expect(exit).toHaveBeenCalledWith(1)
	})
})
