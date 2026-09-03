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
		remoteRef(name, m.apps[name]?.framework ?? DEFAULT_FRAMEWORK, exposeNames(m.apps[name]))
	)
}

export function remoteRef(name: string, framework: Framework, exposes = ['App']): RemoteRef {
	return { name, framework, contract: TEMPLATES[framework].remoteContract, exposes }
}

/** Expose keys without their "./" prefix. A remote always offers App. */
function exposeNames(app: AppConfig | undefined): string[] {
	const names = Object.keys(app?.exposes ?? {}).map(key => key.replace(/^[.][/]/, ''))
	return names.length ? names : ['App']
}

export * from './types.js'
