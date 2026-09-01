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

/*
 *   PLATFORM
 ***************************************************************************************************/
const isWindows = process.platform === 'win32'

/*
 *   PROCESS
 ***************************************************************************************************/
export function run(cmd: string, args: string[], opts: SpawnOptions = {}): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			stdio: 'inherit',
			...opts,
		})
		child.on('error', reject)
		child.on('exit', code => {
			if (code === 0) resolve()
			else reject(new Error(`"${cmd}" exited with code ${code ?? 'null'}.`))
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
		child.on('exit', code => resolve({ code, output }))
	})
}

export function runShell(command: string, opts: SpawnOptions = {}): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = nodeSpawn(command, {
			shell: true,
			stdio: 'inherit',
			...opts,
		})
		child.on('error', reject)
		child.on('exit', code => {
			if (code === 0) resolve()
			else reject(new Error(`Command exited with code ${code ?? 'null'}.`))
		})
	})
}

export function spawnProcess(cmd: string, args: string[], opts: SpawnOptions = {}) {
	return spawn(cmd, args, {
		detached: !isWindows,
		...opts,
	})
}

export function killTree(child: ChildProcess): void {
	if (child.pid === undefined) return
	if (isWindows) {
		spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
	} else {
		try {
			process.kill(-child.pid, 'SIGTERM')
		} catch {
			child.kill('SIGTERM')
		}
	}
}
