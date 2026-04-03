# Chapter 3 — Architectural Principles

> Design decisions, trade-offs, and the reasoning behind the service's architecture.

---

## Core Principles

### 1. Stateless Service, Durable Dependencies

The service holds **no persistent state**. All durability is delegated:

| State            | Where It Lives           | Why                                         |
| ---------------- | ------------------------ | ------------------------------------------- |
| Queued messages  | EMQX persistent sessions | Survives pod restarts, auto-redelivery      |
| Historical data  | TimescaleDB hypertable   | ACID, compression, continuous aggregates    |
| In-flight points | pointsChan (memory)      | Ephemeral — graceful shutdown flushes to DB |
| Configuration    | config.yaml + env vars   | Immutable at runtime, version-controlled    |

**Consequence:** Any instance can be killed and replaced without data loss (beyond the 200k in-memory buffer, which is flushed on graceful shutdown).

### 2. COPY Over INSERT

The PostgreSQL COPY protocol streams rows in binary format with minimal per-row overhead. For batch writes of 5,000–10,000 points, COPY is **10-50x faster** than individual INSERT statements.

```
INSERT (5,000 rows):
┌─────────────────────────────────────────────┐
│  • SQL parsing per statement                │
│  • Text format conversion per value         │
│  • Wire protocol overhead per row           │
│  • ~50ms for 5,000 rows                     │
└─────────────────────────────────────────────┘

COPY (5,000 rows):
┌─────────────────────────────────────────────┐
│  • Single COPY statement                    │
│  • Binary/text streaming                    │
│  • Minimal wire overhead                    │
│  • ~5-10ms for 5,000 rows (5-10x faster)    │
└─────────────────────────────────────────────┘
```

The service defaults to COPY but retains a batch-INSERT fallback (`use_copy_protocol: false`) for compatibility with PostgreSQL configurations that restrict COPY.

### 3. Object Pooling with sync.Pool

At 40,000+ messages/sec, allocating a new DataPoint struct per message creates significant GC pressure. Two `sync.Pool` instances eliminate this:

```
dataPointPool                           batchPool
┌───────────────────────┐               ┌───────────────────────────┐
│  Acquire() called in  │               │  AcquireBatchWithCap()    │
│  ParsePayload()       │               │  called in accumulator    │
│                       │               │                           │
│  Release() called in  │               │  ReleaseBatch() called in │
│  ReleaseBatch() after │               │  writerLoop after DB      │
│  DB write completes   │               │  write completes          │
│                       │               │                           │
│  Fields zeroed on     │               │  Releases all contained   │
│  release (no stale    │               │  DataPoints back to their │
│  data leaks)          │               │  pool, resets slice       │
└───────────────────────┘               └───────────────────────────┘
```

**Impact:** GC pauses drop from milliseconds to microseconds under sustained high throughput.

### 4. Backpressure, Not Blocking

The MQTT callback goroutines (managed by Paho) must never block. A blocked callback stalls the entire Paho client, which would halt all topic processing.

**Design:** Non-blocking channel sends with drop counting.

```
handleMessage():
    select {
    case pointsChan <- dp:
        // Success — update buffer gauge
    default:
        // Channel full — drop point, increment counter
        // Log at most once per 5 seconds (rate-limited)
    }
```

This creates a clear **pressure gradient**:

```
Normal:           Backpressure:         Overload:
pointsChan 20%    pointsChan 70%        pointsChan 100%
                  batchChan filling     Points DROPPED
                                        (counted in metrics)

HPA response:     Scale up (buffer     Scale up (drop rate
  none            usage > 0.6)          > 0)
```

### 5. Parallel Writers, Single Accumulator

The pipeline uses a **fan-out** pattern:

```
    1 accumulator goroutine
            │
            ▼
    batchChan (WriterCount × 2)
     ┌──┬──┬──┬──┬──┬──┬──┬──┐
     │  │  │  │  │  │  │  │  │
     ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼
    8 writer goroutines
```

**Why a single accumulator?** Batching requires sequential point accumulation — multiple accumulators would need coordination (mutex, atomic counters) and would produce smaller, less efficient batches.

**Why multiple writers?** Database writes are I/O-bound. A single writer would bottleneck the pipeline at the speed of one COPY operation. Eight writers can execute eight COPY operations concurrently across the pgx connection pool.

### 6. Circuit Breaker on the Write Path

The circuit breaker prevents cascading failure when TimescaleDB is degraded:

```
CLOSED ──(5 consecutive failures)──> OPEN ──(10s)──> HALF-OPEN
  ▲                                                      │
  └──────────(2 test batches succeed)────────────────────┘
```

**Without a breaker:** All 8 writers hold connections waiting for timeout (30s each), exhausting the 20-connection pool. New batches queue in batchChan, then in pointsChan, then drops spike.

**With a breaker:** After 5 failures, all writes are rejected immediately (no connection usage). After 10 seconds, 2 test batches probe the database. If they succeed, normal operation resumes.

### 7. Graceful Shutdown with Data Flush

The shutdown sequence ensures **zero data loss** for in-flight points:

1. **shutdownFlag** prevents new points from entering pointsChan
2. **Subscriber disconnect** stops MQTT message delivery
3. **100ms grace period** drains in-flight Paho callbacks
4. **close(pointsChan)** signals the accumulator to flush and exit
5. **close(batchChan)** signals writers to drain remaining batches
6. **Writers use `context.Background()`** — not the cancelled root context — so in-flight COPY operations complete

**Trade-off:** Shutdown takes up to 30 seconds (timeout). In practice, it completes in <1 second when the database is healthy.

### 8. Clean Session = False

The MQTT subscriber uses `clean_session: false`, which creates a **persistent session** in EMQX:

| Scenario                   | clean_session: true           | clean_session: false (chosen)                                |
| -------------------------- | ----------------------------- | ------------------------------------------------------------ |
| Pod restart (30s downtime) | Messages during downtime lost | Messages queued in EMQX, redelivered on reconnect            |
| EMQX session expiry        | N/A                           | Default 2h — covers most outages                             |
| Multiple instances         | Each gets all messages        | Shared subscription distributes (no duplicates within group) |

**Consequence:** Short outages (pod restart, network blip) cause **zero data loss**. The 200k buffer absorbs the burst of redelivered messages.

---

## Design Decisions Log

| Decision               | Chosen                   | Alternative            | Rationale                                                    |
| ---------------------- | ------------------------ | ---------------------- | ------------------------------------------------------------ |
| Write protocol         | COPY (pgx.CopyFrom)      | Batch INSERT           | 10-50x faster, lower CPU on DB side                          |
| JSON library           | goccy/go-json            | encoding/json          | 2-3x faster unmarshal, drop-in compatible                    |
| MQTT client            | Eclipse Paho v1          | Paho v5, mochi-mqtt    | Mature, shared subscription support, auto-reconnect built-in |
| Circuit breaker        | sony/gobreaker v2        | Custom, resilience-go  | Clean API, generic type support, well-maintained             |
| Logging                | zerolog                  | zap, slog              | Zero-allocation JSON logging, smallest API surface           |
| Config format          | YAML + env var expansion | TOML, env-only, Viper  | Human-readable, ${VAR:default} syntax, no heavy framework    |
| Concurrency model      | Channels + goroutines    | Worker pool library    | Native Go idiom, no external dependency                      |
| Metadata serialization | Manual JSON builder      | json.Marshal           | Avoids map allocation per point, pre-allocates 128 bytes     |
| History query          | Direct pgx query         | Proxy via gateway-core | Lower latency for Grafana, no extra hop                      |

---

_Previous: [Chapter 2 — System Overview](system_overview.md) — Next: [Chapter 4 — Layer Architecture](layer_architecture.md)_

---

_Document Version: 1.0 — March 2026_
