# Chapter 14 — Deployment

> Docker multi-stage build, Compose configuration, Kubernetes manifests, and startup sequence.

---

## Docker Image

### Multi-Stage Build

```
Stage 1: builder (node:20-alpine)         Stage 2: production (node:20-alpine)
┌────────────────────────────────┐        ┌────────────────────────────────┐
│  1. Enable pnpm (corepack)     │        │  1. Create non-root user       │
│  2. Copy package.json          │        │     nodejs:1001                │
│  3. pnpm install (all deps)    │        │                                │
│  4. Copy source + tsconfig     │        │  2. Copy from builder:         │
│  5. tsup build                 │        │     - node_modules (prod only) │
│  6. pnpm install --prod        │───────>│     - dist/                    │
│     (strip devDependencies)    │        │     - package.json             │
└────────────────────────────────┘        │                                │
                                          │  3. USER nodejs                │
                                          │  4. EXPOSE 3001                │
                                          │  5. HEALTHCHECK /health/live   │
                                          │  6. CMD node dist/index.js     │
                                          └────────────────────────────────┘
```

### Build Command

```bash
docker build -t nexus/gateway-core:latest services/gateway-core/
```

### Image Details

| Property        | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Base image      | `node:20-alpine`                                            |
| Package manager | pnpm 8.12.0 (via corepack)                                  |
| Build tool      | tsup (ESM output)                                           |
| User            | `nodejs` (UID 1001, non-root)                               |
| Port            | 3001                                                        |
| Entrypoint      | `node dist/index.js`                                        |
| Health check    | `wget --spider http://localhost:3001/health/live` every 30s |

### Health Check Configuration

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health/live || exit 1
```

## Docker Compose

The gateway-core service in the platform's `docker-compose.yml`:

```yaml
gateway-core:
  build:
    context: ../../services/gateway-core
    dockerfile: Dockerfile
  image: nexus/gateway-core:${VERSION:-latest}
  container_name: nexus-gateway-core
  hostname: gateway-core
  restart: unless-stopped
  environment:
    - NODE_ENV=${NODE_ENV:-production}
    - PORT=3001
    - LOG_LEVEL=${LOG_LEVEL:-info}
    - DATABASE_URL=postgresql://nexus:nexus_config_secret@config-db:5432/nexus_config
    - DATABASE_POOL_SIZE=10
    - MQTT_BROKER_URL=mqtt://emqx:1883
    - MQTT_CLIENT_ID=gateway-core
    - PROTOCOL_GATEWAY_URL=http://protocol-gateway:8080
    - DATA_INGESTION_URL=http://data-ingestion:8081
    - CORS_ORIGIN=http://localhost:3000
    - AUTH_ENABLED=true
    - OIDC_ISSUER_URL=http://authentik:9000/application/o/nexus-edge/
    - AUDIT_ENABLED=true
    - RATE_LIMIT_ENABLED=true
  ports:
    - '3001:3001'
  depends_on:
    config-db:
      condition: service_healthy
    emqx:
      condition: service_healthy
```

### Service Dependencies

| Dependency  | Condition         | Why                                                      |
| ----------- | ----------------- | -------------------------------------------------------- |
| `config-db` | `service_healthy` | PostgreSQL must accept connections before migrations run |
| `emqx`      | `service_healthy` | MQTT broker must be ready for subscriptions              |

**Note:** `depends_on` only ensures the container is healthy, not that the service is ready to accept the specific queries gateway-core needs. The migration runner's 5-attempt retry handles the gap.

## Kubernetes

### Manifest Set

| File                  | Kind                | Purpose                                        |
| --------------------- | ------------------- | ---------------------------------------------- |
| `deployment.yaml`     | Deployment          | Main workload (1 replica)                      |
| `service.yaml`        | Service             | ClusterIP on port 3001                         |
| `serviceaccount.yaml` | ServiceAccount      | Identity for RBAC                              |
| `pdb.yaml`            | PodDisruptionBudget | `minAvailable: 1` during voluntary disruptions |
| `kustomization.yaml`  | Kustomization       | Bundles all manifests                          |

### Deployment Highlights

**Init containers** wait for dependencies before the main container starts:

```
wait-for-postgres ──▶ wait-for-emqx ──▶ gateway-core
(nc -z postgres 5432)  (nc -z emqx 1883)  (node dist/index.js)
```

**Probes:**

| Probe     | Path            | Timing                              | Purpose                                      |
| --------- | --------------- | ----------------------------------- | -------------------------------------------- |
| Startup   | `/health/live`  | 5s initial, 5s period, 30 failures  | Allows up to 2.5 minutes for first migration |
| Liveness  | `/health/live`  | 10s initial, 15s period, 3 failures | Restarts if process is hung                  |
| Readiness | `/health/ready` | 5s initial, 5s period, 3 failures   | Removes from service if DB/MQTT is down      |

**Resource limits:**

| Resource | Request | Limit |
| -------- | ------- | ----- |
| CPU      | 100m    | 500m  |
| Memory   | 128Mi   | 512Mi |

**Security context:**

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: [ALL]
```

**Rolling update strategy:**

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0 # Never remove a running pod before new one is ready
    maxSurge: 1 # Allow one extra pod during update
```

### Prometheus Scraping

Pod annotations enable automatic Prometheus discovery:

```yaml
annotations:
  prometheus.io/scrape: 'true'
  prometheus.io/port: '3001'
  prometheus.io/path: '/metrics'
```

### Configuration Sources

| Source                | Type      | Contains                                                                                                                   |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `nexus-config`        | ConfigMap | Shared config: `LOG_LEVEL`, `MQTT_BROKER_MQTT`, `PROTOCOL_GATEWAY_URL`, `DATA_INGESTION_URL`                               |
| `gateway-core-config` | ConfigMap | Service-specific: `CORS_ORIGIN`, `AUTH_ENABLED`, `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `AUDIT_ENABLED`, `RATE_LIMIT_ENABLED` |
| `postgres-secrets`    | Secret    | `DATABASE_URL`                                                                                                             |
| `nexus-secrets`       | Secret    | `MQTT_USERNAME`, `MQTT_PASSWORD`                                                                                           |

## Startup Sequence

```
1. Validate environment (Zod)
   │ fail → exit(1) with structured error
   │
2. Run database migrations
   │ ├── retry up to 5 times (2s between)
   │ ├── try Drizzle migrations (./drizzle)
   │ └── fallback to inline DDL
   │ fail → exit(1)
   │
3. Connect MQTT (non-blocking)
   │ ├── success → start status subscriber
   │ │             start config sync subscriber
   │ └── fail → log warning, continue
   │            (reconnects automatically every 5s)
   │
4. Start HTTP server
   │ ├── register plugins (CORS, Helmet, rate-limit, WS, Swagger)
   │ ├── register middleware (auth, audit, metrics)
   │ ├── register routes
   │ ├── register WebSocket bridge
   │ └── listen on PORT:HOST
   │
5. Register shutdown handlers (SIGTERM, SIGINT)
   │
6. Log "Gateway Core V2 started"
```

**Key design choice:** MQTT is non-blocking at startup. The HTTP server starts and serves requests even if MQTT is down. This means:

- Health checks pass (readiness will report `degraded` for MQTT)
- Device CRUD works (writes go to DB, MQTT notifications silently fail)
- WebSocket bridge has no data to forward until MQTT connects

## Development Mode

```bash
# Hot-reload via tsx watch
pnpm dev

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix
```

Development mode enables:

- `pino-pretty` output (colorized, human-readable)
- `details` field in error responses (Zod validation errors, stack traces)

---

_Previous: [Chapter 13 — Security Architecture](security_architecture.md) | Next: [Chapter 15 — Testing Strategy](testing_strategy.md)_
