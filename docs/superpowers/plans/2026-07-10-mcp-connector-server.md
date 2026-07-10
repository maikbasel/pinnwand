# MCP Connector Server (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a remote Streamable-HTTP MCP server (`apps/mcp`) that lets AI agents (ChatGPT GUI, Claude apps, Claude Code) read and write the connecting user's Pinnwand boards and tasks, authorized by Supabase's native OAuth 2.1 server, with RLS as the only authz boundary.

**Architecture:** `apps/mcp` is a small always-on Node 22 + Express service using `@modelcontextprotocol/sdk` over Streamable HTTP. It is a **protected resource only**: it serves `/.well-known/oauth-protected-resource` naming Supabase Auth (GoTrue) as the authorization server, validates the incoming Bearer JWT against Supabase JWKS, and builds a **per-request user-scoped `supabase-js` client** (`Authorization: Bearer <userJwt>`). Every existing RLS policy and `is_board_member`/`is_board_owner` helper applies unchanged. The service role key never reaches the MCP. The OAuth consent screen is a new `/oauth/consent` route in `apps/web`.

**Tech Stack:** Node 22, Express 5, `@modelcontextprotocol/sdk` (Streamable HTTP), `jose` (JWKS/JWT verify), `zod`, `pino`, `@supabase/supabase-js`, `@pinnwand/contracts`, `tsx` (dev) / `tsc` (build). Self-hosted Supabase GoTrue `v2.189.0` OAuth 2.1 server. Coolify + Docker.

## Global Constraints

- **RLS is the ONLY authorization boundary.** The MCP never uses the service role key. Every Supabase call is made through a client carrying the caller's user JWT. Verify by impersonation test: user A's token cannot touch user B's board.
- **Validate every input and every Supabase response with `zod`.** Generated types describe the schema, not what arrived. Tool inputs parse to typed shapes; Supabase results parse through schemas before returning.
- **No swallowed errors.** Every tool returns a structured MCP tool error (`isError: true` with text) on failure — RLS denial, empty result, validation failure. Never an empty `catch {}`. `pino` for logs; no `console.log`; never log tokens or the anon key.
- **Node 22, pnpm 10.18, workspace package `@pinnwand/mcp`.** Imports the shared contract as `@pinnwand/contracts`; never duplicates `database.ts`.
- **Streamable HTTP, stateless per request** (no server-side session store in v1) — each request authenticates from its Bearer token. This matches request/response connectors; realtime is out of scope (the web app's existing subscriptions propagate MCP writes for free).
- **Fractional positions** for `move_task`/`create_task` use the same midpoint-between-neighbours rule as the web client (`POSITION_STEP = 1024`; append = max + STEP; move = midpoint(prev, next)).
- **Every changed line traces to this feature.** No refactor of `apps/web` internals beyond adding the consent route and (Task 2) any contract schema the MCP genuinely shares.
- **Done = green:** `apps/mcp` unit tests + RLS impersonation test + OAuth integration test pass; consent Playwright spec passes; `pnpm -w check-types`, `pnpm -w check` clean; the deployed server completes "add a task" from ChatGPT, a Claude app, and Claude Code (cross-client smoke, recorded in the PR).

## Verified spike facts (baked into this plan)

The Phase-0-blocking spike is done. GoTrue `v2.189.0` (pinned in all compose files) ships the OAuth 2.1 server. Enable with these env vars on the `auth` service:

```
GOTRUE_OAUTH_SERVER_ENABLED=true
GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=true
GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent
```

Live-verified endpoints (relative to the GoTrue base, exposed via kong under `/auth/v1`):

| Purpose | Endpoint | Verified |
|---|---|---|
| AS discovery (RFC 8414) | `GET /.well-known/oauth-authorization-server` | 200, full metadata |
| OIDC discovery | `GET /.well-known/openid-configuration` | 200 |
| JWKS | `GET /.well-known/jwks.json` | present |
| Dynamic client registration | `POST /oauth/clients/register` | 201, public client, PKCE, validates `redirect_uris` |
| Authorize | `GET /oauth/authorize` | 302 → `{SITE_URL}/oauth/consent?authorization_id=X` |
| Token | `POST /oauth/token` | exists (400 `invalid_grant` on bad code) |
| Userinfo | `GET /oauth/userinfo` | present |

PKCE **S256** and `token_endpoint_auth_method: none` (public clients) are supported. **Two facts to establish during Task 1/2 (spike left them open):** (a) discovery `issuer` was empty in a minimal boot — set the auth server's absolute external URL so discovery emits absolute endpoints; (b) the exact consent-submit endpoint + payload the `/oauth/consent` page POSTs back to GoTrue (the binary exposes `OAuthServerConsentAction` handlers under `/oauth/...`).

---

## Data-access surface the tools wrap (from `apps/web`)

- **RPCs (SECURITY DEFINER):** `create_board(p_name text)`, `join_board_by_code(p_code text)`, `regenerate_join_code(p_board uuid)`, `set_task_assignees(p_task uuid, p_user_ids uuid[])`, `renormalize_column_positions(...)`.
- **RLS tables:** `boards` (rename/delete = owner via RLS), `board_members` (list boards + members; membership minted only by RPC), `tasks` (list/create/update/move/delete), `task_assignees` (mutated only via `set_task_assignees`).
- **Columns/priorities:** `TASK_COLUMNS`, `TASK_PRIORITIES`, `DEFAULT_TASK_PRIORITY` from `@pinnwand/contracts`.
- **Position helper (mirror in mcp):** `POSITION_STEP=1024`; `bottomPosition(items)=max(position)+STEP` (or STEP if empty); `midpoint(prev,next)`.

---

## File Structure (target)

```
apps/mcp/
  package.json            <- deps + scripts (dev: tsx watch, build: tsc, start: node dist)
  tsconfig.json           <- extends the contracts-resolving config; emits dist/ (Node needs JS)
  Dockerfile              <- workspace-aware multi-stage (mirrors docker/Dockerfile deps pattern)
  src/
    index.ts              <- Express app: mounts /mcp, /.well-known/oauth-protected-resource, /health
    env.ts                <- zod-parsed process.env (Supabase URL, anon key, JWKS URL, issuer, origins, port, log level)
    logger.ts             <- pino instance
    auth/
      resource-metadata.ts<- builds the protected-resource-metadata document
      verify-token.ts     <- jose JWKS verify → { userId, token } | throws AuthError
      supabase-for-user.ts<- per-request user-scoped createClient(url, anonKey, { headers: Bearer })
    mcp/
      server.ts           <- createMcpServer(ctx): registers all tools on an McpServer
      tools/
        boards.ts         <- list/get/create/rename/delete/join/regenerate board tools
        tasks.ts          <- list/get/create/update/move/assign/unassign/delete task tools
        members.ts        <- list_board_members
      position.ts         <- POSITION_STEP + bottomPosition + midpoint (mirrors apps/web)
      errors.ts           <- toToolError(err): maps thrown/Supabase errors → structured MCP tool error
    schemas.ts            <- zod row schemas the tools parse Supabase results through
apps/web/src/features/auth/
  components/OAuthConsent.tsx   <- consent UI (approve/deny), reads authorization_id
  api/oauth-consent.ts          <- fetch calls to GoTrue consent endpoints (no supabase-js session writes)
apps/web/src/app/routes/oauth.consent.tsx  <- TanStack route → renders OAuthConsent
```

---

## Task 1: Enable the GoTrue OAuth 2.1 server (config only)

**Files:**
- Modify: `docker-compose.yml`, `docker-compose.e2e.yml`, `docker-compose.coolify.yml` (the `auth` service env)
- Modify: `.env.example` (document the new public knobs; no secrets)

**Interfaces:**
- Produces: a running GoTrue that serves `/.well-known/oauth-authorization-server` (200) and redirects `/oauth/authorize` to `{SITE_URL}/oauth/consent?authorization_id=…`. Consumed by Tasks 2 and 4.

- [ ] **Step 1: Add the three OAuth-server env vars to the dev `auth` service** in `docker-compose.yml`, beside the existing `GOTRUE_*`:

```yaml
      GOTRUE_OAUTH_SERVER_ENABLED: "true"
      GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION: "true"
      GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH: /oauth/consent
```

- [ ] **Step 2: Mirror the same three vars into `docker-compose.e2e.yml` and `docker-compose.coolify.yml`.** In coolify, also set the auth server's absolute issuer/external URL to the public auth hostname so discovery emits absolute endpoints (resolves spike open item (a)). GoTrue derives the OAuth issuer from `API_EXTERNAL_URL`; confirm the coolify `auth` service `API_EXTERNAL_URL` is the public HTTPS URL (e.g. `https://auth.pinnwand.example`), not an internal host.

- [ ] **Step 3: Verify discovery + authorize live.** Run:
```bash
pnpm dev:up
curl -s http://localhost:8000/auth/v1/.well-known/oauth-authorization-server | jq '{authorization_endpoint,token_endpoint,registration_endpoint,code_challenge_methods_supported}'
```
Expected: 200 with `registration_endpoint` = `/oauth/clients/register` and `code_challenge_methods_supported` containing `S256`.

- [ ] **Step 4: Verify authorize redirects to the consent path.** Register a throwaway client (POST `/auth/v1/oauth/clients/register` with a `redirect_uris`), then GET `/auth/v1/oauth/authorize?...` and assert the `Location` is `http://localhost:5173/oauth/consent?authorization_id=…`. (No commit; this is the config gate.)

---

## Task 2: OAuth consent screen in `apps/web` (`/oauth/consent`)

**Files:**
- Create: `apps/web/src/app/routes/oauth.consent.tsx`
- Create: `apps/web/src/features/auth/components/OAuthConsent.tsx`
- Create: `apps/web/src/features/auth/api/oauth-consent.ts`
- Create: `apps/web/e2e/oauth-consent.spec.ts`
- Modify: `apps/web/src/features/auth/index.ts` (export the route component if the router needs it)

**Interfaces:**
- Consumes: GoTrue `authorization_id` query param; the existing passwordless session (user must be signed in).
- Produces: on approve, a POST to GoTrue's consent endpoint that resolves the authorization and 302s the browser back to the client's `redirect_uri` with `?code=…`. Consumed by the OAuth clients (ChatGPT/Claude), not by other tasks.

- [ ] **Step 1: Discover the exact consent endpoint + payload (resolves spike open item (b)).** With `pnpm dev:up` running, drive `/oauth/authorize` to get an `authorization_id`, then inspect GoTrue's authorization + consent API: `GET /auth/v1/oauth/authorizations/{id}` (client + scope details) and the consent action (`POST` approve/deny). Capture the exact paths/response shapes into `oauth-consent.ts` as typed `zod` calls. Record the discovered contract at the top of `oauth-consent.ts` in a comment.

- [ ] **Step 2: Write the failing consent-flow Playwright test** `apps/web/e2e/oauth-consent.spec.ts`: sign in as `alice@dev.local` (existing helper), navigate to a real `/oauth/consent?authorization_id=…` produced by an authorize call to a registered client, assert the approve button renders the client name, click Approve, assert the redirect lands on the client `redirect_uri` with a `code` param.

- [ ] **Step 3: Run it → FAIL** (route missing).
Run: `pnpm --filter @pinnwand/web exec playwright test e2e/oauth-consent.spec.ts` → FAIL.

- [ ] **Step 4: Implement `oauth-consent.ts`** — `getAuthorizationDetails(authorizationId)` and `submitConsent(authorizationId, action: "approve"|"deny")`, both `fetch` against GoTrue via the app's Supabase URL base + the user's access token (read from the existing session), responses parsed with `zod`. No `supabase-js` cache writes; this is not in the offline allowlist.

- [ ] **Step 5: Implement `OAuthConsent.tsx`** — loading/error/empty states; if unauthenticated, redirect into the existing sign-in flow with a return path back to consent; on load show the requesting client name + scopes; Approve/Deny buttons call `submitConsent` and then `window.location.assign(redirectTo)` with the URL GoTrue returns. Use shadcn primitives (Card, Button) per the project rule.

- [ ] **Step 6: Implement the route** `oauth.consent.tsx` (validate `authorization_id` search param with `zod`, render `OAuthConsent`).

- [ ] **Step 7: Run the test → PASS.**
Run: `pnpm --filter @pinnwand/web exec playwright test e2e/oauth-consent.spec.ts` → PASS.

---

## Task 3: `apps/mcp` scaffold (package, env, logger, health)

**Files:**
- Modify: `apps/mcp/package.json` (deps + scripts)
- Modify: `apps/mcp/tsconfig.json` (emit `dist/`)
- Create: `apps/mcp/src/env.ts`, `apps/mcp/src/logger.ts`, `apps/mcp/src/index.ts`
- Create: `apps/mcp/src/env.test.ts`

**Interfaces:**
- Produces: `env` (typed config), `logger` (pino), and an Express `app` with `GET /health`. Consumed by all later mcp tasks.

- [ ] **Step 1: `apps/mcp/package.json`** — add dependencies and scripts:

```json
{
  "name": "@pinnwand/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --target node22 --clean",
    "start": "node dist/index.js",
    "check-types": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@pinnwand/contracts": "workspace:*",
    "@supabase/supabase-js": "2.105.3",
    "express": "^5.0.0",
    "jose": "^6.0.0",
    "pino": "^9.0.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "25.6.2",
    "pino-pretty": "^13.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.19.0",
    "typescript": "6.0.3",
    "vitest": "4.1.5"
  }
}
```

**Build tooling (resolved):** the mcp runs compiled JS in prod (`node dist/index.js`), but `@pinnwand/contracts` is a **source-only** `.ts` workspace package that Node cannot import at runtime, and `tsc`'s `rootDir` model does not cleanly emit an out-of-`rootDir` workspace dependency into a coherent `dist`. So the build uses **`tsup`** (esbuild) which **bundles** `@pinnwand/contracts` inline into `dist/index.js`. `dev` uses `tsx` (resolves the contract `.ts` directly, no build). `check-types` is `tsc --noEmit` only (type-check, no emit); the mcp `tsconfig.json` keeps `noEmit:true`, `moduleResolution:"bundler"`, `module:"ESNext"`, `target:"ES2023"`, `types:["node"]`. Verify the build in Step 6 by `node dist/index.js` starting and `/health` responding with no unresolved `@pinnwand/contracts`.

- [ ] **Step 2: Write the failing env test** `src/env.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("rejects a missing Supabase URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
  it("parses a valid environment", () => {
    const env = parseEnv({
      SUPABASE_URL: "https://sb.example",
      SUPABASE_ANON_KEY: "anon",
      MCP_PUBLIC_URL: "https://mcp.example",
      PORT: "8787",
    });
    expect(env.SUPABASE_URL).toBe("https://sb.example");
    expect(env.PORT).toBe(8787);
  });
});
```

- [ ] **Step 3: Run → FAIL** (`parseEnv` not defined).
Run: `pnpm --filter @pinnwand/mcp test` → FAIL.

- [ ] **Step 4: Implement `src/env.ts`** (mirrors `apps/web/src/app/env.ts` shape). No service role key in the schema at all:

```ts
import { z } from "zod";

const EnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  // Auth server that issues the user JWTs (GoTrue). Defaults to SUPABASE_URL + /auth/v1.
  SUPABASE_AUTH_URL: z.url().optional(),
  // Public URL of THIS mcp server; used in protected-resource metadata.
  MCP_PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(8787),
  ALLOWED_ORIGINS: z.string().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof EnvSchema>;
export function parseEnv(source: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return EnvSchema.parse(source);
}
export const env = parseEnv(process.env);
```

- [ ] **Step 5: Implement `src/logger.ts`** (`pino({ level: env.LOG_LEVEL })`, pretty transport only when `NODE_ENV !== "production"`) and `src/index.ts` with a health route + listen:

```ts
import express from "express";
import { env } from "./env";
import { logger } from "./logger";

export const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok" }));

if (process.env.NODE_ENV !== "test") {
  app.listen(env.PORT, () => logger.info({ port: env.PORT }, "mcp listening"));
}
```

- [ ] **Step 6: Run → PASS**, and `curl localhost:8787/health` returns `{"status":"ok"}` under `pnpm --filter @pinnwand/mcp dev`.

---

## Task 4: Auth — protected-resource metadata, JWKS verify, per-request client

**Files:**
- Create: `apps/mcp/src/auth/resource-metadata.ts`, `apps/mcp/src/auth/verify-token.ts`, `apps/mcp/src/auth/supabase-for-user.ts`
- Create: `apps/mcp/src/auth/verify-token.test.ts`
- Modify: `apps/mcp/src/index.ts` (mount the metadata route)

**Interfaces:**
- Consumes: `env`. Produces:
  - `resourceMetadata(): object` and route `GET /.well-known/oauth-protected-resource`.
  - `verifyToken(authorizationHeader: string | undefined): Promise<{ userId: string; token: string }>` — throws `AuthError` (401) on missing/invalid/expired.
  - `supabaseForUser(token: string): SupabaseClient<Database>` — user-scoped client.
  Consumed by Task 5 (server wiring) and all tools.

- [ ] **Step 1: Write failing `verify-token.test.ts`** — a malformed/absent header rejects; a token signed by a test JWKS with a `sub` resolves to that `userId`. Use `jose`'s `SignJWT` + a local `createLocalJWKSet` in the test to avoid network.

```ts
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { describe, expect, it } from "vitest";
import { makeVerifier } from "./verify-token";

describe("verifyToken", () => {
  it("rejects a missing header", async () => {
    const { verifyToken } = await buildVerifier();
    await expect(verifyToken(undefined)).rejects.toThrow();
  });
  it("resolves the userId from a valid token", async () => {
    const { verifyToken, sign } = await buildVerifier();
    const token = await sign({ sub: "user-a" });
    await expect(verifyToken(`Bearer ${token}`)).resolves.toMatchObject({ userId: "user-a" });
  });
});
// buildVerifier: generate ES256 keypair, expose exportJWK as a local JWKS,
// construct makeVerifier({ jwks }) and a sign() helper. (Full helper written in Step 3.)
```

- [ ] **Step 2: Run → FAIL.**
Run: `pnpm --filter @pinnwand/mcp test verify-token` → FAIL.

- [ ] **Step 3: Implement `verify-token.ts`** with a testable `makeVerifier` (injectable JWKS) + a default `verifyToken` using `createRemoteJWKSet(new URL(env.SUPABASE_AUTH_URL ?? env.SUPABASE_URL + "/auth/v1/.well-known/jwks.json"))`:

```ts
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "../env";

export class AuthError extends Error {}

export function makeVerifier(getKey: JWTVerifyGetKey) {
  return async function verifyToken(header: string | undefined) {
    if (!header?.startsWith("Bearer ")) {
      throw new AuthError("Missing bearer token");
    }
    const token = header.slice("Bearer ".length);
    try {
      const { payload } = await jwtVerify(token, getKey);
      if (!payload.sub) throw new AuthError("Token has no subject");
      return { userId: payload.sub, token };
    } catch (cause) {
      throw new AuthError("Invalid or expired token", { cause });
    }
  };
}

const jwksUrl = new URL(
  env.SUPABASE_AUTH_URL
    ? `${env.SUPABASE_AUTH_URL}/.well-known/jwks.json`
    : `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`
);
export const verifyToken = makeVerifier(createRemoteJWKSet(jwksUrl));
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Implement `supabase-for-user.ts`** — the RLS-preserving client (never the service key):

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pinnwand/contracts";
import { env } from "../env";

export function supabaseForUser(token: string): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 6: Implement `resource-metadata.ts`** (RFC 9728 protected-resource metadata) and mount it. `authorization_servers` names the GoTrue AS discovery URL; `resource` is `MCP_PUBLIC_URL`:

```ts
import { env } from "../env";
export function resourceMetadata() {
  const authBase = env.SUPABASE_AUTH_URL ?? `${env.SUPABASE_URL}/auth/v1`;
  return {
    resource: env.MCP_PUBLIC_URL,
    authorization_servers: [authBase],
    bearer_methods_supported: ["header"],
  };
}
```
In `index.ts`: `app.get("/.well-known/oauth-protected-resource", (_req, res) => res.json(resourceMetadata()));`

- [ ] **Step 7: Verify** the metadata route returns the AS URL and the health route still works.

---

## Task 5: MCP server bootstrap + Streamable HTTP transport

**Files:**
- Create: `apps/mcp/src/mcp/server.ts`, `apps/mcp/src/mcp/errors.ts`, `apps/mcp/src/mcp/position.ts`, `apps/mcp/src/schemas.ts`
- Modify: `apps/mcp/src/index.ts` (mount `/mcp`, enforce auth, return 401 + `WWW-Authenticate` pointing at the resource metadata when unauthenticated)
- Create: `apps/mcp/src/mcp/server.test.ts`

**Interfaces:**
- Consumes: `verifyToken`, `supabaseForUser`. Produces: `createMcpServer(ctx: { supabase: SupabaseClient<Database>; userId: string })` returning a configured `McpServer` with all tools registered (tools added in Tasks 6–8; this task registers a `whoami` sanity tool and the plumbing). Consumed by the `/mcp` route.

- [ ] **Step 1: Implement `errors.ts`** — `toToolError(err): { content: [...], isError: true }`. Map a Supabase `{ code, message }` and a thrown `Error` to a clear user-facing string; RLS denial / empty → "You are not a member of that board, or it does not exist."

- [ ] **Step 2: Implement `position.ts`** (copy the three helpers from `apps/web/src/features/tasks/lib/position.ts`: `POSITION_STEP`, `bottomPosition`, `midpoint`) with a colocated `position.test.ts` asserting `midpoint(null,null)===1024`, `midpoint(0,1024)===512`, `bottomPosition([])===1024`. (Ponytail: three tiny pure functions duplicated rather than made a shared package — promote to `@pinnwand/contracts` only if a third consumer appears.)

- [ ] **Step 3: Implement `schemas.ts`** — `zod` row schemas the tools parse Supabase results through (`BoardRowSchema`, `TaskRowSchema` incl. `task_assignees`, `MemberRowSchema`), reusing `TASK_COLUMNS`/`TASK_PRIORITIES` ids from `@pinnwand/contracts` for the enums. These are the "Row schemas deferred from Phase 0" — they now live in the mcp, and the web's copies stay independent (they carry web-specific query-key coupling; do not merge them yet).

- [ ] **Step 4: Write failing `server.test.ts`** — `createMcpServer` with a mocked supabase exposes a `whoami` tool that returns `ctx.userId`. Assert the server lists the tool and calling it returns the id.

- [ ] **Step 5: Implement `server.ts`** using `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`; register `whoami` now, one `registerXxxTools(server, ctx)` call per tool module (added in Tasks 6–8):

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@pinnwand/contracts";
import { registerBoardTools } from "./tools/boards";
import { registerTaskTools } from "./tools/tasks";
import { registerMemberTools } from "./tools/members";

export type ToolContext = { supabase: SupabaseClient<Database>; userId: string };

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "pinnwand", version: "1.0.0" });
  server.tool("whoami", "Return the authenticated user's id.", {}, async () => ({
    content: [{ type: "text", text: ctx.userId }],
  }));
  registerBoardTools(server, ctx);
  registerTaskTools(server, ctx);
  registerMemberTools(server, ctx);
  return server;
}
```
(Tasks 6–8 create the three `register*Tools` modules; stub them as empty `export function registerXTools() {}` in this task so it compiles, then fill them in.)

- [ ] **Step 6: Wire `/mcp` in `index.ts`** — per request: `verifyToken(req.headers.authorization)` → on `AuthError` respond `401` with `WWW-Authenticate: Bearer resource_metadata="<MCP_PUBLIC_URL>/.well-known/oauth-protected-resource"` (this is what makes MCP clients start the OAuth flow); else build `supabaseForUser(token)`, `createMcpServer({ supabase, userId })`, and hand the request to a `StreamableHTTPServerTransport` (stateless mode). Use `express.json()` only on `/mcp`.

- [ ] **Step 7: Run → PASS** and manually `curl -i localhost:8787/mcp` (no token) → `401` with the `WWW-Authenticate` header.

---

## Task 6: Board tools

**Files:**
- Create: `apps/mcp/src/mcp/tools/boards.ts`
- Create: `apps/mcp/src/mcp/tools/boards.test.ts`

**Interfaces:**
- Consumes: `ToolContext`. Produces `registerBoardTools(server, ctx)` registering: `list_boards`, `get_board`, `create_board`, `rename_board`, `delete_board`, `join_board_by_code`, `regenerate_join_code`.

**Tool spec (names/descriptions are model-facing; inputs are `zod`):**

| Tool | Input (zod) | Supabase call | Returns |
|---|---|---|---|
| `list_boards` | `{}` | `from("board_members").select("role, boards(*)").eq("user_id", ctx.userId)` | boards + role |
| `get_board` | `{ boardId: uuid }` | `from("boards").select("*").eq("id",…).single()` + task counts per column | board + counts |
| `create_board` | `{ name: string.min(1).max(100) }` | `rpc("create_board", { p_name })` | new board (owner + join code) |
| `rename_board` | `{ boardId: uuid, name }` | `from("boards").update({name}).eq("id",…)` (RLS owner) | updated board |
| `delete_board` | `{ boardId: uuid }` | `from("boards").delete().eq("id",…)` (RLS owner; cascades) | `{ deleted: true }` |
| `join_board_by_code` | `{ code: string }` | `rpc("join_board_by_code", { p_code })` | joined board |
| `regenerate_join_code` | `{ boardId: uuid }` | `rpc("regenerate_join_code", { p_board })` | new code |

- [ ] **Step 1: Write the failing exemplar test** for `create_board` and `list_boards` against a **mocked** supabase (a fake with `.rpc`/`.from` returning canned `{ data, error }`), asserting: happy path returns the parsed board text; an `error` result returns an `isError` tool response with a clear message.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `boards.ts`.** Full exemplar for the two representative shapes (RPC + table); the remaining five follow the same pattern per the table. Every handler wraps its body in `try/catch → toToolError`:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../server";
import { toToolError } from "../errors";
import { BoardRowSchema } from "../../schemas";

export function registerBoardTools(server: McpServer, ctx: ToolContext) {
  server.tool(
    "create_board",
    "Create a new board (Pinnwand). Mints the owner membership and a join code.",
    { name: z.string().trim().min(1).max(100) },
    async ({ name }) => {
      try {
        const { data, error } = await ctx.supabase.rpc("create_board", { p_name: name });
        if (error) return toToolError(error);
        const board = BoardRowSchema.parse(data);
        return { content: [{ type: "text", text: JSON.stringify(board) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );

  server.tool(
    "list_boards",
    "List the boards the current user is a member of.",
    {},
    async () => {
      try {
        const { data, error } = await ctx.supabase
          .from("board_members")
          .select("role, boards(*)")
          .eq("user_id", ctx.userId);
        if (error) return toToolError(error);
        return { content: [{ type: "text", text: JSON.stringify(data ?? []) }] };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
  // rename_board, delete_board, get_board, join_board_by_code,
  // regenerate_join_code — same pattern per the spec table above.
}
```

- [ ] **Step 4: Implement the remaining five** per the table.

- [ ] **Step 5: Run → PASS** (`pnpm --filter @pinnwand/mcp test boards`).

---

## Task 7: Task tools

**Files:**
- Create: `apps/mcp/src/mcp/tools/tasks.ts`, `apps/mcp/src/mcp/tools/tasks.test.ts`

**Interfaces:**
- Produces `registerTaskTools(server, ctx)`: `list_tasks`, `get_task`, `create_task`, `update_task`, `move_task`, `assign_task`, `unassign_task`, `delete_task`.

**Tool spec:**

| Tool | Input (zod) | Supabase call | Notes |
|---|---|---|---|
| `list_tasks` | `{ boardId: uuid }` | `from("tasks").select("*, task_assignees(user_id)").eq("board_id",…).order("column").order("position")` | group by the four fixed columns |
| `get_task` | `{ taskId: uuid }` | `…select(...).eq("id",…).single()` | with assignees |
| `create_task` | `{ boardId, title:1..200, description?:"".max(5000), column?:enum=DEFAULT "offen", priority?:enum=DEFAULT_TASK_PRIORITY, dueDate?:string\|null }` | read column tail → `bottomPosition` → `insert` | append to column |
| `update_task` | `{ taskId, title?, description?, priority?, dueDate? }` | `from("tasks").update(patch).eq("id",…)` | partial |
| `move_task` | `{ taskId, column?:enum, position?:number, beforeTaskId?:uuid, afterTaskId?:uuid }` | compute midpoint from neighbours (or use given position) → `update({column,position})` | writes the moved row only |
| `assign_task` | `{ taskId, userId }` | read current assignees → `rpc("set_task_assignees", { p_task, p_user_ids: [...current, userId] })` | member of the task's board (RLS/RPC enforces) |
| `unassign_task` | `{ taskId, userId }` | read current → `set_task_assignees` without `userId` | atomic set |
| `delete_task` | `{ taskId }` | `from("tasks").delete().eq("id",…)` | RLS-scoped |

- [ ] **Step 1: Write failing tests** for `create_task` (asserts append position = max+STEP via a mocked column read) and `move_task` (asserts midpoint between the given neighbours), plus `assign_task` (asserts the union set passed to the RPC). Mocked supabase.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `tasks.ts`** using `mcp/position.ts` for `create_task`/`move_task`. `create_task` reads the destination column's current tail (`select position … order desc limit`) then `bottomPosition`. `move_task` resolves `beforeTaskId`/`afterTaskId` (or the explicit `position`) to neighbour positions then `midpoint`. `assign_task`/`unassign_task` read the current assignee set then call `set_task_assignees` (atomic). Column/priority enums come from `@pinnwand/contracts`; `DEFAULT_TASK_PRIORITY` is the default.

- [ ] **Step 4: Run → PASS.**

---

## Task 8: Member tool

**Files:**
- Create: `apps/mcp/src/mcp/tools/members.ts`, `apps/mcp/src/mcp/tools/members.test.ts`

**Interfaces:**
- Produces `registerMemberTools(server, ctx)`: `list_board_members`.

- [ ] **Step 1: Failing test** — `list_board_members({ boardId })` returns members (for choosing assignees); an RLS-denied board returns an empty list, not an error leak.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `from("board_members").select("user_id, role, profiles(...)").eq("board_id", boardId)`, parsed with `MemberRowSchema`.
- [ ] **Step 4: Run → PASS.**

---

## Task 9: Security + integration tests (the acceptance gate)

**Files:**
- Create: `apps/mcp/src/mcp/__tests__/rls-impersonation.integration.test.ts`
- Create: `apps/mcp/src/auth/__tests__/oauth-flow.integration.test.ts`
- Modify: `apps/mcp/package.json` (`test:integration` script if a testcontainer/live stack is used)

**Interfaces:**
- Consumes: a running Supabase stack (reuse `pnpm dev:up` or a testcontainer) with two seeded users (alice owner of Team-Board; charlie owns Charlies Board).

- [ ] **Step 1: RLS impersonation (security gate).** With real user JWTs for alice and charlie (mint via the seed helper / admin API in the test setup), build `supabaseForUser(aliceToken)` and call the tool handlers directly: `list_tasks({ boardId: charliesBoardId })` → **empty**; `create_task` into Charlies Board → **denied** (error tool response); `delete_board(charliesBoardId)` as alice → denied. Assert alice can read/write her own board. This encodes the security rule as a test, not a checklist.

- [ ] **Step 2: OAuth integration.** Against `pnpm dev:up`: (a) `GET /.well-known/oauth-protected-resource` on the mcp names the GoTrue AS; (b) register a client via DCR; (c) run authorize→consent(approve as alice)→token to get a real access token; (d) call `/mcp` `whoami` with it → alice's id; (e) call `/mcp` with no token → 401 + `WWW-Authenticate`. 

- [ ] **Step 3: Run both → PASS.**

---

## Task 10: Deployment (Dockerfile, Coolify, docs)

**Files:**
- Create: `apps/mcp/Dockerfile`
- Modify: `docker-compose.coolify.yml` (add the `mcp` service + the OAuth env on `auth` from Task 1)
- Modify: `docs/deployment.md`

**Interfaces:**
- Produces: a deployable mcp image + a Coolify service on its own HTTPS subdomain.

- [ ] **Step 1: `apps/mcp/Dockerfile`** — workspace-aware multi-stage mirroring `docker/Dockerfile`'s deps pattern: `deps` copies `pnpm-lock.yaml pnpm-workspace.yaml package.json` + `apps/mcp/package.json` + `packages/contracts/package.json`, `pnpm install --frozen-lockfile`; `build` copies the deps `/app/` tree + sources, `pnpm --filter @pinnwand/mcp build`; `runtime` is `node:22-alpine`, copies `dist` + production node_modules, `CMD ["node","apps/mcp/dist/index.js"]`. No service role key anywhere.

- [ ] **Step 2: Build the image** `docker build -f apps/mcp/Dockerfile --target runtime .` → succeeds; `docker run` with env → `/health` 200.

- [ ] **Step 3: Add the `mcp` service to `docker-compose.coolify.yml`** (separate Coolify app): env from `env.ts` (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_AUTH_URL, MCP_PUBLIC_URL, ALLOWED_ORIGINS, LOG_LEVEL, PORT) — **no service role key**. Confirm the `auth` service already carries the Task-1 OAuth env in coolify.

- [ ] **Step 4: Update `docs/deployment.md`** — the new mcp service, its subdomain, the OAuth server enablement, the consent route, and the cross-client connect strings (ChatGPT GUI connector URL, Claude connector URL, `claude mcp add --transport http <url>`).

- [ ] **Step 5: Cross-client smoke (manual, recorded in the PR).** Deploy; connect from the ChatGPT GUI, a Claude app, and Claude Code; run "add a task to <board>"; confirm it appears live on the web board (via the web app's existing realtime). Paste the three transcripts/screenshots into the PR.

---

## Self-Review notes

- **Spec coverage:** full read/write tool surface (Tasks 6–8) ✓; works in ChatGPT + Claude via one deployment (Task 10 Step 5) ✓; acts as the connecting user via per-request user-scoped client (Task 4) ✓; RLS the only boundary + no service key (Global Constraints, Task 9 Step 1) ✓; native Supabase OAuth 2.1 AS (Tasks 1–2, spike) ✓; zod at every boundary (all tools + schemas.ts) ✓; structured tool errors (errors.ts) ✓; pino, no console.log ✓; realtime out of scope ✓; deployment on Coolify (Task 10) ✓; tests: unit per tool + RLS impersonation + OAuth integration + consent Playwright (Tasks 6–9, 2) ✓. Top spike (self-hosted OAuth server support) done and **passed** — the hand-rolled fallback is not needed.
- **Deviations:** the Phase-0-deferred Row schemas land in `apps/mcp/src/schemas.ts` (Task 5 Step 3), not in `@pinnwand/contracts`, because the web copies are coupled to TanStack query keys — merging them is a separate, later refactor with a real second consumer. `position.ts` is duplicated (3 pure functions) rather than shared for the same YAGNI reason.
- **Open items resolved during execution, not guessed now:** exact consent-submit endpoint/payload (Task 2 Step 1), discovery `issuer` absolute-URL config (Task 1 Step 2), whether tsc emits the inlined contract or `tsup` is needed (Task 3 Step 1 note).
- **Type consistency:** `ToolContext` (`{ supabase, userId }`) is defined in `server.ts` and consumed identically by every `register*Tools`; `toToolError` and the `{ content:[{type:"text",text}], isError? }` shape are used by every handler; `verifyToken` returns `{ userId, token }` consumed by the `/mcp` route.
- **Commits:** per the standing "don't commit yet" directive, execution is test-gated, not per-task-committed. Ignore the TDD `git commit` cadence until the user asks; the commit-per-task steps are implied by the sub-skill but deferred.
```
