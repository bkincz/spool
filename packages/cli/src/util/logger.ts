/*
 *   IMPORTS
 ***************************************************************************************************/
import pc from 'picocolors'
import { CliError } from './errors.js'

/*
 *   LOGGER
 ***************************************************************************************************/
const tag = pc.bold(pc.cyan('spool'))

let sink: 'stdout' | 'stderr' = 'stdout'

function write(msg: string): void {
	if (sink === 'stdout') console.log(msg)
	else console.error(msg)
}

export const log = {
	info: (msg: string) => write(`${tag} ${msg}`),
	step: (msg: string) => write(`${tag} ${pc.dim('›')} ${msg}`),
	success: (msg: string) => write(`${tag} ${pc.green('✓')} ${msg}`),
	warn: (msg: string) => write(`${tag} ${pc.yellow('!')} ${msg}`),
	error: (msg: string) => console.error(`${tag} ${pc.red('✗')} ${msg}`),
	plain: (msg: string) => write(msg),
	useStderr: () => {
		sink = 'stderr'
	},
	useStdout: () => {
		sink = 'stdout'
	},
}

/** Abort the current command. index.ts prints the message and sets the exit code. */
export function fail(msg: string): never {
	throw new CliError(msg)
}
