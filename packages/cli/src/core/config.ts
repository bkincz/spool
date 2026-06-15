/*
 *   IMPORTS
 ***************************************************************************************************/
import { z } from 'zod'

/*
 *   SCHEMAS
 ***************************************************************************************************/
/** Manifest file name that marks a spool workspace root. */
export const MANIFEST_FILE = 'spool.json'

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

export const AppSchema = z.object({
	/** "host" mounts remotes; "remote" exposes modules. */
	type: AppType,
	/** Path to the app, relative to workspace root. */
	path: z.string(),
	/** Dev server port. */
	port: z.number().int().positive().max(65535),
	/** Remotes a host consumes (names referencing other apps). */
	remotes: z.array(z.string()).default([]),
	/** Modules a remote exposes: exposeKey -> source path. */
	exposes: z.record(z.string()).default({}),
})
export type AppConfig = z.infer<typeof AppSchema>

export const ManifestSchema = z.object({
	/** Org/workspace name; used for npm scope and federation naming. */
	name: NameSchema,
	/** Schema version for forward-compat migrations. */
	version: z.literal(1).default(1),
	packageManager: z.enum(['pnpm', 'npm', 'yarn']).default('pnpm'),
	bundler: z.enum(['vite', 'rspack']).default('vite'),
	/** Deps shared as singletons across federation boundary. */
	shared: z.array(z.string()).default(['react', 'react-dom']),
	/** App registry keyed by app name. */
	apps: z.record(NameSchema, AppSchema).default({}),
})
export type Manifest = z.infer<typeof ManifestSchema>

/*
 *   FACTORIES
 ***************************************************************************************************/
export function parseManifest(raw: unknown): Manifest {
	return ManifestSchema.parse(raw)
}

export function emptyManifest(name: string): Manifest {
	return ManifestSchema.parse({ name, apps: {} })
}

export function appPort(m: Manifest, name: string): number {
	const app = m.apps[name]
	if (!app) {
		throw new Error(`No app named "${name}" in this workspace. Check the names in spool.json.`)
	}
	return app.port
}
