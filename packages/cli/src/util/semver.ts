/*
 *   SEMVER
 ***************************************************************************************************/
/** Major, minor, patch. */
export type Version = [number, number, number]

const SIMPLE_RANGE = /^(?:\^|~|>=|>|=)?\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z-.]+)?$/

export function compareVersions(a: Version, b: Version): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export function rangeFloor(range: string): Version | null {
	let lowest: Version | null = null

	// A union permits everything its lowest alternative permits.
	for (const alternative of range.split('||')) {
		const match = SIMPLE_RANGE.exec(alternative.trim())
		if (!match) return null

		const version: Version = [+match[1]!, +match[2]!, +match[3]!]
		if (!lowest || compareVersions(version, lowest) < 0) lowest = version
	}

	return lowest
}

export function isUpgrade(from: string | undefined, to: string): boolean {
	if (from === undefined) return true
	if (from === to) return false

	const current = rangeFloor(from)
	const next = rangeFloor(to)

	if (!current || !next) return false
	return compareVersions(next, current) > 0
}

export function maxRange(ranges: Iterable<string>): string | null {
	let best: string | null = null
	let bestFloor: Version | null = null

	for (const range of ranges) {
		const floor = rangeFloor(range)

		if (!floor) continue
		if (!bestFloor || compareVersions(floor, bestFloor) > 0) {
			best = range
			bestFloor = floor
		}
	}

	return best
}

export function satisfies(version: string, range: string): boolean | null {
	if (range.includes('||')) return null

	const target = rangeFloor(version)
	const floor = rangeFloor(range)

	if (!target || !floor) return null

	const trimmed = range.trim()

	if (trimmed.startsWith('>=')) return compareVersions(target, floor) >= 0
	if (trimmed.startsWith('>')) return compareVersions(target, floor) > 0
	if (compareVersions(target, floor) < 0) return false

	// Caret keeps the leftmost non-zero part, so ^1.2.3 spans 1.x but ^0.2.3
	// only spans 0.2.x and ^0.0.3 only itself.
	if (trimmed.startsWith('^')) {
		if (floor[0] !== 0) return target[0] === floor[0]
		if (floor[1] !== 0) return target[0] === 0 && target[1] === floor[1]
		return target[0] === 0 && target[1] === 0 && target[2] === floor[2]
	}
	if (trimmed.startsWith('~')) return target[0] === floor[0] && target[1] === floor[1]

	return compareVersions(target, floor) === 0
}
