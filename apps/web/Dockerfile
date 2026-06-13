# =============================================================================
# NigerConnect web (Next.js 16 standalone)
# Multi-stage build. Final image is ~150 MB on alpine.
# =============================================================================

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# ── deps : install only what apps/web needs ────────────────────────────────
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY apps/web/package.json apps/web/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile --filter @nigerconnect/web...

# ── build : produce .next/standalone ───────────────────────────────────────
FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
# NEXT_PUBLIC_* are inlined at build time by Next — they must be present here,
# not just at runtime. The admin console + verify-email page call the API via
# NEXT_PUBLIC_API_URL; default to the prod API host when not overridden.
ARG NEXT_PUBLIC_API_URL=https://api.nigerconnect.app/api
ARG NEXT_PUBLIC_APP_URL=https://nigerconnect.app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN pnpm --filter @nigerconnect/web build

# ── runner : minimal runtime image ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache wget tini \
  && addgroup -S nodejs -g 1001 \
  && adduser -S nextjs -u 1001 -G nodejs

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone output bundles a self-contained server.js + the minimal node_modules.
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

# tini = PID 1 → forwards SIGTERM cleanly (graceful shutdown).
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
