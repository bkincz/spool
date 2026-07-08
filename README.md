# spool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

spool is a small CLI for building micro frontends. It scaffolds a monorepo of Module Federation apps on Vite, runs them together with one command, and keeps all federation wiring in a single `spool.json`. Describe your apps once and spool handles the rest.

**Live demo:** [spool-demo-shell.pages.dev](https://spool-demo-shell.pages.dev), a Spotify-style music UI where the browse view, search, and the player bar are independently deployed remotes sharing one player state through [@bkincz/clutch](https://github.com/bkincz/clutch) as a federation singleton.

## Requirements

- Node 22.12 or newer
- pnpm, npm, or yarn

## Install

```bash
npm install -g @bkincz/spool
```

Or with your package manager of choice: `pnpm add -g @bkincz/spool`, `yarn global add @bkincz/spool`.

Check it's on your PATH:

```bash
spool --help
```

To work on spool itself, build from this repo and link the binary:

```bash
pnpm install
pnpm --filter @bkincz/spool build
pnpm --filter @bkincz/spool exec pnpm link --global
```

## Getting started

Create a workspace with a host and two remotes, then start everything:

```bash
spool create acme --host shell --remotes "dashboard, profile"
cd acme
spool dev
```

Open http://localhost:5173 to see the host with its remotes mounted over Module Federation. Run `spool create` with no arguments to be prompted instead.

## Commands

### `spool create [dir]`

Scaffolds a new workspace. Pass what you know up front, or leave options out and spool will ask.

| Option | Default | Description |
|---|---|---|
| `[dir]` | workspace name | Folder to create the workspace in |
| `-n, --name <name>` | folder name | Workspace name |
| `--host <name>` | `shell` | Host (shell) app name, as `name` or `name:framework` |
| `--remotes <list>` | prompt | Comma-separated remote names, each as `name` or `name:framework` |
| `--pm <manager>` | prompt (`pnpm`) | Package manager: `pnpm`, `npm`, or `yarn` |
| `--framework <framework>` | see below | Default framework: `react`, `svelte`, or `vue` |
| `--here` | off | Scaffold into the current folder |
| `--no-install` | off | Skip the install step |

Notes:

- App and workspace names are lowercase, start with a letter, and use only letters, digits, and single hyphens. Examples: `dashboard`, `acme-frontend`.
- Each app picks its framework independently: `--host shell:vue --remotes "dash:react, widget:svelte"`. Apps without an explicit choice use `--framework` if given; otherwise interactive runs ask per app, and fully flag-driven runs default the host to `react` and remotes to the host's framework, so scripts and CI never hit a prompt.
- With yarn, spool writes a `.yarnrc.yml` that pins Yarn Berry to the `node_modules` linker, because Berry's Plug'n'Play doesn't work with Vite and Module Federation. Yarn Classic ignores that file, so the same workspace runs on either version.

### `spool dev`

Starts every app together. Remotes come up first, and hosts wait until each remote is actually serving its federation manifest. Logs are prefixed and colored per app. Ctrl+C stops everything, on Windows too.

```bash
spool dev
spool dev --only shell,dashboard   # just a subset
```

If `--only` leaves out a remote that a selected host needs, spool warns you. Start it separately or the host will fail to load it.

### `spool build`

Builds every app for production, remotes before hosts.

```bash
spool build
spool build --only dashboard
```

### `spool add <name>`

Adds an app to an existing workspace.

```bash
spool add settings              # remote, wired into the host
spool add admin --type host     # another host
spool add reports --port 5200   # pick the port
spool add billing --host shell  # wire into a specific host
```

| Option | Default | Description |
|---|---|---|
| `-t, --type <type>` | `remote` | `host` or `remote` |
| `-p, --port <port>` | next free | Dev server port |
| `--host <name>` | first host | Host to wire a new remote into |
| `--framework <framework>` | `react` | `react`, `svelte`, or `vue` |
| `--no-install` | off | Skip the install step |

Adding a remote updates `spool.json`, the host's typings, and any bridge files the host needs. Your host's App component is never touched; spool prints the exact mount snippet to paste in, matched to the host's framework.

### `spool deploy`

Runs each app's `deploy` command from `spool.json`, remotes before hosts, in the app's folder. spool orchestrates; the command itself is yours, so any host works: Cloudflare, Netlify, Vercel, S3, rsync to a box, an internal script.

```bash
spool build
spool deploy                 # everything with a deploy command
spool deploy --only home     # redeploy a single app
```

Apps without a `deploy` command are skipped with a warning. A failing command stops the run and names the app. After deploying a remote that has no `url` yet, spool reminds you to set one.

Preset commands to copy into `spool.json`:

| Target | `deploy` command |
|---|---|
| Cloudflare Pages | `wrangler pages deploy dist --project-name=<project>` |
| Netlify | `netlify deploy --prod --dir=dist` |
| Vercel | `vercel deploy dist --prod` |
| S3 + CloudFront | `aws s3 sync dist s3://<bucket> --delete` |

### `spool remove <name>`

Removes an app: drops it from `spool.json`, unwires it from every host, and regenerates the hosts' typings.

```bash
spool remove settings           # keeps apps/settings on disk
spool remove settings --files   # deletes the folder too
```

If a host's `App.tsx` still imports the removed remote, spool reminds you to take that import out; it never edits your components.

| Option | Default | Description |
|---|---|---|
| `--files` | off | Also delete the app folder |

### `spool ci`

Generates one GitHub Actions workflow per app that has a `deploy` command, written to `.github/workflows/deploy-<app>.yml`. Each workflow is path-filtered, so pushing a change to one app builds and deploys only that app. Changes to workspace-level files (`spool.json`, `spool.vite.ts`, the lockfile) trigger every app, since they can affect any of them.

```bash
spool ci            # writes missing workflows, leaves existing ones alone
spool ci --force    # regenerate, e.g. after changing a deploy command
```

Notes:

- The deploy command is copied into the workflow at generation time. Rerun `spool ci --force` after changing it in `spool.json`.
- Add the secrets your deploy commands need (like `CLOUDFLARE_API_TOKEN`) to the repository; each workflow has a commented `env` block showing where they go.
- Workflows trigger on pushes to `main` and support manual runs from the Actions tab. Edit the branch list in the file if you release from elsewhere.

### `spool upgrade`

Brings a workspace up to the installed spool version: regenerates `spool.vite.ts` and every app's `vite.config.ts`, refreshes host typings, adds files newer spool versions ship (`public/_headers`, the root `tsconfig.json`, `.prettierignore`), and syncs toolchain dependencies, `engines`, and the pnpm pin.

```bash
spool upgrade --dry-run   # report what would change
spool upgrade             # apply, then review with git and reinstall
```

It only touches files spool generates; your components, styles, and `spool.json` stay yours. Only real differences are written, so rerunning it reports "already up to date".

### `spool doctor`

Checks the workspace and reports anything off: port collisions, missing app folders, remotes that point nowhere, remotes no host imports, shared deps that are missing or on mismatched versions, and a missing `spool.vite.ts`. Exits non-zero on a real error, so you can run it in CI.

```bash
spool doctor
spool doctor --remote   # also fetch each deployed remote url
```

With `--remote`, doctor fetches every remote's `url` and flags dead deployments, an SPA fallback page answering where `mf-manifest.json` should be, and missing CORS headers. The default run stays fully offline.

## The manifest

Everything lives in one `spool.json` at the workspace root. Each app's `vite.config.ts` reads it through `spool.vite.ts` when Vite starts, so editing the manifest is all you do. There are no generated configs to keep in sync.

```jsonc
{
  "name": "acme",
  "packageManager": "pnpm",
  "bundler": "vite",
  "shared": ["react", "react-dom"],
  "apps": {
    "shell":     { "type": "host",   "path": "apps/shell",     "port": 5173, "remotes": ["dashboard"] },
    "dashboard": { "type": "remote", "path": "apps/dashboard", "port": 5174, "exposes": { "./App": "./src/App.tsx" },
                   "url": "https://dashboard.example.com/mf-manifest.json" }
  }
}
```

| Field | Description |
|---|---|
| `name` | Workspace name |
| `packageManager` | `pnpm`, `npm`, or `yarn` |
| `bundler` | `vite` |
| `shared` | Dependencies shared as singletons across apps |
| `apps.<name>.type` | `host` consumes remotes, `remote` exposes modules |
| `apps.<name>.framework` | `react`, `svelte`, or `vue`. Defaults to `react` |
| `apps.<name>.path` | App folder, relative to the root |
| `apps.<name>.port` | Dev server port |
| `apps.<name>.url` | Optional. The remote's deployed `mf-manifest.json`, used by host production builds |
| `apps.<name>.deploy` | Optional. Shell command `spool deploy` runs in the app folder |
| `apps.<name>.remotes` | Remotes a host consumes |
| `apps.<name>.exposes` | Modules a remote exposes, as `importName: sourcePath` |

Notes:

- Unknown or misspelled keys are rejected with an error, not silently dropped.
- Run `spool doctor` after hand-editing to catch mistakes.

## Deploying remotes

Each app builds to a plain static site, so any static host works. Give each app a `deploy` command, deploy the remotes, set each remote's `url` to its deployed `mf-manifest.json`, then rebuild and deploy the host:

```bash
spool build
spool deploy
```

A host looks up each remote in this order:

1. `SPOOL_REMOTE_<NAME>` environment variable, e.g. `SPOOL_REMOTE_DASHBOARD=https://staging.example.com/mf-manifest.json`. Applies in dev and build, so you can point one remote anywhere without touching the manifest.
2. the remote's `url` in `spool.json`. Production builds only; `spool dev` keeps using your local servers.
3. `http://localhost:<port>/mf-manifest.json`.

Notes:

- Hosts fetch remote assets cross-origin, and static hosts send no CORS headers by default. Every scaffolded remote ships a `public/_headers` file with `Access-Control-Allow-Origin: *`, which Cloudflare Pages and Netlify pick up automatically. On Vercel, set the same header in `vercel.json` instead.
- The remote's manifest URL is always `<origin>/mf-manifest.json`; production builds emit that file into `dist`.

## Frameworks

Every app has a `framework` in `spool.json`, defaulting to `react`. Pick one per app with a `name:framework` spec on `spool create`, with `--framework` on `spool add`, or through the per-app prompt in interactive runs. Frameworks mix freely in one workspace:

```bash
spool create acme --host shell:vue --remotes "dash:react, widget:svelte"
spool create acme --framework svelte    # one framework for the whole workspace
spool add widget --framework vue        # a vue remote in a react workspace
```

How mixing works:

- React remotes expose their component; other frameworks expose a mount function (`(el) => cleanup`), and `src/remotes.d.ts` types both shapes.
- Hosts scaffolded by `spool create` consume each remote by its own contract out of the box, including a react bridge for non-react hosts. Adding a remote to an existing host later never edits your components: `spool add` wires the typings and bridge files, then prints the snippet to paste in.
- `spool add` keeps `shared` in sync. Adding the first svelte app to a react workspace puts `svelte` in `shared`, so every app on a framework loads one copy of its runtime. `spool doctor` warns when a framework runtime is missing from `shared`.
- `shared` applies per app: entries an app does not declare in its own package.json are dropped from its federation config automatically, so a svelte remote never tries to share react. An app whose package.json cannot be read shares nothing and warns, instead of sharing everything.
- `spool upgrade` regenerates each app's config for its own framework. A `vite.config.ts` or `spool.vite.ts` you have customized (one missing the "Generated by spool" marker) is left alone with a warning.

A react host mounts a mount-function remote through a small wrapper. Scaffolded hosts include it; `spool add` prints it for existing hosts:

```tsx
function MountRemote({ load }: { load: () => Promise<{ default: (el: HTMLElement) => () => void }> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void load().then(({ default: mount }) => {
      if (!cancelled && ref.current) cleanup = mount(ref.current);
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [load]);
  return <div ref={ref} />;
}

const loadWidget = () => import("widget/App");
// render <MountRemote load={loadWidget} /> where the remote belongs
```

Supported today: `react`, `svelte`, and `vue`. Other vite-native frameworks are the same recipe and likely to follow. Angular is deliberately out of scope: its Module Federation story is webpack/rspack based, and Angular-on-vite is not yet mature enough to support honestly.

## Sharing state between remotes

Remotes should not import each other's code, but they often need shared state: a player bar that any view can start, a cart that every surface reads. The pattern that works:

1. Add a state library to `shared` in `spool.json` so federation loads one copy. [@bkincz/clutch](https://github.com/bkincz/clutch) has first-class support for this:

```jsonc
"shared": ["react", "react-dom", "@bkincz/clutch", "@bkincz/clutch/react"]
```

2. Give each app its own copy of a small store module built on `sharedMachine`, which returns the same instance to every app on the page:

```typescript
import { createMachine, sharedMachine } from '@bkincz/clutch'

export const playerMachine = sharedMachine(
  'app:player',
  () => createMachine<PlayerState>({ initialState }),
  { contract: 1 },
)
```

3. Bump `contract` when the state shape changes. Apps deployed against different shapes warn at runtime instead of corrupting each other's state.

The [live demo](https://spool-demo-shell.pages.dev) runs this pattern: its browse view, search, and player bar are separate deployments sharing one player machine.

## What you get

Each workspace is a plain Vite + TypeScript monorepo. Nothing exotic, no meta-framework to learn:

```
acme/
  spool.json          # the manifest
  spool.vite.ts       # reads the manifest at startup; apps' vite configs call it
  apps/
    shell/            # host, imports the remotes
    dashboard/        # remote, exposes ./App
    profile/          # remote, exposes ./App
```

The workspace file matches your package manager (`pnpm-workspace.yaml`, or a `workspaces` field in `package.json`). Each app's `vite.config.ts` is a few static lines that hand the manifest's wiring to Vite. You never edit or regenerate it.

## License

MIT
