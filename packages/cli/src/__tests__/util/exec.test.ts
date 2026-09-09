/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import {
	run,
	runCaptured,
	runShell,
	spawnProcess,
	killTree,
	killTreeSync,
	killPid,
} from '../../util/exec.js'
import type { ChildProcess } from 'node:child_process'

/*
 *   RUN
 ***************************************************************************************************/
describe('run', () => {
	it('resolves when the command exits zero', async () => {
		await expect(run(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBeUndefined()
	})

	it('rejects with the exit code when the command fails', async () => {
		await expect(run(process.execPath, ['-e', 'process.exit(2)'])).rejects.toThrow(
			'exited with code 2'
		)
	})

	it('includes captured stderr in the rejection when the command fails', async () => {
		await expect(
			run(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(1)'])
		).rejects.toThrow('boom')
	})

	it('rejects when the command cannot be spawned', async () => {
		await expect(run('definitely-not-a-real-binary-xyz', [])).rejects.toThrow()
	})

	it('passes the environment through to a fully silent run', async () => {
		await expect(
			run(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
		).resolves.toBeUndefined()
	})
})

/*
 *   RUN CAPTURED
 ***************************************************************************************************/
describe('runCaptured', () => {
	it('captures output written right up to the process closing', async () => {
		const { code, output } = await runCaptured(process.execPath, [
			'-e',
			'process.stdout.write("hello")',
		])
		expect(code).toBe(0)
		expect(output).toContain('hello')
	})
})

/*
 *   RUN SHELL
 ***************************************************************************************************/
describe('runShell', () => {
	it('resolves when the command exits zero', async () => {
		await expect(runShell('exit 0')).resolves.toBeUndefined()
	})

	it('rejects with the exit code when the command fails', async () => {
		await expect(runShell('exit 3')).rejects.toThrow('exited with code 3')
	})
})

/*
 *   KILL TREE
 ***************************************************************************************************/
describe('killTree', () => {
	it('ends a running child process and confirms it', async () => {
		const child = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
		const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
		await expect(killTree(child)).resolves.toBe(true)
		await expect(exited).resolves.toBeUndefined()
	})

	it('resolves true when there is no pid', async () => {
		await expect(killTree({ pid: undefined } as ChildProcess)).resolves.toBe(true)
	})
})

describe('killTreeSync', () => {
	it('ends a running child process without waiting for confirmation', async () => {
		const child = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
		const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
		killTreeSync(child)
		await expect(exited).resolves.toBeUndefined()
	})

	it('does nothing when there is no pid', () => {
		expect(() => killTreeSync({ pid: undefined } as ChildProcess)).not.toThrow()
	})
})

/*
 *   KILL PID
 ***************************************************************************************************/
describe('killPid', () => {
	it('kills a process by its bare pid', async () => {
		const child = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
		const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
		expect(killPid(child.pid!)).toBe(true)
		await expect(exited).resolves.toBeUndefined()
	})

	it('treats an already-gone pid as success', () => {
		expect(killPid(999_999_999)).toBe(true)
	})
})
