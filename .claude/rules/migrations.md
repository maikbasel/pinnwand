# Database Migrations

Safety-critical — loaded every session. Migrations are the one thing in this app where a mistake is hard to roll back.

## Append-only

- **Never edit a migration file once it has been applied to any environment.** Add a new migration that fixes the prior one.
- **Never delete a migration file.** Even if it was reverted, keep the file and add a new migration that does the revert in SQL.
- File naming follows the Supabase CLI convention: `supabase migration new <name>` — let the CLI assign the timestamp.

## RLS-first

- Every `CREATE TABLE` migration must, in the same file:
  1. Create the table.
  2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`
  3. Create the policies that gate `SELECT`, `INSERT`, `UPDATE`, `DELETE` for that table.
- A migration that creates a table without RLS + policies is incomplete. Do not split this across files.
- Every policy uses `auth.uid()` — directly or via a `board_members` join / the `is_board_member` helper — to scope access.

## Apply order: `--include-all`

- The migrate init container (`docker/Dockerfile` `migrate` target) and `pnpm db:push` both run `supabase db push … --include-all`. **Keep the flag on both** — they are documented as the same command.
- Why: parallel PRs merge out of timestamp order against a single linear prod. A later-merged PR can carry migrations stamped *earlier* than one already deployed (e.g. a fix branch stamped `…175959` deploys first, then a feature branch stamped `…132251` merges after). Plain `db push` aborts on this with "Found local migration files to be inserted before the last migration on remote database," failing the deploy.
- `--include-all` applies every pending migration in version (timestamp) order regardless of where it sorts against the remote history table. This is safe **only because** migrations here are append-only and forward-only (see above): each is self-contained and never assumes a later-stamped sibling is absent.
- This does **not** relax append-only. Never renumber or rename a file to "fix" ordering — that is editing an applied migration. Let timestamps fall where the CLI puts them and let `--include-all` reconcile.

## Schema discipline

- Database columns are `snake_case` (Supabase convention). The generated `database.ts` then maps to TypeScript.
- Foreign keys are explicit and named (`fk_<from>_<to>`).
- Adding a NOT NULL column to an existing table: add as nullable → backfill in a follow-up migration → add the NOT NULL constraint in a third migration. Never collapse the three.
- Prefer `timestamptz` over `timestamp` for any time column.

## Verification before merging a migration

- [ ] Apply locally via `pnpm db:push` (`supabase db push --db-url $DATABASE_URL --include-all`) against a fresh dev DB.
- [ ] Regenerate `src/shared/types/database.ts` via `supabase gen types typescript`.
- [ ] Sign in as user A, attempt to read user B's data through the new table — confirm RLS denies it.
- [ ] Migration runs cleanly from an empty DB (every prior migration + this one) — not just from current state.
