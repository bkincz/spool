/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { previewAll } from '../core/orchestrator.js'
import { splitList } from '../util/names.js'

/*
 *   PREVIEW
 ***************************************************************************************************/
export interface PreviewOptions {
	only?: string
}

export async function preview(opts: PreviewOptions): Promise<void> {
	const ws = await requireWorkspace()
	await previewAll(ws, opts.only === undefined ? undefined : splitList(opts.only))
}
