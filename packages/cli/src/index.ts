/*
 *   IMPORTS
 ***************************************************************************************************/
import { Command } from 'commander'
import { create } from './commands/create.js'
import { add } from './commands/add.js'
import { dev } from './commands/dev.js'
import { build } from './commands/build.js'
import { doctor } from './commands/doctor.js'

/*
 *   PROGRAM
 ***************************************************************************************************/
const program = new Command()

program
	.name('spool')
	.description('Toolset for micro frontends and modular frontend projects')
	.version('0.1.0')

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
	.description('Check manifest/config drift and shared-dep issues')
	.action(doctor)

program.parseAsync().catch(err => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})
