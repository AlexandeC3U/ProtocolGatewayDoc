# Chapter 10 — Observability

> Prometheus metrics, structured logging, health endpoints, and alerting rules.

---

## Metrics Overview

The service exposes 13 Prometheus metrics, accessible at `GET :8081/metrics`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PROMETHEUS METRICS                                    │
│                                                                             │
│  Counters (8):                    Gauges (4):            Histogram (1):     │
│  ├── points_received_total        ├── buffer_usage        batch_duration_   │
│  ├── points_dropped_total         ├── lag_seconds         seconds           │
│  ├── points_written_total         ├── batch_queue_depth                     │
│  ├── parse_errors_total           └── circuit_breaker_                      │
│  ├── write_errors_total               state                                 │
│  ├── batches_flushed_total                                                  │
│  ├── write_retries_total                                                    │
│  └── mqtt_reconnects_total                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Counter Metrics

| Metric                                 | Description                                 | When Incremented                            |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `data_ingestion_points_received_total` | Total MQTT messages successfully parsed     | Every message that passes validation        |
| `data_ingestion_points_dropped_total`  | Points dropped due to full buffer           | Non-blocking send fails (channel full)      |
| `data_ingestion_points_written_total`  | Points successfully written to TimescaleDB  | After each successful COPY/INSERT batch     |
| `data_ingestion_parse_errors_total`    | JSON parse or validation failures           | Payload too large, bad JSON, timestamp skew |
| `data_ingestion_write_errors_total`    | Database write failures (after all retries) | All retry attempts exhausted                |
| `data_ingestion_batches_flushed_total` | Batches flushed from accumulator            | Batch full, timer, or shutdown flush        |
| `data_ingestion_write_retries_total`   | Retry attempts on transient DB errors       | Each retry (not initial attempt)            |
| `data_ingestion_mqtt_reconnects_total` | MQTT reconnection events                    | Paho reconnects (not initial connection)    |

### Key Ratios

| Ratio                            | Healthy | Concerning                |
| -------------------------------- | ------- | ------------------------- |
| `dropped / received`             | 0%      | >0% (data loss occurring) |
| `written / received`             | ~100%   | <99% (investigate lag)    |
| `write_errors / batches_flushed` | 0%      | >1% (DB issues)           |
| `retries / batches_flushed`      | <1%     | >5% (DB under stress)     |

---

## Gauge Metrics

| Metric                                 | Range     | Description                                                  |
| -------------------------------------- | --------- | ------------------------------------------------------------ |
| `data_ingestion_buffer_usage`          | 0.0 – 1.0 | Fraction of pointsChan capacity in use                       |
| `data_ingestion_lag_seconds`           | ≥ 0       | Time from MQTT receive to DB write completion                |
| `data_ingestion_batch_queue_depth`     | 0 – 16    | Batches queued in batchChan waiting for writers              |
| `data_ingestion_circuit_breaker_state` | 0, 1, 2   | 0=closed (normal), 1=half-open (testing), 2=open (rejecting) |

### Buffer Usage Interpretation

```
0.0 ─ 0.3:  Normal operation. Points flowing through smoothly.
0.3 ─ 0.6:  Elevated. Writers may be slower than ingestion rate.
0.6 ─ 0.8:  High. Consider scaling or tuning. HPA should trigger.
0.8 ─ 1.0:  Critical. Drops imminent or occurring.
```

### Lag Interpretation

| Lag      | Meaning                              | Action                      |
| -------- | ------------------------------------ | --------------------------- |
| < 1s     | Normal                               | None                        |
| 1s – 5s  | Elevated (batch queuing)             | Check writer count, DB load |
| 5s – 30s | High (backpressure)                  | Scale up, increase writers  |
| > 30s    | Critical (approaching write timeout) | Immediate investigation     |

---

## Histogram Metric

### Batch Duration

```
data_ingestion_batch_duration_seconds

Buckets: 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0
         1ms    5ms    10ms   25ms    50ms  100ms 250ms 500ms 1s
```

**Expected distribution (COPY protocol, 10k points):**

| Percentile | Expected | Meaning                         |
| ---------- | -------- | ------------------------------- |
| p50        | 5-10ms   | Normal batch write              |
| p90        | 10-25ms  | Slightly loaded or larger batch |
| p99        | 25-100ms | Peak load or minor DB pressure  |
| > 500ms    | (rare)   | DB under significant load       |

---

## Structured Logging (zerolog)

### Log Format

**JSON format (default, production):**

```json
{"level":"info","component":"ingestion","time":"2026-03-15T10:30:00Z","message":"Service started"}
{"level":"warn","component":"batcher","dropped":1234,"time":"2026-03-15T10:30:05Z","message":"Dropped data points (buffer full)"}
{"level":"error","component":"writer","err":"connection refused","batch_size":10000,"time":"2026-03-15T10:30:10Z","message":"Failed to write batch"}
```

**Console format (development):**

```
10:30:00 INF Service started component=ingestion
10:30:05 WRN Dropped data points (buffer full) component=batcher dropped=1234
10:30:10 ERR Failed to write batch component=writer err="connection refused" batch_size=10000
```

### Log Levels

| Level | Usage                                        | Examples                                     |
| ----- | -------------------------------------------- | -------------------------------------------- |
| DEBUG | Per-message parsing, batch write details     | Parse error detail, successful batch write   |
| INFO  | Lifecycle events, connections, configuration | Startup, MQTT connected, shutdown complete   |
| WARN  | Recoverable issues, performance warnings     | Buffer drops, circuit breaker state change   |
| ERROR | Failed operations that may cause data loss   | Batch write failure, DB connection failure   |
| FATAL | Startup failures — process cannot continue   | Config invalid, DB unreachable, MQTT timeout |

### Component Tags

Each logger includes a `component` field for filtering:

| Component   | Source File                     |
| ----------- | ------------------------------- |
| `main`      | `cmd/ingestion/main.go`         |
| `ingestion` | `service/ingestion.go`          |
| `batcher`   | `service/batcher.go`            |
| `mqtt`      | `adapter/mqtt/subscriber.go`    |
| `writer`    | `adapter/timescaledb/writer.go` |
| `health`    | `health/checker.go`             |
| `config`    | `adapter/config/config.go`      |
| `history`   | `adapter/http/history.go`       |

---

## Health Endpoints

### GET /health (Full Health Check)

```json
// Healthy (200)
{
  "status": "healthy",
  "timestamp": "2026-03-15T10:30:00Z",
  "components": {
    "mqtt": "healthy",
    "timescaledb": "healthy"
  }
}

// Degraded (503)
{
  "status": "degraded",
  "timestamp": "2026-03-15T10:30:00Z",
  "components": {
    "mqtt": "healthy",
    "timescaledb": "unhealthy"
  }
}
```

### GET /health/live (Liveness Probe)

```json
// Always 200 (unless process crashed)
{
  "status": "alive",
  "timestamp": "2026-03-15T10:30:00Z"
}
```

### GET /health/ready (Readiness Probe)

```json
// Ready (200)
{
  "status": "ready",
  "timestamp": "2026-03-15T10:30:00Z",
  "mqtt": true,
  "database": true
}

// Not ready (503)
{
  "status": "not_ready",
  "timestamp": "2026-03-15T10:30:00Z",
  "mqtt": false,
  "database": true
}
```

### K8s Probe Mapping

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  # Process alive? Don't restart for MQTT disconnect.

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  # Can accept work? Remove from endpoints if MQTT or DB down.

startupProbe:
  httpGet:
    path: /health
    port: 8080
  failureThreshold: 30
  periodSeconds: 2
  # Full check during startup (tolerates slow DB connection).
```

---

## Alerting Rules

Recommended PrometheusRule alerts for the data ingestion service:

| Alert                         | Severity | Condition                                  | For |
| ----------------------------- | -------- | ------------------------------------------ | --- |
| `IngestionCircuitBreakerOpen` | critical | `circuit_breaker_state == 2`               | 1m  |
| `IngestionDataLoss`           | critical | `rate(points_dropped_total[2m]) > 0`       | 2m  |
| `IngestionWriteErrors`        | warning  | `rate(write_errors_total[5m]) > 0.1`       | 5m  |
| `IngestionBufferHigh`         | warning  | `buffer_usage > 0.8`                       | 2m  |
| `IngestionLagHigh`            | warning  | `lag_seconds > 30`                         | 5m  |
| `IngestionMQTTDisconnected`   | warning  | `increase(mqtt_reconnects_total[10m]) > 3` | 10m |

### Alert Descriptions

- **CircuitBreakerOpen:** TimescaleDB unreachable or severely degraded. All writes rejected. Check DB connectivity, disk space, connection limits.
- **DataLoss:** Buffer full, points being dropped. Scale horizontally or increase buffer size.
- **WriteErrors:** Batches failing after retries. Check DB logs for constraint violations or resource issues.
- **BufferHigh:** Writers can't keep up with ingestion rate. Precursor to data loss. Scale or tune.
- **LagHigh:** Significant delay from MQTT receive to DB write. May indicate DB performance issues.
- **MQTTDisconnected:** Frequent reconnects suggest network instability between service and EMQX.

---

## Status Endpoint

`GET :8081/status` returns a comprehensive JSON snapshot:

```json
{
  "service": "data-ingestion",
  "uptime": "14h23m45s",
  "uptime_ms": 51825000,
  "ingestion": {
    "points_received": 152340000,
    "points_dropped": 0,
    "buffer_size": 200000,
    "buffer_used": 1234,
    "buffer_utilization": 0.617
  },
  "mqtt": {
    "connected": true,
    "broker": "tcp://emqx:1883",
    "client_id": "data-ingestion-pod-abc123",
    "topics": ["$share/ingestion/dev/#", "$share/ingestion/uns/#"],
    "parse_errors": 42
  },
  "database": {
    "batches_written": 15234,
    "points_written": 152340000,
    "write_errors": 0,
    "retries_total": 3,
    "avg_write_time_ms": 8.5,
    "pool_total_conns": 20,
    "pool_idle_conns": 14,
    "pool_acquired": 6
  },
  "batcher": {
    "batches_flushed": 15234,
    "points_batched": 152340000,
    "current_batch_size": 4521,
    "current_batch_age_ms": 123,
    "pending_batches": 2
  }
}
```

---

_Previous: [Chapter 9 — Resilience Patterns](resilience_patterns.md) — Next: [Chapter 11 — Scaling Architecture](scaling_architecture.md)_

---

_Document Version: 1.0 — March 2026_
