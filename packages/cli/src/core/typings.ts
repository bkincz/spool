/*
 *   IMPORTS
 ***************************************************************************************************/
import { join } from 'node:path'
import type { Workspace } from './workspace.js'
import { hostWiringFiles } from './generators.js'
import { OwnedWriter } from './fswrite.js'
import { formatFiles } from './format.js'
import { Provenance } from './provenance.js'

/*
 *   TYPINGS
 ***************************************************************************************************/
const TYPINGS_FILE = 'src/remotes.d.ts'

export async function syncRemoteTypings(ws: Workspace): Promise<void> {
	const provenance = Provenance.load(ws.root)
	const writer = new OwnedWriter(ws.root, false, provenance, false)

	for (const [name, app] of Object.entries(ws.manifest.apps)) {
		if (!app.remotes.length) continue

		const files = await formatFiles(hostWiringFiles(ws.manifest, app, ws.root), ws.root)
		const typings = files[TYPINGS_FILE]
		if (typings === undefined) continue

		await writer.replaceGenerated(join(ws.root, app.path), TYPINGS_FILE, typings, name)
	}

	await provenance.save()
}
