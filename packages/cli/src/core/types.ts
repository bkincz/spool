/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, sep } from 'node:path'
import type { AppConfig, Manifest } from './config.js'
import { run } from '../util/exec.js'
import { log } from '../util/logger.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface TypesResult {
	/** Apps whose declarations are on disk, with or without type errors along the way. */
	built: string[]
	/** Apps tsc could not produce declarations for. */
	failed: string[]
	/** True when the workspace has no typescript installed; nothing ran. */
	skipped: boolean
}

/*
 *   PATHS
 ***************************************************************************************************/
/** Where `spool types` writes one app's declaration output, relative to the workspace root. */
export function typesOutDir(appName: string): string {
	return join('.spool', 'types', appName)
}

// tsc mirrors sources under outDir from the workspace root, so the app folder is part of the path.
export function exposeDeclarationPath(
	root: string,
	appName: string,
	appPath: string,
	exposeSource: string
): string {
	const withoutExt = exposeSource.replace(/^\.\//, '').replace(/\.[^./]+$/, '')
	return join(root, typesOutDir(appName), appPath, `${withoutExt}.d.ts`)
}

/** Apps that expose at least one module, keyed by name. */
function exposingApps(m: Manifest): [string, AppConfig][] {
	return Object.entries(m.apps).filter(([, app]) => Object.keys(app.exposes).length > 0)
}

/*
 *   RUNNER
 ***************************************************************************************************/
/** Resolves tsc from the workspace's own node_modules. Returns undefined if it isn't installed. */
function resolveTsc(root: string): string | undefined {
	const requireFromRoot = createRequire(join(root, 'package.json'))
	try {
		return requireFromRoot.resolve('typescript/bin/tsc')
	} catch {
		return undefined
	}
}

// tsc include patterns want forward slashes, on Windows too.
const pattern = (path: string): string => path.split(sep).join('/')

// Ambient .d.ts files the app relies on (css modules, vite/client), from its own tsconfig include.
function ambientDeclarations(appDir: string): string[] {
	const declarations = [join(appDir, 'src/**/*.d.ts')]

	try {
		const config = JSON.parse(readFileSync(join(appDir, 'tsconfig.json'), 'utf8')) as {
			include?: string[]
		}
		for (const entry of config.include ?? []) {
			if (entry.endsWith('.d.ts')) declarations.push(join(appDir, entry))
		}
	} catch {
		// A tsconfig tsc itself cannot parse will be reported by tsc.
	}

	return declarations.map(pattern)
}

const countErrors = (output: string): number => output.match(/error TS\d+/g)?.length ?? 0

// A throwaway tsconfig extending the app's own, narrowed to the expose entries.
// rootDir is the workspace root so workspace packages the entries import fit under it.
async function writeProbeConfig(
	root: string,
	appDir: string,
	entries: string[],
	outDir: string
): Promise<string> {
	const probePath = join(outDir, 'tsconfig.json')
	await writeFile(
		probePath,
		JSON.stringify(
			{
				extends: join(appDir, 'tsconfig.json'),
				compilerOptions: {
					noEmit: false,
					declaration: true,
					emitDeclarationOnly: true,
					rootDir: root,
					outDir,
				},
				include: [...entries.map(pattern), ...ambientDeclarations(appDir)],
			},
			null,
			2
		),
		'utf8'
	)
	return probePath
}

const declarationsWritten = (root: string, name: string, app: AppConfig): boolean =>
	Object.values(app.exposes).every(source =>
		existsSync(exposeDeclarationPath(root, name, app.path, source))
	)

/**
 * Runs the workspace's TypeScript against each remote's expose entries and
 * writes the .d.ts output to .spool/types/<app>, which `remoteTypings` reads
 * to type <Remote> from the real export. Safe to run every time; a missing
 * typescript install is skipped, never fatal.
 */
export async function emitRemoteTypes(
	root: string,
	m: Manifest,
	only?: string[]
): Promise<TypesResult> {
	const tsc = resolveTsc(root)
	if (!tsc) return { built: [], failed: [], skipped: true }

	const apps = exposingApps(m).filter(([name]) => !only || only.includes(name))
	const built: string[] = []
	const failed: string[] = []

	for (const [name, app] of apps) {
		const appDir = join(root, app.path)
		if (!existsSync(join(appDir, 'tsconfig.json'))) continue

		const outDir = join(root, typesOutDir(name))
		await rm(outDir, { recursive: true, force: true })
		await mkdir(outDir, { recursive: true })

		const entries = [...new Set(Object.values(app.exposes))].map(entry => join(appDir, entry))
		const probe = await writeProbeConfig(root, appDir, entries, outDir)

		try {
			await run(process.execPath, [tsc, '--project', probe], { cwd: appDir })
			built.push(name)
		} catch (cause) {
			const output = cause instanceof Error ? cause.message : String(cause)
			
			// tsc still emits declarations past type errors, so they are usable when present.
			if (declarationsWritten(root, name, app)) {
				built.push(name)
				log.warn(
					`spool types: ${name} typed with ${countErrors(output)} type error(s). Run tsc in ${app.path} to see them.`
				)
			} else {
				failed.push(name)
				log.warn(
					`spool types: ${name} could not be typed; <Remote> keeps the generic typing.`
				)
				log.warn(output)
			}
		}
	}

	return { built, failed, skipped: false }
}
