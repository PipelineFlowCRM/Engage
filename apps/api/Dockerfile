# ── build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile=false

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @pipelineflow-engagement/shared run build
RUN pnpm --filter @pipelineflow-engagement/api exec prisma generate
RUN pnpm --filter @pipelineflow-engagement/api run build

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
# postgresql16-client provides pg_dump. Keep aligned with the postgres image
# (timescale/timescaledb-ha:pg16) so dumps are version-compatible.
RUN apk add --no-cache openssl wget postgresql16-client
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

ENV NODE_ENV=production
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/pnpm-lock.yaml* ./
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/packages/shared/package.json ./packages/shared/

RUN pnpm install --prod --frozen-lockfile=false

COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/scripts ./apps/api/scripts
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist

RUN pnpm --filter @pipelineflow-engagement/api exec prisma generate

RUN mkdir -p /backups && chown -R node:node /backups
RUN chown -R node:node /app
RUN chmod +x /app/apps/api/scripts/start.sh
USER node

WORKDIR /app/apps/api
EXPOSE 4100

CMD ["/app/apps/api/scripts/start.sh"]
