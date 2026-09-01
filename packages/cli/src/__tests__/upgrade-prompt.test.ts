/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { create } from '../commands/create.js'
import { upgrade } from '../commands/upgrade.js'
import { PROVENANCE_FILE } from '../core/provenance.js'
import { freshDir, removeDir } from './helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../util/exec.js', () => ({ run: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@clack/prompts', async importOriginal => {
	const actual = (await importOriginal()) as typeof p
	return { ...actual, select: vi.fn() }
})

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const HELPER = 'spool.vite.ts'

function editGeneratedFiles(): { helper: string; config: string } {
	const helper = `${read(HELPER)}\n// my own helper on top\n`
	const config = `${read('apps/shell/vite.config.ts')}\n// and my own config\n`
	writeFileSync(join(dir, HELPER), helper)
	writeFileSync(join(dir, 'apps/shell/vite.config.ts'), config)
	return { helper, config }
}

beforeEach(async () => {
	dir = freshDir('spool-prompt-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => {})

	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard',
		install: false,
	})

	process.chdir(dir)
	Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)

	Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
	vi.restoreAllMocks()
})

/*
 *   OVERWRITE PROMPT
 ***************************************************************************************************/
describe('upgrade overwrite prompt', () => {
	it('keeps the file when the answer is keep', async () => {
		const { helper } = editGeneratedFiles()
		vi.mocked(p.select).mockResolvedValue('keep')

		await upgrade({})

		expect(read(HELPER)).toBe(helper)
	})

	it('replaces the file when the answer is overwrite', async () => {
		editGeneratedFiles()
		vi.mocked(p.select).mockResolvedValue('overwrite')

		await upgrade({})

		expect(read(HELPER)).toContain('export function spoolApp')
	})

	it('asks once for overwrite-all and applies it to the rest', async () => {
		editGeneratedFiles()
		vi.mocked(p.select).mockResolvedValue('overwrite-all')

		await upgrade({})

		expect(p.select).toHaveBeenCalledTimes(1)
		expect(read(HELPER)).toContain('export function spoolApp')
		expect(read('apps/shell/vite.config.ts')).toContain("spoolApp('shell'")
	})

	it('asks once for keep-all and leaves the rest alone', async () => {
		const { helper, config } = editGeneratedFiles()
		vi.mocked(p.select).mockResolvedValue('keep-all')

		await upgrade({})

		expect(p.select).toHaveBeenCalledTimes(1)
		expect(read(HELPER)).toBe(helper)
		expect(read('apps/shell/vite.config.ts')).toBe(config)
	})

	it('stops asking about a file after the answer is keep', async () => {
		const { helper } = editGeneratedFiles()
		vi.mocked(p.select).mockResolvedValue('keep')

		await upgrade({})
		vi.mocked(p.select).mockClear()
		await upgrade({})

		expect(p.select).not.toHaveBeenCalled()
		expect(read(HELPER)).toBe(helper)
		expect(JSON.parse(read(PROVENANCE_FILE)).owned).toContain(HELPER)
	})

	it('asks about a marked file it has no record of', async () => {
		editGeneratedFiles()
		rmSync(join(dir, PROVENANCE_FILE))
		vi.mocked(p.select).mockResolvedValue('overwrite')

		await upgrade({})

		expect(p.select).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('predates') })
		)
	})

	it('does not ask at all with --force', async () => {
		editGeneratedFiles()

		await upgrade({ force: true })

		expect(p.select).not.toHaveBeenCalled()
		expect(read(HELPER)).toContain('export function spoolApp')
	})
})
