/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'

/*
 *   WORKSPACE MEMBERS
 ***************************************************************************************************/
export function labelledMembers(ws: Workspace): [string, string][] {
	const byPath = new Map<string, string>()

	for (const path of workspaceMembers(ws)) byPath.set(path, path)
	for (const [name, app] of Object.entries(ws.manifest.apps)) byPath.set(app.path, name)

	return [...byPath].map(([path, name]) => [name, path])
}

export function workspaceMembers(ws: Workspace): string[] {
	const globs = memberGlobs(ws)
	const members = new Set<string>()

	for (const glob of globs) {
		for (const dir of expand(ws.root, glob)) members.add(dir)
	}

	return [...members].sort()
}

function memberGlobs(ws: Workspace): string[] {
	if (ws.manifest.packageManager === 'pnpm') {
		const yaml = join(ws.root, 'pnpm-workspace.yaml')

		if (!existsSync(yaml)) return []

		return readFileSync(yaml, 'utf8')
			.split('\n')
			.map(line => /^\s*-\s*["']?([^"'#]+?)["']?\s*$/.exec(line)?.[1])
			.filter((entry): entry is string => Boolean(entry))
	}

	const pkg = join(ws.root, 'package.json')

	if (!existsSync(pkg)) return []

	try {
		const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: string[] }
		return parsed.workspaces ?? []
	} catch {
		return []
	}
}

/** Only the one shape package managers actually use: a single trailing star. */
function expand(root: string, glob: string): string[] {
	const trimmed = glob.replace(/^\.\//, '').replace(/\/$/, '')

	if (!trimmed.endsWith('/*')) {
		return existsSync(join(root, trimmed)) ? [trimmed] : []
	}

	const parent = trimmed.slice(0, -2)
	const full = join(root, parent)

	if (!existsSync(full)) return []

	return readdirSync(full, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => `${parent}/${entry.name}`)
		.filter(dir => existsSync(join(root, dir, 'package.json')))
}
