/*
 *   IMPORTS
 ***************************************************************************************************/
import { z } from 'zod'
import { CliError } from '../util/errors.js'

/*
 *   SCHEMAS
 ***************************************************************************************************/
/** Manifest file name that marks a spool workspace root. */
export const MANIFEST_FILE = 'spool.json'

/** Runtime helper at the workspace root; every app's vite config imports it. */
export const HELPER_FILE = 'spool.vite.ts'

/** Manifest schema version this CLI understands. */
export const MANIFEST_VERSION = 1

/**
 * Workspace and app names become folder names, npm package names, federation
 * container names and (via PascalCase) React component identifiers. Restrict
 * them to a safe, portable subset: lowercase, starts with a letter, single
 * hyphens between segments. This also blocks path traversal (`..`, slashes).
 */
export const NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const NameSchema = z.string().regex(NAME_PATTERN)

/** Returns an error message if `value` is not a valid name, else undefined. */
export function validateName(value: string, label = 'name'): string | undefined {
	const trimmed = value.trim()
	if (!trimmed) return `Please enter a ${label}.`
	if (!NAME_PATTERN.test(trimmed)) {
		return `Invalid ${label} "${value}". Use lowercase letters, digits and single hyphens, starting with a letter (e.g. "dashboard").`
	}
	return undefined
}

export const AppType = z.enum(['host', 'remote'])
export type AppType = z.infer<typeof AppType>

export const Framework = z.enum(['react', 'svelte', 'vue'])
export type Framework = z.infer<typeof Framework>

/** Framework scaffolded when nothing picks one explicitly. */
export const DEFAULT_FRAMEWORK: Framework = 'react'

/** Returns an error message if `value` is not a known framework, else undefined. */
export function validateFramework(value: string): string | undefined {
	if (Framework.safeParse(value).success) return undefined
	return `Unknown framework "${value}". Use ${Framework.options.join(' or ')}.`
}

/** Parses a framework name, aborting with a friendly message for unknown values. */
export function parseFramework(value: string): Framework {
	const error = validateFramework(value)
	if (error) throw new CliError(error)
	return Framework.parse(value)
}

// Strict schemas: spool.json is hand-edited, so typos must fail loudly
// instead of being silently dropped.
export const AppSchema = z
	.object({
		/** "host" mounts remotes; "remote" exposes modules. */
		type: AppType,
		/** UI framework the app is scaffolded and regenerated for. */
		framework: Framework.default(DEFAULT_FRAMEWORK),
		/** Path to the app, relative to workspace root. */
		path: z.string(),
		/** Dev server port. */
		port: z.number().int().positive().max(65535),
		/** Deployed manifest URL of a remote, used by host production builds. */
		url: z.string().url().optional(),
		/** Per-environment manifest URLs; `--env <name>` on build selects one. */
		urls: z.record(z.string().url()).optional(),
		/** Shell command `spool deploy` runs in the app folder. */
		deploy: z.string().optional(),
		/** Remotes a host consumes (names referencing other apps). */
		remotes: z.array(z.string()).default([]),
		/** Modules a remote exposes: exposeKey -> source path. */
		exposes: z.record(z.string()).default({}),
	})
	.strict()
export type AppConfig = z.infer<typeof AppSchema>

export const ManifestSchema = z
	.object({
		/** Org/workspace name; used for npm scope and federation naming. */
		name: NameSchema,
		/** Schema version for forward-compat migrations. */
		version: z.literal(MANIFEST_VERSION).default(MANIFEST_VERSION),
		packageManager: z.enum(['pnpm', 'npm', 'yarn']).default('pnpm'),
		bundler: z.enum(['vite']).default('vite'),
		/** Deps shared as singletons across federation boundary. */
		shared: z.array(z.string()).default(['react', 'react-dom']),
		/** App registry keyed by app name. */
		apps: z.record(NameSchema, AppSchema).default({}),
	})
	.strict()
export type Manifest = z.infer<typeof ManifestSchema>

/*
 *   FACTORIES
 ***************************************************************************************************/
export function parseManifest(raw: unknown): Manifest {
	// Newer manifest versions get a clear upgrade message, not a schema error.
	if (raw !== null && typeof raw === 'object' && 'version' in raw) {
		const v = (raw as { version: unknown }).version
		if (v !== undefined && v !== MANIFEST_VERSION) {
			throw new CliError(
				`This workspace uses spool.json version ${String(v)}, but this CLI only understands version ${MANIFEST_VERSION}. Upgrade spool and try again.`
			)
		}
	}
	if (
		raw !== null &&
		typeof raw === 'object' &&
		'bundler' in raw &&
		(raw as { bundler: unknown }).bundler === 'rspack'
	) {
		throw new CliError(
			'spool.json sets bundler "rspack", which is not supported yet. Run `spool upgrade` to remove the field, or set it to "vite".'
		)
	}

	const result = ManifestSchema.safeParse(raw)
	if (!result.success) {
		const details = result.error.issues
			.map(issue => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
			.join('\n')
		throw new CliError(`Invalid ${MANIFEST_FILE}:\n${details}`)
	}
	return result.data
}

export function emptyManifest(name: string): Manifest {
	return parseManifest({ name, apps: {} })
}

export function appPort(m: Manifest, name: string): number {
	const app = m.apps[name]
	if (!app) {
		throw new CliError(
			`No app named "${name}" in this workspace. Check the names in spool.json.`
		)
	}
	return app.port
}
