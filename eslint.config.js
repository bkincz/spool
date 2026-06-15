import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
	globalIgnores(['**/dist', '**/node_modules', '**/coverage']),
	{
		files: ['packages/*/src/**/*.{ts,tsx}'],
		extends: [js.configs.recommended, tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: globals.node,
		},
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
			],
			'prefer-const': 'error',
			'no-var': 'error',
			eqeqeq: ['error', 'always'],
			'no-duplicate-imports': 'error',
			'prefer-template': 'error',
		},
	},
])
