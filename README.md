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

| Command                         | What it does                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `spool create [dir]`            | Scaffold a workspace                                                     |
| `spool dev [--only <list>]`     | Run all apps together, remotes first                                     |
| `spool build [--only <list>]`   | Production build, remotes before hosts                                   |
| `spool add <name>`              | Add an app and wire it in                                                |
| `spool remove <name> [--files]` | Remove an app and unwire it from hosts                                   |
| `spool deploy [--only <list>]`  | Run each app's `deploy` command, remotes first                           |
| `spool ci [--force]`            | Generate a path-filtered GitHub deploy workflow per deployable app       |
| `spool upgrade [--dry-run]`     | Regenerate spool-owned files and sync the toolchain to the installed CLI |
| `spool doctor [--remote]`       | Check ports, wiring, and shared deps. `--remote` also probes deployed urls |

### create

| Option              | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `-n, --name <name>` | Workspace name (defaults to the folder name)                |
| `--host <name>`     | Host app, as `name` or `name:framework`                     |
| `--remotes <list>`  | Comma-separated remotes, each as `name` or `name:framework` |
| `--framework <fw>`  | Default framework: `react`, `svelte`, or `vue`              |
| `--addons <list>`   | Extras: `ladle`, `playwright`, `state`, or `none`           |
| `--pm <manager>`    | `pnpm`, `npm`, or `yarn`                                    |
| `--here`            | Scaffold into the current folder                            |
| `--no-install`      | Skip the install step                                       |

Anything you leave out, spool asks for. Names are lowercase with single hyphens, like `acme-frontend`.

### add

| Option             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `-t, --type`       | `host` or `remote` (default `remote`)              |
| `-p, --port`       | Dev server port (default: next free)               |
| `--host <name>`    | Host to wire the remote into (default: first host) |
| `--framework <fw>` | `react`, `svelte`, or `vue`                        |
| `--no-install`     | Skip the install step                              |

`spool add` updates `spool.json`, host typings, and bridge files, then prints the mount snippet to paste in. It never edits your components.

## The manifest

Everything lives in one `spool.json`. Each app's `vite.config.ts` reads it through `spool.vite.ts` when Vite starts, so the manifest is the only thing you ever edit.

```jsonc
{
  "name": "acme",
  "packageManager": "pnpm",
  "shared": ["react", "react-dom"],
  "apps": {
    "shell":     { "type": "host",   "path": "apps/shell",     "port": 5173, "remotes": ["dashboard"] },
    "dashboard": { "type": "remote", "path": "apps/dashboard", "port": 5174, "exposes": { "./App": "./src/App.tsx" },
                   "url": "https://dashboard.example.com/mf-manifest.json" }
  }
}
```

| Field                    | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `shared`                 | Deps shared as singletons across apps                             |
| `apps.<name>.type`       | `host` consumes remotes, `remote` exposes modules                 |
| `apps.<name>.framework`  | `react` (default), `svelte`, or `vue`                             |
| `apps.<name>.port`       | Dev server port                                                   |
| `apps.<name>.url`        | Optional. Deployed `mf-manifest.json`, used by host production builds |
| `apps.<name>.deploy`     | Optional. Shell command `spool deploy` runs in the app folder     |
| `apps.<name>.remotes`    | Remotes a host consumes                                           |
| `apps.<name>.exposes`    | Modules a remote exposes                                          |

Typos fail loudly instead of being silently dropped, and `spool doctor` catches the rest after hand-editing.

## Frameworks

Mix react, svelte, and vue freely. Every app picks its own framework. React remotes expose a component, svelte and vue remotes expose a mount function, and hosts consume each remote by its contract (non-react hosts get a small react bridge). Sharing applies per app: entries an app does not declare in its own package.json are dropped from its federation config, so a svelte remote never tries to share react.

## Extras

`spool create` can also set up the tooling most workspaces end up wanting. Pick at the prompt, or pass `--addons "ladle, playwright, state"`:

- **Ladle**: a react design-system package in `packages/ui` with a component workshop. Open it with `pnpm --filter ui ladle`.
- **Playwright**: e2e tests in `packages/e2e` that boot the workspace and check every remote mounts. Run `npx playwright install` once, then `pnpm --filter e2e test`.
- **Shared state**: [@bkincz/clutch](https://github.com/bkincz/clutch) shared as a singleton, plus a small store module in every app so they all read and write one state instance per page. Bump the store's `contract` when the state shape changes.

## Deploying

Every app builds to a plain static site. Give apps a `deploy` command in `spool.json`, deploy the remotes, set each remote's `url` to its deployed `mf-manifest.json`, then rebuild and deploy the host:

```bash
spool build
spool deploy
```

A host resolves each remote in this order:

1. `SPOOL_REMOTE_<NAME>` env var (dev and build)
2. the remote's `url` in `spool.json` (production builds only)
3. `http://localhost:<port>/mf-manifest.json`

Remotes ship a `public/_headers` with open CORS. Cloudflare Pages and Netlify read it as-is, and on Vercel you set the same header in `vercel.json`. Example deploy commands: `wrangler pages deploy dist --project-name=<p>`, `netlify deploy --prod --dir=dist`, `vercel deploy dist --prod`, `aws s3 sync dist s3://<bucket> --delete`.

## License

MIT
