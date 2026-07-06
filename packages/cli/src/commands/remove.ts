/*
 *   IMPORTS
 ***************************************************************************************************/
import { rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { requireWorkspace, saveManifest, type Workspace } from '../core/workspace.js'
import { hostWiringFiles } from '../core/generators.js'
import { formatFiles } from '../core/format.js'
import { writeFiles } from '../core/fswrite.js'
import { log, fail } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface RemoveOptions {
	files?: boolean
}

/*
 *   REMOVE
 ***************************************************************************************************/
export async function remove(name: string, opts: RemoveOptions): Promise<void> {
	const ws = await requireWorkspace()
	const { manifest } = ws

	const app = manifest.apps[name]
	if (!app) {
		fail(`No app named "${name}" in this workspace. Check the names in spool.json.`)
	}
	// Validate before mutating anything, so a refusal leaves the workspace as it was.
	const appDir = opts.files ? appDirInsideWorkspace(ws, app.path) : undefined

	delete manifest.apps[name]
	const hosts = unwireFromHosts(ws, name)
	for (const host of hosts) await refreshHostTypings(ws, host)
	await saveManifest(ws)

	if (appDir) {
		await rm(appDir, { recursive: true, force: true })
		log.step(`deleted ${app.path}`)
	} else {
		log.step(`Left ${app.path} on disk. Delete it yourself, or rerun with --files.`)
	}

	log.success(`removed ${app.type} ${name}`)
	if (hosts.length) {
		log.step(
			`If a host's App component still imports or mounts "${name}/App", remove that code.`
		)
	}
}

/*
 *   HELPERS
 ***************************************************************************************************/
interface HostRef {
	name: string
	path: string
	remotes: string[]
}

function unwireFromHosts(ws: Workspace, remote: string): HostRef[] {
	const affected: HostRef[] = []
	for (const [hostName, host] of Object.entries(ws.manifest.apps)) {
		if (host.type !== 'host' || !host.remotes.includes(remote)) continue
		host.remotes = host.remotes.filter(r => r !== remote)
		affected.push({ name: hostName, path: host.path, remotes: host.remotes })
		log.step(`unwired ${remote} from host ${hostName}`)
	}
	return affected
}

async function refreshHostTypings(ws: Workspace, host: HostRef): Promise<void> {
	const app = ws.manifest.apps[host.name]!
	if (host.remotes.length) {
		await writeFiles(
			join(ws.root, host.path),
			await formatFiles(hostWiringFiles(ws.manifest, app)),
			{ force: true }
		)
	} else {
		// hostWiringFiles writes nothing for a host without remotes, so the
		// stale declarations have to go explicitly.
		await rm(join(ws.root, host.path, 'src/remotes.d.ts'), { force: true })
	}
}

/** A hand-edited path must never let --files delete outside the workspace. */
function appDirInsideWorkspace(ws: Workspace, appPath: string): string {
	const target = resolve(ws.root, appPath)
	if (target !== ws.root && !target.startsWith(ws.root + sep)) {
		fail(`Refusing to delete "${appPath}": it resolves outside the workspace.`)
	}
	if (target === ws.root) {
		fail(`Refusing to delete "${appPath}": it is the workspace root.`)
	}
	return target
}
