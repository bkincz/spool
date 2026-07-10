import type { Framework, Manifest } from '../config.js'
import { SENTRY_SDK } from '../versions.js'
import type { FileMap } from '../generators.js'

export const SENTRY_INIT_FILE = 'src/sentry.ts'

export function sentryFiles(m: Manifest): FileMap {
	const files: FileMap = {}
	for (const [name, app] of Object.entries(m.apps)) {
		files[`${app.path}/${SENTRY_INIT_FILE}`] = sentryInit(name, app.framework)
	}
	return files
}

function sentryInit(appName: string, framework: Framework): string {
	const sdk = SENTRY_SDK[framework]
	const options = `dsn: import.meta.env.VITE_SENTRY_DSN,
    initialScope: { tags: { mfe: "${appName}" } },
    tracesSampleRate: 1,`

	if (framework === 'vue') {
		return `import type { App } from "vue";
import * as Sentry from "${sdk}";

export function initSentry(app: App): void {
  Sentry.init({
    app,
    ${options}
  });
}
`
	}
	return `import * as Sentry from "${sdk}";

export function initSentry(): void {
  Sentry.init({
    ${options}
  });
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

export function sentryVitePlugin(): { importLine: string; entry: string } {
	return {
		importLine: 'import { sentryVitePlugin } from "@sentry/vite-plugin";',
		entry: `...(process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({ org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT })]
      : [])`,
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
