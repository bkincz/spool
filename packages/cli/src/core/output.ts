/*
 *   IMPORTS
 ***************************************************************************************************/
import pc from 'picocolors'
import { log } from '../util/logger.js'

/*
 *   DEV OUTPUT
 ***************************************************************************************************/
export const COLORS = [pc.cyan, pc.magenta, pc.green, pc.yellow, pc.blue, pc.red]

// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;?]*[a-zA-Z]/g

interface AppStatus {
	name: string
	role: string
	port: number
	order: number
	readyOnUrl: boolean
	color: (s: string) => string
	buffer: { line: string; err: boolean }[]
	tail: string
	dropped: number
	ready: boolean
	viteVersion?: string
	readyMs?: string
	url?: string
}

export interface TrackMeta {
	role: string
	port: number
	order: number
	readyOnUrl?: boolean
}

/** Startup chatter is capped per app; a crash or slow start flushes what is kept. */
const BUFFER_CAP = 400

export type ServeMode = 'dev' | 'preview'

export class DevOutput {
	private readonly statuses = new Map<string, AppStatus>()
	private streaming = false
	private readonly timer: NodeJS.Timeout
	private pending: NodeJS.Timeout | undefined
	private anchored = false
	private panel: string[] = []
	private readonly onResize = (): void => {
		if (this.anchored) this.paint()
	}

	constructor(
		private total: number,
		private readonly mode: ServeMode
	) {
		this.timer = setTimeout(() => {
			log.warn('The servers have not reported ready yet. Streaming their logs.')
			this.startStreaming()
		}, 15_000)
	}

	track(name: string, meta: TrackMeta, color: (s: string) => string): AppStatus {
		const status: AppStatus = {
			name,
			role: meta.role,
			port: meta.port,
			order: meta.order,
			readyOnUrl: meta.readyOnUrl ?? false,
			color,
			buffer: [],
			tail: '',
			dropped: 0,
			ready: false,
		}

		this.statuses.set(name, status)
		return status
	}

	drop(name: string): void {
		const status = this.statuses.get(name)

		if (!status) return
		if (!this.streaming) this.drain(status)

		this.statuses.delete(name)
		this.total--
		this.maybeSummarize()
	}

	chunk(status: AppStatus, data: Buffer, err: boolean): void {
		if (this.streaming) {
			for (const line of data.toString().split('\n')) {
				if (line.trim()) this.write(status, line, err)
			}
			return
		}

		const lines = (status.tail + data.toString()).split('\n')
		status.tail = lines.pop() ?? ''
		for (const line of lines) {
			if (line.trim()) this.line(status, line, err)
		}
		this.maybeSummarize()
	}

	private line(status: AppStatus, line: string, err: boolean): void {
		if (status.buffer.length >= BUFFER_CAP) {
			status.buffer.shift()
			status.dropped++
		}
		status.buffer.push({ line, err })

		const plain = line.replace(ANSI, '')
		const ready = plain.match(/VITE v([\d.]+)\s+ready in (\d+) ?ms/i)

		if (ready) {
			status.viteVersion = ready[1]!
			status.readyMs = ready[2]!
		}

		const local = plain.match(/Local:\s+(http\S+)/)

		if (local) status.url = local[1]!
		else if (status.readyOnUrl && status.url === undefined) {
			const any = plain.match(/https?:\/\/\S+/)

			if (any) status.url = any[0].replace(/[).,]+$/, '')
		}

		const versionSeen =
			this.mode === 'preview' || status.readyOnUrl || status.viteVersion !== undefined
		if (versionSeen && status.url !== undefined) status.ready = true
	}

	flushAll(lastName: string): void {
		if (this.streaming) return

		const ordered = [...this.statuses.values()].sort((a, b) =>
			a.name === lastName ? 1 : b.name === lastName ? -1 : 0
		)

		for (const status of ordered) this.drain(status)
	}

	private drain(status: AppStatus): void {
		if (status.dropped) {
			this.write(status, pc.dim(`(${status.dropped} earlier line(s) truncated)`), false)
		}

		for (const { line, err } of status.buffer) this.write(status, line, err)

		if (status.tail.trim()) this.write(status, status.tail, false)

		status.buffer = []
		status.tail = ''
		status.dropped = 0
	}

	dispose(): void {
		clearTimeout(this.timer)
		clearTimeout(this.pending)

		if (this.anchored) {
			const rows = process.stdout.rows ?? 0
			this.unanchor()

			process.stdout.write(`${rows ? `\x1b[${rows};1H` : ''}\n`)
		}
	}

	private unanchor(): void {
		if (!this.anchored) return
		this.anchored = false

		process.stdout.off('resize', this.onResize)
		process.stdout.write('\x1b[r')
	}

	private write(status: AppStatus, line: string, err: boolean): void {
		const stream = err ? process.stderr : process.stdout
		stream.write(`${status.color(`[${status.name}]`)} ${line}\n`)
	}

	private maybeSummarize(): void {
		if (this.streaming || this.pending || this.statuses.size < this.total) return
		if (![...this.statuses.values()].every(status => status.ready)) return

		// A short grace window catches the tail of vite's banner (the Network
		// line often lands in its own chunk right after Local).
		this.pending = setTimeout(() => {
			if (this.streaming) return

			clearTimeout(this.timer)

			this.printSummary()
			this.streaming = true

			for (const status of this.statuses.values()) {
				status.buffer = []
				status.tail = ''
			}
		}, 200)
	}

	private startStreaming(): void {
		if (this.streaming) return

		clearTimeout(this.timer)

		for (const status of this.statuses.values()) this.drain(status)

		this.streaming = true
	}

	private printSummary(): void {
		const ordered = [...this.statuses.values()].sort((a, b) => a.order - b.order)

		// One vite version across apps moves to the footer; a mix stays per row.
		// Tools like ladle report no version, so they never force the split.
		const versions = new Set(ordered.map(status => status.viteVersion).filter(Boolean))
		const sharedVite = versions.size === 1 ? [...versions][0] : undefined

		const cells = ordered.map(status => ({
			status,
			name: status.name,
			role: status.role,
			url: status.url ?? `http://localhost:${status.port}/`,
			meta: [
				sharedVite === undefined && status.viteVersion !== undefined
					? `vite ${status.viteVersion}`
					: undefined,
				status.readyMs === undefined
					? undefined
					: `${(Number(status.readyMs) / 1000).toFixed(1)}s`,
			]
				.filter(Boolean)
				.join(' · '),
		}))
		const width = {
			name: Math.max(...cells.map(cell => cell.name.length)),
			role: Math.max(...cells.map(cell => cell.role.length)),
			url: Math.max(...cells.map(cell => cell.url.length)),
			meta: Math.max(...cells.map(cell => cell.meta.length)),
		}

		type Cell = (typeof cells)[number]
		const segments = (cell: Cell): string[] => [
			`  ● ${cell.name.padEnd(width.name)}`,
			`  ${cell.role.padEnd(width.role)}`,
			`  ${cell.url.padEnd(width.url)}`,
			`  ${cell.meta.padEnd(width.meta)}  `,
		]
		const inner = segments(cells[0]!).join('').length
		const colored = (cell: Cell): string => {
			const [name, role, url, meta] = segments(cell)
			return `${cell.status.color(name!)}${pc.dim(role!)}${pc.cyan(url!)}${pc.dim(meta!)}`
		}

		const title = this.mode === 'dev' ? ' dev servers ready ' : ' preview servers ready '
		const fill = Math.max(inner - title.length - 1, 0)
		const footer = [
			sharedVite === undefined ? undefined : `vite ${sharedVite}`,
			this.mode === 'dev' ? 'watching for changes' : 'serving production builds',
			'press ctrl+c to stop',
		]
			.filter(Boolean)
			.join(' · ')

		this.panel = [
			`  ${pc.dim('╭─')}${pc.bold(title)}${pc.dim(`${'─'.repeat(fill)}╮`)}`,
			...cells.map(cell => `  ${pc.dim('│')}${colored(cell)}${pc.dim('│')}`),
			`  ${pc.dim(`╰${'─'.repeat(inner)}╯`)}`,
			`  ${pc.dim(footer)}`,
		]

		const fits =
			process.stdout.isTTY &&
			(process.stdout.columns ?? 0) >= inner + 4 &&
			(process.stdout.rows ?? 0) > this.panel.length + 4

		if (fits) {
			this.anchored = true
			process.stdout.on('resize', this.onResize)
			this.paint(true)
			return
		}

		log.plain('')
		for (const line of this.panel) log.plain(line)
		log.plain('')
	}

	/** Draws the panel at the top and confines scrolling to the rows below it. */
	private paint(initial = false): void {
		const rows = process.stdout.rows ?? 0
		const top = this.panel.length + 2

		if (!rows || rows <= top + 2) {
			this.unanchor()
			return
		}

		if (initial) {
			process.stdout.write(
				`\x1b[2J\x1b[H\n${this.panel.join('\n')}\n\x1b[${top};${rows}r\x1b[${top};1H`
			)

			return
		}

		const lines = this.panel.map(line => `${line}\x1b[K`).join('\n')
		process.stdout.write(`\x1b[r\x1b[H\n${lines}\n\x1b[${top};${rows}r\x1b[${rows};1H`)
	}
}
