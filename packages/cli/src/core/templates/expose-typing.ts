/*
 *   IMPORTS
 ***************************************************************************************************/
import { existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { exposeDeclarationPath } from '../types.js'
import type { RemoteRef, RemoteTypingContext } from './types.js'

/*
 *   TYPED EXPOSE
 ***************************************************************************************************/
export function typedExposeDeclaration(
	ref: RemoteRef,
	expose: string,
	ctx: RemoteTypingContext
): string | undefined {
	const source = ref.exposeSources[expose]
	if (!source) return undefined

	const declFile = exposeDeclarationPath(ctx.root, ref.name, ref.path, source)
	if (!existsSync(declFile)) return undefined

	const hostSrcDir = join(ctx.root, ctx.hostPath, 'src')
	const withoutExt = declFile.slice(0, -'.d.ts'.length)
	const relPath = relative(hostSrcDir, withoutExt).split(sep).join('/')
	const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`

	return `// Typed by \`spool types\` from the remote's real export.
declare module "${ref.name}/${expose}" {
  const Exposed: typeof import("${importPath}")["default"];
  export default Exposed;
}
`
}
