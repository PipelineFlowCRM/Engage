-- Convert Event into a Timescale hypertable + add compression and retention
-- policies. Skipped on Postgres-only environments — start.sh detects whether
-- timescaledb is loaded and conditionally applies this. See start.sh.
--
-- The DB cluster MUST have the timescaledb shared_preload_libraries entry
-- (the timescale/timescaledb-ha image sets this for you).

-- Hypertable conversion. chunk_time_interval = 1 day.
-- Composite PK on (id, receivedAt) was set in 0001 specifically so this works.
SELECT create_hypertable(
  '"Event"',
  'receivedAt',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE,
  migrate_data => TRUE
);

-- Compression. Compressed chunks are read-only — late-arriving events
-- inside a compressed chunk fail. Default 7 days; override at deploy time
-- via the operator (we don't read env in migrations).
ALTER TABLE "Event"
  SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = '"subscriberId"',
    timescaledb.compress_orderby = '"receivedAt" DESC, "id" DESC'
  );

SELECT add_compression_policy('"Event"', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention. Drop chunks older than 365 days. Operator can `remove_retention_policy`
-- and re-add at a different interval without code changes.
SELECT add_retention_policy('"Event"', INTERVAL '365 days', if_not_exists => TRUE);

-- Continuous aggregates for common audience-compute queries:
-- 'Performed event X in last N days' resolves to a single bucket scan.
CREATE MATERIALIZED VIEW IF NOT EXISTS events_daily_by_subscriber
WITH (timescaledb.continuous) AS
SELECT
  "subscriberId",
  "name",
  time_bucket(INTERVAL '1 day', "receivedAt") AS bucket,
  count(*) AS event_count
FROM "Event"
WHERE "subscriberId" IS NOT NULL AND "type" = 'track'
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy('events_daily_by_subscriber',
  start_offset => INTERVAL '90 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE
);

CREATE MATERIALIZED VIEW IF NOT EXISTS events_daily_by_name
WITH (timescaledb.continuous) AS
SELECT
  "name",
  time_bucket(INTERVAL '1 day', "receivedAt") AS bucket,
  count(*) AS event_count,
  count(DISTINCT "subscriberId") AS unique_subscribers
FROM "Event"
WHERE "type" = 'track' AND "name" IS NOT NULL
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy('events_daily_by_name',
  start_offset => INTERVAL '90 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes',
  if_not_exists => TRUE
);
