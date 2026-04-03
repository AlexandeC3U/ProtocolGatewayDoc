# Chapter 2 — System Overview

> High-level architecture of the Web UI, its dependencies, and how it fits
> into the NEXUS Edge platform.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (CLIENT)                                   │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                       REACT SPA (Vite bundle)                             │  │
│  │                                                                           │  │
│  │  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐  │  │
│  │  │  Auth   │  │  Router  │  │  Query    │  │  Pages   │  │   UI      │  │  │
│  │  │ Context │  │  (RR6)   │  │  Client   │  │          │  │ (Radix)   │  │  │
│  │  │         │  │          │  │  (TQ v5)  │  │ Dashboard│  │           │  │  │
│  │  │ OIDC    │  │ /        │  │           │  │ Devices  │  │ Button    │  │  │
│  │  │ PKCE    │  │ /devices │  │ 5s stale  │  │ Tags     │  │ Card      │  │  │
│  │  │ Tokens  │  │ /tags    │  │ 1 retry   │  │ System   │  │ Dialog    │  │  │
│  │  │ Roles   │  │ /system  │  │ Auto GC   │  │ Health   │  │ Table     │  │  │
│  │  │         │  │ /health  │  │           │  │ Login    │  │ Toast     │  │  │
│  │  └────┬────┘  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └───────────┘  │  │
│  │       │            │              │             │                         │  │
│  │       └────────────┴──────────────┴─────────────┘                        │  │
│  │                                   │                                       │  │
│  │                            ┌──────▼──────┐                                │  │
│  │                            │  API Client │                                │  │
│  │                            │  (lib/api)  │                                │  │
│  │                            │             │                                │  │
│  │                            │  fetch()    │                                │  │
│  │                            │  + Bearer   │                                │  │
│  │                            └──────┬──────┘                                │  │
│  │                                   │                                       │  │
│  └───────────────────────────────────┼───────────────────────────────────────┘  │
│                                      │                                          │
└──────────────────────────────────────┼──────────────────────────────────────────┘
                                       │
                    ┌──────────────────┬┴──────────────────┐
                    │                  │                    │
              HTTP/REST          OIDC/OAuth2          HTTP (iframe)
                    │                  │                    │
                    ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              NGINX (Port 80)                                    │
│                                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  /       │  │  /api/*      │  │  /health/*   │  │  /grafana/*           │  │
│  │          │  │              │  │              │  │                        │  │
│  │  Static  │  │  Proxy to    │  │  Proxy to    │  │  Proxy to              │  │
│  │  files   │  │  gateway-    │  │  gateway-    │  │  grafana:3000          │  │
│  │  + SPA   │  │  core:3001   │  │  core:3001   │  │                        │  │
│  │  fallback│  │              │  │              │  │                        │  │
│  └──────────┘  └──────┬───────┘  └──────┬───────┘  └────────────┬───────────┘  │
│                       │                 │                        │               │
└───────────────────────┼─────────────────┼────────────────────────┼───────────────┘
                        │                 │                        │
                        ▼                 ▼                        ▼
               ┌─────────────────┐                       ┌─────────────────┐
               │  Gateway Core   │                       │     Grafana     │
               │  (Port 3001)    │                       │   (Port 3000)   │
               │                 │                       │                 │
               │  Fastify REST   │                       │  Dashboards     │
               │  WebSocket      │                       │  TimescaleDB    │
               │  MQTT Bridge    │                       │  datasource     │
               └────────┬────────┘                       └─────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
  ┌──────────────┐ ┌──────────┐ ┌──────────────┐
  │  PostgreSQL  │ │   EMQX   │ │  Authentik   │
  │  (Config DB) │ │  (MQTT)  │ │  (IdP/OIDC)  │
  └──────────────┘ └──────────┘ └──────────────┘
```

---

## Dependency Graph

The Web UI has three external runtime dependencies:

```
                         ┌───────────────┐
                         │    Web UI     │
                         │   (Browser)   │
                         └───────┬───────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
           ┌──────────────┐ ┌────────┐ ┌──────────┐
           │ Gateway Core │ │Authentik│ │ Grafana  │
           │  (required)  │ │(optional)│ │(optional)│
           └──────────────┘ └────────┘ └──────────┘
```

| Dependency | Required | Purpose | Failure Mode |
|-----------|----------|---------|-------------|
| **Gateway Core** | Yes | REST API for all CRUD operations | App shows error states, no data |
| **Authentik** | Conditional | SSO authentication (OIDC) | If auth disabled, app works without login |
| **Grafana** | No | Embedded dashboards on /health page | Health page shows iframe error |
| **Nginx** | Production only | Static serving + reverse proxy | Dev uses Vite proxy instead |

---

## Port Map

| Service | Port | Protocol | Purpose |
|---------|------|----------|---------|
| Web UI (dev) | 5173 | HTTP | Vite dev server |
| Web UI (prod) | 80 | HTTP | Nginx static + proxy |
| Gateway Core | 3001 | HTTP/WS | REST API + WebSocket |
| Authentik | 9000 | HTTP | OIDC provider |
| Grafana | 3000 | HTTP | Dashboard UI |

---

## Request Flow

### Typical API Request (Authenticated)

```
Browser                  Nginx              Gateway Core           PostgreSQL
  │                        │                      │                      │
  │  GET /api/devices      │                      │                      │
  │  Authorization: Bearer │                      │                      │
  │  ──────────────────>   │                      │                      │
  │                        │  proxy_pass           │                      │
  │                        │  ─────────────────>   │                      │
  │                        │                      │  SELECT * FROM       │
  │                        │                      │  devices             │
  │                        │                      │  ──────────────────> │
  │                        │                      │                      │
  │                        │                      │  <── rows ────────── │
  │                        │                      │                      │
  │                        │  <── 200 JSON ─────── │                      │
  │                        │                      │                      │
  │  <── 200 JSON ──────── │                      │                      │
  │                        │                      │                      │
  │  TanStack Query        │                      │                      │
  │  caches response       │                      │                      │
  │  for 5 seconds         │                      │                      │
  │                        │                      │                      │
```

### OIDC Authentication Flow

```
Browser                  Authentik              Gateway Core
  │                        │                      │
  │  1. Click "Sign in     │                      │
  │     with SSO"          │                      │
  │                        │                      │
  │  2. Generate PKCE      │                      │
  │     code_verifier +    │                      │
  │     code_challenge     │                      │
  │                        │                      │
  │  3. Redirect to        │                      │
  │     /authorize         │                      │
  │  ──────────────────>   │                      │
  │                        │                      │
  │  4. User authenticates │                      │
  │     (Authentik UI)     │                      │
  │                        │                      │
  │  5. Redirect back      │                      │
  │     /auth/callback     │                      │
  │     ?code=xxx          │                      │
  │  <──────────────────   │                      │
  │                        │                      │
  │  6. Exchange code      │                      │
  │     for tokens         │                      │
  │  ──────────────────>   │                      │
  │                        │                      │
  │  7. access_token +     │                      │
  │     refresh_token      │                      │
  │  <──────────────────   │                      │
  │                        │                      │
  │  8. Store in           │                      │
  │     sessionStorage     │                      │
  │                        │                      │
  │  9. API calls with     │                      │
  │     Bearer token       │                      │
  │  ──────────────────────────────────────────>  │
  │                        │                      │
```

---

## Development vs Production

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DEVELOPMENT MODE                                      │
│                                                                                 │
│  Browser ──> Vite Dev Server (5173) ──┬──> Static (HMR, hot reload)            │
│                                       ├──> /api/*  ──> Gateway Core (3001)     │
│                                       └──> /health ──> Gateway Core (3001)     │
│                                                                                 │
│  • Instant feedback via SWC + React Fast Refresh                                │
│  • Source maps enabled                                                          │
│  • No auth required (VITE_AUTH_ENABLED=false by default)                        │
│                                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                           PRODUCTION MODE                                       │
│                                                                                 │
│  Browser ──> Nginx (80) ──┬──> /           ──> Static files + SPA fallback     │
│                           ├──> /api/*      ──> Gateway Core (3001)             │
│                           ├──> /health/*   ──> Gateway Core (3001)             │
│                           └──> /grafana/*  ──> Grafana (3000)                  │
│                                                                                 │
│  • Gzip compression on all responses                                            │
│  • 1-year cache on static assets (hashed filenames)                             │
│  • Security headers (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)│
│  • Auth required via Authentik OIDC                                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Technology Layers

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│  PRESENTATION LAYER                                                             │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  React 18 │ TailwindCSS │ Radix UI │ Lucide Icons │ React Flow │ Recharts│ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  STATE & DATA LAYER                                                             │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  TanStack Query (server state) │ React Context (auth) │ Component state  │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  NETWORK LAYER                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  fetch() API client │ OIDC (native crypto) │ mqtt.js (WebSocket)         │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  ROUTING LAYER                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  React Router v6 │ ProtectedRoute │ AuthCallback │ Layout (Outlet)       │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  BUILD & TOOLING                                                                │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │  Vite 5 + SWC │ TypeScript 5.4 │ ESLint │ PostCSS │ Autoprefixer        │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Architectural Principles](architectural_principles.md) — design decisions behind these choices
- [Deployment](deployment.md) — Docker, Nginx, and Kubernetes setup
- [Configuration Reference](configuration_reference.md) — all environment variables and config files

---

*Document Version: 1.0*
*Last Updated: March 2026*
