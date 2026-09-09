/*
 *   IMPORTS
 ***************************************************************************************************/
import {
	spawn as nodeSpawn,
	spawnSync,
	type ChildProcess,
	type SpawnOptions,
} from 'node:child_process'
import spawn from 'cross-spawn'
import { log } from './logger.js'

/*
 *   PLATFORM
 ***************************************************************************************************/
const isWindows = process.platform === 'win32'

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/*
 *   PROCESS
 ***************************************************************************************************/
type SimpleStdio = 'inherit' | 'ignore' | 'pipe'

function stdinAndStdout(requested: SpawnOptions['stdio']): [SimpleStdio, SimpleStdio] {
	const pick = (value: unknown): SimpleStdio =>
		value === 'ignore' || value === 'pipe' ? value : 'inherit'

	if (Array.isArray(requested)) return [pick(requested[0]), pick(requested[1])]
	return [pick(requested), pick(requested)]
}

export function run(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<void> {
	return new Promise((resolve, reject) => {
		const forward = opts.stdio !== 'ignore'
		const { stdio, ...rest } = opts
		const [stdin, stdout] = stdinAndStdout(stdio)

		const child = spawn(cmd, args, { ...rest, stdio: [stdin, stdout, 'pipe'] })
		let stderr = ''

		child.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString()
			if (forward) process.stderr.write(chunk)
		})

		child.on('error', reject)
		child.on('exit', code => {
			if (code === 0) {
				resolve()
				return
			}
			const detail = stderr.trim()
			reject(
				new Error(
					`"${cmd}" exited with code ${code ?? 'null'}.${detail ? `\n${detail}` : ''}`
				)
			)
		})
	})
}

export interface CapturedRun {
	code: number | null
	/** stdout and stderr together, in the order the process wrote them. */
	output: string
}

export function runCaptured(
	cmd: string,
	args: string[],
	opts: SpawnOptions = {}
): Promise<CapturedRun> {
	return new Promise(resolve => {
		const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
		let output = ''

		const collect = (chunk: Buffer): void => {
			output += chunk.toString()
		}
		child.stdout?.on('data', collect)
		child.stderr?.on('data', collect)

		child.on('error', (cause: Error) => resolve({ code: null, output: output + cause.message }))
		child.on('close', code => resolve({ code, output }))
	})
}

let bashAvailable: boolean | undefined
let warnedAboutShell = false

/** CI runs deploy commands under bash; matching that locally avoids cmd.exe surprises. */
function hasBash(): boolean {
	if (bashAvailable === undefined) {
		const probe = spawnSync('bash', ['-c', 'exit 0'], { stdio: 'ignore' })
		bashAvailable = !probe.error && probe.status === 0
	}
	return bashAvailable
}

export function runShell(command: string, opts: SpawnOptions = {}): Promise<void> {
	return new Promise((resolve, reject) => {
		const useBash = hasBash()
		if (!useBash && !warnedAboutShell) {
			warnedAboutShell = true
			log.warn(
				'bash was not found, so this command runs under the platform shell. Quoting, `&&` and env-var syntax may not match CI, which always runs under bash.'
			)
		}

		const child = useBash
			? nodeSpawn('bash', ['-c', command], { stdio: 'inherit', ...opts })
			: nodeSpawn(command, { shell: true, stdio: 'inherit', ...opts })

		child.on('error', reject)
		child.on('exit', code => {
			if (code === 0) resolve()
			else reject(new Error(`Command exited with code ${code ?? 'null'}.`))
		})
	})
}

export function spawnProcess(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
	return spawn(cmd, args, {
		detached: !isWindows,
		...opts,
		// A generated watchdog in the app's vite config reads this to self-exit
		// if this CLI process disappears without a chance to clean up.
		env: { ...process.env, ...opts.env, SPOOL_PARENT_PID: String(process.pid) },
	})
}

/*
 *   KILL
 ***************************************************************************************************/
export async function killTree(child: ChildProcess, graceMs = 2_000): Promise<boolean> {
	if (child.pid === undefined) return true

	if (isWindows) {
		const result = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
			stdio: 'ignore',
		})

		return result.status === 0 || result.status === 128
	}

	return killProcessGroupPosix(child, graceMs)
}

async function killProcessGroupPosix(child: ChildProcess, graceMs: number): Promise<boolean> {
	const pid = child.pid!
	const exited = new Promise<boolean>(resolve => child.once('exit', () => resolve(true)))

	if (!signalGroupOrChild(pid, child, 'SIGTERM')) return true

	if (await Promise.race([exited, delay(graceMs).then(() => false)])) return true

	if (!signalGroupOrChild(pid, child, 'SIGKILL')) return true

	return Promise.race([exited, delay(1_000).then(() => false)])
}

function signalGroupOrChild(pid: number, child: ChildProcess, signal: NodeJS.Signals): boolean {
	try {
		process.kill(-pid, signal)
		return true
	} catch {
		try {
			child.kill(signal)
			return true
		} catch {
			// ESRCH: already exited.
			return false
		}
	}
}

export function killTreeSync(child: ChildProcess): void {
	if (child.pid === undefined) return

	if (isWindows) {
		spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
		return
	}

	if (!signalGroupOrChild(child.pid, child, 'SIGKILL')) return
}

// ESRCH means no such process, which is the outcome a kill wanted. taskkill says the same with 128.
const alreadyGone = (error: unknown): boolean =>
	(error as NodeJS.ErrnoException | null)?.code === 'ESRCH'

export function killPid(pid: number): boolean {
	if (isWindows) {
		const result = spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
		return result.status === 0 || result.status === 128
	}

	try {
		process.kill(-pid, 'SIGKILL')
		return true
	} catch {
		try {
			process.kill(pid, 'SIGKILL')
			return true
		} catch (error) {
			return alreadyGone(error)
		}
	}
}
