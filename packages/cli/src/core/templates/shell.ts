import type { AppConfig, Framework, Manifest } from '../config.js'
import type { FileMap } from '../generators.js'
import { remoteRefs, type RemoteRef } from './index.js'

export const SHELL_REMOTES_FILE = 'src/shell/remotes.ts'
export const NAV_PATH_TESTID = 'shell-path'

/** Substrate every app gets: the shared history plus a framework binding to
 * read it reactively. Coordination rides on window.history so independent
 * copies stay in sync with no shared singleton. */
export function shellRuntimeFiles(app: AppConfig): FileMap {
	const [bindingFile, binding] = locationBinding(app.framework)
	return {
		'src/shell/history.ts': historyCore(),
		[`src/shell/${bindingFile}`]: binding,
	}
}

/** Host-only files: the remote registry (regenerated when remotes change) and
 * the <Remote> mounting primitive that hides the component/mount contract. */
export function shellHostFiles(m: Manifest, host: AppConfig): FileMap {
	const refs = remoteRefs(m, host)
	const [primitiveFile, primitive] = remotePrimitive(host.framework, refs)
	return {
		[SHELL_REMOTES_FILE]: remotesRegistry(refs),
		[`src/shell/${primitiveFile}`]: primitive,
	}
}

/** The name-keyed loader table, regenerated whenever a host's remotes change. */
export function remotesRegistry(refs: RemoteRef[]): string {
	const entries = refs.map(
		r =>
			`  ${JSON.stringify(r.name)}: { contract: "${r.contract}", load: () => import("${r.name}/App") },`
	)
	return `export interface RemoteEntry {
  contract: "component" | "mount";
  load: () => Promise<{ default: unknown }>;
}

export const remotes: Record<string, RemoteEntry> = {
${entries.join('\n')}
};
`
}

export function shellNotes(composed: boolean): string[] {
	if (composed) {
		return [
			'shell: the host starts as a routed shell in src/App. Mount any remote with <Remote name="..." />, read the url with useLocation(), and navigate() to change it.',
		]
	}
	return [
		'shell: import { Remote } from "./shell/remote" to mount a remote by name, plus navigate/useLocation from "./shell/history". Compose them into your host however you like.',
	]
}

function historyCore(): string {
	return `export interface SpoolLocation {
  pathname: string;
  search: string;
  hash: string;
}

const EVENT = "spool:navigation";

let cached: SpoolLocation = read();

function read(): SpoolLocation {
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

function install(): void {
  const flagged = window as typeof window & { __spoolShell?: boolean };
  if (flagged.__spoolShell) return;
  flagged.__spoolShell = true;

  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(EVENT));
      return result;
    };
  }
  window.addEventListener("popstate", () => window.dispatchEvent(new Event(EVENT)));
}

install();

export function getLocation(): SpoolLocation {
  const next = read();
  if (
    next.pathname !== cached.pathname ||
    next.search !== cached.search ||
    next.hash !== cached.hash
  ) {
    cached = next;
  }
  return cached;
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  history[options.replace ? "replaceState" : "pushState"](null, "", to);
}

export function subscribe(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** The value at the longest url prefix in \`routes\` that matches \`pathname\`. */
export function matchRoute(
  pathname: string,
  routes: Record<string, string>,
): string | undefined {
  return Object.entries(routes)
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(prefix.replace(/\\/$/, "") + "/"))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}
`
}

function locationBinding(framework: Framework): [string, string] {
	if (framework === 'svelte') {
		return [
			'location.ts',
			`import { readable } from "svelte/store";
import { getLocation, subscribe, type SpoolLocation } from "./history";

export const location = readable<SpoolLocation>(getLocation(), set => subscribe(() => set(getLocation())));
`,
		]
	}
	if (framework === 'vue') {
		return [
			'use-location.ts',
			`import { onScopeDispose, shallowRef, type ShallowRef } from "vue";
import { getLocation, subscribe, type SpoolLocation } from "./history";

export function useLocation(): ShallowRef<SpoolLocation> {
  const location = shallowRef<SpoolLocation>(getLocation());
  const stop = subscribe(() => {
    location.value = getLocation();
  });
  onScopeDispose(stop);
  return location;
}
`,
		]
	}
	return [
		'use-location.ts',
		`import { useSyncExternalStore } from "react";
import { getLocation, subscribe, type SpoolLocation } from "./history";

export function useLocation(): SpoolLocation {
  return useSyncExternalStore(subscribe, getLocation, getLocation);
}
`,
	]
}

function remotePrimitive(framework: Framework, refs: RemoteRef[]): [string, string] {
	const hasComponent = refs.some(r => r.contract === 'component')
	if (framework === 'svelte') return ['Remote.svelte', svelteRemote(hasComponent)]
	if (framework === 'vue') return ['Remote.vue', vueRemote(hasComponent)]
	return ['remote.tsx', reactRemote()]
}

function reactRemote(): string {
	return `import { lazy, Suspense, useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { remotes } from "./remotes";

const cache: Record<string, ComponentType> = {};

export function Remote({ name, fallback = null }: { name: string; fallback?: ReactNode }) {
  const entry = remotes[name];
  if (!entry) return null;
  if (entry.contract === "component") {
    const View = (cache[name] ??= lazy(entry.load as () => Promise<{ default: ComponentType }>));
    return (
      <Suspense fallback={fallback}>
        <View />
      </Suspense>
    );
  }
  return <MountRemote key={name} load={entry.load} />;
}

function MountRemote({ load }: { load: () => Promise<{ default: unknown }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (load() as Promise<{ default: (el: HTMLElement) => () => void }>).then(({ default: mount }) => {
      if (!cancelled && ref.current) cleanup = mount(ref.current);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [load]);
  return <div ref={ref} />;
}
`
}

function svelteRemote(hasComponent: boolean): string {
	const bridgeImport = hasComponent ? `\n  import { mountReact } from "../react-bridge";` : ''
	const mountExpr = hasComponent
		? `entry.contract === "component"
        ? mountReact(m.default as never, el)
        : (m.default as (el: HTMLElement) => () => void)(el)`
		: `(m.default as (el: HTMLElement) => () => void)(el)`
	return `<script lang="ts">
  import { onDestroy } from "svelte";${bridgeImport}
  import { remotes } from "./remotes";

  export let name: string;

  let el: HTMLElement;
  let cleanup: (() => void) | undefined;
  let current: string | undefined;

  $: if (el && name !== current) void swap(name);

  async function swap(next: string) {
    current = next;
    cleanup?.();
    cleanup = undefined;
    const entry = remotes[next];
    if (!entry) return;
    const m = await entry.load();
    cleanup = ${mountExpr};
  }

  onDestroy(() => cleanup?.());
</script>

<div bind:this={el}></div>
`
}

function vueRemote(hasComponent: boolean): string {
	const bridgeImport = hasComponent ? `\nimport { mountReact } from "../react-bridge";` : ''
	const mountExpr = hasComponent
		? `entry.contract === "component"
      ? mountReact(m.default as never, el.value)
      : (m.default as (el: HTMLElement) => () => void)(el.value)`
		: `(m.default as (el: HTMLElement) => () => void)(el.value)`
	return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";${bridgeImport}
import { remotes } from "./remotes";

const props = defineProps<{ name: string }>();
const el = ref<HTMLElement | null>(null);
let cleanup: (() => void) | undefined;

async function swap(name: string) {
  cleanup?.();
  cleanup = undefined;
  const entry = remotes[name];
  if (!entry || !el.value) return;
  const m = await entry.load();
  cleanup = ${mountExpr};
}

onMounted(() => {
  void swap(props.name);
  watch(() => props.name, swap);
});
onBeforeUnmount(() => cleanup?.());
</script>

<template>
  <div ref="el"></div>
</template>
`
}

/** A starting route table for the generated shell: the first remote at "/",
 * the rest at "/<name>". Written into the host's own App, which is yours to edit. */
function defaultRoutes(refs: RemoteRef[]): Record<string, string> {
	const routes: Record<string, string> = {}
	refs.forEach((r, i) => {
		routes[i === 0 ? '/' : `/${r.name}`] = r.name
	})
	return routes
}

export function shellHostApp(framework: Framework, appName: string, refs: RemoteRef[]): string {
	const routes = defaultRoutes(refs)
	if (framework === 'svelte') return svelteShellHost(appName, routes)
	if (framework === 'vue') return vueShellHost(appName, routes)
	return reactShellHost(appName, routes)
}

function routesLiteral(routes: Record<string, string>): string {
	const entries = Object.entries(routes).map(([path, name]) => `"${path}": "${name}"`)
	return `{ ${entries.join(', ')} }`
}

function reactShellHost(appName: string, routes: Record<string, string>): string {
	return `import { navigate, matchRoute } from "./shell/history";
import { useLocation } from "./shell/use-location";
import { Remote } from "./shell/remote";

// Map url prefixes to remote names. Edit freely; add persistent regions by
// rendering <Remote name="..." /> outside the routed <main>.
const routes: Record<string, string> = ${routesLiteral(routes)};

export default function App() {
  const location = useLocation();
  const active = matchRoute(location.pathname, routes);
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <nav style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid #ccc" }}>
        <strong>${appName}</strong>
        {Object.entries(routes).map(([path, name]) => (
          <button key={name} onClick={() => navigate(path)}>
            {name}
          </button>
        ))}
      </nav>
      <p data-testid="${NAV_PATH_TESTID}" style={{ padding: "8px 12px", color: "#666" }}>
        {location.pathname}
      </p>
      <main style={{ padding: 12 }}>
        {active ? <Remote name={active} /> : <p>Pick a section above.</p>}
      </main>
    </div>
  );
}
`
}

function svelteShellHost(appName: string, routes: Record<string, string>): string {
	return `<script lang="ts">
  import { navigate, matchRoute } from "./shell/history";
  import { location } from "./shell/location";
  import Remote from "./shell/Remote.svelte";

  const routes: Record<string, string> = ${routesLiteral(routes)};
  $: active = matchRoute($location.pathname, routes);
</script>

<div style="font-family: system-ui;">
  <nav style="display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid #ccc;">
    <strong>${appName}</strong>
    {#each Object.entries(routes) as [path, name] (name)}
      <button on:click={() => navigate(path)}>{name}</button>
    {/each}
  </nav>
  <p data-testid="${NAV_PATH_TESTID}" style="padding: 8px 12px; color: #666;">{$location.pathname}</p>
  <main style="padding: 12px;">
    {#if active}
      <Remote name={active} />
    {:else}
      <p>Pick a section above.</p>
    {/if}
  </main>
</div>
`
}

function vueShellHost(appName: string, routes: Record<string, string>): string {
	return `<script setup lang="ts">
import { computed } from "vue";
import { navigate, matchRoute } from "./shell/history";
import { useLocation } from "./shell/use-location";
import Remote from "./shell/Remote.vue";

const routes: Record<string, string> = ${routesLiteral(routes)};
const location = useLocation();
const active = computed(() => matchRoute(location.value.pathname, routes));
</script>

<template>
  <div style="font-family: system-ui">
    <nav style="display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid #ccc">
      <strong>${appName}</strong>
      <button v-for="(name, path) in routes" :key="name" @click="navigate(path)">{{ name }}</button>
    </nav>
    <p :data-testid="'${NAV_PATH_TESTID}'" style="padding: 8px 12px; color: #666">
      {{ location.pathname }}
    </p>
    <main style="padding: 12px">
      <Remote v-if="active" :name="active" />
      <p v-else>Pick a section above.</p>
    </main>
  </div>
</template>
`
}
