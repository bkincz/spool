/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { deployAll } from '../core/orchestrator.js'

/*
 *   DEPLOY
 ***************************************************************************************************/
export interface DeployOptions {
	only?: string
}

export async function deploy(opts: DeployOptions): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only
		?.split(',')
		.map(s => s.trim())
		.filter(Boolean)
	await deployAll(ws, only)
}
