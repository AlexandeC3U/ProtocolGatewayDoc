# Chapter 13 — Performance Tuning

> COPY vs INSERT benchmarks, batch sizing, writer count tuning, buffer sizing, and profile-guided optimization.

---

## COPY vs INSERT

The PostgreSQL COPY protocol is the single largest performance lever:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    COPY vs INSERT — 10,000 rows                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Standard INSERT (pgx.Batch):                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  • Generates 10,000 INSERT statements                               │    │
│  │  • Each parsed, planned, executed by PostgreSQL                     │    │
│  │  • Protocol overhead per statement (prepare, bind, execute)         │    │
│  │  • Time: ~50-100ms                                                  │    │
│  │  • CPU: High (SQL parsing on DB side)                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  COPY Protocol (pgx.CopyFrom):                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  • Single COPY statement                                            │    │
│  │  • Data streamed in binary/text format                              │    │
│  │  • Minimal per-row protocol overhead                                │    │
│  │  • Time: ~5-10ms (10-50x faster)                                    │    │
│  │  • CPU: Low (bulk load path in PostgreSQL)                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  At 40k msg/s with 10k batches:                                             │
│  ├── INSERT: 4 batches/s → 40ms spent writing → 16% writer utilization      │
│  ├── COPY:   4 batches/s → 4ms spent writing  →  1.6% writer utilization    │
│  └── The difference defines how many writers you need                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**When to use INSERT fallback:**

- PostgreSQL user lacks COPY permission (restricted environments)
- Debugging individual row errors (INSERT gives per-row error detail)
- Never in production if COPY is available

---

## Batch Size Tuning

Batch size controls the trade-off between latency and throughput:

```
Batch Size    Write Time     Throughput        Latency Impact
──────────    ──────────     ──────────        ──────────────
100           ~1ms           Low               Minimal (flushes fast)
1,000         ~2ms           Moderate          Low
5,000         ~5ms           Good              Moderate
10,000        ~8ms           Optimal           Moderate (default)
20,000        ~15ms          Diminishing       Higher
50,000        ~40ms          Marginal gains    Significant
```

### Sweet Spot Analysis

```
Throughput (msg/s)
    │
80k │                          ┌──────────────────
    │                     ┌────┘
60k │                ┌────┘
    │           ┌────┘
40k │      ┌────┘
    │ ┌────┘
20k │─┘
    │
    └──────┬──────┬──────┬──────┬──────┬──────
         100   1000   5000  10000  20000 50000
                    Batch Size

    The curve flattens around 10,000. Larger batches
    add latency without proportional throughput gains.
```

**Recommendation:** Start with 10,000 (default). Only increase if:

- You need maximum throughput and can tolerate higher latency
- TimescaleDB is I/O-bound (larger batches amortize fsync overhead)
- You have very few tags (small metadata, compression-friendly)

---

## Writer Count Tuning

Writers are the fan-out stage. More writers = more concurrent COPY operations:

| Writers | Concurrent DB Ops | Throughput | Connection Usage | CPU Impact |
| ------- | ----------------- | ---------- | ---------------- | ---------- |
| 2       | 2                 | ~20k msg/s | 2/20 conns       | Low        |
| 4       | 4                 | ~35k msg/s | 4/20 conns       | Low        |
| 8       | 8                 | ~50k msg/s | 8/20 conns       | Moderate   |
| 12      | 12                | ~60k msg/s | 12/20 conns      | Higher     |
| 16      | 16                | ~65k msg/s | 16/20 conns      | High       |

**Diminishing returns above 8 writers** because:

1. DB-side lock contention on hypertable chunks increases
2. Context switching overhead on the Go runtime
3. Connection pool contention (20 conns shared across writers + history queries)

**Rule of thumb:** `writer_count ≈ pool_size / 3` leaves capacity for retries and history queries.

---

## Buffer Size Tuning

The pointsChan buffer absorbs bursts between MQTT and the batcher:

| Buffer Size | Memory  | Buffer Time @ 40k/s | Use Case                |
| ----------- | ------- | ------------------- | ----------------------- |
| 10,000      | ~80 KB  | 0.25s               | Low-latency, no bursts  |
| 50,000      | ~400 KB | 1.25s               | README default (legacy) |
| 200,000     | ~1.6 MB | 5s                  | Production default      |
| 500,000     | ~4 MB   | 12.5s               | High-burst environments |
| 1,000,000   | ~8 MB   | 25s                 | Extreme burst tolerance |

**When to increase:**

- Frequent drops in metrics (`points_dropped_total > 0`)
- Bursty traffic (shift changes, batch process starts)
- MQTT reconnect causing message redelivery bursts

**When to decrease:**

- Memory-constrained edge device
- Low throughput (<1k msg/s) — no need for large buffer

---

## Tuning Profiles

### Low Latency (Real-Time Monitoring)

```yaml
ingestion:
  buffer_size: 10000
  batch_size: 100
  flush_interval: 10ms
  writer_count: 2
```

- Points reach DB within ~10ms
- Lower throughput (~10k msg/s)
- More DB operations (small batches)

### High Throughput (Bulk Collection)

```yaml
ingestion:
  buffer_size: 500000
  batch_size: 20000
  flush_interval: 500ms
  writer_count: 12
database:
  pool_size: 30
```

- Maximum write efficiency
- Higher latency (up to 500ms)
- ~80k+ msg/s per instance

### Balanced (Default)

```yaml
ingestion:
  buffer_size: 200000
  batch_size: 10000
  flush_interval: 250ms
  writer_count: 8
database:
  pool_size: 20
```

- Good trade-off for most deployments
- ~35-50k msg/s per instance
- 250ms maximum latency

---

## Database-Side Tuning

The service performance is bounded by TimescaleDB. Key DB parameters:

| Parameter              | Default | Tuned      | Impact                                                |
| ---------------------- | ------- | ---------- | ----------------------------------------------------- |
| `shared_buffers`       | 128MB   | 25% of RAM | More data cached in memory                            |
| `work_mem`             | 4MB     | 16-64MB    | Faster sorts/aggregates                               |
| `effective_cache_size` | 4GB     | 75% of RAM | Better query planning                                 |
| `max_connections`      | 100     | 200        | Support more ingestion pods                           |
| `wal_level`            | replica | minimal\*  | Faster writes (no WAL replication)                    |
| `synchronous_commit`   | on      | off\*      | 2-3x write speed (risk: last ~200ms of data on crash) |
| `checkpoint_timeout`   | 5min    | 15min      | Less frequent checkpoints                             |

\*Only for edge deployments without replication. Production with HA requires WAL.

### Chunk Interval

TimescaleDB partitions data into time-based chunks. The default is 1 day:

```sql
SELECT create_hypertable('metrics', 'time', chunk_time_interval => INTERVAL '1 day');
```

For high-throughput deployments (>100k msg/s), consider smaller chunks:

- 1 hour: Better for compression, but more chunks to manage
- 6 hours: Good balance for >50k msg/s workloads

---

## Profiling

### pprof (Runtime Profiling)

Enable in config:

```yaml
http:
  enablePprof: true
```

Access at `http://localhost:8081/debug/pprof/`:

```bash
# CPU profile (30 seconds)
go tool pprof http://localhost:8081/debug/pprof/profile?seconds=30

# Heap profile
go tool pprof http://localhost:8081/debug/pprof/heap

# Goroutine dump
curl http://localhost:8081/debug/pprof/goroutine?debug=2
```

### Key Things to Profile

| Symptom        | Profile        | What to Look For                        |
| -------------- | -------------- | --------------------------------------- |
| High CPU       | CPU profile    | JSON parsing hot path, GC overhead      |
| Memory growth  | Heap profile   | DataPoint leaks, batch not released     |
| Goroutine leak | Goroutine dump | Writers stuck on DB timeout             |
| High GC pause  | Heap profile   | sync.Pool not being used (direct alloc) |

### GOGC and GOMEMLIMIT

```bash
# Reduce GC frequency (default 100)
GOGC=200  # GC triggers at 2x heap size — fewer pauses, more memory

# Set memory limit (Go 1.19+)
GOMEMLIMIT=400MiB  # Hard limit — GC becomes more aggressive near limit
```

For high-throughput:

- `GOGC=200` reduces GC frequency (sync.Pool effectiveness increases)
- `GOMEMLIMIT=400MiB` with 512Mi container limit leaves headroom

---

_Previous: [Chapter 12 — Deployment](deployment.md) — Next: [Chapter 14 — Testing Strategy](testing_strategy.md)_

---

_Document Version: 1.0 — March 2026_
