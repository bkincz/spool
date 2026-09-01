/*
 *   IMPORTS
 ***************************************************************************************************/
import type { Manifest } from '../config.js'
import type { FileMap } from '../filemap.js'
import { STATE_STORE_FILE } from './bridges.js'

/*
 *   SHARED STATE
 ***************************************************************************************************/
export function stateFiles(m: Manifest): FileMap {
	// Every app gets its own copy; sharedMachine resolves all copies to one instance per page.
	const store = `import { createMachine, sharedMachine, validate } from "@bkincz/clutch";

export interface CounterState {
  count: number;
}

// validate() takes any predicate so you can swap in a zod/valibot/arktype schema here
// for richer shapes. When CounterState's shape changes, bump \`version\` and migrate
// older shapes below. This way a newer app then migrates the shared state in place.
// Keep changes additive so apps still on the old shape tolerate the new one.
export const counterMachine = sharedMachine(
  "${m.name}:counter",
  () =>
    createMachine<CounterState>({ initialState: { count: 0 } }).with(
      validate<CounterState>(state => typeof state.count === "number" || "count must be a number"),
    ),
  {
    version: 1,
    migrate: previous => previous as CounterState,
  },
);
`
	const files: FileMap = {}
	for (const app of Object.values(m.apps)) {
		files[`${app.path}/${STATE_STORE_FILE}`] = store
	}
	return files
}
