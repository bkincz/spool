/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { create } from '../../commands/create.js'
import { graph } from '../../commands/graph.js'
import { log } from '../../util/logger.js'
import { freshDir, removeDir } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
let dir: string
let cwd: string

beforeEach(async () => {
	dir = freshDir('spool-graph-')
	cwd = process.cwd()
	vi.spyOn(console, 'log').mockImplementation(() => {})
	await create(dir, {
		name: 'acme',
		pm: 'pnpm',
		host: 'shell',
		remotes: 'dashboard',
		install: false,
	})
	process.chdir(dir)
})

afterEach(() => {
	process.chdir(cwd)
	removeDir(dir)
	vi.restoreAllMocks()
})

const printed = (calls: unknown[][]): string => calls.map(call => String(call[0])).join('\n')

/*
 *   TEXT TREE
 ***************************************************************************************************/
describe('graph: text', () => {
	it('lists every app, what it consumes or exposes, and the shared list', async () => {
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})
		await graph()

		const output = printed(plain.mock.calls)
		expect(output).toContain('acme')
		expect(output).toContain('shell (host, react, port 5173)')
		expect(output).toContain('dashboard (remote, react, port 5174)')
		expect(output).toContain('consumes: dashboard')
		expect(output).toContain('exposes: ./App')
		expect(output).toContain('shared: react, react-dom')
	})
})

/*
 *   JSON
 ***************************************************************************************************/
describe('graph --json', () => {
	it('prints a structured graph matching the manifest', async () => {
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})
		await graph({ json: true })

		const data = JSON.parse(printed(plain.mock.calls)) as {
			name: string
			apps: { name: string; type: string; consumes: string[]; exposes: string[] }[]
			shared: string[]
		}

		expect(data.name).toBe('acme')
		expect(data.shared).toEqual(['react', 'react-dom'])
		const shell = data.apps.find(app => app.name === 'shell')
		expect(shell?.type).toBe('host')
		expect(shell?.consumes).toEqual(['dashboard'])
		const dashboard = data.apps.find(app => app.name === 'dashboard')
		expect(dashboard?.exposes).toEqual(['./App'])
	})
})

/*
 *   DOT
 ***************************************************************************************************/
describe('graph --dot', () => {
	it('emits a graphviz digraph with an edge for each consumed remote', async () => {
		const plain = vi.spyOn(log, 'plain').mockImplementation(() => {})
		await graph({ dot: true })

		const output = printed(plain.mock.calls)
		expect(output).toMatch(/^digraph spool \{/)
		expect(output).toContain('"shell" -> "dashboard";')
		expect(output).toContain('shape=box')
		expect(output).toContain('shape=ellipse')
	})
})
