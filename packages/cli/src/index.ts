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
import { deploy } from './commands/deploy.js'
import { ci } from './commands/ci.js'
import { upgrade } from './commands/upgrade.js'
import { doctor } from './commands/doctor.js'
import { CliError } from './util/errors.js'
import { log } from './util/logger.js'

/*
 *   PROGRAM
 ***************************************************************************************************/
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
	.option('--framework <framework>', 'react | svelte', 'react')
	.option('--here', 'scaffold into the current directory')
	.option('--no-install', 'skip dependency install')
	.action(create)

program
	.command('add <name>')
	.description('Add a host or remote app to the workspace')
	.option('-t, --type <type>', 'host | remote', 'remote')
	.option('-p, --port <port>', 'dev server port')
	.option('--host <name>', 'host app to wire this remote into')
	.option('--framework <framework>', 'react | svelte', 'react')
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
	.description('Build every app for production (remotes before hosts)')
	.option('--only <list>', 'comma-separated subset of apps')
	.action(build)

program
	.command('deploy')
	.description("Run each app's deploy command (remotes before hosts)")
	.option('--only <list>', 'comma-separated subset of apps')
	.action(deploy)

program
	.command('ci')
	.description('Generate per-app GitHub deploy workflows with path filters')
	.option('--force', 'overwrite existing workflow files')
	.action(ci)

program
	.command('upgrade')
	.description('Regenerate spool-owned files and sync the toolchain to this CLI version')
	.option('--dry-run', 'report what would change without writing')
	.action(upgrade)

program
	.command('doctor')
	.description('Check ports, app folders, federation wiring and shared deps')
	.option('--remote', 'also fetch each deployed remote url')
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
