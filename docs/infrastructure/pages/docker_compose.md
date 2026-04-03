# Chapter 3 — Docker Compose

> Full service-by-service breakdown of docker-compose.yml — dependencies,
> volumes, health checks, environment variables, and resource tuning.

---

## Overview

The Docker Compose file defines **13 services** across 2 networks with 10+ persistent
volumes. It serves as the **development and single-node deployment** platform.

```bash
cd infrastructure/docker
cp env.template .env          # Copy and edit credentials
docker compose up -d          # Start all services
docker compose ps             # Check service status
docker compose logs -f        # Follow all logs
```

---

## Service Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STARTUP ORDER (depends_on + health checks)                   │
│                                                                                 │
│  Phase 1: Databases + Broker (no dependencies)                                  │
│  ┌────────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐     │
│  │   PostgreSQL   │  │  TimescaleDB  │  │     EMQX      │  │ Authentik DB │     │
│  │   (config)     │  │  (historian)  │  │   (MQTT)      │  │ (auth store) │     │
│  └───────┬────────┘  └───────┬───────┘  └────────┬──────┘  └────────┬─────┘     │
│          │                   │                   │                  │           │
│  Phase 2: Core services (depend on Phase 1)      │                  │           │
│          ▼                   │                   ▼                  ▼           │
│  ┌───────────────┐           │           ┌───────────────┐  ┌──────────────┐    │
│  │ Gateway Core  │           │           │   Protocol    │  │  Authentik   │    │
│  │ (needs PG     │           │           │   Gateway     │  │  Server      │    │
│  │  + EMQX)      │           │           │  (needs EMQX) │  │ (needs DB)   │    │
│  └───────┬───────┘           │           └───────────────┘  └──────────────┘    │
│          │                   │                                      │           │
│  Phase 3: Dependent services │                                      │           │
│          ▼                   ▼                                      ▼           │
│  ┌───────────────┐  ┌───────────────┐                      ┌──────────────┐     │
│  │    Web UI     │  │Data Ingestion │                      │  Authentik   │     │
│  │(needs GW-Core)│  │(needs EMQX    │                      │  Worker      │     │
│  │               │  │ + TimescaleDB)│                      │              │     │
│  └───────────────┘  └───────────────┘                      └──────────────┘     │
│                                                                                 │
│  Phase 4: Observability + Proxy                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                        │
│  │  Prometheus   │  │   Grafana     │  │    Nginx      │                        │
│  │ (scrapes all) │  │(needs Prom    │  │(needs all     │                        │
│  │               │  │ + databases)  │  │ upstream svcs)│                        │
│  └───────────────┘  └───────────────┘  └───────────────┘                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Infrastructure Services

### EMQX MQTT Broker (v5.3.2)

```yaml
nexus-emqx:
  image: emqx/emqx:5.3.2
  container_name: nexus-emqx
  ports:
    - '1884:1883' # MQTT TCP (host 1884 to avoid conflicts)
    - '8883:8883' # MQTT SSL
    - '8083:8083' # MQTT WebSocket
    - '8084:8084' # WebSocket SSL
    - '18083:18083' # Dashboard
  volumes:
    - emqx-data:/opt/emqx/data
    - emqx-log:/opt/emqx/log
    - ./config/emqx/emqx.conf:/opt/emqx/etc/emqx.conf:ro
    - ./config/emqx/acl.conf:/opt/emqx/etc/acl.conf:ro
    - ./config/emqx/healthcheck.sh:/opt/emqx/healthcheck.sh
  environment:
    EMQX_CLUSTER__DISCOVERY_STRATEGY: static # Single-node for dev
    EMQX_NODE__COOKIE: nexus_secret_cookie
    EMQX_DASHBOARD__DEFAULT_USERNAME: admin
    EMQX_DASHBOARD__DEFAULT_PASSWORD: ${EMQX_DASHBOARD_PASSWORD:-public}
  healthcheck:
    test: ['CMD', 'bash', '/opt/emqx/healthcheck.sh']
    interval: 15s
    timeout: 10s
    retries: 5
  networks:
    - nexus-internal
```

**Key tuning** (in emqx.conf):

- `max_connections: 100000`
- `max_topic_levels: 10`
- Shared subscriptions: enabled (required for data-ingestion horizontal scaling)

### TimescaleDB (v2.13.0-pg15)

```yaml
nexus-historian:
  image: timescale/timescaledb:2.13.0-pg15
  container_name: nexus-historian
  ports:
    - '5432:5432'
  environment:
    POSTGRES_DB: nexus_historian
    POSTGRES_USER: ${HISTORIAN_USER:-postgres}
    POSTGRES_PASSWORD: ${HISTORIAN_PASSWORD}
  command: >
    postgres
      -c shared_buffers=1GB
      -c effective_cache_size=3GB
      -c work_mem=64MB
      -c maintenance_work_mem=512MB
      -c max_connections=200
      -c shared_preload_libraries=timescaledb
  volumes:
    - timescale-data:/var/lib/postgresql/data
    - ./config/timescaledb/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U postgres']
    interval: 10s
    timeout: 5s
    retries: 5
  networks:
    - nexus-internal
```

### PostgreSQL (Config Store, v15-alpine)

```yaml
nexus-postgres:
  image: postgres:15-alpine
  container_name: nexus-postgres
  ports:
    - '5433:5432' # Host port 5433 to avoid conflict with TimescaleDB
  environment:
    POSTGRES_DB: nexus_config
    POSTGRES_USER: ${POSTGRES_USER:-nexus}
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
  volumes:
    - postgres-data:/var/lib/postgresql/data
    - ./config/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
  healthcheck:
    test: ['CMD-SHELL', 'pg_isready -U nexus -d nexus_config']
    interval: 10s
    timeout: 5s
    retries: 5
  networks:
    - nexus-internal
```

---

## Application Services

### Gateway Core

```yaml
nexus-gateway-core:
  build: ../../services/gateway-core
  container_name: nexus-gateway-core
  ports:
    - '3001:3001'
  environment:
    DATABASE_URL: postgresql://nexus:${POSTGRES_PASSWORD}@postgres:5432/nexus_config
    MQTT_BROKER_URL: mqtt://emqx:1883
    PROTOCOL_GATEWAY_URL: http://protocol-gateway:8080
    AUTH_ENABLED: ${AUTH_ENABLED:-false}
    AUDIT_ENABLED: ${AUDIT_ENABLED:-true}
    RATE_LIMIT_ENABLED: ${RATE_LIMIT_ENABLED:-false}
    OIDC_ISSUER_URL: http://localhost:9000/application/o/nexus-gateway/
  depends_on:
    nexus-postgres:
      condition: service_healthy
    nexus-emqx:
      condition: service_healthy
  healthcheck:
    test: ['CMD', 'wget', '-q', '--spider', 'http://localhost:3001/health/live']
    interval: 15s
    timeout: 5s
    retries: 3
  networks:
    - nexus-internal
```

### Protocol Gateway

```yaml
nexus-protocol-gateway:
  build: ../../services/protocol-gateway
  container_name: nexus-protocol-gateway
  ports:
    - '8085:8080'
  environment:
    MQTT_BROKER_URL: tcp://emqx:1883
    HTTP_PORT: 8080
    GOMAXPROCS: 4
    GOGC: 100
  depends_on:
    nexus-emqx:
      condition: service_healthy
  volumes:
    - protocol-gateway-pki:/app/certs/pki # OPC UA trust store
  networks:
    - nexus-internal
    - nexus-ot # Bridge to OT network for device access
```

### Data Ingestion

```yaml
nexus-data-ingestion:
  build: ../../services/data-ingestion
  container_name: nexus-data-ingestion
  ports:
    - '7000:8080'
  environment:
    INGESTION_MQTT_BROKER_URL: tcp://emqx:1883
    MQTT_CLIENT_ID: data-ingestion-1
    INGESTION_MQTT_TOPIC: '$share/ingestion/dev/#'
    INGESTION_DB_HOST: historian
    INGESTION_DB_NAME: nexus_historian
    INGESTION_DB_USER: nexus_ingestion
    INGESTION_DB_PASSWORD: ${INGESTION_DB_PASSWORD}
    GOMAXPROCS: 4
    GOGC: 100
  depends_on:
    nexus-emqx:
      condition: service_healthy
    nexus-historian:
      condition: service_healthy
  networks:
    - nexus-internal
```

---

## Volumes

| Volume                 | Service          | Purpose                          | Persistence |
| ---------------------- | ---------------- | -------------------------------- | ----------- |
| `postgres-data`        | PostgreSQL       | Config DB data                   | Required    |
| `timescale-data`       | TimescaleDB      | Historian data                   | Required    |
| `emqx-data`            | EMQX             | Cluster state, retained messages | Required    |
| `emqx-log`             | EMQX             | Broker logs                      | Optional    |
| `protocol-gateway-pki` | Protocol Gateway | OPC UA PKI trust store           | Required    |
| `gateway-logs`         | Gateway Core     | Application logs                 | Optional    |
| `authentik-data`       | Authentik        | Auth provider data               | Required    |
| `authentik-db-data`    | Authentik DB     | Auth database                    | Required    |
| `prometheus-data`      | Prometheus       | Metrics TSDB                     | Recommended |
| `grafana-data`         | Grafana          | Dashboards, preferences          | Recommended |

---

## Health Check Summary

| Service      | Check Method                    | Interval | Retries | Timeout |
| ------------ | ------------------------------- | -------- | ------- | ------- |
| EMQX         | Custom shell script (TCP probe) | 15s      | 5       | 10s     |
| TimescaleDB  | `pg_isready`                    | 10s      | 5       | 5s      |
| PostgreSQL   | `pg_isready`                    | 10s      | 5       | 5s      |
| Gateway Core | HTTP GET /health/live           | 15s      | 3       | 5s      |
| Web UI       | HTTP GET /                      | 30s      | 3       | 3s      |
| Authentik    | HTTP GET /-/health/live/        | 30s      | 3       | 10s     |

---

## Common Operations

```bash
# Start all services
docker compose up -d

# Start specific service and dependencies
docker compose up -d gateway-core

# View logs for a service
docker compose logs -f nexus-gateway-core

# Restart a service
docker compose restart nexus-emqx

# Scale data-ingestion (for load testing)
docker compose up -d --scale nexus-data-ingestion=3

# Stop all services (preserve data)
docker compose down

# Stop all services and DELETE all data
docker compose down -v
```

---

## Related Documentation

- [Network Architecture](network_architecture.md) — Docker network details
- [Configuration Reference](configuration_reference.md) — all environment variables
- [Troubleshooting](troubleshooting.md) — common Docker Compose issues

---

_Document Version: 1.0_
_Last Updated: March 2026_
