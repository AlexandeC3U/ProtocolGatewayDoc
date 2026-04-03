# Chapter 5 — Domain Model

> Device, Tag, and AuditLog entities, enums, validation schemas, and transform mappings.

---

## Entity Relationship Diagram

```
┌──────────────────────────────────┐
│            DEVICES               │
├──────────────────────────────────┤
│  id             UUID (PK)        │
│  name           VARCHAR UNIQUE   │
│  protocol       ENUM             │
│  host           VARCHAR          │
│  port           INTEGER          │
│  enabled        BOOLEAN          │
│  status         ENUM             │
│  setupStatus    ENUM             │
│  configVersion  INTEGER          │
│  pollIntervalMs INTEGER          │
│  unsPrefix      VARCHAR          │
│  protocolConfig JSONB            │
│  ...                             │
├──────────────────────────────────┤
│  1 ─────────────────────────── * │
└──────────────────┬───────────────┘
                   │ ON DELETE CASCADE
                   │
┌──────────────────▼───────────────┐        ┌──────────────────────────────┐
│              TAGS                │        │          AUDIT_LOG           │
├──────────────────────────────────┤        ├──────────────────────────────┤
│  id             UUID (PK)        │        │  id          UUID (PK)       │
│  deviceId       UUID (FK)        │        │  userSub     VARCHAR         │
│  name           VARCHAR          │        │  username    VARCHAR         │
│  address        VARCHAR          │        │  action      VARCHAR         │
│  dataType       ENUM             │        │  resourceType VARCHAR        │
│  enabled        BOOLEAN          │        │  resourceId  UUID            │
│  scaleFactor    DOUBLE           │        │  details     JSONB           │
│  scaleOffset    DOUBLE           │        │  ipAddress   VARCHAR         │
│  clampMin       DOUBLE           │        │  createdAt   TIMESTAMPTZ     │
│  clampMax       DOUBLE           │        └──────────────────────────────┘
│  engineeringUnits VARCHAR        │
│  deadbandType   VARCHAR          │
│  deadbandValue  DOUBLE           │
│  accessMode     VARCHAR          │
│  priority       SMALLINT         │
│  byteOrder      VARCHAR          │
│  registerType   VARCHAR          │
│  registerCount  SMALLINT         │
│  opcNodeId      VARCHAR          │
│  opcNamespaceUri VARCHAR         │
│  s7Address      VARCHAR          │
│  topicSuffix    VARCHAR          │
│  metadata       JSONB            │
│  ...                             │
├──────────────────────────────────┤
│  UNIQUE(deviceId, name)          │
└──────────────────────────────────┘
```

## Enums

### Protocol

```
modbus | opcua | s7 | mqtt | bacnet | ethernetip
```

Stored as PostgreSQL enum `protocol`. Note: the transform layer maps `modbus` → `modbus_tcp` when sending to protocol-gateway.

### Device Status

```
online | offline | error | unknown | connecting
```

Set by protocol-gateway via MQTT status messages. `unknown` is the default on device creation.

### Setup Status

```
created | connected | configured | active
```

Tracks the two-phase device setup flow. See [Chapter 3](architectural_principles.md) for the state machine.

### Tag Data Type

```
bool | int16 | int32 | int64 | uint16 | uint32 | uint64 | float32 | float64 | string
```

## Validation Schemas (Zod)

### Create Device

```typescript
{
  name: string (1-255 chars),
  description?: string,
  protocol: 'modbus' | 'opcua' | 's7' | 'mqtt' | 'bacnet' | 'ethernetip',
  host: string (1-255 chars),
  port: number (1-65535),
  pollIntervalMs?: number (default 1000),
  unsPrefix?: string (max 512 chars),
  protocolConfig?: object (default {}),
  location?: string (max 255 chars),
  metadata?: object (default {}),
}
```

### Create Tag

```typescript
{
  deviceId: UUID,
  name: string (1-255 chars),
  description?: string,
  address: string (1-512 chars),
  dataType: 'bool' | 'int16' | ... | 'string',
  scaleFactor?: number,
  scaleOffset?: number,
  clampMin?: number,
  clampMax?: number,
  engineeringUnits?: string (max 50 chars),
  deadbandType?: 'none' | 'absolute' | 'percent',
  deadbandValue?: number,
  accessMode?: 'read' | 'write' | 'readwrite',
  priority?: number (0-100, default 0),
  byteOrder?: 'big_endian' | 'little_endian',
  registerType?: 'holding' | 'input' | 'coil' | 'discrete',
  registerCount?: number (1-125),
  opcNodeId?: string,
  opcNamespaceUri?: string,
  s7Address?: string,
  topicSuffix?: string,
  metadata?: object,
}
```

### Bulk Create Tags

```typescript
{
  deviceId: UUID,
  tags: CreateTag[] (max 1000)
}
```

## Query Parameters

### List Devices

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | 1–100 |
| `offset` | number | 0 | Pagination offset |
| `protocol` | string | - | Filter by protocol enum |
| `status` | string | - | Filter by device status |
| `setupStatus` | string | - | Filter by setup status |
| `enabled` | boolean | - | Filter by enabled flag |
| `search` | string | - | Case-insensitive search on name, description, location |

### List Tags

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 100 | 1–500 |
| `offset` | number | 0 | Pagination offset |
| `deviceId` | UUID | - | Filter by parent device |
| `dataType` | string | - | Filter by data type enum |
| `enabled` | boolean | - | Filter by enabled flag |
| `search` | string | - | Case-insensitive search on name, description, address |

## Transform: DB → Protocol-Gateway Format

The transform layer (`mqtt/transform.ts`) maps database entities to the format expected by protocol-gateway. Key conversions:

| DB Field | PG Field | Transformation |
|----------|----------|----------------|
| `protocol: 'modbus'` | `protocol: 'modbus_tcp'` | Enum mapping |
| `pollIntervalMs: 1000` | `poll_interval: '1000ms'` | Number → duration string |
| `protocolConfig.timeout: 10000` | `connection.timeout: '10s'` | Extract + format |
| `scaleFactor: null` | `scale_factor: 1` | Null → default |
| `scaleOffset: null` | `offset: 0` | Null → default |
| `topicSuffix: null` | `topic_suffix: tag.name` | Null → fallback to name |
| `opcNodeId: null` | `opc_node_id: address` | Fallback if address looks like OPC format |
| `camelCase` fields | `snake_case` fields | Naming convention |

## configVersion

Each device has an auto-incrementing `configVersion` (starts at 1). It increments when:
- Device is updated (`PUT /api/devices/:id`)
- A tag is created, updated, or deleted for the device
- Bulk tags are created

Protocol-gateway uses this field to detect stale configurations and request a fresh sync if its local version is behind.

## Indexes

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `devices_name_idx` | name | UNIQUE | Prevent duplicate device names |
| `devices_protocol_idx` | protocol | B-tree | Filter by protocol |
| `devices_status_idx` | status | B-tree | Filter by status |
| `tags_device_tag_idx` | (device_id, name) | UNIQUE | Prevent duplicate tag names per device |
| `tags_device_idx` | device_id | B-tree | Fast lookup by parent device |
| `audit_log_user_idx` | user_sub | B-tree | Query audit by user |
| `audit_log_resource_idx` | (resource_type, resource_id) | B-tree | Query audit by resource |
| `audit_log_created_idx` | created_at DESC | B-tree | Recent audit entries first |

---

*Previous: [Chapter 4 — Layer Architecture](layer_architecture.md) | Next: [Chapter 6 — Middleware Architecture](middleware_architecture.md)*
