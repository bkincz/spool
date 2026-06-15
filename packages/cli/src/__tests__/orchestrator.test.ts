/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { EventEmitter } from 'node:events'
import { devAll, buildAll } from '../core/orchestrator.js'
import { run, spawnProcess, killTree } from '../util/exec.js'
import { waitForManifest } from '../util/net.js'
import { log } from '../util/logger.js'
import { makeWorkspace, host, remote } from './helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../util/exec.js', () => ({
	run: vi.fn(),
	spawnProcess: vi.fn(),
	killTree: vi.fn(),
}))

vi.mock('../util/net.js', () => ({
	waitForManifest: vi.fn().mockResolvedValue(undefined),
}))

interface FakeChild extends EventEmitter {
	pid: number
	stdout: EventEmitter
	stderr: EventEmitter
	kill: ReturnType<typeof vi.fn>
}

const children: FakeChild[] = []

function fakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild
	child.pid = 1000 + children.length
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.kill = vi.fn()
	return child
}

/*
 *   TEST SETUP
 ***************************************************************************************************/
let exitSpy: MockInstance<typeof process.exit>

beforeEach(() => {
	children.length = 0
	vi.mocked(spawnProcess).mockImplementation(() => {
		const child = fakeChild()
		children.push(child)
		return child as never
	})
	exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
	vi.spyOn(log, 'step').mockImplementation(() => {})
	vi.spyOn(log, 'success').mockImplementation(() => {})
	vi.spyOn(log, 'warn').mockImplementation(() => {})
	vi.spyOn(log, 'error').mockImplementation(() => {})
})

afterEach(() => {
	process.removeAllListeners('SIGINT')
	process.removeAllListeners('SIGTERM')
	vi.clearAllMocks()
	vi.restoreAllMocks()
})

/*
 *   DEV
 ***************************************************************************************************/
describe('devAll', () => {
	it('warns and returns when there are no apps to run', async () => {
		const ws = makeWorkspace('/ws', {})
		await devAll(ws)
		expect(log.warn).toHaveBeenCalledWith('No apps to run.')
		expect(spawnProcess).not.toHaveBeenCalled()
	})

	it('starts remotes, waits for them, then starts hosts', async () => {
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		void devAll(ws)

		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))
		const cwds = vi
			.mocked(spawnProcess)
			.mock.calls.map(call => (call[2] as { cwd: string }).cwd)
		expect(cwds[0]).toContain('dashboard')
		expect(cwds[1]).toContain('shell')
	})

	it('tears everything down when a child crashes', async () => {
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		void devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))

		children[0]!.emit('exit', 1)

		await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1))
		expect(log.error).toHaveBeenCalledWith(expect.stringContaining('stopped unexpectedly'))
		expect(killTree).toHaveBeenCalled()
	})

	it('only runs the apps named in the only filter', async () => {
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		void devAll(ws, ['dashboard'])
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))
	})

	it('rejects an unknown app name in the only filter', async () => {
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		await expect(devAll(ws, ['ghost'])).rejects.toThrow('Unknown app(s) in --only: ghost')
		expect(spawnProcess).not.toHaveBeenCalled()
	})

	it('prefixes each line of a child process output', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		void devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

		children[0]!.stdout.emit('data', Buffer.from('hello\n'))
		expect(write).toHaveBeenCalledWith(expect.stringContaining('hello'))
	})

	it('warns when a remote does not come up in time', async () => {
		vi.mocked(waitForManifest).mockRejectedValueOnce(new Error('timeout'))
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		void devAll(ws)
		await vi.waitFor(() =>
			expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not serving'))
		)
	})
})

/*
 *   BUILD
 ***************************************************************************************************/
describe('buildAll', () => {
	it('builds remotes before hosts', async () => {
		vi.mocked(run).mockResolvedValue(undefined)
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})

		await buildAll(ws)

		const cwds = vi.mocked(run).mock.calls.map(call => (call[2] as { cwd: string }).cwd)
		expect(cwds[0]).toContain('dashboard')
		expect(cwds[1]).toContain('shell')
		expect(log.success).toHaveBeenCalledWith('built 2 app(s)')
	})

	it('throws a helpful error naming the app that failed', async () => {
		vi.mocked(run).mockRejectedValue(new Error('boom'))
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		await expect(buildAll(ws)).rejects.toThrow('Build failed for "dashboard"')
	})

	it('rejects an unknown app name in the only filter', async () => {
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		await expect(buildAll(ws, ['ghost'])).rejects.toThrow('Unknown app(s) in --only: ghost')
		expect(run).not.toHaveBeenCalled()
	})
})
