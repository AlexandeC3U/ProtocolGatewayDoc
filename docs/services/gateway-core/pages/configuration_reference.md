# Chapter 16 — Configuration Reference

> Every environment variable, its type, default, and effect.

---

## Environment Validation

All environment variables are validated at startup using a Zod schema (`config/env.ts`). If validation fails, the process exits immediately with a structured error showing which variables are invalid.

```
Startup → Zod parse process.env → fail → console.error(formatted) → exit(1)
                                → pass → export env (typed, immutable)
```

## Variable Reference

### Server

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PORT` | number | `3001` | HTTP listen port |
| `HOST` | string | `0.0.0.0` | Bind address |
| `NODE_ENV` | enum | `development` | `development`, `production`, `test` |
| `LOG_LEVEL` | enum | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

**Effects of `NODE_ENV`:**

| Setting | `development` | `production` |
|---------|--------------|--------------|
| Log format | pino-pretty (colorized) | JSON (one line per entry) |
| Error details | Included in 5xx responses | Omitted |

### Database

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DATABASE_URL` | string | `postgresql://nexus:nexus_config_secret@localhost:5433/nexus_config` | PostgreSQL connection string |
| `DATABASE_POOL_SIZE` | number | `10` | Max connections in pool |

**Pool configuration (hardcoded):**

| Setting | Value | Description |
|---------|-------|-------------|
| `statement_timeout` | 30,000ms | Kill queries running longer than 30s |
| `idle_in_transaction_session_timeout` | 60,000ms | Kill transactions idle for 60s |

### MQTT

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `MQTT_BROKER_URL` | string | `mqtt://localhost:1883` | MQTT broker URL |
| `MQTT_CLIENT_ID` | string | `gateway-core` | Client ID for MQTT connection |
| `MQTT_USERNAME` | string | *(optional)* | MQTT authentication username |
| `MQTT_PASSWORD` | string | *(optional)* | MQTT authentication password |

**Connection settings (hardcoded):**

| Setting | Value |
|---------|-------|
| `clean` | `true` (no persistent session) |
| `reconnectPeriod` | 5,000ms |
| `connectTimeout` | 30,000ms |
| Publish QoS | 1 (at-least-once) |

### Service Discovery

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `PROTOCOL_GATEWAY_URL` | string | `http://localhost:8080` | Protocol-gateway base URL |
| `DATA_INGESTION_URL` | string | `http://localhost:8081` | Data-ingestion base URL |

### CORS

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CORS_ORIGIN` | string | `http://localhost:5173` | Allowed origins (comma-separated for multiple) |

The value is split on commas at registration time: `env.CORS_ORIGIN.split(',')`.

### Authentication

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AUTH_ENABLED` | boolean | `false` | Enable JWT authentication |
| `OIDC_ISSUER_URL` | string | *(optional)* | OIDC issuer URL (e.g., `https://auth.example.com/application/o/nexus-edge/`) |
| `OIDC_JWKS_URL` | string | *(optional)* | Override JWKS endpoint (auto-discovered from issuer if not set) |
| `OIDC_AUDIENCE` | string | *(optional)* | Expected JWT audience claim |

**Boolean parsing:** The custom `booleanEnv` transform correctly handles string values:

| Input | Parsed As |
|-------|-----------|
| `true`, `1`, `yes`, `TRUE` | `true` |
| `false`, `0`, `no`, `""` | `false` |
| *(not set)* | `false` (default) |

### Audit Logging

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `AUDIT_ENABLED` | boolean | `false` | Enable mutation audit logging |

Independent of `AUTH_ENABLED` — can audit anonymous actions.

### WebSocket

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `WS_MAX_SUBSCRIPTIONS_PER_CLIENT` | number | `100` | Max MQTT topic subscriptions per WebSocket client |

### Rate Limiting

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_ENABLED` | boolean | `false` | Enable global rate limiting |
| `RATE_LIMIT_MAX` | number | `100` | Max requests per time window |
| `RATE_LIMIT_WINDOW` | string | `1 minute` | Time window (Fastify duration string) |

**Rate limiter behavior when enabled:**

| Setting | Value |
|---------|-------|
| Key generator | `request.user?.sub ?? request.ip` |
| Allow list | `127.0.0.1`, `::1` |
| Response on exceed | 429 with `Retry-After` header |
| Headers added | `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` |

## Feature Flags

Three features are independently toggleable:

| Flag | Controls | Production Recommendation |
|------|----------|--------------------------|
| `AUTH_ENABLED` | JWT validation + RBAC enforcement | `true` |
| `AUDIT_ENABLED` | Mutation logging to `audit_log` table | `true` |
| `RATE_LIMIT_ENABLED` | Per-IP/per-user request throttling | `true` |

All default to `false` for development convenience.

## Minimum Production Configuration

```env
# Required for production
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/nexus_config
MQTT_BROKER_URL=mqtt://emqx:1883

# Strongly recommended
AUTH_ENABLED=true
OIDC_ISSUER_URL=https://auth.example.com/application/o/nexus-edge/
AUDIT_ENABLED=true
RATE_LIMIT_ENABLED=true
CORS_ORIGIN=https://your-domain.com

# Service discovery
PROTOCOL_GATEWAY_URL=http://protocol-gateway:8080
DATA_INGESTION_URL=http://data-ingestion:8081
```

## Hardcoded Constants

These values are not configurable via environment variables:

| Constant | Value | Location |
|----------|-------|----------|
| HTTP body limit | 1 MB | `index.ts` |
| Circuit breaker threshold | 5 failures | `proxy/protocol-gateway.ts` |
| Circuit breaker cooldown | 30s | `proxy/protocol-gateway.ts` |
| Proxy default timeout | 30s (PG), 15s (DI) | `proxy/*.ts` |
| Health check timeout | 2s | `proxy/protocol-gateway.ts` |
| WS ping interval | 30s | `websocket/bridge.ts` |
| DB migration retries | 5 attempts, 2s apart | `db/migrate.ts` |
| Audit log max query limit | 200 | `routes/system/routes.ts` |
| Max topics per WS subscribe message | 50 | `websocket/bridge.ts` |
| Bulk tag create limit | 1000 | `routes/tags/schema.ts` |

---

*Previous: [Chapter 15 — Testing Strategy](testing_strategy.md) | Next: [Chapter 17 — Edge Cases & Operational Notes](edge_cases.md)*
