# Operations Runbook — NEXUS Edge

> Day-2 operations guide. Startup/shutdown procedures, health check interpretation,
> log analysis, common issues, and escalation paths. For ops teams running NEXUS Edge
> in development and production environments.

---

## Service Inventory

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    NEXUS EDGE — SERVICE MAP                                     │
│                                                                                 │
│  TIER 1: Databases + Broker (must start first, no dependencies)                 │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                    │
│  │ PostgreSQL │ │TimescaleDB │ │    EMQX    │ │Authentik DB│                    │
│  │   :5432    │ │   :5433    │ │   :1883    │ │   :5432    │                    │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘                    │
│                                                                                 │
│  TIER 2: Core Services (depend on Tier 1)                                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐                    │
│  │  Gateway   │ │  Protocol  │ │ Authentik  │ │ Authentik  │                    │
│  │   Core     │ │  Gateway   │ │  Server    │ │  Worker    │                    │
│  │   :3001    │ │   :8080    │ │   :9000    │ │ (no port)  │                    │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘                    │
│                                                                                 │
│  TIER 3: Consumers + Frontend (depend on Tier 2)                                │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                                   │
│  │   Data     │ │   Web UI   │ │   Nginx    │                                   │
│  │ Ingestion  │ │   :80      │ │  :80/443   │                                   │
│  │   :8080    │ │            │ │            │                                   │
│  └────────────┘ └────────────┘ └────────────┘                                   │
│                                                                                 │
│  OPTIONAL: Observability (--profile monitoring)                                 │
│  ┌────────────┐ ┌────────────┐                                                  │
│  │ Prometheus │ │  Grafana   │                                                  │
│  │   :9090    │ │   :3000    │                                                  │
│  └────────────┘ └────────────┘                                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Startup & Shutdown

### Full Platform Start

```bash
cd infrastructure/docker

# Start all services (dependency order handled by compose)
docker compose up -d

# Start with observability
docker compose --profile monitoring up -d

# Watch startup progress
docker compose ps
docker compose logs -f --tail 20
```

**Expected startup timeline:**

| Time    | What Happens                                               |
| ------- | ---------------------------------------------------------- |
| 0-10s   | Databases start, EMQX starts                               |
| 10-20s  | PostgreSQL passes health check                             |
| 15-30s  | EMQX passes health check                                   |
| 20-40s  | Gateway Core, Protocol Gateway, Authentik start            |
| 30-60s  | Gateway Core passes readiness check (DB + MQTT connected)  |
| 40-90s  | Authentik fully ready (blueprint sync on first boot: ~60s) |
| 45-60s  | Data Ingestion subscribes to MQTT, Web UI + Nginx start    |
| 60-120s | First boot: all services healthy                           |

### Graceful Shutdown

```bash
# Stop all services (reverse dependency order)
docker compose down

# Stop and remove volumes (DATA LOSS — development only)
docker compose down -v
```

**Shutdown sequence:**

1. Nginx stops accepting connections
2. Gateway Core flushes in-flight MQTT publishes, closes WebSocket clients
3. Protocol Gateway finishes current poll cycle, closes device connections
4. Data Ingestion flushes batch buffer to TimescaleDB
5. Databases close cleanly

### Restart a Single Service

```bash
# Restart without data loss
docker compose restart gateway-core

# Full recreate (picks up image/config changes)
docker compose up -d --force-recreate gateway-core
```

---

## Health Checks

### Gateway Core Health Endpoints

| Endpoint                 | What It Checks                      | Healthy Response                                         |
| ------------------------ | ----------------------------------- | -------------------------------------------------------- |
| `GET /health`            | Process alive                       | `{"status":"ok"}`                                        |
| `GET /health/live`       | Process alive (K8s liveness)        | `200 OK`                                                 |
| `GET /health/ready`      | DB + MQTT connected (K8s readiness) | `{"status":"ready","db":"connected","mqtt":"connected"}` |
| `GET /api/system/health` | All platform services               | `{"overall":"healthy","services":{...}}`                 |

### Interpreting System Health

```bash
curl -s http://localhost/api/system/health | jq .
```

| Field                            | Healthy       | Unhealthy        | Action                                           |
| -------------------------------- | ------------- | ---------------- | ------------------------------------------------ |
| `services.db`                    | `"connected"` | `"disconnected"` | Check PostgreSQL: `docker compose logs postgres` |
| `services.mqtt`                  | `"connected"` | `"disconnected"` | Check EMQX: `docker compose logs emqx`           |
| `services.websocket.connections` | `>= 0`        | N/A              | Informational (active WS clients)                |
| `services.protocolGateway`       | `"reachable"` | `"unreachable"`  | Check PG: `docker compose logs protocol-gateway` |
| `services.dataIngestion`         | `"reachable"` | `"unreachable"`  | Check DI: `docker compose logs data-ingestion`   |

### Docker Health Status

```bash
# Quick overview
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"

# Detailed health check output
docker inspect --format='{{json .State.Health}}' nexus-gateway-core | jq .
```

| Container Status        | Meaning                     | Action                         |
| ----------------------- | --------------------------- | ------------------------------ |
| `Up (healthy)`          | All health checks pass      | Normal                         |
| `Up (health: starting)` | Health check not yet passed | Wait 30-60s                    |
| `Up (unhealthy)`        | Health check failing        | Check logs immediately         |
| `Restarting`            | Container crash loop        | Check logs, increase resources |
| `Exited (1)`            | Process exited with error   | Check logs, fix config         |

---

## Log Analysis

### Viewing Logs

```bash
# All services (follow mode)
docker compose logs -f

# Specific service (last 100 lines)
docker compose logs --tail 100 gateway-core

# Multiple services
docker compose logs -f gateway-core protocol-gateway data-ingestion

# Since a specific time
docker compose logs --since "2026-03-23T10:00:00" gateway-core

# JSON-formatted (for grep/jq)
docker compose logs gateway-core 2>&1 | grep '"level":"error"'
```

### Log Formats

**Gateway Core (Pino JSON):**

```json
{"level":"info","time":1711270245000,"msg":"Device created","deviceId":"abc-123","protocol":"modbus"}
{"level":"error","time":1711270245000,"msg":"MQTT publish failed","topic":"$nexus/config/devices/abc","err":"connection refused"}
```

**Protocol Gateway (zerolog JSON):**

```json
{"level":"info","time":"2026-03-23T10:30:45Z","message":"Poll cycle complete","device":"plc01","success":true,"duration_ms":45}
{"level":"error","time":"2026-03-23T10:30:45Z","message":"Connection failed","device":"plc01","error":"timeout","retry_in":"5s"}
```

**Data Ingestion (zerolog JSON):**

```json
{"level":"info","time":"2026-03-23T10:30:45Z","message":"Batch written","rows":500,"duration_ms":12}
{"level":"warn","time":"2026-03-23T10:30:45Z","message":"Buffer pressure","usage_pct":85,"capacity":50000}
```

### Key Log Patterns to Watch

| Pattern                    | Service          | Severity | Meaning                                              |
| -------------------------- | ---------------- | -------- | ---------------------------------------------------- |
| `"MQTT publish failed"`    | Gateway Core     | ERROR    | Config notification lost — PG may have stale config  |
| `"Circuit breaker OPEN"`   | Gateway Core     | WARN     | Protocol-gateway unreachable — proxy calls fail fast |
| `"Circuit breaker CLOSED"` | Gateway Core     | INFO     | Protocol-gateway recovered                           |
| `"Connection failed"`      | Protocol Gateway | ERROR    | PLC unreachable — check network/firewall             |
| `"Poll cycle failed"`      | Protocol Gateway | ERROR    | Device polling error — check PLC status              |
| `"Buffer pressure"`        | Data Ingestion   | WARN     | Write buffer >80% full — DB may be slow              |
| `"Batch write failed"`     | Data Ingestion   | ERROR    | TimescaleDB write error — check DB health            |
| `"JWKS fetch failed"`      | Gateway Core     | ERROR    | Authentik unreachable — auth broken                  |
| `"Token expired"`          | Gateway Core     | WARN     | Client sent expired JWT — normal if clients refresh  |

---

## Monitoring (Prometheus + Grafana)

### Key Metrics

**Gateway Core:**

| Metric                                  | Type      | What It Shows                                 |
| --------------------------------------- | --------- | --------------------------------------------- |
| `gateway_http_requests_total`           | Counter   | Total API requests (by method, route, status) |
| `gateway_http_request_duration_seconds` | Histogram | API latency distribution                      |
| `gateway_ws_connections`                | Gauge     | Active WebSocket connections                  |
| `gateway_ws_subscriptions`              | Gauge     | Active WebSocket topic subscriptions          |
| `gateway_mqtt_publishes_total`          | Counter   | Config messages published                     |
| `gateway_proxy_requests_total`          | Counter   | Proxied requests to PG/DI                     |
| `gateway_proxy_circuit_breaker_state`   | Gauge     | 0=closed, 1=open, 2=half-open                 |

**Protocol Gateway:**

| Metric                     | Type      | What It Shows               |
| -------------------------- | --------- | --------------------------- |
| `pg_devices_total`         | Gauge     | Active devices by protocol  |
| `pg_poll_duration_seconds` | Histogram | Poll cycle duration         |
| `pg_poll_errors_total`     | Counter   | Failed polls by device      |
| `pg_connections_active`    | Gauge     | Active protocol connections |
| `pg_mqtt_publishes_total`  | Counter   | Data messages published     |

**Data Ingestion:**

| Metric                       | Type      | What It Shows                     |
| ---------------------------- | --------- | --------------------------------- |
| `di_messages_received_total` | Counter   | MQTT messages received            |
| `di_points_written_total`    | Counter   | Data points written to DB         |
| `di_points_dropped_total`    | Counter   | Data points dropped (buffer full) |
| `di_batch_duration_seconds`  | Histogram | COPY batch duration               |
| `di_buffer_usage`            | Gauge     | Buffer utilization (0-1)          |

### Alerting Rules (Recommended)

| Alert                        | Condition                                                    | Severity |
| ---------------------------- | ------------------------------------------------------------ | -------- |
| **GatewayDown**              | `up{job="gateway-core"} == 0` for 1m                         | Critical |
| **ProtocolGatewayDown**      | `up{job="protocol-gateway"} == 0` for 1m                     | Critical |
| **CircuitBreakerOpen**       | `gateway_proxy_circuit_breaker_state == 1` for 2m            | Warning  |
| **HighAPILatency**           | `gateway_http_request_duration_seconds{quantile="0.99"} > 5` | Warning  |
| **HighBufferPressure**       | `di_buffer_usage > 0.8` for 5m                               | Warning  |
| **DataPointsDropped**        | `rate(di_points_dropped_total[5m]) > 0`                      | Critical |
| **DeviceOffline**            | Device status `offline` for 5m                               | Warning  |
| **DatabaseConnectionFailed** | Gateway readiness check fails for 30s                        | Critical |

---

## Common Operations

### Add a New Device

```bash
# 1. Create device (Phase 1)
curl -X POST http://localhost/api/devices \
  -H "Content-Type: application/json" \
  -d '{"name":"New PLC","protocol":"modbus","host":"192.168.1.100","port":502}'

# 2. Test connection
curl -X POST http://localhost/api/devices/DEVICE_ID/test

# 3. Browse address space
curl -X POST http://localhost/api/devices/DEVICE_ID/browse

# 4. Add tags (Phase 2)
curl -X POST http://localhost/api/tags/bulk \
  -H "Content-Type: application/json" \
  -d '{"tags":[{"deviceId":"DEVICE_ID","name":"Temp","address":"40001","dataType":"float32"}]}'
```

### Check MQTT Traffic

```bash
# Subscribe to all data topics
mosquitto_sub -h localhost -p 1883 \
  -u gateway -P <password> \
  -t "#" -v

# Subscribe to config notifications
mosquitto_sub -h localhost -p 1883 \
  -u gateway -P <password> \
  -t '$nexus/config/#' -v

# Subscribe to device status
mosquitto_sub -h localhost -p 1883 \
  -u gateway -P <password> \
  -t '$nexus/status/#' -v
```

### Query Historical Data

```bash
# Last hour of data for a topic
curl "http://localhost/api/historian/history?topic=site/building/main/temperature"

# Specific time range (Unix ms)
curl "http://localhost/api/historian/history?topic=site/building/main/temperature&from=1711266645000&to=1711270245000&limit=1000"
```

### View Audit Log

```bash
# Recent audit events (admin only)
curl -H "Authorization: Bearer <token>" \
  "http://localhost/api/system/audit?limit=20"

# Filter by user
curl -H "Authorization: Bearer <token>" \
  "http://localhost/api/system/audit?username=admin&since=2026-03-23T00:00:00Z"
```

### Database Operations

```bash
# Connect to config database
docker compose exec postgres psql -U nexus -d nexus_config

# Connect to historian
docker compose exec timescaledb psql -U nexus_historian -d nexus_historian

# Useful queries:
# Count devices
SELECT COUNT(*) FROM devices;

# List devices with tag counts
SELECT d.name, d.protocol, COUNT(t.id) as tags
FROM devices d LEFT JOIN tags t ON t.device_id = d.id
GROUP BY d.id;

# Check historian data volume
SELECT count(*), min(time), max(time) FROM metrics;

# Check hypertable chunk info
SELECT * FROM timescaledb_information.chunks
WHERE hypertable_name = 'metrics'
ORDER BY range_start DESC LIMIT 5;
```

---

## Troubleshooting

### Gateway Core Issues

| Symptom                   | Diagnosis            | Fix                                                                                                                 |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **503 on proxy routes**   | Circuit breaker open | Check protocol-gateway: `docker compose logs protocol-gateway`                                                      |
| **401 on all requests**   | JWKS fetch failing   | Check Authentik: `curl http://localhost:9000/application/o/nexus-gateway-provider/.well-known/openid-configuration` |
| **Slow API responses**    | DB query latency     | Check PG connections: `SELECT count(*) FROM pg_stat_activity;`                                                      |
| **WebSocket disconnects** | Heartbeat timeout    | Check client-side reconnection logic; verify network stability                                                      |
| **MQTT publish fails**    | EMQX unreachable     | `docker compose logs emqx`; check credentials in `.env`                                                             |

### Protocol Gateway Issues

| Symptom                  | Diagnosis                | Fix                                                                        |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| **Device "offline"**     | PLC unreachable          | `telnet <host> <port>`; check firewall, OT network                         |
| **No data in MQTT**      | Polling not started      | Check config sync: `docker compose logs protocol-gateway \| grep "config"` |
| **High poll latency**    | Too many tags per device | Reduce tag count or increase poll interval                                 |
| **OPC UA cert rejected** | Certificate not trusted  | Use `/api/opcua/certificates/rejected` → trust the cert                    |
| **Modbus errors**        | Wrong register addresses | Verify register map with device documentation                              |

### Data Ingestion Issues

| Symptom                    | Diagnosis                                | Fix                                                             |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------- |
| **No data in TimescaleDB** | Not subscribed to MQTT                   | Check: `docker compose logs data-ingestion \| grep "subscribe"` |
| **High buffer usage**      | DB writes too slow                       | Check TimescaleDB load; consider more writer threads            |
| **Data points dropped**    | Buffer full                              | Increase buffer size or reduce data rate                        |
| **Duplicate data**         | Multiple instances not using shared subs | Ensure `$share/ingestion/#` subscription                        |

### Infrastructure Issues

| Symptom                    | Diagnosis                  | Fix                                                                                                        |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **PostgreSQL won't start** | Volume corruption          | Backup data, remove volume, recreate                                                                       |
| **EMQX high memory**       | Too many retained messages | Clean retained: `docker compose exec emqx emqx_ctl retain clean`                                           |
| **Authentik 502**          | Still initializing         | Wait 60-90s on first boot; check DB connection                                                             |
| **Nginx 502**              | Upstream service not ready | Check depends_on health checks; restart nginx                                                              |
| **Disk full**              | TimescaleDB growth         | Enable compression/retention: see [TimescaleDB Operations](infrastructure/pages/timescaledb_operations.md) |

---

## Backup & Recovery

### Quick Backup

```bash
# Config database
docker compose exec postgres pg_dump -U nexus nexus_config > backup_config_$(date +%Y%m%d).sql

# Historian (TimescaleDB)
docker compose exec timescaledb pg_dump -U nexus_historian -Fc nexus_historian > backup_historian_$(date +%Y%m%d).dump

# Authentik database
docker compose exec authentik-db pg_dump -U authentik authentik > backup_authentik_$(date +%Y%m%d).sql
```

### Quick Restore

```bash
# Config database
cat backup_config.sql | docker compose exec -T postgres psql -U nexus nexus_config

# Historian
cat backup_historian.dump | docker compose exec -T timescaledb pg_restore -U nexus_historian -d nexus_historian

# Authentik
cat backup_authentik.sql | docker compose exec -T authentik-db psql -U authentik authentik
```

For complete backup/recovery procedures, see [Backup & Recovery](infrastructure/pages/backup_recovery.md).

---

## Scaling

### Horizontal Scaling (Data Ingestion)

Data Ingestion is stateless and supports horizontal scaling via MQTT shared subscriptions:

```bash
# Scale to 3 instances
docker compose up -d --scale data-ingestion=3
```

Each instance joins the `$share/ingestion/#` group — EMQX round-robins messages.

### Vertical Scaling (Gateway Core)

Gateway Core is single-instance (stateful — owns PostgreSQL connection):

```yaml
# docker-compose.override.yml
services:
  gateway-core:
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'
```

### Resource Tuning

| Service          | Default Memory | Prod Recommendation             |
| ---------------- | -------------- | ------------------------------- |
| PostgreSQL       | 256 MB         | 512 MB–1 GB                     |
| TimescaleDB      | 512 MB         | 1–4 GB (depends on data volume) |
| EMQX             | 256 MB         | 512 MB–1 GB                     |
| Gateway Core     | 256 MB         | 256–512 MB                      |
| Protocol Gateway | 128 MB         | 128–256 MB                      |
| Data Ingestion   | 128 MB         | 128–256 MB                      |
| Authentik        | 512 MB         | 512 MB–1 GB                     |

For complete scaling guide, see [Scaling Playbook](infrastructure/pages/scaling_playbook.md).

---

## Maintenance Windows

### Rolling Update (Zero Downtime)

```bash
# Pull new images
docker compose pull

# Recreate only changed services
docker compose up -d

# Verify health
docker compose ps
curl http://localhost/api/health/ready
```

### Database Migrations

Gateway Core runs migrations on startup (Drizzle ORM auto-migration). For major version upgrades:

```bash
# 1. Backup first
docker compose exec postgres pg_dump -U nexus nexus_config > pre_migration_backup.sql

# 2. Stop gateway-core
docker compose stop gateway-core

# 3. Update image and restart
docker compose up -d gateway-core

# 4. Verify
curl http://localhost/api/health/ready
docker compose logs --tail 20 gateway-core
```

### TimescaleDB Maintenance

```bash
# Manual compression (if not using policy)
docker compose exec timescaledb psql -U nexus_historian -d nexus_historian -c \
  "SELECT compress_chunk(c) FROM show_chunks('metrics', older_than => interval '7 days') c;"

# Check retention policy
docker compose exec timescaledb psql -U nexus_historian -d nexus_historian -c \
  "SELECT * FROM timescaledb_information.jobs WHERE proc_name = 'policy_retention';"
```

---

## Escalation Path

| Level                 | Who      | When                                               |
| --------------------- | -------- | -------------------------------------------------- |
| **L1: Self-service**  | Ops team | Service restart, log analysis, common issues above |
| **L2: Platform team** | DevOps   | Database issues, network problems, scaling         |
| **L3: Development**   | Dev team | Application bugs, protocol issues, feature gaps    |

---

## Cross-References

| Topic                         | Document                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Full infrastructure deep-dive | [Infrastructure Docs](../infrastructure/INDEX.md)                            |
| API endpoint details          | [API Reference](API_REFERENCE.md)                                            |
| MQTT topic details            | [MQTT Topic Contract](MQTT_TOPIC_CONTRACT.md)                                |
| Security configuration        | [Security Overview](SECURITY_OVERVIEW.md)                                    |
| Backup & recovery             | [Backup & Recovery](../infrastructure/pages/backup_recovery.md)              |
| Scaling playbook              | [Scaling Playbook](../infrastructure/pages/scaling_playbook.md)              |
| Troubleshooting (detailed)    | [Infrastructure Troubleshooting](../infrastructure/pages/troubleshooting.md) |

---

_Document Version: 1.0_
_Last Updated: March 2026_
