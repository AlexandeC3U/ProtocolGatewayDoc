# Chapter 5 — Domain Model

> Core entities, validation rules, quality code mapping, and object pooling.

---

## Entity Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       DOMAIN ENTITIES                               │
│                                                                     │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────────────┐  │
│  │ MQTTPayload │      │  DataPoint  │      │       Batch         │  │
│  │  (wire fmt) │─────>│  (internal) │─────>│  (write unit)       │  │
│  │             │parse │             │accum │                     │  │
│  │ v, q, ts,   │      │ Topic,Value,│      │ Points []*DataPoint │  │
│  │ source_ts,  │      │ Quality,    │      │ CreatedAt time.Time │  │
│  │ device_id,  │      │ Timestamp,  │      │                     │  │
│  │ tag_id      │      │ DeviceID,...│      │ Size() int          │  │
│  └─────────────┘      └─────────────┘      └─────────────────────┘  │
│                                                                     │
│  ┌─────────────────────┐      ┌─────────────────────────────────┐   │
│  │   dataPointPool     │      │         batchPool               │   │
│  │   (sync.Pool)       │      │         (sync.Pool)             │   │
│  │                     │      │                                 │   │
│  │ AcquireDataPoint()  │      │ AcquireBatch()                  │   │
│  │ ReleaseDataPoint()  │      │ AcquireBatchWithCap(capacity)   │   │
│  └─────────────────────┘      │ ReleaseBatch()                  │   │
│                               └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## DataPoint

The internal representation of a single measurement. Acquired from `sync.Pool`, never allocated directly.

```go
type DataPoint struct {
    Topic           string      // MQTT topic received on (e.g., "dev/plc-001/temperature")
    DeviceID        string      // Source device identifier
    TagID           string      // Specific tag/measurement identifier
    Value           *float64    // Numeric value (nil if string value)
    ValueStr        *string     // String value (nil if numeric value)
    Quality         int16       // OPC UA quality code (192=good, 0=bad, 64=uncertain)
    Unit            string      // Engineering unit (e.g., "°C", "bar", "RPM")
    Timestamp       time.Time   // When measurement was taken (from device or gateway)
    SourceTimestamp *time.Time  // Device's own timestamp (optional)
    ServerTimestamp *time.Time  // Gateway's timestamp (optional)
    ReceivedAt      time.Time   // When this service received the MQTT message
}
```

**Invariants:**

- At least one of `Value` or `ValueStr` is non-nil (enforced by parsing)
- `Timestamp` is always set (derived from `ts` in payload)
- `ReceivedAt` is always set (captured at MQTT callback entry)
- `Quality` defaults to 192 (Good) if not specified

---

## MQTTPayload (Wire Format)

The compact JSON format published by the Protocol Gateway:

```go
type MQTTPayload struct {
    Value           interface{} `json:"v"`               // float64, string, or bool
    Quality         string      `json:"q"`               // "good", "bad", "uncertain", etc.
    Unit            string      `json:"u,omitempty"`     // Engineering unit
    Timestamp       int64       `json:"ts"`              // Unix milliseconds
    SourceTimestamp int64       `json:"source_ts,omitempty"` // Device timestamp (unix ms)
    DeviceID        string      `json:"device_id,omitempty"`
    TagID           string      `json:"tag_id,omitempty"`
}
```

**Example messages:**

```json
// Numeric value (most common)
{"v": 23.5, "q": "good", "u": "°C", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "temperature"}

// String value (e.g., device state)
{"v": "RUNNING", "q": "good", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "state"}

// Boolean value (converted to 0.0/1.0)
{"v": true, "q": "good", "ts": 1709712000000, "device_id": "plc-001", "tag_id": "alarm_active"}

// Minimal (only required fields)
{"v": 42, "ts": 1709712000000}
```

---

## Quality Code Mapping

Quality strings from the Protocol Gateway are mapped to OPC UA-compatible numeric codes:

| Wire String        | Quality Code | OPC UA Meaning              | Category  |
| ------------------ | ------------ | --------------------------- | --------- |
| `"good"`           | 192 (0xC0)   | Good                        | Good      |
| `"uncertain"`      | 64 (0x40)    | Uncertain                   | Uncertain |
| `"bad"`            | 0            | Bad                         | Bad       |
| `"not_connected"`  | 0            | Bad (device unreachable)    | Bad       |
| `"config_error"`   | 0            | Bad (misconfiguration)      | Bad       |
| `"device_failure"` | 0            | Bad (device malfunction)    | Bad       |
| `"timeout"`        | 0            | Bad (communication timeout) | Bad       |
| (unknown/default)  | 192 (0xC0)   | Good (assume healthy)       | Good      |

**Design note:** The default-to-Good behavior is intentional. Many simple protocols (Modbus, S7) don't have quality concepts — absence of a quality string means the read succeeded.

---

## Validation Rules

`ParsePayload()` enforces these constraints before a DataPoint enters the pipeline:

### Pre-Acquisition Guards (Before sync.Pool Acquire)

| Check        | Threshold      | Error                 |
| ------------ | -------------- | --------------------- |
| Payload size | ≤ 65,536 bytes | `"payload too large"` |
| Topic length | ≤ 1,024 chars  | `"topic too long"`    |

### Post-Acquisition Guards (After JSON Parse)

| Check               | Threshold       | Error                           |
| ------------------- | --------------- | ------------------------------- |
| Value presence      | v ≠ nil         | `"missing value"`               |
| String value length | ≤ 4,096 chars   | `"value string too long"`       |
| Timestamp future    | ≤ now + 1 hour  | `"timestamp too far in future"` |
| Timestamp past      | ≥ now - 30 days | `"timestamp too old"`           |

**On validation failure after pool acquisition:** The DataPoint is released back to the pool before returning the error. This prevents pool leaks.

### Value Type Coercion

```
JSON value          → DataPoint field
─────────────────── → ──────────────────
float64 (42.5)      → Value = &42.5
string ("RUNNING")  → ValueStr = &"RUNNING"
bool (true)         → Value = &1.0
bool (false)        → Value = &0.0
other               → error("unsupported value type")
```

---

## Batch

A collection of DataPoints that forms the unit of database write:

```go
type Batch struct {
    Points    []*DataPoint
    CreatedAt time.Time
}

func (b *Batch) Size() int { return len(b.Points) }
```

**Default capacity:** 5,000 (via `DefaultBatchCapacity` constant). The actual capacity used by the batcher matches `BatchSize` from config (default: 10,000).

---

## Object Pooling

### DataPoint Pool

```go
var dataPointPool = sync.Pool{
    New: func() interface{} { return &DataPoint{} },
}

func AcquireDataPoint() *DataPoint  // Get from pool
func ReleaseDataPoint(dp *DataPoint) // Clear all fields, return to pool
```

**ReleaseDataPoint zeroes every field** — Topic, DeviceID, TagID set to `""`, Value/ValueStr set to nil, timestamps set to zero value. This prevents stale data from leaking between reuse cycles.

### Batch Pool

```go
var batchPool = sync.Pool{
    New: func() interface{} {
        return &Batch{Points: make([]*DataPoint, 0, DefaultBatchCapacity)}
    },
}

func AcquireBatch() *Batch                   // Default capacity (5,000)
func AcquireBatchWithCap(capacity int) *Batch // Specified capacity
func ReleaseBatch(b *Batch)                   // Release all DataPoints, return batch
```

**ReleaseBatch cascade:** When a batch is released, it iterates all contained DataPoints and releases each one back to the DataPoint pool. The batch's `Points` slice is then reset to length 0 (retaining capacity) and the batch is returned to its pool.

```
ReleaseBatch(batch)
    │
    ├── for each dp in batch.Points:
    │       ReleaseDataPoint(dp)  ──→  back to dataPointPool
    │
    ├── batch.Points = batch.Points[:0]   (keep capacity)
    ├── batch.CreatedAt = time.Time{}     (zero)
    │
    └── batchPool.Put(batch)  ──→  back to batchPool
```

### Pool Lifecycle

```
Parse          Accumulate       Write          Release
─────          ──────────       ─────          ───────

Acquire() ──→  addToBatch() ──→ WriteBatch() ──→ ReleaseBatch()
   │               │                │                │
   │          append to         COPY to DB      release all
   │          currentBatch                      DataPoints
   │                                            back to pool
   └─── from dataPointPool              ───────→ to dataPointPool
```

---

## Constants

```go
const (
    MaxTopicLength       = 1024         // Maximum MQTT topic length (chars)
    MaxPayloadSize       = 65536        // Maximum payload size (64 KB)
    MaxValueStrLen       = 4096         // Maximum string value length
    MaxTimestampSkew     = 1 * time.Hour // Maximum future timestamp offset
    DefaultBatchCapacity = 5000         // Default batch slice capacity
)
```

---

_Previous: [Chapter 4 — Layer Architecture](layer_architecture.md) — Next: [Chapter 6 — Pipeline Architecture](pipeline_architecture.md)_

---

_Document Version: 1.0 — March 2026_
