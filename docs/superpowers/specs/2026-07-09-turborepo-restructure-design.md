# Turborepo Restructure Design (Phase 0)

**Date:** 2026-07-09
**Status:** Approved for planning
**Phase:** 0 of 2 (prerequisite for the MCP connector server)
**Scope:** Pure structural change. Zero behavior change to the running app.

## Goal

Convert the single-app repository into a pnpm-workspace plus Turborepo monorepo so the web app and a future MCP server share one contract package (generated database types, zod boundary schemas, enum and column constants) with a single source of truth. Do this now, while the repo is young and the tasks Kanban slice is not yet built, because restructuring after both Kanban and the MCP land is more painful.

## Why now

- Only a handful of features have shipped, so the blast radius of moving files is small.
- The tasks Kanban slice is designed but unbuilt. Building it and the MCP on the new layout is cleaner than migrating afterward.
- The MCP server (Phase 1) needs to import `database.ts` and the zod contracts without duplicating them. That requires a shared workspace package, which requires the restructure.

## Target layout

```
apps/
  web/            <- the current Vite app, moved wholesale from the repo root
  mcp/            <- empty scaffold in this phase (package.json + tsconfig only)
packages/
  contracts/      <- generated database.ts + zod schemas + enum/column constants
supabase/         <- stays at root, shared by both apps
turbo.json        <- task pipeline
package.json      <- root: workspaces + Turbo scripts, no app code
pnpm-workspace.yaml
```

### What moves into `apps/web`

The entire current app: `src/`, `index.html`, `vite.config.ts`, `tsconfig*.json`, `public/`, PWA config, and the web-specific test setup. `routeTree.gen.ts` stays generated under `apps/web/src/app`.

### What moves into `packages/contracts`

- The generated `database.ts` (today at `src/shared/types/database.ts`).
- The zod boundary schemas currently colocated in feature `api/` folders that both apps must agree on. Only the schemas that describe the shared data contract move; UI-only schemas stay in `apps/web`.
- Enum and column constants: `columns.ts` (the fixed `TASK_COLUMNS`), the priority enum values, and any shared literal sets.

Both apps import these as `@pinnwand/contracts`. The web app replaces its deep imports of `shared/types/database` with the package import.

## Config changes (every line traces to the move)

- **`db:types` output path** repoints to `packages/contracts/src/database.ts`. The command stays the same shape (`supabase gen types`), only the target path changes. Regenerating still never hand-edits the file.
- **Vite / tsconfig / biome** path bases update for the new root. tsconfig project references wire `apps/web` and `apps/mcp` to `packages/contracts`.
- **Turbo pipeline** (`turbo.json`) defines `build`, `dev`, `lint`, `test`, `check` with correct `dependsOn` (contracts builds before the apps) and cache inputs/outputs.
- **Root scripts** expose the same developer verbs through Turbo: `pnpm dev` runs the web dev server, `pnpm build` builds all, `pnpm check` / `pnpm test` fan out. The existing `dev:up`, `db:*`, `seed:dev`, `e2e` scripts keep working (they target `supabase/` and Docker, which do not move).
- **Coolify:** the existing static-frontend service repoints its build context to `apps/web` and its output stays the Caddy-served `dist`. The `docker-compose.*.yml` files are unchanged because Supabase is a separate stack. The `apps/mcp` service is added in Phase 1, not here.
- **`CLAUDE.md` and every rule file** that references `src/features/...` or `src/shared/...` update to `apps/web/src/...`. The `.claude/rules/architecture.md` layer-boundary table and the file-structure block in `CLAUDE.md` are the main edits. This is required by `.claude/rules/documentation.md`, which mandates keeping docs in sync with structure.

## Non-goals

- No new features, no dependency upgrades beyond what the workspace needs, no refactor of feature internals.
- No change to Supabase schema, migrations, or RLS.
- No Turbo remote caching setup in this phase (local caching only); revisit if CI justifies it.

## Testing and done criteria

- `tsc -b` clean across the workspace.
- `pnpm check` (Ultracite/Biome) clean across all packages.
- `pnpm test` (Vitest) green, including the existing `columns.test.ts` now resolving `@pinnwand/contracts`.
- `pnpm db:types` regenerates into `packages/contracts` and the web app type-checks against it (the roundtrip works).
- `pnpm dev:up` boots the local Supabase stack and `pnpm dev` serves the web app unchanged.
- The Playwright e2e stack (`docker-compose.e2e.yml`) still boots and the existing critical-journey specs pass.
- Manual smoke: sign in as a seeded user, view a board. Behavior is identical to pre-restructure.

## Delivery

One PR for the restructure. It merges before any Phase 1 work begins. Phase 1 (the MCP connector server) stacks on this branch.
