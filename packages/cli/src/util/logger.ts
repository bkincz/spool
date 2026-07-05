/*
 *   IMPORTS
 ***************************************************************************************************/
import pc from 'picocolors'
import { CliError } from './errors.js'

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

/** Abort the current command. index.ts prints the message and sets the exit code. */
export function fail(msg: string): never {
	throw new CliError(msg)
}
