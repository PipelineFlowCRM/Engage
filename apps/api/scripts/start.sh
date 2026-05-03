#!/bin/sh
# API container entrypoint.
#
# Order of operations on every container start:
#   1. Take a gzipped pg_dump if there are pending migrations.
#   2. Apply pending migrations (`prisma migrate deploy`).
#   3. Start the API.
#
# Notes for Timescale:
#   - The 0001 migration enables the timescaledb extension on a fresh DB.
#   - The 0002 migration converts the Event table into a hypertable + adds
#     compression and retention policies.
#   - pg_dump output for a Timescale DB is restorable IF the target cluster
#     has timescaledb installed. The image we use (timescale/timescaledb-ha:pg16)
#     does — but if you restore into stock postgres:16-alpine it'll fail.

set -eu
set -o pipefail

cd /app/apps/api

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

status_output=$(pnpm exec prisma migrate status 2>&1) && status_rc=0 || status_rc=$?

if [ "$status_rc" -eq 0 ]; then
  echo "[start] schema already up to date — skipping pre-migrate backup"
elif echo "$status_output" | grep -qiE 'have not yet been applied|following migration'; then
  mkdir -p "$BACKUP_DIR"

  BACKUP_DEBOUNCE_SEC="${BACKUP_DEBOUNCE_SEC:-300}"
  marker="${BACKUP_DIR}/.last-pre-migrate-attempt"
  now_epoch=$(date -u +%s)
  if [ -f "$marker" ]; then
    last_epoch=$(cat "$marker" 2>/dev/null || echo 0)
    age=$((now_epoch - last_epoch))
    if [ "$age" -ge 0 ] && [ "$age" -lt "$BACKUP_DEBOUNCE_SEC" ]; then
      echo "[start] pending migrations detected, but a backup attempt happened ${age}s ago (< ${BACKUP_DEBOUNCE_SEC}s) — skipping dump"
      skip_dump=1
    fi
  fi

  if [ "${skip_dump:-0}" -ne 1 ]; then
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    out="${BACKUP_DIR}/pfengagement-${ts}-pre-migrate.sql.gz"
    echo "[start] pending migrations detected — dumping DB to ${out}"

    echo "$now_epoch" > "$marker"

    if pg_dump --dbname="$DATABASE_URL" --no-owner --no-acl --format=plain \
        | gzip -9 > "$out"; then
      echo "[start] backup complete ($(du -h "$out" | cut -f1))"
    else
      echo "[start] pg_dump FAILED — refusing to migrate" >&2
      rm -f "$out"
      exit 1
    fi

    find "$BACKUP_DIR" -maxdepth 1 -name 'pfengagement-*.sql.gz' -type f \
      -mtime "+${BACKUP_RETAIN_DAYS}" -print -delete || true
  fi
else
  echo "[start] prisma migrate status returned ${status_rc}:" >&2
  echo "$status_output" >&2
  exit "$status_rc"
fi

echo "[start] applying migrations"
pnpm exec prisma migrate deploy

rm -f "${BACKUP_DIR}/.last-pre-migrate-attempt" 2>/dev/null || true

echo "[start] starting API"
exec node dist/index.js
