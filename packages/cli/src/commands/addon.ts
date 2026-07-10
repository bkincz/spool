/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { requireWorkspace, saveManifest, type Workspace } from '../core/workspace.js'
import {
	ADDONS,
	ADDON_NAMES,
	parseAddonList,
	promptAddons,
	type AddonName,
} from '../core/addons.js'
import {
	SENTRY_SDK,
	SENTRY_VERSION,
	SENTRY_VITE_PLUGIN_VERSION,
	SHARED_EXTRAS,
} from '../core/versions.js'
import { yamlKey } from '../core/generators.js'
import { formatFiles } from '../core/format.js'
import { writeFiles } from '../core/fswrite.js'
import { installDependencies } from '../core/install.js'
import { dependencyHome, type PackageJsonShape } from './upgrade.js'
import { packageName } from '../util/names.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface AddonOptions {
	install?: boolean
}

/*
 *   ADDON
 ***************************************************************************************************/
export async function addon(entries: string[], opts: AddonOptions): Promise<void> {
	const ws = await requireWorkspace()

	const names = await resolveNames(entries, ws)
	if (names === null) {
		p.cancel('Cancelled.')
		return
	}
	if (!names.length) {
		log.info('nothing to add')
		return
	}

	// Manifest and deps land before any addon file: a failure partway then
	// leaves at worst unused shared entries, never files with dangling imports.
	for (const name of names) ADDONS[name].apply?.(ws.manifest)
	await saveManifest(ws)
	await declareAppDeps(ws)

	for (const name of names) {
		const picked = ADDONS[name]
		// Existing files are never overwritten, so rerunning only fills gaps.
		const { written } = await writeFiles(ws.root, await formatFiles(picked.files(ws.manifest)))
		await allowPnpmBuilds(ws, picked.allowBuilds)
		log.success(`added ${name}${written.length ? '' : ' (files already present, left alone)'}`)
		for (const note of picked.notes(ws.manifest, false)) log.step(note)
	}

	const pm = ws.manifest.packageManager
	if (opts.install === false) {
		log.step(`Run \`${pm} install\` to finish setup.`)
		return
	}
	log.step(`Installing with ${pm}`)
	if (!(await installDependencies(pm, ws.root))) {
		log.warn(`Install failed. Run \`${pm} install\` to finish setup.`)
	}
}

/*
 *   STEPS
 ***************************************************************************************************/
async function resolveNames(entries: string[], ws: Workspace): Promise<AddonName[] | null> {
	if (entries.length) return parseAddonList(entries.join(','), ws.manifest)

	const available: AddonName[] = []
	for (const name of ADDON_NAMES) {
		if (ADDONS[name].unavailable(ws.manifest)) continue
		if (ADDONS[name].present(ws.root, ws.manifest)) {
			log.step(`${name} looks already added; run \`spool addon ${name}\` to reapply it.`)
			continue
		}
		available.push(name)
	}
	if (!available.length) {
		log.info('every available addon is already in this workspace')
		return []
	}
	return promptAddons('Extras to add?', available)
}

type Section = 'dependencies' | 'devDependencies'
type WantedDep = [dep: string, range: string, section: Section]

/** Deps an addon adds to existing apps: shared singletons must be declared per
 * app or federation drops them, and sentry's SDK/plugin aren't shared at all. */
function wantedAppDeps(ws: Workspace, app: Workspace['manifest']['apps'][string]): WantedDep[] {
	const sharedPackages = new Set(ws.manifest.shared.map(packageName))
	const wanted: WantedDep[] = Object.entries(SHARED_EXTRAS)
		.filter(([dep]) => sharedPackages.has(dep))
		.map(([dep, range]) => [dep, range, 'dependencies'])
	if (ws.manifest.addons.includes('sentry')) {
		wanted.push([SENTRY_SDK[app.framework], SENTRY_VERSION, 'dependencies'])
		wanted.push(['@sentry/vite-plugin', SENTRY_VITE_PLUGIN_VERSION, 'devDependencies'])
	}
	return wanted
}

async function declareAppDeps(ws: Workspace): Promise<void> {
	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const wanted = wantedAppDeps(ws, app)
		if (!wanted.length) continue

		const target = join(ws.root, app.path, 'package.json')
		if (!existsSync(target)) continue

		let pkg: PackageJsonShape
		try {
			pkg = JSON.parse(await readFile(target, 'utf8')) as PackageJsonShape
		} catch {
			log.warn(
				`${name}: package.json could not be parsed; declare ${wanted.map(([dep]) => dep).join(', ')} in it yourself.`
			)
			continue
		}

		pkg.dependencies ??= {}
		pkg.devDependencies ??= {}
		const changed: string[] = []
		for (const [dep, range, section] of wanted) {
			const home = dependencyHome(pkg, dep, section)
			if (home[dep] !== range) {
				changed.push(`${dep} ${home[dep] ?? 'added'} -> ${range}`)
				home[dep] = range
			}
		}
		if (!changed.length) continue

		const formatted = await formatFiles({ 'package.json': `${JSON.stringify(pkg)}\n` })
		await writeFile(target, formatted['package.json']!, 'utf8')
		log.step(`${name}: updated package.json (${changed.join(', ')})`)
	}
}

/** Adds missing entries to the pnpm build-script allowlist. */
async function allowPnpmBuilds(ws: Workspace, builds: string[]): Promise<void> {
	if (ws.manifest.packageManager !== 'pnpm' || !builds.length) return
	const target = join(ws.root, 'pnpm-workspace.yaml')
	const manual = `Allow the build scripts for ${builds.join(', ')} in pnpm-workspace.yaml yourself, or pnpm skips their postinstall.`
	if (!existsSync(target)) {
		log.warn(`pnpm-workspace.yaml is missing. ${manual}`)
		return
	}

	const content = await readFile(target, 'utf8')
	const missing = builds.filter(build => !hasBuildEntry(content, build))
	if (!missing.length) return

	const patched = insertBuilds(content, missing)
	if (patched === null) {
		log.warn(`pnpm-workspace.yaml has no allowBuilds/onlyBuiltDependencies sections. ${manual}`)
		return
	}
	// Formatting the patch keeps both write paths on prettier's yaml style.
	const formatted = await formatFiles({ 'pnpm-workspace.yaml': patched })
	await writeFile(target, formatted['pnpm-workspace.yaml']!, 'utf8')
	log.step(`allowed postinstall scripts for ${missing.join(', ')} in pnpm-workspace.yaml`)
}

/** Exact key/list-entry match, so "@swc/core-linux-x64-gnu" never hides "@swc/core". */
function hasBuildEntry(content: string, build: string): boolean {
	return content.split(/\r?\n/).some(line => {
		const entry = line
			.trim()
			.replace(/^-\s*/, '')
			.replace(/:.*$/, '')
			.replace(/^['"]|['"]$/g, '')
		return entry === build
	})
}

function insertBuilds(content: string, builds: string[]): string | null {
	const allow = content.match(/allowBuilds:(\r?\n)(\s+)/)
	const only = content.match(/onlyBuiltDependencies:(\r?\n)(\s+)/)
	if (!allow || !only) return null

	let out = content
	for (const build of builds) {
		const key = yamlKey(build)
		out = out.replace(/allowBuilds:(\r?\n)/, `allowBuilds:$1${allow[2]}${key}: true$1`)
		out = out.replace(
			/onlyBuiltDependencies:(\r?\n)/,
			`onlyBuiltDependencies:$1${only[2]}- ${key}$1`
		)
	}
	return out
}
