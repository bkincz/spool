/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { promoteApp } from '../core/orchestrator.js'
import { fail } from '../util/logger.js'

/*
 *   PROMOTE
 ***************************************************************************************************/
export interface PromoteOptions {
	env: string
}

export async function promote(target: string, opts: PromoteOptions): Promise<void> {
	const ws = await requireWorkspace()
	const [name, sha] = target.split('@')

	if (!name || !sha) {
		fail(
			`Give promote an "app@sha", e.g. \`spool promote --env production dashboard@a1b2c3d\`.`
		)
	}

	await promoteApp(ws, opts.env, name, sha)
}
