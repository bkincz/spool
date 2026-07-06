// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   REACT TEMPLATES
 ***************************************************************************************************/
import { pascalCase } from '../../util/names.js'
import type { FrameworkTemplate, MountHint, RemoteRef } from './index.js'

export const reactTemplate: FrameworkTemplate = {
	exposeEntry: './src/App.tsx',
	htmlEntry: '/src/main.tsx',
	viteEnv: `/// <reference types="vite/client" />\n`,
	compilerOptions: { jsx: 'react-jsx' },
	vitePlugin: { importLine: 'import react from "@vitejs/plugin-react";', call: 'react()' },
	remoteTyping: name =>
		`declare module "${name}/App" {\n  const Component: React.ComponentType;\n  export default Component;\n}\n`,
	sourceFiles: (appName, isHost, refs) => ({
		'src/main.tsx': mainTsx(),
		'src/App.tsx': isHost ? hostApp(appName, refs) : remoteApp(appName),
	}),
	bridgeFiles: () => ({}),
	mountHint,
}

/*
 *   FILE BUILDERS
 ***************************************************************************************************/
function mainTsx(): string {
	return `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
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

function hostApp(appName: string, refs: RemoteRef[]): string {
	const reactRefs = refs.filter(r => r.framework === 'react')
	const mountRefs = refs.filter(r => r.framework !== 'react')

	const imports = [
		...reactRefs.map(r => `const ${pascalCase(r.name)} = lazy(() => import("${r.name}/App"));`),
		...mountRefs.map(r => `const load${pascalCase(r.name)} = () => import("${r.name}/App");`),
	].join('\n')

	const sections = refs
		.map(r =>
			r.framework === 'react'
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

${imports || noRemotes}
${mountRefs.length ? `\n${MOUNT_REMOTE_COMPONENT}\n` : ''}
export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>${appName} (host)</h1>
${sections || '      <p>No remotes mounted yet.</p>'}
    </main>
  );
}
`
}

function remoteApp(appName: string): string {
	return `export default function App() {
  return (
    <div style={{ fontFamily: "system-ui", padding: 16, border: "1px solid #ccc" }}>
      <strong>${appName}</strong>: a remote module exposed via Module Federation.
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
	const intro = `To mount it, edit apps/${hostName}/src/App.tsx:`
	if (ref.framework === 'react') {
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
