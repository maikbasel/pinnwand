# Database Migrations

Safety-critical — loaded every session. Migrations are the one thing in this app where a mistake is hard to roll back.

## Append-only

- **Never edit a migration file once it has been applied to any environment.** Add a new migration that fixes the prior one.
- **Never delete a migration file.** Even if it was reverted, keep the file and add a new migration that does the revert in SQL.
- File naming follows the Supabase CLI convention: `pnpm db:migration:new <name>` (`supabase migration new`) — let the CLI assign the timestamp prefix. The prefix format is not configurable; don't hand-rename to a custom scheme.

## RLS-first

- Every `CREATE TABLE` migration must, in the same file:
  1. Create the table.
  2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
  3. Create the policies that gate `SELECT`, `INSERT`, `UPDATE`, `DELETE` for that table.
- A migration that creates a table without RLS + policies is incomplete. Do not split this across files.
- Every policy uses `auth.uid()` — directly or via a `board_members` join / the `is_board_member` helper — to scope access.

## Apply order

- Migrations apply in filename (timestamp) sort order. `pnpm db:reset` re-applies every migration from an empty DB in order — the authoritative check that the sequence is self-consistent.
- Because timestamps are assigned at creation, parallel branches can merge out of order (a later-merged branch stamped earlier than one already applied). Append-only + forward-only is what keeps this safe: each migration is self-contained and never assumes a later-stamped sibling is absent. Never renumber or rename a file to "fix" ordering — that is editing an applied migration.

## Schema discipline

- Database columns are `snake_case` (Supabase convention). The generated `database.ts` then maps to TypeScript.
- Foreign keys are explicit and named (`fk_<from>_<to>`).
- Adding a NOT NULL column to an existing table: add as nullable → backfill in a follow-up migration → add the NOT NULL constraint in a third migration. Never collapse the three.
- Prefer `timestamptz` over `timestamp` for any time column.

## Realtime publication

- **A table the client subscribes to via realtime must be added to the `supabase_realtime` publication in a migration** — `alter publication supabase_realtime add table public.<table>;`. Creating the table does not publish it; without this, `postgres_changes` never fire and the subscription is silently dead (this is how tasks realtime shipped broken — `20260709184244_enable_tasks_realtime.sql` is the fix).
- **If any subscription filters on a non-primary-key column** (e.g. `board_id=eq.<id>`), set `alter table public.<table> replica identity full;`. Under the default (primary-key) replica identity a DELETE's WAL old row carries only the PK, so the filter cannot match and delete events are dropped. A subscription with no filter needs no change.
- Both are plain DDL, so they follow the same append-only + RLS-first rules as any migration. Verify by the two-tab realtime check (`testing.md`), not by assuming publication membership.

## Verification before merging a migration

- [ ] Apply locally via `pnpm db:reset` against a fresh dev DB (re-runs every migration in order).
- [ ] Regenerate `src/shared/types/database.ts` via `pnpm db:types`.
- [ ] Sign in as user A, attempt to read user B's data through the new table — confirm RLS denies it.
- [ ] Migration runs cleanly from an empty DB (every prior migration + this one) — not just from current state.
