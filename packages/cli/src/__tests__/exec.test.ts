/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { run, spawnProcess, killTree } from '../util/exec.js'
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

	it('rejects when the command cannot be spawned', async () => {
		await expect(run('definitely-not-a-real-binary-xyz', [])).rejects.toThrow()
	})
})

/*
 *   KILL TREE
 ***************************************************************************************************/
describe('killTree', () => {
	it('ends a running child process', async () => {
		const child = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
		const exited = new Promise<void>(resolve => child.on('exit', () => resolve()))
		killTree(child)
		await expect(exited).resolves.toBeUndefined()
	})

	it('does nothing when there is no pid', () => {
		expect(() => killTree({ pid: undefined } as ChildProcess)).not.toThrow()
	})
})
