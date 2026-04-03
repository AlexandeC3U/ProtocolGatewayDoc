# Chapter 11 — Scaling Architecture

> Shared subscriptions, capacity planning, multi-instance coordination, and HPA configuration.

---

## Scaling Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HORIZONTAL SCALING VIA SHARED SUBSCRIPTIONS              │
│                                                                             │
│                          EMQX Broker                                        │
│                    $share/ingestion/dev/#                                   │
│                    $share/ingestion/uns/#                                   │
│                              │                                              │
│              ┌───────────────┼───────────────┐                              │
│              │               │               │                              │
│              ▼               ▼               ▼                              │
│       ┌────────────┐  ┌────────────┐  ┌────────────┐                        │
│       │  Pod 1     │  │  Pod 2     │  │  Pod 3     │                        │
│       │  Client:   │  │  Client:   │  │  Client:   │                        │
│       │  data-     │  │  data-     │  │  data-     │                        │
│       │  ingestion │  │  ingestion │  │  ingestion │                        │
│       │  -abc123   │  │  -def456   │  │  -ghi789   │                        │
│       │            │  │            │  │            │                        │
│       │  Msgs:     │  │  Msgs:     │  │  Msgs:     │                        │
│       │  A, D, G   │  │  B, E, H   │  │  C, F, I   │                        │
│       └─────┬──────┘  └─────┬──────┘  └─────┬──────┘                        │
│             │               │               │                               │
│             └───────────────┼───────────────┘                               │
│                             │                                               │
│                             ▼                                               │
│                      ┌────────────┐                                         │
│                      │ TimescaleDB│                                         │
│                      │  (shared)  │                                         │
│                      └────────────┘                                         │
│                                                                             │
│  Each message delivered to exactly ONE pod — no duplicates!                 │
│  No inter-pod coordination needed — each pod is fully independent.          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## How Shared Subscriptions Work

EMQX shared subscriptions distribute messages across a subscriber group:

```
Topic: $share/ingestion/dev/#
       │      │          │
       │      │          └── Wildcard match: all under dev/
       │      └──────────── Group name: "ingestion"
       └──────────────────── Shared subscription prefix

Protocol Gateway publishes:
  dev/plc-001/temp  →  Pod 1 receives
  dev/plc-001/press →  Pod 2 receives
  dev/plc-002/temp  →  Pod 3 receives
  dev/plc-002/press →  Pod 1 receives  (round-robin continues)
```

**Key properties:**

- Each message is delivered to **exactly one** subscriber in the group
- EMQX load-balances across the group (default: round-robin)
- Adding/removing pods is transparent — EMQX rebalances automatically
- No coordination protocol between pods (no leader election, no partition assignment)

### Why Not Regular Subscriptions?

| Approach                | Behavior                         | Result                        |
| ----------------------- | -------------------------------- | ----------------------------- |
| Regular `dev/#`         | Every pod receives every message | N× duplicate writes to DB     |
| Shared `$share/g/dev/#` | Each message to exactly one pod  | No duplicates, linear scaling |

---

## Zero-Coordination Design

Each pod is completely independent:

```
┌──────────────────────────────────────────────────────────┐
│                 POD INDEPENDENCE                         │
│                                                          │
│  Each pod independently:                                 │
│  ├── Connects to EMQX with unique client ID              │
│  ├── Subscribes to shared subscription group             │
│  ├── Parses messages                                     │
│  ├── Batches and writes to TimescaleDB                   │
│  ├── Exposes /metrics for its own throughput             │
│  └── Reports /health for its own connectivity            │
│                                                          │
│  No pod knows about other pods.                          │
│  No distributed locking.                                 │
│  No leader election.                                     │
│  No partition assignment.                                │
│  No consensus protocol.                                  │
│                                                          │
│  EMQX is the only coordinator (transparent to the pods). │
└──────────────────────────────────────────────────────────┘
```

**Client ID uniqueness:** Each pod uses `data-ingestion-{hostname}` as its MQTT client ID. In Kubernetes, hostname equals the pod name (e.g., `data-ingestion-abc123`), guaranteeing uniqueness.

---

## Capacity Planning

### Per-Instance Throughput

A single instance handles ~35-50k msg/s with default configuration:

| Configuration | Buffer  | Batch  | Writers | Throughput    |
| ------------- | ------- | ------ | ------- | ------------- |
| Conservative  | 50,000  | 5,000  | 4       | ~25-35k msg/s |
| Default       | 200,000 | 10,000 | 8       | ~35-50k msg/s |
| Aggressive    | 500,000 | 20,000 | 12      | ~50-80k msg/s |

### Scaling Table

| Target Throughput | Pods | Configuration | Notes                             |
| ----------------- | ---- | ------------- | --------------------------------- |
| 0 – 50k msg/s     | 1    | Default       | Single instance with headroom     |
| 50k – 100k msg/s  | 2    | Default       | Shared subscriptions load-balance |
| 100k – 200k msg/s | 3-4  | Default       | Linear scaling                    |
| 200k – 400k msg/s | 4-8  | Aggressive    | Tune batch/writer for higher rate |
| 400k+ msg/s       | 8+   | Custom        | May need TimescaleDB tuning too   |

### Bottleneck Analysis

```
                                    Single Pod Bottlenecks:
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  MQTT → Parse:      ~100k msg/s (CPU-bound, single-threaded    │
│                      JSON parse per callback)                  │
│                                                                │
│  Parse → Buffer:    ~500k msg/s (channel send, minimal work)   │
│                                                                │
│  Buffer → Batch:    ~200k msg/s (single accumulator, mutex)    │
│                                                                │
│  Batch → DB:        ~50-80k msg/s (8 writers × 10k batch ×     │
│                      10ms per COPY = ~80k/s theoretical)       │
│                                                                │
│  Practical limit:   ~35-50k msg/s (DB I/O is the bottleneck)   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**The database is almost always the bottleneck.** Scaling horizontally adds more write capacity, but TimescaleDB itself must handle the aggregate write load. At very high scale (>200k msg/s), the database may need tuning (larger shared_buffers, more connections, separate disk for WAL).

---

## Kubernetes HPA Configuration

### Scaling on Ingestion-Specific Metrics

The recommended HPA scales on buffer usage and drop rate — both lead CPU by seconds:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: data-ingestion
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: data-ingestion
  minReplicas: 2
  maxReplicas: 8
  metrics:
    # Primary: buffer usage (leads CPU by seconds)
    - type: Pods
      pods:
        metric:
          name: data_ingestion_buffer_usage
        target:
          type: AverageValue
          averageValue: '0.6' # Scale up at 60% buffer

    # Secondary: active data loss (emergency scaling)
    - type: Pods
      pods:
        metric:
          name: data_ingestion_points_dropped_rate
        target:
          type: AverageValue
          averageValue: '0' # Any drops → scale up

    # Fallback: CPU (if custom metrics unavailable)
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          targetAverageUtilization: 75

  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300 # 5 min cooldown
      policies:
        - type: Pods
          value: 1 # Remove 1 pod at a time
          periodSeconds: 120 # Every 2 min
    scaleUp:
      stabilizationWindowSeconds: 30 # Quick scale up
      policies:
        - type: Pods
          value: 2 # Add up to 2 pods at once
          periodSeconds: 60
```

### Scale-Down Caution

Conservative scale-down prevents flapping:

- **300s stabilization** — must be below threshold for 5 minutes
- **1 pod at a time** — gradual reduction
- **120s between removals** — gives time for load to redistribute

**Why conservative?** IIoT workloads are bursty. A shift change, batch process start, or device coming online can spike throughput instantly. Aggressive scale-down would cause immediate scale-up, wasting resources on pod startup/shutdown.

---

## Pod Restart Behavior

When a pod is terminated (scale-down, rolling update, node drain):

```
Pod receives SIGTERM
        │
        ▼
Graceful shutdown (up to 30s)
  ├── Flush in-flight data to DB
  ├── MQTT disconnect (EMQX preserves session)
  └── Process exits
        │
        ▼
EMQX detects disconnect
  ├── Redistributes the pod's share of messages to remaining pods
  └── If clean_session=false: queues unacknowledged messages
        │
        ▼
Remaining pods absorb the load
  ├── Temporary ~33% increase (for 3→2 pod scale-down)
  └── Buffer absorbs the burst
```

**No data loss** during scale-down if:

1. Graceful shutdown completes (in-flight data flushed)
2. Remaining pods have capacity to absorb the redistributed load

---

_Previous: [Chapter 10 — Observability](observability.md) — Next: [Chapter 12 — Deployment](deployment.md)_

---

_Document Version: 1.0 — March 2026_
