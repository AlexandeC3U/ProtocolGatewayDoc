# Chapter 14 — Scaling Playbook

> Capacity planning, horizontal and vertical scaling strategies, HPA configuration,
> EMQX cluster sizing, storage growth projections, and scaling decision matrix.

---

## Capacity Planning

### Baseline Resource Requirements

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    RESOURCE SIZING BY SCALE                                     │
│                                                                                 │
│  Scale        Devices   Tags    Msgs/sec   CPU (total)  Memory    Storage       │
│  ──────────── ──────── ──────── ─────────  ───────────  ────────  ──────────    │
│  Small        10       500      500        2 cores      4 GB      20 GB         │
│  Medium       50       5,000    5,000      4 cores      8 GB      100 GB        │
│  Large        200      20,000   20,000     8 cores      16 GB     500 GB        │
│  Enterprise   500+     50,000+  50,000+    16+ cores    32+ GB    1+ TB         │
│                                                                                 │
│  These are approximate totals across all services.                              │
│  Storage assumes 30-day raw retention with compression.                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Storage Growth Projections

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STORAGE CALCULATION                                          │
│                                                                                 │
│  Formula: storage_per_day = tags × polls_per_day × bytes_per_row                │
│                                                                                 │
│  Raw row size: ~120 bytes (time + topic + value + quality + overhead)           │
│  Compressed: ~12 bytes (90% reduction after 7 days)                             │
│                                                                                 │
│  Example: 1,000 tags at 1-second polling                                        │
│  ────────────────────────────────────────                                       │
│  Raw/day:  1,000 × 86,400 × 120 bytes = ~10 GB/day                              │
│  After compression (7+ days old): ~1 GB/day                                     │
│  30-day storage: 7×10 + 23×1 = ~93 GB                                           │
│  1-year (with aggregates): ~400 GB                                              │
│                                                                                 │
│  Tags    Poll Rate   Raw/Day   Compressed/Day   30-Day Total                    │
│  ──────  ─────────── ─────────  ──────────────── ────────────                   │
│  100     1s          1.0 GB     100 MB           ~10 GB                         │
│  500     1s          5.0 GB     500 MB           ~47 GB                         │
│  1,000   1s          10 GB      1.0 GB           ~93 GB                         │
│  5,000   1s          50 GB      5.0 GB           ~465 GB                        │
│  10,000  1s          100 GB     10 GB             ~930 GB                       │
│  1,000   5s          2.0 GB     200 MB           ~19 GB                         │
│  1,000   10s         1.0 GB     100 MB           ~10 GB                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Scaling Decision Matrix

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    WHEN TO SCALE WHAT                                           │
│                                                                                 │
│  Symptom                          Scale This            How                     │
│  ─────────────────────────────── ───────────────────── ──────────────────────── │
│  ingestion_buffer_size > 80%     Data Ingestion         Add replicas (HPA)      │
│  DB write latency > 500ms        TimescaleDB            Vertical (CPU/RAM)      │
│  MQTT message queue growing      EMQX                   Add cluster nodes       │
│  API P99 > 2s                    Gateway Core           Vertical first          │
│  Protocol poll cycle drift       Protocol Gateway       Add replicas            │
│  TimescaleDB PVC > 80%           Storage                Expand PVC              │
│  Prometheus PVC > 80%            Storage                Increase retention      │
│                                                                                 │
│  Decision tree:                                                                 │
│  1. Is it Data Ingestion? → Scale horizontally (HPA, shared subs)               │
│  2. Is it a database? → Scale vertically (more CPU/RAM)                         │
│  3. Is it EMQX? → Add cluster nodes (StatefulSet replicas)                      │
│  4. Is it Protocol Gateway? → Add replicas (careful: device affinity)           │
│  5. Is it Gateway Core? → Usually a DB bottleneck, scale DB first               │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Horizontal Scaling

### Data Ingestion (HPA)

Data Ingestion is the primary horizontally-scalable service. EMQX shared
subscriptions automatically distribute messages across replicas.

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: data-ingestion
  namespace: nexus
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: data-ingestion
  minReplicas: 2
  maxReplicas: 8
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DATA INGESTION SCALING                                       │
│                                                                                 │
│  EMQX Topic: dev/#                                                              │
│  Shared sub:  $share/ingestion/dev/#                                            │
│                                                                                 │
│  1 pod:   100% messages → 1 writer  → ~200K rows/sec                            │
│  2 pods:  50% each      → 2 writers → ~400K rows/sec                            │
│  4 pods:  25% each      → 4 writers → ~800K rows/sec                            │
│  8 pods:  12.5% each    → 8 writers → ~1.6M rows/sec (theoretical)              │
│                                                                                 │
│  Bottleneck shifts to TimescaleDB at ~4-8 pods.                                 │
│  Scale TimescaleDB vertically if write latency increases.                       │
│                                                                                 │
│  Manual scaling (Docker):                                                       │
│  docker compose up -d --scale nexus-data-ingestion=4                            │
│                                                                                 │
│  Manual scaling (K8s):                                                          │
│  kubectl scale -n nexus deployment/data-ingestion --replicas=4                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### EMQX Cluster Scaling

```bash
# K8s: increase StatefulSet replicas
kubectl scale -n nexus statefulset/emqx --replicas=5

# EMQX auto-discovers new nodes via DNS SRV records
# Shared subscriptions rebalance automatically
```

| Cluster Size | Connections | Messages/sec | Use Case                 |
| :----------: | :---------: | :----------: | ------------------------ |
|    1 node    |   10,000    |    50,000    | Development, small sites |
|   3 nodes    |   100,000   |   200,000    | Production, medium sites |
|   5 nodes    |   500,000   |   500,000    | Large enterprise         |

### Protocol Gateway Scaling

Protocol Gateway uses a StatefulSet for stable pod identities. When scaling,
ensure device-to-pod affinity is managed:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PROTOCOL GATEWAY SCALING CONSTRAINTS                         │
│                                                                                 │
│  • Each device must connect to exactly ONE Protocol Gateway pod                 │
│  • Duplicate connections cause data duplication and device confusion            │
│  • Gateway Core distributes device configs via MQTT                             │
│  • Pods claim devices based on partition assignment                             │
│                                                                                 │
│  Scaling up:                                                                    │
│  1. Increase StatefulSet replicas                                               │
│  2. Gateway Core re-distributes device config partitions                        │
│  3. New pod picks up assigned devices                                           │
│  4. Existing pods release reassigned devices                                    │
│                                                                                 │
│  Scaling down:                                                                  │
│  1. Decrease StatefulSet replicas                                               │
│  2. Removed pod's devices redistributed to remaining pods                       │
│  3. Brief disconnect while devices are re-acquired                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Vertical Scaling

### TimescaleDB

The most common bottleneck at scale. Increase resources for write-heavy loads:

| Scale      | CPU   | Memory | shared_buffers | effective_cache_size | work_mem |
| ---------- | ----- | ------ | -------------- | -------------------- | -------- |
| Small      | 500m  | 2Gi    | 512MB          | 1.5GB                | 32MB     |
| Medium     | 2000m | 8Gi    | 2GB            | 6GB                  | 64MB     |
| Large      | 4000m | 16Gi   | 4GB            | 12GB                 | 128MB    |
| Enterprise | 8000m | 32Gi   | 8GB            | 24GB                 | 256MB    |

### PostgreSQL Config DB

Rarely needs scaling — config data is small. Default allocation (500m / 1Gi)
handles thousands of devices.

### Gateway Core

| Bottleneck     | Indicator                   | Action                                  |
| -------------- | --------------------------- | --------------------------------------- |
| CPU            | High event loop utilization | Increase CPU limit                      |
| Memory         | V8 heap approaching limit   | Increase memory limit                   |
| DB connections | Connection pool exhaustion  | Increase pool size + DB max_connections |

---

## K8s Resource Adjustments

### Production Overlay Patch

```yaml
# overlays/prod/kustomization.yaml
patches:
  - target:
      kind: Deployment
      name: data-ingestion
    patch: |
      - op: replace
        path: /spec/template/spec/containers/0/resources
        value:
          requests:
            cpu: "500m"
            memory: "512Mi"
          limits:
            cpu: "2000m"
            memory: "2Gi"
```

### ResourceQuota Adjustments

If scaling beyond default quota limits, update the namespace ResourceQuota:

```yaml
apiVersion: v1
kind: ResourceQuota
metadata:
  name: nexus-quota
  namespace: nexus
spec:
  hard:
    requests.cpu: '40' # Increased from 20
    requests.memory: '80Gi' # Increased from 40Gi
    pods: '100' # Increased from 50
```

---

## Monitoring-Driven Scaling

### Key Metrics to Watch

| Metric                                   | Threshold       | Action                         |
| ---------------------------------------- | --------------- | ------------------------------ |
| `ingestion_buffer_size / 200000`         | > 0.8           | Scale data-ingestion           |
| `ingestion_write_duration_seconds` P99   | > 500ms         | Scale TimescaleDB vertically   |
| `emqx_connections_count`                 | > 80% of max    | Add EMQX nodes                 |
| `http_request_duration_seconds` P99      | > 2s            | Check DB, scale gateway-core   |
| `protocol_gateway_poll_duration_seconds` | > poll_interval | Scale protocol-gateway         |
| TimescaleDB PVC usage                    | > 80%           | Expand PVC or reduce retention |

### Grafana Alert for Auto-Scaling Feedback

```promql
# Alert when ingestion is struggling
ingestion_buffer_size > 160000  # 80% of 200K buffer
```

---

## Related Documentation

- [Kubernetes](kubernetes.md) — HPA, PDB, resource limits
- [TimescaleDB Operations](timescaledb_operations.md) — compression, retention tuning
- [EMQX Configuration](emqx_configuration.md) — cluster sizing
- [Observability Stack](observability_stack.md) — metrics for scaling decisions
- [Docker Compose](docker_compose.md) — Docker-based scaling

---

_Document Version: 1.0_
_Last Updated: March 2026_
