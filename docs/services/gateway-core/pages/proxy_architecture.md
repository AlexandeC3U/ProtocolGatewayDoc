# Chapter 8 — Proxy Architecture

> HTTP proxy to protocol-gateway and data-ingestion, with circuit breaker.

---

## Why a Proxy?

Gateway Core is the **single entry point** for the web UI. The UI should never call protocol-gateway or data-ingestion directly because:

1. **Security**: Only gateway-core has auth/RBAC — direct access bypasses it
2. **Abstraction**: The UI doesn't need to know about downstream service URLs
3. **Resilience**: Gateway-core adds circuit breaking and timeout management
4. **CORS**: Only one origin needs to be configured (gateway-core's port)

```
Web UI ──────▶ Gateway Core ──proxy──▶ Protocol-Gateway
                    │
                    └──proxy──▶ Data-Ingestion
```

## Protocol-Gateway Proxy (protocol-gateway.ts)

### HTTP Methods

| Method | Signature | Use Case |
|--------|-----------|----------|
| `proxyGet(path, query?, options?)` | GET with query params | Browse, status, certificates, containers, logs |
| `proxyPost(path, body?, options?)` | POST with JSON body | Test connection |
| `proxyDelete(path, query?, options?)` | DELETE with query params | Remove certificate |

### Proxy Options

```typescript
interface ProxyOptions {
  timeout?: number;              // Default: 30,000ms
  requestId?: string;            // Forwarded as X-Request-ID header
  skipCircuitBreaker?: boolean;  // True for health checks (always attempt)
}
```

### Proxied Routes

| Gateway Core Route | Proxied To | Purpose |
|-------------------|------------|---------|
| `POST /api/devices/:id/test` | `POST /api/test-connection` | Test device connectivity |
| `POST /api/devices/:id/browse` | `POST /api/browse/:id` | Browse device tag tree |
| `GET /api/devices/:id/status` | `GET /api/devices/:id/status` | Get runtime status |
| `GET /api/opcua/certificates/trusted` | `GET /api/opcua/certificates/trusted` | List trusted certs |
| `GET /api/opcua/certificates/rejected` | `GET /api/opcua/certificates/rejected` | List rejected certs |
| `POST /api/opcua/certificates/trust` | `POST /api/opcua/certificates/trust` | Trust a certificate |
| `DELETE /api/opcua/certificates/trusted/:fp` | `DELETE /api/opcua/certificates/trusted` | Remove cert |
| `GET /api/system/containers` | `GET /api/system/containers` | List containers |
| `GET /api/system/logs` | `GET /api/system/logs` | View container logs |
| `GET /api/system/topics` | `GET /api/system/topics` | MQTT topics overview |

### Circuit Breaker

```
                    CLOSED
                   (normal)
                   ┌──────┐
                   │      │ request succeeds → reset failure count
                   │  OK  │
                   │      │ request fails → increment failure count
                   └──┬───┘
                      │
         failure count >= 5
                      │
                      ▼
                    OPEN
                  (degraded)
                   ┌──────┐
                   │ FAIL │ all requests immediately return 503
                   │ FAST │ "Protocol gateway unavailable (circuit open)"
                   └──┬───┘
                      │
              30s cooldown expired
                      │
                      ▼
                  HALF_OPEN
                  (probing)
                   ┌──────┐
                   │ PROBE│ next request is a test
                   │      │
                   └──┬───┘
                      │
            ┌─────────┼─────────┐
            │                   │
        succeeds              fails
            │                   │
            ▼                   ▼
          CLOSED              OPEN
        (recovered)        (restart cooldown)
```

**Configuration:**

| Parameter | Value |
|-----------|-------|
| Failure threshold | 5 consecutive failures |
| Cooldown period | 30 seconds |
| Skip for health checks | Yes (`skipCircuitBreaker: true`) |

**Metrics:**
- `gateway_core_proxy_requests_total{method, status}` — tracks all proxy calls
- `gateway_core_proxy_request_duration_seconds{method}` — latency histogram

### Health Check

```typescript
const health = await checkProtocolGatewayHealth();
// Returns:
{
  status: 'ok' | 'error',
  latencyMs: 12,                    // Round-trip time to /health/live
  error: 'Connection refused',      // Only on failure
  circuitBreaker: 'closed'          // Current CB state
}
```

Uses 2-second timeout, always skips circuit breaker (must attempt even when open to detect recovery).

## Data-Ingestion Proxy (data-ingestion.ts)

A simpler proxy for historian queries:

| Gateway Core Route | Proxied To | Purpose |
|-------------------|------------|---------|
| `GET /api/historian/history` | `GET /api/history` | Query tag history |

**Configuration:**
- Timeout: 15 seconds (historian queries may scan large datasets)
- No circuit breaker (single endpoint, less critical path)

**Query Parameters Forwarded:**

| Param | Type | Description |
|-------|------|-------------|
| `topic` | string | MQTT topic to query (e.g., `acme/plant1/line1/temperature`) |
| `from` | number | Start timestamp (Unix ms) |
| `to` | number | End timestamp (Unix ms) |
| `limit` | number | Max rows to return |

## Error Handling

All proxy errors are caught and returned as structured JSON:

```json
{
  "error": {
    "code": "PROXY_ERROR",
    "message": "Protocol gateway unavailable (circuit open)",
    "requestId": "req-abc-123"
  }
}
```

| Scenario | HTTP Status | Message |
|----------|-------------|---------|
| Circuit open | 503 | "Protocol gateway unavailable (circuit open)" |
| Connection refused | 502 | "Protocol gateway unreachable" |
| Timeout (30s) | 504 | "Protocol gateway timeout" |
| 4xx from downstream | Forwarded | Original error body forwarded |
| 5xx from downstream | Forwarded | Original error body forwarded |

---

*Previous: [Chapter 7 — MQTT Architecture](mqtt_architecture.md) | Next: [Chapter 9 — WebSocket Bridge](websocket_bridge.md)*
