/*
 *   IMPORTS
 ***************************************************************************************************/
import { resolve, basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	emptyManifest,
	appPort,
	validateName,
	type AppConfig,
	type Manifest,
} from '../core/config.js'
import { workspaceFiles, appFiles } from '../core/generators.js'
import { writeFiles } from '../core/fswrite.js'
import { run } from '../util/exec.js'
import { log, fail } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface CreateOptions {
	name?: string
	host?: string
	remotes?: string
	pm?: string
	install?: boolean
	here?: boolean
}

interface CreateInputs {
	name: string
	hostName: string
	remoteNames: string[]
	packageManager: Manifest['packageManager']
}

/*
 *   CREATE
 ***************************************************************************************************/
export async function create(dir: string | undefined, opts: CreateOptions): Promise<void> {
	p.intro(pc.cyan(pc.bold('spool create')))

	const inputs = await resolveInputs(dir, opts)
	if (!inputs) {
		p.cancel('Cancelled.')
		return
	}

	// The target folder defaults to the workspace name (not the cwd), so that the
	// `cd <name>` we print at the end actually lands in the scaffolded folder.
	const targetDir = opts.here ? process.cwd() : resolve(process.cwd(), dir ?? inputs.name)
	if (existsSync(join(targetDir, 'spool.json'))) {
		log.error(
			`There is already a spool workspace in ${targetDir}. Pick another folder or remove it first.`
		)
		return
	}

	const manifest = buildManifest(inputs)
	await scaffold(targetDir, manifest)

	log.success(`scaffolded ${pc.bold(inputs.name)} in ${pc.dim(targetDir)}`)
	log.step(`host: ${inputs.hostName} on port ${appPort(manifest, inputs.hostName)}`)
	for (const remote of inputs.remoteNames) {
		log.step(`remote: ${remote} on port ${appPort(manifest, remote)}`)
	}

	if (opts.install ?? true) await installDependencies(targetDir, manifest.packageManager)
	else {
		log.step(
			`Skipped install. Run \`${manifest.packageManager} install\` in the new folder when you are ready.`
		)
	}

	const cd = opts.here ? '' : `  cd ${dir ?? inputs.name}\n`
	p.outro(`${pc.green('Done.')} Next:\n${cd}  spool dev`)
}

/*
 *   STEPS
 ***************************************************************************************************/
async function resolveInputs(
	dir: string | undefined,
	opts: CreateOptions
): Promise<CreateInputs | null> {
	let name = opts.name ?? (dir ? basename(resolve(process.cwd(), dir)) : undefined)
	if (name === undefined) {
		const answer = await p.text({
			message: 'Workspace name?',
			placeholder: 'acme-frontend',
			validate: v => validateName(v, 'workspace name'),
		})
		if (p.isCancel(answer)) return null
		name = answer.trim()
	} else {
		ensureValid(name, 'workspace name')
	}

	let hostName = opts.host
	if (hostName === undefined) {
		const answer = await p.text({
			message: 'Host (shell) app name?',
			initialValue: 'shell',
			validate: v => validateName(v, 'host name'),
		})
		if (p.isCancel(answer)) return null
		hostName = answer.trim()
	} else {
		ensureValid(hostName, 'host name')
	}

	let remoteNames: string[]
	if (opts.remotes !== undefined) {
		remoteNames = splitList(opts.remotes)
	} else {
		const answer = await p.text({
			message: 'Remote app names? (comma separated)',
			placeholder: 'dashboard, profile',
			initialValue: 'dashboard',
			validate: validateRemoteList,
		})
		if (p.isCancel(answer)) return null
		remoteNames = splitList(String(answer))
	}
	for (const remote of remoteNames) ensureValid(remote, 'remote name')

	const names = [hostName, ...remoteNames]
	if (new Set(names).size !== names.length) {
		fail('App names must be unique. A remote cannot share the host name.')
	}

	let packageManager: Manifest['packageManager']
	if (opts.pm !== undefined) {
		packageManager = parsePackageManager(opts.pm)
	} else {
		const answer = await p.select({
			message: 'Package manager?',
			initialValue: 'pnpm' as Manifest['packageManager'],
			options: [
				{ value: 'pnpm', label: 'pnpm' },
				{ value: 'npm', label: 'npm' },
				{ value: 'yarn', label: 'yarn' },
			],
		})
		if (p.isCancel(answer)) return null
		packageManager = answer
	}

	return { name, hostName, remoteNames, packageManager }
}

async function scaffold(targetDir: string, manifest: Manifest): Promise<void> {
	await writeFiles(targetDir, workspaceFiles(manifest))

	const portOf = (name: string) => appPort(manifest, name)
	for (const [name, app] of Object.entries(manifest.apps)) {
		await writeFiles(join(targetDir, app.path), appFiles(manifest, name, app, portOf))
	}
}

async function installDependencies(
	targetDir: string,
	packageManager: Manifest['packageManager']
): Promise<void> {
	const spinner = p.spinner()
	spinner.start(`Installing dependencies with ${packageManager}`)
	try {
		await run(packageManager, ['install'], { cwd: targetDir, stdio: 'ignore' })
		spinner.stop('Dependencies installed.')
	} catch {
		spinner.stop(
			pc.yellow(
				`Install failed. Run \`${packageManager} install\` in the new folder to finish setup.`
			)
		)
	}
}

/*
 *   HELPERS
 ***************************************************************************************************/
function buildManifest({ name, hostName, remoteNames, packageManager }: CreateInputs): Manifest {
	const manifest = emptyManifest(name)
	manifest.packageManager = packageManager
	let port = 5173

	manifest.apps[hostName] = {
		type: 'host',
		path: `apps/${hostName}`,
		port: port++,
		remotes: [...remoteNames],
		exposes: {},
	} satisfies AppConfig

	for (const remote of remoteNames) {
		manifest.apps[remote] = {
			type: 'remote',
			path: `apps/${remote}`,
			port: port++,
			remotes: [],
			exposes: { './App': './src/App.tsx' },
		} satisfies AppConfig
	}

	return manifest
}

function splitList(value: string): string[] {
	return value
		.split(',')
		.map(item => item.trim())
		.filter(Boolean)
}

function ensureValid(value: string, label: string): void {
	const error = validateName(value, label)
	if (error) fail(error)
}

function parsePackageManager(value: string): Manifest['packageManager'] {
	if (value === 'pnpm' || value === 'npm' || value === 'yarn') return value
	fail(`Unknown package manager "${value}". Use pnpm, npm or yarn.`)
}

/** Validates a comma-separated remote list for the interactive prompt. Empty is allowed. */
function validateRemoteList(value: string): string | undefined {
	for (const remote of splitList(value)) {
		const error = validateName(remote, 'remote name')
		if (error) return error
	}
	return undefined
}
