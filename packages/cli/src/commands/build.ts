/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { buildAll } from '../core/orchestrator.js'

/*
 *   BUILD
 ***************************************************************************************************/
export interface BuildOptions {
	only?: string
}

export async function build(opts: BuildOptions): Promise<void> {
	const ws = await requireWorkspace()
	const only = opts.only
		?.split(',')
		.map(s => s.trim())
		.filter(Boolean)
	await buildAll(ws, only)
}
