# NEXUS Edge — Throughput Optimization Plan

Target: **1,000–5,000 tag reads/sec** end-to-end (PLC → MQTT → TimescaleDB)

---

## Current Baseline (E2E test results, 2026-03-26)

| Poll interval | Tags | MQTT msgs/s | TSDB rows/s | Notes |
|---------------|------|-------------|-------------|-------|
| 1000ms | 18 | 3.0 | 3.1 | 3 devices, baseline |
| 50ms | 18 | 45.1 | 34.4 | Stress test, 24% ingestion lag |

Extrapolated single-instance ceiling: **~500 tags/s** (limited by per-tag MQTT publishes + QoS 1 ACK waits).

---

## Changes Applied

### 1. Polling worker pool: 10 → 20

**File:** `services/protocol-gateway/internal/adapter/config/config.go`
**Env override:** `POLLING_WORKER_COUNT=20`

Each worker handles one device poll cycle concurrently. With 10 workers, a fleet of 50+ devices with >100ms read latency would saturate the pool. 20 workers doubles concurrent device capacity.

### 2. Telemetry MQTT QoS: 1 → 0

**Files:**
- `services/protocol-gateway/internal/adapter/config/config.go` (`mqtt.qos` default)
- `services/protocol-gateway/internal/adapter/mqtt/publisher.go` (DefaultConfig)

**Env override:** `MQTT_QOS=0`

QoS 1 (at-least-once) requires a PUBACK round-trip per message. At 1000+ msgs/s, this becomes the primary bottleneck — each publish blocks until the broker ACKs.

QoS 0 (fire-and-forget) eliminates the ACK wait. For telemetry data this is the right trade-off:
- Telemetry is time-series data — a missed reading is replaced by the next one milliseconds later
- EMQX and the protocol-gateway are on the same Docker network (near-zero packet loss)
- Device **status** messages remain QoS 1 + retained (hardcoded, not affected by this change)

### 3. OPC UA subscriptions (existing)

OPC UA subscription mode is already implemented in `services/protocol-gateway/internal/adapter/opcua/subscription.go`. When enabled via the device's `OPCUseSubscriptions` flag, the OPC UA server pushes data changes directly — bypassing the polling worker pool entirely.

**Default subscription config:**
- Publish interval: 1s
- Sampling interval: 500ms
- Queue size: 10 per monitored item
- Deadband: None (every change reported)

For high-tag-count OPC UA deployments, subscriptions should be the default mode. The server does the diffing and only sends changes, which dramatically reduces MQTT traffic for slowly-changing tags.

---

## Next: MQTT Batch Publishing

### Problem

Currently, each tag value is published as a separate MQTT message:

```
Topic: nexus/devices/{deviceId}/tags/{tagName}
Payload: {"v": 23.5, "u": "°C", "q": "good", "ts": 1711468800000}
```

At 5000 tags/s, that's 5000 individual MQTT publishes per second. Even with QoS 0, this creates overhead from per-message framing, topic string encoding, and TCP packet fragmentation.

### Proposed: Batch envelope per device poll cycle

After each poll cycle, bundle all tag values from that device into a single MQTT message:

```
Topic: nexus/devices/{deviceId}/batch
Payload:
{
  "ts": 1711468800000,
  "points": [
    {"tag": "temperature",     "v": 23.5,  "u": "°C",  "q": "good"},
    {"tag": "pressure",        "v": 1.013, "u": "bar", "q": "good"},
    {"tag": "holding_reg_100", "v": 4200,  "u": "",    "q": "good"},
    {"tag": "status",          "v": "running", "u": "", "q": "good"}
  ]
}
```

### Implementation

**Protocol-gateway (publisher)**

1. Add a `BatchPublish` mode to `PublishBatch()` in `publisher.go`
2. When enabled, serialize all datapoints from a poll cycle into a single JSON array payload
3. Publish to `{unsPrefix}/batch` instead of individual tag topics
4. Fall back to per-tag publishing for single-point publishes (e.g., subscription notifications)

```go
// publisher.go — new method
func (p *Publisher) PublishBatchEnvelope(ctx context.Context, deviceTopic string, dataPoints []*domain.DataPoint) error {
    envelope := BatchEnvelope{
        Timestamp: time.Now().UnixMilli(),
        Points:    make([]BatchPoint, 0, len(dataPoints)),
    }
    for _, dp := range dataPoints {
        envelope.Points = append(envelope.Points, BatchPoint{
            Tag:     dp.TagName,
            Value:   dp.Value,
            Unit:    dp.Unit,
            Quality: dp.Quality,
        })
    }
    payload, _ := json.Marshal(envelope)
    return p.publishRaw(ctx, deviceTopic+"/batch", payload, p.config.QoS, false)
}
```

**Data-ingestion (subscriber)**

1. Subscribe to `nexus/+/+/batch` in addition to existing per-tag topics
2. Add a batch deserializer that unpacks the envelope into individual datapoints
3. Feed unpacked points into the existing batcher pipeline (no changes to DB writer)

```go
// subscriber.go — batch handler
func (s *Subscriber) handleBatchMessage(msg mqtt.Message) {
    var envelope BatchEnvelope
    json.Unmarshal(msg.Payload(), &envelope)
    for _, point := range envelope.Points {
        s.batcher.Submit(domain.DataPoint{
            Topic:     extractDeviceTopic(msg.Topic()) + "/" + point.Tag,
            Value:     point.Value,
            Timestamp: time.UnixMilli(envelope.Timestamp),
            // ...
        })
    }
}
```

### Impact estimate

| Scenario | Messages/s | Payload overhead |
|----------|-----------|-----------------|
| Per-tag (current) | 5,000 | ~1MB/s (200B × 5000) |
| Batch (10 tags/device, 500 devices) | 500 | ~400KB/s (shared headers) |

10x reduction in MQTT message count. TCP packet utilization improves significantly since batches fill packets instead of sending many small ones.

### Migration path

1. Add `MQTT_BATCH_PUBLISH=true` env var (default: false)
2. Data-ingestion subscribes to both `nexus/+/+/batch` and legacy per-tag topics
3. Flip the flag per protocol-gateway instance — zero downtime, no coordination needed
4. Once validated, make batch the default

---

## Throughput Targets by Configuration

| Config | Expected tags/s | Changes needed |
|--------|----------------|----------------|
| **Current defaults** (QoS 0, 20 workers) | ~500-1,000 | None — already applied |
| **+ OPC UA subscriptions** | ~1,000-2,000 | Enable `OPCUseSubscriptions` per device |
| **+ MQTT batch publishing** | ~2,000-5,000 | Implement batch envelope (protocol-gateway + data-ingestion) |
| **+ Horizontal scale** (2 PG instances) | ~5,000-10,000 | Deploy second protocol-gateway, partition devices |

### Other tuning knobs

| Setting | Default | Tuned | Env var |
|---------|---------|-------|---------|
| Polling workers | 30 | 50+ for large fleets | `POLLING_WORKER_COUNT` |
| OPC UA max in-flight | 1000 | 3000+ | `OPCUA_MAX_INFLIGHT` |
| Data-ingestion writers | 8 | 12-16 | `INGESTION_WRITER_COUNT` |
| DB batch size | 10,000 | 20,000 | `INGESTION_BATCH_SIZE` |
| DB pool size | 20 | 30-40 | `INGESTION_DB_POOL_SIZE` |
| DB COPY protocol | false | true | `INGESTION_USE_COPY` |
