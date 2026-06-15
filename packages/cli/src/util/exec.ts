/*
 *   IMPORTS
 ***************************************************************************************************/
import { spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process'
import spawn from 'cross-spawn'

/*
 *   PLATFORM
 ***************************************************************************************************/
const isWindows = process.platform === 'win32'

/*
 *   PROCESS
 ***************************************************************************************************/
// cross-spawn resolves the package manager's Windows .cmd shim and spawns the
// real binary without a shell. That avoids the shell-injection surface (and the
// DEP0190 warning) of `shell: true`, while sidestepping the EINVAL that modern
// Node throws when launching a .cmd directly.
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

// On POSIX the child leads its own process group (detached) so killTree can take
// down the whole tree, not just the package manager wrapping the dev server.
export function spawnProcess(cmd: string, args: string[], opts: SpawnOptions = {}) {
	return spawn(cmd, args, {
		detached: !isWindows,
		...opts,
	})
}

// A package manager spawns the real dev server (vite) as its own child, so
// signaling only the direct child leaves vite running and holding its port.
// Each platform needs its own way to end the entire process tree, and it runs
// synchronously because callers exit the process right afterwards.
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
