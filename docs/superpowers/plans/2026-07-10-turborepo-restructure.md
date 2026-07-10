# Turborepo Restructure (Phase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-app repo into a pnpm-workspace + Turborepo monorepo (`apps/web`, `apps/mcp` scaffold, `packages/contracts`) with zero behavior change to the running web app.

**Architecture:** Move the entire current app wholesale into `apps/web`. Extract the one genuinely-shared, non-entangled contract surface — the generated `database.ts` and the fixed column/priority constants — into a **source-only** `@pinnwand/contracts` package (no build step; consumed as TS via Vite and tsconfig project references). `apps/mcp` is an empty scaffold this phase. `supabase/` stays at root, shared by both apps.

**Tech Stack:** pnpm workspaces, Turborepo (local cache only), TypeScript project references, Vite, Vitest, Playwright, self-hosted Supabase, Coolify/Docker.

## Global Constraints

- **Pure structural change. Zero behavior change** to the running web app. No new features, no schema/migration/RLS changes, no dependency upgrades beyond what the workspace itself needs (`turbo`).
- **`db:types` never hand-edited.** It regenerates into its new path; the roundtrip must work.
- **Node 22, pnpm 10.18.** Package manager pinned at `pnpm@10.18.0`.
- **Every changed line traces to the move.** No refactor of feature internals, no reformatting of untouched files.
- **`@pinnwand/contracts` is the workspace package name.** Web imports it instead of deep-importing `@/shared/types/database`.
- **Docs stay in sync** (`.claude/rules/documentation.md`): `CLAUDE.md` file-structure block, `.claude/rules/architecture.md` layer table, and any rule referencing `src/...` paths update to `apps/web/src/...`.
- **Done = green across the workspace:** `tsc -b`, `pnpm check` (Ultracite/Biome), `pnpm test` (Vitest), `pnpm test:integration`, `pnpm build`, and the Playwright e2e stack all pass; `pnpm dev:up && pnpm dev` serves the web app unchanged.

## Contracts scope decision (RESOLVED — minimal)

> **Resolved 2026-07-10:** user confirmed the YAGNI-minimal scope below. Phase 0 moves only `database.ts` + `columns.ts`; Row schemas defer to Phase 1.


The spec says "the zod boundary schemas both apps must agree on" move to `packages/contracts`. In the actual code those schemas (`BoardRowSchema`, `TaskRowSchema`, `MemberRowSchema`, their `toBoard`/`toTask` mappers, and per-use-case input schemas) are **entangled with TanStack query keys and web-specific input validation** in each feature's `api/*.ts`. Splitting them now — before the MCP exists to consume them — is speculative churn across four files.

**This plan takes the YAGNI-minimal scope:** Phase 0 moves only what is unambiguously shared and standalone — the generated `database.ts` and the `columns.ts` constants (`TASK_COLUMNS`, `TASK_PRIORITIES`, derived id tuples, `TaskColumnId`, `TaskPriorityId`, `DEFAULT_TASK_PRIORITY`). The Row schemas move into `@pinnwand/contracts` in **Phase 1**, one at a time, as the MCP actually imports them — a smaller, reviewable move then instead of a guess now. `@pinnwand/contracts` exists and exports the shared type surface, which is all Phase 1 strictly needs to avoid duplicating `database.ts`.

If the user prefers the full schema extraction in Phase 0, add a Task 3b that moves each Row schema + mapper into `packages/contracts/src/<entity>.ts` and re-imports them in the feature api files. Everything else in this plan is unchanged.

---

## File Structure (target)

```
apps/
  web/            <- entire current app, moved from repo root
    src/  index.html  vite.config.ts  tsconfig*.json  public/  pwa-assets.config.ts
    playwright.config.ts  vitest.integration.config.ts  e2e/  knip.json  components.json
  mcp/            <- scaffold only: package.json + tsconfig.json
packages/
  contracts/
    package.json  tsconfig.json
    src/
      index.ts        <- re-exports database + columns
      database.ts     <- moved from src/shared/types/database.ts (db:types target)
      columns.ts      <- moved from src/features/tasks/columns.ts
supabase/           <- unchanged, at root
docker/             <- unchanged, at root (build contexts repoint to apps/web)
turbo.json
pnpm-workspace.yaml
package.json        <- root: workspaces + turbo scripts, no app code
```

**What stays at repo root and does NOT move:** `supabase/`, `docker/`, `docker-compose*.yml`, `scripts/seed-dev.mjs`, `renovate.json`, `skills-lock.json`, `README.md`, `.claude/`, `docs/`.

---

## Task 1: Workspace skeleton (root)

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `package.json` (root — replaces the current app package.json AFTER Task 2 moves the app copy into apps/web; see ordering note)
- Add dev dependency: `turbo` (root, `-w`)

**Ordering note:** Do Task 2 (move app into `apps/web`) and Task 1 together as one working step — the current root `package.json` becomes `apps/web/package.json`, and a new thin root `package.json` replaces it. They are one atomic move; commit once.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "check": {},
    "check-types": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "test:integration": {
      "dependsOn": ["^build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

- [ ] **Step 3: Create the thin root `package.json`** (after Task 2 has moved the old one)

```json
{
  "name": "pinnwand",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "packageManager": "pnpm@10.18.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "turbo run dev --filter=@pinnwand/web",
    "build": "turbo run build",
    "check": "turbo run check",
    "check-types": "turbo run check-types",
    "fix": "turbo run fix",
    "test": "turbo run test",
    "test:integration": "turbo run test:integration",
    "knip": "pnpm --filter @pinnwand/web knip",
    "preview": "pnpm --filter @pinnwand/web preview",
    "dev:up": "docker compose up -d --wait kong mailpit studio seed",
    "dev:down": "docker compose down",
    "dev:reset": "docker compose down -v",
    "dev:logs": "docker compose logs -f",
    "dev:psql": "docker compose exec db psql -U postgres",
    "seed:dev": "docker compose run --rm --build seed",
    "db:migration:new": "supabase migration new",
    "db:push": "supabase db push --db-url postgresql://postgres:postgres@localhost:5432/postgres --include-all",
    "db:reset": "supabase db reset --db-url postgresql://postgres:postgres@localhost:5432/postgres",
    "db:types": "supabase gen types typescript --db-url postgresql://postgres:postgres@localhost:5432/postgres > packages/contracts/src/database.ts",
    "e2e": "pnpm e2e:up && pnpm e2e:test",
    "e2e:up": "docker compose -f docker-compose.e2e.yml up --build -d --wait db migrate kong auth rest realtime mailpit web",
    "e2e:test": "docker compose -f docker-compose.e2e.yml up --exit-code-from playwright playwright",
    "e2e:logs": "docker compose -f docker-compose.e2e.yml logs web auth rest realtime migrate",
    "e2e:down": "docker compose -f docker-compose.e2e.yml down -v",
    "e2e:chromium": "PLAYWRIGHT_ARGS='--project=chromium' pnpm e2e",
    "prepare": "husky"
  },
  "devDependencies": {
    "turbo": "^2"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["supabase", "esbuild", "@biomejs/biome", "@tailwindcss/oxide", "unrs-resolver", "sharp"]
  }
}
```

- Note: `db:*`, `dev:*`, `e2e:*`, `seed:dev`, `prepare` stay at root because they target `supabase/`, Docker, and Husky, which do not move. Only the target path of `db:types` changes (→ `packages/contracts/src/database.ts`). Husky lives at repo root (`.husky/`); keep `prepare` at root.

**Verify:** deferred to Task 6 (full green). After this + Task 2, `pnpm install` at root must resolve the workspace without error.

---

## Task 2: Move the web app into `apps/web`

**Files (git mv, preserve history):**
- Move `src/` → `apps/web/src/`
- Move `index.html`, `vite.config.ts`, `pwa-assets.config.ts`, `playwright.config.ts`, `vitest.integration.config.ts`, `knip.json`, `components.json` → `apps/web/`
- Move `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` → `apps/web/`
- Move `e2e/` → `apps/web/e2e/`
- Move `public/` → `apps/web/public/`
- Move the old root `package.json` → `apps/web/package.json`, then rename its `"name"` to `@pinnwand/web` and strip the root-only scripts (`db:*`, `dev:*`, `e2e:*`, `seed:dev`, `prepare`) — those now live in the root package.json (Task 1). Keep app-scoped scripts: `dev` (`vite`), `build`, `preview`, `check`, `check-types`, `fix`, `knip`, `test`, `test:watch`, `test:integration`, `generate-pwa-assets`. Keep all `dependencies`/`devDependencies` (remove `supabase` from devDeps only if the root owns migrations — KEEP it in web for now; `db:types` runs from root but `supabase` binary resolves from the workspace either way. Simplest: leave `supabase` in web devDeps.)

- [ ] **Step 1: git mv the app tree into `apps/web`**

```bash
cd apps-restructure-worktree-root
mkdir -p apps/web packages/contracts/src apps/mcp
git mv src index.html vite.config.ts pwa-assets.config.ts playwright.config.ts vitest.integration.config.ts knip.json components.json apps/web/
git mv tsconfig.json tsconfig.app.json tsconfig.node.json apps/web/
git mv e2e public apps/web/
git mv package.json apps/web/package.json
```

- [ ] **Step 2: Add `@pinnwand/web` name + workspace dep on contracts**

In `apps/web/package.json`: set `"name": "@pinnwand/web"`, remove the root-only scripts (listed above), and add `"@pinnwand/contracts": "workspace:*"` to `dependencies`.

- [ ] **Step 3: Create the thin root package.json + workspace files** (Task 1 Steps 1–3).

- [ ] **Step 4: `pnpm install`** at root.

Run: `pnpm install`
Expected: resolves `@pinnwand/web` and `@pinnwand/contracts` (contracts created in Task 3) as workspace packages. If contracts doesn't exist yet, do Task 3 before install; recommended order is 3 → install.

---

## Task 3: Create `@pinnwand/contracts` (source-only) and move the shared surface

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Move: `apps/web/src/shared/types/database.ts` → `packages/contracts/src/database.ts`
- Move: `apps/web/src/features/tasks/columns.ts` → `packages/contracts/src/columns.ts`

- [ ] **Step 1: `packages/contracts/package.json`** (source-only; no build)

```json
{
  "name": "@pinnwand/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./database": "./src/database.ts",
    "./columns": "./src/columns.ts"
  }
}
```

Rationale (ponytail): consumers are Vite (web) and, in Phase 1, tsc/tsx (mcp) — both read `.ts` directly. No build step, no `dist`, no watch. If Phase 1's Node runtime needs compiled JS, add a `tsc` build then. `exports` points at source.

- [ ] **Step 2: `packages/contracts/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: git mv the two files**

```bash
git mv apps/web/src/shared/types/database.ts packages/contracts/src/database.ts
git mv apps/web/src/features/tasks/columns.ts packages/contracts/src/columns.ts
```

- [ ] **Step 4: `packages/contracts/src/index.ts`**

```ts
export * from "./columns";
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database";
```
(Adjust the exact `database.ts` export names to what the generated file provides — Supabase's generator emits `Database` and helper types; confirm and match.)

- [ ] **Step 5: Rewire the two import sites in web**

- `apps/web/src/shared/lib/supabase.ts`: change `import type { Database } from "@/shared/types/database"` → `import type { Database } from "@pinnwand/contracts"`.
- Every importer of the old `@/features/tasks/columns` (tasks feature `api`, `types.ts`, components, tests): change to `@pinnwand/contracts`. Find them:

```bash
cd apps/web && rg -l "features/tasks/columns|\./columns|\.\./columns" src e2e
```
Rewrite each to `import { ... } from "@pinnwand/contracts"`.

- [ ] **Step 6: Update the biome ignore path**

`apps/web/biome.jsonc` currently ignores `!src/shared/types/database.ts`. That generated file now lives in contracts. Add a biome config or ignore at `packages/contracts` for `src/database.ts`, and drop the stale ignore in web. (Simplest: give `packages/contracts` no separate biome file; add `!packages/contracts/src/database.ts` to the web biome `files.includes` only if biome runs from root over the whole workspace. Decide based on how `turbo run check` invokes ultracite — per package. So add the ignore to a `packages/contracts/biome.jsonc` extending ultracite, or run biome root-level. Recommended: root `biome.jsonc` that ignores both generated files, and each package's `check` script points at it.)

---

## Task 4: Wire tsconfig project references + Vite alias

**Files:**
- Modify: `apps/web/tsconfig.json`, `apps/web/tsconfig.app.json`
- Modify: `apps/web/vite.config.ts` (routesDirectory/generatedRouteTree paths are relative to config location — unchanged since config moved with src; verify)
- Create/confirm: root `tsconfig.json` (optional solution-style) — only if `tsc -b` is invoked from root via turbo per-package; per-package `tsc -b` needs no root tsconfig.

- [ ] **Step 1: Add project reference from web to contracts**

In `apps/web/tsconfig.json` add:
```json
"references": [
  { "path": "./tsconfig.app.json" },
  { "path": "./tsconfig.node.json" },
  { "path": "../../packages/contracts/tsconfig.json" }
]
```
And in `apps/web/tsconfig.app.json` keep `"paths": { "@/*": ["./src/*"] }` (still relative to apps/web). Add `"@pinnwand/contracts"` resolution — with `moduleResolution: bundler` + the package `exports`, no path alias is needed; TS resolves the workspace package. Verify `tsc -b` resolves it; if not, add `"paths": { "@pinnwand/contracts": ["../../packages/contracts/src/index.ts"] }`.

- [ ] **Step 2: Vite** — no alias change needed for `@pinnwand/contracts` (Vite resolves the workspace package via node_modules symlink). The `@` alias stays `path.resolve(import.meta.dirname, "src")` — still correct since vite.config.ts sits in apps/web. Confirm `import.meta.dirname` resolves to apps/web.

- [ ] **Step 3: `tsc -b` from apps/web**

Run: `cd apps/web && pnpm exec tsc -b`
Expected: clean. Contracts type-checks as a referenced project; web resolves `@pinnwand/contracts`.

---

## Task 5: Repoint Docker build contexts + Coolify to `apps/web`

**Files:**
- Modify: `docker/Dockerfile` (the web build + migrate targets) — its `COPY`/build paths assumed repo-root app. Repoint to `apps/web` (and the workspace root for pnpm install).
- Modify: `docker-compose.e2e.yml` — `web` and `migrate` services `build.context: .` stays root (needs workspace + supabase), but the Dockerfile must build the web app from `apps/web`. Adjust the Dockerfile, not the context.
- Modify: `docker-compose.coolify.yml` — same: the `runtime` (Caddy static) + `migrate` targets build from `apps/web`.

- [ ] **Step 1: Read `docker/Dockerfile`** and identify web build stage (`pnpm install`, `pnpm build`, copy `dist`). Update to workspace-aware build:
  - Copy `pnpm-workspace.yaml`, root `package.json`, `apps/web/package.json`, `packages/contracts/package.json` first, `pnpm install --frozen-lockfile`, then copy sources, then `pnpm --filter @pinnwand/web build`, output `apps/web/dist`.
  - The `migrate` target uses `supabase/` (root) + the supabase CLI — unchanged except any `WORKDIR`/copy of package.json for the CLI. Verify.

- [ ] **Step 2: Confirm compose files** need no context change (context `.` = repo root, correct for a workspace build). Only the Dockerfile internals change.

- [ ] **Step 3: e2e stack boots**

Run: `pnpm e2e:up` then `pnpm e2e:test` (or full `pnpm e2e`)
Expected: web service builds from apps/web, migrate applies migrations, Playwright critical-journey specs pass.

---

## Task 6: Full-workspace green + docs sync

**Files:**
- Modify: `CLAUDE.md` (file-structure block, essential commands db:types path, any `src/...` → `apps/web/src/...`)
- Modify: `.claude/rules/architecture.md` (layer table paths, `src/shared/lib/supabase.ts` → `apps/web/src/shared/lib/supabase.ts`, note `@pinnwand/contracts` for generated types + columns)
- Modify: any other rule referencing `src/shared/types/database.ts` (→ `packages/contracts/src/database.ts`) or `src/features/tasks/columns.ts` (→ `@pinnwand/contracts`). Grep: `rg -l "src/shared/types/database|features/tasks/columns|src/shared|src/features|src/app" .claude/rules CLAUDE.md`
- Modify: `apps/web/knip.json` entry/project globs still relative to apps/web (unchanged); confirm knip passes.

- [ ] **Step 1: Docs** — apply the path edits above. Add a "Monorepo layout" note to CLAUDE.md and an `## Resolved deviation` note in the architecture rule recording that generated types + fixed constants now live in `@pinnwand/contracts` (per `documentation.md`, don't rewrite history — add a note).

- [ ] **Step 2: Green gate (run all):**

```bash
pnpm install
pnpm -w run check-types      # tsc -b across workspace
pnpm -w run check            # ultracite/biome clean
pnpm -w run test             # vitest unit green (columns.test now resolves @pinnwand/contracts)
pnpm --filter @pinnwand/web test:integration   # testcontainer integration green
pnpm -w run build            # web build + contracts typecheck
pnpm --filter @pinnwand/web knip               # no new unused
```
Expected: all green.

- [ ] **Step 3: `db:types` roundtrip**

```bash
pnpm dev:up
pnpm db:types                # writes packages/contracts/src/database.ts
pnpm -w run check-types      # web still type-checks against regenerated file
git diff --stat packages/contracts/src/database.ts   # no unexpected drift
```
Expected: regenerates in place, web type-checks.

- [ ] **Step 4: Manual smoke**

```bash
pnpm dev:up && pnpm dev
```
Sign in as `alice@dev.local` (OTP from Mailpit :8025), open Team-Board, move a task. Behavior identical to pre-restructure.

---

## Task 7: `apps/mcp` empty scaffold

**Files:**
- Create: `apps/mcp/package.json`, `apps/mcp/tsconfig.json`, `apps/mcp/src/.gitkeep`

- [ ] **Step 1: `apps/mcp/package.json`**

```json
{
  "name": "@pinnwand/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {},
  "dependencies": {
    "@pinnwand/contracts": "workspace:*"
  }
}
```

- [ ] **Step 2: `apps/mcp/tsconfig.json`** referencing contracts (mirrors web's contract reference). Node types, `moduleResolution: bundler`, `noEmit` for now (real build config lands in Phase 1).

- [ ] **Step 3: `pnpm install`** resolves three workspace packages; `pnpm -w run check-types` still green (mcp has no source yet, only `.gitkeep`).

---

## Self-Review notes

- **Spec coverage:** target layout ✓ (Tasks 1–3,7); `db:types` repoint ✓ (Task 1 root script + Task 6 roundtrip); Vite/tsconfig/biome ✓ (Tasks 3–4,6); Turbo pipeline ✓ (Task 1); root scripts expose same verbs ✓ (Task 1); Coolify/e2e build context ✓ (Task 5); CLAUDE.md + rules ✓ (Task 6); non-goals honored (no schema/RLS/feature changes) ✓. **Deviation from spec:** contracts scope is minimal (database.ts + columns only), Row schemas deferred to Phase 1 — flagged in "Contracts scope decision" above, needs user confirm.
- **Turbo `dependsOn ^build`:** contracts is source-only with no `build` script, so `^build` is a no-op for web — harmless, keeps the pipeline shape the spec asked for. If a real contracts build is added in Phase 1, the dependsOn already wires it.
- **Commits:** per the Kanban-slice precedent and the user's "don't commit yet" directive, execution is test-gated, not per-task-committed. Ignore the commit steps until the user asks to commit.
