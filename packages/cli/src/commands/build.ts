/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { buildAll } from '../core/orchestrator.js'
import { fail } from '../util/logger.js'

/*
 *   BUILD
 ***************************************************************************************************/
export interface BuildOptions {
	only?: string
}

export async function build(opts: BuildOptions): Promise<void> {
	const ws = await requireWorkspace().catch((e: Error) => fail(e.message))
	const only = opts.only
		?.split(',')
		.map(s => s.trim())
		.filter(Boolean)
	await buildAll(ws, only)
}
