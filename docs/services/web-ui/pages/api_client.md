# Chapter 7 — API Client

> Typed REST client in `lib/api.ts` — all endpoints, request/response types,
> error handling, and authentication header injection.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           API CLIENT (lib/api.ts)                               │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       TYPE DEFINITIONS                                  │    │
│  │                                                                         │    │
│  │  Protocol: modbus | opcua | s7 | mqtt | bacnet | ethernetip             │    │
│  │  DeviceStatus: online | offline | error | unknown                       │    │
│  │  SetupStatus: created | connected | configured | active                 │    │
│  │  TagDataType: bool | int16 | uint16 | int32 | uint32 | int64 |          │    │
│  │               uint64 | float32 | float64 | string                       │    │
│  │  AccessMode: read | write | readwrite                                   │    │
│  │  RegisterType: holding | input | coil | discrete                        │    │
│  │  ByteOrder: big-endian | little-endian | big-endian-word-swap |         │    │
│  │             little-endian-word-swap                                     │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       API NAMESPACES                                    │    │
│  │                                                                         │    │
│  │  devicesApi ──> /api/devices/*     (CRUD + toggle + test + browse)      │    │
│  │  tagsApi    ──> /api/tags/*        (CRUD + bulk + toggle)               │    │
│  │  healthApi  ──> /health/*          (ready, live — no /api prefix)       │    │
│  │  systemApi  ──> /api/system/*      (health, info)                       │    │
│  │  historianApi ──> /api/historian/*  (history query)                     │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       FETCH WRAPPER                                     │    │
│  │                                                                         │    │
│  │  apiFetch(url, options)                                                 │    │
│  │    ├── Prepend base URL (/api prefix for most routes)                   │    │
│  │    ├── Add Content-Type: application/json                               │    │
│  │    ├── Add Authorization: Bearer {token} (if auth enabled)              │    │
│  │    ├── Execute fetch()                                                  │    │
│  │    ├── Handle 401 → refresh → retry                                     │    │
│  │    └── Parse JSON response or throw ApiError                            │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Endpoint Reference

### Devices API

| Method   | Path                      | Description                 | Request Body        | Response       |
| -------- | ------------------------- | --------------------------- | ------------------- | -------------- |
| `GET`    | `/api/devices`            | List devices (with filters) | —                   | `Device[]`     |
| `POST`   | `/api/devices`            | Create device               | `CreateDeviceInput` | `Device`       |
| `GET`    | `/api/devices/:id`        | Get device by ID            | —                   | `Device`       |
| `PUT`    | `/api/devices/:id`        | Update device               | `UpdateDeviceInput` | `Device`       |
| `DELETE` | `/api/devices/:id`        | Delete device               | —                   | `void`         |
| `POST`   | `/api/devices/:id/toggle` | Toggle enabled state        | —                   | `Device`       |
| `POST`   | `/api/devices/:id/test`   | Test connection             | —                   | `TestResult`   |
| `POST`   | `/api/devices/:id/browse` | Browse address space        | `{ nodeId }`        | `BrowseNode[]` |

**Query parameters for list:**

| Param      | Type         | Description                    |
| ---------- | ------------ | ------------------------------ |
| `search`   | string       | Filter by name (partial match) |
| `protocol` | Protocol     | Filter by protocol type        |
| `status`   | DeviceStatus | Filter by connection status    |

### Tags API

| Method   | Path                   | Description                           | Request Body       | Response                          |
| -------- | ---------------------- | ------------------------------------- | ------------------ | --------------------------------- |
| `GET`    | `/api/tags`            | List tags (with filters + pagination) | —                  | `{ items: Tag[], total: number }` |
| `POST`   | `/api/tags`            | Create tag                            | `CreateTagInput`   | `Tag`                             |
| `POST`   | `/api/tags/bulk`       | Bulk create tags                      | `CreateTagInput[]` | `{ created: number }`             |
| `GET`    | `/api/tags/:id`        | Get tag by ID                         | —                  | `Tag`                             |
| `PUT`    | `/api/tags/:id`        | Update tag                            | `UpdateTagInput`   | `Tag`                             |
| `DELETE` | `/api/tags/:id`        | Delete tag                            | —                  | `void`                            |
| `POST`   | `/api/tags/:id/toggle` | Toggle enabled state                  | —                  | `Tag`                             |

**Query parameters for list:**

| Param        | Type        | Description                    |
| ------------ | ----------- | ------------------------------ |
| `search`     | string      | Filter by name (partial match) |
| `deviceId`   | string      | Filter by parent device        |
| `dataType`   | TagDataType | Filter by data type            |
| `accessMode` | AccessMode  | Filter by access mode          |
| `limit`      | number      | Page size (default: 25)        |
| `offset`     | number      | Page offset                    |

### Health API

| Method | Path            | Description        | Response             |
| ------ | --------------- | ------------------ | -------------------- |
| `GET`  | `/health`       | Full health status | `HealthResponse`     |
| `GET`  | `/health/ready` | Readiness probe    | `{ status, checks }` |

**Note:** Health endpoints do NOT have the `/api` prefix — they are served
directly by Gateway Core and proxied at the root level.

### System API

| Method | Path                 | Description        | Response                        |
| ------ | -------------------- | ------------------ | ------------------------------- |
| `GET`  | `/api/system/health` | All service health | `{ services: ServiceHealth[] }` |
| `GET`  | `/api/system/info`   | System information | `{ version, uptime, ... }`      |

### Historian API

| Method | Path                     | Description           | Response                |
| ------ | ------------------------ | --------------------- | ----------------------- |
| `GET`  | `/api/historian/history` | Query historical data | `{ data: DataPoint[] }` |

---

## Type Definitions

### Device

```typescript
interface Device {
  id: string;
  name: string;
  description?: string;
  protocol: Protocol;
  host: string;
  port: number;
  pollInterval: number;
  timeout?: number;
  retries?: number;
  enabled: boolean;
  status: DeviceStatus; // online | offline | error | unknown
  setupStatus: SetupStatus; // created | connected | configured | active
  protocolConfig: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  lastError?: string;
  lastSeen?: string; // ISO 8601 timestamp
  createdAt: string;
  updatedAt: string;
}
```

### Tag

```typescript
interface Tag {
  id: string;
  deviceId: string;
  name: string;
  address: string;
  dataType: TagDataType;
  accessMode: AccessMode;
  unit?: string;
  description?: string;
  enabled: boolean;
  pollInterval?: number;
  // Modbus-specific
  registerType?: RegisterType;
  byteOrder?: ByteOrder;
  // Scaling
  scalingEnabled?: boolean;
  rawMin?: number;
  rawMax?: number;
  engMin?: number;
  engMax?: number;
  // Clamping
  clampEnabled?: boolean;
  clampMin?: number;
  clampMax?: number;
  // Deadband
  deadbandEnabled?: boolean;
  deadbandValue?: number;
  deadbandType?: 'absolute' | 'percent';
  // Metadata
  priority?: number;
  topicSuffix?: string;
  createdAt: string;
  updatedAt: string;
}
```

### Protocol-Specific Configs

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Protocol     │ Config Interface Fields                                    │
│──────────────┼────────────────────────────────────────────────────────────│
│ modbus       │ slaveId: number                                           │
│              │ timeout: number (ms)                                       │
│              │ retries: number                                            │
│──────────────┼────────────────────────────────────────────────────────────│
│ opcua        │ securityPolicy: "None" | "Basic256" | "Basic256Sha256"    │
│              │ securityMode: "None" | "Sign" | "SignAndEncrypt"          │
│              │ authentication: "anonymous" | "username" | "certificate"  │
│              │ username?: string                                          │
│              │ password?: string                                          │
│              │ publishInterval: number (ms)                               │
│              │ queueSize: number                                          │
│──────────────┼────────────────────────────────────────────────────────────│
│ s7           │ rack: number (0-7)                                        │
│              │ slot: number (0-31)                                        │
│              │ pduSize: number (bytes, default 960)                       │
│──────────────┼────────────────────────────────────────────────────────────│
│ mqtt         │ brokerUrl: string                                          │
│              │ clientId: string                                           │
│              │ username?: string                                          │
│              │ password?: string                                          │
│              │ qos: 0 | 1 | 2                                            │
│──────────────┼────────────────────────────────────────────────────────────│
│ bacnet       │ deviceInstance: number                                     │
│──────────────┼────────────────────────────────────────────────────────────│
│ ethernetip   │ slot: number                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Error Handling

### ApiError Class

```typescript
class ApiError extends Error {
  statusCode: number;
  code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}
```

### Error Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       ERROR HANDLING FLOW                                       │
│                                                                                 │
│  fetch() response                                                               │
│       │                                                                         │
│       ├── 200-299 (OK)                                                          │
│       │   └── Parse JSON, return data                                           │
│       │                                                                         │
│       ├── 401 (Unauthorized)                                                    │
│       │   ├── Attempt token refresh                                             │
│       │   ├── Success → retry original request                                  │
│       │   └── Failure → redirect to /login (with 30s loop guard)               │
│       │                                                                         │
│       ├── 404 (Not Found)                                                       │
│       │   └── throw ApiError(404, "Resource not found")                         │
│       │                                                                         │
│       ├── 422 (Validation Error)                                                │
│       │   └── throw ApiError(422, server.message, server.code)                  │
│       │                                                                         │
│       ├── 500 (Server Error)                                                    │
│       │   └── throw ApiError(500, "Internal server error")                      │
│       │                                                                         │
│       └── Network Error                                                         │
│           └── throw ApiError(0, "Network error — is Gateway Core running?")     │
│                                                                                 │
│  Consumers (TanStack Query mutations) catch ApiError:                           │
│  onError: (error: ApiError) => toast({ description: error.message })            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Base URL Resolution

```typescript
// Development: Vite proxy handles /api/* → localhost:3001
// Production: Nginx proxy handles /api/* → gateway-core:3001
//
// The API client uses relative URLs, so no base URL configuration needed:
//   fetch('/api/devices')      → proxied to gateway-core
//   fetch('/health/ready')     → proxied to gateway-core (no /api prefix)
```

| Environment  | API Call            | Proxied To                              |
| ------------ | ------------------- | --------------------------------------- |
| Dev (Vite)   | `GET /api/devices`  | `http://localhost:3001/api/devices`     |
| Dev (Vite)   | `GET /health/ready` | `http://localhost:3001/health/ready`    |
| Prod (Nginx) | `GET /api/devices`  | `http://gateway-core:3001/api/devices`  |
| Prod (Nginx) | `GET /health/ready` | `http://gateway-core:3001/health/ready` |

---

## Related Documentation

- [State Management](state_management.md) — how TanStack Query consumes these API functions
- [Auth Architecture](auth_architecture.md) — Bearer token injection details
- [Configuration Reference](configuration_reference.md) — VITE_API_URL and proxy config
- [Component Architecture](component_architecture.md) — which components call which endpoints

---

_Document Version: 1.0_
_Last Updated: March 2026_
