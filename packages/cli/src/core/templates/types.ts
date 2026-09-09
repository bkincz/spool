/*
 *   TEMPLATE CONTRACT
 ***************************************************************************************************/
import type { Framework } from '../config.js'

export type RemoteContract = 'component' | 'mount'

export interface RemoteRef {
	name: string
	/** Folder relative to the workspace root, e.g. "apps/dashboard". */
	path: string
	framework: Framework
	contract: RemoteContract
	/** Bare expose names the remote offers, e.g. ["App", "NewAssessment"]. */
	exposes: string[]
	/** Bare expose name -> its source path, e.g. { App: "./src/app/app.tsx" }. */
	exposeSources: Record<string, string>
}

/** Where a host's remote typings live, so remoteTyping can find `spool types` output. */
export interface RemoteTypingContext {
	/** Workspace root, absolute. */
	root: string
	/** The consuming host's app path, relative to root. */
	hostPath: string
}

export interface MountHint {
	intro: string
	lines: string[]
}

export interface TemplateExtras {
	stateExample: boolean
	uiButton: boolean
	sentry: boolean
	composed: boolean
}

export const NO_EXTRAS: TemplateExtras = {
	stateExample: false,
	uiButton: false,
	sentry: false,
	composed: false,
}

export interface FrameworkTemplate {
	/** The contract this framework's remotes expose as "./App". */
	remoteContract: RemoteContract
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
	/** Ambient module declarations for one remote of this framework, one per expose. */
	remoteTyping(ref: RemoteRef, ctx: RemoteTypingContext): string
	/** App sources: the entry file plus the App component, host or remote flavored. */
	sourceFiles(
		appName: string,
		isHost: boolean,
		refs: RemoteRef[],
		extras: TemplateExtras
	): Record<string, string>
	/** Extra files a host of this framework needs to mount foreign-framework remotes. */
	bridgeFiles(refs: RemoteRef[]): Record<string, string>
	/** How a host of this framework mounts `ref`; printed by `spool add`. */
	mountHint(ref: RemoteRef, hostName: string): MountHint
}
