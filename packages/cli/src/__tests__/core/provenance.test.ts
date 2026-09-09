/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Provenance, PROVENANCE_FILE, hashContent, sameContent } from '../../core/provenance.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let root: string

beforeEach(() => {
	root = freshDir('spool-provenance-')
})

afterEach(() => {
	removeDir(root)
})

/*
 *   SAME CONTENT
 ***************************************************************************************************/
describe('sameContent', () => {
	it('treats a CRLF checkout as identical to the LF original', () => {
		expect(sameContent('line one\nline two\n', 'line one\r\nline two\r\n')).toBe(true)
	})

	it('still tells apart genuinely different content', () => {
		expect(sameContent('a\n', 'b\n')).toBe(false)
	})
})

/*
 *   RECORD / OWNERSHIP
 ***************************************************************************************************/
describe('ownership', () => {
	it('is "unknown" with no record, "ours" right after recording, and "edited" once the file changes', () => {
		const provenance = Provenance.load(root)
		expect(provenance.ownership(root, 'a.ts', 'content')).toBe('unknown')

		provenance.record(root, 'a.ts', 'content')
		expect(provenance.ownership(root, 'a.ts', 'content')).toBe('ours')
		expect(provenance.ownership(root, 'a.ts', 'changed')).toBe('edited')
	})

	it('treats a CRLF line ending as still "ours"', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'a.ts', 'line\n')
		expect(provenance.ownership(root, 'a.ts', 'line\r\n')).toBe('ours')
	})

	it('claim marks a file "owned" and record un-claims it', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'a.ts', 'content')
		provenance.claim(root, 'a.ts')
		expect(provenance.ownership(root, 'a.ts', 'anything')).toBe('owned')

		provenance.record(root, 'a.ts', 'anything')
		expect(provenance.ownership(root, 'a.ts', 'anything')).toBe('ours')
	})
})

/*
 *   FORGET / RENAME / PRUNE
 ***************************************************************************************************/
describe('forget', () => {
	it('drops a single record', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'a.ts', 'x')
		provenance.forget(root, 'a.ts')
		expect(provenance.tracks('a.ts')).toBe(false)
	})
})

describe('forgetPrefix', () => {
	it('drops every record and claim under an app folder, leaving others alone', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'apps/dashboard/vite.config.ts', 'x')
		provenance.record(root, 'apps/dashboard/public/_headers', 'y')
		provenance.claim(root, 'apps/dashboard/src/app.tsx')
		provenance.record(root, 'apps/shell/vite.config.ts', 'z')

		provenance.forgetPrefix('apps/dashboard')

		expect(provenance.tracks('apps/dashboard/vite.config.ts')).toBe(false)
		expect(provenance.tracks('apps/dashboard/public/_headers')).toBe(false)
		expect(provenance.tracks('apps/dashboard/src/app.tsx')).toBe(false)
		expect(provenance.tracks('apps/shell/vite.config.ts')).toBe(true)
	})
})

describe('rename', () => {
	it('moves a tracked record to the new path', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'src/shell/remote.tsx', 'x')
		provenance.rename(root, 'src/shell/remote.tsx', 'src/federation/remote.tsx')

		expect(provenance.tracks('src/shell/remote.tsx')).toBe(false)
		expect(provenance.tracks('src/federation/remote.tsx')).toBe(true)
	})

	it('moves an owned claim to the new path', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'src/shell/remote.tsx', 'x')
		provenance.claim(root, 'src/shell/remote.tsx')
		provenance.rename(root, 'src/shell/remote.tsx', 'src/federation/remote.tsx')

		expect(provenance.ownership(root, 'src/federation/remote.tsx', 'anything')).toBe('owned')
	})

	it('is a no-op when nothing is recorded at the old path', () => {
		const provenance = Provenance.load(root)
		expect(() =>
			provenance.rename(root, 'src/shell/remote.tsx', 'src/federation/remote.tsx')
		).not.toThrow()
		expect(provenance.tracks('src/federation/remote.tsx')).toBe(false)
	})
})

describe('pruneMissing', () => {
	it('drops records for files no longer on disk, keeping ones still there', async () => {
		const provenance = Provenance.load(root)
		mkdirSync(join(root, 'apps/shell'), { recursive: true })
		writeFileSync(join(root, 'apps/shell/vite.config.ts'), 'x')
		provenance.record(root, 'apps/shell/vite.config.ts', 'x')
		provenance.record(root, 'apps/gone/vite.config.ts', 'y')

		provenance.pruneMissing(root)
		await provenance.save()

		expect(provenance.tracks('apps/shell/vite.config.ts')).toBe(true)
		expect(provenance.tracks('apps/gone/vite.config.ts')).toBe(false)
	})
})

/*
 *   ENTRIES / TRACKS
 ***************************************************************************************************/
describe('entries', () => {
	it('lists every tracked file with its hash, excluding owned ones', () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'a.ts', 'content')
		provenance.record(root, 'b.ts', 'other')
		provenance.claim(root, 'b.ts')

		const entries = provenance.entries()
		expect(entries).toEqual([['a.ts', hashContent('content')]])
	})
})

/*
 *   SAVE / LOAD ROUND TRIP
 ***************************************************************************************************/
describe('save and load', () => {
	it('round-trips files and owned claims through disk', async () => {
		const first = Provenance.load(root)
		first.record(root, 'apps/shell/vite.config.ts', 'x')
		first.claim(root, 'apps/shell/src/app.tsx')
		await first.save()

		expect(existsSync(join(root, PROVENANCE_FILE))).toBe(true)

		const second = Provenance.load(root)
		expect(second.ownership(root, 'apps/shell/vite.config.ts', 'x')).toBe('ours')
		expect(second.ownership(root, 'apps/shell/src/app.tsx', 'anything')).toBe('owned')
	})

	it('treats an unreadable provenance file as absent, not a conflict', () => {
		mkdirSync(join(root, '.spool'), { recursive: true })
		writeFileSync(join(root, PROVENANCE_FILE), 'not json')

		const provenance = Provenance.load(root)
		expect(provenance.ownership(root, 'a.ts', 'x')).toBe('unknown')
	})

	it('never writes the file when nothing changed', async () => {
		const provenance = Provenance.load(root)
		await provenance.save()
		expect(existsSync(join(root, PROVENANCE_FILE))).toBe(false)
	})

	it('sorts files for a stable diff', async () => {
		const provenance = Provenance.load(root)
		provenance.record(root, 'z.ts', 'z')
		provenance.record(root, 'a.ts', 'a')
		await provenance.save()

		const saved = JSON.parse(readFileSync(join(root, PROVENANCE_FILE), 'utf8')) as {
			files: Record<string, string>
		}
		expect(Object.keys(saved.files)).toEqual(['a.ts', 'z.ts'])
	})
})
