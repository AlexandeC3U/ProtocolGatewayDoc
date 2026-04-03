# Chapter 7 — TimescaleDB Operations

> Hypertable design, continuous aggregates, compression policies, retention
> management, smart query routing, and performance tuning.

---

## Overview

TimescaleDB 2.13 extends PostgreSQL 15 with time-series superpowers. It stores
all industrial telemetry in NEXUS Edge — raw metrics, pre-computed aggregates,
and compressed historical data.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TIMESCALEDB DATA LIFECYCLE                                   │
│                                                                                 │
│  Data Ingestion ──INSERT──> metrics (hypertable)                                │
│                              │                                                  │
│                              ├── Continuous Aggregates (background)             │
│                              │   ├── metrics_1min   (1-minute buckets)          │
│                              │   ├── metrics_1hour  (1-hour buckets)            │
│                              │   └── metrics_1day   (1-day buckets)             │
│                              │                                                  │
│                              ├── Compression (after 7 days)                     │
│                              │   └── ~90% storage reduction                     │
│                              │                                                  │
│                              └── Retention (drop old chunks)                    │
│                                  ├── Raw: 30 days                               │
│                                  ├── 1min: 90 days                              │
│                                  ├── 1hour: 1 year                              │
│                                  └── 1day: 5 years                              │
│                                                                                 │
│  Grafana / API ──SELECT──> get_optimal_aggregate() ──> best resolution          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Hypertable: metrics

### Schema

```sql
CREATE TABLE metrics (
    time        TIMESTAMPTZ NOT NULL,
    topic       TEXT NOT NULL,          -- MQTT topic (dev/{deviceId}/{tagName})
    value       DOUBLE PRECISION,       -- Numeric values
    value_str   TEXT,                   -- String values (non-numeric types)
    quality     INTEGER DEFAULT 192,    -- OPC UA quality code (192 = Good)
    metadata    JSONB DEFAULT '{}'      -- Extensible metadata
);

SELECT create_hypertable('metrics', 'time',
    chunk_time_interval => INTERVAL '1 day'
);
```

### Design Decisions

| Decision           | Choice                | Why                                                     |
| ------------------ | --------------------- | ------------------------------------------------------- |
| Chunk interval     | 1 day                 | Balances query performance vs chunk management overhead |
| Topic as text      | Not normalized        | Avoids JOIN overhead on high-frequency writes           |
| Dual value columns | `value` + `value_str` | Supports both numeric and string tag types              |
| Quality code       | OPC UA standard       | 192 = Good, enables quality-aware aggregation           |
| JSONB metadata     | Extensible            | Future: units, source, batch ID without schema changes  |

### Indexes

```sql
-- Primary lookup: time-range queries filtered by topic
CREATE INDEX idx_metrics_topic_time ON metrics (topic, time DESC);

-- Topic-only queries (tag listing, latest value)
CREATE INDEX idx_metrics_topic ON metrics (topic);
```

TimescaleDB automatically creates a B-tree index on `time` for each chunk.
The composite `(topic, time DESC)` index covers the most common query pattern:
"get values for topic X between time A and B."

---

## Continuous Aggregates

Three materialized views pre-compute statistics at increasing granularity:

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
    COUNT(*)     AS sample_count
FROM metrics
GROUP BY bucket, topic
WITH NO DATA;

-- Refresh policy: runs every 1 minute, materializes data older than 2 minutes
SELECT add_continuous_aggregate_policy('metrics_1min',
    start_offset    => INTERVAL '1 hour',
    end_offset      => INTERVAL '2 minutes',
    schedule_interval => INTERVAL '1 minute'
);
```

### 1-Hour Aggregate

```sql
CREATE MATERIALIZED VIEW metrics_1hour
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    topic,
    AVG(value)   AS avg_value,
    MIN(value)   AS min_value,
    MAX(value)   AS max_value,
    COUNT(*)     AS sample_count
FROM metrics
GROUP BY bucket, topic
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_1hour',
    start_offset    => INTERVAL '1 day',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);
```

### 1-Day Aggregate

```sql
CREATE MATERIALIZED VIEW metrics_1day
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    topic,
    AVG(value)   AS avg_value,
    MIN(value)   AS min_value,
    MAX(value)   AS max_value,
    COUNT(*)     AS sample_count
FROM metrics
GROUP BY bucket, topic
WITH NO DATA;

SELECT add_continuous_aggregate_policy('metrics_1day',
    start_offset    => INTERVAL '7 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day'
);
```

### Aggregate Selection Guide

| Query Time Range   | Best Aggregate  | Approximate Points    |
| ------------------ | --------------- | --------------------- |
| < 2 hours          | Raw `metrics`   | Up to 7,200 (1s poll) |
| 2 hours – 24 hours | `metrics_1min`  | 60 – 1,440            |
| 1 day – 30 days    | `metrics_1hour` | 24 – 720              |
| > 30 days          | `metrics_1day`  | 30 – 1,825            |

---

## Smart Query Routing

Two helper functions route queries to the optimal data source automatically:

### get_optimal_aggregate()

```sql
CREATE OR REPLACE FUNCTION get_optimal_aggregate(
    query_start TIMESTAMPTZ,
    query_end   TIMESTAMPTZ
) RETURNS TEXT AS $$
DECLARE
    duration INTERVAL;
BEGIN
    duration := query_end - query_start;
    IF duration <= INTERVAL '2 hours' THEN
        RETURN 'metrics';
    ELSIF duration <= INTERVAL '24 hours' THEN
        RETURN 'metrics_1min';
    ELSIF duration <= INTERVAL '30 days' THEN
        RETURN 'metrics_1hour';
    ELSE
        RETURN 'metrics_1day';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

### query_metrics()

```sql
CREATE OR REPLACE FUNCTION query_metrics(
    query_topic TEXT,
    query_start TIMESTAMPTZ,
    query_end   TIMESTAMPTZ,
    query_limit INTEGER DEFAULT 1000
) RETURNS TABLE (
    bucket      TIMESTAMPTZ,
    avg_value   DOUBLE PRECISION,
    min_value   DOUBLE PRECISION,
    max_value   DOUBLE PRECISION,
    sample_count BIGINT
) AS $$
DECLARE
    agg_table TEXT;
BEGIN
    agg_table := get_optimal_aggregate(query_start, query_end);

    IF agg_table = 'metrics' THEN
        RETURN QUERY
            SELECT time AS bucket, value AS avg_value,
                   value AS min_value, value AS max_value,
                   1::BIGINT AS sample_count
            FROM metrics
            WHERE topic = query_topic
              AND time BETWEEN query_start AND query_end
            ORDER BY time DESC LIMIT query_limit;
    ELSE
        RETURN QUERY EXECUTE format(
            'SELECT bucket, avg_value, min_value, max_value, sample_count
             FROM %I WHERE topic = $1 AND bucket BETWEEN $2 AND $3
             ORDER BY bucket DESC LIMIT $4',
            agg_table
        ) USING query_topic, query_start, query_end, query_limit;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;
```

**Usage from Grafana:**

```sql
SELECT * FROM query_metrics('dev/plc-1/temperature', $__timeFrom(), $__timeTo(), 500);
```

This eliminates the need for Grafana dashboards to know which aggregate to query —
the function picks the right one based on the selected time range.

---

## Compression

### Policy

```sql
ALTER TABLE metrics SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'topic',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('metrics', INTERVAL '7 days');
```

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    COMPRESSION MECHANICS                                        │
│                                                                                 │
│  Before compression (chunk for 2026-03-10):                                     │
│  ┌──────────────────────────────────────────────────────────────────┐           │
│  │ time                  │ topic              │ value  │ quality    │           │
│  │ 2026-03-10 00:00:01   │ dev/plc-1/temp     │ 23.5   │ 192        │           │
│  │ 2026-03-10 00:00:01   │ dev/plc-1/pressure │ 101.3  │ 192        │           │
│  │ 2026-03-10 00:00:02   │ dev/plc-1/temp     │ 23.6   │ 192        │           │
│  │ ... (millions of rows per chunk)                                 │           │
│  └──────────────────────────────────────────────────────────────────┘           │
│                                                                                 │
│  After compression:                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐           │
│  │ Segment: dev/plc-1/temp                                          │           │
│  │ time: [compressed array of timestamps]                           │           │
│  │ value: [compressed array of floats]       ~90% size reduction    │           │
│  │ quality: [compressed array of integers]                          │           │
│  ├──────────────────────────────────────────────────────────────────┤           │
│  │ Segment: dev/plc-1/pressure                                      │           │
│  │ time: [compressed array of timestamps]                           │           │
│  │ value: [compressed array of floats]                              │           │
│  └──────────────────────────────────────────────────────────────────┘           │
│                                                                                 │
│  segmentby = 'topic'  → Each topic compressed independently                     │
│  orderby = 'time DESC' → Optimized for "most recent first" queries              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Compression Stats

```sql
-- Check compression ratio
SELECT
    pg_size_pretty(before_compression_total_bytes) AS before,
    pg_size_pretty(after_compression_total_bytes)  AS after,
    ROUND((1 - after_compression_total_bytes::numeric /
           before_compression_total_bytes::numeric) * 100, 1) AS ratio_pct
FROM hypertable_compression_stats('metrics');
```

---

## Retention Policies

### Policy Definitions

```sql
-- Raw metrics: keep 30 days
SELECT add_retention_policy('metrics', INTERVAL '30 days');

-- 1-minute aggregates: keep 90 days
SELECT add_retention_policy('metrics_1min', INTERVAL '90 days');

-- 1-hour aggregates: keep 1 year
SELECT add_retention_policy('metrics_1hour', INTERVAL '1 year');

-- 1-day aggregates: keep 5 years
SELECT add_retention_policy('metrics_1day', INTERVAL '5 years');
```

### Retention Cascade

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DATA RETENTION TIMELINE                                      │
│                                                                                 │
│  ◄── 5 years ──────────────────────────────────────────────────────────────►    │
│  │                                                                              │
│  │  ◄── 1 year ───────────────────────────────────────►                         │
│  │  │                                                                           │
│  │  │  ◄── 90 days ──────────────────►                                          │
│  │  │  │                                                                        │
│  │  │  │  ◄── 30 days ──────►                                                   │
│  │  │  │  │                                                                     │
│  │  │  │  │  ◄─ 7 days ─►                                                       │
│  │  │  │  │  │           │                                                      │
│  │  │  │  │  │ Uncompr.  │           NOW                                        │
│  │  │  │  │  │           │            │                                         │
│  │  │  │  │  ├───────────┤            │                                         │
│  │  │  │  │  Compressed               │                                         │
│  │  │  │  ├───────────────────────────┤  Raw metrics (30d)                      │
│  │  │  ├──────────────────────────────┤  1-min aggregates (90d)                 │
│  │  ├─────────────────────────────────┤  1-hour aggregates (1y)                 │
│  ├────────────────────────────────────┤  1-day aggregates (5y)                  │
│                                                                                 │
│  Storage impact:                                                                │
│  • Raw (30d, 1s poll, 1000 tags): ~50GB uncompressed, ~5GB compressed           │
│  • 1-min (90d, 1000 tags): ~130M rows, ~2GB                                     │
│  • 1-hour (1y, 1000 tags): ~8.7M rows, ~200MB                                   │
│  • 1-day (5y, 1000 tags): ~1.8M rows, ~50MB                                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Roles

```sql
-- Read-only role for Grafana and API queries
CREATE ROLE nexus_historian WITH LOGIN PASSWORD '...';
GRANT SELECT ON metrics, metrics_1min, metrics_1hour, metrics_1day TO nexus_historian;
GRANT EXECUTE ON FUNCTION get_optimal_aggregate TO nexus_historian;
GRANT EXECUTE ON FUNCTION query_metrics TO nexus_historian;

-- Write role for Data Ingestion service
CREATE ROLE nexus_ingestion WITH LOGIN PASSWORD '...';
GRANT INSERT, SELECT ON metrics TO nexus_ingestion;
GRANT SELECT ON metrics_1min, metrics_1hour, metrics_1day TO nexus_ingestion;
```

| Role              |  Can INSERT  |       Can SELECT       | Used By                   |
| ----------------- | :----------: | :--------------------: | ------------------------- |
| `nexus_ingestion` | metrics only |       All tables       | Data Ingestion service    |
| `nexus_historian` |      —       | All tables + functions | Grafana, Gateway Core API |
| `postgres`        |     All      |          All           | Admin, migrations         |

---

## Performance Tuning

### PostgreSQL Parameters

Set via `docker compose` command args or K8s StatefulSet:

| Parameter                  | Value       | Purpose                             |
| -------------------------- | ----------- | ----------------------------------- |
| `shared_buffers`           | 1GB         | ~25% of available RAM for caching   |
| `effective_cache_size`     | 3GB         | ~75% of RAM, guides query planner   |
| `work_mem`                 | 64MB        | Per-sort/hash memory (aggregations) |
| `maintenance_work_mem`     | 512MB       | VACUUM, compression, index creation |
| `max_connections`          | 200         | Pool size headroom                  |
| `shared_preload_libraries` | timescaledb | Required for TimescaleDB extension  |

### Write Optimization

Data Ingestion uses PostgreSQL COPY protocol for bulk writes:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    COPY vs INSERT PERFORMANCE                                   │
│                                                                                 │
│  Method          Rows/sec    Overhead                                           │
│  ──────────────  ─────────   ────────────────────────────────────────────────   │
│  INSERT (1 row)  ~5,000      Parse → Plan → Execute per row                     │
│  INSERT (batch)  ~50,000     One parse, multiple value tuples                   │
│  COPY protocol   ~200,000    Binary stream, minimal parsing, no planning        │
│                                                                                 │
│  Data Ingestion config:                                                         │
│  • Buffer: 200,000 messages                                                     │
│  • Batch size: 10,000 rows per COPY                                             │
│  • Flush interval: 250ms                                                        │
│  • Writers: 8 concurrent                                                        │
│  • Effective throughput: ~500,000 rows/sec (8 writers × ~62,500)                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Monitoring Queries

### Chunk Information

```sql
-- List chunks with sizes
SELECT
    chunk_name,
    pg_size_pretty(total_bytes) AS size,
    is_compressed
FROM timescaledb_information.chunks
WHERE hypertable_name = 'metrics'
ORDER BY range_start DESC
LIMIT 10;
```

### Active Policies

```sql
-- View all automated policies
SELECT * FROM timescaledb_information.jobs
WHERE application_name LIKE '%policy%'
ORDER BY schedule_interval;
```

### Aggregate Freshness

```sql
-- Check how current each aggregate is
SELECT
    view_name,
    completed_threshold
FROM timescaledb_information.continuous_aggregate_stats;
```

### Storage Breakdown

```sql
-- Total hypertable sizes
SELECT
    hypertable_name,
    pg_size_pretty(hypertable_size(format('%I.%I', hypertable_schema, hypertable_name)::regclass))
FROM timescaledb_information.hypertables;
```

---

## Kubernetes StatefulSet

In K8s, TimescaleDB runs as a StatefulSet with:

- **Init containers**: Permission fix (`chown 999:999`) + script copy
- **Sidecar**: postgres_exporter (port 9187) for Prometheus metrics
- **Probes**: `pg_isready` for liveness and readiness
- **Storage**: 5Gi (dev) / 500Gi (prod) via PVC
- **Image**: `timescale/timescaledb:2.13.1-pg16`

```yaml
# Key resource allocation
resources:
  requests:
    cpu: 500m
    memory: 2Gi
  limits:
    cpu: 4000m
    memory: 8Gi
```

---

## Related Documentation

- [PostgreSQL Architecture](postgresql_architecture.md) — config DB, two-database rationale
- [Docker Compose](docker_compose.md) — TimescaleDB container configuration
- [Backup & Recovery](backup_recovery.md) — database backup procedures
- [Scaling Playbook](scaling_playbook.md) — storage capacity planning
- [Configuration Reference](configuration_reference.md) — database environment variables

---

_Document Version: 1.0_
_Last Updated: March 2026_
