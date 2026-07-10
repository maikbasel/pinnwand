# PROJECT CONTEXT & CORE DIRECTIVES

## Project Overview
Pinnwand — shared Kanban task boards in a mobile-first PWA. Create a board (Pinnwand), share it with a join code, and track Aufgaben across four fixed columns (Offen, Zu Erledigen, In Bearbeitung, Erledigt) with priorities and multiple assignees (Verantwortliche), synced in real time.

**Technology Stack**: React 19 + TypeScript + Vite + Tailwind CSS 4 (frontend) · shadcn/ui (Base UI) primitives · TanStack Query + TanStack Router · dnd-kit · zod · self-hosted Supabase (Postgres + Auth + Realtime) · Vitest + Playwright · Ultracite (Biome preset)
**Architecture**: SPA with vertical feature slices over a self-hosted Supabase backend; all business logic lives in hooks + SQL (RLS + Postgres functions), no bespoke backend service
**Deployment**: Coolify — static frontend (Caddy) + self-hosted Supabase from `docker-compose.coolify.yml`; migrations apply via a one-shot `migrate` init container (`supabase db push --include-all`). Full guide in `docs/deployment.md`

> Scaffolded from the Mahlzeit template: same stack, same feature-slice architecture, same rules. Some `.claude/rules/*.md` still carry Mahlzeit domain examples (meals/households/dishes). The principles transfer directly, so read them as conventions and swap the nouns for boards/tasks.

## SYSTEM-LEVEL OPERATING PRINCIPLES

### Core Implementation Philosophy
- DIRECT IMPLEMENTATION ONLY: Generate complete, working code — every feature ships end-to-end: SQL migration → generated types → `api/` repository → hook → component → loading/error/empty states → optimistic update → tests.
- NO PARTIAL IMPLEMENTATIONS: No mocks, stubs, TODOs, FIXMEs, or placeholder copy in main. Exploratory code lives on a throwaway branch and is deleted, not merged "behind a flag".
- SOLUTION-FIRST THINKING: Think at the system level (RLS boundary → data layer → hook → UI → realtime), then linearize into a concrete change.
- TOKEN OPTIMIZATION: Focus tokens on the solution. Surgical changes only — every changed line traces to the request; don't refactor adjacent code.

### Multi-Dimensional Analysis Framework
When encountering complex requirements:
1. **Observer 1 — Feasibility & path**: Which feature slice owns this? What migration / RPC / hook / component does it touch?
2. **Observer 2 — Edge cases & security**: RLS denial, offline writes, conflicts, empty states, long titles, double-submits, stale clients. Does a policy or `zod` boundary change?
3. **Observer 3 — Performance & UX**: Optimistic update path, realtime invalidation, fractional-index reorder, mobile scroll-snap. Latency must feel instant.
4. **Observer 4 — Integration & dependencies**: Layer boundaries (`components → hooks → api → shared/lib/supabase`), generated artifacts (`database.ts`, `routeTree.gen.ts`), the offline persist allowlist.
5. **Synthesis**: Merge into one surgical change that keeps RLS, feature-slice boundaries, and offline-first invariants intact.

## ANTI-PATTERN ELIMINATION

### Prohibited Implementation Patterns
- "In a full implementation..." or "This is a simplified version..."
- "You would need to..." or "Consider adding..."
- Mock functions, placeholder copy, lorem ipsum, "Coming soon" pages
- Happy-path-only code (missing error / loading / empty / offline states)
- Silent failures: swallowed exceptions, empty `catch {}`, un-awaited promises, `.catch(() => {})`
- `console.log` / `debugger` in production code
- Manual merge of `postgres_changes` payloads into the TanStack Query cache — invalidate and refetch instead
- `any`, `as unknown as X`, hand-editing generated files, magic strings/numbers without names

### Prohibited Communication Patterns
- Social validation: "You're absolutely right!", "Great question!", "Certainly!"
- Hedging language: "might", "could potentially", "perhaps"
- Restating the requirement before answering
- Excessive explanation of obvious concepts
- Multiple implementation options without a clear recommendation

### Null Space Pattern Exclusion
Eliminate patterns that consume tokens without advancing implementation:
- Restating requirements already provided
- Generic programming advice not specific to Pinnwand
- Historical context unless directly relevant to the change
- Options without a recommendation

## DYNAMIC MODE ADAPTATION

### Context-Driven Behavior Switching

**EXPLORATION MODE** (Triggered by undefined requirements)
- Multi-observer analysis of the problem space
- Read the actual RPCs in `supabase/migrations/` rather than trusting summaries
- Document the architecture decision and its RLS/offline implications
- Risk assessment for the two-user realtime surface

**IMPLEMENTATION MODE** (Triggered by clear specifications)
- Direct code generation across the full slice
- Optimistic updates + rollback on every mutation
- Loading / error / empty / offline states designed in, not deferred
- Realtime verified across two browser tabs before "done"

**DEBUGGING MODE** (Triggered by error states)
- Isolate the failing layer (component / hook / api / SQL policy)
- Root cause with evidence (RLS denial vs. offline pause vs. conflict)
- Verify the fix by impersonation (sign in as A, attempt B's data → empty)

**OPTIMIZATION MODE** (Triggered by performance requirements)
- Identify the bottleneck (query fan-out, reorder writes, realtime churn)
- Keep drag-to-move instant; measure perceived latency
- Respect the offline persist allowlist — never over-persist

## PROJECT-SPECIFIC GUIDELINES

### Essential Commands

#### Development
```bash
pnpm install                      # Install deps (Node 22, pnpm 10.18)
pnpm dev:up                       # Boot local backend (docker-compose.yml: db, migrate, kong, auth, rest, realtime, studio, mailpit) + seed demo users
pnpm dev                          # Vite dev server on :5173 (run alongside dev:up; regenerates routeTree.gen.ts)
pnpm seed:dev                     # (Re)seed demo users + shared board (idempotent; dev:up already runs it)
pnpm dev:down                     # Stop the stack (keeps db volume); pnpm dev:reset wipes it
pnpm dev:logs                     # Tail compose logs; pnpm dev:psql opens a psql shell into the db
pnpm build                        # tsc -b && vite build
pnpm preview                      # Preview the PWA build
```

First run: `pnpm install`, then `pnpm dev:up`, then `pnpm dev`. The default `.env` already carries the public demo anon key + kong URL. Sign in by typing a seeded address (`alice@dev.local` owner, `bob@dev.local` member on "Team-Board"; `charlie@dev.local` owns "Charlies Board") on `/sign-in` and reading the magic link / OTP from Mailpit (`http://localhost:8025`) — no passwords, signup is disabled.

#### Database
```bash
pnpm db:migration:new <name>      # New migration under supabase/migrations/
pnpm db:push                      # Apply pending migrations to the running dev db (same command the migrate init container runs)
pnpm db:reset                     # Drop + re-apply every migration against the running dev db (authoritative order check)
pnpm db:types                     # Regenerate packages/contracts/src/database.ts from the dev db (never hand-edit)
```
Local backend is **docker-compose**, never the Supabase CLI's `supabase start`. The one-shot `migrate` init container applies `supabase/migrations/` (`supabase db push --include-all`); every service depends on it.

#### Testing
```bash
pnpm check                        # Ultracite/Biome lint check
pnpm fix                          # Ultracite/Biome auto-fix (also runs automatically after edits via PostToolUse hook)
pnpm test                         # Vitest unit tests
pnpm e2e                          # Playwright e2e against a sealed Dockerized stack (docker-compose.e2e.yml, own `pinnwand-e2e` project)
```

#### Deployment
Coolify builds and serves the static frontend (Caddy) and runs self-hosted Supabase from `docker-compose.coolify.yml`. Migrations apply via the one-shot `migrate` init container (`supabase db push --include-all`). See `docs/deployment.md`.

### File Structure & Boundaries

pnpm-workspace + Turborepo monorepo. The web app lives in `apps/web`; the shared contract surface (generated DB types + fixed column/priority constants) lives in `packages/contracts` and is imported as `@pinnwand/contracts`. `apps/mcp` is a Phase-1 scaffold. `supabase/` and `docker/` stay at the repo root, shared by both apps.

```
apps/web/                ← the Vite PWA (was the repo root)
├── src/
│   ├── app/             ← Router + entry shell. Zero business logic.
│   │   ├── routes/      ← File-based TanStack routes (routeTree.gen.ts is generated)
│   │   ├── env.ts       ← zod-parsed import.meta.env
│   │   ├── index.css    ← Tailwind + theme tokens (Modern Minimal)
│   │   └── main.tsx     ← Providers + router bootstrap
│   ├── features/<name>/ ← Vertical slice (auth, boards, members, tasks, appearance, navigation, profile)
│   │   ├── components/  ← React UI, no Supabase imports
│   │   ├── hooks/       ← TanStack Query hooks that orchestrate use cases
│   │   ├── api/         ← Supabase calls, no React imports
│   │   └── index.ts     ← Public API of the feature
│   └── shared/
│       ├── lib/supabase.ts ← The ONLY file that calls createClient
│       ├── lib/query-client.ts
│       ├── lib/utils.ts ← cn()
│       └── components/ui/ ← shadcn primitives
apps/mcp/                ← Phase-1 MCP connector server (scaffold only)
packages/contracts/src/  ← @pinnwand/contracts, shared by both apps
├── database.ts          ← Generated by `pnpm db:types`. Never edit by hand.
├── columns.ts           ← Fixed TASK_COLUMNS / TASK_PRIORITIES + derived types
└── index.ts             ← Public surface (re-exports database + columns)
supabase/migrations/     ← Append-only SQL migrations, timestamp-prefixed by the CLI (RLS enabled in same migration as table)
```

**SAFE TO MODIFY**:
- `apps/web/src/features/`, `apps/web/src/shared/`, `apps/web/src/app/`, `packages/contracts/src/` (except the generated `database.ts`)
- `supabase/migrations/` (append-only; never edit an applied migration)
- `apps/web/public/`, `.claude/rules/`, `CLAUDE.md`

**NEVER MODIFY** (generated / managed):
- `packages/contracts/src/database.ts` — generated by `supabase gen types`
- `apps/web/src/app/routeTree.gen.ts` — generated by @tanstack/router-plugin
- `biome.jsonc` — Ultracite preset; don't add custom rules without confirming the preset doesn't already cover them
- `.env` — reference only; never commit
- `dist/`, `node_modules/`

### Code Style & Architecture Standards

**Naming Conventions**:
- Variables / functions: camelCase (functions use descriptive verbs)
- Components / types: PascalCase
- Constants: SCREAMING_SNAKE_CASE (extract magic strings/numbers)
- Files: components `PascalCase.tsx`; hooks `use<Feature>.ts`; api/lib camelCase; database columns `snake_case`

**Architecture Patterns**:
- **Vertical feature slices** with strict layer boundaries — `components/` → `hooks/` → `api/` → `shared/lib/supabase.ts`. Layers may only import downward:
  - `components/` may import `hooks/`, `types.ts`, other components, `shared/` — never `api/` or `@supabase/*` directly
  - `hooks/` may import `api/`, `types.ts`, `@tanstack/react-query`, `shared/` — never React DOM components
  - `api/` may import `shared/lib/supabase.ts`, `types.ts`, `database.ts`, `zod` — never React/hooks/components
- Features never deep-import each other's internals — cross-feature needs go through `index.ts` or move to `shared/`.
- **State management**: TanStack Query is the cache and the realtime sync boundary; realtime invalidates queries (never manual cache merge). Offline-first: Query cache + paused task mutations persist to IndexedDB.
- **Error handling**: every failure mode (offline, RLS denial, conflict) has a user-visible outcome — retry, fallback, or clear message. Optimistic update + rollback on error.

**Framework-Specific Guidelines**:
- Strict TypeScript: no `any`, no `as unknown as X`. `verbatimModuleSyntax` + `exactOptionalPropertyTypes` on → use `import type`.
- shadcn/ui primitives added via `pnpm dlx shadcn@latest add <name>`; theme "Modern Minimal" tokens in `apps/web/src/app/index.css` (`:root` / `.dark`), font Inter.
- Mobile-first: on phones the four columns scroll horizontally with scroll-snap, a card opens a `vaul` sheet; desktop shows columns side by side.
- Detailed conventions live in `.claude/rules/` (see Custom Project Instructions).

## TOOL CALL OPTIMIZATION

### Batching Strategy
Group operations by:
- **Dependency Chains**: migration → `pnpm db:reset` → `pnpm db:types` → api → hook → component, in order
- **Resource Types**: batch file reads, batch edits within a slice
- **Execution Contexts**: keep frontend and Supabase/SQL changes coherent per PR
- **Output Relationships**: combine edits that must land together (e.g. new column + generated types + api parse)

### Parallel Execution Identification
Execute simultaneously when operations have no shared dependencies — e.g. reading several unrelated feature files, or independent lint/type/test reads. Never parallelize a migration and the type regeneration that depends on it.

## QUALITY ASSURANCE METRICS

### Success Indicators
- ✅ Complete running code on first attempt, full slice (migration → types → api → hook → component → states → tests)
- ✅ Zero placeholder implementations
- ✅ RLS verified by impersonation; realtime verified across two tabs
- ✅ Optimistic updates that feel instant, with rollback on error
- ✅ Loading / error / empty / offline states present
- ✅ `zod` validation at every API boundary; strict TypeScript clean

### Failure Recognition
- ❌ Deferred implementations, TODOs, or "behind a flag for now"
- ❌ Social validation / hedging patterns
- ❌ Manual `postgres_changes` cache merges
- ❌ `any` / `as unknown as X` / hand-edited generated files
- ❌ Migration without RLS + policies in the same file

## METACOGNITIVE PROCESSING

### Self-Optimization Loop
1. **Pattern Recognition**: Notice when a picker/drawer/hook is being reimplemented in a second feature.
2. **Decoherence Detection**: Catch drift from layer boundaries or the offline allowlist early.
3. **Compression Strategy**: Prefer the smallest change that ships the slice done.
4. **Pattern Extraction**: Promote a pattern to a rule only after it's used in ≥2 features; move shared UI to `shared/`.
5. **Continuous Improvement**: Keep `CLAUDE.md` and `.claude/rules/*` in sync with what ships.

### Context Awareness Maintenance
- Track prior decisions within a session and build on them.
- Reference existing feature slices for consistency rather than inventing new structure.
- Read the actual RPCs / migrations for truth; don't trust prose summaries (including this file) when the schema is authoritative.

## TESTING & VALIDATION PROTOCOLS

### Automated Testing Requirements
- Vitest unit tests for hooks and business logic.
- Playwright e2e for critical journeys (create board, join by code, move task) against the sealed Dockerized stack (`docker-compose.e2e.yml`).
- RLS checks encoded as tests: sign in as A, attempt B's data → empty. Not a manual checklist.
- Realtime verified across two browser tabs before a feature is "done" — realtime IS the feature.

### Manual Validation Checklist
- Code compiles / lints clean (`pnpm check`, strict `tsc`).
- Empty states, long task titles, empty columns, network failures, slow networks, double-submits, re-opened dialogs, stale clients all work.
- Error messages are user-facing and actionable.
- Migration runs cleanly from an empty DB (`pnpm db:reset`), not just from current state.
- Security addressed: RLS on every table, anon key only, `zod` at boundaries.

## DEPLOYMENT & MAINTENANCE

### Pre-Deployment Verification
- All tests passing (`pnpm test`, `pnpm e2e`).
- `pnpm db:reset` re-applies every migration in order; `pnpm db:types` regenerated.
- RLS verified by impersonation; secrets confirmed absent from the client bundle.
- `CLAUDE.md` / rules still accurately describe the stack and structure.

### Post-Deployment Monitoring
- Watch realtime and auth (magic link / OTP) paths — the two-user surface.
- Confirm migrations applied via the `migrate` init container.
- Collect user feedback on the board surface (offline resume, drag latency).

## CUSTOM PROJECT INSTRUCTIONS

### Domain model
- **board** (Pinnwand): `id, name, join_code (unique), created_by, created_at`. Created via the `create_board` RPC, which also mints the owner membership and join code.
- **board_members**: `(board_id, user_id) PK, role (owner|member)`. The sharing and RLS boundary.
- **task** (Aufgabe): `id, board_id, column, title, description, priority, due_date (nullable), position, created_by, created_at, updated_at`.
  - `column` enum (fixed): `offen | zu_erledigen | in_bearbeitung | erledigt`, shown as **Offen / Zu Erledigen / In Bearbeitung / Erledigt** (`packages/contracts/src/columns.ts`, imported as `@pinnwand/contracts`).
  - `priority` enum: `niedrig | mittel | hoch`.
  - `position`: fractional index for drag-reorder within a column (write the midpoint between neighbours).
- **task_assignees**: `(task_id, user_id) PK`. Many-to-many **Verantwortliche**, assigned from board members.

### Key invariants
- **RLS is on every table.** Sharing goes through `board_members`; membership checks use the SECURITY DEFINER helpers `is_board_member` / `is_board_owner` to avoid policy recursion. Never expose other users' boards or tasks.
- **The service role key never reaches the client.** Only the anon key (`VITE_SUPABASE_ANON_KEY`).
- **Joining is by share code** through the `join_board_by_code` RPC. The client never inserts into `board_members` directly. Owners rotate the code (`regenerate_join_code`) and rename/delete the board (owner-only).
- **Optimistic updates on every mutation.** Drag-to-move must feel instant.
- **Offline-first for the board surface.** Reads hydrate from IndexedDB on cold offline launch; task writes pause offline and resume on reconnect. The allowlist in `query-client.ts` persists only board/task/member/profile reads and `tasks` mutations — never the auth session or join/sharing calls. Register a feature's resumable mutation defaults in `main.tsx` before the persister resumes.
- **Realtime invalidates queries.** Never manually merge `postgres_changes` payloads into the cache.
- **UI never imports `api/` directly.** Always go through a hook.
- **The four columns are fixed.** No column CRUD; they are a Postgres enum plus `TASK_COLUMNS`.
- **Sign-in is passwordless** (magic link + 6-digit OTP fallback). **Self-serve signup is disabled** (`enable_signup = false`; `GOTRUE_DISABLE_SIGNUP=true` in prod). An operator adds users via Studio / admin API. Identity source of truth is `public.profiles`, seeded by an `on_auth_user_created` trigger.
- **A task belongs to exactly one board and one column**; assignees must be members of that board. Deleting a board cascades its tasks and assignees.
- **Surgical changes.** Every changed line traces to the request. Don't refactor adjacent code; match existing style. Notice unrelated dead code, mention it, leave it.

### Rules (`.claude/rules/`)
Files without `paths:` frontmatter load every session (safety-critical); path-scoped files load when Claude reads matching files.

**Always loaded**:
- `production-grade.md`: no half-baked code, no swallowed errors
- `security.md`: RLS, anon-key only, input validation
- `migrations.md`: append-only, RLS-first
- `architecture.md`: feature slice layer boundaries
- `documentation.md`: keep CLAUDE.md and rules in sync

**Path-scoped**: `modern-ts.md`, `tanstack-query.md`, `supabase.md`, `pwa.md`, `pwa-design.md`, `dnd-kit.md`, `frontend/react.md`, `frontend/mobile-first.md`, `frontend/components.md`, `testing.md`, `playwright.md`.

---

**ACTIVATION PROTOCOL**: This configuration is now active. All subsequent interactions should demonstrate adherence to these principles through direct implementation, optimized token usage, and systematic solution delivery. The jargon and precise wording are intentional to form longer implicit thought chains and enable sophisticated reasoning patterns.
