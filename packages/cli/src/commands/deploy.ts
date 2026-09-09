/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { deployAll, type AppRunResult } from '../core/orchestrator.js'
import { splitList } from '../util/names.js'
import { log } from '../util/logger.js'

/*
 *   DEPLOY
 ***************************************************************************************************/
export interface DeployOptions {
	only?: string
	env?: string
	json?: boolean
}

export async function deploy(opts: DeployOptions): Promise<void> {
	log.useStdout()

	const ws = await requireWorkspace()
	const only = opts.only === undefined ? undefined : splitList(opts.only)
	const env = (opts.env ?? process.env.SPOOL_ENV) || undefined

	if (!opts.json) {
		await deployAll(ws, only, env)
		return
	}

	log.useStderr()
	const results: AppRunResult[] = []
	try {
		await deployAll(ws, only, env, result => results.push(result))
	} finally {
		for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`)
	}
}
