/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import { requireWorkspace, saveManifest } from '../core/workspace.js'
import { appPort, validateName, type AppConfig, type Manifest } from '../core/config.js'
import { appFiles, hostWiringFiles } from '../core/generators.js'
import { writeFiles } from '../core/fswrite.js'
import { run } from '../util/exec.js'
import { log, fail } from '../util/logger.js'

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
	const ws = await requireWorkspace().catch((e: Error) => fail(e.message))
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
	const app: AppConfig = {
		type,
		path: `apps/${name}`,
		port: resolvePort(manifest, opts.port),
		remotes: [],
		exposes: type === 'remote' ? { './App': './src/App.tsx' } : {},
	}
	manifest.apps[name] = app

	const host = type === 'remote' ? wireIntoHost(manifest, name, opts.host) : undefined
	const portOf = (target: string) => appPort(manifest, target)

	await writeFiles(join(ws.root, app.path), appFiles(manifest, name, app, portOf))
	if (host) {
		const config = hostWiringFiles(manifest, host.name, host.app, portOf)
		await writeFiles(join(ws.root, host.app.path), config, { force: true })
	}
	await saveManifest(ws)
	log.success(`added ${type} ${name} on port ${app.port}`)

	// The host's federation config and typings are regenerated, but its App.tsx
	// is left untouched so we never clobber the user's layout. Tell them exactly
	// how to mount the new remote.
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

/** PascalCase a name for use as a React component identifier. */
function componentName(name: string): string {
	return name
		.split('-')
		.filter(Boolean)
		.map(word => word[0]!.toUpperCase() + word.slice(1))
		.join('')
}

function printMountHint(remote: string, hostName: string): void {
	const comp = componentName(remote)
	log.step(`To mount it, edit apps/${hostName}/src/App.tsx:`)
	log.plain(`    const ${comp} = lazy(() => import("${remote}/App"))`)
	log.plain(`    // then render <${comp} /> inside a <Suspense> boundary`)
}

function defaultHost(manifest: Manifest): string | undefined {
	return Object.entries(manifest.apps).find(([, app]) => app.type === 'host')?.[0]
}
