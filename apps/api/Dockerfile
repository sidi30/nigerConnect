FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/config/package.json packages/config/
# Reproducible installs — a lockfile drift must FAIL the build, not silently
# resolve to whatever registry returns today (supply-chain hardening).
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @nigerconnect/api prisma:generate \
  && pnpm --filter @nigerconnect/api build \
  # `--legacy` keeps the pre-pnpm-v10 `deploy` semantics: copy the workspace
  # into a self-contained dir without requiring inject-workspace-packages=true.
  && pnpm --filter @nigerconnect/api deploy --prod --legacy /prod/api \
  # Regenerate the Prisma client INSIDE /prod/api so the engine binary +
  # generated client (`.prisma/client`) live next to the runtime node_modules.
  # Otherwise the deploy strips them and `@prisma/client` fails at import time.
  && cd /prod/api \
  && node node_modules/prisma/build/index.js generate

FROM node:22-alpine AS runner
RUN apk add --no-cache curl openssl libc6-compat \
  && addgroup -S nodejs -g 1001 \
  && adduser -S nodejs -u 1001
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=build --chown=nodejs:nodejs /prod/api/dist ./dist
COPY --from=build --chown=nodejs:nodejs /prod/api/prisma ./prisma
COPY --from=build --chown=nodejs:nodejs /prod/api/node_modules ./node_modules
COPY --from=build --chown=nodejs:nodejs /prod/api/package.json ./package.json

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

# Migrations are normally applied by scripts/deploy-vps.sh BEFORE this CMD
# starts (one-shot container). Re-running them here is idempotent and rescues
# the case where the API restarts without going through the deploy script.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
