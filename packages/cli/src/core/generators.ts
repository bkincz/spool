/*
 *   IMPORTS
 ***************************************************************************************************/
import type { AppConfig, Manifest } from './config.js'
import { TOOLCHAIN } from './versions.js'

/*
 *   TYPES
 ***************************************************************************************************/
/** A flat map of relative file path -> file contents. */
export type FileMap = Record<string, string>

/*
 *   HELPERS
 ***************************************************************************************************/
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const sharedJson = (shared: string[]): string => JSON.stringify(shared)

/** Ambient module declarations so hosts can `import` their remotes' exposes. */
const remoteTypings = (remotes: string[]): string =>
	remotes
		.map(
			r =>
				`declare module "${r}/App" {\n  const Component: React.ComponentType;\n  export default Component;\n}\n`
		)
		.join('')

/** The house Prettier config, shared with every scaffolded workspace. */
const prettierConfig = (): string =>
	json({
		arrowParens: 'avoid',
		bracketSpacing: true,
		endOfLine: 'auto',
		printWidth: 100,
		semi: false,
		singleQuote: true,
		tabWidth: 4,
		trailingComma: 'es5',
		useTabs: true,
	})

/*
 *   WORKSPACE FILES
 ***************************************************************************************************/
/** Workspace-root files, generated once by `spool create`. */
export function workspaceFiles(m: Manifest): FileMap {
	const files: FileMap = {
		'spool.json': json(m),
		'.prettierrc': prettierConfig(),
		'package.json': workspacePackageJson(m),
		'.gitignore': gitignore(m),
		'tsconfig.base.json': json({
			compilerOptions: {
				target: 'ES2022',
				lib: ['ES2022', 'DOM', 'DOM.Iterable'],
				module: 'ESNext',
				moduleResolution: 'Bundler',
				jsx: 'react-jsx',
				strict: true,
				skipLibCheck: true,
				esModuleInterop: true,
				forceConsistentCasingInFileNames: true,
				isolatedModules: true,
				noEmit: true,
			},
		}),
		'README.md': workspaceReadme(m),
	}

	// pnpm declares its workspace (and its postinstall-script allowlist) in a
	// dedicated file; npm and yarn read a `workspaces` field in package.json.
	if (m.packageManager === 'pnpm') {
		files['pnpm-workspace.yaml'] =
			`packages:\n  - "apps/*"\n  - "packages/*"\n\n# esbuild (via vite) needs its postinstall to fetch the platform binary.\nallowBuilds:\n  esbuild: true\n`
	}

	// Yarn Berry (v3+) defaults to Plug'n'Play, which Vite and Module Federation
	// do not resolve cleanly. Pin the node_modules linker so federation works.
	// Yarn Classic (v1) ignores this file and already uses node_modules, so the
	// same workspace scaffolds correctly under either Yarn version.
	if (m.packageManager === 'yarn') {
		files['.yarnrc.yml'] =
			`# Use the node_modules linker instead of Plug'n'Play so Vite and Module\n# Federation resolve dependencies the way they expect. Honored by Yarn 3+;\n# Yarn 1 ignores this file and already uses node_modules.\nnodeLinker: node-modules\n`
	}
	return files
}

function gitignore(m: Manifest): string {
	const base = `node_modules/\ndist/\n*.tsbuildinfo\n.DS_Store\n*.log\n`
	if (m.packageManager !== 'yarn') return base
	// Yarn Berry writes these; the allowlist keeps committed Berry assets while
	// ignoring the cache and PnP files. Harmless under Yarn Classic.
	return `${base}\n# Yarn Berry\n.yarn/*\n!.yarn/patches\n!.yarn/plugins\n!.yarn/releases\n!.yarn/sdks\n!.yarn/versions\n.pnp.*\n`
}

function workspacePackageJson(m: Manifest): string {
	const pkg: Record<string, unknown> = {
		name: m.name,
		version: '0.0.0',
		private: true,
		type: 'module',
		scripts: {
			dev: 'spool dev',
			build: 'spool build',
			doctor: 'spool doctor',
		},
	}
	if (m.packageManager !== 'pnpm') {
		pkg.workspaces = ['apps/*', 'packages/*']
	}
	return json(pkg)
}

function workspaceReadme(m: Manifest): string {
	return `# ${m.name}\n\nMicro-frontend workspace scaffolded with [spool](https://github.com/bkincz/spool).\n\n## Commands\n\n\`\`\`bash\n${m.packageManager} install   # install all apps\nspool dev        # run host + remotes together\nspool build      # coordinated production build\nspool add <name> # add a host or remote app\nspool doctor     # check config drift / shared-dep mismatches\n\`\`\`\n`
}

/*
 *   APP FILES
 ***************************************************************************************************/
export function appFiles(
	m: Manifest,
	appName: string,
	app: AppConfig,
	resolveRemotePort: (name: string) => number
): FileMap {
	const isHost = app.type === 'host'
	const files: FileMap = {
		'package.json': appPackageJson(appName),
		'tsconfig.json': appTsConfig(),
		'vite.config.ts': viteConfig(m, appName, app, resolveRemotePort),
		'index.html': indexHtml(appName),
		'src/main.tsx': mainTsx(),
		'src/App.tsx': isHost ? hostApp(appName, app.remotes) : remoteApp(appName),
		'src/vite-env.d.ts': `/// <reference types="vite/client" />\n`,
	}
	if (isHost && app.remotes.length) {
		files['src/remotes.d.ts'] = remoteTypings(app.remotes)
	}
	return files
}

/** Files that must be rewritten on a host when its remotes change. */
export function hostWiringFiles(
	m: Manifest,
	hostName: string,
	host: AppConfig,
	resolveRemotePort: (name: string) => number
): FileMap {
	const files: FileMap = {
		'vite.config.ts': viteConfig(m, hostName, host, resolveRemotePort),
	}
	if (host.remotes.length) {
		files['src/remotes.d.ts'] = remoteTypings(host.remotes)
	}
	return files
}

/*
 *   FILE BUILDERS
 ***************************************************************************************************/
function appPackageJson(appName: string): string {
	return json({
		name: appName,
		version: '0.0.0',
		private: true,
		type: 'module',
		scripts: {
			dev: 'vite',
			build: 'vite build',
			preview: 'vite preview',
		},
		dependencies: {
			react: TOOLCHAIN.react,
			'react-dom': TOOLCHAIN['react-dom'],
		},
		devDependencies: {
			'@module-federation/vite': TOOLCHAIN['@module-federation/vite'],
			'@types/react': TOOLCHAIN['@types/react'],
			'@types/react-dom': TOOLCHAIN['@types/react-dom'],
			'@vitejs/plugin-react': TOOLCHAIN['@vitejs/plugin-react'],
			typescript: TOOLCHAIN.typescript,
			vite: TOOLCHAIN.vite,
		},
	})
}

function appTsConfig(): string {
	return json({
		extends: '../../tsconfig.base.json',
		include: ['src', 'vite.config.ts'],
	})
}

function viteConfig(
	m: Manifest,
	appName: string,
	app: AppConfig,
	resolveRemotePort: (name: string) => number
): string {
	const isHost = app.type === 'host'
	const remotesEntries = app.remotes
		.map(
			r =>
				`      ${JSON.stringify(r)}: "http://localhost:${resolveRemotePort(r)}/mf-manifest.json",`
		)
		.join('\n')
	const exposesEntries = Object.entries(app.exposes)
		.map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
		.join('\n')

	const federationOpts = [
		`    name: ${JSON.stringify(appName)},`,
		isHost
			? `    remotes: {\n${remotesEntries}\n    },`
			: `    filename: "remoteEntry.js",\n    exposes: {\n${exposesEntries}\n    },`,
		`    shared: ${sharedJson(m.shared)},`,
	].join('\n')

	return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { federation } from "@module-federation/vite";

// Generated by spool. Federation wiring is derived from spool.json.
// Run \`spool doctor\` after editing remotes, exposes or shared deps there.
export default defineConfig({
  server: { port: ${app.port}, strictPort: true },
  preview: { port: ${app.port}, strictPort: true },
  plugins: [
    react(),
    federation({
${federationOpts}
    }),
  ],
  // Module Federation needs top-level await; lock the build target.
  build: { target: "esnext", minify: false },
});
`
}

function indexHtml(appName: string): string {
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${appName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

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

function hostApp(appName: string, remotes: string[]): string {
	const imports = remotes
		.map(r => `const ${pascal(r)} = lazy(() => import("${r}/App"));`)
		.join('\n')
	const mounts = remotes
		.map(
			r =>
				`        <section>
          <h2>${r}</h2>
          <Suspense fallback={<p>Loading ${r}…</p>}>
            <${pascal(r)} />
          </Suspense>
        </section>`
		)
		.join('\n')
	const noRemotes = `// No remotes wired yet. Add one with \`spool add <name> --host ${appName}\`.`
	return `import { lazy, Suspense } from "react";

${imports || noRemotes}

export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>${appName} (host)</h1>
${mounts || '      <p>No remotes mounted yet.</p>'}
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

function pascal(s: string): string {
	return s
		.replace(/[-_ ]+/g, ' ')
		.split(' ')
		.filter(Boolean)
		.map(w => w[0]!.toUpperCase() + w.slice(1))
		.join('')
}
