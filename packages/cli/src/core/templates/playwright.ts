/*
 *   IMPORTS
 ***************************************************************************************************/
import type { Manifest } from '../config.js'
import type { FileMap } from '../filemap.js'
import { ADDON_DEPS, NODE_RANGE, TOOLCHAIN } from '../versions.js'
import { json } from '../../util/json.js'
import { STATE_COUNT_TESTID, STATE_COUNT_TEXT } from './bridges.js'
import type { TemplateExtras } from './types.js'

/*
 *   PLAYWRIGHT
 ***************************************************************************************************/
export function playwrightFiles(m: Manifest, extras: TemplateExtras): FileMap {
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
	const stateTest =
		extras.stateExample && host.remotes.length
			? `

test("remote clicks update the shell's shared state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("${STATE_COUNT_TESTID}")).toHaveText("${STATE_COUNT_TEXT} 0");
  await page.getByRole("button", { name: "Increment" }).first().click();
  await expect(page.getByTestId("${STATE_COUNT_TESTID}")).toHaveText("${STATE_COUNT_TEXT} 1");
});`
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
});${stateTest}
`,
	}
}
