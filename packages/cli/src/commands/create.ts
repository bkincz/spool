/*
 *   IMPORTS
 ***************************************************************************************************/
import { resolve, basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import * as p from '@clack/prompts'
import pc from 'picocolors'
import {
	DEFAULT_FRAMEWORK,
	Framework,
	MANIFEST_FILE,
	emptyManifest,
	appPort,
	parseFramework,
	validateFramework,
	validateName,
	type AppConfig,
	type Framework as FrameworkType,
	type Manifest,
} from '../core/config.js'
import { workspaceFiles, appFiles, defaultExposes } from '../core/generators.js'
import { FRAMEWORK_DEPS } from '../core/versions.js'
import { formatFiles } from '../core/format.js'
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
	framework?: string
	install?: boolean
	here?: boolean
}

/** An app to scaffold: its name plus the framework it uses. */
interface AppSpec {
	name: string
	framework: FrameworkType
}

interface CreateInputs {
	name: string
	host: AppSpec
	remotes: AppSpec[]
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

	// Default the folder to the workspace name so the `cd <name>` hint at the
	// end points at the right place.
	const targetDir = opts.here ? process.cwd() : resolve(process.cwd(), dir ?? inputs.name)
	if (existsSync(join(targetDir, MANIFEST_FILE))) {
		fail(
			`There is already a spool workspace in ${targetDir}. Pick another folder or remove it first.`
		)
	}

	const manifest = buildManifest(inputs)
	await scaffold(targetDir, manifest)

	log.success(`scaffolded ${pc.bold(inputs.name)} in ${pc.dim(targetDir)}`)
	log.step(
		`host: ${inputs.host.name} (${inputs.host.framework}) on port ${appPort(manifest, inputs.host.name)}`
	)
	for (const remote of inputs.remotes) {
		log.step(
			`remote: ${remote.name} (${remote.framework}) on port ${appPort(manifest, remote.name)}`
		)
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
async function askText(options: Parameters<typeof p.text>[0]): Promise<string | null> {
	const answer = await p.text(options)
	return p.isCancel(answer) ? null : answer.trim()
}

async function resolveInputs(
	dir: string | undefined,
	opts: CreateOptions
): Promise<CreateInputs | null> {
	let name = opts.name
	let namePrompted = false
	if (name === undefined && dir) {
		name = basename(resolve(process.cwd(), dir))
		// The name was inferred, not typed; blame the right thing.
		const error = validateName(name, 'workspace name')
		if (error) fail(`${error} (Derived from the folder name; pass --name to override.)`)
	}
	if (name === undefined) {
		const answer = await askText({
			message: 'Workspace name?',
			placeholder: 'acme-frontend',
			validate: v => validateName(v, 'workspace name'),
		})
		if (answer === null) return null
		name = answer
		namePrompted = true
	}
	ensureValid(name, 'workspace name')

	const interactive = namePrompted || opts.host === undefined || opts.remotes === undefined
	const defaultFramework =
		opts.framework === undefined ? undefined : parseFramework(opts.framework)

	const host = await resolveHost(opts, defaultFramework, interactive)
	if (host === null) return null

	const remotes = await resolveRemotes(opts, defaultFramework, interactive, host)
	if (remotes === null) return null

	const names = [host.name, ...remotes.map(r => r.name)]
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

	return { name, host, remotes, packageManager }
}

/** Host name and framework, from --host ("name" or "name:framework") or prompts. */
async function resolveHost(
	opts: CreateOptions,
	defaultFramework: FrameworkType | undefined,
	interactive: boolean
): Promise<AppSpec | null> {
	let spec: ParsedSpec
	if (opts.host !== undefined) {
		spec = parseSpec(opts.host, 'host name')
	} else {
		const raw = await askText({
			message: 'Host (shell) app name?',
			initialValue: 'shell',
			validate: v => validateSpec(v, 'host name'),
		})
		if (raw === null) return null
		spec = parseSpec(raw, 'host name')
	}

	const framework = await resolveFramework(spec, defaultFramework, interactive, DEFAULT_FRAMEWORK)
	if (framework === null) return null
	return { name: spec.name, framework }
}

/**
 * Remote names and frameworks. Each entry accepts "name" or "name:framework".
 * Entries without one fall back to "--framework", and then interactively a select
 * prompt, then the host's framework.
 */
async function resolveRemotes(
	opts: CreateOptions,
	defaultFramework: FrameworkType | undefined,
	interactive: boolean,
	host: AppSpec
): Promise<AppSpec[] | null> {
	const raw =
		opts.remotes ??
		(await askText({
			message: 'Remote app names? (comma separated, add :framework to mix)',
			placeholder: 'dashboard, profile:vue',
			initialValue: 'dashboard',
			validate: validateRemoteList,
		}))
	if (raw === null) return null

	const remotes: AppSpec[] = []
	for (const entry of splitList(raw)) {
		const spec = parseSpec(entry, 'remote name')
		const framework = await resolveFramework(
			spec,
			defaultFramework,
			interactive,
			host.framework
		)
		if (framework === null) return null
		remotes.push({ name: spec.name, framework })
	}
	return remotes
}

async function resolveFramework(
	spec: ParsedSpec,
	defaultFramework: FrameworkType | undefined,
	interactive: boolean,
	fallback: FrameworkType
): Promise<FrameworkType | null> {
	if (spec.framework !== undefined) return spec.framework
	if (defaultFramework !== undefined) return defaultFramework
	if (!interactive) return fallback

	const answer = await p.select({
		message: `Framework for ${spec.name}?`,
		initialValue: fallback,
		options: Framework.options.map(value => ({ value, label: value })),
	})
	return p.isCancel(answer) ? null : answer
}

async function scaffold(targetDir: string, manifest: Manifest): Promise<void> {
	await writeFiles(targetDir, await formatFiles(workspaceFiles(manifest)))
	await Promise.all(
		Object.entries(manifest.apps).map(async ([name, app]) =>
			writeFiles(join(targetDir, app.path), await formatFiles(appFiles(manifest, name, app)))
		)
	)
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
function buildManifest({ name, host, remotes, packageManager }: CreateInputs): Manifest {
	const manifest = emptyManifest(name)
	manifest.packageManager = packageManager

	const frameworks = [...new Set([host.framework, ...remotes.map(r => r.framework)])]
	manifest.shared = [
		...new Set(frameworks.flatMap(framework => FRAMEWORK_DEPS[framework].dependencies)),
	]
	let port = 5173

	manifest.apps[host.name] = {
		type: 'host',
		framework: host.framework,
		path: `apps/${host.name}`,
		port: port++,
		remotes: remotes.map(r => r.name),
		exposes: {},
	} satisfies AppConfig

	for (const remote of remotes) {
		manifest.apps[remote.name] = {
			type: 'remote',
			framework: remote.framework,
			path: `apps/${remote.name}`,
			port: port++,
			remotes: [],
			exposes: defaultExposes(remote.framework),
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

interface ParsedSpec {
	name: string
	framework?: FrameworkType
}

function readSpec(value: string, label: string): { spec: ParsedSpec } | { error: string } {
	const parts = value.split(':').map(part => part.trim())
	if (parts.length > 2) {
		return { error: `Invalid ${label} "${value}". Use "name" or "name:framework".` }
	}
	const nameError = validateName(parts[0]!, label)
	if (nameError) return { error: nameError }
	if (parts[1] === undefined) return { spec: { name: parts[0]! } }
	const frameworkError = validateFramework(parts[1])
	if (frameworkError) return { error: frameworkError }
	return { spec: { name: parts[0]!, framework: Framework.parse(parts[1]) } }
}

function parseSpec(raw: string, label: string): ParsedSpec {
	const result = readSpec(raw, label)
	if ('error' in result) fail(result.error)
	return result.spec
}

function validateSpec(value: string, label: string): string | undefined {
	const result = readSpec(value, label)
	return 'error' in result ? result.error : undefined
}

function validateRemoteList(value: string): string | undefined {
	for (const remote of splitList(value)) {
		const error = validateSpec(remote, 'remote name')
		if (error) return error
	}
	return undefined
}
