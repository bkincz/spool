/*
 *   IMPORTS
 ***************************************************************************************************/
import { defineConfig } from 'vitest/config'

/*
 *   INTEGRATION CONFIG
 ***************************************************************************************************/
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.integration.test.ts'],
		testTimeout: 40000,
		hookTimeout: 40000,
		fileParallelism: false,
	},
})
