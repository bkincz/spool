/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { ciWorkflows } from '../core/generators.js'
import { formatFiles } from '../core/format.js'
import { writeFiles } from '../core/fswrite.js'
import { log, fail } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface CiOptions {
	force?: boolean
}

/*
 *   CI
 ***************************************************************************************************/
export async function ci(opts: CiOptions): Promise<void> {
	const ws = await requireWorkspace()
	const apps = Object.entries(ws.manifest.apps)

	for (const [name] of apps.filter(([, app]) => !app.deploy)) {
		log.warn(`${name} has no "deploy" command in spool.json; no workflow generated for it.`)
	}
	if (!apps.some(([, app]) => app.deploy)) {
		fail(
			'No app has a "deploy" command in spool.json, so there is nothing to generate. Add deploy commands first.'
		)
	}

	const files = await formatFiles(ciWorkflows(ws.manifest))
	const result = await writeFiles(ws.root, files, { force: opts.force ?? false })

	for (const rel of result.written) log.step(`wrote ${rel}`)
	for (const rel of result.skipped) {
		log.warn(`${rel} already exists; rerun with --force to regenerate it.`)
	}
	log.success(`generated ${result.written.length} workflow(s)`)
	if (result.written.length) {
		log.step('Commit them, and add the secrets your deploy commands need to the repository.')
	}
}
