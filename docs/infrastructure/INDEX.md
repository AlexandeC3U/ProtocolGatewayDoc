# Infrastructure — Documentation Index

> Docker Compose for development, Kubernetes (K3s) for production.
> Every service containerized, every network segmented, every secret managed.

---

## Platform Topology

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         NEXUS EDGE PLATFORM                                     │
│                                                                                 │
│  ┌────────────────────────────────── nexus-internal ──────────────────────────┐ │
│  │                                                                            │ │
│  │  FRONTEND                          CONTROL PLANE                           │ │
│  │  ┌──────────┐  ┌──────────┐       ┌──────────────┐  ┌──────────────────┐   │ │
│  │  │  Nginx   │  │  Web UI  │       │ Gateway Core │  │    Authentik     │   │ │
│  │  │  :80/443 │─>│  :80     │       │  :3001       │  │  :9000 (server)  │   │ │
│  │  │          │─>│          │──────>│              │  │  worker          │   │ │
│  │  │  reverse │  │  React   │       │  Fastify API │  │  PostgreSQL DB   │   │ │
│  │  │  proxy   │  │  SPA     │       │  WS bridge   │  │                  │   │ │
│  │  └──────────┘  └──────────┘       └──────┬───────┘  └──────────────────┘   │ │
│  │       │                                   │                                │ │
│  │       │              ┌────────────────────┼────────────────┐               │ │
│  │       │              │                    │                │               │ │
│  │       ▼              ▼                    ▼                ▼               │ │
│  │  ┌──────────┐  ┌──────────┐       ┌──────────┐    ┌──────────────┐         │ │
│  │  │ Grafana  │  │PostgreSQL│       │   EMQX   │    │ TimescaleDB  │         │ │
│  │  │ :3000    │  │ :5432    │       │  :1883   │    │  :5432       │         │ │
│  │  │          │  │          │       │  :18083  │    │              │         │ │
│  │  │ Dashbds  │  │ Config DB│       │  MQTT    │    │  Historian   │         │ │
│  │  └──────────┘  └──────────┘       └────┬─────┘    └──────┬───────┘         │ │
│  │       │                                │                 │                 │ │
│  │       │              ┌─────────────────┼─────────────────┘                 │ │
│  │       │              │                 │                                   │ │
│  │       ▼              ▼                 ▼                                   │ │
│  │  ┌──────────┐  ┌──────────────┐  ┌──────────────┐                          │ │
│  │  │Prometheus│  │   Protocol   │  │    Data      │                          │ │
│  │  │ :9090    │  │   Gateway    │  │  Ingestion   │                          │ │
│  │  │          │  │  :8080       │  │  :8080       │                          │ │
│  │  │ Metrics  │  │  Go, 6 proto │  │  Go, COPY    │                          │ │
│  │  └──────────┘  └───────┬──────┘  └──────────────┘                          │ │
│  │                        │                                                   │ │
│  └────────────────────────┼───────────────────────────────────────────────────┘ │
│                           │                                                     │
│  ┌───────────── nexus-ot ─┼───────────────────────────────────────────────────┐ │
│  │                        │                                                   │ │
│  │                        ▼                                                   │ │
│  │               Industrial Devices (PLCs, sensors, RTUs)                     │ │
│  │               Modbus TCP, OPC UA, S7, MQTT, BACnet, EtherNet/IP            │ │
│  │                                                                            │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

| #   | Chapter                                                     | Description                                               |
| --- | ----------------------------------------------------------- | --------------------------------------------------------- |
| 1   | [Summary](pages/summary.md)                                 | Infrastructure philosophy, edge-first design              |
| 2   | [Network Architecture](pages/network_architecture.md)       | Docker networks, K8s networking, OT/IT segmentation       |
| 3   | [Docker Compose](pages/docker_compose.md)                   | Full service breakdown, deps, volumes, health checks      |
| 4   | [Kubernetes](pages/kubernetes.md)                           | Namespace, Kustomize, StatefulSet vs Deployment, overlays |
| 5   | [EMQX Configuration](pages/emqx_configuration.md)           | MQTT broker, clustering, ACLs, shared subscriptions       |
| 6   | [PostgreSQL Architecture](pages/postgresql_architecture.md) | Two databases, schemas, connection pooling                |
| 7   | [TimescaleDB Operations](pages/timescaledb_operations.md)   | Hypertables, compression, retention, aggregates           |
| 8   | [Authentik Architecture](pages/authentik_architecture.md)   | OIDC provider, blueprints, groups, branding               |
| 9   | [Nginx Configuration](pages/nginx_configuration.md)         | Reverse proxy, SSL, caching, security headers             |
| 10  | [Observability Stack](pages/observability_stack.md)         | Prometheus scrape targets, Grafana dashboards             |
| 11  | [TLS & Certificates](pages/tls_certificates.md)             | SSL termination, OPC UA PKI, cert rotation                |
| 12  | [Security Hardening](pages/security_hardening.md)           | Container security, network policies, secrets             |
| 13  | [Backup & Recovery](pages/backup_recovery.md)               | PostgreSQL backup, WAL, disaster recovery                 |
| 14  | [Scaling Playbook](pages/scaling_playbook.md)               | Horizontal/vertical scaling, capacity planning            |
| 15  | [Troubleshooting](pages/troubleshooting.md)                 | Common issues, debug commands, log analysis               |
| 16  | [Configuration Reference](pages/configuration_reference.md) | Master env var reference, port map, volume map            |
| 17  | [Edge Cases & Gotchas](pages/edge_cases.md)                 | Operational notes, known limitations                      |

---

## Quick Reference

| Concern               | Where to Look                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------ |
| Start all services    | `cd infrastructure/docker && docker compose up -d`                                         |
| Service ports         | [Configuration Reference](pages/configuration_reference.md) — port map table               |
| Environment variables | `infrastructure/docker/env.template`                                                       |
| EMQX dashboard        | `http://localhost:18083` (admin/public)                                                    |
| Grafana               | `http://localhost/grafana/` (admin/admin)                                                  |
| Authentik admin       | `http://localhost/auth/` (admin@nexus.local/nexus-admin)                                   |
| K8s dev deployment    | `kubectl apply -k infrastructure/k8s/overlays/dev`                                         |
| K8s prod deployment   | `kubectl apply -k infrastructure/k8s/overlays/prod`                                        |
| Network policies      | `infrastructure/k8s/base/network-policies.yaml`                                            |
| Secrets management    | `infrastructure/k8s/base/secrets.yaml` (dev), `overlays/prod/external-secrets.yaml` (prod) |

---

## Service Inventory

| Service          | Image                               | Type        | Port(s)                 | Replicas (Dev/Prod) | State           |
| ---------------- | ----------------------------------- | ----------- | ----------------------- | ------------------- | --------------- |
| EMQX             | emqx:5.3.2                          | StatefulSet | 1883, 8883, 8083, 18083 | 1 / 3               | Clustered       |
| TimescaleDB      | timescale/timescaledb:2.13.0-pg15   | StatefulSet | 5432                    | 1 / 1               | Persistent      |
| PostgreSQL       | postgres:15-alpine                  | StatefulSet | 5432 (5433 host)        | 1 / 1               | Persistent      |
| Gateway Core     | nexus/gateway-core                  | Deployment  | 3001                    | 1 / 1               | MQTT session    |
| Protocol Gateway | nexus/protocol-gateway              | StatefulSet | 8080                    | 1 / 3               | PLC connections |
| Data Ingestion   | nexus/data-ingestion                | Deployment  | 8080                    | 1 / 2-8 (HPA)       | Stateless       |
| Web UI           | nexus/web-ui                        | Deployment  | 80                      | 1 / 1               | Static          |
| Nginx            | nginx:alpine                        | Deployment  | 80, 443                 | 1 / 1               | Stateless       |
| Prometheus       | prom/prometheus:v2.48.0             | Deployment  | 9090                    | 1 / 1               | Persistent      |
| Grafana          | grafana/grafana:10.2.2              | Deployment  | 3000                    | 1 / 1               | Persistent      |
| Authentik Server | ghcr.io/goauthentik/server:2026.2.1 | Deployment  | 9000, 9443              | 1 / 1               | Stateless       |
| Authentik Worker | ghcr.io/goauthentik/server:2026.2.1 | Deployment  | —                       | 1 / 1               | Background      |
| Authentik DB     | postgres:16-alpine                  | StatefulSet | 5432                    | 1 / 1               | Persistent      |

---

## Deployment Tiers

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT STRATEGY                                          │
│                                                                                 │
│  DEVELOPMENT (Docker Compose)                                                   │
│  ├── Single machine (laptop / dev server)                                       │
│  ├── All services in one docker-compose.yml                                     │
│  ├── Minimal resources, single replicas                                         │
│  ├── Auth disabled by default                                                   │
│  └── Dev credentials in env.template                                            │
│                                                                                 │
│  STAGING (K8s — dev overlay)                                                    │
│  ├── K3s single-node or minikube                                                │
│  ├── Reduced replicas and storage                                               │
│  ├── Lower resource requests/limits                                             │
│  ├── Auth optional                                                              │
│  └── Base64 secrets in manifests                                                │
│                                                                                 │
│  PRODUCTION (K8s — prod overlay)                                                │
│  ├── Multi-node K3s / K8s cluster                                               │
│  ├── EMQX 3-node cluster, protocol-gateway 3 replicas                           │
│  ├── HPA for data-ingestion (2-8 pods)                                          │
│  ├── Network policies (least privilege)                                         │
│  ├── Auth required (Authentik OIDC)                                             │
│  ├── External Secrets Operator for credentials                                  │
│  └── Pod disruption budgets for HA                                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
infrastructure/
├── infrastructure.md                          # Existing architecture overview
├── docker/
│   ├── docker-compose.yml                     # All services (~573 lines)
│   ├── env.template                           # Environment variables template
│   └── config/
│       ├── nginx/
│       │   ├── nginx.conf                     # Reverse proxy config
│       │   └── ssl/                           # SSL certificates
│       ├── emqx/
│       │   ├── emqx.conf                      # Broker config (clustering, auth, limits)
│       │   ├── acl.conf                       # Topic-level access control
│       │   └── healthcheck.sh                 # Custom health check script
│       ├── postgres/
│       │   └── init.sql                       # Config DB schema (devices, tags, audit)
│       ├── timescaledb/
│       │   └── init.sql                       # Historian schema (hypertable, aggregates)
│       ├── authentik/
│       │   ├── blueprints/nexus-setup.yaml    # Auto-provisioning (OIDC, groups)
│       │   └── branding/custom.css            # Delaware branding
│       ├── prometheus/
│       │   └── prometheus.yml                 # Scrape targets, relabel rules
│       └── grafana/provisioning/
│           ├── dashboards/dashboards.yml      # Dashboard provisioning config
│           └── datasources/datasources.yml    # Prometheus + TimescaleDB + PG
└── k8s/
    ├── README.md                              # K8s deployment guide
    ├── base/
    │   ├── kustomization.yaml                 # Base resource list
    │   ├── namespace.yaml                     # nexus namespace
    │   ├── configmap.yaml                     # Non-secret configuration
    │   ├── secrets.yaml                       # Dev-default secrets (base64)
    │   ├── network-policies.yaml              # Least-privilege network rules
    │   ├── resource-controls.yaml             # ResourceQuota + LimitRange
    │   └── servicemonitors.yaml               # Prometheus ServiceMonitors
    ├── services/
    │   ├── authentik/                         # Server, worker, DB, secrets
    │   ├── data-ingestion/                    # Deployment, HPA, PDB, ServiceMonitor
    │   ├── emqx/                              # StatefulSet, headless service
    │   ├── gateway-core/                      # Deployment, service
    │   ├── postgres/                          # StatefulSet, service
    │   ├── protocol-gateway/                  # StatefulSet, devices ConfigMap
    │   └── timescaledb/                       # StatefulSet, init ConfigMap, exporter
    └── overlays/
        ├── dev/kustomization.yaml             # Low resources, 1 replica
        └── prod/
            ├── kustomization.yaml             # HA replicas, high resources
            ├── external-secrets.yaml          # ESO integration
            └── secrets-patch.yaml             # Manual secret override
```

---

_Document Version: 1.0_
_Last Updated: March 2026_
