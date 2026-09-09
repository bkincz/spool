/*
 *   IMPORTS
 ***************************************************************************************************/
import { z } from 'zod'
import { CliError } from '../util/errors.js'
import { log } from '../util/logger.js'

/*
 *   SCHEMAS
 ***************************************************************************************************/
/** Manifest file name that marks a spool workspace root. */
export const MANIFEST_FILE = 'spool.json'

/** Runtime helper at the workspace root; every app's vite config imports it. */
export const HELPER_FILE = 'spool.vite.ts'

/** Reads the manifest for user code: tests, scripts, anything wanting the app list. */
export const WORKSPACE_FILE = 'spool.workspace.ts'

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

export const ADDON_NAME_VALUES = [
	'ladle',
	'playwright',
	'lint',
	'test',
	'turbo',
	'state',
	'sentry',
	'navigation',
	'federation',
] as const
const AddonNameSchema = z.enum(ADDON_NAME_VALUES)
export type AddonName = z.infer<typeof AddonNameSchema>

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
		url: z.url().optional(),
		/** Per-environment manifest URLs; `--env <name>` on build selects one. */
		urls: z.record(z.string(), z.url()).optional(),
		/** Shell command `spool deploy` runs in the app folder. */
		deploy: z.string().optional(),
		/** Remotes this app mounts. A remote can consume remotes too. */
		remotes: z.array(z.string()).default([]),
		/** Modules a remote exposes: exposeKey -> source path. */
		exposes: z.record(z.string(), z.string()).default({}),
		/** Extra response headers this app's dev server and generated public/_headers send. */
		headers: z.record(z.string(), z.string()).optional(),
		/** Origins allowed to iframe this app; becomes a frame-ancestors CSP directive. `edge` alone leaves the header to an edge layer. */
		frameAncestors: z
			.array(z.string())
			.refine(list => !list.includes('edge') || list.length === 1, {
				message:
					'frameAncestors "edge" stands alone; the edge sets the header, so list nothing else',
			})
			.optional(),
	})
	.strict()
export type AppConfig = z.infer<typeof AppSchema>

const ProxyEntry = z
	.object({
		target: z.string(),
		changeOrigin: z.boolean().optional(),
		secure: z.boolean().optional(),
		ws: z.boolean().optional(),
	})
	.strict()

export const ServerSchema = z
	.object({
		proxy: z.record(z.string(), z.union([z.string(), ProxyEntry])).optional(),
		headers: z.record(z.string(), z.string()).optional(),
		host: z.union([z.boolean(), z.string()]).optional(),
		cors: z.boolean().optional(),
	})
	.strict()

export type ServerConfig = z.infer<typeof ServerSchema>

const BaseManifestSchema = z
	.object({
		/** Org/workspace name; used for npm scope and federation naming. */
		name: NameSchema,
		/** Schema version for forward-compat migrations. */
		version: z.literal(MANIFEST_VERSION).default(MANIFEST_VERSION),
		packageManager: z.enum(['pnpm', 'npm', 'yarn']).default('pnpm'),
		bundler: z.enum(['vite']).default('vite'),
		/** Deps shared as singletons across federation boundary. */
		shared: z.array(z.string()).default(['react', 'react-dom']),
		/** When the runtime resolves shared versions. See the helper for why this defaults away from upstream. */
		shareStrategy: z.enum(['version-first', 'loaded-first']).default('loaded-first'),
		/** Dev server settings shared by every app, e.g. a backend proxy. */
		server: ServerSchema.optional(),
		/** Enabled addons whose wiring isn't captured elsewhere in the manifest. */
		addons: z.array(AddonNameSchema).default([]),
		/** App registry keyed by app name. */
		apps: z.record(NameSchema, AppSchema).default({}),
		/** Generates src/federation/overrides.ts, letting a host swap a remote's url at runtime without a rebuild. */
		overrides: z.boolean().default(false),
	})
	.strict()

export const ManifestSchema = BaseManifestSchema.superRefine((manifest, ctx) => {
	for (const [name, app] of Object.entries(manifest.apps)) {
		validateAppPath(name, app.path, ctx)
		validateExposes(name, app, ctx)
	}
	validateRemotes(manifest, ctx)
})
export type Manifest = z.infer<typeof ManifestSchema>

/*
 *   CROSS-FIELD VALIDATION
 ***************************************************************************************************/
function isConfinedPath(value: string): boolean {
	if (!value || value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) return false
	return !value.split(/[\\/]/).some(segment => segment === '..')
}

function validateAppPath(name: string, path: string, ctx: z.RefinementCtx): void {
	if (isConfinedPath(path) && !path.endsWith('/')) return

	ctx.addIssue({
		code: 'custom',
		path: ['apps', name, 'path'],
		message: `App "${name}" has an invalid path "${path}". Use a relative path inside the workspace, with no ".." segments and no trailing slash.`,
	})
}

function validateExposes(name: string, app: AppConfig, ctx: z.RefinementCtx): void {
	for (const [key, source] of Object.entries(app.exposes)) {
		if (!key.startsWith('./')) {
			ctx.addIssue({
				code: 'custom',
				path: ['apps', name, 'exposes', key],
				message: `App "${name}" exposes key "${key}", which must start with "./".`,
			})
		}

		if (!isConfinedPath(source)) {
			ctx.addIssue({
				code: 'custom',
				path: ['apps', name, 'exposes', key],
				message: `App "${name}" exposes "${key}" from "${source}", which must stay inside "${app.path}".`,
			})
		}
	}
}

function validateRemotes(manifest: Manifest, ctx: z.RefinementCtx): void {
	for (const [name, app] of Object.entries(manifest.apps)) {
		const seen = new Set<string>()

		app.remotes.forEach((remote, index) => {
			const path = ['apps', name, 'remotes', index]

			if (remote === name) {
				ctx.addIssue({
					code: 'custom',
					path,
					message: `App "${name}" lists itself as a remote.`,
				})
				return
			}
			if (seen.has(remote)) {
				ctx.addIssue({
					code: 'custom',
					path,
					message: `App "${name}" lists remote "${remote}" more than once.`,
				})
				return
			}
			seen.add(remote)

			if (!manifest.apps[remote]) {
				ctx.addIssue({
					code: 'custom',
					path,
					message: `App "${name}" lists remote "${remote}", which is not in this workspace.`,
				})
			}
		})
	}

	const cycle = findRemoteCycle(manifest)
	if (cycle) {
		ctx.addIssue({
			code: 'custom',
			path: ['apps'],
			message: `Remotes form a cycle: ${cycle.join(' -> ')}.`,
		})
	}
}

/** Depth-first search for a cycle in the remotes graph; returns the first one found. */
function findRemoteCycle(manifest: Manifest): string[] | undefined {
	const state = new Map<string, 'visiting' | 'done'>()
	const stack: string[] = []

	function visit(name: string): string[] | undefined {
		const app = manifest.apps[name]
		if (!app) return undefined

		state.set(name, 'visiting')
		stack.push(name)

		for (const remote of app.remotes) {
			if (!manifest.apps[remote]) continue

			if (state.get(remote) === 'visiting') {
				const start = stack.indexOf(remote)
				return [...stack.slice(start), remote]
			}
			if (state.get(remote) !== 'done') {
				const found = visit(remote)
				if (found) return found
			}
		}

		stack.pop()
		state.set(name, 'done')
		return undefined
	}

	for (const name of Object.keys(manifest.apps)) {
		if (state.get(name) === 'done') continue
		const found = visit(name)
		if (found) return found
	}
	return undefined
}

/**
 * "shell" was split into "navigation" and "federation"; an older spool.json
 * that still lists it is normalised in memory instead of failing to parse.
 * `spool upgrade` is what rewrites the file on disk.
 *
 * TODO: remove this once the CLI no longer supports spool.json v1.
 */
function normaliseShellAddon(raw: unknown): void {
	if (raw === null || typeof raw !== 'object' || !('addons' in raw)) return

	const addons = (raw as { addons: unknown }).addons
	if (!Array.isArray(addons) || !addons.includes('shell')) return

	const kept = addons.filter(name => name !== 'shell')
	if (!kept.includes('navigation')) kept.push('navigation')
	if (!kept.includes('federation')) kept.push('federation')
		; (raw as { addons: unknown }).addons = kept

	log.warn(
		`${MANIFEST_FILE} lists the addon "shell", which is now split into "navigation" and "federation". Run \`spool upgrade\` to update ${MANIFEST_FILE} on disk.`
	)
}

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

	normaliseShellAddon(raw)

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
