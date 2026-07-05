# Changelog

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
