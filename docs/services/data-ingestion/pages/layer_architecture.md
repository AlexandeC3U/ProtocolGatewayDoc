# Chapter 4 — Layer Architecture

> Code organization, module boundaries, and a file-by-file map of the service.

---

## Clean Architecture in Go

The service follows Clean Architecture principles adapted for Go. Dependencies point inward — adapters depend on the domain, never the reverse.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        cmd/ingestion/                               │
│                        (Composition Root)                           │
│                                                                     │
│  Wires adapters to services, starts HTTP servers, handles signals   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ imports
                ┌───────────────┼───────────────┐
                │               │               │
                ▼               ▼               ▼
┌───────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│  internal/service/│ │ internal/health/│ │  internal/metrics/      │
│                   │ │                 │ │                         │
│  Ingestion logic: │ │  Health checks  │ │  Prometheus registry    │
│  pipeline, batch, │ │  /health/live   │ │  13 metrics             │
│  message handling │ │  /health/ready  │ │                         │
└────────┬──────────┘ └─────────────────┘ └─────────────────────────┘
         │ depends on
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      internal/domain/                               │
│                                                                     │
│  DataPoint, Batch, MQTTPayload, ports (interfaces), sync.Pool       │
│  Zero external dependencies — pure Go types and logic               │
└─────────────────────────────────────────────────────────────────────┘
         ▲ implements
         │
┌─────────────────────────────────────────────────────────────────────┐
│                      internal/adapter/                              │
│                                                                     │
│  mqtt/subscriber.go     — Paho MQTT client (implements MQTTSubscriber)
│  timescaledb/writer.go  — pgx COPY writer (implements BatchWriter)  │
│  http/history.go        — History query handler                     │
│  config/config.go       — YAML + env var configuration loader       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## File-by-File Map

### Entry Point

| File                    | Lines | Purpose                                                                                                                  |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `cmd/ingestion/main.go` | 186   | Composition root. Loads config, creates all components, starts HTTP servers, handles graceful shutdown with 30s timeout. |

### Domain Layer (`internal/domain/`)

| File           | Lines | Purpose                                                                                                                                                                                                                                                         |
| -------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `datapoint.go` | 272   | Core entities: `DataPoint`, `Batch`, `MQTTPayload`. Quality code mapping (OPC UA). `ParsePayload()` with validation guards. `sync.Pool` for DataPoint and Batch recycling. Constants: `MaxTopicLength`, `MaxPayloadSize`, `MaxValueStrLen`, `MaxTimestampSkew`. |
| `ports.go`     | 31    | Interface definitions: `MQTTSubscriber` (Connect, Disconnect, SetHandler, IsConnected, ParseMessage, Stats), `BatchWriter` (WriteBatch, IsHealthy, Close, Stats), `MessageHandler` type.                                                                        |

### Service Layer (`internal/service/`)

| File           | Lines | Purpose                                                                                                                                                                                                                                                                                          |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ingestion.go` | 233   | Pipeline orchestrator. `IngestionService` owns `pointsChan` (200k buffer). `handleMessage()` is the MQTT callback — parses, buffers (non-blocking), drops if full. `Start()` connects MQTT and starts batcher. `Stop()` gracefully drains pipeline. `StatusHandler` exposes JSON stats via HTTP. |
| `batcher.go`   | 251   | Batch accumulator. Single `accumulatorLoop` goroutine reads from `pointsChan`, accumulates into `currentBatch` (guarded by mutex), flushes to `batchChan` on batch-full or timer. N `writerLoop` goroutines read from `batchChan` and call `WriteBatch()`. All goroutines tracked by WaitGroup.  |

### Adapter Layer (`internal/adapter/`)

| File                    | Lines | Purpose                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mqtt/subscriber.go`    | 198   | Paho MQTT v1 client. Configures auto-reconnect, shared subscriptions, resubscribe-on-connect. `ParseMessage()` delegates to `domain.ParsePayload()`. Tracks connection state with atomics.                                                                                                                                                                |
| `timescaledb/writer.go` | 428   | pgxpool + COPY protocol. Circuit breaker (sony/gobreaker): 5 failures → 10s open → 2 test batches. Retry loop with exponential backoff (100ms base, 5s cap). `writeBatchCopy()` and `writeBatchInsert()` (fallback). `buildMetadataJSON()` avoids map allocations. `isRetryableError()` classifies PG SQLSTATE classes. Exposes pool for history queries. |
| `http/history.go`       | 146   | `GET /api/history` endpoint. Query params: `topic` (required), `from`/`to` (unix ms), `limit` (max 5000). Returns stats (count, avg, min, max, latest) + time-series points. Uses same pgxpool as writer.                                                                                                                                                 |
| `config/config.go`      | 302   | YAML config loader with `${VAR:default}` env var expansion (regex-based, preserves `$share` for MQTT). `Load()` reads file → expands env → YAML unmarshal → apply defaults → apply env overrides → validate. Validation: batch ≤ buffer, writer_count ≥ 1, production password check.                                                                     |

### Health Layer (`internal/health/`)

| File         | Lines | Purpose                                                                                                                                                                                                          |
| ------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checker.go` | 114   | Three endpoints: `/health` (full — checks MQTT + DB, returns 200/503), `/health/live` (always 200 — process alive), `/health/ready` (MQTT + DB check with 5s timeout). Response includes component-level status. |

### Metrics Layer (`internal/metrics/`)

| File          | Lines | Purpose                                                                                                                                                                                                                                                                                                                                            |
| ------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry.go` | 157   | Prometheus metric definitions. 8 counters (received, dropped, written, parse errors, write errors, batches flushed, retries, MQTT reconnects), 1 histogram (batch duration, 9 buckets), 4 gauges (buffer usage, lag, batch queue depth, circuit breaker state). Methods: `IncPointsReceived()`, `SetBufferUsage()`, `ObserveBatchDuration()`, etc. |

### Shared Package (`pkg/logging/`)

| File        | Lines | Purpose                                                                                                                                                     |
| ----------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logger.go` | 42    | zerolog factory. `NewLogger(level, format)` returns JSON logger (default) or console writer (human-readable). `WithComponent()` adds a `"component"` field. |

### Configuration

| File                 | Lines | Purpose                                                                             |
| -------------------- | ----- | ----------------------------------------------------------------------------------- |
| `config/config.yaml` | ~50   | Default configuration with `${VAR:default}` syntax for environment-specific values. |

### Build & Deployment

| File                       | Lines | Purpose                                                                                                                         |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`               | ~30   | Multi-stage build: `golang:1.22.5-alpine3.20` → `alpine:3.20`. Non-root user (nexus:1000), CGO_ENABLED=0, healthcheck via wget. |
| `docker-compose.yaml`      | 96    | Production compose: resource limits (1 CPU, 512MB), read-only fs, no-new-privileges, json-file logging (50MB × 5).              |
| `docker-compose.dev.yaml`  | 157   | Development compose: EMQX, TimescaleDB, data-ingestion, protocol-gateway, modbus-simulator, Adminer.                            |
| `docker-compose.test.yaml` | 47    | Test dependencies: EMQX (:11883) + TimescaleDB (:15432) on isolated ports.                                                      |
| `Makefile`                 | 332   | Build, test (unit/integration/e2e/fuzz/bench), lint, security, Docker, dev environment targets.                                 |
| `.air.toml`                | ~20   | Hot reload config for development (watches `.go`, `.yaml`).                                                                     |
| `init-user.sql`            | ~15   | Creates `nexus_ingestion` and `nexus_historian` database roles.                                                                 |

---

## Module Boundaries

```
                    cmd/ingestion/main.go
                    ┌───────────────────────────────────────────────┐
                    │  Creates:                                     │
                    │  • config.Load()           → *Config          │
                    │  • metrics.NewRegistry()   → *Registry        │
                    │  • timescaledb.NewWriter() → BatchWriter      │
                    │  • mqtt.NewSubscriber()    → MQTTSubscriber   │
                    │  • service.NewIngestion()  → *IngestionService│
                    │  • health.NewChecker()     → *Checker         │
                    │  • http.NewHistoryHandler()→ *HistoryHandler  │
                    │                                               │
                    │  Wires:                                       │
                    │  • subscriber → ingestion service             │
                    │  • writer → ingestion service + history       │
                    │  • metrics → subscriber + writer + batcher    │
                    │                                               │
                    │  Starts:                                      │
                    │  • Public HTTP server (:8080)                 │
                    │  • Internal HTTP server (:8081)               │
                    │  • Ingestion service (MQTT + pipeline)        │
                    └───────────────────────────────────────────────┘
```

**Rule:** Only `main.go` knows about concrete types. The service layer works exclusively with the `domain.MQTTSubscriber` and `domain.BatchWriter` interfaces. This enables testing with mock implementations.

---

## Line Count Summary

| Layer       | Files  | Lines     | Percentage |
| ----------- | ------ | --------- | ---------- |
| Entry point | 1      | 186       | 8%         |
| Domain      | 2      | 303       | 13%        |
| Service     | 2      | 484       | 21%        |
| Adapters    | 4      | 1,074     | 47%        |
| Health      | 1      | 114       | 5%         |
| Metrics     | 1      | 157       | 7%         |
| **Total**   | **11** | **2,318** | **100%**   |

The adapter layer is the largest because it contains all external protocol handling (MQTT, PostgreSQL, HTTP, YAML).

---

_Previous: [Chapter 3 — Architectural Principles](architectural_principles.md) — Next: [Chapter 5 — Domain Model](domain_model.md)_

---

_Document Version: 1.0 — March 2026_
