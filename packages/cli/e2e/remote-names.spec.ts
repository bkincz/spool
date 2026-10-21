/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import { runCaptured } from '../src/util/exec.js'
import { WORKSPACE_ENV } from './fixture.js'

/*
 *   TESTS
 ***************************************************************************************************/
test('a misspelled remote name does not compile in the shell', async ({ browserName }) => {
	test.skip(browserName !== 'chromium', 'a compile does not depend on the browser')
	const workspace = process.env[WORKSPACE_ENV]
	if (!workspace) throw new Error(`${WORKSPACE_ENV} is not set; the global setup did not run`)

	// src/typos.tsx marks each misspelling @ts-expect-error, and an unused one is an error itself.
	const { code, output } = await runCaptured('pnpm', ['exec', 'tsc', '--noEmit', '-p', '.'], {
		cwd: join(workspace, 'apps/shell'),
	})
	expect(output).toBe('')
	expect(code).toBe(0)
})
