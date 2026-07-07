# Deployment

Pinnwand deploys via Coolify. The static frontend and the self-hosted Supabase backend ship in one Compose file ([`docker-compose.coolify.yml`](../docker-compose.coolify.yml)) and run as a single Coolify resource. The secrets, env vars, public hostnames, and Studio access model below apply to any Docker-Compose-capable host; Coolify-specific notes are called out inline.

## Service graph

```
db (healthy) → migrate (completed) → auth, rest, realtime → kong → web
                                          ↓
                                        meta → studio
```

The `migrate` init container runs `supabase db push --include-all` against the in-cluster Postgres before `auth`/`rest`/`realtime` start, so schema changes apply automatically on every redeploy. If `migrate` fails, the downstream services never start: the deploy halts instead of booting against a stale schema.

Every required env var uses `${VAR:?msg}` fail-fast syntax. Coolify runs `docker compose config` before applying the stack, so a missing variable refuses to render and the deploy halts before any container starts.

## Secrets

Generate these once per environment and store them in Coolify's Environment Variables tab. Never reuse the public demo keys from `docker-compose.yml` in production.

### `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`

Use Supabase's canonical [`generate-keys.sh`](https://github.com/supabase/supabase/blob/master/docker/utils/generate-keys.sh):

```bash
curl -sSL https://raw.githubusercontent.com/supabase/supabase/master/docker/utils/generate-keys.sh | sh
```

Pure `openssl`, no Node or Python. It prints `JWT_SECRET` (`openssl rand -base64 30`, 40 chars) and the two HS256-signed JWTs derived from it. The three values are mathematically linked. Never rotate one without rotating all three together.

### `REALTIME_ENC_KEY`

```bash
openssl rand -hex 8        # 16 hex chars = exactly 16 bytes
```

Feeds AES-128-ECB, which encrypts the `_realtime.tenants` row at rest. Anything other than 16 bytes crashes the realtime container on boot with `Bad key size`. `JWT_SECRET` (40 bytes) is too long, which is why this is a separate variable.

### `REALTIME_SECRET_KEY_BASE`

```bash
openssl rand -hex 32       # 64 hex chars = exactly 64 bytes
```

Phoenix's cookie session store validates the value is at least 64 bytes (`Plug.Session.COOKIE.validate_secret_key_base/1`). `JWT_SECRET` (40 bytes) is too short, which is why this is a separate variable.

### `POSTGRES_PASSWORD`

```bash
openssl rand -base64 24
```

The Postgres superuser password. Every backend service connects with it; `Dockerfile.db`'s init scripts reset the built-in Supabase roles to match it on first boot.

## Required environment variables

Set every value below on the Coolify resource. The compose file's `${VAR:?msg}` syntax refuses to render if any are missing.

```
POSTGRES_PASSWORD
JWT_SECRET
ANON_KEY
SERVICE_ROLE_KEY
REALTIME_ENC_KEY
REALTIME_SECRET_KEY_BASE
SITE_URL
API_EXTERNAL_URL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
EMAIL_FROM
```

`SITE_URL` is the public web hostname (GoTrue uses it for the redirect allow-list and emits it in magic-link emails). `API_EXTERNAL_URL` is the public Kong hostname; it is baked into the frontend bundle as `VITE_SUPABASE_URL` at build time and is also read by Studio for browser-side calls. `SMTP_*` and `EMAIL_FROM` wire GoTrue to a real mail provider so magic-link and OTP emails deliver (there is no Mailpit in production).

## Domains and reverse proxy

Coolify's built-in reverse proxy fronts three services on three hostnames. Each is configured in Coolify's per-service **"Domains for &lt;service&gt;"** field, not via env vars:

| Coolify "Domains for…" | Service       | Auth                                  |
|------------------------|---------------|---------------------------------------|
| `web`                  | `web:8080`    | App-level (magic-link / OTP sign-in)  |
| `kong`                 | `kong:8000`   | Supabase API key + JWT                |
| `studio`               | `studio:3000` | SSO/auth proxy upstream (see below)   |

The `kong` hostname must also be set as `API_EXTERNAL_URL`. The `web` hostname must also be set as `SITE_URL`. The `studio` hostname needs only the Coolify domain field; no env var consumes it.

## Studio access

Studio has no built-in authentication, and its container is reachable on the compose network without credentials. Never expose port 3000 directly and never rely on it being "internal only." Put an identity-aware SSO/auth proxy in front of the studio hostname so every request is authenticated before it reaches the container.

**One-time per environment:**

1. Stand up an SSO/auth proxy (for example [Fossorial Pangolin](https://docs.fossorial.io/) or an OAuth2 proxy) in front of the studio hostname, with a policy that lists the operators.
2. In Coolify, set "Domains for studio" to that hostname (port `3000`, HTTPS). Do not enable any Coolify-level basic-auth; the SSO proxy is the sole authority.
3. Verify from a clean machine: visiting the studio hostname must redirect to the SSO challenge. Reaching Studio without authenticating is a critical misconfiguration, because Postgres admin would be public.

Prefer identity-aware SSO over a single shared basic-auth credential: SSO gives per-user access, MFA, and an audit trail, and its failure mode is "unreachable" rather than "wide open."

## Deploying

Coolify pulls `docker-compose.coolify.yml` from the default branch and builds the images (the web/migrate images build from the repo `Dockerfile`; `db`, `kong`, and `rest` build from their derived Dockerfiles so no host bind-mounts are needed).

Deploys are manual; there is no auto-deploy on push.

```
GitHub → Actions → Deploy to Coolify → Run workflow
```

[`.github/workflows/deploy-coolify.yml`](../.github/workflows/deploy-coolify.yml) calls `coolify-deploy-action`, which hits Coolify's API to redeploy the resource against the default branch. The job waits up to 10 minutes for the deploy to report healthy, and its `concurrency` group serializes runs so two operators can't dispatch simultaneous deploys.

Required GitHub `production` environment values:

- **secrets:** `COOLIFY_TOKEN` (a Coolify API token with deploy scope)
- **vars:** `COOLIFY_DOMAIN` (the Coolify instance URL), `COOLIFY_RESOURCE_UUID` (the resource to redeploy)

You can still trigger a redeploy straight from the Coolify UI; the workflow is a convenience that keeps deploys auditable in Actions.

## First deploy checklist

- [ ] Coolify resource created from `docker-compose.coolify.yml`.
- [ ] All 13 required env vars set on the resource (see above).
- [ ] The four secret groups generated with the documented commands, not reused from another project.
- [ ] Three "Domains for…" entries filled (`web`, `kong`, `studio`).
- [ ] SSO/auth proxy pointing at the studio hostname with the operator policy attached.
- [ ] DNS records configured for all three hostnames, with valid TLS certs in Coolify.
- [ ] GitHub `production` environment created with `COOLIFY_TOKEN` (secret) plus `COOLIFY_DOMAIN` and `COOLIFY_RESOURCE_UUID` (vars).
- [ ] First deploy dispatched via Actions → Deploy to Coolify; verify `migrate` completed and `web`/`kong`/`studio` report healthy.
- [ ] Visit the studio hostname from a clean browser: it must redirect to the SSO challenge, never straight to Studio.
- [ ] Provision the first operator account (see below), then sign in from the web hostname.

## Provisioning users

Self-serve signup is disabled (`GOTRUE_DISABLE_SIGNUP=true`). Operators add users through Studio (Authentication → Users → Add user) or the GoTrue admin API. Set the person's display name on their `public.profiles` row (Database → `public.profiles`); it is the single source of truth for identity. The user then signs in passwordlessly from the web hostname by requesting a magic link / OTP. There is no password to set.

## Updating production

Schema changes ship as a new file under `supabase/migrations/`. On the next deploy the `migrate` init container picks them up automatically; there is no separate "run migrations" step. Migrations are append-only and forward-only, so `--include-all` reconciles branches that merged out of timestamp order (see [`.claude/rules/migrations.md`](../.claude/rules/migrations.md)).

Backend image bumps (GoTrue, PostgREST, Realtime, Studio, postgres-meta, Kong, Postgres) are pinned in the compose files. Review the upstream changelog before bumping, especially Studio, which has shipped silent breaking changes around module-load assertions and scandir paths (the `tmpfs` mounts and `HOSTNAME` env in the studio service exist to work around exactly those).
