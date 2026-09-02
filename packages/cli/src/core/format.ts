/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import type { FileMap } from './filemap.js'

/*
 *   HOUSE STYLE
 ***************************************************************************************************/
/**
 * Emitted into every scaffold as `.prettierrc` and applied to every generated
 * file at write time, so generated files always match the shipped config.
 */
export const PRETTIER_OPTIONS = {
	arrowParens: 'avoid',
	bracketSpacing: true,
	endOfLine: 'auto',
	printWidth: 100,
	semi: false,
	singleQuote: true,
	tabWidth: 4,
	trailingComma: 'es5',
	useTabs: true,
} as const

/*
 *   FORMAT
 ***************************************************************************************************/
// Loaded lazily so commands that never format (dev, build, doctor) don't pay
// prettier's import cost at startup.
const prettier = () => import('prettier')

async function optionsFor(root: string | undefined): Promise<Record<string, unknown>> {
	if (root === undefined) return { ...PRETTIER_OPTIONS }

	const { resolveConfig } = await prettier()

	try {
		const found = await resolveConfig(join(root, 'package.json'))
		return found ? { ...PRETTIER_OPTIONS, ...found } : { ...PRETTIER_OPTIONS }
	} catch {
		return { ...PRETTIER_OPTIONS }
	}
}

/** Format one file; the parser is inferred from `filepath`. */
export async function formatFile(
	filepath: string,
	content: string,
	root?: string
): Promise<string> {
	const { format } = await prettier()
	return format(content, { ...(await optionsFor(root)), filepath })
}

/**
 * Format every file prettier has a parser for. Files it does not understand
 * (.gitignore, .yarnrc.yml) pass through untouched.
 */
export async function formatFiles(files: FileMap, root?: string): Promise<FileMap> {
	const { format, getFileInfo } = await prettier()
	const options = await optionsFor(root)
	const entries = await Promise.all(
		Object.entries(files).map(async ([rel, content]): Promise<[string, string]> => {
			const { inferredParser } = await getFileInfo(rel)
			if (!inferredParser) return [rel, content]
			return [rel, await format(content, { ...options, filepath: rel })]
		})
	)
	return Object.fromEntries(entries)
}
