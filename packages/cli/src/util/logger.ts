/*
 *   IMPORTS
 ***************************************************************************************************/
import pc from 'picocolors'

/*
 *   LOGGER
 ***************************************************************************************************/
const tag = pc.bold(pc.cyan('spool'))

export const log = {
	info: (msg: string) => console.log(`${tag} ${msg}`),
	step: (msg: string) => console.log(`${tag} ${pc.dim('›')} ${msg}`),
	success: (msg: string) => console.log(`${tag} ${pc.green('✓')} ${msg}`),
	warn: (msg: string) => console.log(`${tag} ${pc.yellow('!')} ${msg}`),
	error: (msg: string) => console.error(`${tag} ${pc.red('✗')} ${msg}`),
	plain: (msg: string) => console.log(msg),
}

export function fail(msg: string): never {
	log.error(msg)
	process.exit(1)
}
