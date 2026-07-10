/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { requireWorkspace, saveManifest } from '../core/workspace.js'
import {
	DEFAULT_FRAMEWORK,
	HELPER_FILE,
	parseFramework,
	validateName,
	type AppConfig,
	type Framework,
	type Manifest,
} from '../core/config.js'
import { appFiles, defaultExposes, helperFile, hostWiringFiles } from '../core/generators.js'
import { TEMPLATES, remoteRef, remoteRefs } from '../core/templates/index.js'
import { appDependencies, FRAMEWORK_DEPS } from '../core/versions.js'
import { formatFiles } from '../core/format.js'
import { writeFiles } from '../core/fswrite.js'
import { installDependencies } from '../core/install.js'
import { type PackageJsonShape } from './upgrade.js'
import { log, fail } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface AddOptions {
	type?: string
	port?: string
	host?: string
	framework?: string
	install?: boolean
}

/*
 *   ADD
 ***************************************************************************************************/
export async function add(name: string, opts: AddOptions): Promise<void> {
	const ws = await requireWorkspace()
	const { manifest } = ws

	const nameError = validateName(name, 'app name')
	if (nameError) fail(nameError)
	if (manifest.apps[name]) {
		fail(`"${name}" already exists in this workspace. Pick a different name.`)
	}
	if (opts.type && opts.type !== 'host' && opts.type !== 'remote') {
		fail(`Unknown app type "${opts.type}". Use "host" or "remote".`)
	}
	const framework = parseFramework(opts.framework ?? DEFAULT_FRAMEWORK)

	const type: AppConfig['type'] = opts.type === 'host' ? 'host' : 'remote'
	if (type === 'host' && opts.host) {
		log.warn(`--host only applies when adding a remote; ignoring --host ${opts.host}.`)
	}
	const app: AppConfig = {
		type,
		framework,
		path: `apps/${name}`,
		port: resolvePort(manifest, opts.port),
		remotes: [],
		exposes: type === 'remote' ? defaultExposes(framework) : {},
	}
	manifest.apps[name] = app
	shareFrameworkRuntime(manifest, framework)

	const host = type === 'remote' ? wireIntoHost(manifest, name, opts.host) : undefined

	// Restore the runtime helper if it's missing (workspaces from older spool
	// versions). The new app's vite config imports it.
	const restored = await writeFiles(ws.root, await formatFiles(helperFile()))
	if (restored.written.length) {
		log.warn(
			`${HELPER_FILE} was missing and has been restored. Apps scaffolded before it existed keep their old baked vite configs; re-create them or port them to the helper.`
		)
	}

	await writeFiles(join(ws.root, app.path), await formatFiles(appFiles(manifest, name, app)))
	if (host) {
		const typings = await formatFiles(hostWiringFiles(manifest, host.app))
		await writeFiles(join(ws.root, host.app.path), typings, { force: true })
		// A bridge the host now needs is created, but never overwritten in
		// case the user has edited it.
		const bridge = TEMPLATES[host.app.framework].bridgeFiles(remoteRefs(manifest, host.app))
		await writeFiles(join(ws.root, host.app.path), await formatFiles(bridge))
		// A foreign-framework remote makes the host depend on that framework's
		// bridge runtime; add the missing deps without touching existing ones.
		await syncHostDeps(ws.root, manifest, host.app)
	}
	await saveManifest(ws)
	log.success(`added ${type} ${name} on port ${app.port}`)

	// The host's own components are never touched, so print how to mount the
	// new remote instead.
	if (host) printMountHint(name, framework, host)

	const pm = ws.manifest.packageManager
	if (opts.install === false) {
		log.step(`Run \`${pm} install\`, then \`spool dev\` to start it.`)
		return
	}
	log.step(`Linking the new app with ${pm} install`)
	if (await installDependencies(pm, ws.root)) log.step('Run `spool dev` to start it.')
	else log.warn(`Install failed. Run \`${pm} install\` before \`spool dev\`.`)
}

/*
 *   HELPERS
 ***************************************************************************************************/
interface HostRef {
	name: string
	app: AppConfig
}

function wireIntoHost(manifest: Manifest, remote: string, requested?: string): HostRef | undefined {
	const hostName = requested ?? defaultHost(manifest)
	if (!hostName) return undefined

	const app = manifest.apps[hostName]
	if (!app || app.type !== 'host') {
		fail(`There is no host named "${hostName}" in this workspace.`)
	}
	if (!app.remotes.includes(remote)) app.remotes.push(remote)
	log.step(`wired ${remote} into host ${hostName}`)
	return { name: hostName, app }
}

async function syncHostDeps(root: string, manifest: Manifest, host: AppConfig): Promise<void> {
	const expected = appDependencies(manifest, host)
	const target = join(root, host.path, 'package.json')
	let pkg: PackageJsonShape
	try {
		pkg = JSON.parse(await readFile(target, 'utf8')) as PackageJsonShape
	} catch {
		return
	}
	pkg.dependencies ??= {}
	pkg.devDependencies ??= {}
	let changed = false
	for (const [section, deps] of [
		['dependencies', expected.dependencies],
		['devDependencies', expected.devDependencies],
	] as const) {
		for (const [dep, range] of Object.entries(deps)) {
			if (pkg[section]![dep] === undefined) {
				pkg[section]![dep] = range
				changed = true
			}
		}
	}
	if (!changed) return
	const formatted = await formatFiles({ 'package.json': `${JSON.stringify(pkg)}\n` })
	await writeFile(target, formatted['package.json']!, 'utf8')
}

function resolvePort(manifest: Manifest, requested?: string): number {
	if (requested === undefined) return nextFreePort(manifest)

	const port = Number(requested)
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		fail(`Invalid port "${requested}". Use an integer between 1 and 65535.`)
	}
	const owner = Object.entries(manifest.apps).find(([, app]) => app.port === port)?.[0]
	if (owner) fail(`Port ${port} is already used by "${owner}". Pick another with --port.`)
	return port
}

function nextFreePort(manifest: Manifest): number {
	const used = new Set(Object.values(manifest.apps).map(app => app.port))
	let port = 5173
	while (used.has(port)) port++
	return port
}

/** Federation shares a framework runtime only when it is in `shared`. */
function shareFrameworkRuntime(manifest: Manifest, framework: Framework): void {
	const missing = FRAMEWORK_DEPS[framework].dependencies.filter(
		dep => !manifest.shared.includes(dep)
	)
	if (!missing.length) return
	manifest.shared.push(...missing)
	log.step(`shared ${missing.join(', ')} so every ${framework} app gets one copy`)
}

function printMountHint(name: string, framework: Framework, host: HostRef): void {
	const hint = TEMPLATES[host.app.framework].mountHint(remoteRef(name, framework), host.name)
	log.step(hint.intro)
	for (const line of hint.lines) log.plain(`    ${line}`)
}

function defaultHost(manifest: Manifest): string | undefined {
	return Object.entries(manifest.apps).find(([, app]) => app.type === 'host')?.[0]
}
