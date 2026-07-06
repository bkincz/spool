/*
 *   FRAMEWORK TEMPLATES
 ***************************************************************************************************/
import type { AppConfig, Framework, Manifest } from '../config.js'
import { reactTemplate } from './react.js'
import { svelteTemplate } from './svelte.js'

/*
 *   TYPES
 ***************************************************************************************************/
/** A remote a host consumes, with its framework, which sets its contract. */
export interface RemoteRef {
	name: string
	framework: Framework
}

/** The snippet `spool add` prints for wiring a new remote into a host. */
export interface MountHint {
	intro: string
	lines: string[]
}

/**
 * Everything the generators need to know about one framework. Supporting a
 * new framework means filling in one of these and registering it in TEMPLATES;
 * nothing else dispatches on the framework name.
 */
export interface FrameworkTemplate {
	/** Source file a fresh remote exposes as "./App". */
	exposeEntry: string
	/** Script the generated index.html loads. */
	htmlEntry: string
	/** Contents of src/vite-env.d.ts. */
	viteEnv: string
	/** Per-app tsconfig compilerOptions, e.g. the react JSX runtime. */
	compilerOptions: Record<string, string>
	/** Vite plugin wiring for the generated vite.config.ts. */
	vitePlugin: { importLine: string; call: string }
	/** Ambient module declaration for one remote of this framework. */
	remoteTyping(name: string): string
	/** App sources: the entry file plus the App component, host or remote flavored. */
	sourceFiles(appName: string, isHost: boolean, refs: RemoteRef[]): Record<string, string>
	/** Extra files a host of this framework needs to mount foreign-framework remotes. */
	bridgeFiles(refs: RemoteRef[]): Record<string, string>
	/** How a host of this framework mounts `ref`; printed by `spool add`. */
	mountHint(ref: RemoteRef, hostName: string): MountHint
}

export const TEMPLATES: Record<Framework, FrameworkTemplate> = {
	react: reactTemplate,
	svelte: svelteTemplate,
}

/*
 *   HELPERS
 ***************************************************************************************************/
export function remoteRefs(m: Manifest, host: AppConfig): RemoteRef[] {
	return host.remotes.map(name => ({
		name,
		framework: m.apps[name]?.framework ?? 'react',
	}))
}
