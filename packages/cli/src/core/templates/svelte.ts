// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   SVELTE TEMPLATES
 ***************************************************************************************************/
import { camelCase } from '../../util/names.js'
import { mountContractTyping, reactBridgeFiles } from './bridges.js'
import type { FrameworkTemplate, MountHint, RemoteRef } from './index.js'

export const svelteTemplate: FrameworkTemplate = {
	remoteContract: 'mount',
	exposeEntry: './src/mount.ts',
	htmlEntry: '/src/main.ts',
	// The module declaration lets plain tsc check .ts files that import
	// .svelte components; use svelte-check for template-level checking.
	viteEnv: `/// <reference types="vite/client" />

declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
`,
	compilerOptions: {},
	vitePlugin: {
		importLine: 'import { svelte } from "@sveltejs/vite-plugin-svelte";',
		call: 'svelte()',
	},
	remoteTyping: mountContractTyping,
	sourceFiles: (appName, isHost, refs) => {
		const files: Record<string, string> = {
			'src/main.ts': svelteMain(),
			'src/App.svelte': isHost ? svelteHostApp(appName, refs) : svelteRemoteApp(appName),
		}
		if (!isHost) files['src/mount.ts'] = svelteMount()
		return { ...files, ...(isHost ? reactBridgeFiles(refs) : {}) }
	},
	bridgeFiles: reactBridgeFiles,
	mountHint,
}

/*
 *   FILE BUILDERS
 ***************************************************************************************************/
function svelteMain(): string {
	return `import { mount } from "svelte";
import App from "./App.svelte";

mount(App, { target: document.getElementById("root")! });
`
}

function svelteMount(): string {
	return `import { mount, unmount } from "svelte";
import App from "./App.svelte";

// The contract non-react remotes expose: any host mounts this into a DOM
// node it owns and calls the returned cleanup on teardown.
export default function mountApp(target: HTMLElement): () => void {
  const app = mount(App, { target });
  return () => {
    void unmount(app);
  };
}
`
}

function svelteRemoteApp(appName: string): string {
	return `<section style="font-family: system-ui; padding: 16px; border: 1px solid #ccc;">
  <strong>${appName}</strong>: a Svelte remote exposed via Module Federation.
</section>
`
}

function svelteHostApp(appName: string, refs: RemoteRef[]): string {
	const hasBridge = refs.some(r => r.contract === 'component')
	const bridgeImport = hasBridge ? `\n  import { mountReact } from "./react-bridge";` : ''

	const elements = refs.map(r => `  let ${camelCase(r.name)}El: HTMLElement;`).join('\n')
	const mounts = refs
		.map(r => {
			const el = `${camelCase(r.name)}El`
			const mount =
				r.contract === 'component' ? `mountReact(m.default, ${el})` : `m.default(${el})`
			return `      void import("${r.name}/App").then(m => {
        if (!cancelled) cleanups.push(${mount});
      });`
		})
		.join('\n')
	const sections = refs
		.map(
			r => `  <section>
    <h2>${r.name}</h2>
    <div bind:this={${camelCase(r.name)}El}></div>
  </section>`
		)
		.join('\n')

	const onMount = refs.length
		? `
  onMount(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];
${mounts}
    return () => {
      cancelled = true;
      cleanups.forEach(cleanup => cleanup());
    };
  });
`
		: `
  // No remotes wired yet. Add one with \`spool add <name> --host ${appName}\`.
`

	const imports = refs.length ? `  import { onMount } from "svelte";${bridgeImport}\n\n` : ''

	return `<script lang="ts">
${imports}${elements}
${onMount}</script>

<main style="font-family: system-ui; padding: 24px;">
  <h1>${appName} (host)</h1>
${sections || '  <p>No remotes mounted yet.</p>'}
</main>
`
}

/*
 *   MOUNT HINT
 ***************************************************************************************************/
function mountHint(ref: RemoteRef, hostName: string): MountHint {
	const el = `${camelCase(ref.name)}El`
	const mount = ref.contract === 'component' ? `mountReact(m.default, ${el})` : `m.default(${el})`
	const lines = [
		`let ${el}: HTMLElement;`,
		`onMount(() => {`,
		`  let cancelled = false;`,
		`  let cleanup: (() => void) | undefined;`,
		`  void import("${ref.name}/App").then(m => {`,
		`    if (!cancelled) cleanup = ${mount};`,
		`  });`,
		`  return () => {`,
		`    cancelled = true;`,
		`    cleanup?.();`,
		`  };`,
		`});`,
		`// and in the markup: <div bind:this={${el}}></div>`,
	]
	if (ref.contract === 'component') {
		lines.unshift(`import { mountReact } from "./react-bridge";`)
	}
	return { intro: `To mount it, edit apps/${hostName}/src/App.svelte:`, lines }
}
