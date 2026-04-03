# Chapter 17 — Edge Cases & Gotchas

> At-least-once delivery, timestamp skew, NaN/Inf values, message ordering, and operational notes.

---

## At-Least-Once Delivery (Duplicate Handling)

MQTT QoS 1 guarantees **at-least-once** delivery. This means:

```
Protocol Gateway publishes message M (QoS 1)
        │
        ▼
EMQX delivers M to Data Ingestion
        │
        ▼
Data Ingestion processes M, PUBACK delayed (e.g., slow GC pause)
        │
EMQX retransmit timeout triggers (DUP flag set)
        │
        ▼
EMQX delivers M again (duplicate)
        │
        ▼
Data Ingestion processes M again → DUPLICATE ROW IN DB
```

**Current behavior:** Duplicates are written to TimescaleDB. The `metrics` table has no UNIQUE constraint on (topic, time) because:

1. **High throughput** — UNIQUE constraints add index maintenance overhead on every INSERT/COPY
2. **Legitimate duplicates** — Two tags can have the same topic and timestamp (e.g., device reports same reading twice)
3. **Deduplication at query time** — Aggregates (AVG, MIN, MAX) are minimally affected by occasional duplicates

**Mitigation strategies if exact-once is required:**
- Use `DISTINCT ON (topic, time)` in queries
- Add a post-write deduplication job (batch delete duplicates periodically)
- Move to QoS 2 (exactly-once — significantly higher overhead)

---

## Timestamp Skew

### Future Timestamps

Devices with incorrect clocks may report timestamps in the future:

```
Device clock:  2026-03-15T10:35:00Z  (5 minutes ahead)
Server clock:  2026-03-15T10:30:00Z
MaxTimestampSkew: 1 hour

Result: ACCEPTED (within 1-hour tolerance)
```

**Why 1-hour tolerance?** Industrial devices may have NTP drift, timezone misconfigurations, or DST transitions. A strict real-time check would reject valid data.

### Past Timestamps

```
Device reporting historical data:  2026-02-01T00:00:00Z  (42 days ago)
Max age: 30 days

Result: REJECTED ("timestamp too old")
```

**Why 30-day limit?** Prevents backfill attacks (flooding the database with fake historical data) and catches devices stuck on epoch timestamps (e.g., `1970-01-01`).

### Epoch Zero Timestamps

```json
{"v": 23.5, "ts": 0}
```

`ts: 0` → `1970-01-01T00:00:00Z` → 56 years in the past → **rejected** by the 30-day check.

This is a common failure mode for embedded devices that haven't synced their clocks yet.

---

## NaN and Infinity Values

### JSON NaN

JSON does not support `NaN`, `Infinity`, or `-Infinity`. These values will:

```json
// This is INVALID JSON:
{"v": NaN, "ts": 1709712000000}

// goccy/go-json will return a parse error
// → parse_errors_total incremented
// → message dropped
```

**Mitigation:** The Protocol Gateway should convert NaN/Inf to null or a sentinel quality code before publishing.

### Float Edge Cases

```json
// Very large float — accepted (PostgreSQL DOUBLE PRECISION handles it)
{"v": 1.7976931348623157e+308, "ts": 1709712000000}

// Very small float — accepted
{"v": 5e-324, "ts": 1709712000000}

// Negative zero — accepted, stored as 0.0
{"v": -0.0, "ts": 1709712000000}
```

---

## Message Ordering

### MQTT Ordering Guarantee

MQTT QoS 1 guarantees **per-publisher, per-topic** ordering. Messages from different publishers or topics may interleave.

```
Publisher A (PLC-001):  M1 → M2 → M3  (ordered within topic)
Publisher B (PLC-002):  M4 → M5 → M6  (ordered within topic)

Data Ingestion receives: M1, M4, M2, M5, M3, M6  (interleaved across topics)
```

**This is fine** — each DataPoint carries its own timestamp. The database orders by time, not by insertion order.

### Shared Subscription Rebalancing

When a pod joins/leaves the shared subscription group, EMQX may briefly deliver messages out of order during rebalancing:

```
Before: Pod A handles dev/plc-001/#
After:  Pod B handles dev/plc-001/#

During transition: Both may receive messages for plc-001
                   → brief duplicate delivery (at-least-once)
```

**Impact:** Minimal — duplicates are rare and limited to the rebalancing window (~1-2 seconds).

---

## Channel Closed During Shutdown

During graceful shutdown, there's a race between closing `pointsChan` and in-flight Paho callbacks:

```
1. shutdownFlag.Store(true)     ← handleMessage fast-rejects new points
2. subscriber.Disconnect()       ← Paho stops delivering new messages
3. sleep(100ms)                  ← Grace period for in-flight callbacks
4. close(pointsChan)             ← Channel closed
5. In-flight callback sends to closed channel → PANIC
```

**Solution:** `defer recover()` in `handleMessage()`:

```go
func (s *IngestionService) handleMessage(topic string, payload []byte, receivedAt time.Time) {
    defer func() {
        if r := recover(); r != nil {
            // Channel was closed during shutdown — safe to discard
        }
    }()
    // ... normal processing ...
}
```

The 100ms sleep (step 3) reduces the frequency of this race to near-zero, but the recover is a safety net for the rare case where a callback started before disconnect but completes after channel close.

---

## MQTT Broker Restart

### EMQX Restart (Clean)

```
1. EMQX starts shutdown
2. Sends DISCONNECT to all clients
3. onConnectionLost fires → isConnected = false
4. Paho starts auto-reconnect loop (every 5s)
5. EMQX completes restart (~10-30s)
6. Paho reconnects → onConnect → resubscribe
7. Queued messages delivered (persistent session)
```

### EMQX Restart (Unclean — Process Kill)

```
1. EMQX process killed
2. TCP connections timeout (KeepAlive × 1.5 = 45s)
3. Paho detects timeout → onConnectionLost
4. Auto-reconnect loop begins
5. EMQX restarts → Paho connects
6. If EMQX persisted sessions: queued messages delivered
7. If EMQX lost session state: messages during gap are lost
```

**EMQX persistence:** By default, EMQX stores persistent sessions in memory. For production, enable `mnesia` persistence to survive broker restarts.

---

## Database Connection Exhaustion

### Symptom

```
ERROR "Failed to write batch" err="too many clients already"
```

### Cause

All 20 pool connections are checked out:
- 8 writers × 1 connection each = 8
- 3 retry attempts in-flight = up to 3 more
- History queries = variable
- Total can exceed pool size during transient spikes

### Resolution

1. Circuit breaker opens after 5 failures → stops consuming connections
2. After 10s, half-open allows 2 test connections
3. If DB recovers, breaker closes → normal operation resumes

**Prevention:**
- Size pool to `writer_count + 4` minimum (headroom for retries + history)
- Default: 20 conns for 8 writers = ample headroom

---

## Large Metadata JSON

The `buildMetadataJSON()` function pre-allocates 128 bytes. If a DataPoint has unusually long field values:

```json
// Very long device_id → buffer grows beyond 128 bytes
{"device_id":"this-is-a-very-long-device-identifier-that-exceeds-normal-length","tag_id":"temperature"}
```

**Impact:** Go's `append()` reallocates the buffer. This is a minor GC event — not a correctness issue. The 128-byte pre-allocation covers >95% of real-world metadata.

---

## MQTT Topic with Special Characters

MQTT topics can contain UTF-8 characters, but the ingestion service stores them as plain TEXT:

```
Topic: dev/plc-001/température  (accented characters — OK)
Topic: dev/plc-001/温度          (CJK characters — OK)
Topic: dev/plc-001/tag with spaces  (spaces — technically valid MQTT, unusual)
```

All are stored as-is in the `topic` TEXT column. PostgreSQL handles UTF-8 natively.

**The 1024-char topic limit** is enforced by the parser. MQTT spec allows up to 65,535 bytes, but topics beyond 1024 chars are almost certainly malformed.

---

## Config File Not Found

If `CONFIG_PATH` points to a nonexistent file:

```
FATAL "Failed to load configuration" err="open /app/config/config.yaml: no such file or directory"
```

The service exits immediately. This is intentional — running with zero configuration would connect to `localhost:1883` and `localhost:5432`, which is never correct in production.

---

## TimescaleDB Extensions Not Installed

If TimescaleDB extension is not installed:

```
ERROR "Failed to write batch" err="relation \"metrics\" does not exist"
```

**Prerequisite:** The `init.sql` script must run before the service starts. In Docker Compose, this is handled by mounting the script to `/docker-entrypoint-initdb.d/`. In Kubernetes, use an init container or migration job.

---

*Previous: [Chapter 16 — Database Schema](database_schema.md) — Next: [Chapter 18 — Appendices](appendices.md)*

---

*Document Version: 1.0 — March 2026*
