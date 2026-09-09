/*
 *   IMPORTS
 ***************************************************************************************************/
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as p from '@clack/prompts'
import { requireWorkspace } from '../core/workspace.js'
import { editJsonFile } from '../core/packages.js'
import { HELPER_FILE, MANIFEST_FILE, WORKSPACE_FILE, type Manifest } from '../core/config.js'
import { PROVENANCE_FILE } from '../core/provenance.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface EjectOptions {
	yes?: boolean
}

const SPOOL_DEP = '@bkincz/spool'
/** Scripts spool.json's own scaffold writes; only these get touched. */
const REPLACED_SCRIPTS = ['dev', 'build'] as const
const REMOVED_SCRIPTS = ['preview', 'doctor'] as const

/*
 *   EJECT
 ***************************************************************************************************/
export async function eject(opts: EjectOptions): Promise<void> {
	const ws = await requireWorkspace()

	if (!(await confirm(opts.yes ?? false))) {
		log.step('Cancelled; nothing was changed.')
		return
	}

	const native = nativeScripts(ws.manifest.packageManager)
	const changes = await editJsonFile(
		join(ws.root, 'package.json'),
		pkg => {
			const done: string[] = []

			if (pkg.devDependencies && SPOOL_DEP in pkg.devDependencies) {
				delete pkg.devDependencies[SPOOL_DEP]
				done.push(`removed devDependencies["${SPOOL_DEP}"]`)
			}

			pkg.scripts ??= {}
			for (const script of REPLACED_SCRIPTS) {
				if (!isSpoolScript(pkg.scripts[script])) continue
				pkg.scripts[script] = native[script]
				done.push(`scripts.${script} -> ${native[script]}`)
			}
			for (const script of REMOVED_SCRIPTS) {
				if (!isSpoolScript(pkg.scripts[script])) continue
				delete pkg.scripts[script]
				done.push(`removed scripts.${script}`)
			}

			return done
		},
		{ root: ws.root }
	)

	await rm(join(ws.root, '.spool'), { recursive: true, force: true })
	changes.push(`deleted .spool/ (including ${PROVENANCE_FILE})`)

	log.success('spool removed from this workspace')
	for (const change of changes) log.step(change)

	log.step(
		'`spool dev`/`spool build` ran remotes before hosts; the native scripts run every app in whatever order the package manager picks, so wire that ordering yourself (a filtered run per role, or a task runner like turbo/nx) if it matters to your build.'
	)
	log.step(
		`kept, and still yours to use: ${MANIFEST_FILE} (the wiring you are migrating off of), ${HELPER_FILE} and ${WORKSPACE_FILE} (imported by every app's vite config), and every generated file (vite.config.ts, package.json, ...) — eject only removes spool's own dependency, scripts and bookkeeping.`
	)
}

/*
 *   HELPERS
 ***************************************************************************************************/
async function confirm(yes: boolean): Promise<boolean> {
	if (yes || !process.stdin.isTTY) return true

	const answer = await p.confirm({
		message:
			'Remove spool from this workspace? Generated files stay; only its dependency and scripts go.',
		initialValue: false,
	})

	return !p.isCancel(answer) && answer
}

function isSpoolScript(value: string | undefined): boolean {
	return value !== undefined && value.startsWith('spool ')
}

function nativeScripts(pm: Manifest['packageManager']): Record<'dev' | 'build', string> {
	if (pm === 'pnpm') {
		return { dev: 'pnpm -r --parallel --if-present dev', build: 'pnpm -r --if-present build' }
	}
	if (pm === 'yarn') {
		return {
			dev: 'yarn workspaces foreach --all --parallel --interlaced run dev',
			build: 'yarn workspaces foreach --all run build',
		}
	}
	return {
		dev: 'npm run dev --workspaces --if-present',
		build: 'npm run build --workspaces --if-present',
	}
}
