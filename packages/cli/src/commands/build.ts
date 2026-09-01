/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { buildAll } from '../core/orchestrator.js'
import { splitList } from '../util/names.js'
import { fail } from '../util/logger.js'

/*
 *   BUILD
 ***************************************************************************************************/
export interface BuildOptions {
	only?: string
	env?: string
	concurrency?: string
}

export async function build(opts: BuildOptions): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only === undefined ? undefined : splitList(opts.only)
	// The generated helper reads SPOOL_ENV, so an exported var counts like --env.
	const env = (opts.env ?? process.env.SPOOL_ENV) || undefined
	const concurrency = opts.concurrency === undefined ? undefined : Number(opts.concurrency)

	if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
		fail(`--concurrency needs a whole number of 1 or more, not "${opts.concurrency!}".`)
	}

	await buildAll(ws, only, env, concurrency)
}
