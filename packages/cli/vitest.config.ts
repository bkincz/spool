/*
 *   IMPORTS
 ***************************************************************************************************/
import { defineConfig } from 'vitest/config'

/*
 *   VITEST CONFIG
 ***************************************************************************************************/
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.{test,spec}.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			include: ['src/**/*.ts'],
			exclude: ['src/index.ts', 'src/__tests__/**', '**/*.d.ts', '**/*.config.*', 'dist/**'],
		},
	},
})
