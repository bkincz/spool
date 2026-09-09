/*
 *   IMPORTS
 ***************************************************************************************************/
import { spawnSync } from 'node:child_process'

/*
 *   PLATFORM
 ***************************************************************************************************/
const isWindows = process.platform === 'win32'

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/*
 *   MANIFEST READINESS
 ***************************************************************************************************/
async function canFetch(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(2_000) })
		// Drain the body so the socket is released promptly.
		await res.body?.cancel()
		return res.ok
	} catch {
		return false
	}
}

export interface WaitForManifestOptions {
	timeoutMs?: number
	intervalMs?: number
	/** Aborts the poll early, e.g. once a sibling process has already died. */
	signal?: AbortSignal
}

/**
 * Resolves once the URL responds with a 2xx, or rejects if it never does within
 * the timeout. A listening port is not enough: a dev server can accept
 * connections before it can actually serve the federation manifest, so hosts
 * have to wait for the manifest itself, not just the socket.
 */
export async function waitForManifest(
	url: string,
	{ timeoutMs = 20_000, intervalMs = 200, signal }: WaitForManifestOptions = {}
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (signal?.aborted) throw new Error('Aborted: a sibling process stopped first.')
		if (await canFetch(url)) return
		await delay(intervalMs)
	}
	throw new Error(`Timed out waiting for ${url} after ${timeoutMs / 1000}s.`)
}

/*
 *   PORT OWNERSHIP
 ***************************************************************************************************/
export interface PortOwner {
	pid: number
	command?: string
}

export function parseNetstatOwner(output: string, port: number): PortOwner | undefined {
	const needle = `:${port}`

	for (const line of output.split('\n')) {
		const parts = line.trim().split(/\s+/)
		if (parts.length < 4 || parts[0] !== 'TCP' || parts[3] !== 'LISTENING') continue

		const local = parts[1]!

		if (!local.endsWith(needle)) continue

		const pid = Number(parts[parts.length - 1])
		if (Number.isInteger(pid)) return { pid }
	}

	return undefined
}

/** Parses `lsof -iTCP:<port> -sTCP:LISTEN` output; exported so tests can feed it fixture text directly. */
export function parseLsofOwner(output: string): PortOwner | undefined {
	const line = output
		.split('\n')
		.slice(1)
		.find(entry => entry.trim())

	if (!line) return undefined

	const parts = line.trim().split(/\s+/)
	const pid = Number(parts[1])
	if (!Number.isInteger(pid)) return undefined

	const command = parts[0]
	return command === undefined ? { pid } : { pid, command }
}

export async function portOwner(port: number): Promise<PortOwner | undefined> {
	if (isWindows) {
		const result = spawnSync('netstat', ['-ano'], { encoding: 'utf8' })
		return result.status === 0 ? parseNetstatOwner(result.stdout, port) : undefined
	}

	const result = spawnSync('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN', '-P', '-n'], {
		encoding: 'utf8',
	})
	return result.status === 0 ? parseLsofOwner(result.stdout) : undefined
}
