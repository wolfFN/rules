# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — runs [scripts/build.ts](scripts/build.ts) via `tsx`, regenerates everything under `dist/`. Requires Node 20+ (uses built-in `fetch` and `AbortSignal.timeout`).
- No test suite. `npm test` is a placeholder that exits 1.

## Architecture

The repo is a Clash rule-provider builder: `sources/*.txt` + upstream URLs → `dist/*.yaml`, served via jsdelivr to Clash clients.

**The flow** ([scripts/build.ts](scripts/build.ts)):

1. Reads [build.config.yaml](build.config.yaml). Each `outputs[]` entry has a `name` and a `sources` list.
2. Each `sources` item is either:
   - a string — relative path under `sources/`, parsed by `loadGroups()` (lines starting with `#` become section comments, other non-empty lines become rules)
   - an object `{ url, comment? }` — fetched at build time, parsed as `{ payload: string[] }`, the whole list becomes a single group with `comment` (or the URL) as its header
3. `buildOutput()` merges all groups for an output, deduplicating rules across sources via a single `Set<string>`. Earlier sources win.
4. Output is a Clash `payload:` YAML with section comments preserved.

**Failure mode is intentional**: any upstream fetch failure or missing/non-array `payload` throws and fails the build. We never want to silently ship a degraded ruleset.

## CI / dist policy

- [.github/workflows/build.yml](.github/workflows/build.yml) runs on push to `master` (when `sources/`, `build.config.yaml`, `scripts/`, lockfile, or the workflow itself changes) and commits any `dist/` diff back as `chore: regenerate rules [skip ci]`.
- **Do not commit `dist/` locally.** Edit sources / config / build script, commit only those, let CI regenerate. If you ran `npm run build` locally to verify, revert `dist/` before committing (`git checkout -- dist/`).
- Default branch is `master` (not `main`).

## Adding a new rule provider

1. (Optional) Create `sources/<name>.txt` with `# section` headers and `DOMAIN-SUFFIX,...` style entries.
2. Add an entry to [build.config.yaml](build.config.yaml) under `outputs:` — mix local files and upstream URL objects as needed.
3. Push. CI builds and commits `dist/<Name>.yaml`. Clients consume it at `https://cdn.jsdelivr.net/gh/wolfFN/rules@master/dist/<Name>.yaml`.
