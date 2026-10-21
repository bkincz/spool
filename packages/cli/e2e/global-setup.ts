/*
 *   IMPORTS
 ***************************************************************************************************/
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { killTree, runCaptured, spawnProcess } from '../src/util/exec.js'
import { waitForManifest } from '../src/util/net.js'
import { freshDir, removeDir } from '../src/__tests__/helpers.js'
import { PORTS, WORKSPACE_ENV, appOrigin } from './fixture.js'

const CLI_PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(CLI_PACKAGE, 'dist/index.js')

/*
 *   SCAFFOLD
 ***************************************************************************************************/
async function step(cmd: string, args: string[], cwd: string): Promise<void> {
	const { code, output } = await runCaptured(cmd, args, { cwd })
	if (code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${code}):\n${output}`)
}

interface FixtureManifest {
	apps: Record<string, { port: number; exposes: Record<string, string>; remotes: string[] }>
}

interface FixturePackage {
	devDependencies: Record<string, string>
}

function editJson<T>(file: string, edit: (json: T) => void): void {
	const json = JSON.parse(readFileSync(file, 'utf8')) as T
	edit(json)
	writeFileSync(file, `${JSON.stringify(json, null, '\t')}\n`)
}

// The host's own app file, which spool hands over to the user: a page per
// expose, one with two remotes from the same app side by side, and an app
// error boundary of its own. Both record what reaches them on window.
const SHELL_APP = `import { Component, type ReactNode } from 'react'
import { navigate, matchRoute, useLocation } from '@/navigation'
import { Remote, type RemoteName } from '@/federation'

const routes: Record<string, RemoteName | 'pair'> = {
	'/': 'staff',
	'/new': 'assessments/NewAssessment',
	'/pair': 'pair',
	'/broken': 'assessments/Broken',
	'/throws': 'assessments/Throws',
}

function record(log: string, value: unknown) {
	const logs = window as unknown as Record<string, unknown[] | undefined>
	;(logs[log] ??= []).push(value)
}

class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false }

	static getDerivedStateFromError() {
		return { failed: true }
	}

	componentDidCatch(thrown: unknown) {
		record('__appCaught', thrown)
	}

	render() {
		return this.state.failed ? <p data-testid="app-error">the app boundary caught it</p> : this.props.children
	}
}

export default function App() {
	const location = useLocation()
	const active = matchRoute(location.pathname, routes)
	const slots: RemoteName[] =
		active === 'pair' ? ['assessments', 'assessments/NewAssessment'] : active ? [active] : []
	return (
		<>
			<nav>
				{Object.entries(routes).map(([path, name]) => (
					<button key={path} onClick={() => navigate(path)}>
						{name}
					</button>
				))}
			</nav>
			<AppBoundary>
				<main>
					{slots.map(name => (
						<section key={name} data-testid={'slot:' + name}>
							<Remote name={name} onError={error => record('__remoteErrors', error)} />
						</section>
					))}
				</main>
			</AppBoundary>
		</>
	)
}
`

// Names spool generates the shell's RemoteName from. A misspelling has to fail to compile.
const SHELL_TYPOS = `import { Remote, preloadRemote, type RemoteName } from '@/federation'

export const known: RemoteName[] = ['staff', 'assessments/NewAssessment']
// @ts-expect-error not a remote
export const typo = <Remote name="admn" />
// @ts-expect-error not a remote
void preloadRemote('staf')
`

// Throw once loaded, while rendering: a broken remote, not one that failed to load.
const BROKEN = `export default function Broken(): never {
	const error = new Error('broken while rendering')
	Object.assign(window, { __brokenThrown: error })
	throw error
}
`

const THROWS = `export default function Throws(): never {
	const thrown = { reason: 'not an Error' }
	Object.assign(window, { __valueThrown: thrown })
	throw thrown
}
`

// staff as a nested host: it mounts one of assessments' exposes itself.
const STAFF_APP = `import { Remote } from '@/federation'

export default function App() {
	return (
		<div>
			<strong>staff</strong>: a remote module exposed via Module Federation.
			<aside data-testid="staff-badge">
				<Remote name="assessments/Badge" />
			</aside>
		</div>
	)
}
`

const NEW_ASSESSMENT = `export default function NewAssessment() {
	return <div data-testid="new-assessment">new assessment form</div>
}
`

const BADGE = `export default function Badge() {
	return <span data-testid="assessments-badge">3 due</span>
}
`

/** A shell plus two react remotes as spool generates them: assessments with extra exposes, staff mounting one of them. */
async function scaffold(root: string): Promise<string> {
	await step(
		process.execPath,
		[
			CLI,
			'create',
			'fx',
			'--name',
			'fx',
			'--host',
			'shell',
			'--remotes',
			'staff,assessments',
			'--framework',
			'react',
			'--pm',
			'pnpm',
			'--addons',
			'federation,navigation',
			'--no-install',
		],
		root
	)
	const dir = join(root, 'fx')

	editJson<FixtureManifest>(join(dir, 'spool.json'), manifest => {
		for (const [name, port] of Object.entries(PORTS)) manifest.apps[name]!.port = port
		manifest.apps.assessments!.exposes['./NewAssessment'] = './src/new-assessment.tsx'
		manifest.apps.assessments!.exposes['./Badge'] = './src/badge.tsx'
		manifest.apps.assessments!.exposes['./Broken'] = './src/broken.tsx'
		manifest.apps.assessments!.exposes['./Throws'] = './src/throws.tsx'
		manifest.apps.staff!.remotes = ['assessments']
	})
	// This checkout's CLI, not whatever version is on the registry.
	editJson<FixturePackage>(join(dir, 'package.json'), pkg => {
		pkg.devDependencies['@bkincz/spool'] = `link:${CLI_PACKAGE.replaceAll('\\', '/')}`
	})
	// The generated range takes the newest plugin, whose runtime is not the one
	// spool pins. 1.17.1 is the release built on that runtime.
	const plugin = process.env.SPOOL_E2E_MF_VITE
	if (plugin) {
		appendFileSync(
			join(dir, 'pnpm-workspace.yaml'),
			`overrides:\n    '@module-federation/vite': ${plugin}\n`
		)
	}
	writeFileSync(join(dir, 'apps/assessments/src/new-assessment.tsx'), NEW_ASSESSMENT)
	writeFileSync(join(dir, 'apps/assessments/src/badge.tsx'), BADGE)
	writeFileSync(join(dir, 'apps/assessments/src/broken.tsx'), BROKEN)
	writeFileSync(join(dir, 'apps/assessments/src/throws.tsx'), THROWS)
	writeFileSync(join(dir, 'apps/shell/src/app/app.tsx'), SHELL_APP)
	writeFileSync(join(dir, 'apps/shell/src/typos.tsx'), SHELL_TYPOS)
	writeFileSync(join(dir, 'apps/staff/src/app/app.tsx'), STAFF_APP)

	// Regenerates the hosts' registries and typings, and makes staff a host.
	await step(process.execPath, [CLI, 'upgrade'], dir)
	await step('pnpm', ['install'], dir)

	const installed = JSON.parse(
		readFileSync(
			join(dir, 'apps/shell/node_modules/@module-federation/vite/package.json'),
			'utf8'
		)
	) as { version: string }
	console.log(`fixture: @module-federation/vite ${installed.version}`)
	return dir
}

/** Vite discovers some deps on first request and reloads the page for them. Pay that here, not mid-test. */
async function warmUp(): Promise<void> {
	const browser = await chromium.launch()
	try {
		const page = await browser.newPage()
		for (const [path, ready] of [
			['/', 'main >> text=exposed via Module Federation'],
			['/new', '[data-testid="new-assessment"]'],
		] as const) {
			await page.goto(appOrigin('shell') + path)
			await page.locator(ready).waitFor({ timeout: 60_000 })
		}
	} finally {
		await browser.close()
	}
}

/*
 *   SETUP
 ***************************************************************************************************/
export default async function globalSetup(): Promise<() => Promise<void>> {
	if (!existsSync(CLI)) throw new Error(`build the CLI first: ${CLI} is missing`)

	const root = freshDir('spool-e2e-')
	const dir = await scaffold(root)
	process.env[WORKSPACE_ENV] = dir

	let output = ''
	const dev = spawnProcess(process.execPath, [CLI, 'dev'], { cwd: dir, stdio: 'pipe' })
	dev.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
	dev.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))

	const teardown = async (): Promise<void> => {
		await killTree(dev)
		removeDir(root)
	}

	try {
		await Promise.all(
			(['staff', 'assessments'] as const).map(app =>
				waitForManifest(`${appOrigin(app)}/mf-manifest.json`, { timeoutMs: 60_000 })
			)
		)
		await waitForManifest(appOrigin('shell'), { timeoutMs: 60_000 })
		await warmUp()
	} catch (error) {
		await teardown()
		throw new Error(`fixture dev servers did not come up: ${String(error)}\n${output}`, {
			cause: error,
		})
	}
	return teardown
}
