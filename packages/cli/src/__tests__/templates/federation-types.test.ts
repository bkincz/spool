/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { federationFiles } from '../../core/templates/composition.js'
import { runCaptured } from '../../util/exec.js'
import { freshDir, host, makeManifest, remote, removeDir } from '../helpers.js'

/*
 *   TEST SETUP
 ***************************************************************************************************/
// typescript 7 no longer exports its bin, so it is found next to package.json.
const TSC = join(
	dirname(createRequire(import.meta.url).resolve('typescript/package.json')),
	'bin/tsc'
)

// The compiler options a generated workspace's tsconfig.base.json sets.
const TSCONFIG = {
	compilerOptions: {
		target: 'ES2022',
		lib: ['ES2022', 'DOM'],
		module: 'ESNext',
		moduleResolution: 'Bundler',
		strict: true,
		skipLibCheck: true,
		isolatedModules: true,
		noEmit: true,
	},
	include: ['*.ts'],
}

// What load.ts and the remotes' typings give remotes.ts in a real host.
const LOAD_STUB =
	'export declare function loadRemote<T>(id: string, importRemote: () => Promise<T>): Promise<T>;\n'

let dir: string

beforeEach(() => {
	dir = freshDir('spool-types-')
})

afterEach(() => {
	removeDir(dir)
})

function registry(remotes: string[]): string {
	const manifest = makeManifest({
		shell: host({ remotes }),
		staff: remote({ path: 'apps/staff' }),
		assessments: remote({
			path: 'apps/assessments',
			exposes: { './App': './src/app/app.tsx', './NewAssessment': './src/new.tsx' },
		}),
	})
	manifest.addons = ['federation']
	return federationFiles(manifest, manifest.apps.shell!)['src/federation/remotes.ts']!
}

/** Type-checks `consumer` against a generated remotes.ts, as a host would import it. */
async function typeCheck(consumer: string, remotes = ['staff', 'assessments']) {
	writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(TSCONFIG))
	writeFileSync(join(dir, 'remotes.ts'), registry(remotes))
	writeFileSync(join(dir, 'load.ts'), LOAD_STUB)
	writeFileSync(
		join(dir, 'modules.d.ts'),
		['staff/App', 'assessments/App', 'assessments/NewAssessment']
			.map(
				id =>
					`declare module "${id}" { const Component: unknown; export default Component; }\n`
			)
			.join('')
	)
	writeFileSync(join(dir, 'consumer.ts'), consumer)
	return runCaptured(process.execPath, [TSC, '-p', dir], { cwd: dir })
}

const VALID = `import { preloadRemote, remotes, type RemoteName } from "./remotes";

export const names: RemoteName[] = ["staff", "assessments", "assessments/NewAssessment"];
void preloadRemote("assessments/NewAssessment");
void remotes.staff.load();
`

/*
 *   TYPED NAMES
 ***************************************************************************************************/
describe('generated remotes.ts: RemoteName', () => {
	it('accepts every registered name', async () => {
		const { code, output } = await typeCheck(VALID)
		expect(output).toBe('')
		expect(code).toBe(0)
	})

	it('makes a misspelled name a compile error', async () => {
		// An unused @ts-expect-error is itself an error, so this passes only if both lines fail.
		const { code, output } = await typeCheck(`${VALID}
// @ts-expect-error not a remote
void preloadRemote("staf");
// @ts-expect-error not a remote
export const typo: RemoteName = "admn";
`)
		expect(output).toBe('')
		expect(code).toBe(0)
	})

	it('narrows a name that arrives at runtime', async () => {
		const { code, output } =
			await typeCheck(`import { isRemoteName, preloadRemote } from "./remotes";

export function open(fromUrl: string): void {
  // @ts-expect-error a plain string is not a remote name
  void preloadRemote(fromUrl);
  if (isRemoteName(fromUrl)) void preloadRemote(fromUrl);
}
`)
		expect(output).toBe('')
		expect(code).toBe(0)
	})

	it('reports the misspelled name itself', async () => {
		const { code, output } = await typeCheck(`${VALID}void preloadRemote("staf");\n`)
		expect(code).not.toBe(0)
		expect(output).toContain('"staf"')
	})

	it('compiles for a host with no remotes yet', async () => {
		const { code, output } = await typeCheck(
			'import { remotes, type RemoteName } from "./remotes";\nexport const none: RemoteName[] = [];\nvoid remotes;\n',
			[]
		)
		expect(output).toBe('')
		expect(code).toBe(0)
	})
})
