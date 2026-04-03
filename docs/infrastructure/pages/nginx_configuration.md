# Chapter 9 — Nginx Configuration

> Reverse proxy design, upstream blocks, route mapping, WebSocket upgrade,
> caching strategy, security headers, and SSL termination.

---

## Overview

Nginx serves as the single entry point for all HTTP/WebSocket traffic in
NEXUS Edge. It reverse-proxies to four upstream services and handles static
asset caching, security headers, and WebSocket upgrades.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    NGINX REVERSE PROXY TOPOLOGY                                 │
│                                                                                 │
│  Browser / External Client                                                      │
│        │                                                                        │
│        ▼                                                                        │
│  ┌───────────────────────────────────────────────┐                              │
│  │              Nginx (port 80 / 443)            │                              │
│  │                                               │                              │
│  │  /           ──► web-ui:80        (React SPA) │                              │
│  │  /api/       ──► gateway-core:3001 (REST API) │                              │
│  │  /health     ──► gateway-core:3001 (healthz)  │                              │
│  │  /metrics    ──► gateway-core:3001 (prom)     │                              │
│  │  /ws         ──► gateway-core:3001 (WebSocket)│                              │
│  │  /grafana/   ──► grafana:3000     (dashboards)│                              │
│  │  /grafana/api/live/ ──► grafana:3000 (WS)     │                              │
│  │  /auth/      ──► authentik:9000   (OIDC)      │                              │
│  │                                               │                              │
│  └───────────────────────────────────────────────┘                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Upstream Definitions

```nginx
upstream gateway_core {
    server gateway-core:3001;
}

upstream web_ui {
    server web-ui:80;
}

upstream grafana {
    server grafana:3000;
}

upstream authentik {
    server authentik-server:9000;
}
```

Each upstream uses Docker DNS resolution (or K8s Service DNS) to resolve
the service name to the correct container/pod IP.

---

## Route Mapping

### Web UI (React SPA)

```nginx
location / {
    proxy_pass http://web_ui;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SPA fallback — serve index.html for client-side routes
    try_files $uri $uri/ /index.html;
}
```

The `try_files` directive ensures React Router works correctly — any path
that doesn't match a static file falls back to `index.html`.

### Gateway Core API

```nginx
location /api/ {
    proxy_pass http://gateway_core;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Timeout for long-running proxy requests (OPC UA browse)
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
}

location /health {
    proxy_pass http://gateway_core;
}

location /metrics {
    proxy_pass http://gateway_core;
}
```

### WebSocket Bridge

```nginx
location /ws {
    proxy_pass http://gateway_core;
    proxy_http_version 1.1;

    # WebSocket upgrade headers
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Long-lived connections
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

**Critical:** WebSocket connections require `proxy_http_version 1.1` and the
`Upgrade` / `Connection` headers. Without these, the connection upgrade fails
silently and the client receives a 400.

### Grafana

```nginx
location /grafana/ {
    proxy_pass http://grafana/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Grafana Live (WebSocket for real-time dashboards)
location /grafana/api/live/ {
    proxy_pass http://grafana/api/live/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

Grafana is configured with `GF_SERVER_ROOT_URL` set to `%(protocol)s://%(domain)s/grafana/`
to ensure sub-path serving works correctly.

### Authentik (OIDC Provider)

```nginx
location /auth/ {
    proxy_pass http://authentik/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## Caching Strategy

```nginx
# Static assets from Web UI (hashed filenames — cache forever)
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    proxy_pass http://web_ui;
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
}
```

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CACHING BEHAVIOR                                             │
│                                                                                 │
│  Asset Type         Cache Duration   Strategy                                   │
│  ────────────────── ───────────────  ─────────────────────────────────────────  │
│  /assets/*.js       1 year           Immutable — Vite adds content hash         │
│  /assets/*.css      1 year           Immutable — Vite adds content hash         │
│  /assets/fonts/*    1 year           Immutable                                  │
│  /index.html        no-cache         Must revalidate — entry point              │
│  /api/*             no-store         Never cache — dynamic data                 │
│  /ws                no-store         WebSocket — not cacheable                  │
│  /grafana/*         no-store         Dynamic dashboards                         │
│                                                                                 │
│  Vite hashed assets (e.g., index-a3b2c1d4.js) are safe to cache forever         │
│  because any code change produces a different filename hash.                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Compression

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types
    text/plain
    text/css
    text/xml
    application/json
    application/javascript
    application/xml
    application/rss+xml
    image/svg+xml;
gzip_min_length 1000;
```

| Setting           | Value | Purpose                                        |
| ----------------- | ----- | ---------------------------------------------- |
| `gzip_comp_level` | 6     | Balance between CPU and compression ratio      |
| `gzip_min_length` | 1000  | Skip tiny responses (headers > savings)        |
| `gzip_proxied`    | any   | Compress proxied responses too                 |
| `gzip_vary`       | on    | Serve correct version to gzip/non-gzip clients |

---

## Security Headers

```nginx
# Prevent MIME-type sniffing
add_header X-Content-Type-Options "nosniff" always;

# Clickjacking protection
add_header X-Frame-Options "SAMEORIGIN" always;

# XSS protection (legacy browsers)
add_header X-XSS-Protection "1; mode=block" always;

# Referrer policy
add_header Referrer-Policy "strict-origin-when-cross-origin" always;

# Content Security Policy (production)
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self';" always;
```

---

## SSL/TLS Termination

### Production Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name nexus.example.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;

    # Modern TLS configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:
                ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers on;

    # HSTS (1 year)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # OCSP stapling
    ssl_stapling on;
    ssl_stapling_verify on;

    # ... proxy locations ...
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name nexus.example.com;
    return 301 https://$server_name$request_uri;
}
```

### Development Configuration

```nginx
server {
    listen 80;
    server_name localhost;

    # No SSL in development — all HTTP
    # ... proxy locations ...
}
```

---

## Request Flow Example

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    REQUEST FLOW: GET /api/devices                               │
│                                                                                 │
│  1. Browser ──GET /api/devices──► Nginx:80                                      │
│                                                                                 │
│  2. Nginx matches: location /api/ { proxy_pass http://gateway_core; }           │
│                                                                                 │
│  3. Nginx ──GET /api/devices──► gateway-core:3001                               │
│     Headers added:                                                              │
│     • X-Real-IP: 192.168.1.100                                                  │
│     • X-Forwarded-For: 192.168.1.100                                            │
│     • X-Forwarded-Proto: http                                                   │
│                                                                                 │
│  4. Gateway Core processes request:                                             │
│     • Auth middleware (if AUTH_ENABLED)                                         │
│     • Rate limit check                                                          │
│     • DB query via Drizzle ORM                                                  │
│     • JSON response                                                             │
│                                                                                 │
│  5. gateway-core:3001 ──200 OK──► Nginx                                         │
│                                                                                 │
│  6. Nginx adds security headers + ──200 OK──► Browser                           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Docker Compose Service

```yaml
nexus-nginx:
  image: nginx:alpine
  container_name: nexus-nginx
  ports:
    - '80:80'
    - '443:443'
  volumes:
    - ./config/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    - ./config/nginx/ssl:/etc/nginx/ssl:ro # Production only
  depends_on:
    nexus-gateway-core:
      condition: service_healthy
    nexus-web-ui:
      condition: service_started
  networks:
    - nexus-internal
```

---

## Troubleshooting

| Symptom            | Cause                        | Fix                                                   |
| ------------------ | ---------------------------- | ----------------------------------------------------- |
| 502 Bad Gateway    | Upstream service not running | Check `docker compose ps`, verify health              |
| WebSocket 400      | Missing upgrade headers      | Ensure `proxy_http_version 1.1` and `Upgrade` headers |
| React routes 404   | Missing `try_files` fallback | Add `try_files $uri $uri/ /index.html`                |
| Grafana assets 404 | Wrong root URL               | Set `GF_SERVER_ROOT_URL` with `/grafana/` sub-path    |
| Slow OPC UA browse | Proxy timeout                | Increase `proxy_read_timeout` for `/api/`             |
| Mixed content      | HTTP behind HTTPS            | Set `X-Forwarded-Proto` header correctly              |

---

## Related Documentation

- [Network Architecture](network_architecture.md) — port map, service topology
- [TLS & Certificates](tls_certificates.md) — SSL certificate management
- [Security Hardening](security_hardening.md) — CSP, HSTS, header details
- [Docker Compose](docker_compose.md) — Nginx container configuration

---

_Document Version: 1.0_
_Last Updated: March 2026_
