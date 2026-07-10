// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   VUE TEMPLATES
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

export const vueTemplate: FrameworkTemplate = {
	remoteContract: 'mount',
	exposeEntry: './src/mount.ts',
	htmlEntry: '/src/main.ts',
	// The module declaration lets plain tsc check .ts files that import
	// .vue components; use vue-tsc for template-level checking.
	viteEnv: `/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
`,
	compilerOptions: {},
	vitePlugin: {
		importLine: 'import vue from "@vitejs/plugin-vue";',
		call: 'vue()',
	},
	remoteTyping: mountContractTyping,
	sourceFiles: (appName, isHost, refs, extras) => {
		const files: Record<string, string> = {
			'src/main.ts': vueMain(extras),
			'src/App.vue': isHost
				? vueHostAppFile(appName, refs, extras)
				: vueRemoteApp(appName, extras),
		}
		if (!isHost) files['src/mount.ts'] = vueMount()
		return { ...files, ...(isHost ? reactBridgeFiles(refs) : {}) }
	},
	bridgeFiles: reactBridgeFiles,
	mountHint,
}

/*
 *   FILE BUILDERS
 ***************************************************************************************************/
function vueMain(extras: TemplateExtras): string {
	if (!extras.sentry) {
		return `import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#root");
`
	}
	return `import { createApp } from "vue";
import App from "./App.vue";
import { initSentry } from "./sentry";

const app = createApp(App);
initSentry(app);
app.mount("#root");
`
}

function vueMount(): string {
	return `import { createApp } from "vue";
import App from "./App.vue";

// The contract non-react remotes expose: any host mounts this into a DOM
// node it owns and calls the returned cleanup on teardown.
export default function mountApp(target: HTMLElement): () => void {
  const app = createApp(App);
  app.mount(target);
  return () => app.unmount();
}
`
}

function vueRemoteApp(appName: string, extras: TemplateExtras): string {
	if (!extras.stateExample) {
		return `<template>
  <section style="font-family: system-ui; padding: 16px; border: 1px solid #ccc">
    <strong>${appName}</strong>: a Vue remote exposed via Module Federation.
  </section>
</template>
`
	}

	return `<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { counterMachine } from "${STATE_STORE_IMPORT}";

const count = ref(counterMachine.getState().count);
onBeforeUnmount(counterMachine.subscribe(state => { count.value = state.count; }));

const increment = () =>
  counterMachine.mutate(draft => {
    draft.count += 1;
  });
</script>

<template>
  <section style="font-family: system-ui; padding: 16px; border: 1px solid #ccc">
    <p><strong>${appName}</strong>: a Vue remote exposed via Module Federation.</p>
    <p>${STATE_COUNT_TEXT} {{ count }}</p>
    <button @click="increment">Increment</button>
  </section>
</template>
`
}

function vueHostAppFile(appName: string, refs: RemoteRef[], extras: TemplateExtras): string {
	return extras.shell ? shellHostApp('vue', appName, refs) : vueHostApp(appName, refs, extras)
}

function vueHostApp(appName: string, refs: RemoteRef[], extras: TemplateExtras): string {
	const hasBridge = refs.some(r => r.contract === 'component')
	const bridgeImport = hasBridge ? `\nimport { mountReact } from "./react-bridge";` : ''

	const vueSymbols = [
		...new Set([
			...(refs.length ? ['onBeforeUnmount', 'onMounted', 'ref'] : []),
			...(extras.stateExample ? ['onBeforeUnmount', 'ref'] : []),
		]),
	].sort()
	const stateImport = extras.stateExample
		? `\nimport { counterMachine } from "${STATE_STORE_IMPORT}";`
		: ''
	const stateLines = extras.stateExample
		? `\nconst count = ref(counterMachine.getState().count);\nonBeforeUnmount(counterMachine.subscribe(state => { count.value = state.count; }));\n`
		: ''
	const stateMarkup = extras.stateExample
		? `\n    <p data-testid="${STATE_COUNT_TESTID}">${STATE_COUNT_TEXT} {{ count }}</p>`
		: ''

	const elements = refs
		.map(r => `const ${camelCase(r.name)}El = ref<HTMLElement | null>(null);`)
		.join('\n')
	const mounts = refs
		.map(r => {
			const el = `${camelCase(r.name)}El`
			const mount =
				r.contract === 'component'
					? `mountReact(m.default, ${el}.value)`
					: `m.default(${el}.value)`
			return `  void import("${r.name}/App").then(m => {
    if (!cancelled && ${el}.value) cleanups.push(${mount});
  });`
		})
		.join('\n')
	const sections = refs
		.map(
			r => `    <section>
      <h2>${r.name}</h2>
      <div ref="${camelCase(r.name)}El"></div>
    </section>`
		)
		.join('\n')

	const lifecycle = refs.length
		? `
let cancelled = false;
const cleanups: (() => void)[] = [];

onMounted(() => {
${mounts}
});

onBeforeUnmount(() => {
  cancelled = true;
  cleanups.forEach(cleanup => cleanup());
});
`
		: `
// No remotes wired yet. Add one with \`spool add <name> --host ${appName}\`.
`

	const imports = vueSymbols.length
		? `import { ${vueSymbols.join(', ')} } from "vue";${bridgeImport}${stateImport}\n${stateLines}\n`
		: ''

	return `<script setup lang="ts">
${imports}${elements}
${lifecycle}</script>

<template>
  <main style="font-family: system-ui; padding: 24px">
    <h1>${appName} (host)</h1>${stateMarkup}
${sections || '    <p>No remotes mounted yet.</p>'}
  </main>
</template>
`
}

/*
 *   MOUNT HINT
 ***************************************************************************************************/
function mountHint(ref: RemoteRef, hostName: string): MountHint {
	// Vars are prefixed per remote: hints paste into the host's one <script setup> scope.
	const base = camelCase(ref.name)
	const el = `${base}El`
	const mount =
		ref.contract === 'component'
			? `mountReact(m.default, ${el}.value)`
			: `m.default(${el}.value)`
	const lines = [
		`const ${el} = ref<HTMLElement | null>(null);`,
		`let ${base}Cancelled = false;`,
		`let ${base}Cleanup: (() => void) | undefined;`,
		`onMounted(() => {`,
		`  void import("${ref.name}/App").then(m => {`,
		`    if (!${base}Cancelled && ${el}.value) ${base}Cleanup = ${mount};`,
		`  });`,
		`});`,
		`onBeforeUnmount(() => {`,
		`  ${base}Cancelled = true;`,
		`  ${base}Cleanup?.();`,
		`});`,
		`// and in the template: <div ref="${el}"></div>`,
	]
	if (ref.contract === 'component') {
		lines.unshift(`import { mountReact } from "./react-bridge";`)
	}
	return { intro: `To mount it, edit apps/${hostName}/src/App.vue:`, lines }
}
