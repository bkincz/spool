import type { AppConfig, Framework, Manifest } from '../config.js'
import { SENTRY_SDK } from '../versions.js'
import type { FileMap } from '../filemap.js'
import { remoteRefs, type RemoteRef } from './index.js'

export const FEDERATION_REMOTES_FILE = 'src/federation/remotes.ts'
export const NAV_PATH_TESTID = 'shell-path'

/** Substrate every app gets: the shared history plus a framework binding to
 * read it reactively. Coordination rides on window.history so independent
 * copies stay in sync with no shared singleton. */
export function navigationFiles(app: AppConfig): FileMap {
	const [bindingFile, binding] = locationBinding(app.framework)
	return {
		'src/navigation/history.ts': historyCore(),
		[`src/navigation/${bindingFile}`]: binding,
		'src/navigation/index.ts': navigationBarrel(app),
	}
}

function navigationBarrel(app: AppConfig): string {
	return `export * from "./history";\n${bindingExport(app.framework)}\n`
}

function federationBarrel(app: AppConfig): string {
	return `${remoteExport(app.framework)}\nexport { remotes, type RemoteEntry } from "./remotes";\n`
}

function bindingExport(framework: Framework): string {
	return framework === 'svelte'
		? 'export { location } from "./location";'
		: 'export { useLocation } from "./use-location";'
}

function remoteExport(framework: Framework): string {
	if (framework === 'svelte') return 'export { default as Remote } from "./Remote.svelte";'
	if (framework === 'vue') return 'export { default as Remote } from "./Remote.vue";'
	return 'export { Remote } from "./remote";'
}

/** Host-only files: the remote registry (regenerated when remotes change) and
 * the <Remote> mounting primitive that hides the component/mount contract. */
export function federationFiles(m: Manifest, host: AppConfig): FileMap {
	const refs = remoteRefs(m, host)
	const sentry = m.addons.includes('sentry')
	const [primitiveFile, primitive] = remotePrimitive(host.framework, refs, sentry)
	return {
		[FEDERATION_REMOTES_FILE]: remotesRegistry(refs),
		[`src/federation/${primitiveFile}`]: primitive,
		'src/federation/index.ts': federationBarrel(host),
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

export function navigationNotes(): string[] {
	return [
		'navigation: import { useLocation, navigate } from "@/navigation" to read the url and change it. Every bundle on the page sees the same one.',
	]
}

export function federationNotes(composed: boolean): string[] {
	if (composed) {
		return [
			'federation: the host starts as a routed shell in src/app. Mount any remote with <Remote name="..." /> from "@/federation".',
		]
	}
	return [
		'federation: import { Remote } from "@/federation" to mount a remote by name. Compose them into your host however you like.',
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

function remotePrimitive(
	framework: Framework,
	refs: RemoteRef[],
	sentry: boolean
): [string, string] {
	const hasComponent = refs.some(r => r.contract === 'component')
	if (framework === 'svelte') return ['Remote.svelte', svelteRemote(hasComponent, sentry)]
	if (framework === 'vue') return ['Remote.vue', vueRemote(hasComponent, sentry)]
	return ['remote.tsx', reactRemote(sentry)]
}

function sentryReport(framework: Framework, sentry: boolean): [string, string] {
	if (!sentry) return ['', '']
	const sdk = SENTRY_SDK[framework]
	return [
		`import * as Sentry from "${sdk}";
`,
		'Sentry.captureException(error, { tags: { remote: name } });',
	]
}

function reactRemote(sentry: boolean): string {
	const [sentryImport, sentryCall] = sentryReport('react', sentry)
	return `import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
${sentryImport}import { remotes } from "./remotes";

const cache: Record<string, ComponentType> = {};

export interface RemoteProps {
  name: string;
  /** Shown while the remote is still loading. */
  fallback?: ReactNode;
  /** Shown when it fails to load. Call retry to start the load over. */
  renderError?: (error: Error, retry: () => void) => ReactNode;
  onError?: (error: Error, name: string) => void;
}

export function Remote({ name, fallback = null, renderError = defaultError, onError }: RemoteProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    // React caches the rejected promise inside lazy(), so the wrapper has to
    // go too or the remote stays broken for the life of the page.
    delete cache[name];
    setAttempt((n) => n + 1);
  }, [name]);

  const report = useCallback(
    (error: Error) => {
      onError?.(error, name);
      ${sentryCall}
    },
    [name, onError],
  );

  const entry = remotes[name];
  if (!entry) return null;

  return (
    <RemoteBoundary
      key={name + ":" + attempt}
      retry={retry}
      renderError={renderError}
      onError={report}
    >
      {entry.contract === "component" ? (
        <Suspense fallback={fallback}>
          <ComponentRemote name={name} load={entry.load} />
        </Suspense>
      ) : (
        <MountRemote load={entry.load} />
      )}
    </RemoteBoundary>
  );
}

function ComponentRemote({ name, load }: { name: string; load: () => Promise<unknown> }) {
  const View = (cache[name] ??= lazy(load as () => Promise<{ default: ComponentType }>));
  return <View />;
}

function MountRemote({ load }: { load: () => Promise<{ default: unknown }> }) {
  const ref = useRef<HTMLDivElement>(null);
  // Rethrown during render, because a boundary cannot catch a rejected promise.
  const [failure, setFailure] = useState<Error | null>(null);
  if (failure) throw failure;

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (load() as Promise<{ default: (el: HTMLElement) => () => void }>).then(
      ({ default: mount }) => {
        if (!cancelled && ref.current) cleanup = mount(ref.current);
      },
      (cause: unknown) => {
        if (!cancelled) setFailure(asError(cause));
      },
    );
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [load]);
  return <div ref={ref} />;
}

interface BoundaryProps {
  retry: () => void;
  renderError: (error: Error, retry: () => void) => ReactNode;
  onError: (error: Error) => void;
  children: ReactNode;
}

class RemoteBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: asError(error) };
  }

  componentDidCatch(error: unknown) {
    this.props.onError(asError(error));
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.renderError(error, this.props.retry);
  }
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/** Unstyled on purpose. Pass renderError to make it yours. */
function defaultError(_error: Error, retry: () => void): ReactNode {
  return (
    <div role="alert" data-remote-error="">
      <p>This section could not be loaded.</p>
      <button type="button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
`
}

function svelteRemote(hasComponent: boolean, sentry: boolean): string {
	const [sentryImport, sentryCall] = sentryReport('svelte', sentry)
	const bridgeImport = hasComponent ? `\n  import { mountReact } from "../react-bridge";` : ''
	const mountExpr = hasComponent
		? `entry.contract === "component"
          ? mountReact(m.default as never, el)
          : (m.default as (el: HTMLElement) => () => void)(el)`
		: `(m.default as (el: HTMLElement) => () => void)(el)`
	return `<script lang="ts">
  import { onDestroy } from "svelte";${bridgeImport}
  ${sentryImport}import { remotes } from "./remotes";

  export let name: string;

  let el: HTMLElement;
  let cleanup: (() => void) | undefined;
  let current: string | undefined;
  let error: Error | undefined;

  $: if (el && name !== current) void swap(name);

  async function swap(next: string) {
    current = next;
    error = undefined;
    cleanup?.();
    cleanup = undefined;
    const entry = remotes[next];
    if (!entry) return;
    try {
      const m = await entry.load();
      cleanup = ${mountExpr};
    } catch (cause) {
      error = cause instanceof Error ? cause : new Error(String(cause));
      const name = next;
      ${sentryCall}
      console.error('remote "' + next + '" failed to load', cause);
    }
  }

  function retry() {
    current = undefined;
    void swap(name);
  }

  onDestroy(() => cleanup?.());
</script>

{#if error}
  <div role="alert" data-remote-error>
    <p>This section could not be loaded.</p>
    <button type="button" on:click={retry}>Try again</button>
  </div>
{/if}
<div bind:this={el}></div>
`
}

function vueRemote(hasComponent: boolean, sentry: boolean): string {
	const [sentryImport, sentryCall] = sentryReport('vue', sentry)
	const bridgeImport = hasComponent ? `\nimport { mountReact } from "../react-bridge";` : ''
	const mountExpr = hasComponent
		? `entry.contract === "component"
        ? mountReact(m.default as never, el.value)
        : (m.default as (el: HTMLElement) => () => void)(el.value)`
		: `(m.default as (el: HTMLElement) => () => void)(el.value)`
	return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";${bridgeImport}
${sentryImport}import { remotes } from "./remotes";

const props = defineProps<{ name: string }>();
const el = ref<HTMLElement | null>(null);
const error = ref<Error | null>(null);
let cleanup: (() => void) | undefined;

async function swap(name: string) {
  error.value = null;
  cleanup?.();
  cleanup = undefined;
  const entry = remotes[name];
  if (!entry || !el.value) return;
  try {
    const m = await entry.load();
    cleanup = ${mountExpr};
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error(String(cause));
    ${sentryCall}
    console.error('remote "' + name + '" failed to load', cause);
  }
}

const retry = () => void swap(props.name);

onMounted(() => {
  void swap(props.name);
  watch(() => props.name, swap);
});
onBeforeUnmount(() => cleanup?.());
</script>

<template>
  <div v-if="error" role="alert" data-remote-error>
    <p>This section could not be loaded.</p>
    <button type="button" @click="retry">Try again</button>
  </div>
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

export function compositionHostApp(
	framework: Framework,
	appName: string,
	refs: RemoteRef[]
): string {
	const routes = defaultRoutes(refs)
	if (framework === 'svelte') return svelteCompositionHost(appName, routes)
	if (framework === 'vue') return vueCompositionHost(appName, routes)
	return reactCompositionHost(appName, routes)
}

function routesLiteral(routes: Record<string, string>): string {
	const entries = Object.entries(routes).map(([path, name]) => `"${path}": "${name}"`)
	return `{ ${entries.join(', ')} }`
}

function reactCompositionHost(appName: string, routes: Record<string, string>): string {
	return `import { useLocation, navigate, matchRoute } from "@/navigation";
import { Remote } from "@/federation";

// Map url prefixes to remote names. Edit freely. For a region that stays put,
// render <Remote name="..." /> outside the routed <main>.
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

function svelteCompositionHost(appName: string, routes: Record<string, string>): string {
	return `<script lang="ts">
  import { location, navigate, matchRoute } from "@/navigation";
  import { Remote } from "@/federation";

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

function vueCompositionHost(appName: string, routes: Record<string, string>): string {
	return `<script setup lang="ts">
import { computed } from "vue";
import { useLocation, navigate, matchRoute } from "@/navigation";
import { Remote } from "@/federation";

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
