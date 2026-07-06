# Pinnwand — Design

**Date:** 2026-07-06
**Status:** Approved (skeleton scaffolded)

## Summary

Pinnwand is a shared Kanban task-board app: a mobile-first PWA built on the Mahlzeit stack. Users create boards (Pinnwände), share them with other users via a join code, and manage tasks (Aufgaben) across four fixed columns. Tasks carry a title, description, priority, optional due date, and one or more assignees (Verantwortliche). Boards and tasks sync in real time; membership is the security boundary (RLS).

## Stack

Identical to Mahlzeit: React 19 + TypeScript + Vite + Tailwind 4, shadcn/ui (Base UI), TanStack Query + Router, dnd-kit, Supabase (Postgres + Auth + Realtime), zod, Vitest, Ultracite/Biome, vite-plugin-pwa. Theme: "Modern Minimal" from tweakcn (Inter, blue primary). Local dev uses the Supabase CLI (`supabase start`) rather than Mahlzeit's custom docker-compose.

## Sharing model (households → boards)

Mahlzeit's sharing unit is the household; Pinnwand's is the **board**. Same membership-by-RLS pattern, one row per member:

- `board` (Pinnwand): `id, name, join_code (unique), created_by, created_at`
- `board_members`: `(board_id, user_id) PK, role (owner|member), created_at`
- A user creates any number of boards and sees a **list** of every board they own or belong to, then opens one (vs. Mahlzeit's single-active-household switch).
- Sharing is by **join code** (short, typable), not a tokenised link. Minted with the board; a signed-in user joins by typing it. Owners can rotate it.

RPCs (SECURITY DEFINER): `create_board(name)`, `join_board_by_code(code)`, `regenerate_join_code(board_id)`. Membership helpers `is_board_member` / `is_board_owner` break policy recursion.

## Domain

- `task` (Aufgabe): `id, board_id, column, title, description, priority, due_date (nullable), position, created_by, created_at, updated_at`
- `column` enum (fixed): `offen | zu_erledigen | in_bearbeitung | erledigt` → **Offen / Zu Erledigen / In Bearbeitung / Erledigt**
- `priority` enum: `niedrig | mittel | hoch`
- `task_assignees`: `(task_id, user_id) PK` — many-to-many Verantwortliche, from board members
- `position`: fractional index for drag-reorder within a column

## Interaction

- Drag cards between columns (changes `column`) and reorder within (changes `position`), optimistic, with Realtime invalidation (never manual cache merge).
- Mobile-first: four columns scroll horizontally with scroll-snap on phones; side-by-side on desktop. Task detail in a `vaul` sheet on mobile, dialog on desktop.

## Auth

Passwordless — magic link + 6-digit OTP fallback. **Self-serve signup disabled**; operators add users via Supabase Studio / admin API. Identity source of truth is `public.profiles`, seeded by an `on_auth_user_created` trigger.

## Feature slices

`auth`, `boards`, `members`, `tasks`, `appearance`, `navigation`, `profile` — each a vertical slice (`components/`, `hooks/`, `api/`, `index.ts`). Layer boundaries per `.claude/rules/architecture.md`.

## Out of scope (v1)

Notifications, offline durable mutations, Bring!-style exports, passkeys, comments/attachments, custom columns, labels, sub-tasks. These can be layered in later as Mahlzeit did.

## Skeleton delivered

Project scaffold, all config (Vite/TS/Tailwind/Biome/PWA/components.json), theme in `index.css`, feature-slice folders with stub `index.ts`, Supabase client + `config.toml`, the initial migration (`20260706120000_init.sql`: enums, tables, RLS, RPCs, triggers), and a booting app shell (boards list placeholder + a board view rendering the four columns). Feature behaviour is the next milestone (implementation plan).
