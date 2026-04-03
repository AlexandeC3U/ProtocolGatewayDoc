# Chapter 16 — Configuration Reference

> Master environment variable reference, port map, volume map, resource defaults,
> and ConfigMap structure for all NEXUS Edge services.

---

## Environment Variables

### General

| Variable   | Default       | Used By              | Description             |
| ---------- | ------------- | -------------------- | ----------------------- |
| `NODE_ENV` | `development` | Gateway Core, Web UI | Runtime environment     |
| `VERSION`  | —             | All                  | Application version tag |

### PostgreSQL (Config Database)

| Variable            | Default        | Used By                  | Description            |
| ------------------- | -------------- | ------------------------ | ---------------------- |
| `POSTGRES_USER`     | `nexus`        | PostgreSQL, Gateway Core | Database username      |
| `POSTGRES_PASSWORD` | — (required)   | PostgreSQL, Gateway Core | Database password      |
| `POSTGRES_DB`       | `nexus_config` | PostgreSQL, Gateway Core | Database name          |
| `DATABASE_URL`      | (composed)     | Gateway Core             | Full connection string |

Connection string format:

```
postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
```

### TimescaleDB (Historian Database)

| Variable                | Default           | Used By        | Description             |
| ----------------------- | ----------------- | -------------- | ----------------------- |
| `HISTORIAN_USER`        | `postgres`        | TimescaleDB    | Database admin user     |
| `HISTORIAN_PASSWORD`    | — (required)      | TimescaleDB    | Database admin password |
| `HISTORIAN_DB`          | `nexus_historian` | TimescaleDB    | Database name           |
| `INGESTION_DB_HOST`     | `historian`       | Data Ingestion | TimescaleDB hostname    |
| `INGESTION_DB_NAME`     | `nexus_historian` | Data Ingestion | Database name           |
| `INGESTION_DB_USER`     | `nexus_ingestion` | Data Ingestion | Write-access user       |
| `INGESTION_DB_PASSWORD` | — (required)      | Data Ingestion | Write-access password   |

### MQTT (EMQX)

| Variable                           | Default                  | Used By        | Description              |
| ---------------------------------- | ------------------------ | -------------- | ------------------------ |
| `MQTT_BROKER_URL`                  | `mqtt://emqx:1883`       | Gateway Core   | MQTT broker URL          |
| `INGESTION_MQTT_BROKER_URL`        | `tcp://emqx:1883`        | Data Ingestion | MQTT broker URL (Go)     |
| `MQTT_CLIENT_ID`                   | `data-ingestion-1`       | Data Ingestion | Unique client ID         |
| `INGESTION_MQTT_TOPIC`             | `$share/ingestion/dev/#` | Data Ingestion | Subscription topic       |
| `EMQX_DASHBOARD__DEFAULT_USERNAME` | `admin`                  | EMQX           | Dashboard admin user     |
| `EMQX_DASHBOARD__DEFAULT_PASSWORD` | `public`                 | EMQX           | Dashboard admin password |
| `EMQX_CLUSTER__DISCOVERY_STRATEGY` | `static`                 | EMQX           | Cluster mode             |
| `EMQX_NODE__COOKIE`                | `nexus_secret_cookie`    | EMQX           | Erlang cluster cookie    |

### Per-Service MQTT Credentials (Production)

| Variable                                      | Service          | Description |
| --------------------------------------------- | ---------------- | ----------- |
| `MQTT_GATEWAY_USER` / `MQTT_GATEWAY_PASS`     | Gateway Core     | MQTT auth   |
| `MQTT_PROTOCOL_USER` / `MQTT_PROTOCOL_PASS`   | Protocol Gateway | MQTT auth   |
| `MQTT_HISTORIAN_USER` / `MQTT_HISTORIAN_PASS` | Data Ingestion   | MQTT auth   |
| `MQTT_FLOW_USER` / `MQTT_FLOW_PASS`           | (reserved)       | Future use  |
| `MQTT_ALERT_USER` / `MQTT_ALERT_PASS`         | (reserved)       | Future use  |

### Gateway Core

| Variable               | Default                                              | Description                    |
| ---------------------- | ---------------------------------------------------- | ------------------------------ |
| `DATABASE_URL`         | —                                                    | PostgreSQL connection string   |
| `MQTT_BROKER_URL`      | `mqtt://emqx:1883`                                   | MQTT broker                    |
| `PROTOCOL_GATEWAY_URL` | `http://protocol-gateway:8080`                       | Proxy target                   |
| `AUTH_ENABLED`         | `false`                                              | Enable JWT/OIDC authentication |
| `OIDC_ISSUER_URL`      | `http://localhost:9000/application/o/nexus-gateway/` | OIDC discovery URL             |
| `AUDIT_ENABLED`        | `true`                                               | Enable mutation audit logging  |
| `RATE_LIMIT_ENABLED`   | `false`                                              | Enable API rate limiting       |
| `CORS_ORIGIN`          | `*`                                                  | Allowed CORS origins           |

### Protocol Gateway

| Variable          | Default           | Description             |
| ----------------- | ----------------- | ----------------------- |
| `MQTT_BROKER_URL` | `tcp://emqx:1883` | MQTT broker URL         |
| `HTTP_PORT`       | `8080`            | HTTP server port        |
| `GOMAXPROCS`      | `4`               | Go runtime thread limit |
| `GOGC`            | `100`             | Go GC target percentage |

### Data Ingestion

| Variable                    | Default                  | Description             |
| --------------------------- | ------------------------ | ----------------------- |
| `INGESTION_MQTT_BROKER_URL` | `tcp://emqx:1883`        | MQTT broker             |
| `MQTT_CLIENT_ID`            | `data-ingestion-1`       | Unique per replica      |
| `INGESTION_MQTT_TOPIC`      | `$share/ingestion/dev/#` | Shared subscription     |
| `INGESTION_DB_HOST`         | `historian`              | TimescaleDB host        |
| `INGESTION_DB_NAME`         | `nexus_historian`        | Database name           |
| `INGESTION_DB_USER`         | `nexus_ingestion`        | Database user           |
| `INGESTION_DB_PASSWORD`     | —                        | Database password       |
| `GOMAXPROCS`                | `4`                      | Go runtime thread limit |
| `GOGC`                      | `100`                    | Go GC target percentage |

### Authentik

| Variable                         | Default        | Description                      |
| -------------------------------- | -------------- | -------------------------------- |
| `AUTHENTIK_SECRET_KEY`           | — (required)   | Application secret (64+ chars)   |
| `AUTHENTIK_POSTGRESQL__HOST`     | `authentik-db` | Database host                    |
| `AUTHENTIK_POSTGRESQL__NAME`     | `authentik`    | Database name                    |
| `AUTHENTIK_POSTGRESQL__USER`     | `authentik`    | Database user                    |
| `AUTHENTIK_POSTGRESQL__PASSWORD` | — (required)   | Database password                |
| `AUTHENTIK_BOOTSTRAP_PASSWORD`   | —              | Initial admin password           |
| `AUTHENTIK_BOOTSTRAP_EMAIL`      | —              | Initial admin email              |
| `AUTHENTIK_DB_PASSWORD`          | — (required)   | Authentik DB PostgreSQL password |
| `AUTHENTIK_ADMIN_PASSWORD`       | —              | Admin user password              |
| `AUTHENTIK_ADMIN_EMAIL`          | —              | Admin user email                 |

### Grafana

| Variable                        | Default                              | Description             |
| ------------------------------- | ------------------------------------ | ----------------------- |
| `GRAFANA_USER`                  | `admin`                              | Admin username          |
| `GRAFANA_PASSWORD`              | `admin`                              | Admin password          |
| `GF_SECURITY_ADMIN_USER`        | `${GRAFANA_USER}`                    | Grafana setting         |
| `GF_SECURITY_ADMIN_PASSWORD`    | `${GRAFANA_PASSWORD}`                | Grafana setting         |
| `GF_AUTH_ANONYMOUS_ENABLED`     | `true`                               | Allow anonymous access  |
| `GF_AUTH_ANONYMOUS_ORG_ROLE`    | `Viewer`                             | Anonymous user role     |
| `GF_SERVER_ROOT_URL`            | `%(protocol)s://%(domain)s/grafana/` | Sub-path URL            |
| `GF_SERVER_SERVE_FROM_SUB_PATH` | `true`                               | Enable sub-path serving |

### Security

| Variable     | Default | Description                            |
| ------------ | ------- | -------------------------------------- |
| `JWT_SECRET` | —       | JWT signing secret (if not using JWKS) |

### Email (SMTP)

| Variable    | Default | Description          |
| ----------- | ------- | -------------------- |
| `SMTP_HOST` | —       | SMTP server hostname |
| `SMTP_PORT` | `587`   | SMTP server port     |
| `SMTP_USER` | —       | SMTP username        |
| `SMTP_PASS` | —       | SMTP password        |
| `SMTP_FROM` | —       | From email address   |

### Cloud Integration

| Variable        | Default | Description                     |
| --------------- | ------- | ------------------------------- |
| `CLOUD_ENABLED` | `false` | Enable cloud connectivity       |
| `CLOUD_API_URL` | —       | Cloud platform API URL          |
| `CLOUD_API_KEY` | —       | Cloud platform API key          |
| `EDGE_ID`       | —       | Unique edge instance identifier |

---

## Port Map

### External Ports (Host-Accessible)

| Port  | Service          | Protocol   | Description                       |
| ----- | ---------------- | ---------- | --------------------------------- |
| 80    | Nginx            | HTTP       | Main entry point                  |
| 443   | Nginx            | HTTPS      | TLS-terminated entry              |
| 1884  | EMQX             | MQTT       | MQTT TCP (host-mapped from 1883)  |
| 3001  | Gateway Core     | HTTP       | REST API (direct)                 |
| 5432  | TimescaleDB      | PostgreSQL | Historian database                |
| 5433  | PostgreSQL       | PostgreSQL | Config database                   |
| 7000  | Data Ingestion   | HTTP       | Health/metrics (mapped from 8080) |
| 8083  | EMQX             | WS         | MQTT WebSocket                    |
| 8085  | Protocol Gateway | HTTP       | HTTP API (mapped from 8080)       |
| 8883  | EMQX             | MQTTS      | MQTT over TLS                     |
| 9000  | Authentik        | HTTP       | OIDC provider                     |
| 9090  | Prometheus       | HTTP       | Metrics UI                        |
| 9443  | Authentik        | HTTPS      | OIDC provider (TLS)               |
| 18083 | EMQX             | HTTP       | Dashboard                         |

### Internal Ports (Container-to-Container)

| Port | Service           | Protocol | Consumers                 |
| ---- | ----------------- | -------- | ------------------------- |
| 1883 | EMQX              | MQTT     | All MQTT services         |
| 3000 | Grafana           | HTTP     | Nginx                     |
| 3001 | Gateway Core      | HTTP     | Nginx, Web UI             |
| 5432 | PostgreSQL        | PG       | Gateway Core              |
| 5432 | TimescaleDB       | PG       | Data Ingestion, Grafana   |
| 8080 | Protocol Gateway  | HTTP     | Gateway Core              |
| 8080 | Data Ingestion    | HTTP     | Health checks             |
| 9000 | Authentik         | HTTP     | Nginx                     |
| 9187 | postgres_exporter | HTTP     | Prometheus (K8s)          |
| 4370 | EMQX              | TCP      | Erlang cluster (K8s)      |
| 5370 | EMQX              | TCP      | Erlang distribution (K8s) |

---

## Volume Map

| Volume                 | Service      | Mount Path                 | Purpose                      | Required |
| ---------------------- | ------------ | -------------------------- | ---------------------------- | :------: |
| `postgres-data`        | PostgreSQL   | `/var/lib/postgresql/data` | Config DB storage            |   Yes    |
| `timescale-data`       | TimescaleDB  | `/var/lib/postgresql/data` | Historian storage            |   Yes    |
| `emqx-data`            | EMQX         | `/opt/emqx/data`           | Cluster state, retained msgs |   Yes    |
| `emqx-log`             | EMQX         | `/opt/emqx/log`            | Broker logs                  |    No    |
| `protocol-gateway-pki` | Protocol GW  | `/app/certs/pki`           | OPC UA trust store           |   Yes    |
| `authentik-db-data`    | Authentik DB | `/var/lib/postgresql/data` | Auth database                |   Yes    |
| `prometheus-data`      | Prometheus   | `/prometheus`              | Metrics TSDB                 |   Rec.   |
| `grafana-data`         | Grafana      | `/var/lib/grafana`         | Dashboards, prefs            |   Rec.   |

---

## Kubernetes ConfigMaps

### nexus-config (Shared)

| Key                | Value         | Description         |
| ------------------ | ------------- | ------------------- |
| `MQTT_BROKER`      | `emqx:1883`   | MQTT broker address |
| `TIMESCALEDB_HOST` | `timescaledb` | Historian host      |
| `POSTGRES_HOST`    | `postgres`    | Config DB host      |
| `LOG_LEVEL`        | `info`        | Default log level   |
| `LOG_FORMAT`       | `json`        | Structured logging  |

### protocol-gateway-config

| Key                             | Value       | Description                |
| ------------------------------- | ----------- | -------------------------- |
| `SERVER_PORT`                   | `8080`      | HTTP server port           |
| `MQTT_BROKER`                   | `emqx:1883` | MQTT broker                |
| `POLL_DEFAULT_INTERVAL`         | `1000`      | Default poll interval (ms) |
| `POLL_WORKERS`                  | `10`        | Concurrent poll workers    |
| `POLL_BATCH_SIZE`               | `100`       | Tags per batch             |
| `CIRCUIT_BREAKER_THRESHOLD`     | `5`         | Failures before open       |
| `CIRCUIT_BREAKER_RESET_TIMEOUT` | `30000`     | Reset timeout (ms)         |

### data-ingestion-config

| Key              | Value                                           | Description             |
| ---------------- | ----------------------------------------------- | ----------------------- |
| `MQTT_TOPICS`    | `$share/ingestion/dev/#,$share/ingestion/uns/#` | Subscription topics     |
| `DB_POOL_SIZE`   | `20`                                            | Connection pool size    |
| `BUFFER_SIZE`    | `200000`                                        | Message buffer capacity |
| `BATCH_SIZE`     | `10000`                                         | Rows per COPY batch     |
| `FLUSH_INTERVAL` | `250`                                           | Max flush delay (ms)    |
| `WRITERS`        | `8`                                             | Concurrent DB writers   |
| `USE_COPY`       | `true`                                          | Use COPY protocol       |

### gateway-core-config

| Key                  | Value           | Description        |
| -------------------- | --------------- | ------------------ |
| `CORS_ORIGIN`        | `*`             | Allowed origins    |
| `AUTH_ENABLED`       | `false`         | JWT authentication |
| `OIDC_ISSUER_URL`    | (Authentik URL) | OIDC discovery     |
| `AUDIT_ENABLED`      | `true`          | Mutation logging   |
| `RATE_LIMIT_ENABLED` | `false`         | API throttling     |

---

## Resource Defaults

### Development

| Service          | CPU Request | CPU Limit | Memory Request | Memory Limit |
| ---------------- | ----------- | --------- | -------------- | ------------ |
| EMQX             | 250m        | 1000m     | 512Mi          | 2Gi          |
| TimescaleDB      | 250m        | 2000m     | 1Gi            | 4Gi          |
| PostgreSQL       | 100m        | 500m      | 256Mi          | 512Mi        |
| Gateway Core     | 100m        | 500m      | 128Mi          | 512Mi        |
| Protocol Gateway | 100m        | 500m      | 128Mi          | 512Mi        |
| Data Ingestion   | 100m        | 500m      | 128Mi          | 512Mi        |
| Authentik Server | 100m        | 1000m     | 256Mi          | 512Mi        |

### Production

| Service          | CPU Request | CPU Limit | Memory Request | Memory Limit | Replicas |
| ---------------- | ----------- | --------- | -------------- | ------------ | :------: |
| EMQX             | 500m        | 2000m     | 1Gi            | 4Gi          |    3     |
| TimescaleDB      | 500m        | 4000m     | 2Gi            | 8Gi          |    1     |
| PostgreSQL       | 250m        | 1000m     | 512Mi          | 1Gi          |    1     |
| Gateway Core     | 100m        | 500m      | 128Mi          | 512Mi        |    1     |
| Protocol Gateway | 500m        | 2000m     | 512Mi          | 2Gi          |    3     |
| Data Ingestion   | 500m        | 2000m     | 512Mi          | 2Gi          |   2-8    |
| Authentik Server | 100m        | 1000m     | 256Mi          | 512Mi        |    1     |

---

## Related Documentation

- [Docker Compose](docker_compose.md) — service-level environment config
- [Kubernetes](kubernetes.md) — K8s resource allocation
- [Security Hardening](security_hardening.md) — secret management
- [Scaling Playbook](scaling_playbook.md) — resource sizing guidelines

---

_Document Version: 1.0_
_Last Updated: March 2026_
