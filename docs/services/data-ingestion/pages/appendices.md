# Chapter 18 — Appendices

> Dependency inventory, message format specification, error taxonomy, HTTP endpoint reference, and Grafana dashboard suggestions.

---

## A. Dependency Inventory

### Direct Dependencies (go.mod)

| Module                                | Version | License    | Purpose                           |
| ------------------------------------- | ------- | ---------- | --------------------------------- |
| `github.com/eclipse/paho.mqtt.golang` | 1.4.3   | EPL-2.0    | MQTT client (shared subs, QoS 1)  |
| `github.com/goccy/go-json`            | 0.10.5  | MIT        | Fast JSON parsing (2-3x std lib)  |
| `github.com/jackc/pgx/v5`             | 5.5.1   | MIT        | PostgreSQL driver (COPY, pooling) |
| `github.com/prometheus/client_golang` | 1.19.0  | Apache-2.0 | Prometheus metrics                |
| `github.com/rs/zerolog`               | 1.32.0  | MIT        | Structured JSON logging           |
| `github.com/sony/gobreaker/v2`        | 2.4.0   | MIT        | Circuit breaker pattern           |
| `gopkg.in/yaml.v3`                    | 3.0.1   | MIT        | YAML configuration parsing        |

### Notable Transitive Dependencies

| Module                         | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `github.com/jackc/pgconn`      | PostgreSQL connection protocol (wire level) |
| `github.com/jackc/pgtype`      | PostgreSQL type system                      |
| `github.com/gorilla/websocket` | WebSocket (Paho MQTT dependency)            |
| `golang.org/x/sync`            | errgroup, semaphore (Paho)                  |

---

## B. Message Format Specification

### MQTT Payload (Wire Format)

Published by Protocol Gateway, consumed by this service.

```
Topic pattern: dev/{device_id}/{tag_id}
               uns/{enterprise}/{site}/{area}/{line}/{device}/{tag}

Payload: JSON object (UTF-8 encoded)
QoS: 1 (at-least-once)
Retain: false
```

#### Required Fields

| Field     | JSON Key | Type                  | Description       |
| --------- | -------- | --------------------- | ----------------- |
| Value     | `v`      | number/string/boolean | Measurement value |
| Timestamp | `ts`     | integer (unix ms)     | When measured     |

#### Optional Fields

| Field            | JSON Key    | Type         | Default  | Description                |
| ---------------- | ----------- | ------------ | -------- | -------------------------- |
| Quality          | `q`         | string       | `"good"` | Quality indicator          |
| Unit             | `u`         | string       | (empty)  | Engineering unit           |
| Source Timestamp | `source_ts` | integer (ms) | (absent) | Device's own timestamp     |
| Device ID        | `device_id` | string       | (absent) | Source device identifier   |
| Tag ID           | `tag_id`    | string       | (absent) | Tag/measurement identifier |

#### Value Type Handling

| JSON Type | Example          | Stored As                         |
| --------- | ---------------- | --------------------------------- |
| number    | `23.5`           | `value = 23.5` (DOUBLE PRECISION) |
| string    | `"RUNNING"`      | `value_str = "RUNNING"` (TEXT)    |
| boolean   | `true` / `false` | `value = 1.0` / `value = 0.0`     |
| null      | `null`           | **Rejected** (missing value)      |

#### Quality String Mapping

| Wire String        | DB Quality Code | OPC UA Meaning |
| ------------------ | --------------- | -------------- |
| `"good"`           | 192             | Good           |
| `"uncertain"`      | 64              | Uncertain      |
| `"bad"`            | 0               | Bad            |
| `"not_connected"`  | 0               | Bad            |
| `"config_error"`   | 0               | Bad            |
| `"device_failure"` | 0               | Bad            |
| `"timeout"`        | 0               | Bad            |
| (unknown)          | 192             | Good (default) |

#### Example Messages

```json
// Numeric — temperature reading
{"v": 23.5, "q": "good", "u": "°C", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "temperature"}

// String — device state
{"v": "RUNNING", "q": "good", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "state"}

// Boolean — alarm active (stored as 1.0)
{"v": true, "q": "good", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "alarm_active"}

// Minimal — only required fields
{"v": 42, "ts": 1709712000000}

// Bad quality — device timeout
{"v": 0, "q": "timeout", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "temperature"}
```

---

## C. Error Taxonomy

### Parse Errors (Non-Retryable)

| Error                           | Cause                                          | Metric               |
| ------------------------------- | ---------------------------------------------- | -------------------- |
| `"payload too large"`           | Payload > 65,536 bytes                         | `parse_errors_total` |
| `"topic too long"`              | Topic > 1,024 chars                            | `parse_errors_total` |
| `"invalid JSON"`                | Malformed JSON payload                         | `parse_errors_total` |
| `"missing value"`               | `v` field is null or absent                    | `parse_errors_total` |
| `"value string too long"`       | String value > 4,096 chars                     | `parse_errors_total` |
| `"timestamp too far in future"` | ts > now + 1 hour                              | `parse_errors_total` |
| `"timestamp too old"`           | ts < now - 30 days                             | `parse_errors_total` |
| `"unsupported value type"`      | Value is array, object, or other non-primitive | `parse_errors_total` |

### Write Errors (After Retries Exhausted)

| Error                         | Cause                                | Metric               |
| ----------------------------- | ------------------------------------ | -------------------- |
| `gobreaker.ErrOpenState`      | Circuit breaker is open              | `write_errors_total` |
| PG SQLSTATE `08xxx`           | Connection exception (after retries) | `write_errors_total` |
| PG SQLSTATE `23xxx`           | Constraint violation (no retry)      | `write_errors_total` |
| `"connection refused"`        | TimescaleDB not running              | `write_errors_total` |
| `"context deadline exceeded"` | Write timeout (30s)                  | `write_errors_total` |

### Operational Errors (Non-Fatal)

| Error                                | Cause                          | Recovery                     |
| ------------------------------------ | ------------------------------ | ---------------------------- |
| `"Buffer full, dropping data point"` | pointsChan at capacity         | Scale up or increase buffer  |
| `"MQTT connection lost"`             | Broker disconnect              | Auto-reconnect (5s interval) |
| `"Direct write failed"`              | batchChan full, fallback write | Normal under extreme load    |

---

## D. HTTP Endpoint Reference

### Public Server (:8080)

| Method | Path            | Description                       | Response       |
| ------ | --------------- | --------------------------------- | -------------- |
| GET    | `/health`       | Full health check (MQTT + DB)     | 200/503 + JSON |
| GET    | `/health/live`  | Liveness probe (always healthy)   | 200 + JSON     |
| GET    | `/health/ready` | Readiness probe (MQTT + DB check) | 200/503 + JSON |
| GET    | `/api/history`  | Query historical data             | 200 + JSON     |

### Internal Server (:8081)

| Method | Path             | Description                      | Response     |
| ------ | ---------------- | -------------------------------- | ------------ |
| GET    | `/metrics`       | Prometheus metrics (text format) | 200 + text   |
| GET    | `/status`        | Pipeline status (JSON)           | 200 + JSON   |
| GET    | `/debug/pprof/*` | Go pprof profiles (if enabled)   | 200 + binary |

### History API (`GET /api/history`)

| Param   | Type    | Required | Default          | Description                     |
| ------- | ------- | -------- | ---------------- | ------------------------------- |
| `topic` | string  | Yes      | —                | MQTT topic to query             |
| `from`  | integer | No       | now - 10 minutes | Start time (unix milliseconds)  |
| `to`    | integer | No       | now              | End time (unix milliseconds)    |
| `limit` | integer | No       | 500              | Max points to return (max 5000) |

**Response:**

```json
{
  "topic": "dev/plc-001/temperature",
  "stats": {
    "count": 600,
    "avg": 23.45,
    "min": 22.1,
    "max": 24.8,
    "latest": 23.5
  },
  "points": [
    { "time": "2026-03-15T10:20:00Z", "value": 23.2, "value_str": null, "quality": 192 },
    { "time": "2026-03-15T10:20:01Z", "value": 23.3, "value_str": null, "quality": 192 }
  ]
}
```

---

## E. Grafana Dashboard Suggestions

### Panel 1: Throughput

```
Query: rate(data_ingestion_points_received_total[1m])
       rate(data_ingestion_points_written_total[1m])
       rate(data_ingestion_points_dropped_total[1m])

Type: Time series (stacked)
```

### Panel 2: Pipeline Health

```
Query: data_ingestion_buffer_usage
       data_ingestion_lag_seconds
       data_ingestion_circuit_breaker_state

Type: Gauge / Stat panel
```

### Panel 3: Batch Performance

```
Query: histogram_quantile(0.5, data_ingestion_batch_duration_seconds_bucket)
       histogram_quantile(0.9, data_ingestion_batch_duration_seconds_bucket)
       histogram_quantile(0.99, data_ingestion_batch_duration_seconds_bucket)

Type: Time series
```

### Panel 4: Database Health

```
Query: rate(data_ingestion_write_errors_total[5m])
       rate(data_ingestion_write_retries_total[5m])
       data_ingestion_circuit_breaker_state

Type: Time series + Stat
```

### Panel 5: MQTT Health

```
Query: increase(data_ingestion_mqtt_reconnects_total[1h])
       rate(data_ingestion_parse_errors_total[5m])

Type: Stat + Time series
```

---

## F. MQTT Topic Reference

| Topic Pattern                | Publisher        | Subscriber       | Purpose                   |
| ---------------------------- | ---------------- | ---------------- | ------------------------- |
| `dev/{device_id}/{tag_id}`   | Protocol Gateway | Data Ingestion   | Raw device telemetry      |
| `uns/{enterprise}/.../{tag}` | Protocol Gateway | Data Ingestion   | Unified Namespace data    |
| `$share/ingestion/dev/#`     | —                | Data Ingestion   | Shared subscription (dev) |
| `$share/ingestion/uns/#`     | —                | Data Ingestion   | Shared subscription (uns) |
| `$nexus/config/devices/{id}` | Gateway Core     | Protocol Gateway | Device configuration      |
| `$nexus/status/devices/{id}` | Protocol Gateway | Gateway Core     | Device status             |

---

_Previous: [Chapter 17 — Edge Cases & Gotchas](edge_cases.md) — Back to: [INDEX](../INDEX.md)_

---

_Document Version: 1.0 — March 2026_
