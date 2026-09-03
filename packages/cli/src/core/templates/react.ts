// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   REACT TEMPLATES
 ***************************************************************************************************/
import { pascalCase } from '../../util/names.js'
import { STATE_COUNT_TESTID, STATE_COUNT_TEXT, STATE_STORE_IMPORT } from './bridges.js'
import { compositionHostApp } from './composition.js'
import type { FrameworkTemplate, MountHint, RemoteRef, TemplateExtras } from './types.js'

export const reactTemplate: FrameworkTemplate = {
	remoteContract: 'component',
	exposeEntry: './src/app/app.tsx',
	htmlEntry: '/src/main.tsx',
	viteEnv: `/// <reference types="vite/client" />\n`,
	compilerOptions: { jsx: 'react-jsx' },
	vitePlugin: { importLine: 'import react from "@vitejs/plugin-react";', call: 'react()' },
	remoteTyping: name =>
		`declare module "${name}/App" {\n  const Component: React.ComponentType;\n  export default Component;\n}\n`,
	sourceFiles: (appName, isHost, refs, extras) => ({
		'src/main.tsx': mainTsx(extras),
		'src/app/app.tsx': isHost ? hostAppFile(appName, refs, extras) : remoteApp(appName, extras),
		'src/app/app.module.css': appStyles(),
	}),
	bridgeFiles: () => ({}),
	mountHint,
}

/*
 *   FILE BUILDERS
 ***************************************************************************************************/
function mainTsx(extras: TemplateExtras): string {
	const sentryImport = extras.sentry ? `import { initSentry } from "./sentry";\n` : ''
	const sentryCall = extras.sentry ? `initSentry();\n\n` : ''
	return `${sentryImport}import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/app/app";

${sentryCall}createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`
}

const MOUNT_REMOTE_COMPONENT = `// Renders a remote that exposes a mount function instead of a component,
// the contract non-react remotes use.
function MountRemote({ load }: { load: () => Promise<{ default: (el: HTMLElement) => () => void }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void load().then(({ default: mount }) => {
      if (!cancelled && ref.current) cleanup = mount(ref.current);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [load]);
  return <div ref={ref} />;
}`

function appStyles(): string {
	return `.app {
  font-family: system-ui;
  padding: 1rem;
  border: 1px solid #ccc;
}

.host {
  font-family: system-ui;
  padding: 1.5rem;
}
`
}

function hostAppFile(appName: string, refs: RemoteRef[], extras: TemplateExtras): string {
	return extras.composed
		? compositionHostApp('react', appName, refs)
		: hostApp(appName, refs, extras)
}

function hostApp(appName: string, refs: RemoteRef[], extras: TemplateExtras): string {
	const reactRefs = refs.filter(r => r.contract === 'component')
	const mountRefs = refs.filter(r => r.contract === 'mount')

	const stateImports = extras.stateExample
		? `import { useMachine } from "@bkincz/clutch/react";\nimport { counterMachine } from "${STATE_STORE_IMPORT}";\n`
		: ''
	const stateHook = extras.stateExample ? `  const { state } = useMachine(counterMachine);\n` : ''
	const stateLine = extras.stateExample
		? `\n      <p data-testid="${STATE_COUNT_TESTID}">${STATE_COUNT_TEXT} {state.count}</p>`
		: ''

	const imports = [
		...reactRefs.map(r => `const ${pascalCase(r.name)} = lazy(() => import("${r.name}/App"));`),
		...mountRefs.map(r => `const load${pascalCase(r.name)} = () => import("${r.name}/App");`),
	].join('\n')

	const sections = refs
		.map(r =>
			r.contract === 'component'
				? `        <section>
          <h2>${r.name}</h2>
          <Suspense fallback={<p>Loading ${r.name}...</p>}>
            <${pascalCase(r.name)} />
          </Suspense>
        </section>`
				: `        <section>
          <h2>${r.name}</h2>
          <MountRemote load={load${pascalCase(r.name)}} />
        </section>`
		)
		.join('\n')

	const reactImports = ['lazy', 'Suspense', ...(mountRefs.length ? ['useEffect', 'useRef'] : [])]
	const noRemotes = `// No remotes wired yet. Add one with \`spool add <name> --host ${appName}\`.`

	return `import { ${reactImports.join(', ')} } from "react";
${stateImports}
${imports || noRemotes}

import styles from "./app.module.css";
${mountRefs.length ? `\n${MOUNT_REMOTE_COMPONENT}\n` : ''}
export default function App() {
${stateHook}  return (
    <main className={styles.host}>
      <h1>${appName} (host)</h1>${stateLine}
${sections || '      <p>No remotes mounted yet.</p>'}
    </main>
  );
}
`
}

function remoteApp(appName: string, extras: TemplateExtras): string {
	if (!extras.stateExample) {
		return `import styles from "./app.module.css";

export default function App() {
  return (
    <div className={styles.app}>
      <strong>${appName}</strong>: a remote module exposed via Module Federation.
    </div>
  );
}
`
	}

	const buttonImport = extras.uiButton ? `\nimport { Button } from "ui";` : ''
	const button = extras.uiButton
		? `<Button onClick={increment}>Increment</Button>`
		: `<button onClick={increment}>Increment</button>`

	return `import { useMachine } from "@bkincz/clutch/react";
import { counterMachine } from "${STATE_STORE_IMPORT}";${buttonImport}

import styles from "./app.module.css";

export default function App() {
  const { state, mutate } = useMachine(counterMachine);
  const increment = () =>
    mutate(draft => {
      draft.count += 1;
    });
  return (
    <div className={styles.app}>
      <p>
        <strong>${appName}</strong>: a remote module exposed via Module Federation.
      </p>
      <p>${STATE_COUNT_TEXT} {state.count}</p>
      ${button}
    </div>
  );
}
`
}

/*
 *   MOUNT HINT
 ***************************************************************************************************/
function mountHint(ref: RemoteRef, hostName: string): MountHint {
	const comp = pascalCase(ref.name)
	const intro = `To mount it, edit apps/${hostName}/src/app/app.tsx:`
	if (ref.contract === 'component') {
		return {
			intro,
			lines: [
				`const ${comp} = lazy(() => import("${ref.name}/App"))`,
				`// then render <${comp} /> inside a <Suspense> boundary`,
			],
		}
	}
	return {
		intro,
		lines: [
			`const load${comp} = () => import("${ref.name}/App");`,
			`// render <MountRemote load={load${comp}} /> where it belongs.`,
			`// MountRemote guards against unmounts racing the import. If App.tsx`,
			`// does not have it yet, paste it in and import useEffect and useRef:`,
			...MOUNT_REMOTE_COMPONENT.split('\n'),
		],
	}
}
