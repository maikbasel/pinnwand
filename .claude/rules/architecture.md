# Architecture: Vertical Feature Slices

Always-loaded — layer boundaries are non-negotiable for this codebase.

Code is organized by feature, not by technical layer. Each feature is a complete vertical slice with strict layer separation between UI, orchestration, and data access.

## Feature slice structure

```
src/features/<feature>/
├── index.ts          ← Public API of the feature (only exports consumed by app/ or other features)
├── types.ts          ← Feature-local TypeScript types
├── api/              ← Supabase calls only — no React imports
│   └── <feature>.ts
├── hooks/            ← TanStack Query hooks — orchestrates use cases
│   └── use<Feature>.ts
└── components/       ← React UI — no Supabase imports
    └── <Component>.tsx
```

## Layer rules

| Layer | May import | May NOT import |
|---|---|---|
| `components/` | `hooks/`, `types.ts`, other components, `shared/` | `api/`, `@supabase/*` directly |
| `hooks/` | `api/`, `types.ts`, `@tanstack/react-query`, `shared/` | React DOM components |
| `api/` | `shared/lib/supabase.ts`, `types.ts`, `@pinnwand/contracts`, `zod`, `@/app/env` | React, hooks, components |
| `index.ts` | Re-exports the feature's public surface only | — |

`api/` modules may read config directly from `@/app/env` (the zod-parsed env module — config, no React/Supabase), the same env module `shared/lib/supabase.ts` reads.

## Cross-cutting

- `apps/web/src/shared/lib/supabase.ts` is the **only** file that calls `createClient` — every `api/` module imports the singleton from there.
- `apps/web/src/shared/` holds primitives reused across features: UI components, hooks, lib utilities.
- `apps/web/src/app/` is the router + entry shell. Zero business logic. Routes import from features' `index.ts`.

## Resolved deviation: monorepo + `@pinnwand/contracts`

The app is a pnpm-workspace + Turborepo monorepo: the Vite app lives in `apps/web`, and the shared data contract — the generated `database.ts` (`Database` type) and the fixed `TASK_COLUMNS` / `TASK_PRIORITIES` constants — lives in `packages/contracts`, imported everywhere as `@pinnwand/contracts` (source-only, no build step; resolved via the package `exports` map + `moduleResolution: bundler`). `apps/mcp` is the Phase-1 connector-server scaffold. The feature-slice layer boundaries below are unchanged; they now apply within `apps/web/src/`. The `api/` layer imports `Database` from `@pinnwand/contracts` instead of a local `shared/types/database.ts`.

## Dependency direction

```
src/app/  →  src/features/<x>/  →  src/shared/
                  │
                  ├── components/  →  hooks/  →  api/  →  shared/lib/supabase.ts
                  │
                  └── index.ts (public)
```

- Features never import each other's internal files. If feature A needs something from feature B, B must export it from its `index.ts` (or it belongs in `shared/`).
- `app/` calls features through their public `index.ts` — never deep-imports a hook or component.

## When two features need the same thing

If you find yourself reimplementing the same picker, drawer, or hook in a second feature, **stop**. Move the shared piece to `src/shared/` (component) or extract to a small library (hook), and import from there in both features. Two divergent copies of the same UI is a bug.
