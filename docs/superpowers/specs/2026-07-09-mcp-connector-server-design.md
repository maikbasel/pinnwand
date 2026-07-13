# MCP Connector Server Design (Phase 1)

**Date:** 2026-07-09
**Status:** Approved for planning
**Phase:** 1 of 2 (depends on the Phase 0 Turborepo restructure)
**Package:** `apps/mcp`

## Goal

Let AI agents read and write a user's boards and tasks through a remote Model Context Protocol server. The driving use case: a person opens the ChatGPT GUI and says "add this as a task," and it appears on their board. The same server works in the ChatGPT GUI, Claude apps, and Claude Code, with no per-client code.

## Requirements

- **Full read/write** on tasks and boards, matching the human user surface.
- **Works in ChatGPT and Claude** (apps and Claude Code) from one deployment. This is an explicit acceptance criterion.
- **Acts as the connecting user.** The agent inherits that user's board memberships and RLS scope, and can only touch boards the user already belongs to.
- **RLS stays the only authorization boundary.** The service role key never reaches the MCP server.

## Architecture

A remote **Streamable HTTP** MCP server (Node 22, Express, `@modelcontextprotocol/sdk`) deployed as a small always-on container on Coolify beside the existing Supabase stack. It is a **protected resource only**, not an authorization server.

### Why remote and hosted

The ChatGPT GUI and Claude's hosted connectors reach an MCP by calling a public URL from their own backends; they cannot spawn or reach a local stdio process. OAuth login and callback also need a stable public URL. So a hosted HTTPS endpoint is required. Claude Code consumes the same remote URL (`claude mcp add --transport http`).

### Authentication: Supabase native OAuth 2.1 server

Supabase Auth ships an OAuth 2.1 server (beta) built for exactly this. It is the authorization server; the MCP server is the resource server.

Flow:

1. The MCP client (ChatGPT / Claude / Claude Code) fetches `/.well-known/oauth-protected-resource` from the MCP server, which names Supabase Auth as the authorization server.
2. The client discovers Supabase's OAuth metadata (`/.well-known/oauth-authorization-server`) and registers via **dynamic client registration** with **PKCE (S256)**.
3. The user is redirected to a **consent screen** hosted in `apps/web` (`authorization_url_path`, route `/oauth/consent`). If not signed in, they sign in with the existing passwordless flow (magic link / OTP), then approve the agent.
4. Supabase issues standard Supabase user JWTs (access + refresh) directly to the client.
5. On each tool call the client sends the access token as a bearer. The MCP server validates it against Supabase JWKS and builds a per-request user-scoped `supabase-js` client:

   ```ts
   createClient(url, anonKey, {
     global: { headers: { Authorization: `Bearer ${userJwt}` } },
     auth: { persistSession: false },
   })
   ```

Because the JWT carries `auth.uid()`, the existing RLS policies and the `is_board_member` / `is_board_owner` helpers apply unchanged. No policy rewrites. The MCP never re-issues or forwards a mismatched token, so there is no confused-deputy problem: the token is a Supabase token and the downstream resource is Supabase.

### Why not hand-roll OAuth or add a vendor

Earlier drafts had the MCP server implement the OAuth authorization surface itself or delegate to an auth vendor (Auth0, Stytch, WorkOS). The native Supabase OAuth 2.1 server removes that entirely and is Supabase's documented MCP pattern. It is the lowest-friction, standards-compliant path and keeps identity in the system that already owns it.

## Data access

The MCP tools are thin wrappers over the contracts the web app already uses: the `SECURITY DEFINER` RPCs (`create_board`, `join_board_by_code`, `regenerate_join_code`) and RLS-scoped table operations on `tasks`, `task_assignees`, `boards`, and `board_members`. No new backend logic, no new migrations for the happy path. Fractional positions for `move_task` are computed the same way the web client computes them (midpoint between neighbours).

Inputs are validated with zod schemas imported from `@pinnwand/contracts`. Tool responses parse Supabase results through the same schemas rather than trusting generated types alone.

## Tool surface

Names and descriptions are written for model consumption, since both ChatGPT and Claude select tools purely from the schema.

**Boards**
- `list_boards`: boards the user is a member of.
- `get_board`: one board with its columns and task counts.
- `create_board`: via `create_board` RPC (mints owner membership + join code).
- `rename_board`: owner only (RLS enforces).
- `delete_board`: owner only; cascades tasks and assignees.
- `join_board_by_code`: via `join_board_by_code` RPC.
- `regenerate_join_code`: owner only, via RPC.

**Tasks**
- `list_tasks`: tasks on a board, grouped by the four fixed columns, ordered by position.
- `get_task`: one task with assignees.
- `create_task`: title, optional description, column (default `offen`), priority (default `mittel`), optional due date; appended to the column.
- `update_task`: title, description, priority, due date.
- `move_task`: target column and/or position; writes the fractional midpoint of the moved row only.
- `assign_task` / `unassign_task`: add/remove a Verantwortliche who must be a member of the task's board.
- `delete_task`.

**Members**
- `list_board_members`: members of a board, for choosing assignees.

## Error handling

- Every tool validates input with zod and returns a structured tool error on failure, never a swallowed exception.
- RLS denial or empty result surfaces a clear message ("You are not a member of that board" / "That task does not exist or you cannot access it"). The agent relays it to the user.
- Expired or invalid token returns the auth-required error the MCP spec defines, which triggers the client to re-run the OAuth flow.
- Owner-only actions attempted by a non-owner return the RLS denial as a clear message, not a crash.
- `pino` for structured leveled logs. No `console.log`. No secrets in logs (no tokens, no anon key values).

## Realtime

None in the MCP. A connector is request/response. When the agent writes a task, it propagates to any open web board through the web app's existing `postgres_changes` subscriptions, live and for free.

## Deployment

- New long-running Coolify service built from `apps/mcp` (Node 22, Dockerfile), its own subdomain over HTTPS.
- Env-parsed config (zod, mirroring `apps/web/src/app/env.ts`): Supabase URL, anon key, JWKS URL, allowed origins, log level. No service role key.
- The `docker-compose.coolify.yml` Supabase stack gains the OAuth server config; the web static service and the MCP service are separate Coolify apps.

## Risks and spikes

1. **Self-hosted OAuth 2.1 server support (top spike, do first).** The feature is documented for Supabase Cloud and the CLI. On the self-hosted GoTrue image in `docker-compose.coolify.yml` it is an image-version and env-configuration question. First plan step: confirm the running GoTrue/auth image supports `[auth.oauth_server]`, bump the image if needed, enable it, and verify the discovery + authorize + token endpoints respond. If the self-hosted image cannot support it in a reasonable window, fall back to the previously-scoped hand-rolled OAuth resource server on the MCP; the rest of the design is unchanged.
2. **Beta feature.** The Supabase OAuth server is in beta. Acceptable for a two-user app; pin the auth image version and watch the changelog.
3. **Open dynamic client registration.** DCR lets any client register. Mitigations: strict redirect-URI validation, mandatory user consent (which requires an authenticated user, and signup is disabled), and short access-token lifetime with refresh.

## Testing

- **Unit tests per tool handler** with a mocked Supabase client: happy path, validation failure, RLS-denial mapping to a clear error.
- **RLS impersonation test** (encoded, not manual): user A's token cannot read or write user B's board through any tool; reads return empty, writes are denied. This is the security acceptance gate.
- **OAuth integration test**: discovery, dynamic client registration, authorize with consent, token issuance, then an authenticated tool call succeeds; an unauthenticated call is rejected.
- **Cross-client smoke** (manual, recorded in the PR): the deployed server connects and completes "add a task" from the ChatGPT GUI, a Claude app, and Claude Code.
- Playwright is out of scope for the MCP; the consent screen in `apps/web` gets a Playwright check for the sign-in-then-approve path.

## Delivery

One PR stacked on the Phase 0 restructure branch. Ships the `apps/mcp` service, the `apps/web` consent screen, the Supabase OAuth server config, tests, the Coolify service definition, and `docs/deployment.md` updates. The self-hosted OAuth spike is the first task and gates the rest.
