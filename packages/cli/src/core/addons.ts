// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   CREATE ADDONS
 ***************************************************************************************************/
import type { Manifest } from './config.js'
import { NODE_RANGE, type FileMap } from './generators.js'
import { TOOLCHAIN } from './versions.js'

const ADDON_DEPS = {
	'@ladle/react': '^5.1.0',
	'@playwright/test': '^1.61.0',
} as const

/*
 *   TYPES
 ***************************************************************************************************/
export interface Addon {
	label: string
	hint: string
	/** Why this addon cannot be added to the workspace, or undefined when it can. */
	unavailable(m: Manifest): string | undefined
	/** Mutates the manifest before anything is written (e.g. adds `shared` entries). */
	apply?(m: Manifest): void
	/** Files to write, relative to the workspace root. */
	files(m: Manifest): FileMap
	/** Dependencies whose postinstall scripts pnpm must allow. */
	allowBuilds: string[]
	/** Printed after scaffolding. */
	notes(m: Manifest): string[]
}

export const ADDONS: Record<'ladle' | 'playwright' | 'state', Addon> = {
	ladle: {
		label: 'Ladle',
		hint: 'design-system package in packages/ui with a component workshop',
		unavailable: m =>
			Object.values(m.apps).some(app => app.framework === 'react')
				? undefined
				: 'Ladle is react-based; it needs at least one react app in the workspace.',
		files: () => ladleFiles(),
		allowBuilds: ['@swc/core', 'msw'],
		notes: m => [`ladle: ${runIn(m, 'ui', 'ladle')} opens the component workshop`],
	},
	playwright: {
		label: 'Playwright',
		hint: 'e2e tests in packages/e2e that boot the workspace and check every remote',
		unavailable: m =>
			Object.values(m.apps).some(app => app.type === 'host')
				? undefined
				: 'Playwright e2e tests need a host app to visit.',
		files: m => playwrightFiles(m),
		allowBuilds: [],
		notes: m => [
			`playwright: run \`npx playwright install\` once, then ${runIn(m, 'e2e', 'test')}`,
		],
	},
	state: {
		label: 'Shared state',
		hint: 'a state machine every app shares as a federation singleton (@bkincz/clutch)',
		unavailable: () => undefined,
		apply: m => {
			const entries = ['@bkincz/clutch']
			if (Object.values(m.apps).some(app => app.framework === 'react')) {
				entries.push('@bkincz/clutch/react')
			}
			for (const entry of entries) {
				if (!m.shared.includes(entry)) m.shared.push(entry)
			}
		},
		files: m => stateFiles(m),
		allowBuilds: [],
		notes: m => [
			`state: every app got src/state/counter.ts; all copies resolve to one machine per page${
				Object.values(m.apps).some(app => app.framework === 'react')
					? ' (react apps: useMachine from "@bkincz/clutch/react")'
					: ''
			}`,
		],
	},
}

export type AddonName = keyof typeof ADDONS

export const ADDON_NAMES = Object.keys(ADDONS) as AddonName[]

/*
 *   HELPERS
 ***************************************************************************************************/
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

function runIn(m: Manifest, pkg: string, script: string): string {
	if (m.packageManager === 'pnpm') return `\`pnpm --filter ${pkg} ${script}\``
	if (m.packageManager === 'yarn') return `\`yarn workspace ${pkg} ${script}\``
	return `\`npm run ${script} --workspace ${pkg}\``
}

/*
 *   LADLE
 ***************************************************************************************************/
function ladleFiles(): FileMap {
	return {
		'packages/ui/package.json': json({
			name: 'ui',
			version: '0.0.0',
			private: true,
			type: 'module',
			main: './src/index.ts',
			engines: { node: NODE_RANGE },
			scripts: {
				ladle: 'ladle serve',
				'ladle:build': 'ladle build',
			},
			dependencies: {
				react: TOOLCHAIN.react,
				'react-dom': TOOLCHAIN['react-dom'],
			},
			devDependencies: {
				'@ladle/react': ADDON_DEPS['@ladle/react'],
				'@types/react': TOOLCHAIN['@types/react'],
				'@types/react-dom': TOOLCHAIN['@types/react-dom'],
				typescript: TOOLCHAIN.typescript,
			},
		}),
		'packages/ui/tsconfig.json': json({
			extends: '../../tsconfig.base.json',
			compilerOptions: { jsx: 'react-jsx' },
			include: ['src'],
		}),
		'packages/ui/src/index.ts': `export { Button, type ButtonProps } from "./Button";\n`,
		'packages/ui/src/Button.tsx': `import type { ReactNode } from "react";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
}

export function Button({ children, onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        font: "inherit",
        padding: "8px 16px",
        borderRadius: 6,
        border: "1px solid #ccc",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
`,
		'packages/ui/src/Button.stories.tsx': `import type { Story } from "@ladle/react";
import { Button } from "./Button";

export const Basic: Story = () => <Button>Click me</Button>;
`,
	}
}

/*
 *   SHARED STATE
 ***************************************************************************************************/
function stateFiles(m: Manifest): FileMap {
	// Every app gets its own copy; sharedMachine resolves all copies to one instance per page.
	const store = `import { createMachine, sharedMachine } from "@bkincz/clutch";

export interface CounterState {
  count: number;
}

// Bump \`contract\` when CounterState's shape changes; apps deployed against a
// different shape warn at runtime instead of corrupting each other's state.
export const counterMachine = sharedMachine(
  "${m.name}:counter",
  () => createMachine<CounterState>({ initialState: { count: 0 } }),
  { contract: 1 },
);
`
	const files: FileMap = {}
	for (const app of Object.values(m.apps)) {
		files[`${app.path}/src/state/counter.ts`] = store
	}
	return files
}

/*
 *   PLAYWRIGHT
 ***************************************************************************************************/
function playwrightFiles(m: Manifest): FileMap {
	const [hostName, host] = Object.entries(m.apps).find(([, app]) => app.type === 'host')!
	const origin = `http://localhost:${host.port}`

	const remoteChecks = host.remotes
		.map(
			remote => `
  await expect(page.getByRole("heading", { name: "${remote}" })).toBeVisible();`
		)
		.join('')
	// Proves the remotes actually loaded over federation, not just that the host rendered.
	const loadedCheck = host.remotes.length
		? `
  await expect(page.getByText(/exposed via Module Federation/)).toHaveCount(${host.remotes.length});`
		: ''

	return {
		'packages/e2e/package.json': json({
			name: 'e2e',
			version: '0.0.0',
			private: true,
			type: 'module',
			engines: { node: NODE_RANGE },
			scripts: {
				test: 'playwright test',
				'test:ui': 'playwright test --ui',
			},
			devDependencies: {
				'@playwright/test': ADDON_DEPS['@playwright/test'],
				'@types/node': TOOLCHAIN['@types/node'],
				typescript: TOOLCHAIN.typescript,
			},
		}),
		'packages/e2e/tsconfig.json': json({
			extends: '../../tsconfig.base.json',
			include: ['tests', 'playwright.config.ts'],
		}),
		'packages/e2e/playwright.config.ts': `import { defineConfig } from "@playwright/test";

// Boots the whole workspace (remotes first, then the host) and tests ${hostName}.
export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "${origin}" },
  webServer: {
    command: "${m.packageManager} run dev",
    url: "${origin}",
    cwd: "../..",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
`,
		[`packages/e2e/tests/${hostName}.spec.ts`]: `import { test, expect } from "@playwright/test";

test("${hostName} mounts every remote", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "${hostName} (host)" })).toBeVisible();${remoteChecks}${loadedCheck}
});
`,
	}
}
