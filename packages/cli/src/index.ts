/*
 *   IMPORTS
 ***************************************************************************************************/
import { Command } from 'commander'
import { create } from './commands/create.js'
import { add } from './commands/add.js'
import { addon } from './commands/addon.js'
import { remove } from './commands/remove.js'
import { dev } from './commands/dev.js'
import { build } from './commands/build.js'
import { preview } from './commands/preview.js'
import { deploy } from './commands/deploy.js'
import { promote } from './commands/promote.js'
import { rollback } from './commands/rollback.js'
import { ci } from './commands/ci.js'
import { types } from './commands/types.js'
import { upgrade } from './commands/upgrade.js'
import { doctor } from './commands/doctor.js'
import { graph } from './commands/graph.js'
import { affected } from './commands/affected.js'
import { eject } from './commands/eject.js'
import { CLI_VERSION } from './core/versions.js'
import { CliError } from './util/errors.js'
import { log } from './util/logger.js'

/*
 *   PROGRAM
 ***************************************************************************************************/
const program = new Command()

program
	.name('spool')
	.description('Toolset for micro frontends and modular frontend projects')
	.version(CLI_VERSION)

const ADDON_LIST =
	'ladle | playwright | lint | test | turbo | state | sentry | navigation | federation'

/*
 *   SCAFFOLD
 ***************************************************************************************************/
program
	.command('create [dir]')
	.description('Scaffold a new micro-frontend workspace')
	.option('-n, --name <name>', 'workspace name')
	.option('--host <name>', 'host (shell) app name, optionally name:framework')
	.option('--remotes <list>', 'comma-separated remote app names, each optionally name:framework')
	.option('--pm <manager>', 'package manager: pnpm | npm | yarn')
	.option('--framework <framework>', 'default framework: react | svelte | vue')
	.option('--addons <list>', `comma-separated extras: ${ADDON_LIST}, or "none"`)
	.option('--here', 'scaffold into the current directory')
	.option('--no-install', 'skip dependency install')
	.action(create)

program
	.command('add <name>')
	.description('Add a host or remote app to the workspace')
	.option('-t, --type <type>', 'host | remote', 'remote')
	.option('-p, --port <port>', 'dev server port')
	.option('--host <name>', 'host app to wire this remote into')
	.option('--framework <framework>', 'react | svelte | vue', 'react')
	.option('--no-install', 'skip dependency install')
	.action(add)

program
	.command('addon [addons...]')
	.description(`Add extras to an existing workspace: ${ADDON_LIST}`)
	.option('--only <list>', 'comma-separated apps to write per-app files into')
	.option('--no-install', 'skip dependency install')
	.action(addon)

program
	.command('remove <name>')
	.description('Remove an app from the workspace and unwire it from every consumer')
	.option('--files', 'also delete the app folder')
	.option('--yes', 'with --files, delete without asking')
	.action(remove)

/*
 *   RUN
 ***************************************************************************************************/
program
	.command('dev')
	.description('Run host + remotes together (remotes first)')
	.option('--only <list>', 'comma-separated subset of apps')
	.option(
		'--rest <mode>',
		'for remotes the selection needs but excludes: "built" previews their dist, an env name uses their deployed url'
	)
	.option('--timeout <seconds>', 'seconds to wait for each remote before giving up', '20')
	.option('--no-ladle', 'skip the component workshop')
	.option('--kill', 'stop a previous dev run and free the manifest ports, then exit')
	.action(dev)

program
	.command('build')
	.description('Build every app for production (remotes before hosts)')
	.option('--only <list>', 'comma-separated subset of apps')
	.option('--env <name>', "select each remote's urls.<name> for this build")
	.option('--concurrency <n>', 'apps to build at once (default: one less than the cores)')
	.option('--json', 'print one JSON line per app to stdout; everything else goes to stderr')
	.action(build)

program
	.command('preview')
	.description('Serve the built apps locally (remotes before hosts)')
	.option('--only <list>', 'comma-separated subset of apps')
	.option('--kill', 'stop a previous preview run and free the manifest ports, then exit')
	.action(preview)

program
	.command('types')
	.description("Type each remote's exposes from its real source, for <Remote> and remotes.d.ts")
	.option('--only <list>', 'comma-separated subset of apps')
	.action(types)

/*
 *   SHIP
 ***************************************************************************************************/
program
	.command('deploy')
	.description("Run each app's deploy command (remotes before hosts)")
	.option('--only <list>', 'comma-separated subset of apps')
	.option(
		'--env <name>',
		'exposed as SPOOL_ENV; records the deploy and checks shared deps against it'
	)
	.option('--json', 'print one JSON line per app to stdout; everything else goes to stderr')
	.action(deploy)

program
	.command('promote <target>')
	.description('Re-run a recorded app@sha deploy against another env')
	.requiredOption('--env <env>', 'target environment')
	.action(promote)

program
	.command('rollback <name>')
	.description("Re-run an app's previous recorded deploy for an env")
	.requiredOption('--env <env>', 'target environment')
	.action(rollback)

program
	.command('ci')
	.description('Generate GitHub workflows: one checking the workspace, one per deployable app')
	.option('--force', 'overwrite existing workflow files')
	.option('--pin', 'resolve actions to commit shas over the network (implies --force)')
	.action(ci)

/*
 *   MAINTAIN
 ***************************************************************************************************/
program
	.command('upgrade')
	.description('Regenerate spool-owned files and sync the toolchain to this CLI version')
	.option('--dry-run', 'report what would change without writing')
	.option('--pin', "write this CLI's dependency ranges even when the workspace is ahead")
	.option(
		'--force [files...]',
		'overwrite generated files that have local changes; name paths to limit it'
	)
	.action(upgrade)

program
	.command('doctor')
	.description('Check ports, wiring, generated files, shared deps and environment')
	.option('--remote', 'also fetch each deployed remote url')
	.option('--env <name>', "check each remote's urls.<name> instead of url")
	.option('--fix', 'apply the fixes doctor can make safely')
	.option('--dry-run', 'with --fix, report what would change without writing')
	.option('--json', 'print { problems: [...] } instead of text')
	.action(doctor)

program
	.command('graph')
	.description('Print hosts, remotes, what each consumes and exposes, and the shared list')
	.option('--json', 'print structured data instead of a tree')
	.option('--dot', 'print Graphviz dot')
	.action(graph)

program
	.command('affected')
	.description(
		'List apps changed since a git ref, through their own files or a package they import'
	)
	.option('--since <ref>', 'git ref to diff against')
	.option('--json', 'print { since, changed, apps }')
	.action(affected)

program
	.command('eject')
	.description('Remove the spool dependency and keep spool.json and every generated file')
	.option('--yes', 'skip the confirmation prompt')
	.action(eject)

/*
 *   ENTRY POINT
 ***************************************************************************************************/
// The single exit point for failures. Everything below throws.
program.parseAsync().catch((err: unknown) => {
	if (err instanceof CliError) log.error(err.message)
	else console.error(err)
	process.exitCode = 1
})
