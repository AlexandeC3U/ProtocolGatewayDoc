# Chapter 7 — Writer Internals

> COPY protocol mechanics, pgx pool management, circuit breaker, retry with backoff, and metadata serialization.

---

## Write Path Overview

```
WriteBatch(ctx, batch)
        │
        ▼
┌──────────────────────────────────────────┐
│  Circuit Breaker (sony/gobreaker)        │
│                                          │
│  State: CLOSED → OPEN → HALF-OPEN        │
│  If OPEN: return ErrOpenState immediately│
│  If CLOSED/HALF-OPEN: proceed to retry   │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  writeBatchWithRetry                     │
│                                          │
│  attempt 0: immediate                    │
│  attempt 1: 100ms backoff                │
│  attempt 2: 200ms backoff                │
│  attempt 3: 400ms backoff (max 5s)       │
│                                          │
│  Only retries transient errors           │
└──────────────┬───────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│  writeBatchCopy() or writeBatchInsert()  │
│                                          │
│  COPY: pgx.CopyFrom (10-50x faster)      │
│  INSERT: pgx.Batch (compatible fallback) │
└──────────────┬───────────────────────────┘
               │
               ▼
         TimescaleDB
```

---

## Circuit Breaker

The circuit breaker prevents connection pool exhaustion when TimescaleDB is degraded or unreachable.

```
                    5 consecutive
         CLOSED ────failures────> OPEN
           ▲                        │
           │                        │ 10 seconds
           │                        │
           │                        ▼
           └──2 test batches──── HALF-OPEN
              succeed
```

**Configuration:**

| Parameter   | Value | Meaning                                                 |
| ----------- | ----- | ------------------------------------------------------- |
| MaxRequests | 2     | Allow 2 test batches in half-open state                 |
| Interval    | 30s   | Reset consecutive failure count if no new failures      |
| Timeout     | 10s   | Duration to stay OPEN before transitioning to HALF-OPEN |
| ReadyToTrip | 5     | Consecutive failures before opening                     |

**State change logging:**

```go
OnStateChange: func(name string, from, to gobreaker.State) {
    logger.Warn().
        Str("from", from.String()).
        Str("to", to.String()).
        Msg("Circuit breaker state change")
    // Update Prometheus gauge: 0=closed, 1=half-open, 2=open
    metrics.SetCircuitBreakerState(to.String())
}
```

**Why not per-writer breakers?** All writers share the same pgxpool targeting the same TimescaleDB instance. If the database is down, all connections are affected equally. A single shared breaker is the correct granularity.

---

## Retry with Exponential Backoff

```go
func (w *Writer) writeBatchWithRetry(ctx context.Context, batch *domain.Batch) (interface{}, error) {
    start := time.Now()
    var lastErr error

    for attempt := 0; attempt <= w.config.MaxRetries; attempt++ {
        if attempt > 0 {
            delay := w.calculateBackoff(attempt)
            select {
            case <-ctx.Done():
                return nil, ctx.Err()
            case <-time.After(delay):
            }
            w.retriesTotal.Add(1)
            w.metrics.IncRetries()
        }

        if w.config.UseCopyProtocol {
            lastErr = w.writeBatchCopy(ctx, batch)
        } else {
            lastErr = w.writeBatchInsert(ctx, batch)
        }

        if lastErr == nil {
            break
        }
        if !isRetryableError(lastErr) {
            break  // Non-transient — no point retrying
        }
    }

    // Record metrics...
    return nil, lastErr
}
```

### Backoff Calculation

```go
func (w *Writer) calculateBackoff(attempt int) time.Duration {
    delay := w.config.RetryDelay * time.Duration(1<<uint(attempt-1))
    if delay > 5*time.Second {
        delay = 5 * time.Second  // Hard cap
    }
    return delay
}
```

| Attempt | Delay         | Total Elapsed |
| ------- | ------------- | ------------- |
| 0       | 0 (immediate) | 0             |
| 1       | 100ms         | 100ms         |
| 2       | 200ms         | 300ms         |
| 3       | 400ms         | 700ms         |
| 4\*     | 800ms         | 1.5s          |

\*Default MaxRetries=3, so attempt 4 is not reached unless configured higher.

---

## Error Classification

`isRetryableError()` determines whether a failed write should be retried:

### PostgreSQL Errors (pgconn.PgError)

Classified by SQLSTATE class (first two characters):

| SQLSTATE Class | Meaning                | Retryable | Rationale                                 |
| -------------- | ---------------------- | --------- | ----------------------------------------- |
| `08`           | Connection exception   | Yes       | Connection lost, broker restarted         |
| `40`           | Transaction rollback   | Yes       | Serialization conflict, deadlock          |
| `53`           | Insufficient resources | Yes       | Temp out of memory, disk full             |
| `57`           | Operator intervention  | Yes       | DB in recovery, admin kill                |
| Other          | All other errors       | No        | Constraint violations, syntax — permanent |

### Non-PostgreSQL Errors (string matching)

| Error String Contains  | Retryable | Rationale                          |
| ---------------------- | --------- | ---------------------------------- |
| `"connection refused"` | Yes       | TimescaleDB not accepting connects |
| `"connection reset"`   | Yes       | TCP connection dropped             |
| `"timeout"`            | Yes       | Network or DB timeout              |
| `"i/o timeout"`        | Yes       | I/O deadline exceeded              |
| `"pool closed"`        | Yes       | Connection pool shutting down      |
| `"too many clients"`   | Yes       | Connection limit reached           |
| `"broken pipe"`        | Yes       | Connection severed                 |
| Other                  | No        | Unknown — treat as permanent       |

---

## COPY Protocol (writeBatchCopy)

The primary write path using PostgreSQL's COPY protocol:

```go
func (w *Writer) writeBatchCopy(ctx context.Context, batch *domain.Batch) error {
    writeCtx, cancel := context.WithTimeout(ctx, w.config.WriteTimeout)
    defer cancel()

    _, err := w.pool.CopyFrom(
        writeCtx,
        pgx.Identifier{"metrics"},
        []string{"time", "topic", "value", "value_str", "quality", "metadata"},
        pgx.CopyFromSlice(len(batch.Points), func(i int) ([]any, error) {
            dp := batch.Points[i]
            return []any{
                dp.Timestamp,
                dp.Topic,
                dp.Value,         // *float64 (nil allowed)
                dp.ValueStr,      // *string (nil allowed)
                dp.Quality,
                w.buildMetadataJSON(dp),
            }, nil
        }),
    )
    return err
}
```

**Column mapping:**

| Column      | Type             | Source                | Notes                               |
| ----------- | ---------------- | --------------------- | ----------------------------------- |
| `time`      | TIMESTAMPTZ      | `dp.Timestamp`        | Required, validated                 |
| `topic`     | TEXT             | `dp.Topic`            | MQTT topic string                   |
| `value`     | DOUBLE PRECISION | `dp.Value`            | nil if string value                 |
| `value_str` | TEXT             | `dp.ValueStr`         | nil if numeric value                |
| `quality`   | SMALLINT         | `dp.Quality`          | OPC UA quality code (0-192)         |
| `metadata`  | JSONB            | `buildMetadataJSON()` | device_id, tag_id, unit, timestamps |

---

## Metadata JSON Builder

Instead of using `json.Marshal` with a `map[string]interface{}` (which allocates a map per point), the writer builds JSON bytes directly:

```go
func (w *Writer) buildMetadataJSON(dp *domain.DataPoint) []byte {
    buf := make([]byte, 0, 128)  // Pre-allocate 128 bytes
    buf = append(buf, '{')

    if dp.DeviceID != "" {
        buf = append(buf, `"device_id":"`...)
        buf = append(buf, dp.DeviceID...)
        buf = append(buf, '"')
    }
    if dp.TagID != "" {
        if len(buf) > 1 { buf = append(buf, ',') }
        buf = append(buf, `"tag_id":"`...)
        buf = append(buf, dp.TagID...)
        buf = append(buf, '"')
    }
    if dp.Unit != "" {
        if len(buf) > 1 { buf = append(buf, ',') }
        buf = append(buf, `"unit":"`...)
        buf = append(buf, dp.Unit...)
        buf = append(buf, '"')
    }
    // source_ts and server_ts appended similarly (RFC3339 format)

    buf = append(buf, '}')
    return buf
}
```

**Output example:**

```json
{
  "device_id": "plc-001",
  "tag_id": "temperature",
  "unit": "°C",
  "source_ts": "2026-03-15T10:30:00Z"
}
```

**Why manual JSON?** At 40k+ points/sec with 8 writers, avoiding `map[string]interface{}` allocation per point measurably reduces GC pressure. The pre-allocated 128-byte buffer covers most metadata without reallocation.

---

## Batch INSERT (Fallback)

When `use_copy_protocol: false`, the writer uses pgx.Batch for multi-statement INSERT:

```go
func (w *Writer) writeBatchInsert(ctx context.Context, batch *domain.Batch) error {
    writeCtx, cancel := context.WithTimeout(ctx, w.config.WriteTimeout)
    defer cancel()

    pgxBatch := &pgx.Batch{}
    for _, dp := range batch.Points {
        pgxBatch.Queue(
            `INSERT INTO metrics (time, topic, value, value_str, quality, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            dp.Timestamp, dp.Topic, dp.Value, dp.ValueStr, dp.Quality,
            w.buildMetadataJSON(dp),
        )
    }

    br := w.pool.SendBatch(writeCtx, pgxBatch)
    defer br.Close()

    for i := 0; i < len(batch.Points); i++ {
        if _, err := br.Exec(); err != nil {
            return err  // Fails on first error
        }
    }
    return nil
}
```

**When to use INSERT fallback:**

- PostgreSQL configured to disallow COPY (e.g., restricted permissions)
- Debugging — INSERT errors are more descriptive per-row
- Never in production — COPY is 10-50x faster

---

## Connection Pool (pgxpool)

```go
poolConfig, _ := pgxpool.ParseConfig(dsn)
poolConfig.MaxConns = int32(config.PoolSize)       // Default: 20
poolConfig.MaxConnIdleTime = config.MaxIdleTime     // Default: 5m
```

**DSN format (key-value, not URL):**

```
host=timescaledb port=5432 dbname=nexus_historian user=nexus_ingestion password=*** connect_timeout=10
```

Key-value format is used instead of URL to avoid issues with special characters in passwords.

### Pool Stats (exposed via `/status`)

```json
{
  "pool_total_conns": 20,
  "pool_idle_conns": 14,
  "pool_acquired": 6
}
```

| Stat          | Meaning                                    |
| ------------- | ------------------------------------------ |
| `total_conns` | Total connections in pool (up to PoolSize) |
| `idle_conns`  | Connections available for checkout         |
| `acquired`    | Connections currently in use by writers    |

---

## Writer Stats

```json
{
  "batches_written": 15234,
  "points_written": 152340000,
  "write_errors": 3,
  "retries_total": 7,
  "avg_write_time_ms": 8.5,
  "pool_total_conns": 20,
  "pool_idle_conns": 14,
  "pool_acquired": 6
}
```

`avg_write_time_ms` is calculated as `totalWriteTime / batchesWritten`, providing a running average of batch write latency.

---

_Previous: [Chapter 6 — Pipeline Architecture](pipeline_architecture.md) — Next: [Chapter 8 — MQTT Subscriber](mqtt_subscriber.md)_

---

_Document Version: 1.0 — March 2026_
