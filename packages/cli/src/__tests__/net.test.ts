/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { createServer, type Server } from 'node:net'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { waitForPort, waitForManifest } from '../util/net.js'

/*
 *   HELPERS
 ***************************************************************************************************/
function listen(): Promise<{ port: number; close: () => void }> {
	return new Promise(resolve => {
		const server: Server = createServer()
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : 0
			resolve({ port, close: () => server.close() })
		})
	})
}

function freePort(): Promise<number> {
	return new Promise(resolve => {
		const server = createServer()
		server.listen(0, '127.0.0.1', () => {
			const address = server.address()
			const port = typeof address === 'object' && address ? address.port : 0
			server.close(() => resolve(port))
		})
	})
}

/*
 *   WAIT FOR PORT
 ***************************************************************************************************/
describe('waitForPort', () => {
	it('resolves once a server is listening', async () => {
		const { port, close } = await listen()
		await expect(waitForPort(port, { host: '127.0.0.1' })).resolves.toBeUndefined()
		close()
	})

	it('rejects when nothing comes up before the timeout', async () => {
		const port = await freePort()
		await expect(
			waitForPort(port, { host: '127.0.0.1', timeoutMs: 300, intervalMs: 50 })
		).rejects.toThrow('Timed out waiting for port')
	})
})

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
})
