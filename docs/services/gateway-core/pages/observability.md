# Chapter 12 — Observability

> Prometheus metrics, structured logging, health endpoints, and system diagnostics.

---

## Metrics (Prometheus)

Gateway Core exposes Prometheus-compatible metrics at `GET /metrics` (not behind auth — scraped by Prometheus).

### Metric Inventory

#### HTTP Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `gateway_core_http_requests_total` | Counter | `method`, `route`, `status` | Total HTTP requests |
| `gateway_core_http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request latency |

**Histogram buckets:** 10ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s

**Route normalization:** UUIDs and numeric IDs in URLs are replaced with `:id` to prevent cardinality explosion:

```
/api/devices/550e8400-e29b-41d4-a716-446655440000  →  /api/devices/:id
/api/tags/123                                       →  /api/tags/:id
```

#### WebSocket Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `gateway_core_ws_connections_active` | Gauge | Current active WebSocket connections |
| `gateway_core_ws_subscriptions_active` | Gauge | Current active topic subscriptions |

#### MQTT Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `gateway_core_mqtt_messages_received_total` | Counter | `topic_prefix` | Messages received from broker |
| `gateway_core_mqtt_connected` | Gauge | — | Connection status (1=connected, 0=disconnected) |

#### Proxy Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `gateway_core_proxy_requests_total` | Counter | `method`, `status` | Requests to protocol-gateway |
| `gateway_core_proxy_request_duration_seconds` | Histogram | `method` | Proxy request latency |

**Proxy histogram buckets:** 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s, 30s

#### Node.js Default Metrics

All prefixed with `gateway_core_`:

| Metric | Description |
|--------|-------------|
| `gateway_core_process_cpu_seconds_total` | CPU usage |
| `gateway_core_process_resident_memory_bytes` | RSS memory |
| `gateway_core_nodejs_heap_size_total_bytes` | V8 heap total |
| `gateway_core_nodejs_heap_size_used_bytes` | V8 heap used |
| `gateway_core_nodejs_eventloop_lag_seconds` | Event loop lag |
| `gateway_core_nodejs_active_handles_total` | Active handles (sockets, timers) |
| `gateway_core_nodejs_gc_duration_seconds` | GC pause time |

### How Metrics Are Collected

```
Request arrives
     │
     ▼
  onRequest hook
  → record start time (process.hrtime.bigint())
     │
     ▼
  Route handler executes
     │
     ▼
  onResponse hook
  → calculate duration (nanoseconds → seconds)
  → normalize route URL
  → increment counter + observe histogram
```

### Example Prometheus Queries

```promql
# Request rate (per second, 5-minute window)
rate(gateway_core_http_requests_total[5m])

# P95 latency for device endpoints
histogram_quantile(0.95,
  rate(gateway_core_http_request_duration_seconds_bucket{route=~"/api/devices.*"}[5m])
)

# Error rate (5xx)
sum(rate(gateway_core_http_requests_total{status=~"5.."}[5m]))
/
sum(rate(gateway_core_http_requests_total[5m]))

# Protocol-gateway circuit breaker trips (proxy 503s)
rate(gateway_core_proxy_requests_total{status="503"}[5m])

# WebSocket connection count
gateway_core_ws_connections_active

# Memory usage (MB)
gateway_core_process_resident_memory_bytes / 1024 / 1024
```

## Structured Logging (Pino)

### Configuration

| Environment | Format | Level |
|-------------|--------|-------|
| Development | Pretty-printed (pino-pretty, colorized, `HH:MM:ss`) | Configurable via `LOG_LEVEL` |
| Production | JSON (one line per entry) | Configurable via `LOG_LEVEL` |

**Log levels:** `trace` < `debug` < `info` < `warn` < `error` < `fatal`

Default: `info`

### Logger Instance

```typescript
// All modules import from lib/logger.ts
import { logger } from '../lib/logger.js';

// Structured context via first argument
logger.info({ deviceId, protocol }, 'Device created');
logger.error({ err, requestId }, 'Proxy request failed');
logger.warn({ retriesLeft }, 'Database not ready, retrying...');
```

### Fastify Request Logging

Fastify uses the same Pino instance for request logging:

```typescript
const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  },
});
```

Each request automatically gets a `reqId` for correlation.

### Error Handler Logging

The global error handler differentiates log levels:

```
5xx errors → logger.error({ err, requestId, request: { method, url } })
4xx errors → logger.warn({ err, requestId, request: { method, url } })
```

5xx errors include full stack traces but return generic `"Internal server error"` to clients. 4xx errors return the actual message. In development mode, `details` (e.g., Zod validation errors) are included in the response.

## Health Endpoints

### `GET /health` — Liveness

Minimal check — always returns 200 if the process is running.

```json
{
  "status": "ok",
  "timestamp": "2026-03-19T10:30:00.000Z"
}
```

**Use case:** Kubernetes liveness probe. If this fails, the pod is restarted.

### `GET /health/ready` — Readiness

Checks database and MQTT connectivity:

```json
{
  "status": "healthy",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "uptime": 3600,
  "checks": {
    "database": { "status": "ok", "latencyMs": 2 },
    "mqtt": { "status": "ok", "connected": true }
  }
}
```

**Status logic:**

| Database | MQTT | Overall | HTTP |
|----------|------|---------|------|
| ok | ok | healthy | 200 |
| ok | error | degraded | 503 |
| error | ok | degraded | 503 |
| error | error | unhealthy | 503 |

**Use case:** Kubernetes readiness probe. If this fails, the pod is removed from the Service (no traffic routed to it).

### `GET /health/live` — Kubernetes Liveness

Stripped-down endpoint for K8s:

```json
{ "status": "ok" }
```

### `GET /api/system/health` — Aggregated Platform Health

Checks **all** platform components in parallel:

```json
{
  "status": "degraded",
  "timestamp": "2026-03-19T10:30:00.000Z",
  "uptime": 3600,
  "components": {
    "database": { "status": "ok", "latencyMs": 2 },
    "mqtt": { "status": "ok", "connected": true },
    "websocket": { "status": "ok", "connections": 5, "subscriptions": 12 },
    "protocol_gateway": { "status": "ok", "latencyMs": 8, "circuitBreaker": "CLOSED" },
    "data_ingestion": { "status": "error", "error": "Data ingestion unreachable", "latencyMs": 2001 }
  }
}
```

**Critical component:** If database is down → `unhealthy`. If any other component is down → `degraded`.

### `GET /api/system/info` — Runtime Diagnostics

```json
{
  "service": "gateway-core",
  "version": "2.0.0",
  "environment": "production",
  "uptime": 3600,
  "node": "v20.11.0",
  "auth": true,
  "audit": true,
  "websocket": { "connections": 5, "subscriptions": 12 },
  "memory": {
    "rss": 85,
    "heapUsed": 42,
    "heapTotal": 64,
    "unit": "MB"
  }
}
```

## Audit Trail

See [Chapter 6 — Middleware Architecture](middleware_architecture.md) for full audit logging details.

The audit log is queryable via `GET /api/system/audit` (admin only):

| Query Parameter | Type | Description |
|----------------|------|-------------|
| `username` | string | Filter by username |
| `action` | string | Filter by action (e.g., `device.create`) |
| `resourceType` | string | Filter by resource type |
| `since` | ISO 8601 | Only entries after this timestamp |
| `limit` | number | Max entries (default 50, max 200) |
| `offset` | number | Pagination offset |

## Swagger / OpenAPI

Auto-generated documentation available at `GET /docs`:

- Title: "NEXUS Edge - Gateway Core API"
- Version: 2.0.0
- Security scheme: Bearer JWT
- Tag groups: Devices, Tags, OPC UA, System, Health

The `/metrics` endpoint is hidden from Swagger (`schema: { hide: true }`).

---

*Previous: [Chapter 11 — Resilience Patterns](resilience_patterns.md) | Next: [Chapter 13 — Security Architecture](security_architecture.md)*
