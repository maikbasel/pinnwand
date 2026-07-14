<h1 align="center">
  <img src="apps/web/public/favicon.svg" alt="" width="56" height="56" valign="middle" />
  &nbsp;Pinnwand
</h1>

<p align="center">
  Shared Kanban task boards in a mobile-first PWA. Create a board, share it with
  a join code, and track tasks across four fixed columns with priorities and
  multiple assignees, synced in real time.
</p>

<p align="center">
  <a href="https://github.com/maikbasel/pinnwand/actions/workflows/ci.yml"><img src="https://github.com/maikbasel/pinnwand/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/maikbasel/pinnwand/actions/workflows/e2e.yml"><img src="https://github.com/maikbasel/pinnwand/actions/workflows/e2e.yml/badge.svg" alt="E2E" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" />
  <img src="https://img.shields.io/badge/Supabase-self--hosted-3ecf8e?logo=supabase&logoColor=white" alt="Supabase" />
  <img src="https://img.shields.io/badge/PWA-offline--first-5a0fc8?logo=pwa&logoColor=white" alt="PWA" />
  <img src="https://img.shields.io/badge/license-UNLICENSED-lightgrey" alt="License" />
</p>

## Features

- **Boards** you create and share with a short, typable join code.
- **Fixed columns:** Open, To Do, In Progress, Done.
- **Tasks** with title, description, priority (Low / Medium / High), due date,
  and one or more assignees.
- **Drag and drop** between columns and reordering within a column, applied
  optimistically and synced across members in real time.
- **Passwordless sign-in** by magic link or 6-digit OTP. Self-serve signup is
  disabled; an operator provisions users.
- **Installable PWA** that works offline: boards render from cache on a cold
  offline launch, and task edits queue and replay on reconnect.

## Tech stack

| Area        | Choice                                                         |
|-------------|----------------------------------------------------------------|
| Frontend    | React 19, TypeScript, Vite, Tailwind CSS 4                     |
| UI          | shadcn/ui (Base UI), theme [Modern Minimal](https://tweakcn.com/editor/theme?theme=modern-minimal) |
| Data / state| TanStack Query, TanStack Router (file-based)                    |
| Drag & drop | dnd-kit                                                        |
| Offline     | `react-query-persist-client` over an `idb-keyval` persister    |
| Backend     | Self-hosted Supabase (Postgres, Auth, Realtime)                |
| Tooling     | Ultracite (Biome) for lint/format, Vitest, Playwright          |
| Deployment  | Coolify (static frontend + self-hosted Supabase)               |

## Prerequisites

- Node 22 and pnpm 10.18 (`corepack enable` activates the pinned pnpm)
- Docker with Compose v2

The local backend runs as a self-hosted Supabase stack in `docker-compose.yml`,
the same stack that deploys to production. There is no dependency on the
Supabase CLI's `supabase start`.

## Quick start

```bash
corepack enable
pnpm install
pnpm dev:up     # Boot the backend (Postgres, kong, auth, rest, realtime, studio, mailpit) + seed demo data
pnpm dev        # Vite dev server
```

Open **http://localhost:5173**. The default `apps/web/.env` already points the
frontend at the local gateway with the public Supabase demo anon key, so there
is no manual configuration step (copy `apps/web/.env.example` if it is missing).

Stop the backend with `pnpm dev:down` (keeps the database volume) or
`pnpm dev:reset` (wipes it).

### Local services

| URL                      | Service                          |
|--------------------------|----------------------------------|
| http://localhost:5173    | The app (Vite)                   |
| http://localhost:8000    | Supabase API gateway (kong)      |
| http://localhost:8001    | Supabase Studio                  |
| http://localhost:8025    | Mailpit (captures outgoing mail) |

### Signing in

`pnpm dev:up` seeds three demo users:

| Email               | Role   | Board          |
|---------------------|--------|----------------|
| `alice@dev.local`   | owner  | Team-Board     |
| `bob@dev.local`     | member | Team-Board     |
| `charlie@dev.local` | owner  | Charlies Board |

Sign in by entering one of these addresses, then read the magic link or 6-digit
OTP from **Mailpit** (http://localhost:8025). There are no passwords. To add a
real user, create it in Studio (Authentication → Users) and set its display name
on the `public.profiles` row; signup is disabled by design.

## Project structure

```
src/
├── app/                 Router, entry shell, theme, env parsing. No business logic.
│   └── routes/          File-based TanStack routes (routeTree.gen.ts is generated)
├── features/<name>/     Vertical slices: components → hooks → api, with a public index.ts
└── shared/              Cross-feature primitives (ui/, lib/, generated database types)
supabase/migrations/     Append-only SQL migrations (RLS enabled with each table)
docker/                  Dockerfiles, kong + Postgres init config, Caddyfile
e2e/                     Playwright specs, page objects, and helpers
docs/                    Deployment guide and design specs
```

Layer boundaries and conventions live in [`.claude/rules/`](.claude/rules) and
[`CLAUDE.md`](CLAUDE.md).

## Scripts

```bash
# Develop
pnpm dev            # Vite dev server on :5173
pnpm dev:up         # Boot the backend stack + seed demo data
pnpm dev:down       # Stop the stack (keep the db volume)
pnpm dev:reset      # Stop the stack and wipe the db volume
pnpm dev:logs       # Tail backend logs
pnpm dev:psql       # Open a psql shell into the dev database
pnpm seed:dev       # Re-seed demo users and board (idempotent)

# Quality
pnpm check          # Lint (Ultracite / Biome)
pnpm fix            # Auto-fix lint and formatting
pnpm build          # Type-check and production build
pnpm test           # Vitest unit tests

# Database
pnpm db:migration:new <name>   # Create a migration under supabase/migrations/
pnpm db:push                   # Apply pending migrations to the dev database
pnpm db:reset                  # Drop and re-apply every migration
pnpm db:types                  # Regenerate src/shared/types/database.ts

# End-to-end
pnpm e2e            # Build and run the sealed Playwright stack (docker-compose.e2e.yml)
pnpm e2e:down       # Tear the e2e stack down
```

## Testing

- **Unit** tests run with Vitest, co-located with the code under test.
- **End-to-end** tests run with Playwright against a sealed Docker stack
  (`docker-compose.e2e.yml`) that is isolated from your dev stack. `pnpm e2e`
  builds the web image, applies migrations, and runs the specs across desktop
  and mobile browser projects. The development approach is outside-in: an
  acceptance test describes the behavior first and drives the implementation.

## Database and migrations

Schema changes are append-only SQL files under `supabase/migrations/`. Every
table enables row-level security in the same migration that creates it, and
access is scoped through `board_members`. A one-shot `migrate` init container
applies pending migrations (`supabase db push --include-all`) before any service
starts, both locally and in production, so the schema is never stale. After a
migration, regenerate the typed client with `pnpm db:types`.

## Deployment

Production runs on Coolify from `docker-compose.coolify.yml`: the static
frontend (served by Caddy) plus the self-hosted Supabase services, fronted by
Coolify's reverse proxy. Required secrets are gated with `${VAR:?}` so a missing
value fails the deploy before any container starts. A manual GitHub Actions
workflow (`.github/workflows/deploy-coolify.yml`) triggers a redeploy.

See [`docs/deployment.md`](docs/deployment.md) for secret generation, the full
environment variable list, domains, Studio access, and the first-deploy
checklist.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) for the architecture and invariants, and
[`.claude/rules/`](.claude/rules) for the detailed conventions (security,
migrations, TanStack Query, PWA, and more). Lint and formatting run
automatically; keep `pnpm check` green before opening a change.
