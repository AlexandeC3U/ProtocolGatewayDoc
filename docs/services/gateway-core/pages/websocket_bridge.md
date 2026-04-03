# Chapter 9 — WebSocket Bridge

> MQTT→WebSocket bridge with reference-counted subscriptions, topic ACL, and heartbeat.

---

## Why a Bridge?

Browsers cannot speak MQTT natively. The WebSocket bridge translates between the two worlds:

```
Browser (WebSocket)                                      EMQX (MQTT)
┌──────────┐                    ┌──────────┐            ┌──────────┐
│  Web UI  │<── JSON over WS ──>│  Bridge  │<── MQTT ──>│  Broker  │
└──────────┘                    │ (gateway │            └──────────┘
                                │  core)   │
                                └──────────┘
```

**Key design choice:** The bridge runs _inside_ gateway-core, not as a separate service. This means auth is shared (JWT validated at WS upgrade), and the bridge piggybacks on the existing MQTT client connection.

## Architecture

```
                    ┌──────────────────────────────────┐
                    │       SubscriptionManager        │
                    │  (singleton, reference-counted)  │
                    ├──────────────────────────────────┤
                    │                                  │
                    │topicClients: Map<topic, Set<WS>> │
                    │                                  │
                    │  ┌────────────┐ ┌────────────┐   │
                    │  │ $nexus/    │ │ $nexus/    │   │
                    │  │ data/acme/ │ │ status/    │   │
                    │  │ plant1/#   │ │ devices/+  │   │
                    │  │            │ │            │   │
                    │  │ WS1, WS2   │ │ WS1, WS3   │   │
                    │  └────────────┘ └────────────┘   │
                    │                                  │
                    │  MQTT subscribe on first client  │
                    │  MQTT unsubscribe on last client │
                    └──────────────┬───────────────────┘
                                   │
                              mqttHandler
                              (registered once)
                                   │
                    ┌──────────────▼───────────────────┐
                    │          MQTT Client             │
                    │(shared with publisher/subscriber)│
                    └──────────────────────────────────┘
```

## Protocol

### Client → Server Messages

#### Subscribe

```json
{
  "type": "subscribe",
  "topics": ["$nexus/data/acme/plant1/#", "$nexus/status/devices/+"]
}
```

#### Unsubscribe

```json
{
  "type": "unsubscribe",
  "topics": ["$nexus/data/acme/plant1/#"]
}
```

### Server → Client Messages

#### Data (MQTT message forwarded)

```json
{
  "type": "data",
  "topic": "$nexus/data/acme/plant1/temperature",
  "payload": { "value": 72.5, "quality": "good", "timestamp": 1710841800000 },
  "timestamp": "2026-03-19T10:30:00.000Z"
}
```

#### Error

```json
{
  "type": "error",
  "message": "Topic not allowed: $nexus/config/devices/abc"
}
```

## Topic Access Control

Only two topic prefixes are allowed:

| Prefix           | Purpose                                       |
| ---------------- | --------------------------------------------- |
| `$nexus/data/`   | Live tag values published by protocol-gateway |
| `$nexus/status/` | Device status changes                         |

All other topics are rejected with an error message. This prevents clients from subscribing to config topics (`$nexus/config/`) which carry sensitive connection credentials.

```typescript
const ALLOWED_TOPIC_PREFIXES = ['$nexus/data/', '$nexus/status/'];
```

## Reference-Counted Subscriptions

The `SubscriptionManager` ensures each MQTT topic is subscribed **exactly once**, regardless of how many WebSocket clients want it.

```
WS Client A subscribes to "$nexus/data/acme/#"
  → topicClients["$nexus/data/acme/#"] = {A}
  → MQTT subscribe "$nexus/data/acme/#" (first client)

WS Client B subscribes to "$nexus/data/acme/#"
  → topicClients["$nexus/data/acme/#"] = {A, B}
  → No MQTT action (already subscribed)

WS Client A disconnects
  → topicClients["$nexus/data/acme/#"] = {B}
  → No MQTT action (still has clients)

WS Client B unsubscribes
  → topicClients["$nexus/data/acme/#"] = {} → deleted
  → MQTT unsubscribe "$nexus/data/acme/#" (last client)
```

## MQTT Wildcard Matching

The bridge supports MQTT wildcard patterns in subscriptions:

| Pattern                   | Matches                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `$nexus/data/acme/#`      | All topics under `$nexus/data/acme/` at any depth                                          |
| `$nexus/status/devices/+` | Single-level wildcard: `$nexus/status/devices/abc` but not `$nexus/status/devices/abc/xyz` |

The `topicMatchesPattern()` method handles wildcard resolution when an incoming MQTT message doesn't have an exact match in the subscription map:

```
MQTT message on "$nexus/data/acme/plant1/temperature"
  │
  ├── Exact match in topicClients? → broadcast to those clients
  │
  └── No exact match → scan all patterns:
      ├── "$nexus/data/acme/#" matches? YES → broadcast
      └── "$nexus/data/other/#" matches? NO → skip
```

## Connection Lifecycle

```
Browser                          Gateway Core                    MQTT
   │                                  │                            │
   │  GET /ws (upgrade)               │                            │
   │─────────────────────────────────>│                            │
   │                                  │                            │
   │  Auth check (if AUTH_ENABLED)    │                            │
   │  check request.user exists       │                            │
   │                                  │                            │
   │  Connection established          │                            │
   │<─────────────────────────────────│                            │
   │                                  │                            │
   │  Start 30s ping interval         │                            │
   │                                  │                            │
   │  {"type":"subscribe",            │                            │
   │   "topics":["$nexus/data/#"]}    │                            │
   │─────────────────────────────────>│                            │
   │                                  │  SUBSCRIBE $nexus/data/#   │
   │                                  │───────────────────────────>│
   │                                  │                            │
   │                                  │  Message on $nexus/data/.. │
   │                                  │<───────────────────────────│
   │                                  │                            │
   │  {"type":"data",                 │                            │
   │   "topic":"...",                 │                            │
   │   "payload":{...}}               │                            │
   │w─────────────────────────────────│                            │
   │                                  │                            │
   │  Connection closed               │                            │
   │──────────────────────X           │                            │
   │                                  │  UNSUBSCRIBE (if last)     │
   │                                  │───────────────────────────>│
```

## Guards & Limits

| Guard                            | Value                                           | Purpose                                                     |
| -------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Auth check                       | `env.AUTH_ENABLED`                              | Rejects unauthenticated connections with close code 4001    |
| Topic allowlist                  | 2 prefixes                                      | Prevents subscribing to config/sensitive topics             |
| Max topics per subscribe message | 50                                              | Prevents payload bombs                                      |
| Max subscriptions per client     | `WS_MAX_SUBSCRIPTIONS_PER_CLIENT` (default 100) | Prevents resource exhaustion                                |
| Ping interval                    | 30 seconds                                      | Detects dead connections (browser tab closed, network drop) |
| Topic validation                 | `typeof topic === 'string'`                     | Type-checks each topic in the array                         |

## Heartbeat

The bridge sends WebSocket `ping` frames every 30 seconds. Browsers automatically respond with `pong` (built into the WebSocket spec). If a pong is not received, the connection is considered dead and cleaned up on the next ping cycle.

```typescript
const pingInterval = setInterval(() => {
  if (socket.readyState === socket.OPEN) {
    socket.ping();
  }
}, 30_000);
```

The interval is cleared on connection close to prevent memory leaks.

## Stats & Metrics

The bridge exposes stats via `getWebSocketStats()`:

```json
{
  "connections": 5,
  "subscriptions": 12
}
```

These values are:

- Surfaced in `GET /api/system/info` response
- Surfaced in `GET /api/system/health` response
- Available as Prometheus gauges: `gateway_core_ws_connections_active` and `gateway_core_ws_subscriptions_active`

## Graceful Shutdown

On SIGTERM/SIGINT:

1. `stopWebSocketBridge()` is called first
2. The subscription manager removes its MQTT message handler
3. The topic→client map is cleared
4. Then `app.close()` terminates all WebSocket connections

This ordering ensures no orphaned MQTT subscriptions remain after shutdown.

---

_Previous: [Chapter 8 — Proxy Architecture](proxy_architecture.md) | Next: [Chapter 10 — Data Flow Architecture](dataflow_architecture.md)_
