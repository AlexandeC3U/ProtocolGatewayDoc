# Gateway Core — Documentation

---

## Overview

Gateway Core is the **control plane** of the NEXUS Edge platform. It is the single entry point for the web UI and external consumers. It owns all persistent configuration in PostgreSQL, coordinates runtime services via MQTT notifications, proxies requests to the protocol-gateway and data-ingestion services, and bridges MQTT data to WebSocket clients for real-time UI updates.

Built in TypeScript with Fastify, it provides a type-safe, schema-validated REST API with OIDC authentication, role-based access control, audit logging, rate limiting, and Prometheus metrics.

```
                            Web UI (React)
                                |
                        REST / WebSocket
                                |
                    +-----------v-----------+
                    |     GATEWAY-CORE      |
                    |     (TypeScript)      |
                    +--+------+------+---+--+
                       |      |      |   |
          +------------+      |      |   +------------+
          |                   |      |                |
     PostgreSQL          MQTT Broker  HTTP Proxy    WebSocket
     (config DB)          (EMQX)     (to PG/DI)    Bridge
          |                   |          |            |
          |     +-------------+-----+    |            |
          |     |                   |    |            |
     +----v----v------+   +--------v----v---+    MQTT→WS
     | PROTOCOL-       |   | DATA-INGESTION  |   (live data)
     | GATEWAY (Go)    |   | (Go)            |
     +--+---------+----+   +-----------------+
        |         |
   ┌────v──┐  ┌──v───┐
   │  OT   │  │ EMQX │
   │Devices│  │(data)│
   └───────┘  └──────┘
```

---

## Table of Contents

| #   | Chapter                                                       | File                          | Description                                                    |
| --- | ------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------- |
| 1   | [Executive Summary](pages/summary.md)                         | `summary.md`                  | Purpose, key capabilities, design philosophy                   |
| 2   | [System Overview](pages/system_overview.md)                   | `system_overview.md`          | Architecture diagram, dependency graph, tech stack             |
| 3   | [Architectural Principles](pages/architectural_principles.md) | `architectural_principles.md` | Control plane design, protocol-agnostic proxy, two-phase setup |
| 4   | [Layer Architecture](pages/layer_architecture.md)             | `layer_architecture.md`       | Code organization, module boundaries, file-by-file map         |
| 5   | [Domain Model](pages/domain_model.md)                         | `domain_model.md`             | Device/Tag/AuditLog entities, enums, Zod schemas, transforms   |
| 6   | [Middleware Architecture](pages/middleware_architecture.md)   | `middleware_architecture.md`  | Auth (JWT/JWKS), RBAC, audit logging, rate limiting            |
| 7   | [MQTT Architecture](pages/mqtt_architecture.md)               | `mqtt_architecture.md`        | Publisher, subscriber, transform layer, topic contract         |
| 8   | [Proxy Architecture](pages/proxy_architecture.md)             | `proxy_architecture.md`       | HTTP proxy to protocol-gateway/data-ingestion, circuit breaker |
| 9   | [WebSocket Bridge](pages/websocket_bridge.md)                 | `websocket_bridge.md`         | MQTT→WS bridge, ref-counted subscriptions, topic ACL           |
| 10  | [Data Flow Architecture](pages/dataflow_architecture.md)      | `dataflow_architecture.md`    | Device CRUD flow, two-phase setup, config sync, status ingest  |
| 11  | [Resilience Patterns](pages/resilience_patterns.md)           | `resilience_patterns.md`      | Circuit breaker, MQTT reconnect, DB pool, graceful shutdown    |
| 12  | [Observability](pages/observability.md)                       | `observability.md`            | Prometheus metrics, Pino logging, health endpoints             |
| 13  | [Security Architecture](pages/security_architecture.md)       | `security_architecture.md`    | OIDC flow, JWT validation, role extraction, RBAC matrix        |
| 14  | [Deployment](pages/deployment.md)                             | `deployment.md`               | Docker multi-stage build, Compose config, Kubernetes manifests |
| 15  | [Testing Strategy](pages/testing_strategy.md)                 | `testing_strategy.md`         | Vitest setup, unit/integration/API tests                       |
| 16  | [Configuration Reference](pages/configuration_reference.md)   | `configuration_reference.md`  | All env vars, Zod schema, feature flags                        |
| 17  | [Edge Cases & Gotchas](pages/edge_cases.md)                   | `edge_cases.md`               | Operational notes, known limitations, debugging tips           |
| 18  | [Appendices](pages/appendices.md)                             | `appendices.md`               | Error codes, dependency inventory, API endpoint table          |

---

## Quick Reference

| Concern                   | Where to Look                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Add a new API route       | [Ch. 4](pages/layer_architecture.md) (file structure), [Ch. 18](pages/appendices.md) (endpoint table)      |
| Understand the auth flow  | [Ch. 6](pages/middleware_architecture.md) (OIDC/JWT), [Ch. 13](pages/security_architecture.md) (full flow) |
| Debug MQTT issues         | [Ch. 7](pages/mqtt_architecture.md) (topics), [Ch. 11](pages/resilience_patterns.md) (reconnect)           |
| Configure for production  | [Ch. 16](pages/configuration_reference.md) (env vars), [Ch. 14](pages/deployment.md) (Docker/K8s)          |
| Understand device setup   | [Ch. 10](pages/dataflow_architecture.md) (two-phase flow), [Ch. 5](pages/domain_model.md) (entities)       |
| Set up monitoring         | [Ch. 12](pages/observability.md) (Prometheus metrics, health checks)                                       |
| Proxy to protocol-gateway | [Ch. 8](pages/proxy_architecture.md) (circuit breaker, routes)                                             |
| WebSocket real-time data  | [Ch. 9](pages/websocket_bridge.md) (ref-counted subs, topic ACL)                                           |

---

## Technology Stack

| Component  | Technology          | Purpose                                       |
| ---------- | ------------------- | --------------------------------------------- |
| Runtime    | Node.js 20+         | LTS, ESM, TypeScript support                  |
| Framework  | Fastify 4.x         | High-performance HTTP server (2x Express)     |
| ORM        | Drizzle ORM         | Type-safe PostgreSQL queries, auto-migrations |
| Validation | Zod                 | Runtime + compile-time schema validation      |
| Logging    | Pino                | Zero-overhead structured logging              |
| MQTT       | mqtt.js 5.x         | MQTT 3.1.1/5.0 client (publish + subscribe)   |
| Auth       | jose                | OIDC JWT verification, JWKS auto-rotation     |
| Metrics    | prom-client         | Prometheus metrics (HTTP, WS, MQTT, proxy)    |
| Rate Limit | @fastify/rate-limit | Global + per-route throttling                 |
| WebSocket  | @fastify/websocket  | Native WS support for real-time bridge        |
| Build      | tsup                | ESM bundling, tree-shaking                    |
| Test       | Vitest              | Fast unit + integration testing               |

---

## Project Structure

```
services/gateway-core/
├── src/
│   ├── config/
│   │   └── env.ts                    # Zod-validated environment config (22 vars)
│   ├── db/
│   │   ├── index.ts                  # PostgreSQL pool + Drizzle instance
│   │   ├── schema.ts                 # Devices, Tags, AuditLog tables + enums
│   │   └── migrate.ts               # Auto-migration with retry + inline fallback
│   ├── lib/
│   │   ├── errors.ts                 # AppError, NotFound, Validation, Conflict, Unauthorized, Forbidden
│   │   ├── logger.ts                 # Pino logger (pretty in dev, JSON in prod)
│   │   └── metrics.ts               # Prometheus registry (HTTP, WS, MQTT, proxy metrics)
│   ├── middleware/
│   │   ├── auth.ts                   # JWT/JWKS validation via jose, role extraction
│   │   ├── rbac.ts                   # requireRole() / requireMinRole() preHandlers
│   │   └── audit.ts                  # Mutation audit logging to PostgreSQL
│   ├── mqtt/
│   │   ├── client.ts                 # MQTT publisher (config notifications, QoS 1)
│   │   ├── subscriber.ts            # Status ingest + config sync from protocol-gateway
│   │   └── transform.ts             # DB entity → protocol-gateway format mapping
│   ├── proxy/
│   │   ├── protocol-gateway.ts       # HTTP proxy + circuit breaker (5 failures → 30s open)
│   │   └── data-ingestion.ts         # Historian query proxy (15s timeout)
│   ├── routes/
│   │   ├── devices/                  # CRUD + toggle + test + browse + status
│   │   │   ├── routes.ts
│   │   │   ├── schema.ts
│   │   │   └── service.ts
│   │   ├── tags/                     # CRUD + bulk create + toggle
│   │   │   ├── routes.ts
│   │   │   ├── schema.ts
│   │   │   └── service.ts
│   │   ├── health/routes.ts          # /health, /health/ready, /health/live
│   │   ├── historian/routes.ts       # /api/historian/history (proxy→data-ingestion)
│   │   ├── opcua/routes.ts           # Certificate management (proxy→protocol-gateway)
│   │   ├── system/routes.ts          # Health aggregate, info, containers, logs, audit, topics
│   │   └── index.ts                  # Route barrel export
│   ├── websocket/
│   │   └── bridge.ts                 # MQTT→WS bridge, ref-counted subs, topic ACL
│   └── index.ts                      # App bootstrap, plugin registration, shutdown hooks
├── drizzle.config.ts                  # Drizzle ORM migration config
├── tsup.config.ts                     # Build config (ESM target)
├── tsconfig.json                      # TypeScript strict mode, ES2022
├── vitest.config.ts                   # Test runner config
├── package.json                       # Dependencies + scripts
└── Dockerfile                         # Multi-stage build (node:20-alpine)
```

---

_Document Version: 1.0_
_Last Updated: March 2026_
