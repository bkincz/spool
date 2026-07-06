# Changelog

## 1.3.0 - 2026-07-06

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

## 1.2.0 - 2026-07-06

Added `spool remove <name>`: drops an app from `spool.json`, unwires it from
every host, and regenerates the hosts' ambient typings. The app folder stays
on disk unless you pass `--files`; deleting is refused if a hand-edited path
would land outside the workspace. Removing came up the first time the demo
workspace was restructured, so now it is a command instead of hand-editing.

## 1.1.0 - 2026-07-06

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

## 1.0.1 - 2026-07-06

Fixed: production builds of remotes did not emit `mf-manifest.json`, so a
deployed host could not resolve any remote. The dev server serves the manifest
automatically, which is why `spool dev` worked and builds silently did not.
Scaffolded workspaces now pass `manifest: true` to the federation plugin in
`spool.vite.ts`. Existing workspaces can apply the same one-line fix to their
`spool.vite.ts`; new scaffolds include it.

## 1.0.0 - 2026-07-06

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
