# Chapter 16 — Database Schema

> Hypertable design, continuous aggregates, compression, retention policies, helper functions, and indexing strategy.

---

## Schema Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        TIMESCALEDB SCHEMA                                  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  metrics (hypertable)                                                │  │
│  │  ├── time        TIMESTAMPTZ NOT NULL                                │  │
│  │  ├── topic       TEXT NOT NULL                                       │  │
│  │  ├── value       DOUBLE PRECISION                                    │  │
│  │  ├── value_str   TEXT                                                │  │
│  │  ├── quality     SMALLINT DEFAULT 192                                │  │
│  │  └── metadata    JSONB DEFAULT '{}'                                  │  │
│  │  CHECK: value IS NOT NULL OR value_str IS NOT NULL                   │  │
│  └──────────────────────┬───────────────────────────────────────────────┘  │
│                         │                                                  │
│           ┌─────────────┼─────────────┬─────────────┐                      │
│           │             │             │             │                      │
│           ▼             ▼             ▼             ▼                      │
│  ┌──────────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐              │
│  │ metrics_1min │ │metrics_  │ │metrics_  │ │ Compression   │              │
│  │ (cont. agg)  │ │1hour     │ │1day      │ │ Policy        │              │
│  │              │ │(cont.agg)│ │(cont.agg)│ │               │              │
│  │ Refresh: 1m  │ │Refresh:1h│ │Refresh:1d│ │ Segment: topic│              │
│  │ Retain: 90d  │ │Retain: 1y│ │Retain: 5y│ │ Compress: >7d │              │
│  └──────────────┘ └──────────┘ └──────────┘ └───────────────┘              │
│                                                                            │
│  Retention: metrics → 30 days (raw data)                                   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## metrics Table (Hypertable)

```sql
CREATE TABLE IF NOT EXISTS metrics (
    time        TIMESTAMPTZ     NOT NULL,
    topic       TEXT            NOT NULL,
    value       DOUBLE PRECISION,
    value_str   TEXT,
    quality     SMALLINT        DEFAULT 192,
    metadata    JSONB           DEFAULT '{}'::jsonb,
    CONSTRAINT metrics_value_check CHECK (value IS NOT NULL OR value_str IS NOT NULL)
);

-- Convert to hypertable (1-day chunks)
SELECT create_hypertable('metrics', 'time',
    chunk_time_interval => INTERVAL '1 day');
```

### Column Reference

| Column      | Type             | Nullable | Default | Purpose                               |
| ----------- | ---------------- | -------- | ------- | ------------------------------------- |
| `time`      | TIMESTAMPTZ      | No       | —       | Measurement timestamp                 |
| `topic`     | TEXT             | No       | —       | MQTT topic (e.g., `dev/plc-001/temp`) |
| `value`     | DOUBLE PRECISION | Yes\*    | —       | Numeric measurement value             |
| `value_str` | TEXT             | Yes\*    | —       | String value (device state, etc.)     |
| `quality`   | SMALLINT         | No       | 192     | OPC UA quality code (192=Good)        |
| `metadata`  | JSONB            | No       | `{}`    | device_id, tag_id, unit, timestamps   |

\*At least one of `value` or `value_str` must be non-null (enforced by CHECK constraint).

### Metadata JSONB Structure

```json
{
  "device_id": "plc-001",
  "tag_id": "temperature",
  "unit": "°C",
  "source_ts": "2026-03-15T10:30:00Z",
  "server_ts": "2026-03-15T10:30:00.123Z"
}
```

Fields are optional — only non-empty values are included (see [Chapter 7](writer_internals.md) buildMetadataJSON).

---

## Indexes

```sql
-- Composite index for time-range queries filtered by topic
CREATE INDEX idx_metrics_topic_time ON metrics (topic, time DESC);

-- GIN index for metadata JSONB queries
CREATE INDEX idx_metrics_metadata ON metrics USING GIN (metadata);
```

### Index Usage

| Query Pattern                                     | Index Used               |
| ------------------------------------------------- | ------------------------ |
| `WHERE topic = 'dev/plc-001/temp' AND time > ...` | `idx_metrics_topic_time` |
| `WHERE metadata->>'device_id' = 'plc-001'`        | `idx_metrics_metadata`   |
| `WHERE time > '2026-03-01'` (no topic filter)     | Hypertable time index    |

**Note:** The topic+time index is the primary query path. Most queries filter by topic first, then time range.

---

## Continuous Aggregates

Three materialized views provide pre-computed statistics at different granularities:

### 1-Minute Aggregate

```sql
CREATE MATERIALIZED VIEW metrics_1min
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    topic,
    AVG(value)   AS avg_value,
    MIN(value)   AS min_value,
    MAX(value)   AS max_value,
    COUNT(*)     AS point_count,
    FIRST(value, time) AS first_value,
    LAST(value, time)  AS last_value
FROM metrics
WHERE value IS NOT NULL
GROUP BY bucket, topic;
```

### 1-Hour Aggregate

```sql
CREATE MATERIALIZED VIEW metrics_1hour
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    topic,
    AVG(value) AS avg_value, MIN(value) AS min_value,
    MAX(value) AS max_value, COUNT(*) AS point_count,
    FIRST(value, time) AS first_value, LAST(value, time) AS last_value
FROM metrics
WHERE value IS NOT NULL
GROUP BY bucket, topic;
```

### 1-Day Aggregate

```sql
CREATE MATERIALIZED VIEW metrics_1day
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    topic,
    AVG(value) AS avg_value, MIN(value) AS min_value,
    MAX(value) AS max_value, COUNT(*) AS point_count,
    FIRST(value, time) AS first_value, LAST(value, time) AS last_value
FROM metrics
WHERE value IS NOT NULL
GROUP BY bucket, topic;
```

### Aggregate Columns

| Column        | Type             | Description                     |
| ------------- | ---------------- | ------------------------------- |
| `bucket`      | TIMESTAMPTZ      | Time bucket start               |
| `topic`       | TEXT             | MQTT topic                      |
| `avg_value`   | DOUBLE PRECISION | Average value in bucket         |
| `min_value`   | DOUBLE PRECISION | Minimum value in bucket         |
| `max_value`   | DOUBLE PRECISION | Maximum value in bucket         |
| `point_count` | BIGINT           | Number of raw points in bucket  |
| `first_value` | DOUBLE PRECISION | First value (by time) in bucket |
| `last_value`  | DOUBLE PRECISION | Last value (by time) in bucket  |

---

## Refresh Policies

Continuous aggregates are refreshed on a schedule:

```sql
SELECT add_continuous_aggregate_policy('metrics_1min',
    start_offset  => INTERVAL '3 hours',    -- Look back 3 hours
    end_offset    => INTERVAL '1 minute',   -- Don't aggregate latest 1 min
    schedule_interval => INTERVAL '1 minute' -- Run every 1 minute
);

SELECT add_continuous_aggregate_policy('metrics_1hour',
    start_offset  => INTERVAL '3 days',
    end_offset    => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

SELECT add_continuous_aggregate_policy('metrics_1day',
    start_offset  => INTERVAL '3 months',
    end_offset    => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
);
```

| Aggregate       | Refresh Interval | Lookback | End Offset | Max Staleness |
| --------------- | ---------------- | -------- | ---------- | ------------- |
| `metrics_1min`  | Every 1 minute   | 3 hours  | 1 minute   | ~2 minutes    |
| `metrics_1hour` | Every 1 hour     | 3 days   | 1 hour     | ~2 hours      |
| `metrics_1day`  | Every 1 day      | 3 months | 1 day      | ~2 days       |

---

## Retention Policies

Data is automatically dropped after its retention period:

```sql
SELECT add_retention_policy('metrics',       INTERVAL '30 days');
SELECT add_retention_policy('metrics_1min',  INTERVAL '90 days');
SELECT add_retention_policy('metrics_1hour', INTERVAL '1 year');
SELECT add_retention_policy('metrics_1day',  INTERVAL '5 years');
```

### Data Lifecycle

```
Raw data (metrics):        0 ─── 7 days ─── 30 days ──→ DROPPED
                                    │
                                    └── Compressed at 7 days

1-minute aggregates:       0 ────────── 90 days ──────→ DROPPED

1-hour aggregates:         0 ────────────── 1 year ───→ DROPPED

1-day aggregates:          0 ──────────────── 5 years → DROPPED
```

---

## Compression Policy

```sql
ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'topic',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('metrics', INTERVAL '7 days');
```

| Setting         | Value       | Purpose                                      |
| --------------- | ----------- | -------------------------------------------- |
| `compress`      | enabled     | Enable native TimescaleDB compression        |
| `segmentby`     | `topic`     | Compress per-topic (optimizes topic queries) |
| `orderby`       | `time DESC` | Most recent data first within segments       |
| Policy interval | 7 days      | Compress chunks older than 7 days            |

**Compression ratio:** Typically 10-20x for time-series data with repeating topics and similar values.

---

## Helper Functions

### get_optimal_aggregate

Selects the best table for a given time range:

```sql
CREATE OR REPLACE FUNCTION get_optimal_aggregate(
    start_time TIMESTAMPTZ,
    end_time   TIMESTAMPTZ
) RETURNS TEXT AS $$
BEGIN
    IF end_time - start_time <= INTERVAL '2 hours' THEN
        RETURN 'metrics';           -- Raw data
    ELSIF end_time - start_time <= INTERVAL '7 days' THEN
        RETURN 'metrics_1min';      -- 1-minute aggregates
    ELSIF end_time - start_time <= INTERVAL '90 days' THEN
        RETURN 'metrics_1hour';     -- 1-hour aggregates
    ELSE
        RETURN 'metrics_1day';      -- 1-day aggregates
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### query_metrics

Dynamic query with automatic table selection:

```sql
CREATE OR REPLACE FUNCTION query_metrics(
    topics      TEXT[],
    start_time  TIMESTAMPTZ,
    end_time    TIMESTAMPTZ,
    max_points  INTEGER DEFAULT 1000
) RETURNS TABLE (
    bucket    TIMESTAMPTZ,
    topic     TEXT,
    avg_value DOUBLE PRECISION,
    min_value DOUBLE PRECISION,
    max_value DOUBLE PRECISION
) AS $$
DECLARE
    table_name TEXT;
BEGIN
    table_name := get_optimal_aggregate(start_time, end_time);
    -- Dynamic query against the optimal table
    -- Returns aggregated data with LIMIT max_points
END;
$$ LANGUAGE plpgsql;
```

---

## Database Roles

```sql
-- Ingestion role (this service)
CREATE ROLE nexus_ingestion WITH LOGIN PASSWORD '***';
GRANT CONNECT ON DATABASE nexus_historian TO nexus_ingestion;
GRANT USAGE ON SCHEMA public TO nexus_ingestion;
GRANT INSERT, SELECT ON metrics TO nexus_ingestion;
GRANT SELECT ON metrics_1min, metrics_1hour, metrics_1day TO nexus_ingestion;
GRANT EXECUTE ON FUNCTION get_optimal_aggregate, query_metrics TO nexus_ingestion;

-- Historian role (read-only analytics)
CREATE ROLE nexus_historian WITH LOGIN PASSWORD '***';
GRANT CONNECT ON DATABASE nexus_historian TO nexus_historian;
GRANT SELECT, INSERT ON metrics TO nexus_historian;
GRANT SELECT ON metrics_1min, metrics_1hour, metrics_1day TO nexus_historian;
GRANT EXECUTE ON FUNCTION get_optimal_aggregate, query_metrics TO nexus_historian;
```

**Principle of least privilege:** The ingestion service can INSERT into metrics and SELECT from aggregates. It cannot DROP, ALTER, or modify retention/compression policies.

---

## Storage Estimation

| Rate           | Raw/Day | Compressed/Day | 1min Agg/Day | 1hour Agg/Day |
| -------------- | ------- | -------------- | ------------ | ------------- |
| 1k tags @ 1s   | ~8.6 GB | ~0.5 GB        | ~14 MB       | ~240 KB       |
| 1k tags @ 10s  | ~860 MB | ~50 MB         | ~14 MB       | ~240 KB       |
| 100 tags @ 1s  | ~860 MB | ~50 MB         | ~1.4 MB      | ~24 KB        |
| 100 tags @ 10s | ~86 MB  | ~5 MB          | ~1.4 MB      | ~24 KB        |

Estimates assume ~100 bytes/point raw, 10x compression, 6 aggregate values per bucket.

---

_Previous: [Chapter 15 — Configuration Reference](configuration_reference.md) — Next: [Chapter 17 — Edge Cases & Gotchas](edge_cases.md)_

---

_Document Version: 1.0 — March 2026_
