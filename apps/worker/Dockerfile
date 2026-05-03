# Pipelineflow Engagement background worker.
#
# DO NOT add `prisma migrate deploy` here. The api owns migrations + the
# pre-migrate backup; the worker just needs the generated client.

# ── build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
RUN apk add --no-cache python3 make g++ openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile=false

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
# Worker needs the schema (for prisma generate) but NOT the migrations dir.
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/worker apps/worker

RUN pnpm --filter @pipelineflow-engagement/shared run build
RUN pnpm --filter @pipelineflow-engagement/worker run prisma:generate
RUN pnpm --filter @pipelineflow-engagement/worker run build

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl wget
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

ENV NODE_ENV=production
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/pnpm-lock.yaml* ./
COPY --from=build /repo/apps/worker/package.json ./apps/worker/
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/packages/shared/package.json ./packages/shared/

RUN pnpm install --prod --frozen-lockfile=false

COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/apps/api/prisma/schema.prisma ./apps/api/prisma/schema.prisma
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist

RUN pnpm --filter @pipelineflow-engagement/worker run prisma:generate

RUN chown -R node:node /app
USER node

WORKDIR /app/apps/worker

CMD ["node", "dist/index.js"]
