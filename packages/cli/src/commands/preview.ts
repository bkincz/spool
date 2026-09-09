/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { previewAll, killRunning } from '../core/orchestrator.js'
import { splitList } from '../util/names.js'

/*
 *   PREVIEW
 ***************************************************************************************************/
export interface PreviewOptions {
	only?: string
	kill?: boolean
}

export async function preview(opts: PreviewOptions): Promise<void> {
	const ws = await requireWorkspace()

	if (opts.kill) {
		await killRunning(ws, 'preview')
		return
	}

	await previewAll(ws, opts.only !== undefined ? { only: splitList(opts.only) } : {})
}
