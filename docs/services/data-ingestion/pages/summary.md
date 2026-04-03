# Chapter 1 — Executive Summary

> What the Data Ingestion Service is, what it owns, and why it exists.

---

## Purpose

The Data Ingestion Service is the **historian bridge** of the NEXUS Edge platform. It sits between the MQTT broker (EMQX) and the time-series database (TimescaleDB), converting streaming telemetry into durable, queryable history.

Every data point that flows through the platform — temperatures, pressures, vibration readings, digital states — passes through this service on its way to long-term storage.

---

## Key Capabilities

| Capability                | Description                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **High Throughput**       | 200,000+ points/sec per instance using PostgreSQL COPY protocol                                        |
| **Horizontal Scaling**    | MQTT shared subscriptions load-balance across N instances with zero coordination                       |
| **Schema-Aware Parsing**  | Understands Protocol Gateway compact JSON (`v`, `q`, `ts`), OPC UA quality codes, timestamp validation |
| **Production Resilience** | Circuit breaker, exponential retry, backpressure buffering, graceful shutdown with data flush          |
| **Observability**         | 13 Prometheus metrics, structured logging (zerolog), health endpoints, alerting rules                  |
| **Memory Efficient**      | `sync.Pool` for DataPoints and Batches eliminates per-message GC pressure                              |

---

## What It Owns

| Domain                     | Details                                                             |
| -------------------------- | ------------------------------------------------------------------- |
| MQTT → DB pipeline         | Subscribe, parse, batch, write — the entire ingestion path          |
| Backpressure management    | Buffer sizing, drop counting, non-blocking message handling         |
| Write optimization         | COPY protocol, batch sizing, parallel writers                       |
| Database write resilience  | Circuit breaker, retry with backoff, transient error classification |
| Ingestion-specific metrics | Buffer usage, lag, drops, breaker state, batch duration             |

## What It Does NOT Own

| Domain                    | Owner                                                       |
| ------------------------- | ----------------------------------------------------------- |
| Device configuration      | Gateway Core (PostgreSQL, MQTT config notifications)        |
| Protocol communication    | Protocol Gateway (OPC UA, Modbus, S7, MQTT device polling)  |
| Message routing           | EMQX (topic-based pub/sub, shared subscription balancing)   |
| Database schema/retention | Infrastructure (TimescaleDB init SQL, compression policies) |
| Alerting/dashboards       | Prometheus + Grafana (scrapes `/metrics` endpoint)          |

---

## Why Not Telegraf or EMQX Enterprise?

TimescaleDB has no native MQTT ingestion. The alternatives and their trade-offs:

| Approach                                      | Trade-off                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EMQX Enterprise Data Integration**          | Ties to paid EMQX Enterprise license. Config lives in broker, not in version-controlled repo. No custom parsing, no circuit breaker, no backpressure metrics. |
| **Telegraf** (`mqtt_consumer` → `postgresql`) | Generic tool — no UNS-aware parsing, no OPC UA quality code mapping, limited batching control. Cannot use COPY protocol. Needs custom parser plugin anyway.   |
| **This service**                              | Full control over the entire pipeline. COPY protocol (10-50x faster), sync.Pool, circuit breaker, backpressure metrics, graceful shutdown flush.              |

The service earns its existence through four capabilities that off-the-shelf tools lack:

1. **COPY protocol** — 10-50x faster than row-by-row INSERT
2. **Object pooling** — sync.Pool for DataPoints and Batches eliminates GC pressure at high throughput
3. **Circuit breaker** — prevents connection pool exhaustion when TimescaleDB is degraded
4. **Backpressure observability** — buffer usage gauge and drop counter enable HPA scaling before data loss

---

## Service Identity

| Property      | Value                                              |
| ------------- | -------------------------------------------------- |
| Language      | Go 1.22+                                           |
| Binary        | `data-ingestion`                                   |
| Image         | `nexus/data-ingestion:<version>`                   |
| Public port   | 8080 (health probes, history API)                  |
| Internal port | 8081 (Prometheus metrics, status, pprof)           |
| Config        | `config/config.yaml` + env overrides               |
| MQTT topics   | `$share/ingestion/dev/#`, `$share/ingestion/uns/#` |
| Database      | `nexus_historian` (TimescaleDB)                    |
| DB user       | `nexus_ingestion`                                  |

---

_Next: [Chapter 2 — System Overview](system_overview.md)_

---

_Document Version: 1.0 — March 2026_
