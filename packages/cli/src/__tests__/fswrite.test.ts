/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFiles } from '../core/fswrite.js'
import { freshDir, removeDir } from './helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string

beforeEach(() => {
	dir = freshDir('spool-fs-')
})

afterEach(() => {
	removeDir(dir)
})

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')

/*
 *   WRITE FILES
 ***************************************************************************************************/
describe('writeFiles', () => {
	it('writes nested files and creates their folders', async () => {
		const result = await writeFiles(dir, { 'a.txt': 'A', 'src/b.txt': 'B' })
		expect(result.written.sort()).toEqual(['a.txt', 'src/b.txt'])
		expect(read('a.txt')).toBe('A')
		expect(read('src/b.txt')).toBe('B')
	})

	it('skips files that already exist', async () => {
		await writeFiles(dir, { 'a.txt': 'first' })
		const result = await writeFiles(dir, { 'a.txt': 'second' })
		expect(result).toEqual({ written: [], skipped: ['a.txt'] })
		expect(read('a.txt')).toBe('first')
	})

	it('overwrites when force is set', async () => {
		await writeFiles(dir, { 'a.txt': 'first' })
		const result = await writeFiles(dir, { 'a.txt': 'second' }, { force: true })
		expect(result.written).toEqual(['a.txt'])
		expect(read('a.txt')).toBe('second')
	})
})
