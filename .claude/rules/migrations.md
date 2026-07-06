# Database Migrations

Safety-critical — loaded every session. Migrations are the one thing in this app where a mistake is hard to roll back.

## Append-only

- **Never edit a migration file once it has been applied to any environment.** Add a new migration that fixes the prior one.
- **Never delete a migration file.** Even if it was reverted, keep the file and add a new migration that does the revert in SQL.
- File naming uses **sequential, zero-padded counters** (no timestamps): `0001_init.sql`, `0002_<name>.sql`, … Run `pnpm db:migration:new <name>` (`scripts/new-migration.mjs`), which picks the next number. The Supabase CLI applies migrations in filename sort order and only needs a leading numeric version token, so the counter orders correctly.

## RLS-first

- Every `CREATE TABLE` migration must, in the same file:
  1. Create the table.
  2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
  3. Create the policies that gate `SELECT`, `INSERT`, `UPDATE`, `DELETE` for that table.
- A migration that creates a table without RLS + policies is incomplete. Do not split this across files.
- Every policy uses `auth.uid()` — directly or via a `board_members` join / the `is_board_member` helper — to scope access.

## Apply order & sequential numbering

- Migrations apply in filename sort order. Sequential counters (`0001_`, `0002_`, …) make that order explicit and readable, at the cost of **collision risk**: two branches both claiming `0002_` must be reconciled at merge — renumber the *unapplied* one to the next free counter before it lands anywhere. Renumbering a file that has never been applied is fine; renumbering an already-applied migration is the one thing you must never do (that is editing history).
- Locally, `pnpm db:reset` re-applies every migration from an empty DB in order — the authoritative check that the sequence is self-consistent.
- Append-only still holds: each migration is self-contained and forward-only, never assuming a later-numbered sibling is absent.

## Schema discipline

- Database columns are `snake_case` (Supabase convention). The generated `database.ts` then maps to TypeScript.
- Foreign keys are explicit and named (`fk_<from>_<to>`).
- Adding a NOT NULL column to an existing table: add as nullable → backfill in a follow-up migration → add the NOT NULL constraint in a third migration. Never collapse the three.
- Prefer `timestamptz` over `timestamp` for any time column.

## Verification before merging a migration

- [ ] Apply locally via `pnpm db:reset` against a fresh dev DB (re-runs every migration in order).
- [ ] Regenerate `src/shared/types/database.ts` via `pnpm db:types`.
- [ ] Sign in as user A, attempt to read user B's data through the new table — confirm RLS denies it.
- [ ] Migration runs cleanly from an empty DB (every prior migration + this one) — not just from current state.
