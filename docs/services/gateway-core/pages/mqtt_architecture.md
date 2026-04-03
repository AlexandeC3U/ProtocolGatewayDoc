# Chapter 7 — MQTT Architecture

> Publisher, subscriber, transform layer, and topic contract.

---

## Topic Contract

```
$nexus/
├── config/
│   ├── devices/{deviceId}                ← Device config notification (QoS 1)
│   ├── devices/bulk                      ← Bulk sync response (all devices)
│   ├── devices/{deviceId}/status/request ← Status request to protocol-gateway
│   ├── tags/{deviceId}/{tagId}           ← Tag config notification (QoS 1)
│   └── sync/request                      ← Sync request from protocol-gateway
│
├── status/
│   └── devices/{deviceId}                ← Status update from protocol-gateway
│
└── data/
    └── {unsPrefix}/{topicSuffix}         ← Live tag data (published by protocol-gateway)
```

## Publisher (client.ts)

### Connection

```typescript
{
  clientId: 'gateway-core-{timestamp}',   // Unique per instance
  clean: true,                             // No persistent session needed
  reconnectPeriod: 5000,                  // 5s between reconnect attempts
  connectTimeout: 30000,                  // 30s initial connect timeout
  username: env.MQTT_USERNAME,            // Optional auth
  password: env.MQTT_PASSWORD,
}
```

### Published Messages

#### Device Config Notification

**When:** device create, update, delete, toggle
**Topic:** `$nexus/config/devices/{deviceId}`
**QoS:** 1

```json
{
  "action": "create",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "data": {
    "id": "uuid",
    "name": "Production PLC",
    "protocol": "modbus_tcp",
    "enabled": true,
    "connection": { "host": "192.168.1.100", "port": 502, "timeout": "10s" },
    "uns_prefix": "acme/plant1/line1",
    "poll_interval": "1000ms",
    "tags": [
      /* PGTag[] */
    ],
    "config_version": 3
  }
}
```

#### Tag Config Notification

**When:** tag create, update, delete, toggle
**Topic:** `$nexus/config/tags/{deviceId}/{tagId}`
**QoS:** 1

```json
{
  "action": "create",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "data": {
    /* PGTag format */
  }
}
```

#### Bulk Config (Sync Response)

**When:** protocol-gateway publishes sync request
**Topic:** `$nexus/config/devices/bulk`

```json
{
  "action": "sync",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "data": [
    /* Array of PGDevice with tags */
  ]
}
```

#### Status Request

**When:** device page opened in UI, manual refresh
**Topic:** `$nexus/config/devices/{deviceId}/status/request`

```json
{ "timestamp": "2026-03-19T10:30:00.000Z" }
```

### Message Handler Pattern

The MQTT client supports multiple message handlers (broadcast):

```
MQTT Message Received
        │
        ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Handler 1    │    │  Handler 2    │    │  Handler N    │
│ (subscriber)  │    │ (WS bridge)   │    │ (future)      │
└───────────────┘    └───────────────┘    └───────────────┘
```

Each handler is called sequentially. Errors in one handler don't block others (caught and logged).

## Subscriber (subscriber.ts)

### Status Ingest

**Subscribes to:** `$nexus/status/devices/+`

```
Protocol-Gateway                    Gateway Core
     │                                   │
     │  Publishes status every N seconds │
     │  $nexus/status/devices/{id}       │
     │──────────────────────────────────>│
     │                                   │
     │               Parses JSON payload │
     │               Updates PostgreSQL: │
     │               • device.status     │
     │               • device.lastSeen   │
     │               • device.lastError  │
     │               │                   │
     │               │ If status=online  │
     │               │ AND setupStatus=  │
     │               │ 'created'         │
     │               │ THEN promote to   │
     │               │ 'connected'       │
     │                                   │
```

**Status payload from protocol-gateway:**

```json
{
  "status": "online",
  "last_seen": "2026-03-19T10:30:00.000Z",
  "last_error": null,
  "stats": {
    "total_polls": 15000,
    "success_polls": 14995,
    "failed_polls": 5
  }
}
```

### Config Sync Handler

**Subscribes to:** `$nexus/config/sync/request`

```
Protocol-Gateway starts up
     │
     │  Publishes sync request
     │  $nexus/config/sync/request
     │──────────────────────────────────> Gateway Core
     │                                        │
     │                    Fetches all enabled │
     │                    devices + tags      │
     │                    (limit 1000)        │
     │                                        │
     │  Receives bulk config                  │
     │  $nexus/config/devices/bulk            │
     │<────────────────────────────────────── │
     │                                        │
     │  Applies config to runtime             │
```

## Transform Layer (transform.ts)

The transform module converts database entities (camelCase, nullable, TypeScript conventions) to protocol-gateway format (snake_case, with defaults, Go conventions).

### Protocol Mapping

| DB Value     | PG Value     |
| ------------ | ------------ |
| `modbus`     | `modbus_tcp` |
| `opcua`      | `opcua`      |
| `s7`         | `s7`         |
| `mqtt`       | `mqtt`       |
| `bacnet`     | `bacnet`     |
| `ethernetip` | `ethernetip` |

### Connection Extraction

The transform extracts connection parameters from the device's `protocolConfig` JSONB:

```
Device {
  host: "192.168.1.100",
  port: 502,
  protocolConfig: {
    timeout: 10000,
    slaveId: 1,          // Modbus
    rack: 0, slot: 1,    // S7
    securityPolicy: "Basic256Sha256",  // OPC UA
    authMode: "username",
    username: "operator",
    password: "secret",
  }
}

  ──transform──▶

PGDevice.connection: {
  host: "192.168.1.100",
  port: 502,
  timeout: "10s",
  slave_id: 1,
  rack: 0,
  slot: 1,
  security_policy: "Basic256Sha256",
  auth_mode: "username",
  username: "operator",
  password: "secret",
}
```

### Tag Field Defaults

| Field            | Default (if null)                  |
| ---------------- | ---------------------------------- |
| `scale_factor`   | 1                                  |
| `offset`         | 0                                  |
| `deadband_type`  | `'none'`                           |
| `deadband_value` | 0                                  |
| `access_mode`    | `'read'`                           |
| `byte_order`     | `'big_endian'`                     |
| `topic_suffix`   | tag.name                           |
| `opc_node_id`    | address (if it matches OPC format) |

---

_Previous: [Chapter 6 — Middleware Architecture](middleware_architecture.md) | Next: [Chapter 8 — Proxy Architecture](proxy_architecture.md)_
