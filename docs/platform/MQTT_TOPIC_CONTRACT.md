# MQTT Topic Contract — NEXUS Edge

> Complete taxonomy of every MQTT topic in the platform. Who publishes, who subscribes,
> payload schemas, QoS levels, and retention policies. The definitive reference for
> inter-service messaging.

---

## Topic Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         MQTT TOPIC NAMESPACE                                    │
│                                                                                 │
│  SYSTEM TOPICS ($nexus/...)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  $nexus/config/devices/{id}            Gateway Core → Protocol Gateway  │    │
│  │  $nexus/config/devices/bulk            Gateway Core → Protocol Gateway  │    │
│  │  $nexus/config/tags/{did}/{tid}        Gateway Core → Protocol Gateway  │    │
│  │  $nexus/config/sync/request            Protocol Gateway → Gateway Core  │    │
│  │                                                                         │    │
│  │  $nexus/status/devices/{id}            Protocol Gateway → Gateway Core  │    │
│  │                                                                         │    │
│  │  $nexus/cmd/{did}/write                External → Protocol Gateway      │    │
│  │  $nexus/cmd/{did}/{tid}/set            External → Protocol Gateway      │    │
│  │  $nexus/cmd/response/{did}/{tid}       Protocol Gateway → External      │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  DATA TOPICS (user-defined UNS prefix)                                          │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                                                                         │    │
│  │  {unsPrefix}/{topicSuffix}             Protocol Gateway → Data Ingest.  │    │
│  │                                                                         │    │
│  │  Examples:                                                              │    │
│  │    site/building/main/temperature                                       │    │
│  │    factory/line1/plc5/pressure                                          │    │
│  │    plant/area2/conveyor/speed                                           │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Topic Naming Conventions

| Rule                                           | Example                                                      |
| ---------------------------------------------- | ------------------------------------------------------------ |
| System topics use `$nexus/` prefix             | `$nexus/config/devices/abc123`                               |
| `$`-prefixed topics excluded from `#` wildcard | `$share/ingestion/#` won't match `$nexus/*`                  |
| UNS topics follow ISA-95 hierarchy             | `{enterprise}/{site}/{area}/{line}/{device}/{point}`         |
| Lowercase, no spaces, `/` as separator         | `site/building-a/floor1/plc01/temp`                          |
| Device ID is UUID format                       | `$nexus/status/devices/550e8400-e29b-41d4-a716-446655440000` |

---

## Message Flow Diagram

```
┌──────────────┐     $nexus/config/*        ┌──────────────────┐     UNS topics
│              │ ──────────────────────────►│                  │ ──────────────────┐
│ Gateway Core │                            │ Protocol Gateway │                   │
│              │ ◄──────────────────────────│                  │                   │
└──────────────┘     $nexus/status/*        └──────────────────┘                   │
       │                                            ▲                              │
       │ $nexus/config/*                            │                              │
       │ (via MQTT)                                 │ $nexus/cmd/*                 │
       │                                            │                              │
       ▼                                            │                              ▼
┌──────────────┐                            ┌──────────────┐              ┌──────────────┐
│     EMQX     │                            │  External    │              │    Data      │
│    Broker    │                            │  Clients     │              │  Ingestion   │
│    :1883     │                            │  (SCADA/MES) │              │              │
└──────────────┘                            └──────────────┘              └──────────────┘
       │                                                                          │
       │ $nexus/data/*, $nexus/status/*                                           │
       │ (via WebSocket bridge)                                                   │
       ▼                                                                          │
┌──────────────┐                                                         ┌──────────────┐
│   Web UI     │                                                         │ TimescaleDB  │
│  (browser)   │                                                         │  Historian   │
└──────────────┘                                                         └──────────────┘
```

---

## Configuration Topics

### `$nexus/config/devices/{deviceId}`

Device configuration change notification.

| Field          | Value                                       |
| -------------- | ------------------------------------------- |
| **Publisher**  | Gateway Core                                |
| **Subscriber** | Protocol Gateway                            |
| **QoS**        | 1 (at-least-once)                           |
| **Retained**   | No                                          |
| **Trigger**    | Device created, updated, or deleted via API |

**Payload Schema:**

```json
{
  "action": "create | update | delete",
  "timestamp": "2026-03-23T10:30:45.000Z",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Temperature Sensor",
    "description": "Main building temp",
    "protocol": "modbus",
    "enabled": true,
    "connection": {
      "host": "192.168.1.100",
      "port": 502,
      "timeout": "10s",
      "retry_count": 3,
      "retry_delay": "1000ms"
    },
    "uns_prefix": "site/building/main",
    "poll_interval": "5000ms",
    "tags": [
      {
        "id": "tag-uuid",
        "name": "Temperature",
        "address": "40001",
        "data_type": "float32",
        "enabled": true,
        "scale_factor": 1.0,
        "offset": 0.0,
        "unit": "°C",
        "deadband_type": "absolute",
        "deadband_value": 0.5,
        "access_mode": "read",
        "priority": 0,
        "byte_order": "big_endian",
        "register_type": "input_register",
        "topic_suffix": "temperature"
      }
    ],
    "config_version": 1
  }
}
```

**Transform Layer:** Gateway Core's `src/mqtt/transform.ts` converts the Drizzle DB schema
(camelCase) to protocol-gateway's expected format (snake_case). Key mappings:

| DB Field (camelCase)    | PG Field (snake_case)     | Notes                                        |
| ----------------------- | ------------------------- | -------------------------------------------- |
| `pollInterval`          | `poll_interval`           | Converted to Go duration string (`"5000ms"`) |
| `scaleFactor`           | `scale_factor`            | Float                                        |
| `scaleOffset`           | `offset`                  | Renamed                                      |
| `clampMin` / `clampMax` | `clamp_min` / `clamp_max` | Optional bounds                              |
| `byteOrder`             | `byte_order`              | `big_endian`, `little_endian`, etc.          |
| `registerType`          | `register_type`           | `holding_register`, `input_register`, etc.   |
| `opcNodeId`             | `opc_node_id`             | OPC UA specific                              |
| `s7Address`             | `s7_address`              | S7 specific                                  |

---

### `$nexus/config/devices/bulk`

Full device synchronization — all devices and their tags.

| Field          | Value                                          |
| -------------- | ---------------------------------------------- |
| **Publisher**  | Gateway Core                                   |
| **Subscriber** | Protocol Gateway                               |
| **QoS**        | 1                                              |
| **Retained**   | No                                             |
| **Trigger**    | Protocol Gateway sends sync request on startup |

**Payload Schema:**

```json
{
  "action": "bulk",
  "timestamp": "2026-03-23T10:30:45.000Z",
  "data": [
    { "...device1 with tags..." },
    { "...device2 with tags..." }
  ]
}
```

**Sync Flow:**

```
Protocol Gateway starts
    │
    │  (2 second delay — wait for retained messages)
    │
    ├──► Publish: $nexus/config/sync/request
    │
    │  Gateway Core receives sync request
    │
    ├──◄ Publish: $nexus/config/devices/bulk (all devices + tags)
    │
    Protocol Gateway reconciles:
    ├── New devices → start polling
    ├── Changed devices → update config, restart polling
    └── Removed devices → stop polling, close connections
```

---

### `$nexus/config/tags/{deviceId}/{tagId}`

Individual tag configuration change notification.

| Field          | Value                                             |
| -------------- | ------------------------------------------------- |
| **Publisher**  | Gateway Core                                      |
| **Subscriber** | Protocol Gateway                                  |
| **QoS**        | 1                                                 |
| **Retained**   | No                                                |
| **Trigger**    | Tag created, updated, deleted, or toggled via API |

**Payload Schema:**

```json
{
  "action": "create | update | delete",
  "timestamp": "2026-03-23T10:30:45.000Z",
  "data": {
    "id": "tag-uuid",
    "name": "Temperature",
    "description": "Room temperature",
    "address": "40001",
    "data_type": "float32",
    "enabled": true,
    "scale_factor": 1.0,
    "offset": 0.0,
    "unit": "°C",
    "deadband_type": "absolute",
    "deadband_value": 0.5,
    "access_mode": "read",
    "priority": 0,
    "byte_order": "big_endian",
    "register_type": "input_register",
    "opc_node_id": "",
    "opc_namespace_uri": "",
    "s7_address": "",
    "topic_suffix": "temperature"
  }
}
```

---

### `$nexus/config/sync/request`

Protocol Gateway requests full configuration sync from Gateway Core.

| Field          | Value                                       |
| -------------- | ------------------------------------------- |
| **Publisher**  | Protocol Gateway                            |
| **Subscriber** | Gateway Core                                |
| **QoS**        | 1                                           |
| **Retained**   | No                                          |
| **Trigger**    | Protocol Gateway startup, MQTT reconnection |

**Payload Schema:**

```json
{
  "source": "protocol-gateway",
  "timestamp": "2026-03-23T10:30:45.000Z"
}
```

---

## Status Topics

### `$nexus/status/devices/{deviceId}`

Device connectivity and polling status. **This is the only retained topic** — ensures
late-connecting subscribers (like gateway-core after restart) see the latest status.

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| **Publisher**  | Protocol Gateway                       |
| **Subscriber** | Gateway Core (MQTT subscriber)         |
| **QoS**        | 1                                      |
| **Retained**   | **Yes**                                |
| **Frequency**  | On status change + 60-second heartbeat |

**Payload Schema:**

```json
{
  "status": "online | offline | error | unknown | connecting",
  "last_seen": "2026-03-23T10:30:45.000Z",
  "last_error": null,
  "stats": {
    "total_polls": 1842,
    "success_polls": 1840,
    "failed_polls": 2
  }
}
```

**Status State Machine:**

```
                    ┌───────────┐
          start ──► │ connecting│
                    └─────┬─────┘
                          │
                  success │      failure
                   ┌──────┴──────┐
                   ▼             ▼
             ┌──────────┐  ┌──────────┐
             │  online  │  │  error   │
             └────┬─────┘  └────┬─────┘
                  │             │
            poll  │             │ retry succeeds
           fails  │             │
                  ▼             │
             ┌──────────┐       │
             │ offline  │───────┘
             └──────────┘
                  │
          disabled│
                  ▼
             ┌──────────┐
             │ unknown  │  (device disabled or removed)
             └──────────┘
```

**Gateway Core Ingest:** The `src/mqtt/subscriber.ts` subscribes to `$nexus/status/devices/+`
and updates the in-memory device status cache, which is exposed via:

- `GET /api/devices/:id/status` (API)
- WebSocket bridge (`$nexus/status/devices/*` topic prefix)

---

## Data Topics

### `{unsPrefix}/{topicSuffix}`

Live data points from polled industrial devices. These topics follow the **Unified Namespace (UNS)**
pattern — the topic hierarchy mirrors the physical plant structure.

| Field          | Value                                    |
| -------------- | ---------------------------------------- |
| **Publisher**  | Protocol Gateway                         |
| **Subscriber** | Data Ingestion (via shared subscription) |
| **QoS**        | 1                                        |
| **Retained**   | No                                       |
| **Frequency**  | Per poll interval (1s–60s typically)     |

**Topic Construction:**

```
Device.unsPrefix + "/" + Tag.topicSuffix
────────────────       ────────────────
(set per device)       (set per tag)

Examples:
  site/building/main  +  temperature    =  site/building/main/temperature
  factory/line1/plc5  +  pressure       =  factory/line1/plc5/pressure
  plant/area2         +  conveyor/speed =  plant/area2/conveyor/speed
```

**Payload Schema (Compact):**

```json
{
  "v": 23.5,
  "q": "good",
  "u": "°C",
  "ts": 1711270245000,
  "source_ts": 1711270244500,
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "tag_id": "tag-uuid"
}
```

| Field       | Type                          | Description                                         |
| ----------- | ----------------------------- | --------------------------------------------------- |
| `v`         | `number \| string \| boolean` | Tag value (after scaling, clamping, deadband)       |
| `q`         | `string`                      | Quality code: `good`, `bad`, `uncertain`, `invalid` |
| `u`         | `string`                      | Engineering unit (from tag config)                  |
| `ts`        | `number`                      | Broker timestamp (Unix ms)                          |
| `source_ts` | `number`                      | PLC/device timestamp (Unix ms, if available)        |
| `device_id` | `string`                      | UUID of source device                               |
| `tag_id`    | `string`                      | UUID of source tag                                  |

**Quality Codes:**

| Code        | OPC UA Mapping           | Meaning                                             |
| ----------- | ------------------------ | --------------------------------------------------- |
| `good`      | `0x00000000` (Good)      | Normal operation, value reliable                    |
| `bad`       | `0x80000000` (Bad)       | Communication failure, stale value                  |
| `uncertain` | `0x40000000` (Uncertain) | Value may be inaccurate (sensor drift, calibration) |
| `invalid`   | —                        | Parse error, type mismatch, out-of-range            |

### Data Ingestion Subscription

Data Ingestion uses **MQTT shared subscriptions** for horizontal scaling:

```
$share/ingestion/#
```

| Aspect             | Detail                                         |
| ------------------ | ---------------------------------------------- |
| **Shared group**   | `ingestion`                                    |
| **Pattern**        | `#` (all non-system topics)                    |
| **Load balancing** | Round-robin across instances                   |
| **Deduplication**  | Each message delivered to exactly one instance |
| **Exclusion**      | `$`-prefixed topics excluded per MQTT 5.0 spec |

**Additional subscription topics (configurable):**

```yaml
# data-ingestion config.yaml
mqtt:
  topics:
    - '$share/ingestion/#' # Catch-all
    - '$share/ingestion/dev/#' # Development prefix
    - '$share/ingestion/uns/#' # UNS prefix
```

**Pipeline:** Message → buffered channel (50K) → batch accumulator → parallel COPY writers (4x) → TimescaleDB

---

## Command Topics

### `$nexus/cmd/{deviceId}/write`

Structured write command to a device. Supports request/response correlation.

| Field          | Value                                            |
| -------------- | ------------------------------------------------ |
| **Publisher**  | External client (Web UI, SCADA, MES, automation) |
| **Subscriber** | Protocol Gateway (command handler)               |
| **QoS**        | 1                                                |
| **Retained**   | No                                               |

**Payload Schema:**

```json
{
  "request_id": "req-789",
  "tag_id": "tag-uuid",
  "value": 25.0,
  "timestamp": "2026-03-23T10:30:45.000Z",
  "priority": 0
}
```

| Field        | Type     | Required | Description                                       |
| ------------ | -------- | -------- | ------------------------------------------------- |
| `request_id` | `string` | No       | Correlation ID for response matching              |
| `tag_id`     | `string` | Yes      | Target tag UUID                                   |
| `value`      | `any`    | Yes      | Value to write (type must match tag data type)    |
| `timestamp`  | `string` | No       | ISO 8601 timestamp                                |
| `priority`   | `number` | No       | Write priority (0 = normal, higher = more urgent) |

---

### `$nexus/cmd/{deviceId}/{tagId}/set`

Simple single-tag write command. No correlation, no metadata — just the raw value.

| Field          | Value                                      |
| -------------- | ------------------------------------------ |
| **Publisher**  | External client (lightweight MQTT clients) |
| **Subscriber** | Protocol Gateway (command handler)         |
| **QoS**        | 1                                          |
| **Retained**   | No                                         |

**Payload:** Raw JSON value — no wrapper object.

```
true              (boolean)
42.5              (number)
"on"              (string)
[1, 2, 3]        (array)
```

**Use case:** Simple integrations where a client publishes directly to a tag path:

```bash
mosquitto_pub -t '$nexus/cmd/device-123/tag-456/set' -m '25.0'
```

---

### `$nexus/cmd/response/{deviceId}/{tagId}`

Write command result. Published by Protocol Gateway after executing a write.

| Field          | Value                                                 |
| -------------- | ----------------------------------------------------- |
| **Publisher**  | Protocol Gateway                                      |
| **Subscriber** | Original requester (by subscribing to response topic) |
| **QoS**        | 1                                                     |
| **Retained**   | No                                                    |

**Payload Schema:**

```json
{
  "request_id": "req-789",
  "device_id": "device-123",
  "tag_id": "tag-456",
  "success": true,
  "error": null,
  "timestamp": "2026-03-23T10:30:46.000Z",
  "duration_ms": 145
}
```

**Request/Response Pattern:**

```
Client                          EMQX                     Protocol Gateway
  │                               │                               │
  ├── Subscribe ─────────────────►│                               │
  │   $nexus/cmd/response/d1/t1   │                               │
  │                               │                               │
  ├── Publish ───────────────────►│── Forward ───────────────────►│
  │   $nexus/cmd/d1/write         │                               │
  │   {request_id: "r1",          │                               │
  │    tag_id: "t1",              │          Execute write        │
  │    value: 25.0}               │          to PLC               │
  │                               │                               │
  │                               │◄── Publish ───────────────────┤
  │◄── Deliver ────────────────── │   $nexus/cmd/response/d1/t1   │
  │   {request_id: "r1",          │   {success: true,             │
  │    success: true,             │    duration_ms: 145}          │
  │    duration_ms: 145}          │                               │
```

---

## WebSocket Bridge Topics

The Gateway Core WebSocket bridge (`/ws`) allows browser clients to subscribe to
MQTT topics over WebSocket. Topic access is restricted to safe prefixes.

### Allowed Topic Prefixes

| Prefix           | Purpose               | Example                                      |
| ---------------- | --------------------- | -------------------------------------------- |
| `$nexus/data/`   | Live tag values       | `$nexus/data/site/building/main/temperature` |
| `$nexus/status/` | Device status changes | `$nexus/status/devices/device-123`           |

### WebSocket Protocol

**Client → Server (subscribe):**

```json
{
  "type": "subscribe",
  "topics": ["$nexus/status/devices/device-123", "$nexus/data/site/building/main/#"]
}
```

**Client → Server (unsubscribe):**

```json
{
  "type": "unsubscribe",
  "topics": ["$nexus/status/devices/device-123"]
}
```

**Server → Client (data):**

```json
{
  "type": "data",
  "topic": "$nexus/status/devices/device-123",
  "payload": { "status": "online", "last_seen": "..." },
  "timestamp": "2026-03-23T10:30:45.000Z"
}
```

**Server → Client (error):**

```json
{
  "type": "error",
  "message": "Topic not allowed: $nexus/config/devices/abc"
}
```

### Limits

| Parameter                    | Default | Env Var                           |
| ---------------------------- | ------- | --------------------------------- |
| Max subscriptions per client | 100     | `WS_MAX_SUBSCRIPTIONS_PER_CLIENT` |
| Max topics per message       | 50      | —                                 |
| Heartbeat interval           | 30s     | —                                 |
| Connection timeout           | 60s     | —                                 |

### Reference-Counted Subscriptions

```
WS Client A subscribes to: $nexus/data/site/#     → MQTT sub count: 1
WS Client B subscribes to: $nexus/data/site/#     → MQTT sub count: 1 (reused)
WS Client A disconnects                           → MQTT sub count: 1 (still needed)
WS Client B disconnects                           → MQTT unsubscribe (count: 0)
```

---

## Summary Table

| Topic Pattern                     | Direction | QoS | Retained | Publisher        | Subscriber       |
| --------------------------------- | --------- | --- | -------- | ---------------- | ---------------- |
| `$nexus/config/devices/{id}`      | GC → PG   | 1   | No       | Gateway Core     | Protocol Gateway |
| `$nexus/config/devices/bulk`      | GC → PG   | 1   | No       | Gateway Core     | Protocol Gateway |
| `$nexus/config/tags/{did}/{tid}`  | GC → PG   | 1   | No       | Gateway Core     | Protocol Gateway |
| `$nexus/config/sync/request`      | PG → GC   | 1   | No       | Protocol Gateway | Gateway Core     |
| `$nexus/status/devices/{id}`      | PG → GC   | 1   | **Yes**  | Protocol Gateway | Gateway Core     |
| `{unsPrefix}/{suffix}`            | PG → DI   | 1   | No       | Protocol Gateway | Data Ingestion   |
| `$nexus/cmd/{did}/write`          | Ext → PG  | 1   | No       | External         | Protocol Gateway |
| `$nexus/cmd/{did}/{tid}/set`      | Ext → PG  | 1   | No       | External         | Protocol Gateway |
| `$nexus/cmd/response/{did}/{tid}` | PG → Ext  | 1   | No       | Protocol Gateway | External         |

**Legend:** GC = Gateway Core, PG = Protocol Gateway, DI = Data Ingestion, Ext = External Client

---

## EMQX Broker Configuration

### Connection Credentials

Each service authenticates to EMQX with dedicated credentials:

| Service          | Username           | Env Var (Password)    |
| ---------------- | ------------------ | --------------------- |
| Gateway Core     | `gateway`          | `MQTT_GATEWAY_PASS`   |
| Protocol Gateway | `protocol-gateway` | `MQTT_PROTOCOL_PASS`  |
| Data Ingestion   | `historian`        | `MQTT_HISTORIAN_PASS` |

### Broker Limits

| Parameter              | Value   | Notes                                   |
| ---------------------- | ------- | --------------------------------------- |
| Max connections        | 100,000 | Per listener                            |
| Max packet size        | 10 MB   | Increase for bulk sync if >1000 devices |
| Max topic levels       | 10      | `a/b/c/d/e/f/g/h/i/j`                   |
| Max QoS allowed        | 2       | QoS 2 rarely used                       |
| Shared subscriptions   | Enabled | Required for data-ingestion scaling     |
| Wildcard subscriptions | Enabled | Required for `#` and `+` patterns       |

### ACL Configuration

**Development (current):** `{allow, all}.` — all clients can publish/subscribe to all topics.

**Production (recommended):**

```erlang
%% Gateway Core — config publisher, status subscriber
{allow, {user, "gateway"}, publish, ["$nexus/config/#"]}.
{allow, {user, "gateway"}, subscribe, ["$nexus/status/#", "$nexus/config/sync/request"]}.

%% Protocol Gateway — data publisher, config subscriber, command handler
{allow, {user, "protocol-gateway"}, publish, ["#", "$nexus/status/#", "$nexus/cmd/response/#"]}.
{allow, {user, "protocol-gateway"}, subscribe, ["$nexus/config/#", "$nexus/cmd/#"]}.

%% Data Ingestion — data subscriber only
{allow, {user, "historian"}, subscribe, ["$share/ingestion/#"]}.

%% Deny everything else
{deny, all}.
```

---

## Design Decisions

### Why `$nexus/` Prefix for System Topics?

Per MQTT specification, topics starting with `$` are **system topics** and are excluded
from wildcard subscriptions (`#`). This means:

- `$share/ingestion/#` catches user data topics but NOT `$nexus/config/*`
- System traffic (config, status, commands) is invisible to generic subscribers
- No accidental interference between data pipeline and control plane

### Why QoS 1 Everywhere (Not QoS 0)?

- **Config changes** must not be lost — a missed config update means a stale device config
- **Data points** must not be lost — TimescaleDB historian requires completeness
- **Status updates** must not be lost — stale status = wrong UI + wrong alerting
- QoS 2 is unnecessary — at-least-once with idempotent consumers is sufficient

### Why Only Device Status Is Retained?

- **Config topics:** Not retained because sync/request mechanism handles catch-up
- **Data topics:** Not retained because historical data lives in TimescaleDB
- **Command topics:** Not retained because stale commands should not auto-execute
- **Status topics:** Retained so late-connecting subscribers see current device state

### Why Compact Payload for Data Topics?

At 1000 tags polling every 5 seconds, that's 200 messages/second. Short keys (`v`, `q`, `ts`)
reduce message size by ~40% vs verbose keys (`value`, `quality`, `timestamp`):

```
Compact: {"v":23.5,"q":"good","u":"°C","ts":1711270245000}     = ~60 bytes
Verbose: {"value":23.5,"quality":"good","unit":"°C","timestamp":1711270245000} = ~80 bytes

At 200 msg/s: saves ~4 KB/s = ~350 MB/day
```

---

## Cross-References

| Topic                            | Detailed In                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Config publish logic             | [Gateway Core — MQTT Architecture](services/gateway-core/pages/mqtt_architecture.md)       |
| Transform layer (DB → PG format) | [Gateway Core — Domain Model](services/gateway-core/pages/domain_model.md)                 |
| Status subscriber                | [Gateway Core — MQTT Architecture](services/gateway-core/pages/mqtt_architecture.md)       |
| Data publishing                  | [Protocol Gateway — Data Flow](services/protocol-gateway/pages/dataflow_architecture.md)   |
| Command handling                 | [Protocol Gateway — Web Architecture](services/protocol-gateway/pages/web_architecture.md) |
| Data ingestion pipeline          | [Data Ingestion — Pipeline](services/data-ingestion/pages/pipeline_architecture.md)        |
| Shared subscriptions             | [Data Ingestion — MQTT Subscriber](services/data-ingestion/pages/mqtt_subscriber.md)       |
| WebSocket bridge                 | [Gateway Core — WebSocket Bridge](services/gateway-core/pages/websocket_bridge.md)         |
| EMQX broker config               | [Infrastructure — EMQX](infrastructure/pages/emqx_configuration.md)                        |

---

_Document Version: 1.0_
_Last Updated: March 2026_
