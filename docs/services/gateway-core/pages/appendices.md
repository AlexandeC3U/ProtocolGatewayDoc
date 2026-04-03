# Chapter 18 — Appendices

> Error code catalog, dependency inventory, and complete API endpoint table.

---

## A. Error Code Catalog

All errors follow the same JSON envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "requestId": "req-abc-123",
    "details": {}
  }
}
```

### Application Errors

| Code | HTTP | Class | When |
|------|------|-------|------|
| `NOT_FOUND` | 404 | `NotFoundError` | Device or tag ID doesn't exist |
| `VALIDATION_ERROR` | 400 | `ValidationError` | Zod schema validation failed |
| `CONFLICT` | 409 | `ConflictError` | Duplicate name (unique constraint violation) |
| `UNAUTHORIZED` | 401 | `UnauthorizedError` | Missing or invalid JWT |
| `FORBIDDEN` | 403 | `ForbiddenError` | Valid JWT but insufficient role |
| `INTERNAL_ERROR` | 500 | `AppError` | Unhandled error (message sanitized in production) |

### Proxy Errors

| Code | HTTP | When |
|------|------|------|
| `CIRCUIT_BREAKER_OPEN` | 503 | Protocol-gateway circuit breaker is open |
| `PROXY_TIMEOUT` | 504 | Request to protocol-gateway timed out (30s default) |
| `PROXY_CONNECTION_REFUSED` | 502 | Protocol-gateway not accepting connections |
| `PROXY_DNS_ERROR` | 502 | Protocol-gateway hostname not resolvable |
| `PROXY_UNREACHABLE` | 502 | Generic connection failure |
| `PROXY_ERROR` | varies | Upstream returned non-2xx (status forwarded) |

### Rate Limit

| Response | When |
|----------|------|
| `429 Too Many Requests` + `Retry-After` header | Rate limit exceeded |

## B. Dependency Inventory

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `fastify` | ^4.28.1 | HTTP framework |
| `@fastify/cors` | ^9.0.1 | CORS middleware |
| `@fastify/helmet` | ^11.1.1 | Security headers |
| `@fastify/rate-limit` | ^9.1.0 | Request throttling |
| `@fastify/swagger` | ^8.14.0 | OpenAPI schema generation |
| `@fastify/swagger-ui` | ^3.0.0 | Swagger UI hosting |
| `@fastify/websocket` | ^10.0.1 | WebSocket support (ws under the hood) |
| `drizzle-orm` | ^0.30.10 | Type-safe SQL ORM |
| `pg` | ^8.11.5 | PostgreSQL client (node-postgres) |
| `jose` | ^6.2.1 | JWT verification and JWKS |
| `mqtt` | ^5.5.0 | MQTT 5.0 client |
| `pino` | ^9.1.0 | Structured logging |
| `prom-client` | ^15.1.3 | Prometheus metrics |
| `zod` | ^3.23.8 | Schema validation |
| `dotenv` | ^16.4.5 | Environment variable loading |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | ^5.4.5 | Type system |
| `tsup` | ^8.0.2 | Build/bundler (ESM output) |
| `tsx` | ^4.10.5 | TypeScript execution (dev mode hot-reload) |
| `vitest` | ^1.6.0 | Test runner |
| `eslint` | ^8.57.0 | Linter |
| `@typescript-eslint/*` | ^7.9.0 | TypeScript ESLint plugin + parser |
| `drizzle-kit` | ^0.21.4 | Migration generation and DB tools |
| `pino-pretty` | ^11.0.0 | Development log formatting |
| `@types/node` | ^20.12.12 | Node.js type definitions |
| `@types/pg` | ^8.11.6 | node-postgres types |
| `@types/ws` | ^8.18.1 | WebSocket types |

## C. Complete API Endpoint Table

### Device Endpoints (`/api/devices`)

| Method | Path | Auth | Min Role | Description |
|--------|------|:----:|----------|-------------|
| `GET` | `/api/devices` | Y | viewer | List devices (paginated, filterable) |
| `GET` | `/api/devices/:id` | Y | viewer | Get device by ID (optional `?includeTags=true`) |
| `POST` | `/api/devices` | Y | engineer | Create device |
| `PUT` | `/api/devices/:id` | Y | engineer | Update device |
| `DELETE` | `/api/devices/:id` | Y | engineer | Delete device (cascades tags) |
| `POST` | `/api/devices/:id/toggle` | Y | operator | Toggle enabled state |
| `POST` | `/api/devices/:id/test` | Y | operator | Test connection (proxy to PG) |
| `POST` | `/api/devices/:id/browse` | Y | operator | Browse address space (proxy to PG) |
| `GET` | `/api/devices/:id/status` | Y | viewer | Get runtime status (proxy to PG) |

### Tag Endpoints (`/api/tags`)

| Method | Path | Auth | Min Role | Description |
|--------|------|:----:|----------|-------------|
| `GET` | `/api/tags` | Y | viewer | List tags (paginated, filterable) |
| `GET` | `/api/tags/:id` | Y | viewer | Get tag by ID |
| `POST` | `/api/tags` | Y | engineer | Create tag |
| `POST` | `/api/tags/bulk` | Y | engineer | Bulk create tags (max 1000) |
| `PUT` | `/api/tags/:id` | Y | engineer | Update tag |
| `DELETE` | `/api/tags/:id` | Y | engineer | Delete tag |
| `POST` | `/api/tags/:id/toggle` | Y | engineer | Toggle enabled state |

### OPC UA Endpoints (`/api/opcua`)

| Method | Path | Auth | Min Role | Description |
|--------|------|:----:|----------|-------------|
| `GET` | `/api/opcua/certificates/trusted` | Y | engineer | List trusted certs (proxy) |
| `GET` | `/api/opcua/certificates/rejected` | Y | engineer | List rejected certs (proxy) |
| `POST` | `/api/opcua/certificates/trust` | Y | engineer | Trust a certificate (proxy) |
| `DELETE` | `/api/opcua/certificates/trusted/:fp` | Y | engineer | Remove trusted cert (proxy) |

### System Endpoints (`/api/system`)

| Method | Path | Auth | Min Role | Description |
|--------|------|:----:|----------|-------------|
| `GET` | `/api/system/health` | Y | viewer | Aggregated platform health |
| `GET` | `/api/system/info` | Y | viewer | Runtime diagnostics (version, memory, uptime) |
| `GET` | `/api/system/containers` | Y | engineer | List containers (proxy to PG) |
| `GET` | `/api/system/logs` | Y | engineer | View container logs (proxy to PG) |
| `GET` | `/api/system/audit` | Y | admin | Query audit log |
| `GET` | `/api/system/topics` | Y | engineer | Active MQTT topics (proxy to PG) |

### Historian Endpoints (`/api/historian`)

| Method | Path | Auth | Min Role | Description |
|--------|------|:----:|----------|-------------|
| `GET` | `/api/historian/history` | Y | viewer | Query tag history (proxy to data-ingestion) |

### Health Endpoints (`/health`)

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/health` | N | Basic liveness |
| `GET` | `/health/ready` | N | Readiness (checks DB + MQTT) |
| `GET` | `/health/live` | N | Kubernetes liveness probe |

### Infrastructure Endpoints

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| `GET` | `/` | N | Service info (name, version, links) |
| `GET` | `/docs` | N | Swagger UI |
| `GET` | `/metrics` | N | Prometheus metrics |
| `GET` | `/ws` | Y* | WebSocket bridge (*auth at upgrade) |

## D. MQTT Topic Reference

### Published by Gateway Core

| Topic | QoS | When |
|-------|-----|------|
| `$nexus/config/devices/{id}` | 1 | Device create/update/delete/toggle |
| `$nexus/config/tags/{deviceId}/{tagId}` | 1 | Tag create/update/delete/toggle |
| `$nexus/config/devices/bulk` | 1 | Response to sync request |
| `$nexus/config/devices/{id}/status/request` | 1 | Status request (UI-triggered) |

### Subscribed by Gateway Core

| Topic | Handler | Purpose |
|-------|---------|---------|
| `$nexus/status/devices/+` | Status subscriber | Ingest device status updates |
| `$nexus/config/sync/request` | Config sync handler | Respond with full config dump |
| `$nexus/data/*` | WebSocket bridge | Forward live data to browsers |
| `$nexus/status/*` | WebSocket bridge | Forward status to browsers |

## E. Database Quick Reference

### Tables

| Table | Primary Key | Notable Constraints |
|-------|-------------|-------------------|
| `devices` | `id` (UUID) | `name` UNIQUE |
| `tags` | `id` (UUID) | `(device_id, name)` UNIQUE, FK → devices ON DELETE CASCADE |
| `audit_log` | `id` (UUID) | No FK constraints (append-only) |

### Enums

| Enum | Values |
|------|--------|
| `protocol` | modbus, opcua, s7, mqtt, bacnet, ethernetip |
| `device_status` | online, offline, error, unknown, connecting |
| `setup_status` | created, connected, configured, active |
| `tag_data_type` | bool, int16, int32, int64, uint16, uint32, uint64, float32, float64, string |

---

*Previous: [Chapter 17 — Edge Cases & Operational Notes](edge_cases.md) | [Back to Index](../INDEX.md)*
