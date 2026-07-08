/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { buildAll } from '../core/orchestrator.js'
import { splitList } from '../util/names.js'

/*
 *   BUILD
 ***************************************************************************************************/
export interface BuildOptions {
	only?: string
	env?: string
}

export async function build(opts: BuildOptions): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only === undefined ? undefined : splitList(opts.only)
	// The generated helper reads SPOOL_ENV, so an exported var counts like --env.
	const env = (opts.env ?? process.env.SPOOL_ENV) || undefined
	await buildAll(ws, only, env)
}
