/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { devAll, buildAll, deployAll } from '../core/orchestrator.js'
import { run, runShell, spawnProcess, killTree } from '../util/exec.js'
import { waitForManifest } from '../util/net.js'
import { log } from '../util/logger.js'
import { makeWorkspace, host, remote } from './helpers.js'

/*
 *   MOCKS
 ***************************************************************************************************/
vi.mock('../util/exec.js', () => ({
	run: vi.fn(),
	runShell: vi.fn(),
	spawnProcess: vi.fn(),
	killTree: vi.fn(),
}))

vi.mock('../util/net.js', () => ({
	waitForManifest: vi.fn().mockResolvedValue(undefined),
}))

type FakeStream = EventEmitter & { destroy: ReturnType<typeof vi.fn> }

interface FakeChild extends EventEmitter {
	pid: number
	stdout: FakeStream
	stderr: FakeStream
	kill: ReturnType<typeof vi.fn>
}

const children: FakeChild[] = []

const fakeStream = (): FakeStream => Object.assign(new EventEmitter(), { destroy: vi.fn() })

function fakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild
	child.pid = 1000 + children.length
	child.stdout = fakeStream()
	child.stderr = fakeStream()
	child.kill = vi.fn()
	return child
}

/*
 *   TEST SETUP
 ***************************************************************************************************/
beforeEach(() => {
	children.length = 0
	vi.mocked(spawnProcess).mockImplementation(() => {
		const child = fakeChild()
		children.push(child)
		return child as never
	})
	// Guard: signal handlers exit directly; keep the test runner alive.
	vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
	vi.spyOn(log, 'step').mockImplementation(() => {})
	vi.spyOn(log, 'success').mockImplementation(() => {})
	vi.spyOn(log, 'warn').mockImplementation(() => {})
	vi.spyOn(log, 'error').mockImplementation(() => {})
	vi.spyOn(log, 'plain').mockImplementation(() => {})
})

/** Feeds the vite startup lines that mark an app as ready. */
function emitReady(child: FakeChild, port: number): void {
	child.stdout.emit('data', Buffer.from('  VITE v8.1.3  ready in 500 ms\n'))
	child.stdout.emit('data', Buffer.from(`  ➜  Local:   http://localhost:${port}/\n`))
}

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

	it('tears everything down and rejects when a child crashes', async () => {
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		const running = devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))

		children[0]!.emit('exit', 1)

		await expect(running).rejects.toThrow('stopped unexpectedly')
		expect(killTree).toHaveBeenCalled()
		// Pipe handles must be released even if a child outlives its SIGTERM,
		// or the CLI hangs instead of exiting after the crash.
		expect(children[1]!.stdout.destroy).toHaveBeenCalled()
	})

	it('warns when --only leaves a host without its remotes', async () => {
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		void devAll(ws, ['shell'])
		await vi.waitFor(() =>
			expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dashboard'))
		)
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('not selected'))
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

	it('prefixes each line of a child process output once servers are ready', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		void devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

		emitReady(children[0]!, 5174)
		await vi.waitFor(() =>
			expect(log.plain).toHaveBeenCalledWith(expect.stringContaining('dev servers ready'))
		)
		children[0]!.stdout.emit('data', Buffer.from('hello\n'))
		expect(write).toHaveBeenCalledWith(expect.stringContaining('hello'))
	})

	it('buffers startup noise and prints one summary when every app is ready', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		void devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))

		children[0]!.stdout.emit('data', Buffer.from('Failed to resolve dependency: noise\n'))
		expect(write).not.toHaveBeenCalled()

		emitReady(children[0]!, 5174)
		emitReady(children[1]!, 5173)
		// The trailing banner chunk lands inside the grace window and stays buffered.
		children[1]!.stdout.emit('data', Buffer.from('  ➜  Network: use --host to expose\n'))

		await vi.waitFor(() =>
			expect(log.plain).toHaveBeenCalledWith(expect.stringContaining('dev servers ready'))
		)
		const rows = vi.mocked(log.plain).mock.calls.map(call => String(call[0]))
		const shellRow = rows.find(row => row.includes('shell'))!
		expect(shellRow).toContain('host · react')
		expect(shellRow).toContain('http://localhost:5173/')
		// The host row comes before the remote's, and the shared vite version
		// moves to the footer.
		expect(rows.indexOf(shellRow)).toBeLessThan(
			rows.findIndex(row => row.includes('dashboard'))
		)
		expect(rows.some(row => row.includes('vite 8.1.3'))).toBe(true)
		// The buffered noise never reaches the terminal.
		expect(write).not.toHaveBeenCalled()

		children[0]!.stdout.emit('data', Buffer.from('hmr update\n'))
		expect(write).toHaveBeenCalledWith(expect.stringContaining('hmr update'))
	})

	it('anchors the panel with a scroll region on a real terminal', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const stdout = process.stdout as unknown as {
			isTTY: boolean
			rows: number
			columns: number
		}
		const original = { isTTY: stdout.isTTY, rows: stdout.rows, columns: stdout.columns }
		Object.assign(stdout, { isTTY: true, rows: 40, columns: 120 })

		try {
			const ws = makeWorkspace('/ws', { dashboard: remote() })
			void devAll(ws)
			await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

			emitReady(children[0]!, 5174)
			// The panel paints at the top and confines scrolling below itself.
			await vi.waitFor(() =>
				expect(write).toHaveBeenCalledWith(expect.stringContaining('\x1b[2J\x1b[H'))
			)
			const painted = write.mock.calls.map(call => String(call[0])).join('')
			expect(painted).toContain('dev servers ready')
			// The scroll region's bottom edge is the terminal's row count.
			expect(painted).toContain(';40r')

			// A resize repaints without clearing, so streamed history survives.
			write.mockClear()
			stdout.rows = 30
			process.stdout.emit('resize')
			const repaint = write.mock.calls.map(call => String(call[0])).join('')
			expect(repaint).not.toContain('\x1b[2J')
			expect(repaint).toContain(';30r')

			// Shrinking below the panel releases the region instead of leaving
			// stale bounds behind.
			write.mockClear()
			stdout.rows = 4
			process.stdout.emit('resize')
			expect(write).toHaveBeenCalledWith(expect.stringContaining('\x1b[r'))

			process.emit('SIGINT')
		} finally {
			Object.assign(stdout, original)
		}
	})

	it('dumps the buffered output of an app that crashes during startup', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		const running = devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

		children[0]!.stdout.emit('data', Buffer.from('EADDRINUSE port taken\n'))
		children[0]!.emit('exit', 1)

		await expect(running).rejects.toThrow('stopped unexpectedly')
		expect(write).toHaveBeenCalledWith(expect.stringContaining('EADDRINUSE'))
	})

	it('dumps every sibling buffer on a crash, the crashing app last', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'] }),
			dashboard: remote(),
		})
		const running = devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2))

		children[0]!.stdout.emit('data', Buffer.from('dashboard bound port 5174\n'))
		children[1]!.stdout.emit('data', Buffer.from('shell exploding\n'))
		children[1]!.emit('exit', 1)

		await expect(running).rejects.toThrow('stopped unexpectedly')
		const out = write.mock.calls.map(call => String(call[0])).join('')
		expect(out).toContain('dashboard bound port 5174')
		expect(out.indexOf('dashboard bound port 5174')).toBeLessThan(
			out.indexOf('shell exploding')
		)
	})

	it('detects the ready banner even when a chunk splits it mid-line', async () => {
		vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		void devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

		children[0]!.stdout.emit('data', Buffer.from('  VITE v8.1.3  re'))
		children[0]!.stdout.emit(
			'data',
			Buffer.from('ady in 500 ms\n  ➜  Local:   http://localhost:5174/\n')
		)

		await vi.waitFor(() =>
			expect(log.plain).toHaveBeenCalledWith(expect.stringContaining('dev servers ready'))
		)
	})

	it('caps the startup buffer and notes the truncation when flushing', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		const running = devAll(ws)
		await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(1))

		const chatty = Array.from({ length: 450 }, (_, i) => `line ${i}`).join('\n')
		children[0]!.stdout.emit('data', Buffer.from(`${chatty}\n`))
		children[0]!.emit('exit', 1)

		await expect(running).rejects.toThrow('stopped unexpectedly')
		const out = write.mock.calls.map(call => String(call[0])).join('')
		expect(out).toContain('truncated')
		expect(out).not.toContain('line 0\n')
		expect(out).toContain('line 449')
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

/*
 *   DEPLOY
 ***************************************************************************************************/
describe('deployAll', () => {
	it('runs each deploy command in its app folder, remotes before hosts', async () => {
		vi.mocked(runShell).mockResolvedValue(undefined)
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'], deploy: 'deploy-shell' }),
			dashboard: remote({
				deploy: 'deploy-dashboard',
				url: 'https://d.example.com/mf-manifest.json',
			}),
		})

		await deployAll(ws)

		const calls = vi.mocked(runShell).mock.calls
		expect(calls[0]![0]).toBe('deploy-dashboard')
		expect((calls[0]![1] as { cwd: string }).cwd).toContain('dashboard')
		expect(calls[1]![0]).toBe('deploy-shell')
		expect(log.success).toHaveBeenCalledWith('deployed 2 app(s)')
	})

	it('skips apps without a deploy command and says so', async () => {
		vi.mocked(runShell).mockResolvedValue(undefined)
		const ws = makeWorkspace('/ws', {
			shell: host({ remotes: ['dashboard'], deploy: 'deploy-shell' }),
			dashboard: remote({ url: 'https://d.example.com/mf-manifest.json' }),
		})

		await deployAll(ws)

		expect(runShell).toHaveBeenCalledTimes(1)
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no "deploy" command'))
	})

	it('rejects when no app has a deploy command', async () => {
		const ws = makeWorkspace('/ws', { dashboard: remote() })
		await expect(deployAll(ws)).rejects.toThrow('Nothing to deploy')
		expect(runShell).not.toHaveBeenCalled()
	})

	it('names the app whose deploy failed', async () => {
		vi.mocked(runShell).mockRejectedValue(new Error('boom'))
		const ws = makeWorkspace('/ws', { dashboard: remote({ deploy: 'bad-command' }) })
		await expect(deployAll(ws)).rejects.toThrow('Deploy failed for "dashboard"')
	})

	it('reminds you to set url after deploying a remote without one', async () => {
		vi.mocked(runShell).mockResolvedValue(undefined)
		const ws = makeWorkspace('/ws', { dashboard: remote({ deploy: 'deploy-dashboard' }) })
		await deployAll(ws)
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('has no "url"'))
	})

	it('warns when the app has no dist folder yet', async () => {
		vi.mocked(runShell).mockResolvedValue(undefined)
		const ws = makeWorkspace('/ws', {
			dashboard: remote({ deploy: 'x', url: 'https://d.example.com/mf-manifest.json' }),
		})
		await deployAll(ws)
		expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no dist folder'))
	})
})
