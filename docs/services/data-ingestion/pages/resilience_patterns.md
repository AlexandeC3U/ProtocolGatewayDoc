# Chapter 9 — Resilience Patterns

> Circuit breaker, backpressure management, retry strategies, and the graceful shutdown sequence.

---

## Resilience Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RESILIENCE LAYERS                                       │
│                                                                             │
│  Layer 1: MQTT Resilience                                                   │
│  ├── Paho auto-reconnect (every 5s)                                         │
│  ├── Persistent session (messages queued in EMQX during disconnect)         │
│  ├── Resubscribe on reconnect                                               │
│  └── Liveness probe always 200 (process alive, not MQTT-dependent)          │
│                                                                             │
│  Layer 2: Buffer Backpressure                                               │
│  ├── pointsChan: 200k point buffer (non-blocking sends)                     │
│  ├── batchChan: 16 batch queue (decouples accumulator from writers)         │
│  ├── Drop counting with rate-limited logging (5s intervals)                 │
│  └── Buffer usage gauge for HPA-driven scaling                              │
│                                                                             │
│  Layer 3: Database Resilience                                               │
│  ├── Circuit breaker (5 failures → 10s open → 2 test batches)               │
│  ├── Exponential retry (100ms, 200ms, 400ms — cap 5s)                       │
│  ├── Transient error classification (SQLSTATE-aware)                        │
│  └── Connection pool (20 conns, 5m idle timeout)                            │
│                                                                             │
│  Layer 4: Graceful Shutdown                                                 │
│  ├── shutdownFlag prevents new points entering pipeline                     │
│  ├── MQTT disconnect + 100ms grace for in-flight callbacks                  │
│  ├── close(pointsChan) → accumulator flushes → close(batchChan)             │
│  ├── Writers drain remaining batches with context.Background()              │
│  └── 30s hard timeout                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## MQTT Resilience

### Auto-Reconnect

Paho handles all reconnection logic internally:

```
Broker restart / Network blip / DNS change
        │
        ▼
onConnectionLost(err)
  • isConnected = false
  • /health/ready returns 503
  • Kubernetes removes pod from Service endpoints
        │
        ▼
Paho auto-reconnect loop (every 5s)
  • No manual intervention needed
  • No pod restart needed
        │
        ▼
onConnect()
  • isConnected = true
  • Resubscribe to all topics
  • mqtt_reconnects_total++
  • /health/ready returns 200
  • Kubernetes re-adds pod to endpoints
```

### Message Queuing During Disconnect

```
Pod A disconnects at t=0
        │
        │  EMQX queues messages (persistent session)
        │  ├── Session expiry: 2 hours (configurable in EMQX)
        │  └── QoS 1 messages stored until acknowledged
        │
Pod A reconnects at t=30s
        │
        ▼
EMQX delivers queued messages (burst)
  • 30 seconds × 40k msg/s = 1.2M messages
  • pointsChan absorbs 200k, rest handled at batcher rate
  • Temporary spike in buffer usage — normal
```

### Liveness vs Readiness

| Probe           | MQTT Connected | MQTT Disconnected   |
| --------------- | -------------- | ------------------- |
| `/health/live`  | 200            | 200 (process alive) |
| `/health/ready` | 200            | 503 (not ready)     |

**Why liveness always returns 200:** An MQTT disconnect is a transient condition that Paho handles automatically. Restarting the pod would:

1. Discard the 200k point buffer
2. Force a full reconnect (5-10s)
3. Not fix the underlying issue (e.g., EMQX is down)

Kubernetes only restarts the pod if the process itself is unhealthy.

---

## Backpressure Management

### Pressure Gradient

```
    Normal              Backpressure          Overload
    ──────              ────────────          ────────

pointsChan:
    [····░░░░░░░░░░]    [████████░░░░]       [████████████]
     20% full            70% full              100% full

batchChan:
    [··░░░░░░░░]        [████████░░]         [██████████]
     1-2 batches         mostly full           full

Behavior:
    Points flow          Batches queue         Points DROPPED
    immediately          in batchChan          (counted, logged/5s)

Metrics:
    buffer_usage: 0.2    buffer_usage: 0.7    points_dropped++
                         batch_queue: 3+      buffer_usage: 1.0

HPA response:
    (none)               Scale up             Scale up
                         (buffer > 0.6)       (drop rate > 0)
```

### Why Non-Blocking Sends?

The MQTT callback goroutines are managed by Paho. Blocking a callback blocks the entire Paho client — no messages are delivered on any topic until the callback returns.

```go
// CORRECT: non-blocking send
select {
case pointsChan <- dp:
    // buffered
default:
    // drop + count (never blocks)
}

// WRONG: blocking send (would stall Paho)
pointsChan <- dp  // blocks if full — deadlock risk
```

### Drop Reporting

Drops are aggregated and logged every 5 seconds to prevent log flooding:

```
40,000 drops in 5 seconds → 1 log line:
  WARN "Dropped data points (buffer full)" dropped=40000

vs. per-drop logging → 40,000 log lines:
  WARN "Dropped data point" topic="dev/plc-001/temp"  (×40,000)
```

---

## Database Circuit Breaker

### State Machine

```
         ┌────────────────────────────────────────────────────────┐
         │                                                        │
         ▼                                                        │
    ┌─────────┐     5 consecutive     ┌──────────┐    10s     ┌──────────┐
    │ CLOSED  │────  failures  ──────>│  OPEN    │──timeout──>│HALF-OPEN │
    │         │                       │          │            │          │
    │ Normal  │                       │ Reject   │            │ Allow 2  │
    │ writes  │                       │ all      │            │ test     │
    │         │◄──────────────────────│ writes   │            │ batches  │
    └─────────┘  2 test batches       └──────────┘            └──────────┘
                 succeed                   ▲                      │
                                           │                      │
                                           └──test batch fails────┘
```

### What Happens in Each State

| State     | Write Behavior                  | Metric Value | Alert                       |
| --------- | ------------------------------- | ------------ | --------------------------- |
| CLOSED    | Normal — all writes proceed     | 0            | (none)                      |
| OPEN      | All writes rejected immediately | 2            | IngestionCircuitBreakerOpen |
| HALF-OPEN | 2 test batches allowed          | 1            | (none)                      |

### Why Circuit Breaker Matters

Without a breaker, a degraded TimescaleDB causes:

```
1. All 8 writers attempt writes → all hit 30s timeout
2. 8 connections held for 30s each → pool exhausted (20 conns)
3. New batches queue in batchChan → full in seconds
4. Accumulator direct-writes → also timeout
5. pointsChan fills → drops spike
6. Recovery takes minutes (pool drain, connection restablishment)
```

With a breaker:

```
1. 5 batches fail → breaker opens
2. All writes rejected immediately (0ms, no connections used)
3. After 10s, 2 test batches probe the database
4. If they succeed → breaker closes, normal operation resumes
5. Total disruption: ~15 seconds (vs. minutes without breaker)
```

---

## Retry Strategy

### When to Retry

Only **transient** errors are retried. The `isRetryableError()` function classifies errors:

| Error Type                     | Retryable | Reason                       |
| ------------------------------ | --------- | ---------------------------- |
| PG SQLSTATE 08 (connection)    | Yes       | Network, broker restart      |
| PG SQLSTATE 40 (serialization) | Yes       | Deadlock, concurrent access  |
| PG SQLSTATE 53 (resources)     | Yes       | Temporary memory/disk issue  |
| PG SQLSTATE 57 (operator)      | Yes       | DB in recovery mode          |
| "connection refused"           | Yes       | DB not accepting connections |
| "timeout"                      | Yes       | Network timeout              |
| "broken pipe"                  | Yes       | TCP connection severed       |
| PG constraint violation        | No        | Data error — won't self-heal |
| PG syntax error                | No        | Bug — won't self-heal        |
| Unknown errors                 | No        | Conservative default         |

### Backoff Timeline

```
Attempt 0:  [write]         ← immediate
            │ fail (transient)
            ▼
Attempt 1:  [100ms wait] [write]
            │ fail (transient)
            ▼
Attempt 2:  [200ms wait] [write]
            │ fail (transient)
            ▼
Attempt 3:  [400ms wait] [write]
            │ fail → give up, report error
            ▼
Total elapsed: ~700ms + write times
```

---

## Graceful Shutdown Sequence

```
SIGINT / SIGTERM received
        │
        ▼
1.  shutdownFlag.Store(true)
    └── handleMessage() fast-rejects new points (atomic check)
        │
        ▼
2.  subscriber.Disconnect()
    └── Paho sends DISCONNECT, stops message delivery
    └── EMQX begins queuing messages for this client ID
        │
        ▼
3.  time.Sleep(100ms)
    └── Allow in-flight Paho callbacks to complete
    └── Any callbacks that started before disconnect can finish
        │
        ▼
4.  close(pointsChan)
    └── Accumulator loop detects channel close
    └── accumulatorLoop returns, defers flushAndClose()
        │
        ▼
5.  flushAndClose()
    └── Flush currentBatch to batchChan (if not empty)
    └── close(batchChan)
        │
        ▼
6.  Writers drain batchChan
    └── for batch := range batchChan (exits on close)
    └── Each batch written with context.Background()
    └── Writers do NOT use cancelled root context
        │
        ▼
7.  batcher.wg.Wait()
    └── All goroutines (accumulator + writers) exited
    └── 30s timeout — returns error if exceeded
        │
        ▼
8.  publicServer.Shutdown() + internalServer.Shutdown()
    └── In-flight HTTP requests (Prometheus scrape, health check) complete
        │
        ▼
9.  dbWriter.Close() (deferred)
    └── pgxpool closes all connections
    └── Log "Database writer closed"
        │
        ▼
10. Process exits (code 0)
```

### Why context.Background() for Writers?

The root context is cancelled in step 1. If writers used the root context:

```go
// BAD: context cancelled → COPY aborted mid-write
w.pool.CopyFrom(ctx, ...)  // ctx is cancelled → immediate error
```

Instead, writers use `context.Background()`:

```go
// GOOD: COPY completes regardless of root context
w.pool.CopyFrom(context.Background(), ...)  // no external cancellation
```

This ensures in-flight database writes complete successfully, preventing partial batch writes and data corruption.

---

_Previous: [Chapter 8 — MQTT Subscriber](mqtt_subscriber.md) — Next: [Chapter 10 — Observability](observability.md)_

---

_Document Version: 1.0 — March 2026_
