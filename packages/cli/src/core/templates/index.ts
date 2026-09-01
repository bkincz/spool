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
	return host.remotes.map(name => remoteRef(name, m.apps[name]?.framework ?? DEFAULT_FRAMEWORK))
}

export function remoteRef(name: string, framework: Framework): RemoteRef {
	return { name, framework, contract: TEMPLATES[framework].remoteContract }
}

export * from './types.js'
