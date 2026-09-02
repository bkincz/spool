# Changelog

## 2.6.1

- `spool doctor` no longer asks a local package to declare the shared list.
  Only apps do. Versions are still read from every package.

## 2.6.0

- New apps scaffold into `src/app/app.tsx` with a co-located
  `app.module.css`. Svelte and Vue take the same shape. Existing workspaces
  keep their layout.
- `spool doctor` and `spool upgrade` read every workspace member, not just the
  apps in the manifest, so a library in `packages/` can no longer sit on a
  different version of a shared dep.
- `spool doctor` errors when an `exposes` path does not exist.
- Generated files follow the workspace's prettier config instead of spool's
  own.
- `spool upgrade --force` takes paths, so one file can be forced without
  overwriting the rest.
- `spool addon <name> --only <apps>` writes per-app files into only those apps.
- `spool upgrade` names a generated file the first time it appears.

## 2.5.0

- `spool upgrade` no longer downgrades dependencies. It compared ranges with
  `!==` and wrote its own pin either direction. Ranges now only move forward,
  and the version written is the highest already in the workspace, so
  `TOOLCHAIN` is a floor rather than a target. `--pin` restores the old
  behaviour.
- `packageManager` had the same bug and is fixed the same way. A corepack
  integrity hash is left alone rather than replaced.
- `spool upgrade` no longer overwrites files you have edited. Spool records a
  hash of everything it writes in `.spool/generated.json`. An edited file is
  offered, not replaced, and keeping it is remembered. A workspace created
  before that record gets asked once per generated file. `--force` skips the
  asking, and with no terminal nothing is overwritten.
- Added `spool doctor --fix`: adds a shared dep an app forgot to declare,
  aligns apps that disagree on a version, and puts a missing framework runtime
  back in `shared`. Anything spool cannot compare is left alone and still
  reported. `--dry-run` shows the changes first.
- `spool doctor` reports drift in the deps spool writes itself, which is how an
  app scaffolded by an older CLI kept an older pin unnoticed.
- `spool build` verifies the singleton promise. It compares what each app
  resolved for every shared dep, read from the manifests the build just wrote,
  and fails only when the version federation would load falls outside another
  app's required range. Hosts now emit a manifest so they are included, which
  needs `spool upgrade`.
- `<Remote>` isolates failures. A remote that is mid-deploy or ships a broken
  chunk renders a placeholder with a retry instead of throwing through the
  host. Both contracts are covered, including the mount path whose rejected
  promise was unhandled. Pass `fallback`, `renderError`, and `onError`; the
  sentry addon captures them automatically.
- `spool ci` no longer refuses to run without deploy commands. It always writes
  a check workflow that installs and runs whichever of `doctor`, `type-check`,
  `lint`, `test`, and `build` your root package.json has.
- Apps in a tier build at once, remotes still finishing before hosts start.
  `--concurrency <n>` caps it.
- Added a `lint` addon: one flat ESLint config with the plugins your frameworks
  need.
- Added a `test` addon: a vitest config per app, separate from `vite.config.ts`
  because federation cannot run under a test, with each host's remotes aliased
  to stubs that are regenerated when the remote list changes.
- Added a `turbo` addon: a turbo.json that puts spool.json, the runtime
  helpers, and the `SPOOL_ENV` and `SPOOL_REMOTE_*` variables into the cache
  key.
- Every app gets a `type-check` script, with or without those addons.
- Added `spool.workspace.ts` beside `spool.vite.ts`. It reads the manifest when
  imported and exports the app list with resolved paths, so a cross-app sweep
  never goes stale.
- Added a `server` block to spool.json for dev server settings every app needs,
  such as a backend proxy. `${VAR}` and `${VAR:-fallback}` read the environment
  at startup.
- `spool remove --files` asks before deleting the folder, unless `--yes` or no
  terminal.
- Generated app tsconfigs dropped `baseUrl`, which TypeScript 6 errors on, and
  the root tsconfig gained `types: ["node"]`, which 6 no longer infers. The
  runtime helper types a proxy entry properly so an app's vite.config.ts
  assigns to vite's `ServerOptions`.
- Toolchain: react and react-dom to 19.2.8, svelte to 5.57.0, vue to 3.5.42,
  typescript to 6.0.3, pnpm to 11.25.0. A test now fails if the versions spool
  writes fall a major behind the ones the CLI runs.

## 2.4.0

Dependency release.

- zod 3 to 4, @clack/prompts 0.7 to 1, commander 12 to 15. The CLI compiles
  with TypeScript 7; workspace tooling stays on 6, the newest
  typescript-eslint supports.
- `spool.json` accepts exactly what it accepted before. `url` and `urls` now
  validate through zod 4's `z.url()`.
- An empty submit in `spool create` reports a validation message instead of
  throwing. @clack/prompts 1 widened `validate` to receive `string |
  undefined`, and the name validators called `.trim()` on it.

## 2.3.4

- Every federation share is emitted with `singleton: true`. Duplicated react
  across host and remotes breaks hooks, workspace packages carry module-level
  state that must resolve to one copy, and non-singleton workspace shares crash
  apps at boot in dev through a @module-federation/vite bug where the generated
  loadShare module references `__mfLocalShare` without importing it. Existing
  workspaces pick the fix up with `spool upgrade`.

## 2.2.0

- Added `spool preview`: serves every app's production build locally, remotes
  first, with the same status panel as `spool dev`. It refuses to start without
  dist folders and points you at `spool build`, and it warns when a remote
  `url` means the built host loads that instead of the local server.
- Added environments. A remote can carry per-environment manifest urls
  (`"urls": { "staging": "https://..." }`), and `spool build --env staging`
  selects them, falling back to `url`. Resolution order is
  `SPOOL_REMOTE_<NAME>`, the `urls` entry for `SPOOL_ENV`, `url`, then the
  local dev server.
- `spool deploy --env` hands the name to your deploy commands as `SPOOL_ENV`,
  and `spool doctor --remote --env staging` probes the staging urls following
  the same resolution as builds.
- An `--env` that matches no remote's `urls` warns instead of falling back
  silently, and `spool build --env` refuses to run against a `spool.vite.ts`
  too old to read it.
- The manifest's `bundler` field accepted "rspack" without doing anything. It
  now errors until rspack support is real. `spool upgrade` removes the field
  from old manifests and adds any root scripts fresh scaffolds carry.
- Scaffolded workspaces gained a `preview` script, and their dev and preview
  servers answer with CORS enabled, which cross-origin host-to-remote fetches
  need under `vite preview`.

## 2.1.1

- Scaffolded workspaces carry `@bkincz/spool` as a root dev dependency, pinned
  to the version that created them, so a teammate can clone, install, and run
  `pnpm dev` without a global install. `spool upgrade` adds it to older
  workspaces.
- `spool dev` starts clean. Startup noise is buffered, and once every server is
  up spool prints one panel: app, role and framework, url, vite version, and
  ready time, hosts first. In a real terminal it stays anchored while logs
  scroll beneath, resizes repaint without losing history, and ctrl+c restores
  the terminal.
- A crash during startup dumps every app's buffered output, a slow start (15s)
  falls back to streaming everything, and pipes, CI, and narrow windows get the
  panel inline.
- Extras picked together at create time compose. With the state addon every
  remote renders a working counter and the host displays the live count, the
  counter's button comes from the ladle ui package when both are picked, and
  the Playwright spec gains a test clicking a remote's button and asserting the
  shell's count updates. `spool addon` stays plain and never rewrites app
  components.

## 2.1.0

- Added `spool addon`: adds extras to an existing workspace. Pass names
  (`spool addon ladle playwright`) or run it bare for a prompt that hides
  extras the workspace already has. It wires the manifest, declares shared deps
  in every app, patches the pnpm build-script allowlist with exact-key
  matching, and never overwrites existing files.
- The extras step in `spool create` always asks unless `--addons` answers it.
  Runs without a TTY skip the prompt instead of hanging. Pass `--addons none`
  to be explicit.

## 2.0.0

Multi-framework workspaces.

- Every app has a `framework` in `spool.json` (default `react`). `react`,
  `svelte`, and `vue` mix freely in one workspace, and `spool create` takes a
  framework per app:

  ```bash
  spool create acme --host shell:vue --remotes "dash:react, widget:svelte"
  ```

- Apps without an explicit choice use `--framework` if given, interactive runs
  ask per app, and fully flag-driven runs stay prompt-free.
- React remotes expose their component; svelte and vue remotes expose a mount
  function. Hosts consume each remote by its contract, including a react bridge
  on non-react hosts, and `spool add` prints a mount snippet matched to the
  host instead of editing your components.
- Sharing became per app. The runtime helper drops `shared` entries an app does
  not declare in its own package.json, `spool add` keeps framework runtimes in
  `shared`, apps declare non-framework shared deps automatically, and
  `spool doctor` expects every shared dep except another framework's runtime.
- `spool upgrade` regenerates each app for its own framework and leaves
  customized files alone.
- `spool create` gained an extras step (`--addons`, or a prompt at the end):
  Ladle, a react design-system package in `packages/ui` with a component
  workshop; Playwright, e2e tests in `packages/e2e` that boot the workspace and
  assert the host mounts every remote; and shared state, `@bkincz/clutch` in
  `shared` plus a `sharedMachine` store module in every app.
- Added `spool doctor --remote`: fetches every remote's deployed `url` and
  reports dead deployments, SPA fallback pages answering where
  `mf-manifest.json` should be, and missing CORS headers. The default run stays
  offline.
- Existing manifests are unchanged. Apps without a `framework` field are react.

## 1.4.0

Added `spool upgrade`: brings a workspace up to the installed spool version.
Regenerates the runtime helper and vite configs, refreshes host typings, adds
files newer versions ship, and syncs toolchain dependencies, engines, and the
pnpm pin. Only spool-generated files are touched and only real differences
are written, so it is safe to rerun. `--dry-run` reports without writing.

Scaffolded workspace READMEs now list every command, including deploy,
remove, ci, and upgrade.

## 1.3.0

Added `spool deploy`. Each app gets an optional `deploy` command in
`spool.json`, a shell command spool runs in the app's folder, remotes before
hosts. spool owns the ordering, `--only` filtering, and failure reporting; the
command is yours, so any target works and different apps can deploy to
different hosts. Apps without a command are skipped with a warning, and
deploying a remote that has no `url` yet prints a reminder to set one. The
README has preset commands for Cloudflare Pages, Netlify, Vercel, and S3.

Added `spool ci`: generates one path-filtered GitHub Actions workflow per
deployable app, so pushing a change to one app builds and deploys only that
app. Workspace-level files trigger every app. Deploy commands are copied from
`spool.json` into the workflow where you can read them; rerun
`spool ci --force` after changing one. Existing workflow files are never
overwritten without `--force`.

Scaffolded pnpm workspaces now pin `packageManager` in package.json, so
corepack and the generated workflows resolve the same pnpm version.

Scaffolds now use React 19. Verified end to end: a React 19 workspace
type-checks, builds, and serves its remotes over Module Federation with
shared singletons.

Fixed: scaffolded apps now include `@types/node`, and the workspace root gets
`typescript` and `@types/node` dev dependencies. Without them `tsc --noEmit`
failed on the vite config and `spool.vite.ts`, which use node builtins. The
CI smoke job now type-checks the scaffolded workspace so this stays true.

Fixed: `spool doctor` no longer flags subpath share entries (like
`@bkincz/clutch/react`) as missing dependencies; it now checks the package
they belong to.

## 1.2.0

Added `spool remove <name>`: drops an app from `spool.json`, unwires it from
every host, and regenerates the hosts' ambient typings. The app folder stays
on disk unless you pass `--files`; deleting is refused if a hand-edited path
would land outside the workspace. Removing came up the first time the demo
workspace was restructured, so now it is a command instead of hand-editing.

## 1.1.0

Lessons from deploying the [live demo](https://spool-demo-shell.pages.dev) to
Cloudflare Pages, baked into the scaffold:

- A remote's `url` now applies to production builds only. `spool dev` keeps
  loading remotes from your local dev servers, so setting deployed urls no
  longer hijacks local development. `SPOOL_REMOTE_<NAME>` env vars still
  override everywhere, dev included.
- New remotes ship a `public/_headers` file with
  `Access-Control-Allow-Origin: *`. Hosts fetch remote assets cross-origin and
  static hosts send no CORS headers by default; Cloudflare Pages and Netlify
  read this file as-is.
- The README gained a real deploy guide.

Existing workspaces: regenerate `spool.vite.ts` and each app's
`vite.config.ts` by scaffolding a fresh app and copying them over, or apply
the same edits by hand (the config now passes vite's `command` into
`spoolApp`).

## 1.0.1

Fixed: production builds of remotes did not emit `mf-manifest.json`, so a
deployed host could not resolve any remote. The dev server serves the manifest
automatically, which is why `spool dev` worked and builds silently did not.
Scaffolded workspaces now pass `manifest: true` to the federation plugin in
`spool.vite.ts`. Existing workspaces can apply the same one-line fix to their
`spool.vite.ts`; new scaffolds include it.

## 1.0.0

First public release.

- `spool create` scaffolds a Vite + React + TypeScript micro-frontend workspace
  with a host and remotes wired over Module Federation, on pnpm, npm, or yarn.
- `spool dev` runs every app together, remotes first, and waits for each
  remote's federation manifest before starting hosts.
- `spool build` builds for production, remotes before hosts.
- `spool add` adds a host or remote to an existing workspace and wires it in.
- `spool doctor` checks ports, app folders, federation wiring, and shared deps.
- All wiring lives in one `spool.json`; apps read it at startup through a
  generated `spool.vite.ts`, so there are no configs to regenerate or drift.
- Remotes resolve through `SPOOL_REMOTE_<NAME>` env vars and a per-remote
  `url` field for production deploys.
