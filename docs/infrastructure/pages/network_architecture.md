# Chapter 2 — Network Architecture

> Docker networks, Kubernetes networking, service discovery, DNS resolution,
> OT/IT segmentation, and network policies.

---

## Docker Compose Networks

### Network Definitions

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                    DOCKER NETWORK TOPOLOGY                                     │
│                                                                                │
│  nexus-internal (172.28.0.0/16)                                                │
│  ┌────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                        │    │
│  │  ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────┐ ┌───────────┐            │    │
│  │  │ nginx  │ │ web-ui  │ │ gateway  │ │ emqx │ │ postgres  │            │    │
│  │  │        │ │         │ │  core    │ │      │ │           │            │    │
│  │  └────────┘ └─────────┘ └──────────┘ └──────┘ └───────────┘            │    │
│  │                                                                        │    │
│  │  ┌────────────┐ ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌─────────┐   │    │
│  │  │ timescaledb│ │ data-     │ │ protocol- │ │prometheus│ │ grafana │   │    │
│  │  │            │ │ ingestion │ │ gateway   │ │          │ │         │   │    │
│  │  └────────────┘ └───────────┘ └─────┬─────┘ └──────────┘ └─────────┘   │    │
│  │                                     │                                  │    │
│  │  ┌──────────────┐ ┌──────────────┐  │                                  │    │
│  │  │ authentik-   │ │ authentik-   │  │                                  │    │
│  │  │ server       │ │ worker       │  │                                  │    │
│  │  └──────────────┘ └──────────────┘  │                                  │    │
│  │                                     │                                  │    │
│  └─────────────────────────────────────┼──────────────────────────────────┘    │
│                                        │                                       │
│  nexus-ot (OT bridge network)          │                                       │
│  ┌─────────────────────────────────────┼─────────────────────────────────┐     │
│  │                                     │                                 │     │
│  │                               ┌─────┴──────┐                          │     │
│  │                               │ protocol-  │   Only this service      │     │
│  │                               │ gateway    │   bridges both networks  │     │
│  │                               └──────┬─────┘                          │     │
│  │                                      │                                │     │
│  │                          ┌───────────┼───────────┐                    │     │
│  │                          ▼           ▼           ▼                    │     │
│  │                    ┌──────────┐ ┌──────────┐ ┌──────────┐             │     │
│  │                    │ Modbus   │ │ OPC UA   │ │ S7 PLC   │             │     │
│  │                    │ Device   │ │ Server   │ │          │             │     │
│  │                    └──────────┘ └──────────┘ └──────────┘             │     │
│  │                                                                       │     │
│  └───────────────────────────────────────────────────────────────────────┘     │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### Service Network Membership

| Service          | nexus-internal | nexus-ot | Why                                    |
| ---------------- | :------------: | :------: | -------------------------------------- |
| Nginx            |       ✓        |          | Reverse proxy for all services         |
| Web UI           |       ✓        |          | Frontend, no device access needed      |
| Gateway Core     |       ✓        |          | Control plane, talks to DB + MQTT      |
| EMQX             |       ✓        |          | Message broker, internal only          |
| PostgreSQL       |       ✓        |          | Config DB, internal only               |
| TimescaleDB      |       ✓        |          | Historian, internal only               |
| Data Ingestion   |       ✓        |          | Subscribes to MQTT, writes to DB       |
| Protocol Gateway |       ✓        |    ✓     | **Bridge** — talks to MQTT AND devices |
| Prometheus       |       ✓        |          | Scrapes metrics from all services      |
| Grafana          |       ✓        |          | Queries Prometheus + databases         |
| Authentik        |       ✓        |          | Auth provider, internal only           |

---

## Docker DNS Resolution

Docker Compose provides automatic DNS resolution using container/service names:

| DNS Name                    | Resolves To                   | Used By                                        |
| --------------------------- | ----------------------------- | ---------------------------------------------- |
| `emqx`                      | EMQX container IP             | gateway-core, protocol-gateway, data-ingestion |
| `postgres`                  | PostgreSQL container IP       | gateway-core                                   |
| `historian` / `timescaledb` | TimescaleDB container IP      | data-ingestion, grafana                        |
| `gateway-core`              | Gateway Core container IP     | nginx, web-ui                                  |
| `protocol-gateway`          | Protocol Gateway container IP | gateway-core (proxy)                           |
| `grafana`                   | Grafana container IP          | nginx                                          |
| `authentik-server`          | Authentik container IP        | nginx                                          |
| `prometheus`                | Prometheus container IP       | grafana                                        |

---

## Kubernetes Networking

### Service Discovery

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    KUBERNETES DNS RESOLUTION                                    │
│                                                                                 │
│  Service Type        DNS Format                           Example               │
│  ──────────────────  ────────────────────────────────────  ──────────────────── │
│  ClusterIP Service   {svc}.{ns}.svc.cluster.local         emqx.nexus.svc...     │
│  Headless Service    {pod}.{svc}.{ns}.svc.cluster.local   emqx-0.emqx-head...   │
│  Short form          {svc} (within same namespace)        emqx                  │
│                                                                                 │
│  StatefulSet pods get stable DNS names:                                         │
│  emqx-0.emqx-headless.nexus.svc.cluster.local                                   │
│  emqx-1.emqx-headless.nexus.svc.cluster.local                                   │
│  emqx-2.emqx-headless.nexus.svc.cluster.local                                   │
│                                                                                 │
│  This is critical for EMQX Erlang clustering (nodes need stable identities).    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Network Policies (Least Privilege)

Kubernetes network policies enforce service-to-service access control:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    NETWORK POLICY MATRIX                                        │
│                                                                                 │
│                  To:                                                            │
│  From:           PG   TSDB  EMQX  GW-Core  PG-GW  DI   Nginx  Authentik         │
│  ─────────────  ───  ────  ────  ───────  ─────  ───  ─────  ─────────          │
│  Gateway Core    v    ─     v      ─       v      ─    ─      v (JWKS)          │
│  Proto Gateway   ─    ─     v      ─       ─      ─    ─      ─                 │
│  Data Ingestion  ─    v     v      ─       ─      ─    ─      ─                 │
│  Nginx           ─    ─     ─      v       ─      ─    ─      v                 │
│  Grafana         ─    v     ─      ─       ─      ─    ─      ─                 │
│  Prometheus      ─    ─     v      v       v      v    ─      ─                 │
│                                                                                 │
│  PG = PostgreSQL (config), TSDB = TimescaleDB, PG-GW = Protocol Gateway         │
│  DI = Data Ingestion, v = allowed, ─ = denied by default-deny policy            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Default deny-all:** All ingress and egress traffic is blocked unless explicitly
allowed by a NetworkPolicy.

**Key rules:**

- PostgreSQL only accepts from Gateway Core (port 5432)
- TimescaleDB only accepts from Data Ingestion (port 5432)
- EMQX accepts MQTT from Gateway Core, Protocol Gateway, Data Ingestion (port 1883)
- Protocol Gateway egress includes private IP ranges (10.0.0.0/8, 172.16.0.0/12,
  192.168.0.0/16) for reaching PLCs on the OT network
- All services can reach DNS (kube-dns, port 53)

---

## Port Map

### External Ports (Host-Accessible)

| Port  | Service      | Protocol | Purpose                                         |
| ----- | ------------ | -------- | ----------------------------------------------- |
| 80    | Nginx        | HTTP     | Main entry point (Web UI + API proxy)           |
| 443   | Nginx        | HTTPS    | SSL-terminated entry point                      |
| 1884  | EMQX         | MQTT     | MQTT TCP (mapped from 1883)                     |
| 8883  | EMQX         | MQTTS    | MQTT over TLS                                   |
| 8083  | EMQX         | WS       | MQTT over WebSocket                             |
| 18083 | EMQX         | HTTP     | EMQX Dashboard                                  |
| 3001  | Gateway Core | HTTP     | REST API (direct, bypasses Nginx)               |
| 5432  | TimescaleDB  | PG       | Historian database                              |
| 5433  | PostgreSQL   | PG       | Config database (host-mapped to avoid conflict) |
| 9090  | Prometheus   | HTTP     | Metrics UI                                      |
| 9000  | Authentik    | HTTP     | OIDC provider                                   |

### Internal Ports (Container-to-Container)

| Port      | Service          | Protocol | Used By                      |
| --------- | ---------------- | -------- | ---------------------------- |
| 1883      | EMQX             | MQTT     | All services (internal MQTT) |
| 3001      | Gateway Core     | HTTP     | Nginx proxy, Web UI          |
| 8080      | Protocol Gateway | HTTP     | Gateway Core proxy           |
| 8080      | Data Ingestion   | HTTP     | Health checks                |
| 5432      | PostgreSQL       | PG       | Gateway Core                 |
| 5432      | TimescaleDB      | PG       | Data Ingestion, Grafana      |
| 3000      | Grafana          | HTTP     | Nginx proxy                  |
| 9000      | Authentik        | HTTP     | Nginx proxy                  |
| 4370/5370 | EMQX             | TCP      | Erlang cluster (K8s only)    |

---

## Related Documentation

- [Docker Compose](docker_compose.md) — network configuration in docker-compose.yml
- [Kubernetes](kubernetes.md) — K8s networking and service definitions
- [Security Hardening](security_hardening.md) — network policy details
- [EMQX Configuration](emqx_configuration.md) — MQTT port and listener setup

---

_Document Version: 1.0_
_Last Updated: March 2026_
