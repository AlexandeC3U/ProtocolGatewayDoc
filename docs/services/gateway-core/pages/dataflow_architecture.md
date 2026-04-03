# Chapter 10 — Data Flow Architecture

> End-to-end data flows: device CRUD, two-phase setup, config sync, status ingest, and live data.

---

## Overview

Gateway Core participates in five major data flows:

| Flow                   | Direction                  | Transport        | Trigger                  |
| ---------------------- | -------------------------- | ---------------- | ------------------------ |
| Device/Tag CRUD        | UI → GC → DB + MQTT        | HTTP + MQTT      | User action              |
| Two-Phase Device Setup | UI → GC → PG → MQTT → GC   | HTTP + MQTT      | User-driven sequence     |
| Config Sync            | PG → MQTT → GC → MQTT → PG | MQTT             | Protocol-gateway startup |
| Status Ingest          | PG → MQTT → GC → DB        | MQTT             | Periodic (from PG)       |
| Live Data              | PG → MQTT → GC → WS → UI   | MQTT + WebSocket | Continuous               |

**Legend:** GC = Gateway Core, PG = Protocol-Gateway, DB = PostgreSQL

## Flow 1: Device CRUD

### Create Device

```
Web UI                    Gateway Core                       PostgreSQL     MQTT/PG
  │                            │                                │              │
  │  POST /api/devices         │                                │              │
  │  {name, protocol,          │                                │              │
  │   host, port, ...}         │                                │              │
  │───────────────────────────>│                                │              │
  │                            │                                │              │
  │                  Zod validate (createDeviceSchema)          │              │
  │                  Check RBAC (engineer+)                     │              │
  │                            │                                │              │
  │                            │  INSERT INTO devices           │              │
  │                            │  RETURNING *                   │              │
  │                            │───────────────────────────────>│              │
  │                            │                                │              │
  │                            │  device row                    │              │
  │                            │<───────────────────────────────│              │
  │                            │                                │              │
  │  201 {device}              │  (async, best-effort)          │              │
  │<───────────────────────────│                                │              │
  │                            │  PUBLISH $nexus/config/        │              │
  │                            │  devices/{id}                  │              │
  │                            │  {action:"create", data:{...}} │              │
  │                            │──────────────────────────────────────────────>│
  │                            │                                │              │
```

**Key behaviors:**

- The HTTP response returns _before_ the MQTT notification is sent (best-effort)
- MQTT publish failures are caught and logged, never propagated to the client
- `setupStatus` defaults to `'created'` — the device enters the two-phase flow
- `configVersion` starts at 1

### Update Device

Same pattern as create, with two additions:

- `configVersion` is atomically incremented: `SET config_version = config_version + 1`
- MQTT notification includes the device's current tags (fetched in a follow-up query)

### Delete Device

```
  │  DELETE /api/devices/:id   │                                │              │
  │───────────────────────────>│                                │              │
  │                            │  SELECT (verify exists)        │              │
  │                            │  DELETE FROM devices           │              │
  │                            │  (CASCADE deletes tags)        │              │
  │                            │───────────────────────────────>│              │
  │                            │                                │              │
  │  204 No Content            │  PUBLISH {action:"delete"}     │              │
  │<───────────────────────────│──────────────────────────────────────────────>│
```

### Tag CRUD

Tags follow the same pattern with additional side effects:

| Operation   | Side Effect                                                                     |
| ----------- | ------------------------------------------------------------------------------- |
| Create tag  | `configVersion++` on parent device. If first tag → `setupStatus = 'configured'` |
| Bulk create | `configVersion++` once. If first batch → `setupStatus = 'configured'`           |
| Update tag  | `configVersion++` on parent device                                              |
| Delete tag  | `configVersion++` on parent device                                              |

MQTT notifications for tags go to `$nexus/config/tags/{deviceId}/{tagId}`.

## Flow 2: Two-Phase Device Setup

The setup flow guides users from device creation to live data collection:

```
Phase 1: Device Setup                    Phase 2: Tag Configuration
┌─────────────────────────┐              ┌─────────────────────────┐
│                         │              │                         │
│  1. Create device       │              │  4. Browse address      │
│     POST /api/devices   │              │     space (OPC UA tree, │
│     → setupStatus:      │              │     Modbus registers)   │
│       'created'         │              │                         │
│                         │              │  5. Select & create tags│
│  2. Test connection     │              │     POST /api/tags/bulk │
│     POST /devices/:id/  │              │     → setupStatus:      │
│     test                │              │       'configured'      │
│     → setupStatus:      │              │                         │
│       'connected'       │              │  6. Status goes online  │
│                         │              │     (via MQTT status)   │
│  3. Validate response   │              │     → setupStatus:      │
│     from PG confirms    │              │       'active'          │
│     connectivity        │              │                         │
└─────────────────────────┘              └─────────────────────────┘
```

### Test Connection (Phase 1 → Phase 2 transition)

```
Web UI                    Gateway Core                    Protocol-Gateway
  │                            │                                │
  │  POST /devices/:id/test    │                                │
  │───────────────────────────>│                                │
  │                            │                                │
  │              Load device + tags from DB                     │
  │              Transform to PG format                         │
  │              (deviceToProtocolGateway)                      │
  │                            │                                │
  │                            │  POST /api/test-connection     │
  │                            │  {PGDevice format}             │
  │                            │───────────────────────────────>│
  │                            │                                │
  │                            │  {success: true, latency: 12}  │
  │                            │<───────────────────────────────│
  │                            │                                │
  │              If setupStatus='created'                       │
  │              → UPDATE setupStatus='connected'               │
  │                            │                                │
  │  200 {success, latency}    │                                │
  │<───────────────────────────│                                │
```

### Browse Address Space (Phase 2)

```
Web UI                    Gateway Core                    Protocol-Gateway
  │                            │                                │
  │  POST /devices/:id/browse  │                                │
  │  {node_id?, max_depth?}    │                                │
  │───────────────────────────>│                                │
  │                            │                                │
  │              Verify device exists                           │
  │                            │                                │
  │                            │  GET /api/browse/:id           │
  │                            │  ?node_id=...&max_depth=...    │
  │                            │───────────────────────────────>│
  │                            │                                │
  │                            │  [{name, address, dataType}]   │
  │                            │<───────────────────────────────│
  │                            │                                │
  │  200 [{browsed nodes}]     │                                │
  │<───────────────────────────│                                │
```

### Setup Status State Machine

```
                 create device
                      │
                      ▼
               ┌──────────┐
               │ created  │
               └─────┬────┘
                     │ test connection succeeds
                     ▼
               ┌──────────┐
               │ connected│
               └─────┬────┘
                     │ first tag(s) added
                     ▼
               ┌──────────┐
               │configured│
               └─────┬────┘
                     │ MQTT status = online
                     │ (from protocol-gateway)
                     ▼
               ┌──────────┐
               │  active  │
               └──────────┘
```

Transitions are one-directional — there is no backward movement. If a device goes offline, `status` changes but `setupStatus` stays at `active`.

## Flow 3: Config Sync (Protocol-Gateway Startup)

When protocol-gateway (re)starts, it has no configuration. It requests a full sync:

```
Protocol-Gateway                     MQTT                        Gateway Core
     │                                │                              │
     │  PUBLISH                       │                              │
     │  $nexus/config/sync/request    │                              │
     │  {"timestamp":"..."}           │                              │
     │───────────────────────────────>│                              │
     │                                │  Deliver to subscriber       │
     │                                │─────────────────────────────>│
     │                                │                              │
     │                                │       Query all enabled      │
     │                                │       devices + tags         │
     │                                │       (limit 1000)           │
     │                                │                              │
     │                                │       Transform each to      │
     │                                │       PG format              │
     │                                │                              │
     │  SUBSCRIBE                     │  PUBLISH                     │
     │  $nexus/config/devices/bulk    │  $nexus/config/devices/bulk  │
     │<───────────────────────────────│<─────────────────────────────│
     │                                │                              │
     │  {action:"sync",               │                              │
     │   data:[PGDevice, ...]}        │                              │
     │                                │                              │
     │  Apply all configs to runtime  │                              │
```

**Bulk sync payload:**

```json
{
  "action": "sync",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "data": [
    {
      "id": "uuid-1",
      "name": "Production PLC",
      "protocol": "modbus_tcp",
      "enabled": true,
      "connection": { "host": "192.168.1.100", "port": 502, "timeout": "10s" },
      "uns_prefix": "acme/plant1/line1",
      "poll_interval": "1000ms",
      "config_version": 3,
      "tags": [
        /* PGTag[] */
      ]
    }
  ]
}
```

## Flow 4: Status Ingest

Protocol-gateway periodically publishes device status. Gateway Core's MQTT subscriber ingests these updates:

```
Protocol-Gateway              MQTT                       Gateway Core
     │                          │                             │
     │  PUBLISH                 │                             │
     │  $nexus/status/          │                             │
     │  devices/{id}            │                             │
     │  {status, last_seen,     │                             │
     │   last_error, stats}     │                             │
     │─────────────────────────>│                             │
     │                          │  Deliver to subscriber      │
     │                          │────────────────────────────>│
     │                          │                             │
     │                          │         Parse JSON          │
     │                          │         Extract deviceId    │
     │                          │         from topic          │
     │                          │                             │
     │                          │         UPDATE devices      │
     │                          │         SET status, lastSeen│
     │                          │         lastError           │
     │                          │                             │
     │                          │         If status=online    │
     │                          │         AND setupStatus=    │
     │                          │         'created'           │
     │                          │         → promote to        │
     │                          │         'connected'         │
     │                          │                             │
```

**Important:** The status subscriber also triggers `setupStatus` promotion. When a freshly created device first reports `online`, it's automatically promoted to `connected` (skipping the manual test-connection step if protocol-gateway picked it up first).

## Flow 5: Live Data (MQTT → WebSocket)

This is the real-time data path from PLC to browser:

```
PLC/Device        Protocol-Gateway       MQTT         Gateway Core        Browser
    │                    │                 │               │                 │
    │  Poll response     │                 │               │                 │
    │───────────────────>│                 │               │                 │
    │                    │                 │               │                 │
    │                    │  PUBLISH        │               │                 │
    │                    │  $nexus/data/   │               │                 │
    │                    │  acme/plant1/   │               │                 │
    │                    │  temperature    │               │                 │
    │                    │  {value: 72.5}  │               │                 │
    │                    │────────────────>│               │                 │
    │                    │                 │  Deliver      │                 │
    │                    │                 │──────────────>│                 │
    │                    │                 │               │                 │
    │                    │                 │               │  WS data msg    │
    │                    │                 │               │  {type:"data",  │
    │                    │                 │               │   topic:"...",  │
    │                    │                 │               │   payload:{...}}│
    │                    │                 │               │────────────────>│
    │                    │                 │               │                 │
    │                    │                 │               │  UI updates     │
    │                    │                 │               │  in real-time   │
```

**Latency profile:** PLC poll (configurable, typically 1s) + MQTT delivery (<5ms local) + WS forward (<1ms) = **near real-time** for the UI.

## Data Consistency Model

| Concern                     | Approach                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| DB is source of truth       | All writes go to PostgreSQL first, then MQTT                                                                      |
| MQTT is best-effort         | Notification failures don't roll back DB writes                                                                   |
| Config version tracking     | `configVersion` detects stale state; PG can request resync                                                        |
| Eventual consistency        | PG may briefly have stale config after a notification failure, but the next change or manual sync will correct it |
| No distributed transactions | Deliberate choice — edge deployments can't afford 2PC overhead                                                    |

---

_Previous: [Chapter 9 — WebSocket Bridge](websocket_bridge.md) | Next: [Chapter 11 — Resilience Patterns](resilience_patterns.md)_
