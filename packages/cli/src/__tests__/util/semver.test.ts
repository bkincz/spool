/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect } from 'vitest'
import { isLocalOverride, isUpgrade, maxRange, rangeFloor } from '../../util/semver.js'

/*
 *   RANGE FLOOR
 ***************************************************************************************************/
describe('rangeFloor', () => {
	it('reads the floor off the operators spool emits', () => {
		expect(rangeFloor('^19.2.0')).toEqual([19, 2, 0])
		expect(rangeFloor('~5.6.3')).toEqual([5, 6, 3])
		expect(rangeFloor('>=22.12.0')).toEqual([22, 12, 0])
		expect(rangeFloor('3.3.1')).toEqual([3, 3, 1])
	})

	it('takes the lowest alternative of a union', () => {
		expect(rangeFloor('^20.19.0 || >=22.12.0')).toEqual([20, 19, 0])
	})

	it('gives up on ranges it cannot reduce to one floor', () => {
		for (const range of [
			'>=5.0.0 <7.0.0',
			'workspace:*',
			'catalog:',
			'npm:react@19.2.0',
			'*',
			'latest',
			'file:../local',
			'github:acme/pkg',
		]) {
			expect(rangeFloor(range)).toBeNull()
		}
	})
})

/*
 *   IS UPGRADE
 ***************************************************************************************************/
/*
 *   LOCAL OVERRIDE
 ***************************************************************************************************/
describe('isLocalOverride', () => {
	it('spots a range that names a source rather than a version', () => {
		expect(isLocalOverride('link:../../tools/cli')).toBe(true)
		expect(isLocalOverride('file:../pkg')).toBe(true)
		expect(isLocalOverride('workspace:*')).toBe(true)
		expect(isLocalOverride('catalog:default')).toBe(true)
		expect(isLocalOverride('npm:@scope/other@^1.0.0')).toBe(true)
		expect(isLocalOverride('github:owner/repo')).toBe(true)
	})

	it('leaves ordinary ranges alone', () => {
		expect(isLocalOverride('^2.7.3')).toBe(false)
		expect(isLocalOverride('~1.0.0')).toBe(false)
		expect(isLocalOverride('19.2.0')).toBe(false)
		expect(isLocalOverride(undefined)).toBe(false)
	})
})

describe('isUpgrade', () => {
	it('adds a dep that is not there yet', () => {
		expect(isUpgrade(undefined, '^19.2.0')).toBe(true)
	})

	it('moves forward but never back', () => {
		expect(isUpgrade('^18.3.1', '^19.2.0')).toBe(true)
		expect(isUpgrade('^19.2.0', '^18.3.1')).toBe(false)
		expect(isUpgrade('^19.2.0', '^19.2.0')).toBe(false)
	})

	it('compares minor and patch, not just major', () => {
		expect(isUpgrade('^3.3.1', '^3.5.0')).toBe(true)
		expect(isUpgrade('^3.5.0', '^3.3.1')).toBe(false)
		expect(isUpgrade('^3.3.1', '^3.3.2')).toBe(true)
	})

	it('treats narrowing a union as a step forward', () => {
		expect(isUpgrade('^20.19.0 || >=22.12.0', '>=22.12.0')).toBe(true)
	})

	it('leaves a range it cannot compare alone', () => {
		expect(isUpgrade('workspace:*', '^19.2.0')).toBe(false)
		expect(isUpgrade('^19.2.0', 'workspace:*')).toBe(false)
	})

	it('does not swap a prerelease for its own release', () => {
		expect(isUpgrade('^7.0.0-beta.1', '^7.0.0')).toBe(false)
	})
})

/*
 *   MAX RANGE
 ***************************************************************************************************/
describe('maxRange', () => {
	it('picks the highest floor and returns it verbatim', () => {
		expect(maxRange(['^19.2.0', '^21.0.0', '^18.3.1'])).toBe('^21.0.0')
	})

	it('skips ranges it cannot compare', () => {
		expect(maxRange(['workspace:*', '^19.2.0'])).toBe('^19.2.0')
	})

	it('is null when nothing is comparable', () => {
		expect(maxRange(['workspace:*', 'latest'])).toBeNull()
		expect(maxRange([])).toBeNull()
	})

	it('never picks a ">=" range as the alignment target, even if it is highest', () => {
		expect(maxRange(['^19.2.0', '>=21.0.0'])).toBe('^19.2.0')
	})

	it('never picks a bare ">" range as the alignment target', () => {
		expect(maxRange(['^19.2.0', '>21.0.0'])).toBe('^19.2.0')
	})

	it('never picks a prerelease as the alignment target', () => {
		expect(maxRange(['^19.2.0', '^22.0.0-beta.1'])).toBe('^19.2.0')
	})

	it('is null when every candidate is unpinnable, not just uncomparable', () => {
		expect(maxRange(['>=1.0.0', '^2.0.0-beta.1'])).toBeNull()
	})
})
