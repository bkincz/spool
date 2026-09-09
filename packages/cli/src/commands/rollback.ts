/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { rollbackApp } from '../core/orchestrator.js'

/*
 *   ROLLBACK
 ***************************************************************************************************/
export interface RollbackOptions {
	env: string
}

export async function rollback(name: string, opts: RollbackOptions): Promise<void> {
	const ws = await requireWorkspace()
	await rollbackApp(ws, opts.env, name)
}
