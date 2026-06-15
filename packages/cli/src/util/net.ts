/*
 *   IMPORTS
 ***************************************************************************************************/
import { createConnection } from 'node:net'

/*
 *   PORT READINESS
 ***************************************************************************************************/
function canConnect(port: number, host: string): Promise<boolean> {
	return new Promise(resolve => {
		const socket = createConnection({ port, host })
		socket.once('connect', () => {
			socket.destroy()
			resolve(true)
		})
		socket.once('error', () => {
			socket.destroy()
			resolve(false)
		})
	})
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Resolves once something is listening on the port, or rejects if it never
 * comes up within the timeout.
 */
export async function waitForPort(
	port: number,
	{ host = 'localhost', timeoutMs = 20_000, intervalMs = 200 } = {}
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await canConnect(port, host)) return
		await delay(intervalMs)
	}
	throw new Error(`Timed out waiting for port ${port} after ${timeoutMs / 1000}s.`)
}

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

/**
 * Resolves once the URL responds with a 2xx, or rejects if it never does within
 * the timeout. A listening port is not enough: a dev server can accept
 * connections before it can actually serve the federation manifest, so hosts
 * have to wait for the manifest itself, not just the socket.
 */
export async function waitForManifest(
	url: string,
	{ timeoutMs = 20_000, intervalMs = 200 } = {}
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await canFetch(url)) return
		await delay(intervalMs)
	}
	throw new Error(`Timed out waiting for ${url} after ${timeoutMs / 1000}s.`)
}
