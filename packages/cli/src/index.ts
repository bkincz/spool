/*
 *   IMPORTS
 ***************************************************************************************************/
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { create } from './commands/create.js'
import { add } from './commands/add.js'
import { remove } from './commands/remove.js'
import { dev } from './commands/dev.js'
import { build } from './commands/build.js'
import { doctor } from './commands/doctor.js'
import { CliError } from './util/errors.js'
import { log } from './util/logger.js'

/*
 *   PROGRAM
 ***************************************************************************************************/
// Read the version from package.json so it can't drift from what ships.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

const program = new Command()

program
	.name('spool')
	.description('Toolset for micro frontends and modular frontend projects')
	.version(version)

/*
 *   COMMANDS
 ***************************************************************************************************/
program
	.command('create [dir]')
	.description('Scaffold a new micro-frontend workspace')
	.option('-n, --name <name>', 'workspace name')
	.option('--host <name>', 'host (shell) app name')
	.option('--remotes <list>', 'comma-separated remote app names')
	.option('--pm <manager>', 'package manager: pnpm | npm | yarn')
	.option('--here', 'scaffold into the current directory')
	.option('--no-install', 'skip dependency install')
	.action(create)

program
	.command('add <name>')
	.description('Add a host or remote app to the workspace')
	.option('-t, --type <type>', 'host | remote', 'remote')
	.option('-p, --port <port>', 'dev server port')
	.option('--host <name>', 'host app to wire this remote into')
	.option('--no-install', 'skip dependency install')
	.action(add)

program
	.command('remove <name>')
	.description('Remove an app from the workspace and unwire it from hosts')
	.option('--files', 'also delete the app folder')
	.action(remove)

program
	.command('dev')
	.description('Run host + remotes together (remotes first)')
	.option('--only <list>', 'comma-separated subset of apps')
	.action(dev)

program
	.command('build')
	.description('Coordinated production build (remotes before hosts)')
	.option('--only <list>', 'comma-separated subset of apps')
	.action(build)

program
	.command('doctor')
	.description('Check ports, app folders, federation wiring and shared deps')
	.action(doctor)

/*
 *   ENTRY POINT
 ***************************************************************************************************/
// The single exit point for failures. Everything below throws.
program.parseAsync().catch((err: unknown) => {
	if (err instanceof CliError) log.error(err.message)
	else console.error(err)
	process.exitCode = 1
})
