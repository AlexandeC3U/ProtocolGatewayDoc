# NEXUS Edge — Documentation Portal

> Complete technical documentation for the NEXUS Edge Industrial IoT platform.
> Every service, infrastructure component, and platform-level concern — modular,
> deeply technical, diagram-rich, and production-oriented.

---

## Platform Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         NEXUS EDGE PLATFORM                                     │
│                                                                                 │
│  ┌───────────────────────────────── nexus-internal ─────────────────────────┐   │
│  │                                                                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐      │   │
│  │  │  Nginx   │  │  Web UI  │  │ Gateway Core │  │    Authentik     │      │   │
│  │  │  :80/443 │─►│  React   │  │  Fastify API │  │  OIDC Provider   │      │   │
│  │  │  reverse │  │  SPA     │─►│  WS Bridge   │  │  JWT / JWKS      │      │   │
│  │  │  proxy   │  └──────────┘  └──────┬───────┘  └──────────────────┘      │   │
│  │  └──────────┘                       │                                    │   │
│  │                    ┌────────────────┼────────────────┐                   │   │
│  │                    ▼                ▼                ▼                   │   │
│  │             ┌──────────┐    ┌──────────┐     ┌──────────────┐            │   │
│  │             │PostgreSQL│    │   EMQX   │     │ TimescaleDB  │            │   │
│  │             │Config DB │    │  MQTT    │     │  Historian   │            │   │
│  │             └──────────┘    └────┬─────┘     └──────┬───────┘            │   │
│  │                    ┌─────────────┼──────────────────┘                    │   │
│  │                    ▼             ▼                                       │   │
│  │             ┌──────────────┐  ┌──────────────┐                           │   │
│  │             │  Protocol    │  │    Data      │                           │   │
│  │             │  Gateway     │  │  Ingestion   │                           │   │
│  │             │  Go, 6 proto │  │  Go, COPY    │                           │   │
│  │             └───────┬──────┘  └──────────────┘                           │   │
│  │                     │                                                    │   │
│  └─────────────────────┼────────────────────────────────────────────────────┘   │
│                        │                                                        │
│  ┌──────── nexus-ot ───┼────────────────────────────────────────────────────┐   │
│  │                     ▼                                                    │   │
│  │          Industrial Devices (PLCs, sensors, RTUs)                        │   │
│  │          Modbus TCP/RTU, OPC UA, S7, MQTT, BACnet, EtherNet/IP           │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌──────── Observability ───────────────────────────────────────────────────┐   │
│  │  Prometheus :9090  ◄── scrape ──  all services                           │   │
│  │  Grafana :3000     ◄── query  ──  Prometheus + TimescaleDB + PostgreSQL  │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Start Here

Pick the path that matches your role:

| Role                   | Start With                                             | Then Read                                                                                       |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **New to the project** | [Getting Started](platform/GETTING_STARTED.md)         | [Architecture](ARCHITECTURE.md)                                                                 |
| **Developer**          | [Gateway Core](services/gateway-core/INDEX.md)         | [API Reference](platform/API_REFERENCE.md), [MQTT Topics](platform/MQTT_TOPIC_CONTRACT.md)      |
| **Ops / SRE**          | [Infrastructure](../docs/infrastructure/INDEX.md)      | [Operations Runbook](platform/OPERATIONS_RUNBOOK.md), [Security](platform/SECURITY_OVERVIEW.md) |
| **Data Engineer**      | [Data Ingestion](services/data-ingestion/INDEX.md)     | [MQTT Topics](platform/MQTT_TOPIC_CONTRACT.md)                                                  |
| **Frontend Dev**       | [Web UI](services/web-ui/INDEX.md)                     | [API Reference](platform/API_REFERENCE.md)                                                      |
| **OT / Protocols**     | [Protocol Gateway](services/protocol-gateway/INDEX.md) | [MQTT Topics](platform/MQTT_TOPIC_CONTRACT.md)                                                  |
| **Architect**          | [Platform Architecture](archive/PLATFORM_ARCHITECTURE.md)      | [Roadmap](ROADMAP.md)                                                                           |

---

## Service Documentation

Each service has a full documentation suite: INDEX overview, 15-19 deep-dive chapters in `pages/`.

| Service              | Language           | Purpose                                                           | Lines  | Docs                                        |
| -------------------- | ------------------ | ----------------------------------------------------------------- | ------ | ------------------------------------------- |
| **Protocol Gateway** | Go                 | Data plane — polls PLCs via Modbus, OPC UA, S7; publishes to MQTT | ~4,500 | [INDEX](services/protocol-gateway/INDEX.md) |
| **Gateway Core**     | TypeScript/Fastify | Control plane — REST API, device CRUD, config sync, WS bridge     | ~3,900 | [INDEX](services/gateway-core/INDEX.md)     |
| **Data Ingestion**   | Go                 | Historian — MQTT subscriber, batch COPY to TimescaleDB            | ~4,900 | [INDEX](services/data-ingestion/INDEX.md)   |
| **Web UI**           | React/TypeScript   | Industrial control room — device management, real-time monitoring | ~5,000 | [INDEX](services/web-ui/INDEX.md)           |

### Service Docs Structure

Every service follows the same modular structure (inspired by [protocol-gateway gold standard](services/protocol-gateway/INDEX.md)):

```
docs/services/<service>/
├── INDEX.md                        Overview, diagram, ToC, quick reference
└── pages/
    ├── summary.md                  Executive summary
    ├── system_overview.md          Architecture + dependency graph
    ├── architectural_principles.md Design decisions + trade-offs
    ├── layer_architecture.md       Code organization + module boundaries
    ├── domain_model.md             Entities, validation, error taxonomy
    ├── <domain-specific>.md        Service-specific deep dives (3-5 chapters)
    ├── dataflow_architecture.md    Read/write paths, message flows
    ├── resilience_patterns.md      Circuit breakers, retry, backpressure
    ├── observability.md            Metrics, logging, health checks
    ├── security_architecture.md    Auth, TLS, credential management
    ├── deployment.md               Docker, K8s, resource tuning
    ├── testing_strategy.md         Test pyramid, simulators, benchmarks
    ├── configuration_reference.md  All env vars, config files, defaults
    ├── edge_cases.md               Gotchas, operational notes
    └── appendices.md               Error codes, dependency inventory
```

---

## Infrastructure Documentation

Covers Docker Compose (dev), Kubernetes (prod), and every infrastructure component.

| Component                   | Docs                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------- |
| **Infrastructure Overview** | [INDEX](infrastructure/INDEX.md)                                                        |
| **Docker Compose**          | [Full breakdown](infrastructure/pages/docker_compose.md)                                |
| **Kubernetes (K3s)**        | [Manifests + Kustomize](infrastructure/pages/kubernetes.md)                             |
| **EMQX (MQTT Broker)**      | [Config + ACL + clustering](infrastructure/pages/emqx_configuration.md)                 |
| **PostgreSQL**              | [Two instances + pooling](infrastructure/pages/postgresql_architecture.md)              |
| **TimescaleDB**             | [Hypertables + compression + retention](infrastructure/pages/timescaledb_operations.md) |
| **Authentik**               | [OIDC + blueprints + groups](infrastructure/pages/authentik_architecture.md)            |
| **Nginx**                   | [Reverse proxy + routing + SSL](infrastructure/pages/nginx_configuration.md)            |
| **Prometheus + Grafana**    | [Scrape targets + dashboards](infrastructure/pages/observability_stack.md)              |
| **Network Architecture**    | [Docker networks + K8s networking](infrastructure/pages/network_architecture.md)        |
| **TLS / Certificates**      | [SSL termination + OPC UA PKI](infrastructure/pages/tls_certificates.md)                |
| **Security Hardening**      | [Container security + network segmentation](infrastructure/pages/security_hardening.md) |
| **Backup & Recovery**       | [DB backup + disaster recovery](infrastructure/pages/backup_recovery.md)                |
| **Scaling Playbook**        | [Vertical + horizontal + HPA](infrastructure/pages/scaling_playbook.md)                 |
| **Troubleshooting**         | [Common issues + diagnostics](infrastructure/pages/troubleshooting.md)                  |

---

## Platform-Level Documentation

Cross-cutting concerns that span multiple services.

| Document                                               | Purpose                                                  |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [Getting Started](platform/GETTING_STARTED.md)         | First deployment — prerequisites to first data point     |
| [Architecture](ARCHITECTURE.md)                        | Design principles, system layers, communication patterns |
| [Platform Architecture](archive/PLATFORM_ARCHITECTURE.md)      | Production topology, K8s deployment, data flows          |
| [API Reference](platform/API_REFERENCE.md)             | All REST + WebSocket endpoints (gateway-core)            |
| [MQTT Topic Contract](platform/MQTT_TOPIC_CONTRACT.md) | Complete topic taxonomy — config, data, status, commands |
| [Security Overview](platform/SECURITY_OVERVIEW.md)     | Authentication, authorization, network security, audit   |
| [Operations Runbook](platform/OPERATIONS_RUNBOOK.md)   | Day-2 operations — health checks, logs, common issues    |
| [Roadmap](ROADMAP.md)                                  | Strategic roadmap, version plan, feature priorities      |
| [Contributing](CONTRIBUTING.md)                        | Code style, PR process, branching strategy               |
| [Documentation Roadmap](DOCUMENTATION_ROADMAP.md)      | Docs work packages + progress tracking                   |

---

## Quick Reference — Ports

| Service          | Port     | Protocol  | Purpose                     |
| ---------------- | -------- | --------- | --------------------------- |
| Nginx            | 80 / 443 | HTTP(S)   | Public entry point          |
| Web UI           | 80       | HTTP      | React SPA (behind Nginx)    |
| Gateway Core     | 3001     | HTTP + WS | REST API + WebSocket bridge |
| Protocol Gateway | 8080     | HTTP      | Device management + metrics |
| Data Ingestion   | 8080     | HTTP      | Health + metrics            |
| PostgreSQL       | 5432     | PG        | Configuration database      |
| TimescaleDB      | 5433     | PG        | Historian (time-series)     |
| EMQX             | 1883     | MQTT      | Broker (TCP)                |
| EMQX             | 8083     | WS        | Broker (WebSocket)          |
| EMQX             | 8883     | MQTTS     | Broker (TLS)                |
| EMQX             | 18083    | HTTP      | Dashboard                   |
| Authentik        | 9000     | HTTP      | OIDC provider               |
| Prometheus       | 9090     | HTTP      | Metrics aggregation         |
| Grafana          | 3000     | HTTP      | Dashboards                  |

---

## Quick Reference — Tech Stack

| Layer                | Technology                                           | Version  |
| -------------------- | ---------------------------------------------------- | -------- |
| **API Gateway**      | Fastify 4.x, Drizzle ORM, Zod, Pino                  | Node 20+ |
| **Protocol Gateway** | Go, Clean Architecture, gopcua, gomodbus             | Go 1.22+ |
| **Data Ingestion**   | Go, pgx, zerolog, COPY protocol                      | Go 1.22+ |
| **Frontend**         | React 18, TanStack Query, shadcn/ui, TailwindCSS     | Vite 5.x |
| **Auth**             | Authentik 2026.2.1, OIDC, PKCE, JWKS, jose           |          |
| **MQTT**             | EMQX 5.x, shared subscriptions, QoS 1                |          |
| **Config DB**        | PostgreSQL 16                                        |          |
| **Historian**        | TimescaleDB 2.x (continuous aggregates, compression) |          |
| **Observability**    | Prometheus, Grafana, prom-client, zerolog            |          |
| **Reverse Proxy**    | Nginx (SSL termination, WS upgrade)                  |          |
| **Orchestration**    | Docker Compose (dev), K3s + Kustomize (prod)         |          |

---

## Documentation Stats

| Area                     | Files    | Lines        | Status      |
| ------------------------ | -------- | ------------ | ----------- |
| Protocol Gateway         | 20       | ~4,500       | Complete    |
| Gateway Core             | 19       | ~3,900       | Complete    |
| Data Ingestion           | 19       | ~4,900       | Complete    |
| Web UI                   | 18       | ~5,000       | Complete    |
| Infrastructure           | 18       | ~5,700       | Complete    |
| Platform (cross-cutting) | 8        | ~3,000       | In Progress |
| **Total**                | **~102** | **~27,000+** |             |

---

_Document Version: 1.0_
_Last Updated: March 2026_
