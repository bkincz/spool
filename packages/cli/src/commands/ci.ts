/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireWorkspace, type Workspace } from '../core/workspace.js'
import {
	ciWorkflows,
	PINNED_ACTIONS,
	NODE_VERSION_FALLBACK,
	type ActionKey,
	type ActionPins,
} from '../core/templates/workflows.js'
import { readPackageJson } from '../core/packages.js'
import { workspaceMembers } from '../core/packages-glob.js'
import { formatFiles } from '../core/format.js'
import { writeFiles } from '../core/fswrite.js'
import { rangeFloor } from '../util/semver.js'
import { runCaptured } from '../util/exec.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface CiOptions {
	force?: boolean
	pin?: boolean
}

/*
 *   NODE VERSION
 ***************************************************************************************************/
function resolveNodeVersion(ws: Workspace, engineRange: string | undefined): string {
	if (engineRange) {
		const floor = rangeFloor(engineRange)
		if (floor) return floor.join('.')
	}

	const nvmrc = join(ws.root, '.nvmrc')
	if (existsSync(nvmrc)) {
		const version = readFileSync(nvmrc, 'utf8').trim().replace(/^v/, '')
		if (version) return version
	}

	return NODE_VERSION_FALLBACK
}

/*
 *   ACTION PINS
 ***************************************************************************************************/
function shaFromLsRemote(output: string): string | undefined {
	const lines = output.trim().split('\n').filter(Boolean)
	const peeled = lines.find(line => line.endsWith('^{}'))
	return (peeled ?? lines[0])?.split('\t')[0]
}

async function resolvePin(action: {
	owner: string
	repo: string
	tag: string
}): Promise<string | undefined> {
	const { code, output } = await runCaptured(
		'git',
		[
			'ls-remote',
			`https://github.com/${action.owner}/${action.repo}`,
			`refs/tags/${action.tag}`,
		],
		{ timeout: 5_000 }
	)

	if (code !== 0) return undefined

	const sha = shaFromLsRemote(output)
	return sha ? `${action.owner}/${action.repo}@${sha} # ${action.tag}` : undefined
}

async function resolveActionPins(): Promise<Partial<ActionPins>> {
	const entries = await Promise.all(
		(Object.entries(PINNED_ACTIONS) as [ActionKey, (typeof PINNED_ACTIONS)[ActionKey]][]).map(
			async ([key, action]) => {
				const pin = await resolvePin(action)
				if (!pin) {
					log.warn(
						`Could not resolve ${action.owner}/${action.repo}@${action.tag} to a commit (offline?); leaving it on the tag. Run \`spool ci --pin\` again once you have network access.`
					)
				}
				return [key, pin] as const
			}
		)
	)

	return Object.fromEntries(entries.filter(([, pin]) => pin !== undefined)) as Partial<ActionPins>
}

/*
 *   CI
 ***************************************************************************************************/
export async function ci(opts: CiOptions): Promise<void> {
	const ws = await requireWorkspace()
	const apps = Object.entries(ws.manifest.apps)

	const root = readPackageJson(join(ws.root, 'package.json'))
	const scripts = typeof root === 'string' ? {} : (root.scripts ?? {})
	const engineRange = typeof root === 'string' ? undefined : root.engines?.node

	for (const [name] of apps.filter(([, app]) => !app.deploy)) {
		log.warn(`${name} has no "deploy" command in spool.json; no deploy workflow for it.`)
	}

	if (!apps.some(([, app]) => app.deploy)) {
		log.step('Add a "deploy" command to an app in spool.json to get a deploy workflow for it.')
	}

	const nodeVersion = resolveNodeVersion(ws, engineRange)
	const packageGlobs = workspaceMembers(ws)
	const pins = opts.pin ? await resolveActionPins() : {}

	const files = await formatFiles(
		ciWorkflows(ws.manifest, scripts, { nodeVersion, packageGlobs, pins }),
		ws.root
	)
	const result = await writeFiles(ws.root, files, { force: (opts.force || opts.pin) ?? false })

	for (const rel of result.written) log.step(`wrote ${rel}`)
	for (const rel of result.skipped) {
		log.warn(`${rel} already exists; rerun with --force to regenerate it.`)
	}

	log.success(`generated ${result.written.length} workflow(s)`)
	if (result.written.length) {
		log.step('Commit them, and add the secrets your deploy commands need to the repository.')
	}
}
