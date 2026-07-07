import { randomUUID } from "node:crypto";
import postgres, { type TransactionSql } from "postgres";

// The callback passed to `withRls` / `asService` receives a transaction
// handle. Aliased here so tests can type their callback parameter without
// reaching into postgres.js's namespace.
export type TxSql = TransactionSql<Record<string, never>>;

const POSTGRES_AUTHENTICATED_ROLE = "authenticated";

let pool: ReturnType<typeof postgres> | undefined;

function getPool(): ReturnType<typeof postgres> {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set; is the testcontainers globalSetup wired up?"
      );
    }
    pool = postgres(url, { max: 4, onnotice: () => undefined });
  }
  return pool;
}

/**
 * Insert a synthetic auth.users row and return its id. Tests use this in
 * place of going through GoTrue; RLS only cares that `auth.uid()` resolves
 * to a uuid and our public.* tables' `references auth.users(id)` foreign
 * keys resolve to a real row.
 *
 * The column list intentionally sticks to what's present in the
 * `supabase/postgres` image's baked-in auth schema (i.e. without GoTrue's
 * own newer migrations applied); only `id` is NOT NULL. Email + role
 * are filled in so any human-debugging session shows useful values.
 */
export async function createAuthUser(email?: string): Promise<string> {
  const sql = getPool();
  const id = randomUUID();
  const safeEmail = email ?? `${id}@test.local`;
  await sql /* sql */`
    insert into auth.users (
      id, instance_id, aud, role, email,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      ${id},
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      ${safeEmail},
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
  `;
  return id;
}

/**
 * Run `fn` inside a transaction where the session is impersonating `userId`
 * via the `authenticated` role and `request.jwt.claim.sub`. This is the
 * pattern Supabase itself documents for testing RLS. See
 * https://supabase.com/docs/guides/database/postgres/row-level-security.
 *
 * Each test creates its own fresh users via `createAuthUser()`, so commits
 * from one test don't bleed into another's assertions (no shared rows).
 * The transaction commits at the end of the callback so seed writes within
 * the block are visible to subsequent queries in other blocks of the same
 * test.
 */
export async function withRls<T>(
  userId: string,
  fn: (sql: TxSql) => Promise<T>
): Promise<T> {
  const sql = getPool();
  // postgres.js types `begin`'s return as `UnwrapPromiseArray<T>` which TS
  // can't reconcile with our generic `T`, so capture into a closure variable
  // and return that explicitly.
  let captured: T;
  await sql.begin(async (tx) => {
    // `set local role` doesn't accept bind parameters (Postgres parses the
    // name syntactically), so it stays unsafe with a hard-coded constant.
    // The JWT sub goes through set_config() so the user id flows as a bound
    // parameter, so no string-interpolation pattern to copy-paste elsewhere.
    await tx.unsafe(`set local role ${POSTGRES_AUTHENTICATED_ROLE}`);
    await tx /* sql */`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    captured = await fn(tx);
  });
  // biome-ignore lint/style/noNonNullAssertion: assigned inside the begin callback before it resolves
  return captured!;
}

/**
 * Run `fn` as the `service_role` (bypasses RLS) for test seeding when the
 * test isn't asserting on RLS itself, e.g. creating two boards a subsequent
 * RLS assertion compares against. Commits at the end of the callback.
 */
export async function asService<T>(fn: (sql: TxSql) => Promise<T>): Promise<T> {
  const sql = getPool();
  let captured: T;
  await sql.begin(async (tx) => {
    await tx.unsafe("set local role service_role");
    captured = await fn(tx);
  });
  // biome-ignore lint/style/noNonNullAssertion: assigned inside the begin callback before it resolves
  return captured!;
}

export async function teardownPool(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = undefined;
  }
}
