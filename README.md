# spool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A CLI for creating, configuring and maintaining micro frontends. spool scaffolds a pnpm monorepo of Module Federation apps on Vite, runs them together, and keeps every app's federation config in sync from a single manifest.

## Requirements

- Node 20 or newer
- pnpm

## Setup

spool is not published yet, so build it from this repo and link the binary:

```bash
pnpm install
pnpm --filter @spool/cli build
pnpm --filter @spool/cli exec pnpm link --global
```

`spool` is now on your PATH:

```bash
spool --help
```

## Quick Start

Scaffold a workspace with a host and two remotes, then start everything:

```bash
spool create acme --host shell --remotes "dashboard, profile"
cd acme
spool dev
```

Open the host at http://localhost:5173 and its remotes are mounted over Module Federation. Run `spool create` with no arguments to be prompted for the names instead.

## Commands

### create

Scaffold a new workspace.

```bash
spool create acme --host shell --remotes "dashboard, profile"
```

| Option | Default | Description |
|---|---|---|
| `[dir]` | workspace name | Folder to create the workspace in (defaults to the workspace name) |
| `-n, --name <name>` | folder name | Workspace name |
| `--host <name>` | `shell` | Host (shell) app name |
| `--remotes <list>` | prompt | Comma separated remote names |
| `--here` | off | Scaffold into the current folder |
| `--no-install` | off | Skip `pnpm install` |

### dev

Run the host and remotes together.

```bash
spool dev
spool dev --only shell,dashboard   # run a subset
```

Remotes start first. spool waits for each one to serve its federation manifest before starting the hosts, so the host never loads against a remote that is not ready yet. Output is prefixed and colored per app, and Ctrl+C stops every server, including on Windows.

### build

Build every app for production, remotes before hosts.

```bash
spool build
spool build --only dashboard
```

### add

Add an app to an existing workspace.

```bash
spool add settings                 # a remote, wired into the host
spool add admin --type host        # another host
spool add reports --port 5200      # choose the port
spool add billing --host shell     # wire into a specific host
```

A new remote is wired into the host and the host's federation config (and typings) is regenerated. The host's `App.tsx` is left untouched so your layout is never clobbered, so spool prints the exact `import` and mount snippet to paste in. spool then installs the app so it is ready for `spool dev`. Pass `--no-install` to skip that.

App and workspace names must be lowercase, start with a letter, and use only letters, digits and single hyphens (for example `dashboard` or `acme-frontend`).

| Option | Default | Description |
|---|---|---|
| `-t, --type <type>` | `remote` | `host` or `remote` |
| `-p, --port <port>` | next free | Dev server port |
| `--host <name>` | first host | Host to wire a new remote into |
| `--no-install` | off | Skip `pnpm install` |

### doctor

Check the workspace for problems.

```bash
spool doctor
```

It reports port collisions, missing app folders, remotes that point at nothing, and remotes that no host imports. It exits non zero on an error, so it works in CI.

## The manifest

Every workspace has a `spool.json` at its root. It is the source of truth: each app's federation config (remotes, exposes, shared deps) is generated from it.

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

You can edit `spool.json` by hand. Run `spool doctor` to check it, and `spool add` regenerates the affected app config.

## What gets generated

```
acme/
  spool.json
  pnpm-workspace.yaml
  apps/
    shell/        host, imports the remotes
    dashboard/    remote, exposes ./App
    profile/      remote, exposes ./App
```

Each app is a standard Vite, React and TypeScript project. Its `vite.config.ts` holds the Module Federation wiring, generated from `spool.json`.

## License

MIT
