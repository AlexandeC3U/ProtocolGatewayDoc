# Getting Started — NEXUS Edge

> From zero to first data point in 15 minutes. Prerequisites, setup, verification,
> and your first device-to-historian data flow.

---

## Prerequisites

| Requirement        | Minimum                      | Recommended                                             | Check                      |
| ------------------ | ---------------------------- | ------------------------------------------------------- | -------------------------- |
| **Docker Engine**  | 24.x                         | 25.x+                                                   | `docker --version`         |
| **Docker Compose** | v2.20+                       | v2.24+                                                  | `docker compose version`   |
| **RAM**            | 4 GB free                    | 8 GB free                                               | `free -h` / Task Manager   |
| **Disk**           | 5 GB free                    | 10 GB free                                              | For images + volumes       |
| **Ports**          | 80, 1883, 3001               | See [full port map](../INDEX.md#quick-reference--ports) | `ss -tlnp` / `netstat -an` |
| **OS**             | Linux, macOS, Windows (WSL2) | Linux (Ubuntu 22.04+)                                   |                            |
| **Git**            | 2.x                          |                                                         | `git --version`            |

---

## Step 1 — Clone & Configure

```bash
# Clone the repository
git clone https://github.com/your-org/nexus-edge.git
cd nexus-edge

# Navigate to infrastructure
cd infrastructure/docker

# Create environment file from template
cp env.template .env
```

**Edit `.env`** — at minimum, change the security-critical values:

```bash
# Required changes for anything beyond local development
POSTGRES_PASSWORD=<strong-password>
HISTORIAN_PASSWORD=<strong-password>
AUTHENTIK_SECRET_KEY=<random-string-min-50-chars>
AUTHENTIK_DB_PASSWORD=<strong-password>
AUTHENTIK_ADMIN_PASSWORD=<strong-password>
MQTT_GATEWAY_PASS=<strong-password>
MQTT_PROTOCOL_PASS=<strong-password>
MQTT_HISTORIAN_PASS=<strong-password>
```

For local development, the defaults work out of the box.

---

## Step 2 — Start the Platform

```bash
# Start all services (from infrastructure/docker/)
docker compose up -d
```

This pulls images and starts **13 services** in dependency order:

```
Phase 1: Databases + Broker (no deps)
  ├── postgresql        Config database
  ├── timescaledb       Historian (time-series)
  ├── emqx              MQTT broker
  └── authentik-db      Auth database

Phase 2: Core services (depend on Phase 1)
  ├── gateway-core      Control plane API
  ├── protocol-gateway  Device polling
  ├── authentik-server  OIDC provider
  └── authentik-worker  Background tasks

Phase 3: Consumers + Frontend (depend on Phase 2)
  ├── data-ingestion    MQTT → TimescaleDB pipeline
  ├── web-ui            React frontend
  └── nginx             Reverse proxy (entry point)

Optional (enable with --profile):
  ├── prometheus        Metrics aggregation
  └── grafana           Dashboards
```

First startup takes 2-5 minutes (image pulls + database initialization).

---

## Step 3 — Verify All Services

```bash
# Check service status
docker compose ps

# Expected: all services "running" or "healthy"
```

### Health Check Endpoints

| Service                    | URL                               | Expected                                                 |
| -------------------------- | --------------------------------- | -------------------------------------------------------- |
| **Nginx** (entry point)    | http://localhost                  | Web UI loads                                             |
| **Gateway Core API**       | http://localhost/api/health       | `{"status":"ok"}`                                        |
| **Gateway Core readiness** | http://localhost/api/health/ready | `{"status":"ready","db":"connected","mqtt":"connected"}` |
| **EMQX Dashboard**         | http://localhost:18083            | Login page (admin / public)                              |
| **Authentik**              | http://localhost/auth/            | Login page                                               |
| **Prometheus**             | http://localhost:9090             | Prometheus UI (if enabled)                               |
| **Grafana**                | http://localhost:3000             | Grafana UI (if enabled)                                  |

### Quick Smoke Test

```bash
# Test API
curl http://localhost/api/health/ready

# List devices (should return empty array)
curl http://localhost/api/devices

# Check system info
curl http://localhost/api/system/info
```

---

## Step 4 — Create Your First Device

### 4a. Via Web UI

1. Open http://localhost in your browser
2. If auth is enabled, log in with Authentik (admin credentials from `.env`)
3. Navigate to **Devices** page
4. Click **Add Device**
5. Fill in:
   - **Name:** "Test PLC"
   - **Protocol:** Modbus TCP (or OPC UA, S7)
   - **Host:** IP address of your PLC/simulator
   - **Port:** 502 (Modbus), 4840 (OPC UA), 102 (S7)
6. Click **Test Connection** — verify connectivity
7. Click **Save** — device enters Phase 1 (created, no tags yet)

### 4b. Via API

```bash
# Create a Modbus TCP device
curl -X POST http://localhost/api/devices \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test PLC",
    "protocol": "modbus",
    "host": "192.168.1.100",
    "port": 502,
    "description": "First test device",
    "enabled": true,
    "pollInterval": 5000,
    "unsPrefix": "site/building/main"
  }'
```

Response includes the device ID — save it for the next step.

---

## Step 5 — Browse & Add Tags

### Two-Phase Device Setup

NEXUS uses a two-phase approach:

1. **Phase 1:** Create device, test connection (Step 4)
2. **Phase 2:** Browse address space, select and add tags (this step)

### Browse Device Address Space

```bash
# Browse available tags (replace DEVICE_ID)
curl -X POST http://localhost/api/devices/DEVICE_ID/browse \
  -H "Content-Type: application/json" \
  -d '{}'
```

For OPC UA devices, optionally specify a starting node:

```bash
curl -X POST http://localhost/api/devices/DEVICE_ID/browse \
  -H "Content-Type: application/json" \
  -d '{"node_id": "ns=2;s=Channel1", "max_depth": 3}'
```

### Add Tags (Bulk)

```bash
# Add tags from browse results
curl -X POST http://localhost/api/tags/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "tags": [
      {
        "deviceId": "DEVICE_ID",
        "name": "Temperature",
        "address": "40001",
        "dataType": "float32",
        "pollInterval": 5000,
        "enabled": true,
        "units": "°C"
      },
      {
        "deviceId": "DEVICE_ID",
        "name": "Pressure",
        "address": "40003",
        "dataType": "float32",
        "pollInterval": 5000,
        "enabled": true,
        "units": "bar"
      }
    ]
  }'
```

---

## Step 6 — Verify Data Flow

Once tags are added, the platform automatically begins polling:

```
Protocol Gateway polls PLC every 5s
    ↓
Publishes to MQTT: site/building/main/temperature
    ↓
Data Ingestion subscribes, batches, COPY to TimescaleDB
    ↓
Web UI receives live updates via WebSocket bridge
```

### Verify Each Step

```bash
# 1. Check device is polling (via protocol-gateway proxy)
curl http://localhost/api/devices/DEVICE_ID/status

# 2. Monitor MQTT messages (requires mosquitto-clients)
mosquitto_sub -h localhost -p 1883 \
  -u gateway -P gateway-mqtt-password-change-me \
  -t "site/building/main/#" -v

# 3. Query historian for stored data
curl "http://localhost/api/historian/history?topic=site/building/main/temperature&limit=10"

# 4. Check system health
curl http://localhost/api/system/health
```

### Via Web UI

1. Navigate to **Devices** — your device should show "online" status
2. Click the device — see live tag values updating in real-time
3. Navigate to **History** — see time-series data chart

---

## Step 7 — Optional: Enable Observability

```bash
# Start Prometheus + Grafana
docker compose --profile monitoring up -d

# Access Grafana
open http://localhost:3000
# Login: admin / <GRAFANA_PASSWORD from .env>
```

Grafana auto-provisions datasources (Prometheus, TimescaleDB) and a default dashboard.

### Key Metrics to Watch

| Metric                                | Source           | What It Tells You          |
| ------------------------------------- | ---------------- | -------------------------- |
| `gateway_http_requests_total`         | Gateway Core     | API request volume         |
| `gateway_ws_connections`              | Gateway Core     | Live WebSocket clients     |
| `gateway_proxy_circuit_breaker_state` | Gateway Core     | Protocol-gateway health    |
| Protocol-gateway metrics              | Protocol Gateway | Poll success/failure rates |
| `data_ingestion_points_written`       | Data Ingestion   | Historian throughput       |

---

## Data Flow Diagram

```
┌──────────────┐                                                    ┌──────────────┐
│              │   Modbus/OPC UA/S7    ┌──────────────────┐         │              │
│  Industrial  │ ◄────────────────────►│ Protocol Gateway │         │   Web UI     │
│   Devices    │   poll every 1-60s    │ (Go, :8080)      │         │ (React SPA)  │
│              │                       └────────┬─────────┘         └──────┬───────┘
└──────────────┘                                │                          │
                                                │ MQTT publish             │ WebSocket
                                                │ QoS 1                    │ subscribe
                                                ▼                          ▼
                                       ┌──────────────────┐        ┌──────────────┐
                                       │   EMQX Broker    │        │ Gateway Core │
                                       │   (MQTT, :1883)  │◄──────►│ (API, :3001) │
                                       └────────┬─────────┘        └──────┬───────┘
                                                │                         │
                              ┌─────────────────┤                         │ Drizzle ORM
                              │                 │                         ▼
                              ▼                 │                  ┌──────────────┐
                     ┌──────────────────┐       │                  │  PostgreSQL  │
                     │  Data Ingestion  │       │                  │  Config DB   │
                     │ (Go, COPY, :8080)│       │                  └──────────────┘
                     └────────┬─────────┘       │
                              │                 │
                              │ COPY protocol   │ Config notifications
                              ▼                 │
                     ┌──────────────────┐       │
                     │   TimescaleDB    │       │
                     │   Historian      │◄──────┘
                     └──────────────────┘
```

---

## Using a PLC Simulator (No Hardware Required)

If you don't have physical PLCs, use simulators:

### Modbus Simulator

```bash
# Install diagslave (Modbus TCP simulator)
# Linux:
wget https://www.modbusdriver.com/downloads/diagslave.tgz
tar xzf diagslave.tgz
./diagslave -m tcp -p 502

# Or use Docker:
docker run -d --name modbus-sim -p 502:502 \
  oitc/modbus-server
```

### OPC UA Simulator

```bash
# Use Prosys OPC UA Simulation Server (free)
# Download from: https://prosysopc.com/products/opc-ua-simulation-server/

# Or use open62541 Docker image:
docker run -d --name opcua-sim -p 4840:4840 \
  open62541/open62541
```

### S7 Simulator

```bash
# Use Snap7 server (free, cross-platform)
# Download from: https://snap7.sourceforge.net/

# Or use Docker:
docker run -d --name s7-sim -p 102:102 \
  simatic/s7-sim
```

---

## Troubleshooting First Startup

| Symptom                     | Cause                                          | Fix                                                                   |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `port already in use`       | Another service on port 80/1883/5432           | Stop conflicting service or change ports in `.env`                    |
| `gateway-core` unhealthy    | PostgreSQL or EMQX not ready                   | Wait 30s, check: `docker compose logs gateway-core`                   |
| Authentik `502 Bad Gateway` | Authentik still initializing (slow first boot) | Wait 60-90s; check: `docker compose logs authentik-server`            |
| MQTT connection refused     | EMQX not ready or wrong credentials            | Check: `docker compose logs emqx`; verify credentials in `.env`       |
| No data in historian        | Data ingestion not subscribed                  | Check: `docker compose logs data-ingestion`; verify MQTT topics match |
| Web UI blank page           | Nginx or web-ui container not started          | Check: `docker compose logs nginx web-ui`                             |
| Device shows "offline"      | PLC unreachable or wrong host/port             | Test with `telnet <host> <port>`; check protocol-gateway logs         |

### Check Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f gateway-core
docker compose logs -f protocol-gateway
docker compose logs -f data-ingestion

# Last 50 lines
docker compose logs --tail 50 gateway-core
```

---

## Next Steps

| What                         | Where                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| Understand the architecture  | [Architecture](../ARCHITECTURE.md)                                     |
| Learn the API                | [API Reference](API_REFERENCE.md)                                      |
| Understand MQTT messaging    | [MQTT Topic Contract](MQTT_TOPIC_CONTRACT.md)                          |
| Set up authentication        | [Security Overview](SECURITY_OVERVIEW.md)                              |
| Deploy to production (K8s)   | [Infrastructure Docs](../infrastructure/INDEX.md)                      |
| Add more devices / protocols | [Protocol Gateway Docs](../services/protocol-gateway/INDEX.md)         |
| Customize the Web UI         | [Web UI Docs](../services/web-ui/INDEX.md)                             |
| Set up dashboards            | [Grafana + Prometheus](../infrastructure/pages/observability_stack.md) |

---

_Document Version: 1.0_
_Last Updated: March 2026_
