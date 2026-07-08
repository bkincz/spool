# Changelog

## 2.2.0

Added `spool preview`: serves every app's production build locally, remotes
first, with the same status panel as `spool dev`. Fresh scaffolds resolve
remotes to the local preview servers, so the exact artifacts you are about
to deploy run together on localhost before anything ships. It refuses to
start without dist folders and points you at `spool build`, and it warns
when a remote's deployed `url` means the built host loads that instead of
the local server.

Added environments. A remote can carry per-environment manifest urls in
spool.json (`"urls": { "staging": "https://..." }`), and `spool build --env
staging` selects them, falling back to `url`. The resolution order is now:
`SPOOL_REMOTE_<NAME>` env var, the `urls` entry for `SPOOL_ENV`, `url`,
local dev server. `spool deploy --env` hands the name to your deploy
commands as `SPOOL_ENV`, and `spool doctor --remote --env staging` probes
the staging urls. Doctor follows the same resolution as builds, including
`SPOOL_REMOTE_<NAME>` overrides and an exported `SPOOL_ENV`. An `--env`
that matches no remote's `urls` gets a warning instead of a silent
fallback, and `spool build --env` refuses to run against a `spool.vite.ts`
too old to read it.

The manifest's `bundler` field previously accepted "rspack" without doing
anything. It now errors with a clear message until rspack support is real,
so the schema no longer makes promises the CLI does not keep. `spool
upgrade` removes the field from old manifests, and also adds any root
scripts (like `preview`) that fresh scaffolds carry.

Scaffolded workspaces gained a `preview` script, and their dev and preview
servers now answer with CORS enabled, which cross-origin host-to-remote
fetches need under `vite preview`.

## 2.1.1

Scaffolded workspaces now carry `@bkincz/spool` as a root dev dependency,
pinned to the version that created them. A teammate can clone, install, and
run `pnpm dev` without a global install, and the whole team runs the same
spool. `spool upgrade` adds it to older workspaces.

`spool dev` starts clean. Each app's startup noise is buffered, and once
every server is up spool prints one panel: app, role and framework, url,
vite version, and ready time, hosts first. In a real terminal the panel
stays anchored at the top while logs scroll beneath it, resizes repaint
without losing history, and ctrl+c restores the terminal. Logs stream with
the usual per-app prefixes either way. A crash during startup dumps every
app's buffered output so the reason is never hidden, a slow start (15s)
falls back to streaming everything, and pipes, CI, and narrow windows get
the panel inline instead.

Extras picked together at create time now compose. With the state addon,
every remote renders a working counter that increments the shared machine
and the host displays the live count, so the cross-app state flow is visible
the moment `spool dev` opens. The counter's button comes from the ladle ui
package when both addons are picked, and the Playwright spec gains a test
that clicks a remote's button and asserts the shell's count updates over
federation. `spool addon` stays plain: applied retroactively, extras never
rewrite app components you may have edited.

## 2.1.0

Added `spool addon`: adds extras to an existing workspace. Pass names
(`spool addon ladle playwright`) or run it bare for a prompt that hides
extras the workspace already has. It wires the manifest, declares shared
deps in every app (updating stale ranges), patches the pnpm build-script
allowlist with exact-key matching, and never overwrites existing files, so
rerunning only fills gaps.

The extras step in `spool create` now always asks unless `--addons` answers
it. Runs without a TTY skip the prompt instead of hanging, so scripts and CI
keep working either way; pass `--addons none` to be explicit.

## 2.0.0

Multi-framework workspaces. Every app has a `framework` in `spool.json`
(default `react`); `react`, `svelte`, and `vue` mix freely in one workspace,
and `spool create` takes a framework per app:

```bash
spool create acme --host shell:vue --remotes "dash:react, widget:svelte"
```

Apps without an explicit choice use `--framework` if given; otherwise
interactive runs ask per app, and fully flag-driven runs stay prompt-free
for scripts and CI.

React remotes expose their component; svelte and vue remotes expose a mount
function. Hosts consume each remote by its contract out of the box, including
a react bridge on non-react hosts, and `spool add` prints a mount snippet
matched to the host's framework instead of editing your components.

Sharing became per app so mixing works: the runtime helper drops `shared`
entries an app does not declare in its own package.json, `spool add` keeps
framework runtimes in `shared`, apps automatically declare non-framework
shared deps spool knows about, and `spool doctor` expects every shared dep
except another framework's runtime. `spool upgrade` regenerates each app for
its own framework and leaves customized files alone.

`spool create` gained an extras step (`--addons`, or a prompt at the end):

- Ladle: a react design-system package in `packages/ui` with a component
  workshop.
- Playwright: e2e tests in `packages/e2e` that boot the workspace and assert
  the host mounts every remote over federation.
- Shared state: `@bkincz/clutch` in `shared` plus a `sharedMachine` store
  module in every app, one state instance per page.

Added `spool doctor --remote`: fetches every remote's deployed `url` and
reports dead deployments, SPA fallback pages answering where
`mf-manifest.json` should be, and missing CORS headers. The default run
stays fully offline.

Existing manifests are unchanged; apps without a `framework` field are react.

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
