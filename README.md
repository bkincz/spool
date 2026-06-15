# spool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

spool is a small CLI for building micro frontends. It scaffolds a monorepo of Module Federation apps on Vite, starts them together with one command, and keeps every app's federation wiring in sync from a single `spool.json`. You describe your apps once and spool generates the rest.

## Requirements

- Node 20 or newer
- A package manager: pnpm, npm, or yarn. spool defaults to pnpm, but you choose per workspace.

## Install

spool isn't on npm yet, so build it from this repo and link the binary:

```bash
pnpm install
pnpm --filter @spool/cli build
pnpm --filter @spool/cli exec pnpm link --global
```

Then confirm it's on your PATH:

```bash
spool --help
```

## Getting started

Create a workspace with a host and two remotes, then start everything:

```bash
spool create acme --host shell --remotes "dashboard, profile"
cd acme
spool dev
```

Open http://localhost:5173 and you'll see the host with its remotes mounted over Module Federation. Prefer to be asked? Run `spool create` with no arguments and it walks you through it.

## Commands

### `spool create [dir]`

Scaffolds a new workspace. Pass what you know up front, or leave options out and spool will prompt for them.

| Option | Default | Description |
|---|---|---|
| `[dir]` | workspace name | Folder to create the workspace in |
| `-n, --name <name>` | folder name | Workspace name |
| `--host <name>` | `shell` | Host (shell) app name |
| `--remotes <list>` | prompt | Comma-separated remote names |
| `--pm <manager>` | prompt (`pnpm`) | Package manager: `pnpm`, `npm`, or `yarn` |
| `--here` | off | Scaffold into the current folder |
| `--no-install` | off | Skip the install step |

A note on package managers: spool writes the right setup for whichever you pick: `pnpm-workspace.yaml` for pnpm, a `workspaces` field for npm and yarn. Yarn works on both Classic (v1) and Berry (v3+): Berry's default Plug'n'Play doesn't sit well with Vite and Module Federation, so spool drops in a `.yarnrc.yml` that switches it to the `node_modules` linker. Classic ignores that file and already behaves the same way, so the same workspace runs either way.

### `spool dev`

Starts every app together. Remotes come up first, and spool waits until each one is actually serving its federation manifest before launching the hosts, so a host never loads against a remote that isn't ready. Logs are prefixed and colored per app, and Ctrl+C stops everything cleanly (yes, on Windows too).

```bash
spool dev
spool dev --only shell,dashboard   # just a subset
```

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

When you add a remote, spool wires it into the host's federation config and regenerates the typings, but it leaves your `App.tsx` alone so your layout is never overwritten. Instead it prints the exact import and mount snippet to paste in. Then it installs the new app so it's ready for `spool dev` (skip that with `--no-install`).

App and workspace names are kept simple on purpose: lowercase, starting with a letter, using only letters, digits, and single hyphens, like `dashboard` or `acme-frontend`.

| Option | Default | Description |
|---|---|---|
| `-t, --type <type>` | `remote` | `host` or `remote` |
| `-p, --port <port>` | next free | Dev server port |
| `--host <name>` | first host | Host to wire a new remote into |
| `--no-install` | off | Skip the install step |

### `spool doctor`

Checks the workspace and reports anything off: port collisions, missing app folders, remotes that point nowhere, and remotes no host imports. It exits non-zero on a real error, so it's safe to drop into CI.

```bash
spool doctor
```

## The manifest

Everything lives in one `spool.json` at the workspace root. It's the source of truth: each app's federation config (remotes, exposes, shared deps) is generated from it, so you edit one file instead of hand-syncing several.

```jsonc
{
  "name": "acme",
  "packageManager": "pnpm",
  "bundler": "vite",
  "shared": ["react", "react-dom"],
  "apps": {
    "shell":     { "type": "host",   "path": "apps/shell",     "port": 5173, "remotes": ["dashboard"] },
    "dashboard": { "type": "remote", "path": "apps/dashboard", "port": 5174, "exposes": { "./App": "./src/App.tsx" } }
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
| `apps.<name>.remotes` | Remotes a host consumes |
| `apps.<name>.exposes` | Modules a remote exposes, as `importName: sourcePath` |

Edit it by hand whenever you like, then run `spool doctor` to check it. `spool add` regenerates the affected app config for you.

## What you get

Each workspace is a plain Vite + React + TypeScript monorepo. Nothing exotic, no framework to learn:

```
acme/
  spool.json          # the manifest
  apps/
    shell/            # host, imports the remotes
    dashboard/        # remote, exposes ./App
    profile/          # remote, exposes ./App
```

The workspace file matches your package manager (`pnpm-workspace.yaml`, or a `workspaces` field in `package.json`). Each app's `vite.config.ts` holds its Module Federation wiring, generated from `spool.json`.

## License

MIT
