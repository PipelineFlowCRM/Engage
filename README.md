# Pipelineflow Engagement

Self-hosted customer engagement platform — segments, journeys, broadcasts,
AWS SES integration. Sister app to [PipelineFlow CRM](../pipeline-flow);
ships standalone or tightly integrated with the CRM when both are installed.

PERN stack: PostgreSQL (with TimescaleDB) + Express + React + Node, using
BullMQ + Redis for background work. Single-tenant. Designed for
entrepreneurs and small teams self-hosting on Portainer.

Domain model is Segment.com-style (track / identify / page / screen / group /
alias events) with JSON-tree audiences, journey DAGs, and MJML+Liquid email
templates. The runtime stays inside the PERN stack: BullMQ for journeys and
broadcasts, Postgres + TimescaleDB for events.

## Quick start

```sh
cp .env.example .env
# Generate secrets:
#   openssl rand -base64 32   # SECRET_ENCRYPTION_KEY
#   openssl rand -base64 64   # PREFERENCES_JWT_KEY
#   openssl rand -base64 64   # CRM_SHARED_SECRET (if pairing with CRM)
docker compose up -d
```

Web UI: http://localhost:5174 · API: http://localhost:4100 · Bull Board: http://localhost:4100/admin/queues

## Repo layout

```
apps/
  api/      Express HTTP API + Prisma schema
  worker/   BullMQ workers (event ingest, audience compute, broadcast send, SES quota poll)
  web/      Vite React SPA
packages/
  shared/   Zod schemas, queue names, journey/audience types
```

## Local dev

```sh
pnpm install
docker compose up -d postgres redis
pnpm --filter @pipelineflow-engagement/api run prisma:migrate
pnpm --filter @pipelineflow-engagement/api run prisma:seed
pnpm dev
```

## License

MIT.
