/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import pc from 'picocolors'
import { requireWorkspace, saveManifest, type Workspace } from '../core/workspace.js'
import { MANIFEST_FILE } from '../core/config.js'
import {
	diagnose,
	diagnosePorts,
	diagnoseRemotes,
	type DepWrite,
	type Diagnostic,
} from '../core/doctor.js'
import { dependencyHome, editJsonFile } from '../core/packages.js'
import { ROOT_LABEL } from '../core/ranges.js'
import { log } from '../util/logger.js'

/*
 *   DOCTOR
 ***************************************************************************************************/
export interface DoctorOptions {
	remote?: boolean
	env?: string
	fix?: boolean
	dryRun?: boolean
	json?: boolean
}

export async function doctor(opts: DoctorOptions = {}): Promise<void> {
	const ws = await requireWorkspace()
	let issues = diagnose(ws)

	if (opts.fix && issues.some(issue => issue.fix)) {
		const applied = await applyFixes(ws, issues, opts.dryRun ?? false, opts.json ?? false)

		if (applied && !opts.dryRun) issues = diagnose(ws)
	}

	issues.push(...(await diagnosePorts(ws)))

	if (opts.remote) {
		// Builds read SPOOL_ENV when --env is absent, so doctor probes the same urls.
		const env = (opts.env ?? process.env.SPOOL_ENV) || undefined
		issues.push(...(await diagnoseRemotes(ws, env)))
	}

	const errors = issues.filter(i => i.level === 'error').length
	if (errors) process.exitCode = 1

	if (opts.json) {
		log.plain(JSON.stringify({ problems: issues }, null, 2))
		return
	}

	if (!issues.length) {
		log.success(`${pc.bold(ws.manifest.name)}: no problems found`)
		return
	}

	for (const d of issues) {
		const where = d.app ? pc.dim(`(${d.app}) `) : ''
		if (d.level === 'error') log.error(`${where}${d.message}`)
		else log.warn(`${where}${d.message}`)
	}

	log.plain('')
	log.info(`${errors} error(s), ${issues.length - errors} warning(s)`)

	const fixable = issues.filter(i => i.fix).length
	if (fixable && !opts.fix) {
		log.step(`${fixable} of these can be fixed automatically: rerun with --fix.`)
	}
}

/*
 *   FIXES
 ***************************************************************************************************/
async function applyFixes(
	ws: Workspace,
	issues: Diagnostic[],
	dryRun: boolean,
	quiet: boolean
): Promise<number> {
	const shares = new Set<string>()
	const byApp = new Map<string, DepWrite[]>()

	for (const { fix } of issues) {
		if (!fix) continue

		if (fix.kind === 'share') shares.add(fix.dep)
		else
			for (const write of fix.writes) {
				byApp.set(write.app, [...(byApp.get(write.app) ?? []), write])
			}
	}

	const verb = dryRun ? 'would update' : 'updated'
	const step = (msg: string): void => {
		if (!quiet) log.step(msg)
	}
	let applied = 0

	const added = [...shares].filter(dep => !ws.manifest.shared.includes(dep))
	if (added.length) {
		ws.manifest.shared = [...ws.manifest.shared, ...added]
		step(`${verb} ${MANIFEST_FILE} (shared += ${added.join(', ')})`)

		if (!dryRun) await saveManifest(ws)

		applied += added.length
	}

	for (const [name, writes] of byApp) {
		const dir = packageDir(ws, name)

		if (dir === undefined) continue

		const changes = await editJsonFile(
			join(dir, 'package.json'),
			pkg => {
				const done: string[] = []

				for (const { dep, range } of writes) {
					const home = dependencyHome(pkg, dep, 'dependencies')
					if (home[dep] === range) continue

					done.push(`${dep} ${home[dep] ?? 'added'} -> ${range}`)
					home[dep] = range
				}

				return done
			},
			{ write: !dryRun, root: ws.root }
		)
		if (changes.length) {
			step(`${name}: ${verb} package.json (${changes.join(', ')})`)
			applied += changes.length
		}
	}

	if (!applied) return 0

	if (dryRun) {
		step(`${applied} change(s) pending. Rerun without --dry-run to apply.`)
		return applied
	}

	step(`Review the changes with git, then run \`${ws.manifest.packageManager} install\`.`)
	return applied
}

function packageDir(ws: Workspace, name: string): string | undefined {
	if (name === ROOT_LABEL) return ws.root

	const app = ws.manifest.apps[name]
	if (app) return join(ws.root, app.path)

	const candidate = join(ws.root, name)
	return existsSync(candidate) ? candidate : undefined
}
