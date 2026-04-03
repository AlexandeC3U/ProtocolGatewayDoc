# Chapter 2 — System Overview

> High-level architecture, dependency graph, and technology stack.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              GATEWAY CORE SERVICE                                   │
│                                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                            FASTIFY SERVER (:3001)                             │  │
│  │                                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │  │
│  │  │  Helmet  │  │   CORS   │  │Rate Limit│  │ Swagger  │  │  Prom Metrics    │ │  │
│  │  │ (headers)│  │ (origins)│  │ (opt-in) │  │  /docs   │  │  /metrics        │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │  │
│  │                                                                               │  │
│  │  ┌──────────────────────────── MIDDLEWARE ─────────────────────────────────┐  │  │
│  │  │  Auth (JWT/JWKS) ──> RBAC (role check) ──> Audit (log mutations)        │  │  │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │  │
│  │  │ /health  │  │  /api/   │  │/api/tags │  │/api/opcua│  │/api/     │         │  │
│  │  │ (probes) │  │ devices  │  │ (CRUD+)  │  │ (certs)  │  │ system   │         │  │
│  │  └────┬─────┘  └────┬─────┘  └─────┬────┘  └────┬─────┘  └─────┬────┘         │  │
│  │       │             │              │            │              │              │  │
│  │       └─────────────┴──────────────┴────────────┴──────────────┘              │  │
│  │                                    │                                          │  │
│  │                             ┌──────▼──────┐                                   │  │
│  │                             │  Services   │                                   │  │
│  │                             │ (business   │                                   │  │
│  │                             │  logic)     │                                   │  │
│  │                             └──────┬──────┘                                   │  │
│  └────────────────────────────────────┼──────────────────────────────────────────┘  │
│                                       │                                             │
│  ┌────────────────────────────────────┼──────────────────────────────────────────┐  │
│  │                              DATA LAYER                                       │  │
│  │                                                                               │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │  Drizzle ORM │  │ MQTT Client  │  │  HTTP Proxy  │  │  WebSocket       │   │  │
│  │  │              │  │              │  │              │  │  Bridge          │   │  │
│  │  │ • Devices    │  │ • Publish    │  │ • Protocol-  │  │                  │   │  │
│  │  │ • Tags       │  │   configs    │  │   Gateway    │  │ • MQTT→WS        │   │  │
│  │  │ • AuditLog   │  │ • Subscribe  │  │ • Data-      │  │ • Ref-counted    │   │  │
│  │  │ • Migrations │  │   status     │  │   Ingestion  │  │ • Topic ACL      │   │  │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘   │  │
│  └─────────┼─────────────────┼─────────────────┼───────────────────┼─────────────┘  │
│            │                 │                 │                   │                │
│            ▼                 ▼                 ▼                   ▼                │
│   ┌────────────────┐ ┌──────────────┐ ┌────────────────┐  ┌───────────────┐         │
│   │  PostgreSQL    │ │  EMQX MQTT   │ │ Protocol-      │  │ Browser WS    │         │
│   │  (nexus_config)│ │  Broker      │ │ Gateway :8080  │  │ Clients       │         │
│   └────────────────┘ └──────────────┘ │ Data-Ingestion │  └───────────────┘         │
│                                       │ :8080          │                            │
│                                       └────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

## Dependency Graph

```
                     ┌──────────────┐
                     │ gateway-core │
                     └──────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
            ▼               ▼               ▼
     ┌──────────┐    ┌──────────┐    ┌──────────────────┐
     │PostgreSQL│    │   EMQX   │    │ protocol-gateway │
     │ :5432    │    │  :1883   │    │ :8080 (optional) │
     └──────────┘    └──────────┘    └──────────────────┘
     Required         Required        Optional (proxy
     (config DB)      (pub/sub)       targets degrade
                                      gracefully)
```

**Startup dependencies:**

1. PostgreSQL must be healthy (migrations run on startup)
2. EMQX must be healthy (subscribe to status topics)
3. Protocol-gateway is optional — proxy calls fail with circuit breaker

## Port Map

| Port | Service                     | Protocol               |
| ---- | --------------------------- | ---------------------- |
| 3001 | Gateway Core HTTP API       | HTTP/REST              |
| 3001 | Gateway Core WebSocket      | WS (upgrade from HTTP) |
| 5432 | PostgreSQL (internal)       | TCP                    |
| 1883 | EMQX MQTT (internal)        | MQTT                   |
| 8080 | Protocol-Gateway (internal) | HTTP                   |
| 8080 | Data-Ingestion (internal)   | HTTP                   |

## Request Lifecycle

```
Browser/Client
    │
    ▼
┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Helmet  │──>│   CORS   │──>│   Auth   │──>│   RBAC   │──>│  Route   │
│ (headers)│   │ (origin) │   │ (JWT)    │   │ (role)   │   │ Handler  │
└──────────┘   └──────────┘   └──────────┘   └──────────┘   └────┬─────┘
                                                                 │
                                                           ┌─────▼───────┐
                                                           │   Service   │
                                                           │ (business   │
                                                           │  logic)     │
                                                           └──────┬──────┘
                                                                  │
                                                    ┌─────────────┼─────────────┐
                                                    │             │             │
                                                    ▼             ▼             ▼
                                               PostgreSQL    MQTT Publish   HTTP Proxy
                                                                  │
                                                           ┌──────▼──────┐
                                                           │   Audit     │
                                                           │ (onResponse)│
                                                           └──────┬──────┘
                                                                  │
                                                                  ▼
                                                            JSON Response
```

---

_Previous: [Chapter 1 — Executive Summary](summary.md) | Next: [Chapter 3 — Architectural Principles](architectural_principles.md)_
