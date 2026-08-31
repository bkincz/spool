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
