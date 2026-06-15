/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { devAll } from '../core/orchestrator.js'
import { fail } from '../util/logger.js'

/*
 *   DEV
 ***************************************************************************************************/
export interface DevOptions {
	only?: string
}

export async function dev(opts: DevOptions): Promise<void> {
	const ws = await requireWorkspace().catch((e: Error) => fail(e.message))
	const only = opts.only
		?.split(',')
		.map(s => s.trim())
		.filter(Boolean)
	await devAll(ws, only)
}
