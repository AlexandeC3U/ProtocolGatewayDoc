# Chapter 4 — Layer Architecture

> Code organization, module boundaries, and file-by-file map.

---

## Module Boundary Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         HTTP LAYER                              │
│  Fastify plugins, middleware hooks, route definitions           │
│  Files: index.ts, middleware/*.ts, routes/*/routes.ts           │
├──────────────────────────────┬──────────────────────────────────┤
│                         SERVICE LAYER                           │
│  Business logic, validation, orchestration                      │
│  Files: routes/*/service.ts                                     │
├──────────────┬───────────────┼───────────────┬──────────────────┤
│   DB LAYER   │  MQTT LAYER   │  PROXY LAYER  │   WS LAYER       │
│              │               │               │                  │
│  Drizzle ORM │  Publisher    │  HTTP client  │  MQTT→WS         │
│  PostgreSQL  │  Subscriber   │ Circuit break │  Ref-counted     │
│  Migrations  │  Transform    │               │  subscriptions   │
│              │               │               │                  │
│  db/*.ts     │  mqtt/*.ts    │  proxy/*.ts   │  websocket/*.ts  │
└──────────────┴───────────────┴───────────────┴──────────────────┘
```

## Dependency Rules

1. **Routes** depend on **Services** — routes never access DB or MQTT directly
2. **Services** depend on **DB**, **MQTT**, and **Proxy** — services orchestrate cross-cutting operations
3. **Middleware** is independent — auth, RBAC, audit have no service dependencies
4. **Transform** is pure — takes DB entities in, returns PG format out, no side effects
5. **Proxy** is isolated — knows only HTTP URLs, not business logic

## File-by-File Map

### `src/index.ts` (247 lines) — Application Bootstrap

The entry point wires everything together:

1. Creates Fastify instance with 1MB body limit
2. Registers plugins (CORS, Helmet, rate-limit, WebSocket, Swagger)
3. Registers middleware (auth hook on all requests, audit on responses)
4. Registers metrics collection (request counter + duration histogram)
5. Registers all route groups under their prefixes
6. Registers WebSocket bridge at `/ws`
7. Runs database migrations (blocking — server won't start until DB is ready)
8. Connects MQTT (non-blocking — status subscriber starts after connect)
9. Starts HTTP listener
10. Registers SIGTERM/SIGINT handlers for graceful shutdown

### `src/config/env.ts` (77 lines) — Environment Validation

Zod schema that validates and types all environment variables at startup. Process exits immediately with structured error output if validation fails. See [Chapter 16](configuration_reference.md) for the full reference.

### `src/db/` — Database Layer

| File         | Lines | Purpose                                                             |
| ------------ | ----- | ------------------------------------------------------------------- |
| `schema.ts`  | 239   | Drizzle table definitions: devices, tags, audit_log + 4 enums       |
| `index.ts`   | 26    | Pool creation (configurable size, query timeouts), Drizzle instance |
| `migrate.ts` | 186   | Startup migration with 5-attempt retry, inline DDL fallback         |

### `src/lib/` — Shared Utilities

| File         | Lines | Purpose                                                                                  |
| ------------ | ----- | ---------------------------------------------------------------------------------------- |
| `errors.ts`  | 53    | Error class hierarchy: AppError, NotFound, Validation, Conflict, Unauthorized, Forbidden |
| `logger.ts`  | 21    | Pino logger (pretty in dev, JSON in prod, service=gateway-core)                          |
| `metrics.ts` | 140   | Prometheus registry: HTTP, WS, MQTT, proxy metrics + default Node.js metrics             |

### `src/middleware/` — Request Pipeline

| File       | Lines | Purpose                                                                     |
| ---------- | ----- | --------------------------------------------------------------------------- |
| `auth.ts`  | 217   | JWT verification via jose, JWKS auto-discovery, role extraction from claims |
| `rbac.ts`  | 86    | `requireRole()` and `requireMinRole()` preHandler factories                 |
| `audit.ts` | 122   | onResponse hook that logs mutations to audit_log table                      |

### `src/mqtt/` — MQTT Integration

| File            | Lines | Purpose                                                                          |
| --------------- | ----- | -------------------------------------------------------------------------------- |
| `client.ts`     | 257   | MQTT connection, publish (QoS 1), subscribe, message routing                     |
| `subscriber.ts` | 101   | Status ingest (`$nexus/status/devices/+`), config sync handler                   |
| `transform.ts`  | 189   | DB entity → PG format mapping (camelCase→snake_case, defaults, protocol mapping) |

### `src/proxy/` — Downstream Service Proxy

| File                  | Lines | Purpose                                                                  |
| --------------------- | ----- | ------------------------------------------------------------------------ |
| `protocol-gateway.ts` | 303   | HTTP proxy with circuit breaker (5 failures → 30s open), GET/POST/DELETE |
| `data-ingestion.ts`   | 40    | Simple GET proxy for historian queries (15s timeout)                     |

### `src/routes/` — API Endpoints

| Directory    | Files                            | Lines | Endpoints                                                   |
| ------------ | -------------------------------- | ----- | ----------------------------------------------------------- |
| `devices/`   | routes.ts, schema.ts, service.ts | 758   | 9 endpoints (CRUD + toggle + test + browse + status)        |
| `tags/`      | routes.ts, schema.ts, service.ts | 718   | 7 endpoints (CRUD + bulk + toggle)                          |
| `health/`    | routes.ts                        | 144   | 3 endpoints (/, /ready, /live)                              |
| `system/`    | routes.ts                        | 257   | 6 endpoints (health, info, containers, logs, audit, topics) |
| `opcua/`     | routes.ts                        | 83    | 4 endpoints (certificate management)                        |
| `historian/` | routes.ts                        | 42    | 1 endpoint (history query proxy)                            |

### `src/websocket/bridge.ts` (312 lines) — Real-Time Bridge

MQTT→WebSocket bridge with:

- Per-topic client tracking (Map<topic, Set<WebSocket>>)
- Automatic MQTT subscribe on first client, unsubscribe on last
- Topic allowlist (`$nexus/data/`, `$nexus/status/`)
- 30s ping/pong heartbeat
- Auth check at connection time

## Dependency Graph (internal)

```
index.ts
├── config/env.ts
├── lib/logger.ts
├── lib/metrics.ts
├── lib/errors.ts
├── middleware/auth.ts ──▶ config/env.ts, lib/errors.ts, lib/logger.ts
├── middleware/rbac.ts ──▶ config/env.ts, lib/errors.ts, middleware/auth.ts (types)
├── middleware/audit.ts ──▶ config/env.ts, db/schema.ts, db/index.ts, lib/logger.ts
├── mqtt/client.ts ──▶ config/env.ts, lib/logger.ts
├── mqtt/subscriber.ts ──▶ mqtt/client.ts, routes/devices/service.ts, lib/logger.ts
├── mqtt/transform.ts (pure — no imports from other src/ modules)
├── proxy/protocol-gateway.ts ──▶ config/env.ts, lib/logger.ts, lib/metrics.ts
├── proxy/data-ingestion.ts ──▶ config/env.ts, lib/logger.ts
├── routes/devices/ ──▶ db/, mqtt/, proxy/, middleware/rbac.ts
├── routes/tags/ ──▶ db/, mqtt/, middleware/rbac.ts
├── routes/health/ ──▶ db/, mqtt/, proxy/
├── routes/system/ ──▶ proxy/, middleware/rbac.ts
├── routes/opcua/ ──▶ proxy/, middleware/rbac.ts
├── routes/historian/ ──▶ proxy/
└── websocket/bridge.ts ──▶ mqtt/client.ts, middleware/auth.ts, lib/logger.ts, lib/metrics.ts
```

---

_Previous: [Chapter 3 — Architectural Principles](architectural_principles.md) | Next: [Chapter 5 — Domain Model](domain_model.md)_
