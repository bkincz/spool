/*
 *   IMPORTS
 ***************************************************************************************************/
import type { FileMap } from './generators.js'

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

/** Format one file; the parser is inferred from `filepath`. */
export async function formatFile(filepath: string, content: string): Promise<string> {
	const { format } = await prettier()
	return format(content, { ...PRETTIER_OPTIONS, filepath })
}

/**
 * Format every file prettier has a parser for. Files it does not understand
 * (.gitignore, .yarnrc.yml) pass through untouched.
 */
export async function formatFiles(files: FileMap): Promise<FileMap> {
	const { format, getFileInfo } = await prettier()
	const entries = await Promise.all(
		Object.entries(files).map(async ([rel, content]): Promise<[string, string]> => {
			const { inferredParser } = await getFileInfo(rel)
			if (!inferredParser) return [rel, content]
			return [rel, await format(content, { ...PRETTIER_OPTIONS, filepath: rel })]
		})
	)
	return Object.fromEntries(entries)
}
