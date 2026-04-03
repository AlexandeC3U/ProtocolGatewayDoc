# API Reference — NEXUS Edge Gateway Core

> Complete REST API and WebSocket endpoint reference for the Gateway Core service.
> Every endpoint, request/response schema, authentication requirement, and error code.

---

## Base URL

| Environment                | Base URL                       |
| -------------------------- | ------------------------------ |
| Docker Compose (via Nginx) | `http://localhost/api`         |
| Docker Compose (direct)    | `http://localhost:3001`        |
| Kubernetes (via Ingress)   | `https://<cluster-domain>/api` |

All endpoints below are relative to the base URL (e.g., `/devices` = `http://localhost/api/devices`).

---

## Authentication

| Header          | Value                   |
| --------------- | ----------------------- |
| `Authorization` | `Bearer <access_token>` |

- Authentication is **optional** when `AUTH_ENABLED=false` (development mode)
- When enabled, unauthenticated requests to protected endpoints return `401`
- Tokens are issued by Authentik (OIDC) — see [Security Overview](SECURITY_OVERVIEW.md)
- Public endpoints (no auth required): `/health`, `/health/live`, `/health/ready`, `/metrics`, `/docs`, `/`

### Role Hierarchy

```
viewer (0) → operator (1) → engineer (2) → admin (3)
```

Higher roles inherit all permissions from lower roles.

---

## Request/Response Conventions

| Convention      | Details                                                    |
| --------------- | ---------------------------------------------------------- |
| Content-Type    | `application/json`                                         |
| Body size limit | 1 MB                                                       |
| Date format     | ISO 8601 (`2026-03-23T10:30:45.000Z`)                      |
| IDs             | UUID v4                                                    |
| Pagination      | `?limit=N&offset=N`                                        |
| Search          | `?search=keyword` (partial match on name/description)      |
| Error format    | `{"statusCode": N, "error": "Type", "message": "Details"}` |

---

## Endpoint Overview

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         GATEWAY CORE API MAP                                   │
│                                                                                │
│  PUBLIC (no auth)                                                              │
│  ├── GET  /                           Service info                             │
│  ├── GET  /health                     Basic liveness                           │
│  ├── GET  /health/live                K8s liveness probe                       │
│  ├── GET  /health/ready               Readiness (DB + MQTT check)              │
│  ├── GET  /metrics                    Prometheus metrics                       │
│  └── GET  /docs                       Swagger UI                               │
│                                                                                │
│  DEVICES  /api/devices                                                         │
│  ├── GET  /                           List devices (filterable)                │
│  ├── GET  /:id                        Get device by ID                         │
│  ├── POST /                           Create device (engineer+)                │
│  ├── PUT  /:id                        Update device (engineer+)                │
│  ├── DELETE /:id                      Delete device + tags (engineer+)         │
│  ├── POST /:id/toggle                 Toggle enabled (operator+)               │
│  ├── POST /:id/test                   Test connection (operator+, rate-limited)│
│  ├── POST /:id/browse                 Browse address space (operator+, r/l)    │
│  └── GET  /:id/status                 Runtime status (from protocol-gateway)   │
│                                                                                │
│  TAGS  /api/tags                                                               │
│  ├── GET  /                           List tags (filterable)                   │
│  ├── GET  /:id                        Get tag by ID                            │
│  ├── POST /                           Create tag (engineer+)                   │
│  ├── POST /bulk                       Bulk create tags (engineer+)             │
│  ├── PUT  /:id                        Update tag (engineer+)                   │
│  ├── DELETE /:id                      Delete tag (engineer+)                   │
│  └── POST /:id/toggle                 Toggle enabled (operator+)               │
│                                                                                │
│  OPC UA  /api/opcua                                                            │
│  ├── GET  /certificates/trusted       List trusted certs (engineer+)           │
│  ├── GET  /certificates/rejected      List rejected certs (engineer+)          │
│  ├── POST /certificates/trust         Trust a rejected cert (engineer+)        │
│  └── DELETE /certificates/trusted/:fp Remove trusted cert (engineer+)          │
│                                                                                │
│  SYSTEM  /api/system                                                           │
│  ├── GET  /health                     Aggregated platform health               │
│  ├── GET  /info                       Service info + stats                     │
│  ├── GET  /containers                 Running containers (engineer+)           │
│  ├── GET  /logs                       Container logs (engineer+)               │
│  ├── GET  /audit                      Audit log query (admin+)                 │
│  └── GET  /topics                     Active MQTT topics (engineer+)           │
│                                                                                │
│  HISTORIAN  /api/historian                                                     │
│  └── GET  /history                    Query tag history (time-series)          │
│                                                                                │
│  WEBSOCKET                                                                     │
│  └── GET  /ws                         MQTT→WS bridge (upgrade to WebSocket)    │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Health & System Endpoints

### `GET /`

Service root — returns basic info and links.

**Auth:** None

```bash
curl http://localhost/api/
```

---

### `GET /health`

Basic liveness check.

**Auth:** None

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-03-23T10:30:45.000Z"
}
```

---

### `GET /health/live`

Kubernetes liveness probe. Returns 200 if process is alive.

**Auth:** None

**Response:** `200 OK` with `{"status": "ok"}`

---

### `GET /health/ready`

Readiness probe — checks DB and MQTT connectivity.

**Auth:** None

**Response (healthy):**

```json
{
  "status": "ready",
  "db": "connected",
  "mqtt": "connected"
}
```

**Response (unhealthy):** `503 Service Unavailable`

```json
{
  "status": "not_ready",
  "db": "disconnected",
  "mqtt": "connected"
}
```

---

### `GET /metrics`

Prometheus metrics endpoint. Returns all registered metrics in Prometheus exposition format.

**Auth:** None

**Response:** `text/plain` (Prometheus format)

```
# HELP gateway_http_requests_total Total HTTP requests
# TYPE gateway_http_requests_total counter
gateway_http_requests_total{method="GET",route="/api/devices",status="200"} 142

# HELP gateway_ws_connections Current WebSocket connections
# TYPE gateway_ws_connections gauge
gateway_ws_connections 3
```

---

### `GET /docs`

Swagger/OpenAPI documentation UI.

**Auth:** None

---

## Device Endpoints

### `GET /api/devices`

List all devices with optional filtering and pagination.

**Auth:** None (read)

**Query Parameters:**

| Parameter     | Type      | Default | Description                                                                     |
| ------------- | --------- | ------- | ------------------------------------------------------------------------------- |
| `protocol`    | `string`  | —       | Filter by protocol: `modbus`, `opcua`, `s7`, `mqtt`, `bacnet`, `ethernetip`     |
| `status`      | `string`  | —       | Filter by runtime status: `online`, `offline`, `error`, `unknown`, `connecting` |
| `setupStatus` | `string`  | —       | Filter by setup phase: `created`, `tested`, `browsed`, `configured`             |
| `enabled`     | `boolean` | —       | Filter by enabled state                                                         |
| `search`      | `string`  | —       | Partial match on name or description                                            |
| `limit`       | `number`  | 50      | Results per page (max: 200)                                                     |
| `offset`      | `number`  | 0       | Pagination offset                                                               |

**Response:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Temperature Sensor",
      "description": "Main building temp",
      "protocol": "modbus",
      "host": "192.168.1.100",
      "port": 502,
      "enabled": true,
      "pollInterval": 5000,
      "unsPrefix": "site/building/main",
      "setupStatus": "configured",
      "config": {},
      "createdAt": "2026-03-23T09:00:00.000Z",
      "updatedAt": "2026-03-23T10:30:45.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

```bash
# List all Modbus devices
curl "http://localhost/api/devices?protocol=modbus"

# Search for "temperature"
curl "http://localhost/api/devices?search=temperature&limit=10"
```

---

### `GET /api/devices/:id`

Get a single device by ID, optionally including its tags.

**Auth:** None (read)

**Query Parameters:**

| Parameter     | Type      | Default | Description                         |
| ------------- | --------- | ------- | ----------------------------------- |
| `includeTags` | `boolean` | `false` | Include associated tags in response |

**Response:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Temperature Sensor",
  "description": "Main building temp",
  "protocol": "modbus",
  "host": "192.168.1.100",
  "port": 502,
  "enabled": true,
  "pollInterval": 5000,
  "unsPrefix": "site/building/main",
  "setupStatus": "configured",
  "config": {},
  "createdAt": "2026-03-23T09:00:00.000Z",
  "updatedAt": "2026-03-23T10:30:45.000Z",
  "tags": [
    {
      "id": "tag-uuid",
      "name": "Temperature",
      "address": "40001",
      "dataType": "float32",
      "enabled": true
    }
  ]
}
```

**Errors:** `404 Not Found` if device does not exist.

---

### `POST /api/devices`

Create a new device (Phase 1 of two-phase setup).

**Auth:** `engineer+`

**Request Body:**

```json
{
  "name": "Temperature Sensor",
  "protocol": "modbus",
  "host": "192.168.1.100",
  "port": 502,
  "description": "Main building temp",
  "enabled": true,
  "pollInterval": 5000,
  "unsPrefix": "site/building/main",
  "config": {}
}
```

| Field          | Type      | Required | Default | Description                                             |
| -------------- | --------- | -------- | ------- | ------------------------------------------------------- |
| `name`         | `string`  | Yes      | —       | Unique device name                                      |
| `protocol`     | `enum`    | Yes      | —       | `modbus`, `opcua`, `s7`, `mqtt`, `bacnet`, `ethernetip` |
| `host`         | `string`  | Yes      | —       | IP address or hostname                                  |
| `port`         | `number`  | Yes      | —       | TCP port                                                |
| `description`  | `string`  | No       | `""`    | Human-readable description                              |
| `enabled`      | `boolean` | No       | `true`  | Start polling immediately                               |
| `pollInterval` | `number`  | No       | `5000`  | Polling interval in milliseconds                        |
| `unsPrefix`    | `string`  | No       | `""`    | UNS topic prefix                                        |
| `config`       | `object`  | No       | `{}`    | Protocol-specific configuration                         |

**Response:** `201 Created` with the created device object.

**Side Effects:**

- Publishes MQTT message to `$nexus/config/devices/{id}` with `action: "create"`
- Audit log entry: `device.create`

**Errors:**

- `400` — Validation error (missing required fields, invalid protocol)
- `409` — Conflict (device name already exists)

---

### `PUT /api/devices/:id`

Update an existing device.

**Auth:** `engineer+`

**Request Body:** Same schema as POST (all fields optional except cannot change `protocol`).

**Response:** `200 OK` with updated device object.

**Side Effects:**

- Publishes MQTT message to `$nexus/config/devices/{id}` with `action: "update"`
- Protocol Gateway reloads device config (may restart connection)
- Audit log entry: `device.update`

---

### `DELETE /api/devices/:id`

Delete a device and all its associated tags.

**Auth:** `engineer+`

**Response:** `200 OK`

**Side Effects:**

- Publishes MQTT message to `$nexus/config/devices/{id}` with `action: "delete"`
- Protocol Gateway stops polling and closes connection
- All tags for this device are deleted
- Audit log entry: `device.delete`

---

### `POST /api/devices/:id/toggle`

Toggle a device's enabled/disabled state.

**Auth:** `operator+`

**Response:** `200 OK` with updated device object.

**Side Effects:**

- Publishes config update via MQTT
- Protocol Gateway starts/stops polling
- Audit log entry: `device.toggle`

---

### `POST /api/devices/:id/test`

Test device connectivity. Proxied to Protocol Gateway.

**Auth:** `operator+`
**Rate Limit:** 10 requests/minute

**Request Body:** Empty `{}` or optional connection override.

**Response:**

```json
{
  "success": true,
  "message": "Connected successfully",
  "latency_ms": 45,
  "details": {
    "protocol": "modbus",
    "host": "192.168.1.100",
    "port": 502
  }
}
```

**Errors:**

- `503` — Circuit breaker open (protocol-gateway unavailable)
- `504` — Timeout (PLC unreachable)

---

### `POST /api/devices/:id/browse`

Browse device address space (protocol-agnostic). Proxied to Protocol Gateway.

**Auth:** `operator+`
**Rate Limit:** 10 requests/minute

**Request Body:**

```json
{
  "node_id": "ns=2;s=Channel1",
  "max_depth": 3
}
```

| Field       | Type     | Required | Default | Description                    |
| ----------- | -------- | -------- | ------- | ------------------------------ |
| `node_id`   | `string` | No       | root    | Starting node (OPC UA node ID) |
| `max_depth` | `number` | No       | 2       | Browse depth                   |

**Response:**

```json
{
  "nodes": [
    {
      "id": "ns=2;s=Channel1.Device1.Temperature",
      "name": "Temperature",
      "type": "Variable",
      "dataType": "Float",
      "readable": true,
      "writable": false,
      "children": []
    }
  ]
}
```

For Modbus devices, returns available register ranges. For S7, returns DB/flag areas.

---

### `GET /api/devices/:id/status`

Get device runtime status and polling stats. Proxied to Protocol Gateway.

**Auth:** None (read)

**Response:**

```json
{
  "status": "online",
  "last_seen": "2026-03-23T10:30:45.000Z",
  "last_error": null,
  "stats": {
    "total_polls": 1842,
    "success_polls": 1840,
    "failed_polls": 2
  }
}
```

---

## Tag Endpoints

### `GET /api/tags`

List all tags with optional filtering.

**Auth:** None (read)

**Query Parameters:**

| Parameter  | Type      | Default | Description                                                                   |
| ---------- | --------- | ------- | ----------------------------------------------------------------------------- |
| `deviceId` | `string`  | —       | Filter by device UUID                                                         |
| `dataType` | `string`  | —       | Filter by data type: `bool`, `int16`, `int32`, `float32`, `float64`, `string` |
| `enabled`  | `boolean` | —       | Filter by enabled state                                                       |
| `search`   | `string`  | —       | Partial match on name or address                                              |
| `limit`    | `number`  | 50      | Results per page (max: 200)                                                   |
| `offset`   | `number`  | 0       | Pagination offset                                                             |

**Response:**

```json
{
  "data": [
    {
      "id": "tag-uuid",
      "deviceId": "device-uuid",
      "name": "Temperature",
      "description": "Room temperature",
      "address": "40001",
      "dataType": "float32",
      "enabled": true,
      "scaleFactor": 1.0,
      "scaleOffset": 0.0,
      "clampMin": null,
      "clampMax": null,
      "units": "°C",
      "deadband": 0.5,
      "accessMode": "read",
      "priority": 0,
      "byteOrder": "big_endian",
      "registerType": "input_register",
      "opcNodeId": "",
      "s7Address": "",
      "topicSuffix": "temperature",
      "createdAt": "2026-03-23T09:00:00.000Z",
      "updatedAt": "2026-03-23T10:30:45.000Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

---

### `GET /api/tags/:id`

Get a single tag by ID.

**Auth:** None (read)

**Errors:** `404 Not Found`

---

### `POST /api/tags`

Create a single tag (Phase 2 of two-phase device setup).

**Auth:** `engineer+`

**Request Body:**

```json
{
  "deviceId": "device-uuid",
  "name": "Temperature",
  "address": "40001",
  "dataType": "float32",
  "description": "Room temperature",
  "enabled": true,
  "scaleFactor": 1.0,
  "scaleOffset": 0.0,
  "clampMin": -50.0,
  "clampMax": 150.0,
  "units": "°C",
  "deadband": 0.5,
  "accessMode": "read",
  "priority": 0,
  "byteOrder": "big_endian",
  "registerType": "input_register",
  "opcNodeId": "",
  "s7Address": "",
  "topicSuffix": "temperature"
}
```

| Field          | Type      | Required | Default              | Description                                                                  |
| -------------- | --------- | -------- | -------------------- | ---------------------------------------------------------------------------- |
| `deviceId`     | `string`  | Yes      | —                    | Parent device UUID                                                           |
| `name`         | `string`  | Yes      | —                    | Tag name                                                                     |
| `address`      | `string`  | Yes      | —                    | Protocol address (register, node ID, DB address)                             |
| `dataType`     | `enum`    | Yes      | —                    | `bool`, `int16`, `int32`, `uint16`, `uint32`, `float32`, `float64`, `string` |
| `description`  | `string`  | No       | `""`                 | Human-readable description                                                   |
| `enabled`      | `boolean` | No       | `true`               | Active for polling                                                           |
| `scaleFactor`  | `number`  | No       | `1.0`                | Multiply raw value by this                                                   |
| `scaleOffset`  | `number`  | No       | `0.0`                | Add to scaled value                                                          |
| `clampMin`     | `number`  | No       | `null`               | Minimum allowed value                                                        |
| `clampMax`     | `number`  | No       | `null`               | Maximum allowed value                                                        |
| `units`        | `string`  | No       | `""`                 | Engineering unit                                                             |
| `deadband`     | `number`  | No       | `0`                  | Change threshold before publish                                              |
| `accessMode`   | `enum`    | No       | `"read"`             | `read`, `write`, `readwrite`                                                 |
| `priority`     | `number`  | No       | `0`                  | Polling priority (higher = more frequent)                                    |
| `byteOrder`    | `enum`    | No       | `"big_endian"`       | `big_endian`, `little_endian`, `big_endian_swap`, `little_endian_swap`       |
| `registerType` | `enum`    | No       | `"holding_register"` | `holding_register`, `input_register`, `coil`, `discrete_input`               |
| `opcNodeId`    | `string`  | No       | `""`                 | OPC UA node ID                                                               |
| `s7Address`    | `string`  | No       | `""`                 | S7 address (e.g., `DB1.DBD0`)                                                |
| `topicSuffix`  | `string`  | No       | name                 | MQTT topic suffix                                                            |

**Response:** `201 Created`

**Side Effects:**

- Publishes to `$nexus/config/tags/{deviceId}/{tagId}` with `action: "create"`
- Protocol Gateway adds tag to polling loop
- Audit log entry: `tag.create`

---

### `POST /api/tags/bulk`

Bulk create tags (1-1000). Typically used after device browse to add selected tags.

**Auth:** `engineer+`

**Request Body:**

```json
{
  "tags": [
    {
      "deviceId": "device-uuid",
      "name": "Temperature",
      "address": "40001",
      "dataType": "float32"
    },
    {
      "deviceId": "device-uuid",
      "name": "Pressure",
      "address": "40003",
      "dataType": "float32"
    }
  ]
}
```

| Constraint                          | Value                |
| ----------------------------------- | -------------------- |
| Minimum tags                        | 1                    |
| Maximum tags                        | 1,000                |
| All tags must belong to same device | No (can mix devices) |

**Response:** `201 Created` with array of created tags.

**Side Effects:**

- Publishes individual MQTT notifications per tag
- Audit log entry: `system.bulk_create`

---

### `PUT /api/tags/:id`

Update an existing tag.

**Auth:** `engineer+`

**Request Body:** Same schema as POST (all fields optional).

**Side Effects:**

- Publishes to `$nexus/config/tags/{deviceId}/{tagId}` with `action: "update"`
- Audit log entry: `tag.update`

---

### `DELETE /api/tags/:id`

Delete a tag.

**Auth:** `engineer+`

**Side Effects:**

- Publishes to `$nexus/config/tags/{deviceId}/{tagId}` with `action: "delete"`
- Protocol Gateway removes tag from polling loop
- Audit log entry: `tag.delete`

---

### `POST /api/tags/:id/toggle`

Toggle a tag's enabled/disabled state.

**Auth:** `operator+`

---

## OPC UA Certificate Endpoints

All OPC UA certificate operations are proxied to Protocol Gateway.

### `GET /api/opcua/certificates/trusted`

List trusted OPC UA certificates in the PKI trust store.

**Auth:** `engineer+`

**Response:**

```json
[
  {
    "fingerprint": "SHA256:abc123...",
    "subject": "CN=OPC UA Server, O=Vendor",
    "issuer": "CN=Vendor CA",
    "validFrom": "2025-01-01T00:00:00Z",
    "validTo": "2030-01-01T00:00:00Z"
  }
]
```

---

### `GET /api/opcua/certificates/rejected`

List rejected certificates (auto-collected during connection attempts).

**Auth:** `engineer+`

---

### `POST /api/opcua/certificates/trust`

Promote a rejected certificate to trusted.

**Auth:** `engineer+`

**Request Body:**

```json
{
  "fingerprint": "SHA256:abc123..."
}
```

---

### `DELETE /api/opcua/certificates/trusted/:fingerprint`

Remove a certificate from the trusted store.

**Auth:** `engineer+`

---

## System Endpoints

### `GET /api/system/health`

Aggregated health of all platform services.

**Auth:** None

**Response:**

```json
{
  "overall": "healthy",
  "services": {
    "db": "connected",
    "mqtt": "connected",
    "websocket": { "connections": 3, "subscriptions": 12 },
    "protocolGateway": "reachable",
    "dataIngestion": "reachable"
  }
}
```

---

### `GET /api/system/info`

Service metadata and runtime statistics.

**Auth:** None

**Response:**

```json
{
  "service": "gateway-core",
  "version": "2.0.0",
  "uptime": 86400,
  "environment": "production",
  "node": "v20.11.0",
  "features": {
    "auth": true,
    "audit": true,
    "rateLimit": false
  },
  "websocket": {
    "connections": 3,
    "subscriptions": 12
  },
  "memory": {
    "rss": 67108864,
    "heapUsed": 42000000,
    "heapTotal": 67108864
  }
}
```

---

### `GET /api/system/containers`

List running Docker containers (proxied to Protocol Gateway).

**Auth:** `engineer+`

---

### `GET /api/system/logs`

View container logs (proxied to Protocol Gateway).

**Auth:** `engineer+`

**Query Parameters:**

| Parameter   | Type     | Default | Description         |
| ----------- | -------- | ------- | ------------------- |
| `container` | `string` | —       | Container name      |
| `tail`      | `number` | 100     | Number of log lines |

---

### `GET /api/system/audit`

Query the audit log. **Admin only.**

**Auth:** `admin+`

**Query Parameters:**

| Parameter      | Type     | Default | Description                                     |
| -------------- | -------- | ------- | ----------------------------------------------- |
| `username`     | `string` | —       | Filter by username                              |
| `action`       | `string` | —       | Filter by action (e.g., `device.create`)        |
| `resourceType` | `string` | —       | Filter by resource type (e.g., `device`, `tag`) |
| `since`        | `string` | —       | ISO 8601 timestamp (events after this time)     |
| `limit`        | `number` | 50      | Results per page (max: 200)                     |
| `offset`       | `number` | 0       | Pagination offset                               |

**Response:**

```json
{
  "data": [
    {
      "id": "audit-uuid",
      "userSub": "hashed-user-id",
      "username": "admin",
      "action": "device.create",
      "resourceType": "device",
      "resourceId": "device-uuid",
      "details": {
        "method": "POST",
        "url": "/api/devices",
        "statusCode": 201
      },
      "ipAddress": "172.28.0.1",
      "createdAt": "2026-03-23T10:30:45.000Z"
    }
  ],
  "total": 42,
  "limit": 50,
  "offset": 0
}
```

**Audit Actions:**

| Action               | Trigger                                    |
| -------------------- | ------------------------------------------ |
| `device.create`      | POST /api/devices                          |
| `device.update`      | PUT /api/devices/:id                       |
| `device.delete`      | DELETE /api/devices/:id                    |
| `device.toggle`      | POST /api/devices/:id/toggle               |
| `device.test`        | POST /api/devices/:id/test                 |
| `device.browse`      | POST /api/devices/:id/browse               |
| `tag.create`         | POST /api/tags                             |
| `tag.update`         | PUT /api/tags/:id                          |
| `tag.delete`         | DELETE /api/tags/:id                       |
| `certificate.trust`  | POST /api/opcua/certificates/trust         |
| `certificate.delete` | DELETE /api/opcua/certificates/trusted/:fp |
| `system.bulk_create` | POST /api/tags/bulk                        |

---

### `GET /api/system/topics`

Active MQTT topics overview (proxied to Protocol Gateway).

**Auth:** `engineer+`

---

## Historian Endpoints

### `GET /api/historian/history`

Query time-series data from TimescaleDB. Proxied to Data Ingestion service.

**Auth:** None

**Query Parameters:**

| Parameter | Type     | Required | Default    | Description                                         |
| --------- | -------- | -------- | ---------- | --------------------------------------------------- |
| `topic`   | `string` | Yes      | —          | MQTT topic (e.g., `site/building/main/temperature`) |
| `from`    | `number` | No       | 1 hour ago | Start time (Unix ms)                                |
| `to`      | `number` | No       | now        | End time (Unix ms)                                  |
| `limit`   | `number` | No       | 500        | Max data points (max: 5000)                         |

**Response:**

```json
{
  "topic": "site/building/main/temperature",
  "from": 1711266645000,
  "to": 1711270245000,
  "count": 720,
  "data": [
    {
      "timestamp": "2026-03-23T10:30:45.000Z",
      "value": 23.5,
      "quality": "good"
    }
  ],
  "stats": {
    "min": 21.2,
    "max": 25.8,
    "avg": 23.4,
    "stddev": 1.1
  }
}
```

```bash
# Last hour of temperature data
curl "http://localhost/api/historian/history?topic=site/building/main/temperature"

# Specific time range
curl "http://localhost/api/historian/history?topic=site/building/main/temperature&from=1711266645000&to=1711270245000&limit=1000"
```

---

## WebSocket Endpoint

### `GET /ws` (Upgrade to WebSocket)

MQTT-to-WebSocket bridge for real-time data streaming to browser clients.

**Auth:** Bearer token required (if `AUTH_ENABLED=true`)
**Protocol:** WebSocket (HTTP upgrade)

### Connection

```javascript
// Browser client
const ws = new WebSocket('ws://localhost/ws');
// With auth: pass token as query param or in first message
const ws = new WebSocket('ws://localhost/ws?token=<access_token>');
```

### Client Messages

**Subscribe:**

```json
{
  "type": "subscribe",
  "topics": ["$nexus/status/devices/device-123", "$nexus/data/site/building/main/#"]
}
```

**Unsubscribe:**

```json
{
  "type": "unsubscribe",
  "topics": ["$nexus/status/devices/device-123"]
}
```

### Server Messages

**Data (MQTT message forwarded):**

```json
{
  "type": "data",
  "topic": "$nexus/data/site/building/main/temperature",
  "payload": {
    "v": 23.5,
    "q": "good",
    "u": "°C",
    "ts": 1711270245000
  },
  "timestamp": "2026-03-23T10:30:45.000Z"
}
```

**Error:**

```json
{
  "type": "error",
  "message": "Topic not allowed: $nexus/config/devices/abc"
}
```

### Topic Restrictions

Only two prefixes are allowed for WebSocket subscriptions:

| Prefix           | Purpose               |
| ---------------- | --------------------- |
| `$nexus/data/`   | Live tag values       |
| `$nexus/status/` | Device status updates |

Subscribing to other prefixes (e.g., `$nexus/config/`, `$nexus/cmd/`) returns an error.

### Limits

| Parameter                        | Value                                            |
| -------------------------------- | ------------------------------------------------ |
| Max subscriptions per client     | `WS_MAX_SUBSCRIPTIONS_PER_CLIENT` (default: 100) |
| Max topics per subscribe message | 50                                               |
| Heartbeat (ping) interval        | 30 seconds                                       |
| Idle timeout                     | 60 seconds                                       |

---

## Error Responses

All errors follow a consistent format:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Device not found: 550e8400-e29b-41d4-a716-446655440000"
}
```

### Error Codes

| Status | Error Class          | When                                                            |
| ------ | -------------------- | --------------------------------------------------------------- |
| `400`  | `ValidationError`    | Invalid request body, missing required fields, bad query params |
| `401`  | `UnauthorizedError`  | Missing or invalid Bearer token, expired JWT                    |
| `403`  | `ForbiddenError`     | Insufficient role (e.g., viewer trying to create a device)      |
| `404`  | `NotFoundError`      | Resource does not exist                                         |
| `409`  | `ConflictError`      | Duplicate name, constraint violation                            |
| `429`  | Rate Limited         | Too many requests (when rate limiting enabled)                  |
| `500`  | Internal Error       | Unexpected server error                                         |
| `503`  | Circuit Breaker Open | Protocol-gateway or data-ingestion unavailable                  |

### Rate Limit Headers (when `RATE_LIMIT_ENABLED=true`)

| Header                  | Description                        |
| ----------------------- | ---------------------------------- |
| `x-ratelimit-limit`     | Max requests per window            |
| `x-ratelimit-remaining` | Remaining requests in window       |
| `x-ratelimit-reset`     | Window reset time (Unix timestamp) |
| `retry-after`           | Seconds to wait (only on 429)      |

**Global rate limit:** 100 requests/minute per user (or IP if unauthenticated).
**Per-route rate limits:** Device test + browse: 10 requests/minute.
**Allowlisted IPs:** `127.0.0.1`, `::1` (bypass rate limiting).

---

## Proxy Routes (Internal)

These endpoints forward requests to downstream services with circuit breaker protection:

| Gateway Core Route              | Proxied To                  | Service          |
| ------------------------------- | --------------------------- | ---------------- |
| `POST /api/devices/:id/test`    | `/api/test-connection`      | Protocol Gateway |
| `POST /api/devices/:id/browse`  | `/api/browse/:id`           | Protocol Gateway |
| `GET /api/devices/:id/status`   | `/status`                   | Protocol Gateway |
| `GET /api/opcua/certificates/*` | `/api/opcua/certificates/*` | Protocol Gateway |
| `GET /api/system/containers`    | `/api/logs/containers`      | Protocol Gateway |
| `GET /api/system/logs`          | `/api/logs`                 | Protocol Gateway |
| `GET /api/system/topics`        | `/api/topics`               | Protocol Gateway |
| `GET /api/historian/history`    | `/api/history`              | Data Ingestion   |

**Circuit Breaker:**

- **Threshold:** 5 consecutive failures → circuit opens
- **Cooldown:** 30 seconds before probe attempt
- **Open behavior:** Returns `503 Service Unavailable` immediately
- **Timeout:** 30 seconds per proxied request

---

## Cross-References

| Topic                   | Document                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Authentication flow     | [Security Overview](SECURITY_OVERVIEW.md)                                                           |
| MQTT messaging          | [MQTT Topic Contract](MQTT_TOPIC_CONTRACT.md)                                                       |
| Middleware internals    | [Gateway Core — Middleware Architecture](../services/gateway-core/pages/middleware_architecture.md) |
| Proxy & circuit breaker | [Gateway Core — Proxy Architecture](../services/gateway-core/pages/proxy_architecture.md)           |
| WebSocket bridge        | [Gateway Core — WebSocket Bridge](../services/gateway-core/pages/websocket_bridge.md)               |
| Prometheus metrics      | [Gateway Core — Observability](../services/gateway-core/pages/observability.md)                     |
| Env var reference       | [Gateway Core — Configuration Reference](../services/gateway-core/pages/configuration_reference.md) |

---

_Document Version: 1.0_
_Last Updated: March 2026_
