# syntax=docker/dockerfile:1.7

# ---- shared base ---------------------------------------------------------
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.18.0 --activate
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

# ---- deps stage (cacheable install) --------------------------------------
FROM base AS deps
# mcp only depends on @pinnwand/contracts (workspace) + its own npm deps, so
# only those two package manifests are needed — apps/web's much larger tree
# stays out of this image's install. `--filter @pinnwand/mcp...` scopes the
# install to mcp + its workspace dependencies (contracts).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/mcp/package.json ./apps/mcp/
COPY packages/contracts/package.json ./packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @pinnwand/mcp...

# ---- build stage (produces dist/ + a prod-only deploy) --------------------
FROM base AS build
COPY --from=deps /app/ ./
COPY apps/mcp ./apps/mcp
COPY packages/contracts ./packages/contracts
# tsup.config.ts force-bundles @pinnwand/contracts (source-only workspace
# package, no runtime resolution possible) into dist/index.js; every real npm
# dep (express, @supabase/supabase-js, etc.) stays external.
RUN pnpm --filter @pinnwand/mcp build
# Produces a self-contained package dir at /out: dist/ + a node_modules with
# ONLY the `dependencies` from apps/mcp/package.json (no devDependencies —
# tsup/tsx/vitest/pino-pretty never reach the runtime image). `--legacy`:
# pnpm v10 defaults to injected (symlinked) workspace deps for `deploy`, which
# requires `inject-workspace-packages=true`; legacy mode copies real files
# instead, which is what a Docker COPY --from needs.
RUN pnpm --filter @pinnwand/mcp deploy --prod --legacy /out

# ---- runtime stage ---------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN addgroup -S mcp && adduser -S mcp -G mcp
COPY --from=build /out/dist ./dist
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
# logger.ts only picks the plain JSON pino transport (no pretty-printing) when
# NODE_ENV=production — pino-pretty is a devDependency and isn't in this
# image's node_modules, so leaving NODE_ENV unset crashes pino on boot.
ENV NODE_ENV=production
USER mcp
# Env (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET, MCP_PUBLIC_URL,
# SUPABASE_AUTH_URL, LOG_LEVEL, PORT) is read at runtime from the container
# environment — see src/env.ts. No service role key ever reaches this image.
# It does hold SUPABASE_JWT_SECRET (GoTrue's HS256 secret) at runtime to verify
# user JWTs locally: a token-verification secret, not a data-access key. On a
# Supabase Cloud / asymmetric-signing deployment it is unset and JWKS is used
# instead, so the running process holds only the anon key.
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8787/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
