/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { TOOLCHAIN } from '../core/versions.js'
import { compareVersions, rangeFloor } from '../util/semver.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
interface PackageJson {
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
}

const cli = createRequire(import.meta.url)('../../package.json') as PackageJson

/*
 *   TOOLCHAIN DRIFT
 ***************************************************************************************************/
describe('TOOLCHAIN', () => {
	it('does not fall a major behind the versions the CLI itself runs', () => {
		const own = { ...cli.dependencies, ...cli.devDependencies }
		let checked = 0

		for (const [dep, range] of Object.entries(TOOLCHAIN)) {
			const mine = own[dep]
			if (mine === undefined) continue

			const floor = rangeFloor(range)
			const theirs = rangeFloor(mine)
			expect(floor, `TOOLCHAIN.${dep} is ${range}`).not.toBeNull()
			expect(theirs, `the cli's own ${dep} is ${mine}`).not.toBeNull()

			const where = `${dep}: TOOLCHAIN ${range}, cli ${mine}`
			expect(compareVersions(floor!, theirs!), where).toBeLessThanOrEqual(0)
			expect(theirs![0] - floor![0], where).toBeLessThanOrEqual(1)
			checked++
		}

		expect(
			checked,
			'no TOOLCHAIN dep overlaps the CLI, so this test proves nothing'
		).toBeGreaterThan(0)
	})
})
