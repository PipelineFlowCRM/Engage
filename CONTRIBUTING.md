# Contributing to Pipelineflow Engagement

This is a sister project to [PipelineFlow CRM](../pipeline-flow). We follow the
same conventions:

- **Single-tenant.** All signed-in operators share one workspace; no per-user
  ACLs. End-users being messaged are `Subscriber`s, not `AuthUser`s — never
  conflate the two.
- **Schemas first.** Define request/response shapes in
  `packages/shared/src/*.ts`, import everywhere. Don't redeclare.
- **No backwards-compat shims.** This is a fresh codebase. Delete unused code;
  don't comment-fence "removed for migration."
- **Comments explain *why*, not *what*.** Well-named identifiers do the latter.

## Stack at a glance

| Layer | Choice |
|---|---|
| Backend | Express + Prisma + Zod + Argon2 + Pino |
| Database | Postgres + TimescaleDB extension (Event hypertable) |
| Background work | BullMQ + Redis |
| ESP | AWS SES (SESv2 + SNS-signed webhooks) |
| Email render | MJML + Liquid (sandboxed) |
| Frontend | React 18 + Vite + React Router + TanStack Query + RHF + Radix/shadcn + Tailwind |
| Monorepo | pnpm workspaces (`apps/{api,worker,web}`, `packages/shared`) |
| Deployment | Docker Compose for Portainer |

## Local development

```sh
# Bring up Postgres (with Timescale) + Redis only.
docker compose up -d postgres redis

# Generate the Secret-table encryption key + preferences JWT key.
echo "SECRET_ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
echo "PREFERENCES_JWT_KEY=$(openssl rand -base64 64)" >> .env

pnpm install
pnpm --filter @pipelineflow-engagement/api run prisma:migrate
pnpm --filter @pipelineflow-engagement/api run prisma:seed   # seed admin + subscription groups

pnpm dev
# api  →  http://localhost:4100
# web  →  http://localhost:5174
```

## Migrations

Every schema change starts with editing `apps/api/prisma/schema.prisma`, then:

```sh
pnpm --filter @pipelineflow-engagement/api run prisma:migrate:dev --name short_name
```

Hand-edit the generated SQL when you need things Prisma can't model:

- Partial unique indexes (`UNIQUE … WHERE`)
- Timescale hypertable conversions, compression, retention policies
- Continuous aggregates
- Index types (GIN, BRIN)

The reference for what Timescale-specific DDL looks like is
`apps/api/prisma/migrations/0002_event_hypertable/migration.sql`.

## Background jobs

Queue names + job shapes live in `packages/shared/src/queues.ts`. Producers
import enqueue helpers from `apps/api/src/lib/queue.ts`. Consumers register
in `apps/worker/src/index.ts`.

Bull Board dashboard: `http://localhost:4100/admin/queues` (auth required).

## Tests

```sh
pnpm test
```

Vitest, colocated `*.test.ts` files. Test the audience compiler with
golden-file SQL output, the SES SNS signature verifier with sample
notifications, the JWT preferences token roundtrip.

## Sending events

```sh
TOKEN="pfe_tok_….secret_part"  # mint via Settings → API tokens

curl -X POST http://localhost:4100/api/public/identify \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"u_42","traits":{"email":"jane@example.com","plan":"pro"}}'

curl -X POST http://localhost:4100/api/public/track \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"u_42","event":"opened_app","properties":{"page":"dashboard"}}'
```

## Deployment notes

The default `docker-compose.yml` is Portainer-ready. Ports default to
`127.0.0.1`-bound; flip `BIND_HOST=0.0.0.0` only behind a TLS-terminating
reverse proxy. If the proxy isn't terminating TLS, also set
`SESSION_COOKIE_SECURE=false` so login cookies travel over HTTP.

Pre-migrate `pg_dump` backups land in the `pfengagement-backups` named volume
under `/backups`. They're plain `--no-owner --no-acl` dumps and require the
`timescaledb` extension on the target cluster to restore the Event
hypertable. To pull off-host:

```sh
docker compose cp api:/backups ./backups-copy
```

Or bind-mount the volume to a host path in compose for rsync.
