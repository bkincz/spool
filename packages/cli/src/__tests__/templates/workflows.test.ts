/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { ciWorkflows } from '../../core/templates/workflows.js'
import { makeManifest, host, remote } from '../helpers.js'

/*
 *   RAW GENERATION (before spool's formatter re-quotes anything)
 ***************************************************************************************************/
describe('ciWorkflows (raw)', () => {
	const m = makeManifest({
		shell: host({ remotes: ['dashboard'], deploy: 'deploy-shell-cmd' }),
		dashboard: remote({ deploy: 'wrangler pages deploy dist --project-name=dash' }),
	})

	it('quotes every interpolated value with JSON.stringify', () => {
		const yaml = ciWorkflows(m)['.github/workflows/deploy-dashboard.yml']!

		expect(yaml).toContain('working-directory: "apps/dashboard"')
		expect(yaml).toContain('run: "wrangler pages deploy dist --project-name=dash"')
		expect(yaml).toContain('node-version: "22"')
		expect(yaml).toContain('cache: "pnpm"')
	})

	it('quotes a deploy command that itself contains a colon or quotes', () => {
		const tricky = makeManifest({
			dashboard: remote({ deploy: 'echo "release: v1" && wrangler deploy' }),
		})
		const yaml = ciWorkflows(tricky)['.github/workflows/deploy-dashboard.yml']!

		expect(yaml).toContain(JSON.stringify('echo "release: v1" && wrangler deploy'))
	})

	it('sets contents:read permissions and a concurrency group on both workflows', () => {
		const check = ciWorkflows(m)['.github/workflows/ci.yml']!
		const deploy = ciWorkflows(m)['.github/workflows/deploy-dashboard.yml']!

		for (const yaml of [check, deploy]) {
			expect(yaml).toContain('permissions:\n    contents: read')
			expect(yaml).toContain('concurrency:')
			expect(yaml).toContain('cancel-in-progress: true')
		}
	})

	it('sets persist-credentials: false on the checkout step', () => {
		const yaml = ciWorkflows(m)['.github/workflows/ci.yml']!
		expect(yaml).toContain('persist-credentials: false')
	})

	it('makes the deploy job need the check job', () => {
		const yaml = ciWorkflows(m)['.github/workflows/deploy-dashboard.yml']!
		expect(yaml.indexOf('check:')).toBeLessThan(yaml.indexOf('needs: check'))
	})

	it('keeps workflow_dispatch on both workflows', () => {
		expect(ciWorkflows(m)['.github/workflows/ci.yml']).toContain('workflow_dispatch:')
		expect(ciWorkflows(m)['.github/workflows/deploy-dashboard.yml']).toContain(
			'workflow_dispatch:'
		)
	})

	describe('path filters', () => {
		it('includes the app folder and workspace-level files', () => {
			const yaml = ciWorkflows(m)['.github/workflows/deploy-dashboard.yml']!

			expect(yaml).toContain('"apps/dashboard/**"')
			expect(yaml).toContain('"spool.json"')
			expect(yaml).toContain('"spool.vite.ts"')
			expect(yaml).toContain('"spool.workspace.ts"')
			expect(yaml).toContain('"tsconfig.base.json"')
			expect(yaml).toContain('"pnpm-lock.yaml"')
		})

		it('falls back to packages/** with no package globs given', () => {
			const yaml = ciWorkflows(m)['.github/workflows/deploy-dashboard.yml']!
			expect(yaml).toContain('"packages/**"')
			expect(yaml).not.toContain('"apps/shell/**"')
		})

		it('uses the given package globs, excluding other apps own folders', () => {
			const yaml = ciWorkflows(m, {}, { packageGlobs: ['packages/ui', 'apps/shell'] })[
				'.github/workflows/deploy-dashboard.yml'
			]!
			expect(yaml).toContain('"packages/ui/**"')
			expect(yaml).not.toContain('"apps/shell/**"')
		})

		it('has no path filters on the check workflow', () => {
			expect(ciWorkflows(m)['.github/workflows/ci.yml']).not.toContain('paths:')
		})
	})

	describe('node version and pins', () => {
		it('defaults the node version to the fallback', () => {
			expect(ciWorkflows(m)['.github/workflows/ci.yml']).toContain('node-version: "22"')
		})

		it('uses a given node version', () => {
			const yaml = ciWorkflows(m, {}, { nodeVersion: '20.10.0' })['.github/workflows/ci.yml']!
			expect(yaml).toContain('node-version: "20.10.0"')
		})

		it('leaves actions on their tag when no pins are given', () => {
			expect(ciWorkflows(m)['.github/workflows/ci.yml']).toContain('actions/checkout@v7')
		})

		it('uses a given pin for the actions it covers', () => {
			const yaml = ciWorkflows(
				m,
				{},
				{ pins: { checkout: 'actions/checkout@deadbeef # v7' } }
			)['.github/workflows/ci.yml']!
			expect(yaml).toContain('actions/checkout@deadbeef # v7')
			// setup-node was not pinned, so it still falls back to its tag.
			expect(yaml).toContain('actions/setup-node@v6')
		})
	})

	describe('the check workflow', () => {
		const scripts = { build: 'spool build', doctor: 'spool doctor', lint: 'eslint .' }

		it('runs the root scripts that exist, in a sensible order', () => {
			const yaml = ciWorkflows(m, scripts)['.github/workflows/ci.yml']!
			expect(yaml.indexOf('run doctor')).toBeLessThan(yaml.indexOf('run lint'))
			expect(yaml.indexOf('run lint')).toBeLessThan(yaml.indexOf('run build'))
		})

		it('leaves out a script the workspace does not have', () => {
			const yaml = ciWorkflows(m, scripts)['.github/workflows/ci.yml']!
			expect(yaml).not.toContain('run test')
			expect(yaml).not.toContain('run type-check')
		})

		it('skips the pnpm setup action for npm', () => {
			const npm = makeManifest({ dashboard: remote() })
			npm.packageManager = 'npm'
			const yaml = ciWorkflows(npm, scripts)['.github/workflows/ci.yml']!

			expect(yaml).toContain('npm ci')
			expect(yaml).not.toContain('pnpm/action-setup')
		})
	})
})
