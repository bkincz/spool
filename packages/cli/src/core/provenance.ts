/*
 *   IMPORTS
 ***************************************************************************************************/
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { CLI_VERSION } from './versions.js'

/*
 *   TYPES
 ***************************************************************************************************/
export const PROVENANCE_FILE = join('.spool', 'generated.json')

/** Bumped when the file's shape changes. An older record is ignored, not migrated. */
const FORMAT = 1

interface ProvenanceFile {
	version: number
	writtenBy: string
	files: Record<string, string>
}

export type Ownership = 'ours' | 'edited' | 'unknown'

/*
 *   HASH
 ***************************************************************************************************/
export function hashContent(content: string): string {
	const normalised = content.split('\r\n').join('\n')
	return createHash('sha256').update(normalised, 'utf8').digest('hex')
}

/*
 *   PROVENANCE
 ***************************************************************************************************/
export class Provenance {
	private dirty = false

	private constructor(
		private readonly root: string,
		private readonly files: Record<string, string>
	) { }

	/** A record spool cannot read is treated as absent, never as a conflict. */
	static load(root: string): Provenance {
		const target = join(root, PROVENANCE_FILE)

		if (!existsSync(target)) return new Provenance(root, {})

		try {
			const parsed = JSON.parse(readFileSync(target, 'utf8')) as ProvenanceFile
			if (parsed.version !== FORMAT) return new Provenance(root, {})

			return new Provenance(root, { ...parsed.files })
		} catch {
			return new Provenance(root, {})
		}
	}

	ownership(dir: string, rel: string, existing: string): Ownership {
		const stored = this.files[this.key(dir, rel)]

		if (stored === undefined) return 'unknown'

		return stored === hashContent(existing) ? 'ours' : 'edited'
	}

	record(dir: string, rel: string, content: string): void {
		const key = this.key(dir, rel)
		const hash = hashContent(content)

		if (this.files[key] === hash) return

		this.files[key] = hash
		this.dirty = true
	}

	async save(): Promise<void> {
		if (!this.dirty) return

		const target = join(this.root, PROVENANCE_FILE)
		await mkdir(dirname(target), { recursive: true })

		const payload: ProvenanceFile = {
			version: FORMAT,
			writtenBy: CLI_VERSION,
			// Sorted so committing this file produces a readable diff.
			files: Object.fromEntries(
				Object.entries(this.files).sort(([a], [b]) => a.localeCompare(b))
			),
		}

		await writeFile(target, `${JSON.stringify(payload, null, '\t')}\n`, 'utf8')

		this.dirty = false
	}

	private key(dir: string, rel: string): string {
		return relative(this.root, join(dir, rel)).split(sep).join('/')
	}
}
