/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatFiles } from '../../core/format.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

const source = { 'a.ts': 'export const list = [\n\t1,\n\t2,\n]\n' }

beforeEach(() => {
	root = freshDir('spool-format-')
})

afterEach(() => {
	removeDir(root)
})

/*
 *   WORKSPACE STYLE
 ***************************************************************************************************/
describe('formatFiles', () => {
	it('uses spool defaults when no root is given', async () => {
		const out = await formatFiles(source)

		expect(out['a.ts']).toContain('[1, 2]')
	})

	it('follows the workspace prettier config', async () => {
		writeFileSync(join(root, '.prettierrc'), JSON.stringify({ semi: true, singleQuote: false }))

		const out = await formatFiles({ 'a.ts': "export const name = 'x'\n" }, root)

		expect(out['a.ts']).toBe('export const name = "x";\n')
	})

	it('keeps spool defaults for anything the workspace does not set', async () => {
		writeFileSync(join(root, '.prettierrc'), JSON.stringify({ semi: true }))

		const out = await formatFiles({ 'a.ts': "export const name = 'x'\n" }, root)

		expect(out['a.ts']).toBe("export const name = 'x';\n")
	})

	it('falls back to the defaults when the workspace has no config', async () => {
		const out = await formatFiles({ 'a.ts': 'export const name = "x"\n' }, root)

		expect(out['a.ts']).toBe("export const name = 'x'\n")
	})
})
