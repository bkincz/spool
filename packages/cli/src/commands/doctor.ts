/*
 *   IMPORTS
 ***************************************************************************************************/
import pc from 'picocolors'
import { requireWorkspace } from '../core/workspace.js'
import { diagnose } from '../core/doctor.js'
import { log, fail } from '../util/logger.js'

/*
 *   DOCTOR
 ***************************************************************************************************/
export async function doctor(): Promise<void> {
	const ws = await requireWorkspace().catch((e: Error) => fail(e.message))
	const issues = diagnose(ws)

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
	if (errors) process.exit(1)
}
