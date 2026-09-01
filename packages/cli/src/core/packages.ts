/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { formatFiles } from './format.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface PackageJsonDeps {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

export interface PackageJsonShape {
	engines?: Record<string, string>
	packageManager?: string
	scripts?: Record<string, string>
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	[key: string]: unknown
}

export type DependencySection = 'dependencies' | 'devDependencies'

/*
 *   READ
 ***************************************************************************************************/
export function readPackageJson(path: string): PackageJsonShape | 'missing' | 'invalid' {
	if (!existsSync(path)) return 'missing'

	try {
		return JSON.parse(readFileSync(path, 'utf8')) as PackageJsonShape
	} catch {
		return 'invalid'
	}
}

export function dependencyHome(
	pkg: PackageJsonShape,
	dep: string,
	section: DependencySection
): Record<string, string> {
	if (pkg.dependencies?.[dep] !== undefined) return pkg.dependencies
	if (pkg.devDependencies?.[dep] !== undefined) return pkg.devDependencies

	return (pkg[section] ??= {}) as Record<string, string>
}

/*
 *   WRITE
 ***************************************************************************************************/
export async function editJsonFile(
	target: string,
	edit: (json: PackageJsonShape) => string[],
	opts: { write?: boolean } = {}
): Promise<string[]> {
	if (!existsSync(target)) return []

	const json = JSON.parse(await readFile(target, 'utf8')) as PackageJsonShape
	const changes = edit(json)
	if (!changes.length) return []

	if (opts.write ?? true) {
		const rel = basename(target)
		const formatted = await formatFiles({ [rel]: `${JSON.stringify(json)}\n` })

		await writeFile(target, formatted[rel]!, 'utf8')
	}

	return changes
}
