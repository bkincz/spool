/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import type { Manifest } from './config.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface Diagnostic {
	level: 'error' | 'warn'
	app: string
	message: string
}

type Apps = Manifest['apps']

const error = (app: string, message: string): Diagnostic => ({ level: 'error', app, message })
const warn = (app: string, message: string): Diagnostic => ({ level: 'warn', app, message })

/*
 *   DIAGNOSE
 ***************************************************************************************************/
export function diagnose(ws: Workspace): Diagnostic[] {
	const { apps } = ws.manifest
	return [
		...checkPorts(apps),
		...checkPaths(ws.root, apps),
		...checkRemotes(apps),
		...checkExposure(apps),
	]
}

/*
 *   CHECKS
 ***************************************************************************************************/
function checkPorts(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	const owners = new Map<number, string>()
	for (const [name, app] of Object.entries(apps)) {
		const owner = owners.get(app.port)
		if (owner) issues.push(error(name, `Port ${app.port} is already taken by "${owner}".`))
		else owners.set(app.port, name)
	}
	return issues
}

function checkPaths(root: string, apps: Apps): Diagnostic[] {
	return Object.entries(apps)
		.filter(([, app]) => !existsSync(join(root, app.path)))
		.map(([name, app]) => error(name, `Its folder "${app.path}" is missing.`))
}

function checkRemotes(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	for (const [name, host] of Object.entries(apps)) {
		if (host.type !== 'host') continue
		for (const remote of host.remotes) {
			const target = apps[remote]
			if (!target) {
				issues.push(
					error(name, `Remote "${remote}" does not match any app in this workspace.`)
				)
			} else if (target.type !== 'remote') {
				issues.push(
					error(
						name,
						`"${remote}" is wired as a remote but it is typed "${target.type}".`
					)
				)
			}
		}
	}
	return issues
}

function checkExposure(apps: Apps): Diagnostic[] {
	const issues: Diagnostic[] = []
	const consumed = new Set(
		Object.values(apps).flatMap(app => (app.type === 'host' ? app.remotes : []))
	)
	for (const [name, app] of Object.entries(apps)) {
		if (app.type !== 'remote') continue
		if (Object.keys(app.exposes).length === 0) {
			issues.push(warn(name, 'It exposes nothing, so no host can import it.'))
		}
		if (!consumed.has(name)) {
			issues.push(warn(name, 'No host imports this remote yet.'))
		}
	}
	return issues
}
