/*
 *   IMPORTS
 ***************************************************************************************************/
import { HELPER_FILE, WORKSPACE_FILE, MANIFEST_FILE, type Manifest } from '../config.js'

/*
 *   TURBO CONFIG
 ***************************************************************************************************/
/**
 * The two things a hand-written turbo.json gets wrong for a spool workspace.
 *
 * Every app's vite.config.ts reads spool.json through the runtime helper when
 * the build starts, but those files live at the root, outside any package's
 * input hash. Undeclared and changing a remote's url is a cache hit and the build
 * ships the old wiring -- no bueno.
 *
 * Also, a host bakes the url it resolved into its bundle, so SPOOL_ENV and
 * SPOOL_REMOTE_<NAME> change the output. Turborepo only passes through an env it
 * has been told about, so undeclared they are both a stale-cache risk and a
 * silently ignored `--env`.
 */
export function turboConfig(m: Manifest): string {
	const buildEnv = ['SPOOL_REMOTE_*', 'VITE_*']
	if (m.addons.includes('sentry')) {
		buildEnv.push('SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT')
	}

	const config = {
		$schema: 'https://turborepo.com/schema.json',
		globalDependencies: [MANIFEST_FILE, HELPER_FILE, WORKSPACE_FILE],
		globalEnv: ['SPOOL_ENV'],
		tasks: {
			build: {
				dependsOn: ['^build'],
				outputs: ['dist/**'],
				env: buildEnv,
				// Vite reads .env itself, so its values never reach turbo as
				// environment. Hashing the files covers them either way.
				inputs: ['$TURBO_DEFAULT$', '.env', '.env.*'],
			},
			'type-check': { dependsOn: ['^build'] },
			test: { dependsOn: ['^build'] },
			lint: {},
			dev: { cache: false, persistent: true },
			preview: { cache: false, persistent: true },
		},
	}

	return `${JSON.stringify(config, null, '\t')}\n`
}

/*
 *   NOTES
 ***************************************************************************************************/
export function turboNotes(m: Manifest): string[] {
	return [
		`turbo: cached, parallel task runs across every package, e.g. \`${m.packageManager} exec turbo run type-check\``,
		'turbo: spool dev and spool build keep working as they are; turbo covers the tasks spool does not orchestrate',
	]
}
