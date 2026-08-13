/*
 *   SHARED TEST SETUP
 ***************************************************************************************************/
import { vi } from 'vitest'
import type * as ClackPrompts from '@clack/prompts'

// Silence clack's banners, which write straight to stdout, and answer the
// always-on addons prompt with nothing. prompts.test.ts re-mocks the module
// with its own stubs, which take precedence there.
vi.mock('@clack/prompts', async importOriginal => ({
	...(await importOriginal<typeof ClackPrompts>()),
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	multiselect: vi.fn(async () => []),
	spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}))
