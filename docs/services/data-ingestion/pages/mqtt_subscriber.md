# Chapter 8 — MQTT Subscriber

> Paho client configuration, shared subscriptions, reconnection handling, and message parsing.

---

## Subscriber Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MQTT SUBSCRIBER                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Eclipse Paho MQTT v1 Client                                        │    │
│  │                                                                     │    │
│  │  Broker:  tcp://emqx:1883                                           │    │
│  │  ClientID: data-ingestion-{hostname}                                │    │
│  │  QoS: 1 (at-least-once)                                             │    │
│  │  CleanSession: false (persistent session)                           │    │
│  │  AutoReconnect: true                                                │    │
│  │  ConnectRetry: true                                                 │    │
│  │  ConnectRetryInterval: 5s                                           │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                           │
│  Callbacks:                     │                                           │
│  ┌──────────────────────────────┼──────────────────────────────────────┐    │
│  │                              │                                      │    │
│  │  onConnect() ───────────────>│  Set isConnected = true              │    │
│  │                              │  Subscribe to topics                 │    │
│  │                              │  Log "Connected" or "Reconnected"    │    │
│  │                              │  Inc mqtt_reconnects (if reconnect)  │    │
│  │                              │                                      │    │
│  │  onConnectionLost() ────────>│  Set isConnected = false             │    │
│  │                              │  Log warning with error              │    │
│  │                              │  Paho auto-reconnect handles retry   │    │
│  │                              │                                      │    │
│  │  onMessage() ───────────────>│  Capture receivedAt = time.Now()     │    │
│  │                              │  Call handler(topic, payload, time)  │    │
│  │                              │                                      │    │
│  └──────────────────────────────┴──────────────────────────────────────┘    │
│                                                                             │
│  Topics:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  $share/ingestion/dev/#     ← Device telemetry (raw topic format)   │    │
│  │  $share/ingestion/uns/#     ← Unified Namespace (ISA-95 format)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Paho Client Configuration

```go
opts := paho.NewClientOptions()
opts.AddBroker(config.BrokerURL)          // tcp://emqx:1883
opts.SetClientID(config.ClientID)          // data-ingestion-{hostname}
opts.SetKeepAlive(config.KeepAlive)        // 30s
opts.SetCleanSession(config.CleanSession)  // false (persistent session)
opts.SetAutoReconnect(true)                // Built-in reconnect
opts.SetConnectRetry(true)                 // Retry initial connect too
opts.SetConnectRetryInterval(config.ReconnectDelay)  // 5s between retries
opts.SetConnectionLostHandler(s.onConnectionLost)
opts.SetOnConnectHandler(s.onConnect)
opts.SetDefaultPublishHandler(s.onMessage)
```

**Key settings explained:**

| Setting                | Value | Why                                                   |
| ---------------------- | ----- | ----------------------------------------------------- |
| `AutoReconnect`        | true  | Paho reconnects automatically on disconnect           |
| `ConnectRetry`         | true  | Retries initial connection (e.g., EMQX not ready yet) |
| `CleanSession`         | false | EMQX preserves session and queued messages            |
| `KeepAlive`            | 30s   | Detect dead connections within 1.5× = 45s             |
| `QoS`                  | 1     | At-least-once — messages survive broker restart       |
| `ConnectRetryInterval` | 5s    | Time between reconnection attempts                    |

---

## Shared Subscriptions

The service uses EMQX shared subscriptions for load balancing:

```
Topic: $share/ingestion/dev/#
       ^^^^^^^^^^^^^^^^^^^^^^
       │     │          │
       │     │          └── Wildcard: all subtopics under dev/
       │     └── Group name: "ingestion"
       └── Shared subscription prefix (EMQX-specific)
```

**How it works:**

```
Protocol Gateway publishes:  dev/plc-001/temperature
                              dev/plc-001/pressure
                              dev/plc-002/temperature

EMQX distributes across group "ingestion":

    Instance 1 receives:  dev/plc-001/temperature
    Instance 2 receives:  dev/plc-001/pressure
    Instance 3 receives:  dev/plc-002/temperature

Each message delivered to exactly ONE instance — no duplicates!
```

**EMQX load balancing strategies:**

- Default: round-robin across connected subscribers in the group
- Configurable: random, hash (by client ID or topic)

**Two topic groups subscribed:**

| Topic Filter             | Data Source                                       |
| ------------------------ | ------------------------------------------------- |
| `$share/ingestion/dev/#` | Raw device data (`dev/{device_id}/{tag}`)         |
| `$share/ingestion/uns/#` | Unified Namespace (`uns/{enterprise}/{site}/...`) |

---

## Connection Lifecycle

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│ Connect  │────────>│ Subscribe│────────>│ Receive  │
│          │         │          │         │ Messages │
└──────────┘         └──────────┘         └────┬─────┘
                                               │
                                    Connection lost
                                               │
                                               ▼
                                    ┌───────────────────┐
                                    │ onConnectionLost  │
                                    │ isConnected=false │
                                    │ /health/ready=503 │
                                    └────────┬──────────┘
                                             │
                                    Paho auto-reconnect
                                    (every 5s)
                                             │
                                             ▼
                                    ┌───────────────────┐
                                    │ onConnect         │
                                    │ isConnected=true  │
                                    │ Resubscribe       │
                                    │ reconnects++      │
                                    │ /health/ready=200 │
                                    └───────────────────┘
```

### First Connection vs Reconnection

The subscriber tracks `everConnected` (atomic bool) to distinguish:

```go
func (s *Subscriber) onConnect(client paho.Client) {
    s.isConnected.Store(true)

    if s.everConnected.Load() {
        // Reconnection
        s.metrics.IncMQTTReconnects()
        s.logger.Info().Msg("Reconnected to MQTT broker")
    } else {
        // First connection
        s.everConnected.Store(true)
        s.logger.Info().Msg("Connected to MQTT broker")
    }

    s.subscribe()
}
```

**Why distinguish?** The reconnect counter is a meaningful operational metric — frequent reconnects indicate network instability. The first connection should not count as a reconnect.

---

## Message Handling

```go
func (s *Subscriber) onMessage(client paho.Client, msg paho.Message) {
    receivedAt := time.Now()  // Capture immediately for lag calculation

    s.handlerMu.RLock()
    handler := s.handler
    s.handlerMu.RUnlock()

    if handler != nil {
        handler(msg.Topic(), msg.Payload(), receivedAt)
    }
}
```

**Design notes:**

1. **`time.Now()` first** — Captured before any processing to ensure accurate lag measurement. The lag metric is `receivedAt → write completion`.

2. **RWMutex for handler** — The handler is set once during startup (`SetHandler()`), but read on every message. RWMutex allows concurrent reads with no contention.

3. **Nil handler guard** — During startup, there's a brief window where the subscriber is connected but the handler isn't set. Messages in this window are silently dropped (Paho may deliver queued messages before handler registration).

---

## ParseMessage

Delegates to the domain layer for JSON parsing and validation:

```go
func (s *Subscriber) ParseMessage(topic string, payload []byte, receivedAt time.Time) (*domain.DataPoint, error) {
    dp, err := domain.ParsePayload(topic, payload, receivedAt)
    if err != nil {
        s.parseErrors.Add(1)
        s.metrics.IncParseErrors()
        s.logger.Debug().Err(err).Str("topic", topic).Msg("Parse error")
        return nil, err
    }
    return dp, nil
}
```

Parse errors are logged at **Debug** level (not Warn/Error) because they are expected in normal operation — malformed messages from misconfigured devices should not flood logs. The `parse_errors_total` metric provides observability without noise.

---

## MQTT Session Persistence

With `clean_session: false`, EMQX maintains a persistent session:

```
┌─────────────────────────────────────────────────────────────────┐
│               PERSISTENT SESSION BEHAVIOR                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pod running normally:                                          │
│  ├── Messages delivered immediately                             │
│  └── Session active in EMQX                                     │
│                                                                 │
│  Pod stops (graceful or crash):                                 │
│  ├── EMQX detects disconnect (KeepAlive timeout: ~45s)          │
│  ├── Session persists in EMQX (default expiry: 2 hours)         │
│  └── Messages for this client ID queued in EMQX                 │
│                                                                 │
│  Pod restarts (same client ID):                                 │
│  ├── Reconnects with same client ID                             │
│  ├── EMQX delivers queued messages (burst)                      │
│  ├── pointsChan (200k) absorbs the burst                        │
│  └── Zero data loss for outages < 2 hours                       │
│                                                                 │
│  Session expires (>2 hours):                                    │
│  ├── EMQX discards queued messages                              │
│  ├── Pod reconnects as new session                              │
│  └── Messages during gap are lost                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Subscriber Stats

```json
{
  "connected": true,
  "broker": "tcp://emqx:1883",
  "client_id": "data-ingestion-pod-abc123",
  "topics": ["$share/ingestion/dev/#", "$share/ingestion/uns/#"],
  "parse_errors": 42
}
```

---

_Previous: [Chapter 7 — Writer Internals](writer_internals.md) — Next: [Chapter 9 — Resilience Patterns](resilience_patterns.md)_

---

_Document Version: 1.0 — March 2026_
