/*
 *   FRAMEWORK TEMPLATES
 ***************************************************************************************************/
import { DEFAULT_FRAMEWORK, type AppConfig, type Framework, type Manifest } from '../config.js'
import type { FrameworkTemplate, RemoteRef } from './types.js'
import { reactTemplate } from './react.js'
import { svelteTemplate } from './svelte.js'
import { vueTemplate } from './vue.js'

export const TEMPLATES: Record<Framework, FrameworkTemplate> = {
	react: reactTemplate,
	svelte: svelteTemplate,
	vue: vueTemplate,
}

/*
 *   HELPERS
 ***************************************************************************************************/
export function remoteRefs(m: Manifest, host: AppConfig): RemoteRef[] {
	return host.remotes.map(name =>
		remoteRef(
			name,
			m.apps[name]?.framework ?? DEFAULT_FRAMEWORK,
			exposeSourceMap(m.apps[name]),
			m.apps[name]?.path
		)
	)
}

export function remoteRef(
	name: string,
	framework: Framework,
	exposeSources: Record<string, string> = { App: TEMPLATES[framework].exposeEntry },
	path: string = `apps/${name}`
): RemoteRef {
	return {
		name,
		path,
		framework,
		contract: TEMPLATES[framework].remoteContract,
		exposes: Object.keys(exposeSources),
		exposeSources,
	}
}

/** Expose keys without their "./" prefix, mapped to their source path. A remote always offers App. */
function exposeSourceMap(app: AppConfig | undefined): Record<string, string> {
	const entries = Object.entries(app?.exposes ?? {}).map(
		([key, source]) => [key.replace(/^[.][/]/, ''), source] as const
	)
	return entries.length
		? Object.fromEntries(entries)
		: { App: TEMPLATES[app?.framework ?? DEFAULT_FRAMEWORK].exposeEntry }
}

export * from './types.js'
