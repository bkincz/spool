/*
 *   IMPORTS
 ***************************************************************************************************/
import { run } from '../util/exec.js'
import { log } from '../util/logger.js'

/*
 *   INSTALL
 ***************************************************************************************************/
/** Runs `<pm> install` in `cwd`; resolves false instead of throwing on failure. */
export async function installDependencies(pm: string, cwd: string): Promise<boolean> {
	try {
		await run(pm, ['install'], { cwd, stdio: 'ignore' })
		return true
	} catch (err) {
		log.error(`"${pm} install" failed in ${cwd}.`)
		if (err instanceof Error && err.message) log.plain(err.message)
		return false
	}
}
