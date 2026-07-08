/*
 *   IMPORTS
 ***************************************************************************************************/
import pc from 'picocolors'
import { requireWorkspace } from '../core/workspace.js'
import { diagnose, diagnoseRemotes } from '../core/doctor.js'
import { log } from '../util/logger.js'

/*
 *   DOCTOR
 ***************************************************************************************************/
export interface DoctorOptions {
	remote?: boolean
	env?: string
}

export async function doctor(opts: DoctorOptions = {}): Promise<void> {
	const ws = await requireWorkspace()
	const issues = diagnose(ws)
	if (opts.remote) {
		// Builds read SPOOL_ENV when --env is absent, so doctor probes the same urls.
		const env = (opts.env ?? process.env.SPOOL_ENV) || undefined
		issues.push(...(await diagnoseRemotes(ws, env)))
	}

	if (!issues.length) {
		log.success(`${pc.bold(ws.manifest.name)}: no problems found`)
		return
	}

	for (const d of issues) {
		const where = d.app ? pc.dim(`(${d.app}) `) : ''
		if (d.level === 'error') log.error(`${where}${d.message}`)
		else log.warn(`${where}${d.message}`)
	}

	const errors = issues.filter(i => i.level === 'error').length
	log.plain('')
	log.info(`${errors} error(s), ${issues.length - errors} warning(s)`)
	// exitCode, not exit(): lets stdout flush and keeps doctor() callable.
	if (errors) process.exitCode = 1
}
