// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   FRAMEWORK BRIDGES
 ***************************************************************************************************/
import type { RemoteRef, RemoteTypingContext } from './index.js'
import { typedExposeDeclaration } from './expose-typing.js'

/** The state addon's store module: where it is written and how apps import it. */
export const STATE_STORE_FILE = 'src/state/counter.ts'
export const STATE_STORE_IMPORT = '@/state/counter'

/** Shared-counter example strings; the generated e2e test asserts these exactly. */
export const STATE_COUNT_TESTID = 'shell-count'
export const STATE_COUNT_TEXT = 'Shared count:'

export function mountContractTyping(ref: RemoteRef, ctx: RemoteTypingContext): string {
	return ref.exposes
		.map(expose => {
			const typed = typedExposeDeclaration(ref, expose, ctx)
			if (typed) return typed
			return `// Run \`spool types\` to type this from the remote's real export.
declare module "${ref.name}/${expose}" {
  const mount: (target: HTMLElement, props?: Record<string, unknown>) => () => void;
  export default mount;
}
`
		})
		.join('')
}

export function reactBridgeFiles(refs: RemoteRef[]): Record<string, string> {
	return refs.some(r => r.contract === 'component')
		? { 'src/react-bridge.ts': reactBridge() }
		: {}
}

function reactBridge(): string {
	return `import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

export function mountReact(
  Component: ComponentType<Record<string, unknown>>,
  target: HTMLElement,
  props?: Record<string, unknown>,
): () => void {
  const root = createRoot(target);
  root.render(createElement(Component, props));
  return () => root.unmount();
}
`
}
