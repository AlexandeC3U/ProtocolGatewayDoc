# Chapter 11 — Resilience Patterns

> Circuit breaker, MQTT reconnection, database retry, connection pool guards, and graceful shutdown.

---

## Design Philosophy

Gateway Core runs on edge hardware where network partitions, service restarts, and resource constraints are normal — not exceptional. Every external dependency has a failure strategy:

| Dependency        | Failure Mode      | Strategy                                      |
| ----------------- | ----------------- | --------------------------------------------- |
| Protocol-Gateway  | Down/slow         | Circuit breaker (5 failures → 30s open)       |
| MQTT Broker       | Disconnected      | Auto-reconnect every 5s, non-blocking startup |
| PostgreSQL        | Down/slow         | Startup retry (5 attempts), pool timeouts     |
| Data-Ingestion    | Down/slow         | Simple timeout (15s), no circuit breaker      |
| WebSocket Clients | Stale connections | 30s ping/pong heartbeat                       |

## Circuit Breaker (Protocol-Gateway Proxy)

The circuit breaker protects gateway-core from cascading failure when protocol-gateway is down.

### State Machine

```
                    CLOSED
                   (normal)
                   ┌──────┐
                   │      │ request succeeds → consecutiveFailures = 0
                   │  OK  │
                   │      │ request fails → consecutiveFailures++
                   └──┬───┘
                      │
         consecutiveFailures >= 5
                      │
                      ▼
                    OPEN
                  (degraded)
                   ┌──────┐
                   │ FAIL │ all requests immediately throw 503
                   │ FAST │ "Circuit breaker is open"
                   └──┬───┘
                      │
              30s cooldown expired
                      │
                      ▼
                  HALF_OPEN
                  (probing)
                   ┌──────┐
                   │ PROBE│ next request passes through as test
                   └──┬───┘
                      │
            ┌─────────┼─────────┐
            │                   │
        succeeds              fails
            │                   │
            ▼                   ▼
          CLOSED              OPEN
        (recovered)        (restart 30s)
```

### Implementation Details

```typescript
const FAILURE_THRESHOLD = 5; // Consecutive failures to trip
const COOLDOWN_MS = 30_000; // 30 seconds before probe

let circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
let consecutiveFailures = 0;
let lastFailureTime = 0;
```

**What counts as a failure:**

- Network errors (ECONNREFUSED, DNS failure, timeout)
- 5xx responses from protocol-gateway

**What does NOT trip the breaker:**

- 4xx responses (client errors pass through and _reset_ the failure count)
- Health check probes (`skipCircuitBreaker: true`)

### Error Classification

The proxy classifies errors for meaningful HTTP responses:

| Error Type         | HTTP Status | Error Code                 | Detection                            |
| ------------------ | ----------- | -------------------------- | ------------------------------------ |
| Circuit open       | 503         | `CIRCUIT_BREAKER_OPEN`     | `circuitState === 'OPEN'`            |
| Timeout            | 504         | `PROXY_TIMEOUT`            | `TimeoutError` or `abort` in message |
| Connection refused | 502         | `PROXY_CONNECTION_REFUSED` | `ECONNREFUSED` in message            |
| DNS failure        | 502         | `PROXY_DNS_ERROR`          | `ENOTFOUND` or `getaddrinfo`         |
| Other              | 502         | `PROXY_UNREACHABLE`        | Catch-all                            |

### Monitoring

```
gateway_core_proxy_requests_total{method="GET", status="502"}
gateway_core_proxy_request_duration_seconds{method="POST"}
```

The circuit breaker state is also reported in `GET /api/system/health`:

```json
{
  "components": {
    "protocol_gateway": {
      "status": "error",
      "circuitBreaker": "OPEN"
    }
  }
}
```

## MQTT Reconnection

### Connection Strategy

```
                Start
                  │
                  ▼
         ┌───────────────┐
         │  Connect to   │
         │  MQTT Broker  │
         └───────┬───────┘
                 │
          ┌──────┼──────┐
          │             │
       success        fail
          │             │
          ▼             ▼
    Start subs    Log warning
    (status +     "will retry..."
     config sync)     │
          │           │
          │      Wait 5 seconds
          │           │
          │           └──▶ retry
          │
          ▼
    Normal operation
          │
    disconnect event
          │
          ▼
    Auto-reconnect
    (mqtt.js built-in
     reconnectPeriod: 5000)
```

**Key behaviors:**

- MQTT connection is **non-blocking** at startup — the HTTP server starts even if MQTT is down
- The mqtt.js library handles reconnection automatically with a 5-second interval
- Subscribers are started only after the first successful connection
- The `clean: true` session flag means no persistent sessions — on reconnect, subscriptions are re-established

### Impact During MQTT Outage

| Feature          | Impact                                                  |
| ---------------- | ------------------------------------------------------- |
| Device/Tag CRUD  | Works (HTTP + DB), but MQTT notifications silently fail |
| Config sync      | Protocol-gateway won't receive updates until reconnect  |
| Status ingest    | No status updates — devices may show stale `lastSeen`   |
| WebSocket bridge | No new data forwarded — clients see stale data          |
| Health check     | Reports `mqtt: {status: 'error'}` → degraded            |

## Database Resilience

### Startup Retry

The migration runner retries database connections up to 5 times with 2-second intervals:

```
Attempt 1: SELECT 1 → fail → wait 2s
Attempt 2: SELECT 1 → fail → wait 2s
Attempt 3: SELECT 1 → fail → wait 2s
Attempt 4: SELECT 1 → fail → wait 2s
Attempt 5: SELECT 1 → fail → EXIT(1)
           SELECT 1 → success → run migrations
```

This handles the common case where gateway-core starts before PostgreSQL is ready (Docker Compose `depends_on` only waits for container start, not service readiness).

### Connection Pool

```typescript
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_SIZE, // Default: 10
  statement_timeout: 30_000, // Kill queries after 30s
  idle_in_transaction_session_timeout: 60_000, // Kill stuck txns after 60s
});
```

| Guard                                 | Value             | Purpose                        |
| ------------------------------------- | ----------------- | ------------------------------ |
| `max`                                 | 10 (configurable) | Prevents connection exhaustion |
| `statement_timeout`                   | 30s               | Kills runaway queries          |
| `idle_in_transaction_session_timeout` | 60s               | Releases stuck transactions    |

### Schema Fallback

If the `./drizzle` migrations folder doesn't exist, the migration runner falls back to inline DDL:

```
Try Drizzle migrations → success → done
                       → fail → run setupSchema() with CREATE IF NOT EXISTS
```

This makes the service self-bootstrapping — it creates its own schema on first run without requiring a separate migration step.

## MQTT Notification Best-Effort Pattern

Every MQTT notification follows the same pattern to prevent MQTT failures from breaking the HTTP API:

```typescript
// In DeviceService.create():
mqttService.notifyDeviceChange('create', device).catch((err) => {
  logger.error({ err, deviceId: device.id }, 'Failed to send MQTT notification');
});
```

**Rules:**

1. The HTTP response is sent **before** the MQTT publish completes
2. MQTT publish errors are caught with `.catch()` and logged
3. The client **never** sees an error due to MQTT failure
4. Protocol-gateway will eventually get the correct state via the next change or a manual sync

## Audit Logging Best-Effort

The audit middleware follows the same pattern — it runs in the `onResponse` hook, after the client has already received its response:

```
Client receives 201 → audit hook fires → INSERT INTO audit_log
                                        → fail? log error, move on
```

This prevents audit infrastructure issues from breaking the API.

## Graceful Shutdown

```
SIGTERM / SIGINT received
         │
         ▼
  1. stopWebSocketBridge()      ← Unregister MQTT handler, clear topic map
         │
         ▼
  2. app.close()                ← Close HTTP server, terminate WS connections
         │
         ▼
  3. mqttService.disconnect()   ← Disconnect from MQTT broker
         │
         ▼
  4. closeDatabase()            ← Drain connection pool (pool.end())
         │
         ▼
  5. process.exit(0)
```

**Ordering rationale:**

1. WebSocket bridge first — prevents new MQTT messages from being forwarded to closing WS connections
2. HTTP server — stops accepting new requests, finishes in-flight ones
3. MQTT — disconnects cleanly (sends DISCONNECT packet)
4. Database — drains the pool (waits for active queries to complete)

If any step throws, the error is logged and `process.exit(1)` is called.

## Rate Limiting

When `RATE_LIMIT_ENABLED=true`:

```
Request → check IP/user rate → under limit → proceed
                              → over limit → 429 Too Many Requests
                                              + Retry-After header
```

| Configuration       | Default                           | Description                                 |
| ------------------- | --------------------------------- | ------------------------------------------- |
| `RATE_LIMIT_MAX`    | 100                               | Requests per window                         |
| `RATE_LIMIT_WINDOW` | `1 minute`                        | Time window                                 |
| Key generator       | `request.user?.sub ?? request.ip` | Per-user if authenticated, per-IP otherwise |
| Allow list          | `127.0.0.1`, `::1`                | Localhost exempt (health checks, internal)  |

Per-route overrides exist for expensive operations:

| Route                      | Limit | Window   |
| -------------------------- | ----- | -------- |
| `POST /devices/:id/test`   | 10    | 1 minute |
| `POST /devices/:id/browse` | 10    | 1 minute |

---

_Previous: [Chapter 10 — Data Flow Architecture](dataflow_architecture.md) | Next: [Chapter 12 — Observability](observability.md)_
