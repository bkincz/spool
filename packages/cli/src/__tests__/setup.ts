/*
 *   SHARED TEST SETUP
 ***************************************************************************************************/
import { vi } from 'vitest'

// Silence clack's banners, which write straight to stdout. prompts.test.ts
// re-mocks the module with its own stubs, which take precedence there.
vi.mock('@clack/prompts', async importOriginal => ({
	...(await importOriginal<typeof import('@clack/prompts')>()),
	intro: vi.fn(),
	outro: vi.fn(),
	cancel: vi.fn(),
	spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}))
