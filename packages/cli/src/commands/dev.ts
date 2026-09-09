/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace } from '../core/workspace.js'
import { devAll, killRunning, type RestSpec } from '../core/orchestrator.js'
import { emitRemoteTypes } from '../core/types.js'
import { syncRemoteTypings } from '../core/typings.js'
import { splitList } from '../util/names.js'
import { fail } from '../util/logger.js'

/*
 *   DEV
 ***************************************************************************************************/
export interface DevOptions {
	only?: string
	rest?: string
	timeout?: string
	ladle?: boolean
	kill?: boolean
}

function parseRest(value: string): RestSpec {
	return value === 'built' ? { kind: 'built' } : { kind: 'env', env: value }
}

function parseTimeout(value: string): number {
	const seconds = Number(value)
	if (!Number.isFinite(seconds) || seconds <= 0) {
		fail(`--timeout needs a positive number of seconds, not "${value}".`)
	}
	return seconds
}

export async function dev(opts: DevOptions): Promise<void> {
	const ws = await requireWorkspace()

	if (opts.kill) {
		await killRunning(ws, 'dev')
		return
	}

	const only = opts.only === undefined ? undefined : splitList(opts.only)
	await emitRemoteTypes(ws.root, ws.manifest, only)
	await syncRemoteTypings(ws)

	await devAll(ws, {
		...(only !== undefined ? { only } : {}),
		...(opts.rest !== undefined ? { rest: parseRest(opts.rest) } : {}),
		...(opts.timeout !== undefined ? { timeoutSeconds: parseTimeout(opts.timeout) } : {}),
		...(opts.ladle !== undefined ? { ladle: opts.ladle } : {}),
	})
}
