# spool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

spool is a small CLI for building micro frontends. It scaffolds a monorepo of Module Federation apps on Vite, runs them together with one command, and keeps all federation wiring in a single `spool.json`. Describe your apps once and spool handles the rest.

**Live demo:** [spool-demo-shell.pages.dev](https://spool-demo-shell.pages.dev), a host and its remotes on separate Cloudflare Pages deployments.

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
| `--host <name>` | `shell` | Host (shell) app name |
| `--remotes <list>` | prompt | Comma-separated remote names |
| `--pm <manager>` | prompt (`pnpm`) | Package manager: `pnpm`, `npm`, or `yarn` |
| `--here` | off | Scaffold into the current folder |
| `--no-install` | off | Skip the install step |

Notes:

- App and workspace names are lowercase, start with a letter, and use only letters, digits, and single hyphens. Examples: `dashboard`, `acme-frontend`.
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
| `--no-install` | off | Skip the install step |

Adding a remote updates `spool.json` and the host's typings. Your `App.tsx` is never touched; spool prints the exact import and mount snippet to paste in.

### `spool doctor`

Checks the workspace and reports anything off: port collisions, missing app folders, remotes that point nowhere, remotes no host imports, shared deps that are missing or on mismatched versions, and a missing `spool.vite.ts`. Exits non-zero on a real error, so you can run it in CI.

```bash
spool doctor
```

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
| `apps.<name>.path` | App folder, relative to the root |
| `apps.<name>.port` | Dev server port |
| `apps.<name>.url` | Optional. The remote's deployed `mf-manifest.json`, used by host production builds |
| `apps.<name>.remotes` | Remotes a host consumes |
| `apps.<name>.exposes` | Modules a remote exposes, as `importName: sourcePath` |

Notes:

- Unknown or misspelled keys are rejected with an error, not silently dropped.
- Run `spool doctor` after hand-editing to catch mistakes.

## Deploying remotes

Each app builds to a plain static site, so any static host works. Deploy each remote, set its `url` in `spool.json` to the deployed `mf-manifest.json`, rebuild the host, and deploy that too:

```bash
spool build
wrangler pages deploy apps/dashboard/dist   # or netlify deploy, vercel, S3, ...
```

A host looks up each remote in this order:

1. `SPOOL_REMOTE_<NAME>` environment variable, e.g. `SPOOL_REMOTE_DASHBOARD=https://staging.example.com/mf-manifest.json`. Applies in dev and build, so you can point one remote anywhere without touching the manifest.
2. the remote's `url` in `spool.json`. Production builds only; `spool dev` keeps using your local servers.
3. `http://localhost:<port>/mf-manifest.json`.

Notes:

- Hosts fetch remote assets cross-origin, and static hosts send no CORS headers by default. Every scaffolded remote ships a `public/_headers` file with `Access-Control-Allow-Origin: *`, which Cloudflare Pages and Netlify pick up automatically. On Vercel, set the same header in `vercel.json` instead.
- The remote's manifest URL is always `<origin>/mf-manifest.json`; production builds emit that file into `dist`.

## What you get

Each workspace is a plain Vite + React + TypeScript monorepo. Nothing exotic, no framework to learn:

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
