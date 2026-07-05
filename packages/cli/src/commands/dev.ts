/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { devAll } from '../core/orchestrator.js'

/*
 *   DEV
 ***************************************************************************************************/
export interface DevOptions {
	only?: string
}

export async function dev(opts: DevOptions): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only
		?.split(',')
		.map(s => s.trim())
		.filter(Boolean)
	await devAll(ws, only)
}
