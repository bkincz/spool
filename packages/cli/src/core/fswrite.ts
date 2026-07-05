/*
 *   IMPORTS
 ***************************************************************************************************/
import { mkdir, writeFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FileMap } from './generators.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface WriteResult {
	written: string[]
	skipped: string[]
}

/*
 *   WRITE
 ***************************************************************************************************/
async function exists(p: string): Promise<boolean> {
	try {
		await access(p, constants.F_OK)
		return true
	} catch {
		return false
	}
}

/** Write a FileMap under `baseDir`. Existing files are skipped unless `force`. */
export async function writeFiles(
	baseDir: string,
	files: FileMap,
	opts: { force?: boolean } = {}
): Promise<WriteResult> {
	const results = await Promise.all(
		Object.entries(files).map(async ([rel, content]): Promise<[string, boolean]> => {
			const target = join(baseDir, rel)
			if (!opts.force && (await exists(target))) return [rel, false]
			await mkdir(dirname(target), { recursive: true })
			await writeFile(target, content, 'utf8')
			return [rel, true]
		})
	)
	return {
		written: results.filter(([, wrote]) => wrote).map(([rel]) => rel),
		skipped: results.filter(([, wrote]) => !wrote).map(([rel]) => rel),
	}
}
