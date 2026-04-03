# Chapter 1 — Summary

> Infrastructure philosophy: edge-first, containerized, dual-tier deployment,
> OT/IT segmented, observable, and production-hardened.

---

## Purpose

The NEXUS Edge infrastructure provides the runtime environment for all platform
services. It manages:

- **Container orchestration** — Docker Compose (dev) and Kubernetes (prod)
- **Message broker** — EMQX for MQTT-based communication
- **Databases** — PostgreSQL (config) and TimescaleDB (time-series)
- **Authentication** — Authentik as OIDC identity provider
- **Reverse proxy** — Nginx for routing, SSL, and caching
- **Observability** — Prometheus metrics collection, Grafana dashboards
- **Network segmentation** — IT (services) and OT (industrial devices) separation

---

## Design Principles

### Edge-First

NEXUS Edge is designed to run **at the plant floor**, not in the cloud. This means:

- **Self-contained** — all services run on a single machine or small cluster
- **Low resource footprint** — production runs on 8-16GB RAM, 4-8 cores
- **Offline capable** — no cloud dependency for core data collection
- **Local network** — services communicate over internal Docker/K8s networks

### Same Images, Different Orchestration

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT STRATEGY                                          │
│                                                                                 │
│  Source Code                                                                    │
│       │                                                                         │
│       ▼                                                                         │
│  Docker Image (same image for all tiers)                                        │
│       │                                                                         │
│       ├──> Docker Compose                                                       │
│       │    ├── Development / testing                                            │
│       │    ├── Single machine                                                   │
│       │    ├── docker-compose.yml + env.template                                │
│       │    └── `docker compose up -d`                                           │
│       │                                                                         │
│       └──> Kubernetes (K3s)                                                     │
│            ├── Staging / production                                             │
│            ├── Single-node or multi-node                                        │
│            ├── Kustomize base + overlays (dev/prod)                             │
│            └── `kubectl apply -k overlays/prod`                                 │
│                                                                                 │
│  The SAME container images deploy to both tiers.                                │
│  Only configuration (env vars, replicas, resources) differs.                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Two Databases, Two Purposes

| Database          | Engine             | Purpose                              | Growth Pattern    | Size  |
| ----------------- | ------------------ | ------------------------------------ | ----------------- | ----- |
| `nexus_config`    | PostgreSQL 15      | Device/tag configuration, audit logs | Stable (<1GB)     | Small |
| `nexus_historian` | TimescaleDB (PG15) | Time-series metrics from devices     | Linear (GB/month) | Large |

**Why separate?** Different performance profiles (OLTP vs OLAP), different retention
policies, different backup strategies, different scaling patterns.

### OT/IT Network Segmentation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  IT NETWORK (nexus-internal)                 OT NETWORK (nexus-ot)              │
│  ┌──────────────────────────────┐           ┌──────────────────────────┐        │
│  │                              │           │                          │        │
│  │  Web UI, Gateway Core,       │           │  Protocol Gateway        │        │
│  │  Databases, Grafana,         │           │  (only service bridging  │        │
│  │  Prometheus, Authentik       │           │   both networks)         │        │
│  │                              │           │                          │        │
│  │  172.28.0.0/16               │           │  Plant floor devices:    │        │
│  │                              │ ◄───────► │  PLCs, sensors, RTUs     │        │
│  │  No direct access to         │  Protocol │  192.168.x.x / 10.x.x.x  │        │
│  │  industrial devices          │  Gateway  │                          │        │
│  │                              │  bridges  │                          │        │
│  └──────────────────────────────┘           └──────────────────────────┘        │
│                                                                                 │
│  Only the Protocol Gateway has access to both networks.                         │
│  All other services are isolated from the OT network.                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Service Categories

| Category          | Services                         | Purpose                                         |
| ----------------- | -------------------------------- | ----------------------------------------------- |
| **Frontend**      | Nginx, Web UI                    | User interface, reverse proxy                   |
| **Control Plane** | Gateway Core                     | API, config management, MQTT bridge             |
| **Data Plane**    | Protocol Gateway, Data Ingestion | Device polling, data pipeline                   |
| **Messaging**     | EMQX                             | MQTT broker for all inter-service communication |
| **Storage**       | PostgreSQL, TimescaleDB          | Configuration and time-series data              |
| **Auth**          | Authentik (server, worker, DB)   | SSO, OIDC, group/role management                |
| **Observability** | Prometheus, Grafana              | Metrics collection and visualization            |

---

## Resource Baseline

| Tier        | CPU      | RAM   | Disk   | Services                           |
| ----------- | -------- | ----- | ------ | ---------------------------------- |
| Development | 4 cores  | 8GB   | 20GB   | All (single replica)               |
| Staging     | 4 cores  | 16GB  | 50GB   | All (single replica, auth enabled) |
| Production  | 8+ cores | 32GB+ | 200GB+ | All (HA replicas, full monitoring) |

---

## Related Documentation

- [Network Architecture](network_architecture.md) — detailed network topology
- [Docker Compose](docker_compose.md) — development deployment guide
- [Kubernetes](kubernetes.md) — production deployment guide
- [Scaling Playbook](scaling_playbook.md) — capacity planning and scaling

---

_Document Version: 1.0_
_Last Updated: March 2026_
