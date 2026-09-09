/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { waitForManifest, parseNetstatOwner, parseLsofOwner } from '../../util/net.js'

/*
 *   WAIT FOR MANIFEST
 ***************************************************************************************************/
function httpServe(status: number): Promise<{ url: string; close: () => void }> {
	return new Promise(resolve => {
		const server: HttpServer = createHttpServer((_req, res) => {
			res.writeHead(status)
			res.end('{}')
		})
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : 0
			resolve({
				url: `http://127.0.0.1:${port}/mf-manifest.json`,
				close: () => server.close(),
			})
		})
	})
}

function freePort(): Promise<number> {
	return new Promise(resolve => {
		const server = createHttpServer()
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : 0
			server.close(() => resolve(port))
		})
	})
}

describe('waitForManifest', () => {
	it('resolves once the manifest responds with 2xx', async () => {
		const { url, close } = await httpServe(200)
		await expect(waitForManifest(url)).resolves.toBeUndefined()
		close()
	})

	it('keeps waiting then times out while the server only returns errors', async () => {
		const { url, close } = await httpServe(503)
		await expect(waitForManifest(url, { timeoutMs: 300, intervalMs: 50 })).rejects.toThrow(
			'Timed out waiting for'
		)
		close()
	})

	it('rejects when nothing is listening before the timeout', async () => {
		const port = await freePort()
		await expect(
			waitForManifest(`http://127.0.0.1:${port}/mf-manifest.json`, {
				timeoutMs: 300,
				intervalMs: 50,
			})
		).rejects.toThrow('Timed out waiting for')
	})

	it('stops polling as soon as the signal aborts, without waiting for the timeout', async () => {
		const port = await freePort()
		const controller = new AbortController()
		const started = Date.now()

		setTimeout(() => controller.abort(), 50)

		await expect(
			waitForManifest(`http://127.0.0.1:${port}/mf-manifest.json`, {
				timeoutMs: 5_000,
				intervalMs: 50,
				signal: controller.signal,
			})
		).rejects.toThrow()
		expect(Date.now() - started).toBeLessThan(1_000)
	})
})

/*
 *   PORT OWNERSHIP
 ***************************************************************************************************/
describe('parseNetstatOwner', () => {
	const output = [
		'',
		'Active Connections',
		'',
		'  Proto  Local Address          Foreign Address        State           PID',
		'  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       12345',
		'  TCP    0.0.0.0:5174           0.0.0.0:0              ESTABLISHED     999',
		'  TCP    [::]:5173              [::]:0                 LISTENING       12345',
		'  UDP    0.0.0.0:5173           *:*                                    777',
	].join('\r\n')

	it('finds the pid listening on the given port', () => {
		expect(parseNetstatOwner(output, 5173)).toEqual({ pid: 12345 })
	})

	it('ignores connections that are not LISTENING', () => {
		expect(parseNetstatOwner(output, 5174)).toBeUndefined()
	})

	it('returns undefined when nothing matches the port', () => {
		expect(parseNetstatOwner(output, 6000)).toBeUndefined()
	})
})

describe('parseLsofOwner', () => {
	const output = [
		'COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
		'node    54321  beni   23u  IPv4 123456      0t0  TCP *:5173 (LISTEN)',
	].join('\n')

	it('finds the pid and command listening on the port', () => {
		expect(parseLsofOwner(output)).toEqual({ pid: 54321, command: 'node' })
	})

	it('returns undefined for header-only output', () => {
		expect(
			parseLsofOwner('COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME')
		).toBeUndefined()
	})

	it('returns undefined for empty output', () => {
		expect(parseLsofOwner('')).toBeUndefined()
	})
})
