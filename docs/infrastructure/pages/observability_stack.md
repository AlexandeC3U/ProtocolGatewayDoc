# Chapter 10 — Observability Stack

> Prometheus scrape configuration, Grafana provisioning, datasource setup,
> dashboard design, service metrics endpoints, and alerting patterns.

---

## Overview

NEXUS Edge uses Prometheus + Grafana for metrics collection and visualization.
Every service exposes a `/metrics` endpoint in Prometheus exposition format.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY ARCHITECTURE                                   │
│                                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐     │
│  │ Gateway Core  │  │ Protocol GW   │  │ Data Ingest.  │  │    EMQX       │     │
│  │ :3001/metrics │  │ :8080/metrics │  │ :8080/metrics │  │ :18083/api/v5 │     │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘  └────────┬──────┘     │
│          │                  │                  │                   │            │
│          └──────────────────┴──────────────────┴───────────────────┘            │
│                                      │                                          │
│                                      ▼                                          │
│                            ┌───────────────────┐                                │
│                            │    Prometheus     │                                │
│                            │    (port 9090)    │                                │
│                            │                   │                                │
│                            │  Scrape: 15s      │                                │
│                            │  Retention: 15d   │                                │
│                            │  Storage: TSDB    │                                │
│                            └────────┬──────────┘                                │
│                                     │                                           │
│                                     ▼                                           │
│                            ┌───────────────────┐                                │
│                            │     Grafana       │                                │
│                            │    (port 3000)    │                                │
│                            │                   │                                │
│                            │  Datasources:     │                                │
│                            │  • Prometheus     │                                │
│                            │  • TimescaleDB    │                                │
│                            │  • PostgreSQL     │                                │
│                            └───────────────────┘                                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Prometheus Configuration

### prometheus.yml

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    monitor: nexus-platform
    environment: development

scrape_configs:
  # Self-monitoring
  - job_name: 'prometheus'
    static_configs:
      - targets: ['prometheus:9090']

  # Go services
  - job_name: 'protocol-gateway'
    static_configs:
      - targets: ['protocol-gateway:8080']
    metrics_path: /metrics

  - job_name: 'data-ingestion'
    static_configs:
      - targets: ['data-ingestion:8080']
    metrics_path: /metrics

  # Node.js / Fastify
  - job_name: 'gateway-core'
    static_configs:
      - targets: ['gateway-core:3001']
    metrics_path: /metrics

  # EMQX (built-in Prometheus endpoint)
  - job_name: 'emqx'
    static_configs:
      - targets: ['emqx:18083']
    metrics_path: /api/v5/prometheus/stats
    basic_auth:
      username: admin
      password: public

  # TimescaleDB (via postgres_exporter sidecar, K8s only)
  # - job_name: 'timescaledb'
  #   static_configs:
  #     - targets: ['timescaledb:9187']
```

### Scrape Targets Summary

| Job              | Target           | Port  | Path                     | Auth                 |
| ---------------- | ---------------- | ----- | ------------------------ | -------------------- |
| prometheus       | prometheus       | 9090  | /metrics                 | —                    |
| protocol-gateway | protocol-gateway | 8080  | /metrics                 | —                    |
| data-ingestion   | data-ingestion   | 8080  | /metrics                 | —                    |
| gateway-core     | gateway-core     | 3001  | /metrics                 | —                    |
| emqx             | emqx             | 18083 | /api/v5/prometheus/stats | basic (admin/public) |
| timescaledb      | timescaledb      | 9187  | /metrics                 | — (K8s only)         |

---

## Service Metrics

### Gateway Core (prom-client)

Gateway Core uses `prom-client` to expose Node.js and application metrics:

| Metric                          | Type      | Labels                | Description                     |
| ------------------------------- | --------- | --------------------- | ------------------------------- |
| `http_requests_total`           | Counter   | method, route, status | Total HTTP requests             |
| `http_request_duration_seconds` | Histogram | method, route         | Request latency                 |
| `ws_connections_active`         | Gauge     | —                     | Active WebSocket connections    |
| `ws_messages_total`             | Counter   | direction             | WS messages sent/received       |
| `mqtt_messages_total`           | Counter   | topic, direction      | MQTT pub/sub counts             |
| `mqtt_connection_status`        | Gauge     | —                     | 1 = connected, 0 = disconnected |
| `proxy_requests_total`          | Counter   | target, status        | Protocol gateway proxy calls    |
| `proxy_circuit_breaker_state`   | Gauge     | —                     | 0=closed, 1=open, 2=half-open   |
| `nodejs_heap_size_bytes`        | Gauge     | —                     | V8 heap usage (default)         |
| `nodejs_gc_duration_seconds`    | Histogram | —                     | GC pause times (default)        |

### Protocol Gateway (Go)

| Metric                                   | Type      | Labels         | Description                 |
| ---------------------------------------- | --------- | -------------- | --------------------------- |
| `protocol_gateway_active_devices`        | Gauge     | protocol       | Connected device count      |
| `protocol_gateway_polls_total`           | Counter   | device, status | Poll cycle count            |
| `protocol_gateway_poll_duration_seconds` | Histogram | protocol       | Poll latency                |
| `protocol_gateway_mqtt_published_total`  | Counter   | —              | Messages published          |
| `protocol_gateway_errors_total`          | Counter   | device, type   | Error count by type         |
| `go_goroutines`                          | Gauge     | —              | Active goroutines (default) |
| `go_memstats_alloc_bytes`                | Gauge     | —              | Memory allocation (default) |

### Data Ingestion (Go)

| Metric                              | Type      | Labels | Description              |
| ----------------------------------- | --------- | ------ | ------------------------ |
| `ingestion_messages_received_total` | Counter   | —      | MQTT messages received   |
| `ingestion_rows_written_total`      | Counter   | —      | DB rows written          |
| `ingestion_batch_size`              | Histogram | —      | Rows per COPY batch      |
| `ingestion_write_duration_seconds`  | Histogram | —      | DB write latency         |
| `ingestion_buffer_size`             | Gauge     | —      | Current buffer occupancy |
| `ingestion_errors_total`            | Counter   | type   | Parse/write errors       |

### EMQX (Built-in)

EMQX exposes 200+ metrics natively. Key ones for NEXUS Edge:

| Metric                     | Type    | Description              |
| -------------------------- | ------- | ------------------------ |
| `emqx_connections_count`   | Gauge   | Current MQTT connections |
| `emqx_messages_received`   | Counter | Total messages received  |
| `emqx_messages_sent`       | Counter | Total messages sent      |
| `emqx_messages_dropped`    | Counter | Dropped messages         |
| `emqx_subscriptions_count` | Gauge   | Active subscriptions     |
| `emqx_retained_count`      | Gauge   | Retained messages        |
| `emqx_bytes_received`      | Counter | Total bytes received     |
| `emqx_bytes_sent`          | Counter | Total bytes sent         |

---

## Grafana Configuration

### Datasource Provisioning

```yaml
# provisioning/datasources/datasources.yml
apiVersion: 1

datasources:
  # Primary metrics store
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    httpMethod: POST

  # Time-series historian (TimescaleDB)
  - name: TimescaleDB
    type: postgres
    access: proxy
    url: timescaledb:5432
    database: nexus_historian
    user: nexus_historian
    jsonData:
      sslmode: disable
      maxOpenConns: 10
      postgresVersion: 1500
      timescaledb: true
    secureJsonData:
      password: ${HISTORIAN_PASSWORD}

  # Config database (PostgreSQL)
  - name: PostgreSQL
    type: postgres
    access: proxy
    url: postgres:5432
    database: nexus_gateway
    user: nexus
    jsonData:
      sslmode: disable
      maxOpenConns: 5
      postgresVersion: 1500
    secureJsonData:
      password: ${POSTGRES_PASSWORD}
```

### Dashboard Provisioning

```yaml
# provisioning/dashboards/dashboards.yml
apiVersion: 1

providers:
  - name: 'nexus-dashboards'
    orgId: 1
    folder: 'NEXUS Edge'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

### Recommended Dashboard Panels

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    GRAFANA DASHBOARD LAYOUT                                     │
│                                                                                 │
│  Dashboard: NEXUS Edge Overview                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Row: System Health                                                     │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │    │
│  │  │ EMQX     │ │ Gateway  │ │ Protocol │ │  Data    │ │  TimescDB│       │    │
│  │  │ Conns    │ │ Core RPS │ │ GW Polls │ │ Ingest/s │ │  Size    │       │    │
│  │  │ (stat)   │ │ (stat)   │ │ (stat)   │ │ (stat)   │ │ (stat)   │       │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Row: MQTT Traffic                                                      │    │
│  │  ┌──────────────────────────────┐ ┌──────────────────────────────────┐  │    │
│  │  │ Messages In/Out (time series)│ │ Subscriptions by Client (table)  │  │    │
│  │  └──────────────────────────────┘ └──────────────────────────────────┘  │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Row: API Performance                                                   │    │
│  │  ┌──────────────────────────────┐ ┌──────────────────────────────────┐  │    │
│  │  │ Request Duration (heatmap)   │ │ Error Rate by Route (time series)│  │    │
│  │  └──────────────────────────────┘ └──────────────────────────────────┘  │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Row: Ingestion Pipeline                                                │    │
│  │  ┌──────────────────────────────┐ ┌──────────────────────────────────┐  │    │
│  │  │ Buffer Size (gauge)          │ │ Write Latency (histogram)        │  │    │
│  │  └──────────────────────────────┘ └──────────────────────────────────┘  │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Row: Process Metrics                                                   │    │
│  │  ┌──────────────────────────────┐ ┌──────────────────────────────────┐  │    │
│  │  │ Memory Usage by Service      │ │ Go Goroutines / Node.js Heap     │  │    │
│  │  └──────────────────────────────┘ └──────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  Dashboard: Process Data (TimescaleDB)                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Uses query_metrics() function — auto-selects aggregate by time range   │    │
│  │  Variables: $device, $tag, $interval                                    │    │
│  │  Panels: Time series, stat (current), table (raw data)                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Key PromQL Queries

```promql
# Gateway Core: Request rate (5m average)
rate(http_requests_total{job="gateway-core"}[5m])

# Gateway Core: P99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{job="gateway-core"}[5m]))

# Data Ingestion: Throughput
rate(ingestion_rows_written_total[5m])

# EMQX: Active connections
emqx_connections_count

# EMQX: Message throughput
rate(emqx_messages_received[5m]) + rate(emqx_messages_sent[5m])

# Protocol Gateway: Active devices
protocol_gateway_active_devices

# Ingestion buffer fill ratio
ingestion_buffer_size / 200000
```

---

## Docker Compose Services

### Prometheus

```yaml
nexus-prometheus:
  image: prom/prometheus:v2.48.0
  container_name: nexus-prometheus
  ports:
    - '9090:9090'
  volumes:
    - ./config/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    - prometheus-data:/prometheus
  command:
    - '--config.file=/etc/prometheus/prometheus.yml'
    - '--storage.tsdb.retention.time=15d'
    - '--web.enable-lifecycle'
  networks:
    - nexus-internal
```

### Grafana

```yaml
nexus-grafana:
  image: grafana/grafana:10.2.2
  container_name: nexus-grafana
  ports:
    - '3000:3000'
  environment:
    GF_SECURITY_ADMIN_USER: ${GRAFANA_USER:-admin}
    GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
    GF_AUTH_ANONYMOUS_ENABLED: 'true'
    GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer
    GF_SERVER_ROOT_URL: '%(protocol)s://%(domain)s:%(http_port)s/grafana/'
    GF_SERVER_SERVE_FROM_SUB_PATH: 'true'
  volumes:
    - ./config/grafana/provisioning:/etc/grafana/provisioning:ro
    - grafana-data:/var/lib/grafana
  depends_on:
    nexus-prometheus:
      condition: service_started
    nexus-historian:
      condition: service_healthy
  networks:
    - nexus-internal
```

---

## Kubernetes: ServiceMonitors

For K8s deployments with the Prometheus Operator, ServiceMonitors automate
scrape target discovery:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: gateway-core
  namespace: nexus
spec:
  selector:
    matchLabels:
      app: gateway-core
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

ServiceMonitors defined in `k8s/base/servicemonitors.yaml` cover all NEXUS
services. The Prometheus Operator discovers them automatically via label
selectors.

---

## Alerting Patterns

### Recommended Alert Rules

| Alert                 | Condition                                               | Severity | Action                              |
| --------------------- | ------------------------------------------------------- | -------- | ----------------------------------- |
| EMQX Down             | `emqx_connections_count == 0` for 1m                    | Critical | Check EMQX container/pod            |
| High API Latency      | P99 > 2s for 5m                                         | Warning  | Check DB connections, rate limiting |
| Ingestion Buffer Full | `ingestion_buffer_size > 180000` for 2m                 | Critical | Scale data-ingestion replicas       |
| DB Write Errors       | `rate(ingestion_errors_total{type="write"}) > 0` for 1m | Critical | Check TimescaleDB health            |
| Circuit Breaker Open  | `proxy_circuit_breaker_state == 1` for 1m               | Warning  | Check protocol-gateway health       |
| High Memory Usage     | Container memory > 80% limit for 5m                     | Warning  | Check for leaks, increase limits    |
| Disk Space Low        | TimescaleDB PVC > 85%                                   | Critical | Run compression, check retention    |

---

## Related Documentation

- [Docker Compose](docker_compose.md) — Prometheus/Grafana container config
- [Kubernetes](kubernetes.md) — ServiceMonitor resources
- [TimescaleDB Operations](timescaledb_operations.md) — historian datasource
- [Scaling Playbook](scaling_playbook.md) — metrics-driven scaling decisions
- [Troubleshooting](troubleshooting.md) — using metrics to diagnose issues

---

_Document Version: 1.0_
_Last Updated: March 2026_
