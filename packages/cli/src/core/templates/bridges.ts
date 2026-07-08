// NOTE: Ignore the weird spacing in this file, it's to make the generated code look nice in the templates.
/*
 *   FRAMEWORK BRIDGES
 ***************************************************************************************************/
import type { RemoteRef } from './index.js'

export function mountContractTyping(name: string): string {
	return `declare module "${name}/App" {\n  const mount: (target: HTMLElement) => () => void;\n  export default mount;\n}\n`
}

export function reactBridgeFiles(refs: RemoteRef[]): Record<string, string> {
	return refs.some(r => r.contract === 'component')
		? { 'src/react-bridge.ts': reactBridge() }
		: {}
}

function reactBridge(): string {
	return `import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";

export function mountReact(Component: ComponentType, target: HTMLElement): () => void {
  const root = createRoot(target);
  root.render(createElement(Component));
  return () => root.unmount();
}
`
}
