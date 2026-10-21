/*
 *   IMPORTS
 ***************************************************************************************************/
import { defineConfig, devices } from '@playwright/test'

/*
 *   PLAYWRIGHT CONFIG
 ***************************************************************************************************/
export default defineConfig({
	testDir: '.',
	globalSetup: './global-setup.ts',
	timeout: 30_000,
	// Every worker shares the fixture's three dev servers, which slow down under load.
	expect: { timeout: 15_000 },
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [['list'], ['github']] : 'list',
	outputDir: '../test-results',
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
})
