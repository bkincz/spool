/*
 *   FIXTURE WORKSPACE
 ***************************************************************************************************/
// Off the scaffold defaults (5173+) so a dev server you already have running does not collide.
export const PORTS = { shell: 5371, staff: 5372, assessments: 5373 } as const

export type FixtureApp = keyof typeof PORTS

export const appOrigin = (app: FixtureApp): string => `http://localhost:${PORTS[app]}`

// Set by the global setup, which workers inherit, so a test can run tools in the workspace.
export const WORKSPACE_ENV = 'SPOOL_E2E_WORKSPACE'
