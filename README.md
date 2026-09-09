# spool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

spool is a small CLI for building micro frontends. It scaffolds a monorepo of Module Federation apps on Vite, runs them together with one command, and keeps all the wiring in a single `spool.json`. Describe your apps once and spool handles the rest.

**Live demo:** [spool-demo-shell.pages.dev](https://spool-demo-shell.pages.dev), a music UI where the browse view, search, and player bar are independently deployed remotes sharing one player state through [@bkincz/clutch](https://github.com/bkincz/clutch).

## Install

```bash
npm install -g @bkincz/spool
```

You'll need Node 22.12 or newer. Workspaces run on pnpm, npm, or yarn.

## Quick start

```bash
spool create acme --host shell --remotes "dashboard, profile"
cd acme
spool dev
```

Open http://localhost:5173 to see the host with its remotes mounted. Prefer prompts? Just run `spool create` on its own.

## Commands

| Command                                          | What it does                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `spool create [dir]`                             | Scaffold a workspace                                                                 |
| `spool dev [--only] [--rest] [--kill]`           | Run all apps together, remotes first                                                 |
| `spool build [--only] [--env] [--json]`          | Production build. Remotes first, then hosts, each tier in parallel                   |
| `spool preview [--only] [--kill]`                | Serve the built apps locally                                                         |
| `spool types [--only]`                           | Type each remote's exposes from its real source                                      |
| `spool add <name>`                               | Add an app and wire it in                                                            |
| `spool addon [list] [--only]`                    | Add extras to an existing workspace, optionally to some apps only                    |
| `spool remove <name> [--files]`                  | Remove an app and unwire it from every consumer. `--files` asks before deleting      |
| `spool deploy [--only] [--env] [--json]`         | Run each app's `deploy` command, remotes first, and record the deploy                |
| `spool promote --env <env> <app>@<sha>`          | Re-run a recorded deploy against another environment                                 |
| `spool rollback --env <env> <app>`               | Re-run an app's previous deploy for an environment                                   |
| `spool ci [--force] [--pin]`                     | Generate GitHub workflows: one checking the workspace, one per deployable app        |
| `spool upgrade [--dry-run] [--force]`            | Regenerate spool-owned files and move dependencies forward to match the workspace    |
| `spool doctor [--fix] [--json]`                  | Check ports, wiring, generated files, and dependencies. `--fix` repairs what it can  |
| `spool graph [--json] [--dot]`                   | Print hosts, remotes, what each consumes and exposes, and the shared list            |
| `spool affected --since <ref> [--json]`          | List apps changed since a git ref, directly or through a package they import         |
| `spool eject [--yes]`                            | Remove the spool dependency and keep everything it generated                         |

### create

| Option              | Description                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `-n, --name <name>` | Workspace name (defaults to the folder name)                                                                      |
| `--host <name>`     | Host app, as `name` or `name:framework`                                                                           |
| `--remotes <list>`  | Comma-separated remotes, each as `name` or `name:framework`                                                       |
| `--framework <fw>`  | Default framework: `react`, `svelte`, or `vue`                                                                    |
| `--addons <list>`   | Extras: `ladle`, `playwright`, `lint`, `test`, `turbo`, `state`, `sentry`, `navigation`, `federation`, or `none` |
| `--pm <manager>`    | `pnpm`, `npm`, or `yarn`                                                                                          |
| `--here`            | Scaffold into the current folder                                                                                  |
| `--no-install`      | Skip the install step                                                                                             |

Anything you leave out, spool asks for. Names are lowercase with single hyphens, like `acme-frontend`.

### add

| Option             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `-t, --type`       | `host` or `remote` (default `remote`)              |
| `-p, --port`       | Dev server port (default: next free)               |
| `--host <name>`    | Host to wire the remote into (default: first host) |
| `--framework <fw>` | `react`, `svelte`, or `vue`                        |
| `--no-install`     | Skip the install step                              |

`spool add` updates `spool.json`, typings, registry, and bridge files, then prints the mount snippet to paste in. It never edits your components.

### dev

| Option                | Description                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `--only <list>`       | Run a subset of apps                                                                                   |
| `--rest <mode>`       | Where the remotes a subset needs come from: `built` previews their `dist/`, an env name uses their url |
| `--timeout <seconds>` | How long to wait for a remote before giving up (default 20)                                            |
| `--no-ladle`          | Skip the component workshop                                                                            |
| `--kill`              | Stop a previous run from another shell and free the ports                                              |

Working on one remote does not need every server up:

```bash
spool dev --only shell,dashboard --rest staging   # everything else from its staging url
spool dev --only dashboard --rest built           # everything else from dist/
```

`spool dev` writes `.spool/dev.pid` while running. If a run is ever left behind, `spool dev --kill` cleans it up, and `spool doctor` tells you which process holds a port.

## The manifest

Everything lives in one `spool.json`. Each app's `vite.config.ts` reads it through `spool.vite.ts` when Vite starts, so the manifest is the only thing you ever edit.

```jsonc
{
  "name": "acme",
  "packageManager": "pnpm",
  "shared": ["react", "react-dom"],
  "apps": {
    "shell":     { "type": "host",   "path": "apps/shell",     "port": 5173, "remotes": ["dashboard"] },
    "dashboard": { "type": "remote", "path": "apps/dashboard", "port": 5174, "exposes": { "./App": "./src/app/app.tsx" },
                   "url": "https://dashboard.example.com/mf-manifest.json" }
  }
}
```

| Field                        | Description                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `shared`                     | Deps shared as singletons across apps                                                                |
| `shareStrategy`              | Optional. `loaded-first` (default) or `version-first`                                                |
| `overrides`                  | Optional. `true` keeps runtime remote overrides on in production builds (default `false`)            |
| `server`                     | Optional. Dev server settings every app gets: `proxy`, `headers`, `host`, `cors`                     |
| `apps.<name>.type`           | `host` consumes remotes, `remote` exposes modules                                                    |
| `apps.<name>.framework`      | `react` (default), `svelte`, or `vue`                                                                |
| `apps.<name>.port`           | Dev server port                                                                                      |
| `apps.<name>.remotes`        | Remotes this app mounts. A remote can consume remotes too                                            |
| `apps.<name>.exposes`        | Modules a remote exposes, keys starting with `./`                                                    |
| `apps.<name>.url`            | Optional. Deployed `mf-manifest.json`, used by host production builds                                |
| `apps.<name>.urls`           | Optional. Per-environment manifests, e.g. `{ "staging": "https://..." }`. `--env` selects one        |
| `apps.<name>.deploy`         | Optional. Shell command `spool deploy` runs in the app folder                                        |
| `apps.<name>.headers`        | Optional. Extra response headers for this app, in dev, preview, and the generated `_headers`        |
| `apps.<name>.frameAncestors` | Optional. Who may frame this app: `self`, `none`, origins, or `edge` alone. Default `self`           |

Settings every app needs from the dev server go in `server`, so you never edit a generated `vite.config.ts`:

```jsonc
{
  "server": {
    "proxy": { "/api": { "target": "${ACME_BACKEND:-http://localhost:3000}", "changeOrigin": true } }
  }
}
```

`${VAR}` and `${VAR:-fallback}` read the environment at startup.

The manifest is validated when it loads. A remote that names itself or an app that does not exist, a cycle through `remotes`, an expose outside its app folder, or an app `path` outside the workspace fails right away with the app named. `spool doctor` catches the rest after hand-editing.

## Checks and upgrades

- `spool doctor` checks ports (including one another process holds), wiring, exposed files, registry and typings, generated files against what spool wrote, shared dep versions across every workspace member, shared entries an app never imports, and the environment the addons need. `--fix` repairs what it safely can, `--dry-run` shows the changes first, and `--json` prints the problems for CI.
- `spool upgrade` never overwrites your edits. Spool hashes every file it writes into `.spool/generated.json`, so a later run can tell its own output from yours. Edited files are offered, not replaced. `--force` skips the asking and takes paths to limit it. Commit `.spool/generated.json`; `.spool/types` and pidfiles are ignored.
- Versions only ever move forward, onto the highest range already in the workspace, so a workspace ahead of spool stays ahead. Prereleases and `>=` ranges are never chosen as the target.
- `spool build` runs a tier at once and then compares what each app resolved for every shared dep, failing only when one app would load a version another cannot accept. `--concurrency <n>` caps the parallelism.
- `spool graph` shows the workspace as a tree, or as `--dot` for Graphviz. `spool affected --since main` lists the apps a change touches, directly or through a workspace package they import.
- `spool eject` removes the spool dependency and leaves the rest in place. `spool.json`, `spool.vite.ts`, `spool.workspace.ts` and every generated config keep working without the CLI.

## Types across the boundary

`spool types` emits declarations for every expose using the workspace's TypeScript into `.spool/types`, then rewrites each consumer's `src/remotes.d.ts` to point at them. `<Remote name="dashboard/Panel" props={...} />` is typed against the real component, and a changed prop fails type-check in the host. `spool dev` and `spool build` run it first, so the types are current. Without a TypeScript install spool falls back to the prop-less typing and says so.

## The app list

`spool.workspace.ts` reads the manifest when you import it, so nothing built on it goes stale:

```ts
import { apps, hosts, remotes, srcDirs, app, root } from '../../spool.workspace'
```

Each app has `name`, `type`, `framework`, `port`, absolute `dir` and `src`, `remotes`, and `exposes`.

## Frameworks

Every app scaffolds into `src/app/app.tsx` with a co-located stylesheet, and `main.tsx` imports it through the `@` alias.

Mix react, svelte, and vue freely. Every app picks its own framework. React remotes expose a component, svelte and vue remotes expose a mount function, and hosts consume each remote by its contract (non-react hosts get a small react bridge). Sharing applies per app: entries an app does not declare in its own package.json are dropped from its federation config, so a svelte remote never tries to share react.

## Extras

`spool create` can also set up the tooling most workspaces end up wanting. Pick at the prompt, or pass `--addons "ladle, playwright, lint, test, turbo, state, sentry, navigation, federation"`. Missed one? `spool addon` adds it to an existing workspace later.

- **Ladle**: a react design-system package in `packages/ui` with a component workshop. `spool dev` starts it alongside your apps, or open it on its own with `pnpm --filter ui ladle`.
- **Playwright**: e2e tests in `packages/e2e` that boot the workspace and check every remote mounts. Run `npx playwright install` once, then `pnpm --filter e2e test`.
- **ESLint**: one flat config at the root, type-checked, with the plugin each framework you use needs.
- **Vitest**: a `vitest.config.ts` per app, separate from `vite.config.ts` because federation cannot run under a test. Any app with `remotes` gets them stubbed in `src/test`, regenerated when the remote list changes. `type-check` scripts come with or without this addon.
- **Turborepo**: a `turbo.json` that puts `spool.json`, the runtime helper, and the `SPOOL_ENV` / `SPOOL_REMOTE_*` variables into the cache key, so a wiring change never gets a stale hit. `spool dev` and `spool build` are unchanged; turbo covers the tasks spool does not run.
- **Shared state**: [@bkincz/clutch](https://github.com/bkincz/clutch) shared as a singleton, plus a store module in every app so they read and write one state instance per page. The store validates its shape on every change with a plain predicate, swap in a zod or valibot schema if you want one. Bump its `version` and add a `migrate` when the shape changes.
- **Sentry**: each app gets its framework SDK and a `src/sentry.ts` wired into its entry. Errors are tagged with the app whose chunk threw them, so a remote failing inside a host is filed under the remote. Set `VITE_SENTRY_DSN` per app; every app gets a `.env.example` naming it. With `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in CI, `spool build` uploads hidden source maps, deletes them from `dist/`, and tags the release.
- **Navigation**: one url every bundle on the page agrees on, in `src/navigation`. `navigate` and `useLocation` ride on `window.history`, so back and forward work across remotes and deep links resolve on load.
- **Federation**: a `<Remote name="..." />` primitive and the remote registry, in `src/federation`. Mounts any remote by name, across frameworks. Every module a remote exposes gets a name, so `<Remote name="dashboard" />` is its app and `<Remote name="dashboard/Panel" />` is a widget it also offers.

`<Remote>` isolates failures. A remote that is mid-deploy or ships a broken chunk renders a placeholder with a retry instead of taking the host down. Pass `props` for the remote, `fallback` for loading, `renderError` to style the failure, `onError` to report it. The sentry addon captures them automatically.

Composing remotes is your own code, one region or many, persistent or routed:

```tsx
import { useLocation, navigate, matchRoute } from '@/navigation'
import { Remote, preloadRemote } from '@/federation'

const routes = { '/': 'browse', '/search': 'search' }
const active = matchRoute(useLocation().pathname, routes)
return (
  <>
    <Remote name="player" props={{ compact: true }} /> {/* always mounted */}
    {active && <Remote name={active} />} {/* swaps with the url */}
    <a href="/search" onMouseEnter={() => preloadRemote('search')}>Search</a>
  </>
)
```

To point a running host at a different build of one remote, set an override from the browser console. It is stored in `localStorage`, so it only affects you:

```ts
import { setRemoteOverride, listRemoteOverrides } from '@/federation'

setRemoteOverride('dashboard', 'https://dashboard-pr-42.example.com/mf-manifest.json')
setRemoteOverride('dashboard', null) // back to the build's url
```

Overrides are on in `spool dev` and `spool preview`. Production builds ignore them unless `spool.json` has `"overrides": true`.

Extras picked together at create time compose. With the state addon every remote renders a working counter and the host shows the live count, and the Playwright spec gains a test proving a remote's click updates the host. `spool addon` never rewrites components you may have edited, and `--only` limits it to some apps.

## Deploying

Every app builds to a plain static site. Give apps a `deploy` command in `spool.json`, deploy the remotes, set each remote's `url` to its deployed `mf-manifest.json`, then rebuild and deploy the host:

```bash
spool build
spool deploy --env production
```

Before shipping, `spool preview` serves the built apps together on localhost, so you can click through the exact artifacts you are about to deploy.

A host resolves each remote in this order:

1. `SPOOL_REMOTE_<NAME>` env var (dev and build)
2. the remote's `urls` entry for `--env` / `SPOOL_ENV` (production builds only)
3. the remote's `url` in `spool.json` (production builds only)
4. `http://localhost:<port>/mf-manifest.json`

For staging and friends, give a remote per-environment urls and build with `spool build --env staging`. `spool deploy --env staging` passes the name to your deploy commands as `SPOOL_ENV`, and `spool doctor --remote --env staging` probes those urls.

### Records, promote, rollback

`spool deploy --env <env>` writes what it shipped to `.spool/deploys.json`: the commit, the url, the time, and the shared dep versions the app was built with. Commit that file. Before each deploy spool compares the app's shared versions with what the other apps last deployed to that environment and refuses when one would load a version another cannot accept, naming both.

```bash
spool promote --env production dashboard@3f9c2a1   # re-run a recorded deploy elsewhere
spool rollback --env production dashboard          # re-run the one before the latest
```

Both need the working tree checked out at that commit, and say so if it is not.

### Headers

Every app ships a generated `public/_headers`. Cloudflare Pages and Netlify read it as-is; on Vercel set the same headers in `vercel.json`.

- `X-Content-Type-Options: nosniff` and `Content-Security-Policy: frame-ancestors 'self'` on every page
- `Cache-Control: no-cache` on `mf-manifest.json` and `remoteEntry.js`, `immutable` on hashed assets
- open CORS on those three paths for remotes, since hosts fetch them cross-origin

A host that must be framed by a partner sets `frameAncestors: ["https://partner.example"]`. When an edge layer in front of the app decides that per request, set `frameAncestors: ["edge"]` and spool writes no CSP for it, since two `frame-ancestors` headers intersect and would block the frame. Anything else goes in `apps.<name>.headers`. The same headers apply to dev and preview, so what you test is what you ship.

### CI

`spool ci` writes a check workflow that runs whichever of `doctor`, `type-check`, `lint`, `test`, and `build` your root package.json has, plus a path-filtered deploy workflow per app with a `deploy` command. Deploy jobs wait for the check job, run with read-only permissions, and trigger on the app's folder, the workspace packages, and the workspace files. `--pin` resolves every action to a commit sha. Example deploy commands: `wrangler pages deploy dist --project-name=<p>`, `netlify deploy --prod --dir=dist`, `vercel deploy dist --prod`, `aws s3 sync dist s3://<bucket> --delete`.

## Upgrading to 3

Run `spool upgrade`, then `spool doctor`. Generated files you edited are offered rather than replaced. Production builds now minify, every app gets a `_headers`, and `<Remote>` accepts `props`. The full list is in the [changelog](./CHANGELOG.md).

## License

MIT
