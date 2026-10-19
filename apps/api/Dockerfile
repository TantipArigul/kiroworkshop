# Multi-stage build (deployment.md — Runtime image, D5-12).
#   build    : full workspace install + shared/api/web builds (also the source of apps/web/dist)
#   migrate  : one-off `prisma migrate deploy` admin process (prisma CLI + prisma/), never serves traffic
#   prod-deps: production dependencies of @portal/api and @portal/shared only
#   runtime  : default target; slim image, non-root, no dev dependencies

FROM node:24-bookworm AS build
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @portal/shared build \
  && DATABASE_URL=file:/workspace/data/portal.db pnpm --filter @portal/api prisma:generate \
  && pnpm --filter @portal/api build \
  && pnpm --filter @portal/web build

FROM build AS migrate
USER node
# DATABASE_URL comes from the server env file at run time. The prisma binary is called directly:
# `pnpm exec` as the non-root user would try to re-provision pnpm and the modules directory.
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM node:24-bookworm AS prod-deps
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate \
  && pnpm install --frozen-lockfile --prod --filter "@portal/api..."

FROM node:24-bookworm-slim AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
# Code and dependencies stay root-owned (read-only for the `node` user); only the data volume is writable.
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /workspace/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /workspace/packages/shared/dist ./packages/shared/dist
COPY --from=build /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/api/dist/main.js"]
