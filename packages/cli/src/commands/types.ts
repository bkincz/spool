/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { emitRemoteTypes } from '../core/types.js'
import { syncRemoteTypings } from '../core/typings.js'
import { splitList } from '../util/names.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface TypesOptions {
	only?: string
}

/*
 *   TYPES COMMAND
 ***************************************************************************************************/
export async function types(opts: TypesOptions = {}): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only ? splitList(opts.only) : undefined

	const result = await emitRemoteTypes(ws.root, ws.manifest, only)

	if (result.skipped) {
		log.warn('typescript is not installed in this workspace; nothing to type.')
		return
	}
	if (!result.built.length && !result.failed.length) {
		log.info('no app exposes anything; nothing to type.')
		return
	}

	for (const name of result.built) log.step(`typed ${name}`)
	await syncRemoteTypings(ws)

	if (result.failed.length) {
		log.warn(`could not type ${result.failed.join(', ')}; see the tsc output above.`)
	}
	if (result.built.length) {
		log.success(`wrote declarations for ${result.built.length} app(s) to .spool/types`)
	}
}
