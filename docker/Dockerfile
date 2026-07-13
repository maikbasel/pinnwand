# syntax=docker/dockerfile:1.7

# ---- shared base ---------------------------------------------------------
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ---- deps stage (cacheable install) --------------------------------------
FROM base AS deps
# Workspace install needs every package manifest + the workspace file, but not
# the sources — copying only manifests keeps this layer cached until a
# dependency actually changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/web/package.json ./apps/web/
COPY apps/mcp/package.json ./apps/mcp/
COPY packages/contracts/package.json ./packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build stage (produces dist/) ----------------------------------------
FROM base AS build
# Bring the whole installed workspace (root + per-package node_modules with
# their pnpm symlinks intact) then overlay sources. node_modules is
# .dockerignore'd, so `COPY . .` never clobbers the installed tree.
COPY --from=deps /app/ ./
COPY . .
# Vite inlines VITE_* at build time, so the frontend's Supabase URL + anon key
# must arrive as build args here; a runtime env on the web container is never
# read. env.ts (src/app/env.ts) reads exactly these two.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN pnpm build

# ---- migrate stage (init container, applies SQL and exits) ---------------
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml ./
COPY supabase ./supabase
# DATABASE_URL provided by compose. --yes skips interactive prompts.
# --include-all applies every pending migration in version (timestamp) order,
# even when a newer-timestamped migration is already on the target's history
# table. Parallel branches merge out of timestamp order against a single linear
# prod, so a later branch can carry migrations stamped earlier than one already
# deployed; plain `db push` aborts on that ("Found local migration files to be
# inserted before the last migration on remote database"). Migrations are
# append-only and forward-only, so applying all pending in version order is safe.
ENTRYPOINT ["sh", "-c"]
CMD ["pnpm exec supabase db push --db-url \"$DATABASE_URL\" --include-all --yes"]

# ---- seed stage (dev-only fixture seeding, init container) ---------------
# Builds ONLY for docker-compose.yml's `seed` service. It is intentionally NOT
# referenced by docker-compose.coolify.yml, so prod has no fixture-seeding code
# path. The script lives in scripts/ (never supabase/migrations/), so the
# migrate stage's `db push --include-all` can never apply it either.
FROM base AS seed
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY scripts/seed-dev.mjs ./scripts/seed-dev.mjs
CMD ["node", "scripts/seed-dev.mjs"]

# ---- runtime stage (caddy serving dist/) ---------------------------------
FROM caddy:2.8-alpine AS runtime
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
# Run as non-root. Port 8080 is unprivileged, so caddy doesn't need CAP_NET_BIND.
# /data and /config are caddy's XDG dirs (autosave, certificates); must be writable.
RUN addgroup -S caddy 2>/dev/null || true \
 && adduser -S -G caddy -h /config caddy 2>/dev/null || true \
 && mkdir -p /data /config \
 && chown -R caddy:caddy /data /config /srv
USER caddy
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/ >/dev/null || exit 1
