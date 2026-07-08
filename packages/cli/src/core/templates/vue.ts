// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   VUE TEMPLATES
 ***************************************************************************************************/
import { camelCase } from '../../util/names.js'
import { mountContractTyping, reactBridgeFiles } from './bridges.js'
import type { FrameworkTemplate, MountHint, RemoteRef } from './index.js'

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
	sourceFiles: (appName, isHost, refs) => {
		const files: Record<string, string> = {
			'src/main.ts': vueMain(),
			'src/App.vue': isHost ? vueHostApp(appName, refs) : vueRemoteApp(appName),
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
function vueMain(): string {
	return `import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#root");
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

function vueRemoteApp(appName: string): string {
	return `<template>
  <section style="font-family: system-ui; padding: 16px; border: 1px solid #ccc">
    <strong>${appName}</strong>: a Vue remote exposed via Module Federation.
  </section>
</template>
`
}

function vueHostApp(appName: string, refs: RemoteRef[]): string {
	const hasBridge = refs.some(r => r.contract === 'component')
	const bridgeImport = hasBridge ? `\nimport { mountReact } from "./react-bridge";` : ''

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

	const imports = refs.length
		? `import { onBeforeUnmount, onMounted, ref } from "vue";${bridgeImport}\n\n`
		: ''

	return `<script setup lang="ts">
${imports}${elements}
${lifecycle}</script>

<template>
  <main style="font-family: system-ui; padding: 24px">
    <h1>${appName} (host)</h1>
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
		ref.contract === 'component' ? `mountReact(m.default, ${el}.value)` : `m.default(${el}.value)`
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
