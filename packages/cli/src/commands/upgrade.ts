/*
 *   IMPORTS
 ***************************************************************************************************/
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { requireWorkspace, type Workspace } from '../core/workspace.js'
import { PNPM_VERSION, TOOLCHAIN } from '../core/versions.js'
import { appFiles, helperFile, hostWiringFiles, NODE_RANGE } from '../core/generators.js'
import { formatFiles } from '../core/format.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface UpgradeOptions {
	dryRun?: boolean
}

/** react and react-dom are runtime deps; every other toolchain entry is dev. */
const RUNTIME_DEPS = new Set(['react', 'react-dom'])

/*
 *   UPGRADE
 ***************************************************************************************************/
export async function upgrade(opts: UpgradeOptions): Promise<void> {
	const ws = await requireWorkspace()
	const writer = new ChangeWriter(opts.dryRun ?? false)

	await upgradeRoot(ws, writer)
	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const dir = join(ws.root, app.path)
		if (!existsSync(dir)) {
			log.warn(`${name}: folder "${app.path}" is missing, skipping. Run \`spool doctor\`.`)
			continue
		}

		const generated = await formatFiles(appFiles(ws.manifest, name, app))
		await writer.replace(dir, 'vite.config.ts', generated['vite.config.ts']!, name)
		if (app.type === 'remote') {
			await writer.add(dir, 'public/_headers', generated['public/_headers']!, name)
		}
		const typings = await formatFiles(hostWiringFiles(app))
		for (const [rel, content] of Object.entries(typings)) {
			await writer.replace(dir, rel, content, name)
		}

		await upgradeAppPackage(ws, name, dir, writer)
	}

	writer.summarize(ws)
}

async function upgradeRoot(ws: Workspace, writer: ChangeWriter): Promise<void> {
	const helper = await formatFiles(helperFile())
	for (const [rel, content] of Object.entries(helper)) {
		await writer.replace(ws.root, rel, content, 'workspace')
	}

	const rootConfigs = await formatFiles({
		'tsconfig.json': `${JSON.stringify({ extends: './tsconfig.base.json', include: ['spool.vite.ts'] }, null, 2)}\n`,
		'.prettierignore': `pnpm-lock.yaml\npackage-lock.json\nyarn.lock\n.yarn/\n`,
	})
	for (const [rel, content] of Object.entries(rootConfigs)) {
		await writer.add(ws.root, rel, content, 'workspace')
	}

	await writer.editJson(ws.root, 'package.json', 'workspace', pkg => {
		const changes: string[] = []
		if (pkg.engines?.node !== NODE_RANGE) {
			pkg.engines = { ...pkg.engines, node: NODE_RANGE }
			changes.push(`engines.node -> ${NODE_RANGE}`)
		}
		if (
			ws.manifest.packageManager === 'pnpm' &&
			pkg.packageManager !== `pnpm@${PNPM_VERSION}`
		) {
			pkg.packageManager = `pnpm@${PNPM_VERSION}`
			changes.push(`packageManager -> pnpm@${PNPM_VERSION}`)
		}
		pkg.devDependencies ??= {}
		for (const dep of ['typescript', '@types/node'] as const) {
			if (pkg.devDependencies[dep] !== TOOLCHAIN[dep]) {
				changes.push(`${dep} ${pkg.devDependencies[dep] ?? 'added'} -> ${TOOLCHAIN[dep]}`)
				pkg.devDependencies[dep] = TOOLCHAIN[dep]
			}
		}
		return changes
	})
}

async function upgradeAppPackage(
	ws: Workspace,
	name: string,
	dir: string,
	writer: ChangeWriter
): Promise<void> {
	await writer.editJson(dir, 'package.json', name, pkg => {
		const changes: string[] = []
		pkg.dependencies ??= {}
		pkg.devDependencies ??= {}

		for (const [dep, range] of Object.entries(TOOLCHAIN)) {
			const home =
				pkg.dependencies[dep] !== undefined
					? pkg.dependencies
					: pkg.devDependencies[dep] !== undefined
						? pkg.devDependencies
						: RUNTIME_DEPS.has(dep)
							? pkg.dependencies
							: pkg.devDependencies
			if (home[dep] !== range) {
				changes.push(`${dep} ${home[dep] ?? 'added'} -> ${range}`)
				home[dep] = range
			}
		}

		if (pkg.engines?.node !== NODE_RANGE) {
			pkg.engines = { ...pkg.engines, node: NODE_RANGE }
			changes.push(`engines.node -> ${NODE_RANGE}`)
		}
		return changes
	})
}

/*
 *   CHANGE WRITER
 ***************************************************************************************************/
interface PackageJsonShape {
	engines?: Record<string, string>
	packageManager?: string
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	[key: string]: unknown
}

/** Writes only real differences, so a second upgrade run reports nothing. */
class ChangeWriter {
	public changed = 0

	constructor(private readonly dryRun: boolean) {}

	private get verb(): string {
		return this.dryRun ? 'would update' : 'updated'
	}

	async replace(dir: string, rel: string, content: string, label: string): Promise<void> {
		const target = join(dir, rel)
		const existing = existsSync(target) ? await readFile(target, 'utf8') : null
		if (existing === content) return

		this.changed++
		log.step(`${label}: ${this.verb} ${rel}`)
		if (!this.dryRun) {
			await mkdir(dirname(target), { recursive: true })
			await writeFile(target, content, 'utf8')
		}
	}

	async add(dir: string, rel: string, content: string, label: string): Promise<void> {
		if (existsSync(join(dir, rel))) return
		this.changed++
		log.step(`${label}: ${this.dryRun ? 'would add' : 'added'} ${rel}`)
		if (!this.dryRun) {
			await mkdir(dirname(join(dir, rel)), { recursive: true })
			await writeFile(join(dir, rel), content, 'utf8')
		}
	}

	async editJson(
		dir: string,
		rel: string,
		label: string,
		edit: (pkg: PackageJsonShape) => string[]
	): Promise<void> {
		const target = join(dir, rel)
		if (!existsSync(target)) return

		const pkg = JSON.parse(await readFile(target, 'utf8')) as PackageJsonShape
		const changes = edit(pkg)
		if (!changes.length) return

		this.changed++
		log.step(`${label}: ${this.verb} ${rel} (${changes.join(', ')})`)
		if (!this.dryRun) {
			const formatted = await formatFiles({ [rel]: `${JSON.stringify(pkg)}\n` })
			await writeFile(target, formatted[rel]!, 'utf8')
		}
	}

	summarize(ws: Workspace): void {
		if (!this.changed) {
			log.success('already up to date')
			return
		}
		if (this.dryRun) {
			log.success(`${this.changed} change(s) pending. Rerun without --dry-run to apply.`)
			return
		}
		log.success(`upgraded ${this.changed} file(s)`)
		log.step(
			`Review the changes with git, run \`${ws.manifest.packageManager} install\`, then \`spool doctor\`.`
		)
	}
}
