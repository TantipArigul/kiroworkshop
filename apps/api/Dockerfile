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
  && pnpm --filter @portal/api build

FROM node:24-bookworm
WORKDIR /workspace
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/apps/api ./apps/api
COPY --from=build /workspace/packages/shared ./packages/shared
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
