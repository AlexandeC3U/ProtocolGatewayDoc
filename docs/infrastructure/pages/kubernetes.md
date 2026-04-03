# Chapter 4 — Kubernetes

> Namespace layout, Kustomize structure, StatefulSet vs Deployment rationale,
> overlays for dev/prod, and deployment procedures.

---

## Kustomize Structure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    KUSTOMIZE LAYOUT                                             │
│                                                                                 │
│  k8s/                                                                           │
│  ├── base/                          ← Shared across all environments            │
│  │   ├── kustomization.yaml         ← Lists all base resources                  │
│  │   ├── namespace.yaml             ← nexus namespace                           │
│  │   ├── configmap.yaml             ← Non-secret config (MQTT URLs, etc.)       │
│  │   ├── secrets.yaml               ← Dev-default secrets (base64)              │
│  │   ├── network-policies.yaml      ← Least-privilege access rules              │
│  │   ├── resource-controls.yaml     ← ResourceQuota + LimitRange                │
│  │   └── servicemonitors.yaml       ← Prometheus ServiceMonitors                │
│  │                                                                              │
│  ├── services/                      ← Per-service manifests                     │
│  │   ├── emqx/                      ← StatefulSet + headless service            │
│  │   ├── timescaledb/               ← StatefulSet + init ConfigMap + exporter   │
│  │   ├── postgres/                  ← StatefulSet + service                     │
│  │   ├── gateway-core/              ← Deployment + service                      │
│  │   ├── protocol-gateway/          ← StatefulSet + devices ConfigMap           │
│  │   ├── data-ingestion/            ← Deployment + HPA + PDB                    │
│  │   └── authentik/                 ← Server + worker + DB + secrets            │
│  │                                                                              │
│  └── overlays/                      ← Environment-specific patches              │
│      ├── dev/kustomization.yaml     ← Low resources, 1 replica                  │
│      └── prod/                                                                  │
│          ├── kustomization.yaml     ← HA, high resources, auth enabled          │
│          ├── external-secrets.yaml  ← External Secrets Operator integration     │
│          └── secrets-patch.yaml     ← Manual secret override                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## StatefulSet vs Deployment Decision

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    WORKLOAD TYPE RATIONALE                                      │
│                                                                                 │
│  Service              Type          Why                                         │
│  ──────────────────── ───────────── ────────────────────────────────────────    │
│  EMQX                 StatefulSet   Erlang clustering needs stable pod names    │
│                                     (emqx-0, emqx-1, emqx-2)                    │
│                                                                                 │
│  TimescaleDB          StatefulSet   Persistent data, single writer,             │
│                                     stable network identity                     │
│                                                                                 │
│  PostgreSQL           StatefulSet   Persistent data, single writer              │
│                                                                                 │
│  Protocol Gateway     StatefulSet   Long-lived PLC connections, PKI store,      │
│                                     can't have duplicate device connections     │
│                                                                                 │
│  Gateway Core         Deployment    Mostly stateless (MQTT session is only      │
│                                     state, single replica anyway)               │
│                                                                                 │
│  Data Ingestion       Deployment    Fully stateless, scales via shared subs,    │
│                                     HPA support                                 │
│                                                                                 │
│  Web UI               Deployment    Static files served by Nginx, stateless     │
│                                                                                 │
│  Authentik            Deployment    API server is stateless, DB is separate     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Resource Controls

### ResourceQuota (Namespace-Level)

| Resource        | Limit    | Purpose                                        |
| --------------- | -------- | ---------------------------------------------- |
| CPU requests    | 20 cores | Prevent namespace from over-committing cluster |
| CPU limits      | 40 cores | Hard cap                                       |
| Memory requests | 40Gi     |                                                |
| Memory limits   | 80Gi     |                                                |
| Pods            | 50       | Prevent runaway scaling                        |
| Services        | 20       |                                                |
| PVCs            | 20       |                                                |
| Storage         | 500Gi    | Total PVC storage                              |

### LimitRange (Per-Container Defaults)

| Setting                | Value | Purpose                              |
| ---------------------- | ----- | ------------------------------------ |
| Default CPU request    | 100m  | Containers without explicit requests |
| Default CPU limit      | 500m  |                                      |
| Default memory request | 128Mi |                                      |
| Default memory limit   | 512Mi |                                      |
| Min CPU                | 50m   | Floor for any container              |
| Min memory             | 64Mi  |                                      |
| Max CPU                | 4000m | Ceiling for any container            |
| Max memory             | 8Gi   |                                      |
| Max pod CPU            | 8000m | Total per pod                        |
| Max pod memory         | 16Gi  |                                      |
| Min PVC                | 1Gi   |                                      |
| Max PVC                | 200Gi |                                      |

---

## Service Resource Allocation

### Development Overlay

| Service          | CPU Request | CPU Limit | Memory Request | Memory Limit | Replicas |
| ---------------- | ----------- | --------- | -------------- | ------------ | -------- |
| EMQX             | 250m        | 1000m     | 512Mi          | 2Gi          | 1        |
| TimescaleDB      | 250m        | 2000m     | 1Gi            | 4Gi          | 1        |
| PostgreSQL       | 100m        | 500m      | 256Mi          | 512Mi        | 1        |
| Gateway Core     | 100m        | 500m      | 128Mi          | 512Mi        | 1        |
| Protocol Gateway | 100m        | 500m      | 128Mi          | 512Mi        | 1        |
| Data Ingestion   | 100m        | 500m      | 128Mi          | 512Mi        | 1        |

### Production Overlay

| Service          | CPU Request | CPU Limit | Memory Request | Memory Limit | Replicas  |
| ---------------- | ----------- | --------- | -------------- | ------------ | --------- |
| EMQX             | 500m        | 2000m     | 1Gi            | 4Gi          | 3         |
| TimescaleDB      | 500m        | 4000m     | 2Gi            | 8Gi          | 1         |
| PostgreSQL       | 250m        | 1000m     | 512Mi          | 1Gi          | 1         |
| Gateway Core     | 100m        | 500m      | 128Mi          | 512Mi        | 1         |
| Protocol Gateway | 500m        | 2000m     | 512Mi          | 2Gi          | 3         |
| Data Ingestion   | 500m        | 2000m     | 512Mi          | 2Gi          | 2-8 (HPA) |

---

## Horizontal Pod Autoscaler (Data Ingestion)

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

Data Ingestion is the **only service with HPA** because it is the only fully
stateless, horizontally scalable service. EMQX shared subscriptions automatically
rebalance messages when pods are added/removed.

---

## Pod Disruption Budgets

| Service          | minAvailable | Purpose                                     |
| ---------------- | ------------ | ------------------------------------------- |
| EMQX             | 2 (of 3)     | Maintain MQTT quorum during rolling updates |
| Protocol Gateway | 1            | Always have at least one device poller      |
| Data Ingestion   | 1            | Always have at least one ingestion worker   |
| Gateway Core     | 1            | Always have API available                   |

---

## Init Containers

Several services use init containers to wait for dependencies:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    INIT CONTAINER PATTERNS                                      │
│                                                                                 │
│  Gateway Core:                                                                  │
│  ├── wait-for-postgres:  nc -z postgres 5432 (busybox)                          │
│  └── wait-for-emqx:     nc -z emqx 1883 (busybox)                               │
│                                                                                 │
│  Data Ingestion:                                                                │
│  ├── wait-for-emqx:     nc -z emqx 1883 (busybox)                               │
│  └── wait-for-tsdb:     nc -z timescaledb 5432 (busybox)                        │
│                                                                                 │
│  TimescaleDB:                                                                   │
│  ├── init-permissions:   chown -R 999:999 /var/lib/postgresql/data              │
│  └── init-scripts:       cp + chmod init.sql (make executable)                  │
│                                                                                 │
│  These replace Docker Compose depends_on with health checks.                    │
│  The busybox image is ~1MB and retries every 2 seconds.                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Storage (PersistentVolumeClaims)

### Development

| PVC              | Service          | Size  | Access Mode   |
| ---------------- | ---------------- | ----- | ------------- |
| timescaledb-data | TimescaleDB      | 5Gi   | ReadWriteOnce |
| postgres-data    | PostgreSQL       | 1Gi   | ReadWriteOnce |
| emqx-data        | EMQX             | 2Gi   | ReadWriteOnce |
| emqx-log         | EMQX             | 1Gi   | ReadWriteOnce |
| pki-store        | Protocol Gateway | 100Mi | ReadWriteOnce |

### Production

| PVC              | Service          | Size  | Access Mode   |
| ---------------- | ---------------- | ----- | ------------- |
| timescaledb-data | TimescaleDB      | 500Gi | ReadWriteOnce |
| postgres-data    | PostgreSQL       | 20Gi  | ReadWriteOnce |
| emqx-data        | EMQX             | 20Gi  | ReadWriteOnce |
| emqx-log         | EMQX             | 10Gi  | ReadWriteOnce |
| pki-store        | Protocol Gateway | 100Mi | ReadWriteOnce |

---

## Deployment Commands

```bash
# Development (K3s single-node)
kubectl apply -k infrastructure/k8s/overlays/dev

# Production (multi-node)
kubectl apply -k infrastructure/k8s/overlays/prod

# Check status
kubectl get pods -n nexus
kubectl get svc -n nexus

# View logs
kubectl logs -n nexus deployment/gateway-core -f
kubectl logs -n nexus statefulset/emqx -f

# Port-forward for debugging
kubectl port-forward -n nexus svc/emqx 18083:18083
kubectl port-forward -n nexus svc/timescaledb 5432:5432

# Scale data-ingestion
kubectl scale -n nexus deployment/data-ingestion --replicas=4

# Rolling restart
kubectl rollout restart -n nexus deployment/gateway-core
```

---

## Related Documentation

- [Docker Compose](docker_compose.md) — Docker Compose deployment
- [Security Hardening](security_hardening.md) — network policies, secrets
- [Scaling Playbook](scaling_playbook.md) — capacity planning

---

_Document Version: 1.0_
_Last Updated: March 2026_
