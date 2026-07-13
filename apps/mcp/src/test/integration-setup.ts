import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import {
  GenericContainer,
  Network,
  type StartedNetwork,
  type StartedTestContainer,
  Wait,
} from "testcontainers";

// The mcp integration test drives the real production data path:
// supabase-js -> kong (/rest/v1/*) -> PostgREST (validates the user JWT ->
// role) -> Postgres RLS. Booting that exact stack in testcontainers (rather
// than a hand-rolled SQL harness) keeps the acceptance gate honest: it proves
// one user's MCP tool calls can never read/write another user's board through
// the same REST + RLS boundary the deployed server relies on — with no
// manually-started stack, so CI needs nothing beyond Docker.

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const MIGRATIONS_DIR = join(PROJECT_ROOT, "supabase/migrations");
const INIT_SCRIPTS_DIR = join(PROJECT_ROOT, "docker/init-scripts");
const KONG_CONFIG = join(PROJECT_ROOT, "docker/kong.yml");

// Pinned to the same images docker-compose.yml uses so the SQL surface and the
// REST/gateway behaviour match production.
const SUPABASE_POSTGRES_IMAGE = "supabase/postgres:15.14.1.121";
const POSTGREST_IMAGE = "postgrest/postgrest:v12.2.12";
const KONG_IMAGE = "kong:2.8.1";

const POSTGRES_PASSWORD = "postgres";

// The well-known self-hosted Supabase demo credentials (already in
// docker-compose.yml / docker/kong.yml) — never real secrets. supabase-js
// sends ANON_KEY as the `apikey` kong validates; PostgREST and our RPCs
// validate the user JWT signed with JWT_SECRET.
const JWT_SECRET =
  "your-super-secret-jwt-token-with-at-least-32-characters-long";
const JWT_EXP = "3600";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.b_lMH2mc5km7S9Lw_sRGGqE9IeiahYu-caevDcacKiY";
const SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.kcyKZAiwnnBG9t6IVGO17bcVw574pVynTHYVdF4q-p0";

const DB_ALIAS = "db";
const REST_ALIAS = "rest";
const POSTGREST_PORT = 3000;
const KONG_PORT = 8000;

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

let network: StartedNetwork | undefined;
let db: Awaited<ReturnType<PostgreSqlContainer["start"]>> | undefined;
let rest: StartedTestContainer | undefined;
let kong: StartedTestContainer | undefined;

// The supabase/postgres image bakes an auth.uid() that reads only the legacy
// per-claim GUC request.jwt.claim.sub, which PostgREST v12 no longer sets (it
// sets the request.jwt.claims JSON instead). In the full stack GoTrue's
// migrations redefine auth.uid() to read that JSON; we don't run GoTrue, so
// install the same plural-reading definition here. auth.* is owned by
// supabase_admin, so this runs as that superuser (created by
// docker/init-scripts/00-bootstrap-supabase-admin.sql), not `postgres`.
const AUTH_UID_SHIM = /* sql */ `
  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
`;

async function installAuthUidShim(
  adminConnectionString: string
): Promise<void> {
  const sql = postgres(adminConnectionString, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    await sql.unsafe(AUTH_UID_SHIM);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

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
  network = await new Network().start();

  db = await new PostgreSqlContainer(SUPABASE_POSTGRES_IMAGE)
    .withNetwork(network)
    .withNetworkAliases(DB_ALIAS)
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
      INIT_BIND_MOUNTS.map((m) => ({
        source: m.source,
        target: m.target,
        mode: "ro",
      }))
    )
    .withStartupTimeout(240_000)
    .withWaitStrategy(
      Wait.forSuccessfulCommand("pg_isready -U postgres -h 127.0.0.1")
    )
    .start();

  // Apply migrations before PostgREST connects so its schema cache is warm on
  // first boot (it caches on connect; empty tables -> 404s otherwise).
  await applyMigrations(db.getConnectionUri());
  const adminUri = `postgresql://supabase_admin:${POSTGRES_PASSWORD}@${db.getHost()}:${db.getMappedPort(5432)}/postgres`;
  await installAuthUidShim(adminUri);

  rest = await new GenericContainer(POSTGREST_IMAGE)
    .withNetwork(network)
    .withNetworkAliases(REST_ALIAS)
    .withEnvironment({
      PGRST_DB_URI: `postgres://authenticator:${POSTGRES_PASSWORD}@${DB_ALIAS}:5432/postgres`,
      PGRST_DB_SCHEMAS: "public",
      PGRST_DB_ANON_ROLE: "anon",
      PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_DB_USE_LEGACY_GUCS: "false",
      PGRST_APP_SETTINGS_JWT_SECRET: JWT_SECRET,
      PGRST_APP_SETTINGS_JWT_EXP: JWT_EXP,
    })
    .withExposedPorts(POSTGREST_PORT)
    .withWaitStrategy(Wait.forHttp("/", POSTGREST_PORT).forStatusCode(200))
    .withStartupTimeout(120_000)
    .start();

  // Replicate the compose kong entrypoint: substitute the anon/service keys
  // into the declarative config, then start kong. Kong resolves upstream DNS
  // lazily per-request, so the absent auth/realtime upstreams are harmless as
  // long as the test only calls /rest/v1/*.
  const kongEntrypoint =
    'sed -e "s|\\$SUPABASE_ANON_KEY|$SUPABASE_ANON_KEY|g" -e "s|\\$SUPABASE_SERVICE_KEY|$SUPABASE_SERVICE_KEY|g" /home/kong/temp.yml > /home/kong/kong.yml && /docker-entrypoint.sh kong docker-start';

  kong = await new GenericContainer(KONG_IMAGE)
    .withNetwork(network)
    .withCopyFilesToContainer([
      { source: KONG_CONFIG, target: "/home/kong/temp.yml" },
    ])
    .withEnvironment({
      KONG_DATABASE: "off",
      KONG_DECLARATIVE_CONFIG: "/home/kong/kong.yml",
      KONG_DNS_ORDER: "LAST,A,CNAME",
      KONG_PLUGINS: "request-transformer,cors,key-auth,acl,basic-auth",
      KONG_NGINX_PROXY_PROXY_BUFFER_SIZE: "160k",
      KONG_NGINX_PROXY_PROXY_BUFFERS: "64 160k",
      SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_KEY: SERVICE_KEY,
    })
    .withEntrypoint(["bash", "-c", kongEntrypoint])
    .withExposedPorts(KONG_PORT)
    // A 401 (missing apikey) on the rest route proves kong loaded the config
    // and the key-auth plugin is active — i.e. the gateway is fully up.
    .withWaitStrategy(Wait.forHttp("/rest/v1/", KONG_PORT).forStatusCode(401))
    .withStartupTimeout(120_000)
    .start();

  const kongUrl = `http://${kong.getHost()}:${kong.getMappedPort(KONG_PORT)}`;

  // env.ts zod-parses process.env at import; set everything the mcp runtime +
  // the test need here, before the test worker forks and imports env.ts.
  process.env.SUPABASE_URL = kongUrl;
  process.env.SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
  process.env.MCP_PUBLIC_URL = "http://localhost:8787";
  process.env.DATABASE_URL = db.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await kong?.stop();
  await rest?.stop();
  await db?.stop();
  await network?.stop();
}
