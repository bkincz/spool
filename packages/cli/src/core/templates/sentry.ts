import type { Framework, Manifest } from '../config.js'
import { SENTRY_SDK } from '../versions.js'
import type { FileMap } from '../filemap.js'

export const SENTRY_INIT_FILE = 'src/sentry.ts'

export function sentryFiles(m: Manifest): FileMap {
  const files: FileMap = {}
  for (const [name, app] of Object.entries(m.apps)) {
    files[`${app.path}/${SENTRY_INIT_FILE}`] = sentryInit(name, app.framework)
    // Checked in so a fresh clone knows what to set; the real value goes in
    // .env, which .gitignore keeps out.
    files[`${app.path}/.env.example`] = 'VITE_SENTRY_DSN=\n'
  }
  return files
}

function sentryInit(appName: string, framework: Framework): string {
  const sdk = SENTRY_SDK[framework]
  const options = `dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SPOOL_ENV ?? import.meta.env.MODE,
    initialScope: { tags: { mfe: "${appName}" } },
    integrations: [Sentry.moduleMetadataIntegration()],
    beforeSend: tagOriginMfe,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),`

  if (framework === 'vue') {
    return `import type { App } from "vue";
import * as Sentry from "${sdk}";

${originTagger()}
export function initSentry(app: App): void {
  Sentry.init({
    app,
    ${options}
  });
}
`
  }
  return `import * as Sentry from "${sdk}";

${originTagger()}
export function initSentry(): void {
  Sentry.init({
    ${options}
  });
}
`
}

/* 
 * IMPORTANT:
 *
 * Federation puts every app on one page, so the app that called Sentry.init is
 * rarely the app that threw. Each chunk is stamped with its owner by the vite
 * plugin, so read that off the deepest frame and retag the event. "mfe" is
 * the app whose chunk actually threw; compare <Remote>'s "remote" tag, which
 * is only the name a host asked for and failed to load.
 * 
 */
function originTagger(): string {
  return `// Under loaded-first, a shared chunk is attributed to whichever app's copy
// the browser loaded first, not necessarily the app that shipped it.
function tagOriginMfe(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const values = event.exception?.values ?? [];
  let mfe: string | undefined;

  for (const value of values) {
    const frames = value.stacktrace?.frames ?? [];
    for (let i = frames.length - 1; i >= 0 && !mfe; i--) {
      const candidate: unknown = frames[i]?.module_metadata?.mfe;
      if (typeof candidate === "string") mfe = candidate;
    }
    for (const frame of frames) delete frame.module_metadata;
  }

  if (mfe) event.tags = { ...event.tags, mfe };
  return event;
}

`
}

export function sentryEnvFiles(m: Manifest, dsn: string): FileMap {
  const files: FileMap = {}
  for (const app of Object.values(m.apps)) {
    files[`${app.path}/.env`] = `VITE_SENTRY_DSN=${dsn}\n`
  }
  return files
}

export function sentryVitePlugin(appName: string): {
  importLine: string
  helper: string
  entry: string
} {
  return {
    importLine:
      'import { sentryVitePlugin } from "@sentry/vite-plugin";\nimport { execSync } from "node:child_process";',
    helper: `// SENTRY_RELEASE wins in CI, where the checkout may be a shallow clone with
// no usable git history.
function gitSha(): string | undefined {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return undefined;
  }
}

`,
    // Always mounted, because the module metadata below is what tells one app’s
    // errors from another’s once federation puts them all on one page. Only the
    // source map upload needs the token.
    entry: `sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      moduleMetadata: { mfe: "${appName}" },
      telemetry: false,
      release: { name: process.env.SENTRY_RELEASE ?? gitSha() },
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
        filesToDeleteAfterUpload: ["./dist/**/*.map"],
      },
    })`,
  }
}

export function sentryNotes(composed: boolean): string[] {
  if (composed) {
    return [
      'sentry: initialized in every app and tagged by name. Set VITE_SENTRY_DSN (a .env was written) and, for readable prod traces, SENTRY_AUTH_TOKEN/ORG/PROJECT in CI.',
    ]
  }
  return [
    'sentry: call initSentry() (or initSentry(app) in vue) from each app entry, and set VITE_SENTRY_DSN before it reports.',
  ]
}
