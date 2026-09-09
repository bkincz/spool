/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import type { ServeMode } from './output.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface TrackedChild {
	name: string
	port: number
	pid: number
}

export interface Pidfile {
	parentPid: number
	startedAt: string
	children: TrackedChild[]
}

/*
 *   PATH
 ***************************************************************************************************/
export function pidfilePath(ws: Workspace, mode: ServeMode): string {
	return join(ws.root, '.spool', `${mode}.pid`)
}

/*
 *   READ / WRITE
 ***************************************************************************************************/
/** Overwrites the pidfile with the current set of tracked children. */
export function writePidfile(ws: Workspace, mode: ServeMode, children: TrackedChild[]): void {
	const data: Pidfile = { parentPid: process.pid, startedAt: new Date().toISOString(), children }

	mkdirSync(join(ws.root, '.spool'), { recursive: true })
	writeFileSync(pidfilePath(ws, mode), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function readPidfile(ws: Workspace, mode: ServeMode): Pidfile | undefined {
	const target = pidfilePath(ws, mode)
	if (!existsSync(target)) return undefined

	try {
		return JSON.parse(readFileSync(target, 'utf8')) as Pidfile
	} catch {
		return undefined
	}
}

export function removePidfile(ws: Workspace, mode: ServeMode): void {
	rmSync(pidfilePath(ws, mode), { force: true })
}
