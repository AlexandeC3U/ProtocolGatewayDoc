# Chapter 2 — System Overview

> End-to-end pipeline diagram, dependency graph, port map, and where the service sits in the platform.

---

## Platform Context

The Data Ingestion Service occupies the **data plane** of the NEXUS Edge platform. It is the final leg of the telemetry pipeline: devices → Protocol Gateway → EMQX → **Data Ingestion** → TimescaleDB.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          NEXUS EDGE PLATFORM                                │
│                                                                             │
│  ┌──────────────┐                                                           │
│  │   Web UI     │◄──── REST / WebSocket ────┐                               │
│  │  (React)     │                           │                               │
│  └──────────────┘                           │                               │
│                                             │                               │
│  ┌──────────────┐     ┌─────────────┐       │        ┌─────────────┐        │
│  │  Authentik   │     │ PostgreSQL  │◄──────┤        │ Prometheus  │        │
│  │  (SSO/OIDC)  │     │  (Config)   │       │        │ + Grafana   │        │
│  └──────────────┘     └─────────────┘       │        └──────┬──────┘        │
│                                             │               │ /metrics      │
│  ┌──────────────────────────────────────────┴─────────┐     │               │
│  │                GATEWAY CORE (TypeScript)           │◄────┘               │
│  │    Control plane: config, auth, proxy, WS bridge   │                     │
│  └───────────────────────┬────────────────────────────┘                     │
│                          │ MQTT (config + status)                           │
│                          ▼                                                  │
│  ┌──────────────────────────────────────────────────────────┐               │
│  │                    EMQX BROKER                           │               │
│  │   Config topics: $nexus/config/#                         │               │
│  │   Data topics:   dev/#, uns/#                            │               │
│  │   Status topics: $nexus/status/#                         │               │
│  └──────┬──────────────────────────────────┬────────────────┘               │
│         │                                  │                                │
│         ▼                                  ▼                                │
│  ┌──────────────┐                 ┌─────────────────┐                       │
│  │  Protocol    │  telemetry      │ DATA INGESTION  │◄── YOU ARE HERE       │
│  │  Gateway     │────────────────>│    (Go)         │                       │
│  │  (Go)        │  via EMQX       │                 │                       │
│  └──────┬───────┘                 └────────┬────────┘                       │
│         │                                  │ COPY protocol                  │
│         ▼                                  ▼                                │
│  ┌──────────────┐                 ┌─────────────────┐                       │
│  │  Industrial  │                 │  TimescaleDB    │                       │
│  │  Devices     │                 │  (Historian)    │                       │
│  └──────────────┘                 └─────────────────┘                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Internal Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA INGESTION SERVICE                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  MQTT Subscriber (Paho v1)                                          │    │
│  │                                                                     │    │
│  │  Topics: $share/ingestion/dev/#, $share/ingestion/uns/#             │    │
│  │  QoS 1, clean_session=false, auto-reconnect                         │    │
│  │  onMessage → handleMessage()                                        │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                           │
│                                 │  1. Check shutdownFlag (atomic)           │
│                                 │  2. ParsePayload (JSON → DataPoint)       │
│                                 │  3. Non-blocking send to pointsChan       │
│                                 │  4. If full → drop + count                │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  pointsChan (buffered channel, capacity: 200,000)                   │    │
│  │                                                                     │    │
│  │  Backpressure buffer. Non-blocking sends mean MQTT callbacks never  │    │
│  │  block — if the channel is full, points are dropped and counted.    │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Batcher (Accumulator Loop — single goroutine)                      │    │
│  │                                                                     │    │
│  │  select {                                                           │    │
│  │    case dp := <-pointsChan:  → addToBatch(dp)                       │    │
│  │    case <-ticker.C:          → flushIfNotEmpty()                    │    │
│  │  }                                                                  │    │
│  │                                                                     │    │
│  │  Flush triggers: batch full (10,000) | timer (250ms) | shutdown     │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                           │
│                                 ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  batchChan (buffered channel, capacity: WriterCount × 2 = 16)       │    │
│  └──────┬──────┬──────┬──────┬──────┬──────┬──────┬──────┬─────────────┘    │
│         │      │      │      │      │      │      │      │                  │
│         ▼      ▼      ▼      ▼      ▼      ▼      ▼      ▼                  │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │  Writer Workers (8 goroutines)                                   │       │
│  │                                                                  │       │
│  │  Each: read batch → circuit breaker → retry loop → COPY to DB    │       │
│  │  Uses context.Background() — writes complete even during shutdown│       │
│  └──────────────────────────────┬───────────────────────────────────┘       │
│                                 │                                           │
│  ┌──────────────────────────────┴──────────────────────────────────────┐    │
│  │  TimescaleDB Writer                                                 │    │
│  │                                                                     │    │
│  │  Circuit Breaker (5 failures → open 10s → half-open 2 test batches) │    │
│  │  Retry Loop (exponential backoff: 100ms, 200ms, 400ms, cap 5s)      │    │
│  │  COPY Protocol (pgx.CopyFrom — 10-50x faster than INSERT)           │    │
│  │  pgxpool (20 connections, max idle 5m)                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  HTTP Servers                                                       │    │
│  │                                                                     │    │
│  │  Port 8080 (Public)              Port 8081 (Internal)               │    │
│  │  ├── GET /health                 ├── GET /metrics  (Prometheus)     │    │
│  │  ├── GET /health/live            ├── GET /status   (JSON pipeline)  │    │
│  │  ├── GET /health/ready           └── GET /debug/pprof/* (optional)  │    │
│  │  └── GET /api/history                                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Dependency Graph

```
                    ┌──────────────┐
                    │  EMQX Broker │
                    │  :1883 MQTT  │
                    └──────┬───────┘
                           │ MQTT QoS 1
                           │ shared subscriptions
                           ▼
                    ┌──────────────┐
                    │    Data      │
                    │  Ingestion   │
                    │  :8080/:8081 │
                    └──────┬───────┘
                           │ pgx COPY protocol
                           │ pgxpool (20 conns)
                           ▼
                    ┌──────────────┐
                    │ TimescaleDB  │
                    │    :5432     │
                    └──────────────┘

    Upstream (data source):     Protocol Gateway → EMQX
    Downstream (consumers):     Grafana, Gateway Core /api/history proxy
```

The service has exactly **two runtime dependencies**:

| Dependency  | Protocol   | Purpose                      | Failure Behavior                |
| ----------- | ---------- | ---------------------------- | ------------------------------- |
| EMQX        | MQTT       | Message source (shared subs) | Auto-reconnect, messages queued |
| TimescaleDB | PostgreSQL | Data sink (COPY writes)      | Circuit breaker → retry → drop  |

---

## Port Map

| Port | Network  | Purpose                                  | Exposed To           |
| ---- | -------- | ---------------------------------------- | -------------------- |
| 8080 | Public   | Health probes (`/health/*`), history API | K8s kubelet, clients |
| 8081 | Internal | Prometheus metrics, status JSON, pprof   | Prometheus scraper   |

---

## Startup Sequence

```
1. Load config (YAML + env var expansion + env overrides + validation)
        │
2. Create zerolog logger (JSON or console format)
        │
3. Create Prometheus metrics registry (13 metrics)
        │
4. Connect TimescaleDB writer (pgxpool + circuit breaker)
        │   └── Pool.Ping() to verify connectivity
        │
5. Connect MQTT subscriber (Paho client)
        │   └── Subscribe to shared subscription topics
        │
6. Create ingestion service (wire subscriber + writer + batcher)
        │
7. Start batcher (accumulator goroutine + 8 writer goroutines)
        │
8. Start public HTTP server (:8080) — health + history
        │
9. Start internal HTTP server (:8081) — metrics + status + pprof
        │
10. Block on SIGINT/SIGTERM → graceful shutdown (30s timeout)
```

---

_Previous: [INDEX](../INDEX.md) — Next: [Chapter 3 — Architectural Principles](architectural_principles.md)_

---

_Document Version: 1.0 — March 2026_
