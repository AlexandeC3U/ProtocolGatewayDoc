# Chapter 12 — Deployment

> Dockerfile, Docker Compose, Kubernetes manifests, and resource tuning.

---

## Docker Build

### Multi-Stage Dockerfile

```dockerfile
# Stage 1: Build
FROM golang:1.22.5-alpine3.20 AS builder
RUN apk add --no-cache git ca-certificates tzdata
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s -X main.version=${VERSION}" \
    -o /build/data-ingestion ./cmd/ingestion

# Stage 2: Runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
RUN addgroup -g 1000 nexus && adduser -u 1000 -G nexus -D nexus
COPY --from=builder /build/data-ingestion /app/data-ingestion
COPY --from=builder /src/config /app/config
RUN chown -R nexus:nexus /app
USER nexus
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health/live || exit 1
ENTRYPOINT ["/app/data-ingestion"]
```

**Build flags:**

- `CGO_ENABLED=0` — Pure Go binary, no C dependencies needed at runtime
- `-w -s` — Strip debug info and symbol table (~30% smaller binary)
- `-X main.version` — Inject version at build time

**Security:**

- Non-root user (nexus:1000)
- Minimal Alpine base (no shell tools beyond wget for healthcheck)
- `ca-certificates` for TLS, `tzdata` for timezone handling

---

## Docker Compose

### Production (`docker-compose.yaml`)

```yaml
services:
  data-ingestion:
    image: nexus/data-ingestion:${VERSION:-latest}
    ports:
      - '${INGESTION_PUBLIC_PORT:-8080}:8080' # Health + History
      - '${INGESTION_METRICS_PORT:-8081}:8081' # Metrics
    environment:
      - INGESTION_MQTT_BROKER_URL=${MQTT_BROKER_URL}
      - INGESTION_DB_HOST=${DB_HOST}
      - INGESTION_DB_PASSWORD=${DB_PASSWORD}
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 128M
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=10M
    logging:
      driver: json-file
      options:
        max-size: '50m'
        max-file: '5'
    restart: unless-stopped
```

**Security hardening:**

- `no-new-privileges` — Cannot escalate via setuid binaries
- `read_only: true` — Filesystem is read-only (binary runs from memory)
- `tmpfs /tmp` — Only writable mount, capped at 10MB

### Development (`docker-compose.dev.yaml`)

Full development environment with all dependencies:

| Service            | Image                               | Port      | Purpose            |
| ------------------ | ----------------------------------- | --------- | ------------------ |
| `emqx`             | `emqx/emqx:5.3.0`                   | 1883      | MQTT broker        |
| `timescaledb`      | `timescale/timescaledb:2.17.2-pg15` | 5432      | Historian database |
| `data-ingestion`   | (built from Dockerfile)             | 8080/8081 | This service       |
| `protocol-gateway` | (built from ../protocol-gw)         | 8082      | Data source        |
| `modbus-simulator` | (simulates PLCs)                    | 5020      | Test devices       |
| `adminer`          | (DB admin UI)                       | 8084      | Database browser   |

```bash
# Start full dev environment
make dev

# Or manually
docker-compose -f docker-compose.dev.yaml up -d

# View logs
docker-compose -f docker-compose.dev.yaml logs -f data-ingestion
```

### Test (`docker-compose.test.yaml`)

Isolated test dependencies on non-standard ports:

| Service       | Port  | Purpose                       |
| ------------- | ----- | ----------------------------- |
| `emqx`        | 11883 | Test MQTT (isolated from dev) |
| `timescaledb` | 15432 | Test DB (isolated from dev)   |

```bash
# Start test environment
make test-env-up

# Run tests
make test-integration

# Clean up
make test-env-down
```

---

## Kubernetes Deployment

### Deployment Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: data-ingestion
  namespace: nexus
  labels:
    app.kubernetes.io/name: data-ingestion
    app.kubernetes.io/component: data-plane
spec:
  replicas: 2
  selector:
    matchLabels:
      app: data-ingestion
  template:
    metadata:
      labels:
        app: data-ingestion
      annotations:
        prometheus.io/scrape: 'true'
        prometheus.io/port: '8081'
        prometheus.io/path: '/metrics'
    spec:
      serviceAccountName: data-ingestion
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
      containers:
        - name: ingestion
          image: nexus/data-ingestion:latest
          ports:
            - name: health
              containerPort: 8080
            - name: metrics
              containerPort: 8081
          env:
            - name: INGESTION_MQTT_BROKER_URL
              value: 'tcp://emqx.nexus.svc.cluster.local:1883'
            - name: INGESTION_MQTT_CLIENT_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name # Pod name = unique client ID
            - name: INGESTION_DB_HOST
              value: 'timescaledb.nexus.svc.cluster.local'
            - name: INGESTION_DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: ingestion-db-credentials
                  key: password
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: '1'
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health/live
              port: health
            initialDelaySeconds: 5
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: health
            initialDelaySeconds: 10
            periodSeconds: 5
          startupProbe:
            httpGet:
              path: /health
              port: health
            failureThreshold: 30
            periodSeconds: 2
```

### Resource Tuning

| Workload | CPU Request | CPU Limit | Memory Request | Memory Limit |
| -------- | ----------- | --------- | -------------- | ------------ |
| Light    | 50m         | 500m      | 64Mi           | 256Mi        |
| Default  | 100m        | 1000m     | 128Mi          | 512Mi        |
| Heavy    | 250m        | 2000m     | 256Mi          | 1Gi          |

**Memory sizing:**

- Base: ~30MB (binary + Go runtime)
- pointsChan: ~1.6MB (200k × 8 bytes per pointer)
- Batch buffers: ~10MB (8 writers × ~1.2MB per batch)
- pgx pool: ~20MB (20 connections × ~1MB per connection buffer)
- **Total working set: ~60-80MB**
- Headroom for GC, spikes: 128Mi request, 512Mi limit

### Pod Disruption Budget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: data-ingestion
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: data-ingestion
```

Ensures at least 1 pod is always available during voluntary disruptions (node drain, rolling update).

---

## Makefile Targets

| Target                | Command                                     | Purpose                 |
| --------------------- | ------------------------------------------- | ----------------------- |
| `make build`          | `CGO_ENABLED=0 go build -o bin/...`         | Build binary            |
| `make run`            | `go build && ./bin/data-ingestion`          | Build and run           |
| `make run-race`       | `CGO_ENABLED=1 go build -race && ./bin/...` | Run with race detector  |
| `make docker-build`   | `docker build -t nexus/data-ingestion ...`  | Build Docker image      |
| `make dev`            | `docker-compose -f dev.yaml up -d`          | Full dev environment    |
| `make docker-logs`    | `docker-compose logs -f`                    | Follow container logs   |
| `make docker-health`  | `curl /health`                              | Check service health    |
| `make docker-metrics` | `curl /metrics`                             | View Prometheus metrics |

---

## Hot Reload (Development)

The `.air.toml` configuration enables automatic rebuilds on code changes:

```toml
[build]
  bin = "./tmp/main"
  cmd = "go build -o ./tmp/main ./cmd/ingestion"
  delay = 1000  # 1 second debounce
  include_ext = ["go", "yaml", "yml"]
  exclude_regex = ["_test.go"]
```

```bash
# Install air
go install github.com/cosmtrek/air@latest

# Run with hot reload
air
```

---

_Previous: [Chapter 11 — Scaling Architecture](scaling_architecture.md) — Next: [Chapter 13 — Performance Tuning](performance_tuning.md)_

---

_Document Version: 1.0 — March 2026_
