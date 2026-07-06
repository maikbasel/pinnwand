# Pinnwand

> Shared Kanban task boards, mobile-first PWA. Create a board, share it with a join code, drag Aufgaben across four columns — Offen, Zu Erledigen, In Bearbeitung, Erledigt — synced in real time.

Scaffolded from the [Mahlzeit](../mahlzeit) template: React 19 + Vite + Tailwind 4, shadcn/ui, TanStack Query/Router, dnd-kit, Supabase, PWA. Theme: [Modern Minimal](https://tweakcn.com/editor/theme?theme=modern-minimal) (tweakcn).

## Features (target)

- Boards (Pinnwände) you create and **share by join code**.
- Fixed columns: **Offen · Zu Erledigen · In Bearbeitung · Erledigt**.
- Tasks with Titel, Beschreibung, Priorität (Niedrig/Mittel/Hoch), Fälligkeitsdatum, and multiple **Verantwortliche**.
- Drag between columns and reorder within, optimistic + realtime.
- Passwordless sign-in (magic link + OTP). Self-serve signup disabled — operators add users in Supabase Studio.
- Installable PWA, mobile-first.

## Getting started

Requires Node 22, pnpm 10.18, Docker (for local Supabase).

```bash
pnpm install
cp .env.example .env        # then paste the anon key printed by db:start
pnpm db:start               # local Supabase via the CLI (prints API URL + anon key)
pnpm dev                    # Vite on :5173
```

| URL                       | What                          |
|---------------------------|-------------------------------|
| http://localhost:5173     | The app                       |
| http://127.0.0.1:54321    | Supabase API                  |
| http://127.0.0.1:54323    | Supabase Studio               |
| http://127.0.0.1:54324    | Inbucket (magic-link emails)  |

Add a user in Studio (Authentication → Users), then sign in with that email and read the magic link / OTP from Inbucket.

## Scripts

See `CLAUDE.md` for the full list. Common: `pnpm dev`, `pnpm build`, `pnpm check`, `pnpm fix`, `pnpm test`, `pnpm db:reset`, `pnpm db:types`.

## Status

Skeleton: stack, config, theme, feature-slice structure, and the initial schema (boards, members, tasks, assignees, RLS, RPCs) are in place. Feature slices (`auth`, `boards`, `members`, `tasks`) are stubbed — see `docs/superpowers/specs/` for the design and the implementation plan.
