/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import pc from 'picocolors'
import type { Workspace } from './workspace.js'
import type { AppConfig } from './config.js'
import { run, spawnProcess, killTree } from '../util/exec.js'
import { waitForManifest } from '../util/net.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
const COLORS = [pc.cyan, pc.magenta, pc.green, pc.yellow, pc.blue, pc.red]

interface NamedApp {
	name: string
	app: AppConfig
}

/*
 *   SELECTION
 ***************************************************************************************************/
function selectApps(ws: Workspace, only?: string[]): NamedApp[] {
	const all = Object.entries(ws.manifest.apps).map(([name, app]) => ({ name, app }))
	if (!only?.length) return all

	const known = new Set(all.map(a => a.name))
	const unknown = only.filter(name => !known.has(name))
	if (unknown.length) {
		throw new Error(
			`Unknown app(s) in --only: ${unknown.join(', ')}. Check the names in spool.json.`
		)
	}
	return all.filter(a => only.includes(a.name))
}

const remotesOf = (apps: NamedApp[]): NamedApp[] => apps.filter(a => a.app.type === 'remote')
const hostsOf = (apps: NamedApp[]): NamedApp[] => apps.filter(a => a.app.type === 'host')

/*
 *   DEV
 ***************************************************************************************************/
export async function devAll(ws: Workspace, only?: string[]): Promise<void> {
	const apps = selectApps(ws, only)
	if (!apps.length) {
		log.warn('No apps to run.')
		return
	}

	const remotes = remotesOf(apps)
	const hosts = hostsOf(apps)
	const children: ChildProcess[] = []
	let shuttingDown = false

	const shutdown = (code = 0): void => {
		if (shuttingDown) return
		shuttingDown = true
		for (const child of children) killTree(child)
		process.exit(code)
	}
	process.on('SIGINT', () => shutdown(0))
	process.on('SIGTERM', () => shutdown(0))

	const start = (named: NamedApp, colorIndex: number): void => {
		const child = spawnApp(ws, named, COLORS[colorIndex % COLORS.length]!)
		child.on('exit', code => {
			if (shuttingDown || code === 0 || code === null) return
			// Defer so a Ctrl+C that takes this child down with us wins the race
			// and we stay quiet, rather than reporting it as a crash.
			setImmediate(() => {
				if (shuttingDown) return
				log.error(
					`${named.name} stopped unexpectedly (exit ${code}). Shutting down the others.`
				)
				shutdown(1)
			})
		})
		children.push(child)
	}

	// A host fetches each remote's federation manifest on first load, so the
	// remotes have to be serving before we hand control to the hosts.
	remotes.forEach((remote, i) => start(remote, i))
	await Promise.all(remotes.map(waitForRemote))
	hosts.forEach((host, i) => start(host, remotes.length + i))

	await new Promise<void>(() => {})
}

async function waitForRemote({ name, app }: NamedApp): Promise<void> {
	const url = `http://localhost:${app.port}/mf-manifest.json`
	try {
		await waitForManifest(url)
	} catch {
		log.warn(
			`${name} is not serving its federation manifest on port ${app.port} yet. Hosts may need one reload.`
		)
	}
}

function spawnApp(
	ws: Workspace,
	{ name, app }: NamedApp,
	color: (s: string) => string
): ChildProcess {
	const prefix = color(`[${name}]`)
	const child = spawnProcess(ws.manifest.packageManager, ['run', 'dev'], {
		cwd: join(ws.root, app.path),
	})

	const pipe = (data: Buffer, stream: NodeJS.WriteStream): void => {
		for (const line of data.toString().split('\n')) {
			if (line.trim()) stream.write(`${prefix} ${line}\n`)
		}
	}
	child.stdout?.on('data', d => pipe(d, process.stdout))
	child.stderr?.on('data', d => pipe(d, process.stderr))
	log.step(`${color(name)} on port ${app.port}`)
	return child
}

/*
 *   BUILD
 ***************************************************************************************************/
export async function buildAll(ws: Workspace, only?: string[]): Promise<void> {
	const apps = selectApps(ws, only)
	const ordered = [...remotesOf(apps), ...hostsOf(apps)]

	for (const { name, app } of ordered) {
		log.step(`building ${pc.bold(name)} (${app.type})`)
		try {
			await run(ws.manifest.packageManager, ['run', 'build'], {
				cwd: join(ws.root, app.path),
			})
		} catch {
			throw new Error(
				`Build failed for "${name}". Run \`${filterBuildCommand(ws.manifest.packageManager, name)}\` to see the full output.`
			)
		}
	}
	log.success(`built ${ordered.length} app(s)`)
}

function filterBuildCommand(pm: Workspace['manifest']['packageManager'], name: string): string {
	switch (pm) {
		case 'npm':
			return `npm run build -w ${name}`
		case 'yarn':
			return `yarn workspace ${name} build`
		default:
			return `pnpm --filter ${name} build`
	}
}
