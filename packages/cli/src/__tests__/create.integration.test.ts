/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDir, removeDir } from './helpers.js'

const pty = await import('node-pty').catch(() => null)
const CLI = fileURLToPath(new URL('../../dist/index.js', import.meta.url))
const runnable = pty !== null && existsSync(CLI)

/*
 *   PTY HARNESS
 ***************************************************************************************************/
const ENTER = '\r'
const DOWN = '\x1b[B'
const SPACE = ' '
const BACKSPACE = '\x7f'
// eslint-disable-next-line no-control-regex -- deliberately strips ANSI escapes
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')

interface Session {
	send(keys: string[]): Promise<void>
	waitFor(re: RegExp, timeoutMs?: number): Promise<void>
	exit(timeoutMs?: number): Promise<number>
}

function spawnCli(args: string[], cwd: string): Session {
	const child = pty!.spawn(process.execPath, [CLI, ...args], {
		name: 'xterm-color',
		cols: 100,
		rows: 40,
		cwd,
		env: process.env as Record<string, string>,
	})
	let out = ''
	let code: number | null = null
	child.onData(d => {
		out += d
	})
	const exited = new Promise<number>(resolve =>
		child.onExit(e => {
			code = e.exitCode
			resolve(e.exitCode)
		})
	)
	const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

	return {
		async send(keys) {
			for (const key of keys) {
				child.write(key)
				await sleep(40)
			}
		},
		async waitFor(re, timeoutMs = 15000) {
			const start = Date.now()
			while (!re.test(stripAnsi(out))) {
				if (code !== null) throw new Error(`exited before ${re}\n${stripAnsi(out)}`)
				if (Date.now() - start > timeoutMs)
					throw new Error(`timeout for ${re}\n${stripAnsi(out)}`)
				await sleep(30)
			}
		},
		async exit(timeoutMs = 15000) {
			const timer = setTimeout(() => child.kill(), timeoutMs)
			const result = await exited
			clearTimeout(timer)
			return result
		},
	}
}

/*
 *   INTEGRATION
 ***************************************************************************************************/
describe.skipIf(!runnable)('create (real pty)', () => {
	let dir: string

	beforeAll(() => {
		if (!existsSync(CLI)) throw new Error(`build the CLI first: ${CLI} is missing`)
	})

	afterEach(() => {
		if (dir) removeDir(dir)
	})

	it('completes with the remotes field cleared, scaffolding a host-only workspace', async () => {
		dir = freshDir('spool-pty-')
		const s = spawnCli(
			[
				'create',
				'app',
				'--name',
				'app',
				'--host',
				'shell',
				'--framework',
				'react',
				'--pm',
				'pnpm',
				'--no-install',
			],
			dir
		)
		await s.waitFor(/Remote app names/)
		await s.send([...Array(12).fill(BACKSPACE), ENTER])
		await s.waitFor(/Extras to include/)
		await s.send([ENTER]) // no addons selected

		expect(await s.exit()).toBe(0)
		const manifest = JSON.parse(readFileSync(join(dir, 'app/spool.json'), 'utf8'))
		expect(Object.keys(manifest.apps)).toEqual(['shell'])
	})

	it('completes with Sentry picked and a blank DSN, writing no .env', async () => {
		dir = freshDir('spool-pty-')
		const s = spawnCli(
			[
				'create',
				'app',
				'--name',
				'app',
				'--host',
				'shell',
				'--remotes',
				'profile',
				'--framework',
				'react',
				'--pm',
				'pnpm',
				'--no-install',
			],
			dir
		)
		await s.waitFor(/Extras to include/)
		// Options are ladle, playwright, state, sentry, shell; step to sentry and select it.
		await s.send([DOWN, DOWN, DOWN, SPACE, ENTER])
		await s.waitFor(/Sentry DSN/)
		await s.send([ENTER]) // blank DSN

		expect(await s.exit()).toBe(0)
		expect(existsSync(join(dir, 'app/apps/shell/src/sentry.ts'))).toBe(true)
		expect(existsSync(join(dir, 'app/apps/shell/.env'))).toBe(false)
	})
})
