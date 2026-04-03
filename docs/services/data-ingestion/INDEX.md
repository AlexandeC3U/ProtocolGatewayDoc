# Data Ingestion Service — Documentation

---

## Overview

The Data Ingestion Service is a high-throughput Go pipeline that bridges MQTT telemetry into TimescaleDB. It subscribes to EMQX shared subscriptions, parses compact JSON payloads from the Protocol Gateway, accumulates data points into batches, and bulk-writes them using the PostgreSQL COPY protocol.

The service is **stateless** — all durable state lives in EMQX (message queues, persistent sessions) and TimescaleDB (time-series storage). This makes it horizontally scalable: deploy more pods, and EMQX automatically load-balances messages across the group.

```
                            EMQX Broker
                     $share/ingestion/dev/#
                     $share/ingestion/uns/#
                                |
                    +-----------v-----------+
                    |   DATA-INGESTION      |
                    |       (Go)            |
                    +--+------+------+------+
                       |      |      |
          +------------+      |      +------------+
          |                   |                   |
     MQTT Subscriber     Batcher (N)        Health/Metrics
     (Paho, QoS 1)      Writer Workers      (Prometheus)
          |                   |
          v                   v
     pointsChan          TimescaleDB
     (200k buffer)       (COPY protocol)
                              |
                    +---------v---------+
                    |   metrics table   |
                    |   (hypertable)    |
                    |   + aggregates    |
                    |   + compression   |
                    +-------------------+
```

---

## Table of Contents

| #   | Chapter                                                       | File                          | Description                                                      |
| --- | ------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| 1   | [Executive Summary](pages/summary.md)                         | `summary.md`                  | Purpose, key capabilities, why custom over Telegraf/EMQX EE      |
| 2   | [System Overview](pages/system_overview.md)                   | `system_overview.md`          | End-to-end pipeline diagram, dependency graph, port map          |
| 3   | [Architectural Principles](pages/architectural_principles.md) | `architectural_principles.md` | Stateless design, COPY over INSERT, object pooling, backpressure |
| 4   | [Layer Architecture](pages/layer_architecture.md)             | `layer_architecture.md`       | Clean Architecture in Go, file-by-file map, module boundaries    |
| 5   | [Domain Model](pages/domain_model.md)                         | `domain_model.md`             | DataPoint, Batch, MQTTPayload, quality codes, sync.Pool          |
| 6   | [Pipeline Architecture](pages/pipeline_architecture.md)       | `pipeline_architecture.md`    | Accumulator loop, flush triggers, batchChan, writer workers      |
| 7   | [Writer Internals](pages/writer_internals.md)                 | `writer_internals.md`         | COPY protocol, pgx pool, circuit breaker, retry with backoff     |
| 8   | [MQTT Subscriber](pages/mqtt_subscriber.md)                   | `mqtt_subscriber.md`          | Paho client, shared subscriptions, reconnect, message parsing    |
| 9   | [Resilience Patterns](pages/resilience_patterns.md)           | `resilience_patterns.md`      | Circuit breaker, backpressure, retry, graceful shutdown          |
| 10  | [Observability](pages/observability.md)                       | `observability.md`            | 13 Prometheus metrics, zerolog, health endpoints, alerting rules |
| 11  | [Scaling Architecture](pages/scaling_architecture.md)         | `scaling_architecture.md`     | Shared subscriptions, capacity planning, HPA config              |
| 12  | [Deployment](pages/deployment.md)                             | `deployment.md`               | Dockerfile, Docker Compose, Kubernetes, resource tuning          |
| 13  | [Performance Tuning](pages/performance_tuning.md)             | `performance_tuning.md`       | COPY vs INSERT, batch sizing, writer count, buffer tuning        |
| 14  | [Testing Strategy](pages/testing_strategy.md)                 | `testing_strategy.md`         | Unit, integration, e2e, fuzz, benchmarks, test environment       |
| 15  | [Configuration Reference](pages/configuration_reference.md)   | `configuration_reference.md`  | All env vars, config.yaml schema, defaults, validation           |
| 16  | [Database Schema](pages/database_schema.md)                   | `database_schema.md`          | Hypertable, aggregates, compression, retention, helper functions |
| 17  | [Edge Cases & Gotchas](pages/edge_cases.md)                   | `edge_cases.md`               | At-least-once, timestamp skew, NaN, ordering, operational notes  |
| 18  | [Appendices](pages/appendices.md)                             | `appendices.md`               | Error codes, dependency inventory, message format spec           |

---

## Quick Reference

| Concern                    | Where to Look                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Understand the pipeline    | [Ch. 6](pages/pipeline_architecture.md) (accumulator/writers), [Ch. 2](pages/system_overview.md) (E2E) |
| Debug write failures       | [Ch. 7](pages/writer_internals.md) (retry/breaker), [Ch. 10](pages/observability.md) (metrics)         |
| Tune throughput            | [Ch. 13](pages/performance_tuning.md) (batch/writer sizing), [Ch. 11](pages/scaling_architecture.md)   |
| Add a new metric           | [Ch. 10](pages/observability.md) (registry), [Ch. 4](pages/layer_architecture.md) (file map)           |
| MQTT connection issues     | [Ch. 8](pages/mqtt_subscriber.md) (Paho), [Ch. 9](pages/resilience_patterns.md) (reconnect)            |
| Configure for production   | [Ch. 15](pages/configuration_reference.md) (env vars), [Ch. 12](pages/deployment.md) (Docker/K8s)      |
| Understand the DB schema   | [Ch. 16](pages/database_schema.md) (hypertable, aggregates, retention)                                 |
| Scale horizontally         | [Ch. 11](pages/scaling_architecture.md) (shared subs, HPA), [Ch. 12](pages/deployment.md) (K8s)        |
| Graceful shutdown behavior | [Ch. 9](pages/resilience_patterns.md) (shutdown sequence), [Ch. 6](pages/pipeline_architecture.md)     |
| Message format contract    | [Ch. 5](pages/domain_model.md) (MQTTPayload), [Ch. 18](pages/appendices.md) (message spec)             |

---

## Tech Stack

| Component       | Technology               | Version | Purpose                                |
| --------------- | ------------------------ | ------- | -------------------------------------- |
| Language        | Go                       | 1.22+   | High-performance, low-GC pipeline      |
| MQTT Client     | Eclipse Paho             | 1.4.3   | Shared subscriptions, QoS 1, reconnect |
| Database Driver | pgx (jackc/pgx)          | 5.5.1   | COPY protocol, connection pooling      |
| JSON Parser     | goccy/go-json            | 0.10.5  | Fastest Go JSON library                |
| Circuit Breaker | sony/gobreaker           | 2.4.0   | DB write protection                    |
| Metrics         | Prometheus client_golang | 1.19.0  | 13 pipeline-specific metrics           |
| Logging         | rs/zerolog               | 1.32.0  | Structured JSON logging                |
| Configuration   | gopkg.in/yaml.v3         | 3.0.1   | YAML with env var expansion            |
| Database        | TimescaleDB              | 2.17+   | Hypertables, compression, aggregates   |
| Message Broker  | EMQX                     | 5.3+    | Shared subscriptions, clustering       |

---

## Key Numbers (Defaults)

| Parameter           | Value   | Meaning                                  |
| ------------------- | ------- | ---------------------------------------- |
| Buffer capacity     | 200,000 | Points buffered in memory (~5s at 40k/s) |
| Batch size          | 10,000  | Points per COPY write                    |
| Flush interval      | 250ms   | Maximum latency before partial flush     |
| Writer goroutines   | 8       | Parallel DB writers                      |
| DB pool connections | 20      | pgx connection pool size                 |
| Write timeout       | 30s     | Per-batch database deadline              |
| Max retries         | 3       | Exponential backoff per batch            |
| MQTT QoS            | 1       | At-least-once delivery                   |
| Clean session       | false   | Persistent MQTT session (zero data loss) |
| Shutdown timeout    | 30s     | Drain in-flight data before exit         |

---

## Related Documentation

| Document                                                         | Description                            |
| ---------------------------------------------------------------- | -------------------------------------- |
| [Platform Architecture](../../ARCHITECTURE.md)                   | Full system architecture               |
| [Protocol Gateway Docs](../protocol-gateway/INDEX.md)            | Upstream data source                   |
| [Gateway Core Docs](../gateway-core/INDEX.md)                    | Control plane, config management       |
| [TimescaleDB Init SQL](../../../config/timescaledb/init.sql)     | Database schema, aggregates, retention |
| [Infrastructure Docs](../../../infrastructure/infrastructure.md) | Docker Compose, K8s deployment         |
| [Platform Roadmap](../../ROADMAP.md)                             | Strategic roadmap                      |

---

_Document Version: 1.0_
_Last Updated: March 2026_
