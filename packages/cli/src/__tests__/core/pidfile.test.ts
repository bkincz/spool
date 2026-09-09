/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writePidfile, readPidfile, removePidfile, pidfilePath } from '../../core/pidfile.js'
import { makeWorkspace, remote, freshDir, removeDir } from '../helpers.js'

/*
 *   TESTS
 ***************************************************************************************************/
let root: string

afterEach(() => {
	if (root) removeDir(root)
})

describe('pidfile', () => {
	it('writes children and reads them back with the parent pid and a timestamp', () => {
		root = freshDir('spool-pidfile-')
		const ws = makeWorkspace(root, { dashboard: remote() })

		writePidfile(ws, 'dev', [{ name: 'dashboard', port: 5174, pid: 4242 }])

		expect(existsSync(pidfilePath(ws, 'dev'))).toBe(true)
		const pidfile = readPidfile(ws, 'dev')
		expect(pidfile?.parentPid).toBe(process.pid)
		expect(pidfile?.children).toEqual([{ name: 'dashboard', port: 5174, pid: 4242 }])
		expect(pidfile?.startedAt).toEqual(expect.any(String))
	})

	it('keeps dev and preview pidfiles separate', () => {
		root = freshDir('spool-pidfile-modes-')
		const ws = makeWorkspace(root, { dashboard: remote() })

		writePidfile(ws, 'dev', [{ name: 'dashboard', port: 5174, pid: 1 }])
		writePidfile(ws, 'preview', [{ name: 'dashboard', port: 5174, pid: 2 }])

		expect(readPidfile(ws, 'dev')?.children[0]?.pid).toBe(1)
		expect(readPidfile(ws, 'preview')?.children[0]?.pid).toBe(2)
	})

	it('returns undefined when there is no pidfile', () => {
		root = freshDir('spool-pidfile-missing-')
		const ws = makeWorkspace(root, { dashboard: remote() })
		expect(readPidfile(ws, 'dev')).toBeUndefined()
	})

	it('returns undefined for a corrupt pidfile instead of throwing', () => {
		root = freshDir('spool-pidfile-corrupt-')
		const ws = makeWorkspace(root, { dashboard: remote() })
		writePidfile(ws, 'dev', [])
		writeFileSync(join(root, '.spool', 'dev.pid'), 'not json')

		expect(readPidfile(ws, 'dev')).toBeUndefined()
	})

	it('removes the pidfile, and is a no-op if it is already gone', () => {
		root = freshDir('spool-pidfile-remove-')
		const ws = makeWorkspace(root, { dashboard: remote() })
		writePidfile(ws, 'dev', [])

		removePidfile(ws, 'dev')
		expect(existsSync(pidfilePath(ws, 'dev'))).toBe(false)
		expect(() => removePidfile(ws, 'dev')).not.toThrow()
	})
})
