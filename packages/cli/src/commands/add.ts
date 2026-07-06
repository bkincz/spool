/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import { requireWorkspace, saveManifest } from '../core/workspace.js'
import { HELPER_FILE, validateName, type AppConfig, type Manifest } from '../core/config.js'
import { appFiles, helperFile, hostWiringFiles } from '../core/generators.js'
import { formatFiles } from '../core/format.js'
import { writeFiles } from '../core/fswrite.js'
import { run } from '../util/exec.js'
import { log, fail } from '../util/logger.js'
import { pascalCase } from '../util/names.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface AddOptions {
	type?: string
	port?: string
	host?: string
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

	const type: AppConfig['type'] = opts.type === 'host' ? 'host' : 'remote'
	if (type === 'host' && opts.host) {
		log.warn(`--host only applies when adding a remote; ignoring --host ${opts.host}.`)
	}
	const app: AppConfig = {
		type,
		path: `apps/${name}`,
		port: resolvePort(manifest, opts.port),
		remotes: [],
		exposes: type === 'remote' ? { './App': './src/App.tsx' } : {},
	}
	manifest.apps[name] = app

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
		const typings = await formatFiles(hostWiringFiles(host.app))
		await writeFiles(join(ws.root, host.app.path), typings, { force: true })
	}
	await saveManifest(ws)
	log.success(`added ${type} ${name} on port ${app.port}`)

	// App.tsx is never touched, so print how to mount the new remote instead.
	if (host) printMountHint(name, host.name)

	const pm = ws.manifest.packageManager
	if (opts.install === false) {
		log.step(`Run \`${pm} install\`, then \`spool dev\` to start it.`)
		return
	}
	log.step(`Linking the new app with ${pm} install`)
	try {
		await run(pm, ['install'], { cwd: ws.root, stdio: 'ignore' })
		log.step('Run `spool dev` to start it.')
	} catch {
		log.warn(`Install failed. Run \`${pm} install\` before \`spool dev\`.`)
	}
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

function printMountHint(remote: string, hostName: string): void {
	const comp = pascalCase(remote)
	log.step(`To mount it, edit apps/${hostName}/src/App.tsx:`)
	log.plain(`    const ${comp} = lazy(() => import("${remote}/App"))`)
	log.plain(`    // then render <${comp} /> inside a <Suspense> boundary`)
}

function defaultHost(manifest: Manifest): string | undefined {
	return Object.entries(manifest.apps).find(([, app]) => app.type === 'host')?.[0]
}
