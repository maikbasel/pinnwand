# @pinnwand/mcp

Remote MCP connector server for Pinnwand. It exposes the board and task
operations as MCP tools over streamable HTTP. Every request carries the
caller's Supabase (GoTrue) JWT; the server acts as that user through a
per-request anon-key Supabase client, so Postgres RLS stays the only
authorization boundary. The service role key never touches this server.

## Run it locally

You need the local Supabase stack running and a `.env` file.

```bash
pnpm dev:up                 # boots Postgres + kong + GoTrue + seeds demo users
cp apps/mcp/.env.example apps/mcp/.env
cd apps/mcp && pnpm dev     # tsx loads .env, server listens on :8787
```

`.env.example` ships the public demo keys, so the copy works without edits.
Check the server is up:

```bash
curl -s localhost:8787/health        # {"status":"ok"}
```

If `pnpm dev` exits with a `ZodError` naming `SUPABASE_URL` and friends, you
skipped the `cp` step. The server reads its config from `.env`.

## How auth works

`POST /mcp` expects `Authorization: Bearer <JWT>`. `verifyToken` checks the
signature (HS256 against `SUPABASE_JWT_SECRET` for self-hosted GoTrue, or the
published JWKS on Supabase Cloud) and reads `sub` as the user id. The server
then builds a Supabase client scoped to that token and runs the tool. A real
client gets the token through the OAuth flow the server advertises at
`GET /.well-known/oauth-protected-resource`.

## Connect from Claude and ChatGPT

Both add it as a **custom remote connector** pointing at `POST /mcp`. Auth is
per-user: the client runs the OAuth flow the server advertises, the user signs
in through your Supabase GoTrue, and the connector holds that user's token. No
API key field — RLS scopes every call to whoever connected.

Use the deployed URL, e.g. `https://pinnwand-mcp.<your-domain>/mcp` (the
`/mcp` path is required). See `docs/deployment.md` for the Coolify domain and
`MCP_PUBLIC_URL` setup.

**Claude** (web or Desktop): Settings → **Connectors** → **Add custom
connector** → paste the `/mcp` URL → **Connect** → sign in.

**ChatGPT** (Plus/Pro/Business, developer mode): Settings → **Connectors** →
**Advanced** → **Create** → paste the `/mcp` URL, set auth to **OAuth** →
**Connect** → sign in. Then enable it per-chat under the **+** / tools menu.

Sanity-check the endpoints before connecting:

```bash
curl -s https://pinnwand-mcp.<your-domain>/health   # {"status":"ok"}
curl -s https://pinnwand-mcp.<your-domain>/.well-known/oauth-protected-resource
```

The second returns your `resource` URL and an `authorization_servers` entry
pointing at `.../auth/v1`. If **Connect** stalls at sign-in, check that GoTrue's
OAuth metadata has **absolute** endpoints (`GOTRUE_JWT_ISSUER` must be set — see
Common problems below), then confirm the `/mcp` endpoint itself works with a
minted token first (next section).

## Debug it with a minted token

For a quick manual check you do not need the OAuth flow. Mint a token for a
seeded user with the demo secret and call the server directly.

1. Get a seeded user's id (run from the repo root, where `docker-compose.yml`
   lives):

   ```bash
   docker compose exec -T db psql -U postgres -d postgres -tAc \
     "select id from auth.users where email='alice@dev.local'"
   ```

   If that returns nothing, list who is seeded:
   `... -tAc "select email, id from auth.users order by email"`.

2. Mint an HS256 token for that id (run from `apps/mcp`, uses the installed
   `jose`). Paste the id in place of `USER_ID`:

   ```bash
   node --input-type=module -e '
   import { SignJWT } from "jose";
   const t = await new SignJWT({ sub: process.argv[1], role: "authenticated", aud: "authenticated" })
     .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h")
     .sign(new TextEncoder().encode("your-super-secret-jwt-token-with-at-least-32-characters-long"));
   console.log(t);
   ' USER_ID
   ```

3. Smoke-test the server end to end (`initialize` handshake):

   ```bash
   curl -si -X POST localhost:8787/mcp \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
   ```

   A `200` with `serverInfo: pinnwand` means the token, kong, PostgREST, and
   RLS all line up.

## Debug it in the MCP Inspector

The Inspector gives you a UI to list and call tools. Curl works for the
handshake, but this server builds a fresh, stateless MCP server per request
(`sessionIdGenerator: undefined`), so a standalone `tools/call` over curl hits
an uninitialized server. The Inspector holds one connection open through its
proxy, so `initialize` and `tools/call` share a session.

```bash
npx @modelcontextprotocol/inspector
```

In the UI:

1. Transport Type: **Streamable HTTP**.
2. URL: `http://localhost:8787/mcp`.
3. Under Authentication, add a custom header `Authorization` with value
   `Bearer <token>`, and turn the header toggle **on**.
4. Connect. Open **Tools**, run `whoami` (returns the user id), then
   `create_board` and `list_boards`.

To watch RLS in action, mint a second token for `charlie@dev.local`, swap the
header, Reconnect, and confirm `list_boards` does not return alice's board.

## Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ZodError` on `SUPABASE_URL` etc. at startup | no `.env` | `cp .env.example .env` |
| `401 Token has no subject` | token has an empty `sub`; the id lookup returned nothing | re-mint with a real seeded id |
| `401 Invalid or expired token` | `Bearer ` prefix missing, wrong secret, or expired | resend with the prefix and a fresh token |
| Inspector shows an OAuth discovery wall of `invalid_format` errors | the `Authorization` header toggle is off, so the server returns 401 and the Inspector falls back to OAuth against GoTrue | enable the header toggle |
| Claude/ChatGPT **Connect** stalls after discovery; GoTrue metadata shows `"issuer":""` and relative endpoints like `/oauth/authorize` | on GoTrue ≤2.189 the OAuth metadata base comes from `JWT.Issuer`, unset by default | set `GOTRUE_JWT_ISSUER` to `${API_EXTERNAL_URL}/auth/v1` on the `auth` service and redeploy |
| `curl: connection refused` | server not running | check the `pnpm dev` terminal for a crash |
