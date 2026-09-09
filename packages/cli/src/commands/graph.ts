/*
 *   IMPORTS
 ***************************************************************************************************/
import { requireWorkspace, type Workspace } from '../core/workspace.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface GraphOptions {
	json?: boolean
	dot?: boolean
}

interface GraphApp {
	name: string
	type: 'host' | 'remote'
	framework: string
	port: number
	consumes: string[]
	exposes: string[]
}

interface GraphData {
	name: string
	apps: GraphApp[]
	shared: string[]
}

/*
 *   GRAPH
 ***************************************************************************************************/
export async function graph(opts: GraphOptions = {}): Promise<void> {
	const ws = await requireWorkspace()
	const data = buildGraph(ws)

	if (opts.json) {
		log.plain(JSON.stringify(data, null, 2))
		return
	}
	if (opts.dot) {
		log.plain(renderDot(data))
		return
	}
	log.plain(renderTree(data))
}

/*
 *   BUILD
 ***************************************************************************************************/
function buildGraph(ws: Workspace): GraphData {
	const apps: GraphApp[] = Object.entries(ws.manifest.apps).map(([name, app]) => ({
		name,
		type: app.type,
		framework: app.framework,
		port: app.port,
		consumes: [...app.remotes],
		exposes: Object.keys(app.exposes),
	}))

	return { name: ws.manifest.name, apps, shared: [...ws.manifest.shared] }
}

/*
 *   RENDER
 ***************************************************************************************************/
function renderTree(data: GraphData): string {
	const lines: string[] = [data.name]

	data.apps.forEach((app, index) => {
		const last = index === data.apps.length - 1
		const pipe = last ? '  ' : '│ '
		lines.push(
			`${last ? '└─' : '├─'} ${app.name} (${app.type}, ${app.framework}, port ${app.port})`
		)

		const details: string[] = []
		if (app.consumes.length || app.type === 'host') {
			details.push(`consumes: ${app.consumes.length ? app.consumes.join(', ') : '(none)'}`)
		}
		if (app.type === 'remote') {
			details.push(`exposes: ${app.exposes.length ? app.exposes.join(', ') : '(none)'}`)
		}

		details.forEach((detail, detailIndex) => {
			const detailLast = detailIndex === details.length - 1
			lines.push(`${pipe} ${detailLast ? '└─' : '├─'} ${detail}`)
		})
	})

	lines.push(`shared: ${data.shared.length ? data.shared.join(', ') : '(none)'}`)
	return lines.join('\n')
}

function renderDot(data: GraphData): string {
	const escape = (value: string): string => value.replace(/"/g, '\\"')
	const lines = ['digraph spool {', '  rankdir=LR;']

	for (const app of data.apps) {
		const shape = app.type === 'host' ? 'box' : 'ellipse'
		const label = `${app.name}\\n${app.framework}`
		lines.push(`  "${escape(app.name)}" [shape=${shape}, label="${escape(label)}"];`)
	}

	for (const app of data.apps) {
		for (const consumed of app.consumes) {
			lines.push(`  "${escape(app.name)}" -> "${escape(consumed)}";`)
		}
	}

	lines.push('}')
	return lines.join('\n')
}
