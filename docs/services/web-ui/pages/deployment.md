# Chapter 11 — Deployment

> Docker multi-stage build, Nginx production config, Kubernetes manifests,
> and environment-specific configuration.

---

## Build Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       BUILD PIPELINE                                            │
│                                                                                 │
│  Source Code                                                                    │
│       │                                                                         │
│       ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  STAGE 1: BUILD (node:20-alpine)                                         │   │
│  │                                                                          │   │
│  │  1. Install pnpm globally                                                │   │
│  │  2. Copy package.json + pnpm-lock.yaml                                   │   │
│  │  3. pnpm install (dependencies only)                                     │   │
│  │  4. Copy source code                                                     │   │
│  │  5. pnpm build (Vite production build)                                   │   │
│  │     ├── TypeScript compilation (via SWC, not tsc)                        │   │
│  │     ├── Tree shaking + dead code elimination                             │   │
│  │     ├── CSS purging (Tailwind unused classes removed)                    │   │
│  │     ├── Asset hashing (content-based filenames)                          │   │
│  │     └── Output: /app/dist/                                               │   │
│  │                                                                          │   │
│  │  Build args:                                                             │   │
│  │  • VITE_API_URL — API base URL (baked into bundle)                       │   │
│  │  • VITE_WS_URL — WebSocket URL (baked into bundle)                       │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│       │                                                                         │
│       │  COPY dist/ → nginx html dir                                            │
│       │  COPY nginx.conf                                                        │
│       ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │  STAGE 2: SERVE (nginx:alpine)                                           │   │
│  │                                                                          │   │
│  │  • Serves static files from /usr/share/nginx/html                        │   │
│  │  • Reverse proxy: /api/* → gateway-core:3001                             │   │
│  │  • Reverse proxy: /health/* → gateway-core:3001                          │   │
│  │  • Reverse proxy: /grafana/* → grafana:3000                              │   │
│  │  • SPA fallback: try_files $uri $uri/ /index.html                        │   │
│  │  • Health check: wget localhost:80 (for Docker/K8s probes)               │   │
│  │                                                                          │   │
│  │  Final image: ~25MB (nginx:alpine + static assets)                       │   │
│  │                                                                          │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Dockerfile

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
RUN npm install -g pnpm

WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_URL
ARG VITE_WS_URL

RUN pnpm build

# Stage 2: Serve
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q --spider http://localhost:80 || exit 1
```

**Key points:**
- `--frozen-lockfile` ensures reproducible builds
- Build args are baked into the bundle at build time (Vite replaces `import.meta.env.*`)
- Final image has no Node.js, no source code — just static files + Nginx
- Health check validates Nginx is serving

---

## Nginx Configuration

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml text/javascript image/svg+xml;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Static assets — long cache (content-hashed filenames)
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API proxy → Gateway Core
    location /api/ {
        proxy_pass http://gateway-core:3001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health proxy → Gateway Core
    location /health/ {
        proxy_pass http://gateway-core:3001/health/;
        proxy_set_header Host $host;
    }

    # Grafana proxy
    location /grafana/ {
        proxy_pass http://grafana:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # SPA fallback — all other routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Proxy Targets

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      NGINX PROXY MAP                                            │
│                                                                                 │
│  Browser Request           │  Proxied To                                        │
│  ──────────────────────────┼────────────────────────────────────────────────    │
│  GET /api/devices          │  http://gateway-core:3001/api/devices              │
│  GET /api/tags?limit=25    │  http://gateway-core:3001/api/tags?limit=25        │
│  GET /health/ready         │  http://gateway-core:3001/health/ready             │
│  GET /grafana/d/abc/...    │  http://grafana:3000/d/abc/...                     │
│  GET /devices/123          │  /usr/share/nginx/html/index.html (SPA)            │
│  GET /assets/index-abc.js  │  /usr/share/nginx/html/assets/index-abc.js         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Docker Compose

In the platform's Docker Compose, the Web UI is configured as:

```yaml
web-ui:
  build:
    context: ./services/web-ui
    args:
      VITE_API_URL: ""  # Uses relative URLs (proxied by Nginx)
  ports:
    - "80:80"
  depends_on:
    gateway-core:
      condition: service_healthy
  networks:
    - nexus-internal
  restart: unless-stopped
```

**Service dependency:** Web UI depends on Gateway Core being healthy before starting,
since Nginx proxies API calls to it.

---

## Kubernetes Deployment

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web-ui
  namespace: nexus
  labels:
    app.kubernetes.io/name: web-ui
    app.kubernetes.io/component: frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web-ui
  template:
    metadata:
      labels:
        app: web-ui
    spec:
      containers:
        - name: web-ui
          image: nexus/web-ui:latest
          ports:
            - containerPort: 80
              name: http
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "100m"
          livenessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 3
            periodSeconds: 10
```

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: web-ui
  namespace: nexus
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 80
      name: http
  selector:
    app: web-ui
```

### Resource Sizing

| Resource | Request | Limit | Rationale |
|----------|---------|-------|-----------|
| Memory | 64Mi | 128Mi | Nginx serving static files is lightweight |
| CPU | 50m | 100m | Minimal CPU — just serving files + proxying |
| Replicas | 2 | — | High availability, zero-downtime deploys |

The Web UI is the **lightest service** in the platform — it's just Nginx serving
static files. Two replicas provide HA without significant resource cost.

---

## Build Scripts

```bash
# Development
pnpm dev          # Vite dev server with HMR (port 5173)
pnpm build        # Production build (output: dist/)
pnpm preview      # Serve production build locally

# Quality
pnpm lint         # ESLint check
pnpm lint:fix     # ESLint auto-fix
pnpm typecheck    # TypeScript type check (tsc --noEmit)

# Docker
docker build -t nexus/web-ui:latest .
docker build --build-arg VITE_API_URL=https://edge.example.com/api -t nexus/web-ui:prod .
```

---

## Environment-Specific Builds

| Environment | VITE_API_URL | Auth | Notes |
|-------------|-------------|------|-------|
| Development | (empty) | Disabled | Vite proxy to localhost:3001 |
| Docker Compose | (empty) | Optional | Nginx proxy to gateway-core:3001 |
| Kubernetes | (empty) | Enabled | Ingress/Service handles routing |
| Standalone | `https://api.example.com` | Enabled | Direct API calls (no proxy) |

**Note:** When `VITE_API_URL` is empty, the app uses relative URLs (`/api/devices`)
which are handled by the dev server proxy or Nginx proxy. Only set an explicit URL
when the UI is served from a different origin than the API.

---

## Related Documentation

- [Configuration Reference](configuration_reference.md) — all environment variables
- [Performance](performance.md) — build optimization and caching
- [System Overview](system_overview.md) — where deployment fits in the architecture

---

*Document Version: 1.0*
*Last Updated: March 2026*
