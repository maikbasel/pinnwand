import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { Wait } from "testcontainers";

// supabase/migrations and docker/init-scripts live at the monorepo root, four
// levels up from this file (apps/web/src/test), not under apps/web.
const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const MIGRATIONS_DIR = join(PROJECT_ROOT, "supabase/migrations");
const INIT_SCRIPTS_DIR = join(PROJECT_ROOT, "docker/init-scripts");

// Pinned to the same image the project's docker-compose uses so the SQL
// surface (auth schema, auth.uid(), extensions, roles) matches production.
const SUPABASE_POSTGRES_IMAGE = "supabase/postgres:15.14.1.121";

// The supabase/postgres image's migrate.sh requires this superuser to exist
// before it runs. The same value is hard-coded in
// docker/init-scripts/00-bootstrap-supabase-admin.sql; keep them aligned.
const POSTGRES_PASSWORD = "postgres";

// Matches the project's docker-compose.yml `x-jwt` anchor. The integration
// stack doesn't issue real JWTs (tests inject `request.jwt.claim.sub`
// directly), but the init scripts still need a non-empty value to write
// into `app.settings.jwt_secret`.
const JWT_SECRET =
  "your-super-secret-jwt-token-with-at-least-32-characters-long";
const JWT_EXP = "3600";

/**
 * Bind-mount the project's init scripts the same way docker-compose.yml does.
 * The image's entrypoint runs anything under `/docker-entrypoint-initdb.d` in
 * alphabetical order; supabase's own migrate.sh runs first (it's baked into
 * the image) and depends on `supabase_admin` already existing, which
 * `00-bootstrap-...` provides.
 */
const INIT_BIND_MOUNTS: ReadonlyArray<{ source: string; target: string }> = [
  {
    source: join(INIT_SCRIPTS_DIR, "00-bootstrap-supabase-admin.sql"),
    target: "/docker-entrypoint-initdb.d/00-bootstrap-supabase-admin.sql",
  },
  {
    source: join(INIT_SCRIPTS_DIR, "roles.sql"),
    target: "/docker-entrypoint-initdb.d/init-scripts/99-roles.sql",
  },
  {
    source: join(INIT_SCRIPTS_DIR, "webhooks.sql"),
    target: "/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql",
  },
  {
    source: join(INIT_SCRIPTS_DIR, "jwt.sql"),
    target: "/docker-entrypoint-initdb.d/jwt.sql",
  },
  {
    source: join(INIT_SCRIPTS_DIR, "migrations/_supabase.sql"),
    target: "/docker-entrypoint-initdb.d/migrations/97-_supabase.sql",
  },
  {
    source: join(INIT_SCRIPTS_DIR, "migrations/realtime.sql"),
    target: "/docker-entrypoint-initdb.d/migrations/99-realtime.sql",
  },
];

let container: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;

async function applyMigrations(connectionString: string): Promise<void> {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(`no migrations found under ${MIGRATIONS_DIR}`);
  }

  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
  try {
    for (const file of files) {
      const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await sql.unsafe(body);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer(SUPABASE_POSTGRES_IMAGE)
    .withDatabase("postgres")
    .withUsername("postgres")
    .withPassword(POSTGRES_PASSWORD)
    .withEnvironment({
      POSTGRES_HOST: "/var/run/postgresql",
      POSTGRES_PORT: "5432",
      JWT_SECRET,
      JWT_EXP,
    })
    .withBindMounts(
      // Single call: withBindMounts replaces the list rather than appending,
      // so passing one mount at a time would only mount the last one and
      // migrate.sh would fail for missing supabase_admin.
      INIT_BIND_MOUNTS.map((m) => ({
        source: m.source,
        target: m.target,
        mode: "ro",
      }))
    )
    .withStartupTimeout(240_000)
    // The image's HEALTHCHECK depends on services we don't boot (gotrue,
    // postgrest). pg_isready inside the container is the equivalent probe for
    // "Postgres itself accepts connections" after migrate.sh + the init
    // scripts have all completed.
    .withWaitStrategy(
      Wait.forSuccessfulCommand("pg_isready -U postgres -h 127.0.0.1")
    )
    .start();

  const connectionString = container.getConnectionUri();
  process.env.DATABASE_URL = connectionString;

  await applyMigrations(connectionString);
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
