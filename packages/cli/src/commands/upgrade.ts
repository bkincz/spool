/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findWorkspaceRoot, type Workspace } from '../core/workspace.js'
import { MANIFEST_FILE, WORKSPACE_FILE, parseManifest } from '../core/config.js'
import { appDependencies, NODE_RANGE, PNPM_VERSION, rootDevDependencies } from '../core/versions.js'
import {
	appConfigFiles,
	hostWiringFiles,
	workspaceScripts,
	workspaceFiles,
} from '../core/generators.js'
import { dependencyHome, editJsonFile, type PackageJsonShape } from '../core/packages.js'
import { Provenance } from '../core/provenance.js'
import { resolveRanges, type RangeInfo } from '../core/ranges.js'
import { helperFiles } from '../core/templates/helpers.js'
import { sentryFiles } from '../core/templates/sentry.js'
import { OwnedWriter } from '../core/fswrite.js'
import { formatFiles } from '../core/format.js'
import { CliError } from '../util/errors.js'
import { log } from '../util/logger.js'
import { isLocalOverride, isUpgrade } from '../util/semver.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface UpgradeOptions {
	dryRun?: boolean
	pin?: boolean
	/** true forces every file; a list of paths forces only those. */
	force?: boolean | string[]
}

interface UpgradeContext {
	ws: Workspace
	writer: ChangeWriter
	/** Use spool's own ranges verbatim instead of what the workspace asks for. */
	pin: boolean
	ranges: Map<string, RangeInfo>
}

const shouldSet = (from: string | undefined, to: string, pin: boolean): boolean =>
	isLocalOverride(from) ? false : pin ? from !== to : isUpgrade(from, to)

const PLAIN_PNPM = /^pnpm@(\d+\.\d+\.\d+)$/

const targetRange = (ctx: UpgradeContext, dep: string, ours: string): string =>
	ctx.pin ? ours : (ctx.ranges.get(dep)?.target ?? ours)

/*
 *   GITIGNORE
 ***************************************************************************************************/
const IGNORED_BY_SPOOL = ['.spool/types/', '.spool/*.pid']

async function ensureGitignore(root: string, dryRun: boolean): Promise<boolean> {
	const target = join(root, '.gitignore')
	if (!existsSync(target)) return false

	const current = await readFile(target, 'utf8')
	const present = new Set(current.split(/\r?\n/).map(line => line.trim()))
	const missing = IGNORED_BY_SPOOL.filter(line => !present.has(line))
	if (!missing.length) return false

	log.step(`workspace: ${dryRun ? 'would add' : 'added'} ${missing.join(', ')} to .gitignore`)
	if (!dryRun) {
		const separator = current === '' || current.endsWith('\n') ? '' : '\n'
		await writeFile(target, `${current}${separator}${missing.join('\n')}\n`, 'utf8')
	}
	return true
}

/*
 *   UPGRADE
 ***************************************************************************************************/
export async function upgrade(opts: UpgradeOptions): Promise<void> {
	const root = findWorkspaceRoot()
	const provenance = root === null ? null : Provenance.load(root)
	const writer = new ChangeWriter(
		root ?? process.cwd(),
		opts.dryRun ?? false,
		provenance,
		opts.force ?? false
	)
	const ws = await loadForUpgrade(writer, provenance)
	const ctx: UpgradeContext = { ws, writer, pin: opts.pin ?? false, ranges: resolveRanges(ws) }

	await upgradeRoot(ctx)
	if (await ensureGitignore(ws.root, opts.dryRun ?? false)) writer.changed++

	const sentry = ws.manifest.addons.includes('sentry')
	const envExamples = sentry ? sentryFiles(ws.manifest) : {}

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		const dir = join(ws.root, app.path)

		if (!existsSync(dir)) {
			log.warn(`${name}: folder "${app.path}" is missing, skipping. Run \`spool doctor\`.`)
			continue
		}

		const generated = await formatFiles(appConfigFiles(name, app, sentry), ws.root)

		await writer.replaceGenerated(dir, 'vite.config.ts', generated['vite.config.ts']!, name)
		await writer.replaceGenerated(dir, 'public/_headers', generated['public/_headers']!, name)

		const envExample = envExamples[`${app.path}/.env.example`]
		if (envExample !== undefined) await writer.add(dir, '.env.example', envExample, name)

		const typings = await formatFiles(hostWiringFiles(ws.manifest, app, ws.root), ws.root)
		for (const [rel, content] of Object.entries(typings)) {
			await writer.replaceGenerated(dir, rel, content, name)
		}

		await upgradeAppPackage(ctx, name, dir)
	}

	if (!opts.dryRun) {
		provenance?.pruneMissing(ws.root)
		await provenance?.save()
	}
	noteNewCapabilities(writer)
	writer.summarize(ws)
}

async function loadForUpgrade(
	writer: ChangeWriter,
	provenance: Provenance | null
): Promise<Workspace> {
	const root = findWorkspaceRoot()
	if (!root) {
		throw new CliError(
			`No ${MANIFEST_FILE} found. Run \`spool create\` first, or cd into a spool workspace.`
		)
	}

	let raw: unknown
	await writer.editJson(root, MANIFEST_FILE, 'workspace', manifest => {
		raw = manifest
		const changes: string[] = []

		if (manifest.bundler === 'rspack') {
			delete manifest.bundler
			changes.push('removed unsupported bundler "rspack"')
		}

		const addons = manifest.addons
		if (Array.isArray(addons) && addons.includes('shell')) {
			const kept = addons.filter(name => name !== 'shell')

			if (!kept.includes('navigation')) kept.push('navigation')
			if (!kept.includes('federation')) kept.push('federation')

			manifest.addons = kept
			changes.push('split addon "shell" into "navigation" and "federation"')

			for (const app of Object.values(manifest.apps as Record<string, { path?: unknown }>)) {
				if (typeof app.path !== 'string') continue
				const dir = join(root, app.path)
				provenance?.rename(dir, 'src/shell/remote.tsx', 'src/federation/remote.tsx')
				provenance?.rename(dir, 'src/shell/Remote.svelte', 'src/federation/Remote.svelte')
				provenance?.rename(dir, 'src/shell/Remote.vue', 'src/federation/Remote.vue')
				provenance?.rename(dir, 'src/shell/remotes.ts', 'src/federation/remotes.ts')
				provenance?.rename(dir, 'src/shell/index.ts', 'src/federation/index.ts')
				provenance?.rename(dir, 'src/shell/history.ts', 'src/navigation/history.ts')
			}
		}

		return changes
	})

	return { root, manifestPath: join(root, MANIFEST_FILE), manifest: parseManifest(raw), raw }
}

async function upgradeRoot(ctx: UpgradeContext): Promise<void> {
	const { ws, writer, pin } = ctx
	const helper = await formatFiles(helperFiles(), ws.root)

	for (const [rel, content] of Object.entries(helper)) {
		await writer.replaceGenerated(ws.root, rel, content, 'workspace')
	}

	const rootFiles = workspaceFiles(ws.manifest)
	const rootConfigs = await formatFiles(
		{
			'tsconfig.json': rootFiles['tsconfig.json']!,
			'.prettierignore': rootFiles['.prettierignore']!,
			'.gitattributes': rootFiles['.gitattributes']!,
		},
		ws.root
	)

	for (const [rel, content] of Object.entries(rootConfigs)) {
		await writer.add(ws.root, rel, content, 'workspace')
	}

	await writer.editJson(ws.root, 'package.json', 'workspace', pkg => {
		const changes: string[] = []
		if (shouldSet(pkg.engines?.node, NODE_RANGE, pin)) {
			pkg.engines = { ...pkg.engines, node: NODE_RANGE }
			changes.push(`engines.node -> ${NODE_RANGE}`)
		}

		pkg.scripts ??= {}
		for (const [script, command] of Object.entries(workspaceScripts(ws.manifest))) {
			if (pkg.scripts[script] === undefined) {
				pkg.scripts[script] = command
				changes.push(`scripts.${script} added`)
			}
		}

		const pinned = pkg.packageManager
		const movable = pinned === undefined || PLAIN_PNPM.test(pinned)

		if (
			ws.manifest.packageManager === 'pnpm' &&
			movable &&
			shouldSet(PLAIN_PNPM.exec(pinned ?? '')?.[1], PNPM_VERSION, pin)
		) {
			pkg.packageManager = `pnpm@${PNPM_VERSION}`
			changes.push(`packageManager -> pnpm@${PNPM_VERSION}`)
		}

		pkg.devDependencies ??= {}
		const expected = rootDevDependencies(ws.manifest)
		for (const [dep, ours] of Object.entries(expected)) {
			const range = targetRange(ctx, dep, ours)
			const current = pkg.devDependencies[dep]

			if (shouldSet(current, range, pin)) {
				changes.push(`${dep} ${current ?? 'added'} -> ${range}`)
				pkg.devDependencies[dep] = range
			} else if (current !== range && !isLocalOverride(current)) writer.noteKept()
		}

		return changes
	})
}

async function upgradeAppPackage(ctx: UpgradeContext, name: string, dir: string): Promise<void> {
	const { ws, writer, pin } = ctx
	const app = ws.manifest.apps[name]!
	const expected = appDependencies(ws.manifest, app)

	await writer.editJson(dir, 'package.json', name, pkg => {
		const changes: string[] = []
		pkg.dependencies ??= {}
		pkg.devDependencies ??= {}

		for (const [section, expectedDeps] of [
			['dependencies', expected.dependencies],
			['devDependencies', expected.devDependencies],
		] as const) {
			for (const [dep, ours] of Object.entries(expectedDeps)) {
				const range = targetRange(ctx, dep, ours)
				const home = dependencyHome(pkg, dep, section)

				if (shouldSet(home[dep], range, pin)) {
					changes.push(`${dep} ${home[dep] ?? 'added'} -> ${range}`)
					home[dep] = range
				} else if (home[dep] !== range && !isLocalOverride(home[dep])) writer.noteKept()
			}
		}

		if (shouldSet(pkg.engines?.node, NODE_RANGE, pin)) {
			pkg.engines = { ...pkg.engines, node: NODE_RANGE }
			changes.push(`engines.node -> ${NODE_RANGE}`)
		}

		return changes
	})
}

function noteNewCapabilities(writer: ChangeWriter): void {
	if (!writer.added.has(WORKSPACE_FILE)) return

	log.step(
		`${WORKSPACE_FILE} is new: import { apps, hosts, remotes, srcDirs } from it for anything that has to cover every app.`
	)
}

/*
 *   CHANGE WRITER
 ***************************************************************************************************/
class ChangeWriter extends OwnedWriter {
	private kept = 0

	async editJson(
		dir: string,
		rel: string,
		label: string,
		edit: (pkg: PackageJsonShape) => string[]
	): Promise<void> {
		const changes = await editJsonFile(join(dir, rel), edit, {
			write: !this.dryRun,
			root: this.root,
		})
		if (!changes.length) return

		this.changed++
		log.step(`${label}: ${this.verb} ${rel} (${changes.join(', ')})`)
	}

	noteKept(): void {
		this.kept++
	}

	summarize(ws: Workspace): void {
		if (this.skippedCount) {
			log.step(
				`left ${this.skippedCount} file(s) alone. Rerun with --force to overwrite them.`
			)
		}

		if (this.kept) {
			log.step(
				`left ${this.kept} dependency range(s) alone; spool cannot compare them to what it would write. Rerun with --pin to overwrite them.`
			)
		}

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
