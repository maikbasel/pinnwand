import { randomUUID } from "node:crypto";
import postgres from "postgres";

// Direct DB access for the integration test's fixtures only. Users are seeded
// by inserting into auth.users (the `on_auth_user_created` trigger fills in
// public.profiles) instead of standing up GoTrue — RLS only cares that
// auth.uid() resolves to a real auth.users row, and the test mints the
// matching user JWT itself. The mcp runtime never imports this.

let pool: ReturnType<typeof postgres> | undefined;

function getPool(): ReturnType<typeof postgres> {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set — is the integration globalSetup wired up?"
      );
    }
    pool = postgres(url, { max: 2, onnotice: () => undefined });
  }
  return pool;
}

/** Insert a synthetic auth.users row and return its id. */
export async function createAuthUser(email: string): Promise<string> {
  const sql = getPool();
  const id = randomUUID();
  await sql /* sql */`
    insert into auth.users (
      id, instance_id, aud, role, email,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      ${id},
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      ${email},
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
  `;
  return id;
}

export async function teardownPool(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = undefined;
  }
}
