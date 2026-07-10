// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   SVELTE TEMPLATES
 ***************************************************************************************************/
import { camelCase } from '../../util/names.js'
import {
	mountContractTyping,
	reactBridgeFiles,
	STATE_COUNT_TESTID,
	STATE_COUNT_TEXT,
	STATE_STORE_IMPORT,
} from './bridges.js'
import { shellHostApp } from './shell.js'
import type { FrameworkTemplate, MountHint, RemoteRef, TemplateExtras } from './index.js'

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
	sourceFiles: (appName, isHost, refs, extras) => {
		const files: Record<string, string> = {
			'src/main.ts': svelteMain(extras),
			'src/App.svelte': isHost
				? svelteHostAppFile(appName, refs, extras)
				: svelteRemoteApp(appName, extras),
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
function svelteMain(extras: TemplateExtras): string {
	const sentryImport = extras.sentry ? `import { initSentry } from "./sentry";\n` : ''
	const sentryCall = extras.sentry ? `initSentry();\n\n` : ''
	return `${sentryImport}import { mount } from "svelte";
import App from "./App.svelte";

${sentryCall}mount(App, { target: document.getElementById("root")! });
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

function svelteRemoteApp(appName: string, extras: TemplateExtras): string {
	if (!extras.stateExample) {
		return `<section style="font-family: system-ui; padding: 16px; border: 1px solid #ccc;">
  <strong>${appName}</strong>: a Svelte remote exposed via Module Federation.
</section>
`
	}

	return `<script lang="ts">
  import { onMount } from "svelte";
  import { counterMachine } from "${STATE_STORE_IMPORT}";

  let count = counterMachine.getState().count;
  onMount(() => counterMachine.subscribe(state => (count = state.count)));

  const increment = () =>
    counterMachine.mutate(draft => {
      draft.count += 1;
    });
</script>

<section style="font-family: system-ui; padding: 16px; border: 1px solid #ccc;">
  <p><strong>${appName}</strong>: a Svelte remote exposed via Module Federation.</p>
  <p>${STATE_COUNT_TEXT} {count}</p>
  <button on:click={increment}>Increment</button>
</section>
`
}

function svelteHostAppFile(appName: string, refs: RemoteRef[], extras: TemplateExtras): string {
	return extras.shell
		? shellHostApp('svelte', appName, refs)
		: svelteHostApp(appName, refs, extras)
}

function svelteHostApp(appName: string, refs: RemoteRef[], extras: TemplateExtras): string {
	const hasBridge = refs.some(r => r.contract === 'component')
	const bridgeImport = hasBridge ? `\n  import { mountReact } from "./react-bridge";` : ''

	const stateImport = extras.stateExample
		? `\n  import { counterMachine } from "${STATE_STORE_IMPORT}";`
		: ''
	const stateLines = extras.stateExample
		? `\n  let count = counterMachine.getState().count;\n  onMount(() => counterMachine.subscribe(state => (count = state.count)));\n`
		: ''
	const stateMarkup = extras.stateExample
		? `\n  <p data-testid="${STATE_COUNT_TESTID}">${STATE_COUNT_TEXT} {count}</p>`
		: ''

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

	const imports =
		refs.length || extras.stateExample
			? `  import { onMount } from "svelte";${bridgeImport}${stateImport}\n${stateLines}\n`
			: ''

	return `<script lang="ts">
${imports}${elements}
${onMount}</script>

<main style="font-family: system-ui; padding: 24px;">
  <h1>${appName} (host)</h1>${stateMarkup}
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
