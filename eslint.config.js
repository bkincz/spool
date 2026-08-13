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
			'@typescript-eslint/no-explicit-any': 'warn',
			'@typescript-eslint/consistent-type-imports': [
				'error',
				{ fixStyle: 'inline-type-imports' },
			],
			'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
			'no-var': 'error',
			eqeqeq: ['error', 'always'],
			'no-duplicate-imports': 'error',
			'prefer-template': 'error',
		},
	},
	{
		files: ['packages/*/src/**/__tests__/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
])
