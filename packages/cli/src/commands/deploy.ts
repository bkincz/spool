/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { deployAll } from '../core/orchestrator.js'
import { splitList } from '../util/names.js'

/*
 *   DEPLOY
 ***************************************************************************************************/
export interface DeployOptions {
	only?: string
	env?: string
}

export async function deploy(opts: DeployOptions): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only === undefined ? undefined : splitList(opts.only)
	const env = (opts.env ?? process.env.SPOOL_ENV) || undefined
	await deployAll(ws, only, env)
}
