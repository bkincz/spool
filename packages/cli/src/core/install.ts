/*
 *   INSTALL
 ***************************************************************************************************/
import { run } from '../util/exec.js'

/** Runs `<pm> install` in `cwd`; resolves false instead of throwing on failure. */
export async function installDependencies(pm: string, cwd: string): Promise<boolean> {
	try {
		await run(pm, ['install'], { cwd, stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}
