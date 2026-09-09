/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { buildAll, type AppRunResult } from '../core/orchestrator.js'
import { emitRemoteTypes } from '../core/types.js'
import { syncRemoteTypings } from '../core/typings.js'
import { splitList } from '../util/names.js'
import { fail, log } from '../util/logger.js'

/*
 *   BUILD
 ***************************************************************************************************/
export interface BuildOptions {
	only?: string
	env?: string
	concurrency?: string
	json?: boolean
}

export async function build(opts: BuildOptions): Promise<void> {
	if (opts.json) log.useStderr()
	else log.useStdout()

	const ws = await requireWorkspace()
	const only = opts.only === undefined ? undefined : splitList(opts.only)
	// The generated helper reads SPOOL_ENV, so an exported var counts like --env.
	const env = (opts.env ?? process.env.SPOOL_ENV) || undefined
	const concurrency = opts.concurrency === undefined ? undefined : Number(opts.concurrency)

	if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
		fail(`--concurrency needs a whole number of 1 or more, not "${opts.concurrency!}".`)
	}

	await emitRemoteTypes(ws.root, ws.manifest, only)
	await syncRemoteTypings(ws)

	if (!opts.json) {
		await buildAll(ws, only, env, concurrency)
		return
	}

	const results: AppRunResult[] = []
	try {
		await buildAll(ws, only, env, concurrency, result => results.push(result))
	} finally {
		for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`)
	}
}
