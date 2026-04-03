# Chapter 6 — Middleware Architecture

> Authentication (JWT/JWKS), role-based access control, audit logging, and rate limiting.

---

## Middleware Pipeline

Every request passes through the following pipeline in order:

```
Request
  │
  ▼
┌──────────────────────┐
│  Helmet              │  Security headers (X-Frame-Options, CSP, etc.)
│  (always active)     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  CORS                │  Validate Origin header against CORS_ORIGIN
│  (always active)     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Rate Limit          │  Throttle requests per IP (opt-in via RATE_LIMIT_ENABLED)
│  (opt-in)            │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Auth (onRequest)    │  Validate JWT, extract user, attach to request.user
│  (opt-in)            │  Skipped for public paths: /health, /docs, /metrics, /
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  RBAC (preHandler)   │  Check request.user.role against route requirements
│  (per-route)         │  Applied via requireRole() or requireMinRole()
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Route Handler       │  Business logic executes
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Audit (onResponse)  │  Log mutations to audit_log table (opt-in via AUDIT_ENABLED)
│  (opt-in)            │  Only 2xx responses, only mutating methods (POST/PUT/DELETE)
└──────────┬───────────┘
           ▼
Response
```

## Authentication (auth.ts)

### JWKS Resolution

On startup, the auth middleware resolves the JWKS endpoint:

```
Priority 1: OIDC_JWKS_URL env var (explicit override)
     │
     │ not set?
     ▼
Priority 2: OIDC discovery document
             GET {OIDC_ISSUER_URL}/.well-known/openid-configuration
             Extract jwks_uri from response
     │
     │ discovery fails?
     ▼
Priority 3: Standard fallback
             {OIDC_ISSUER_URL}/jwks
```

Jose's `createRemoteJWKSet` handles caching and automatic key rotation.

### JWT Verification

```typescript
const { payload } = await jwtVerify(token, getJWKS(), {
  issuer: env.OIDC_ISSUER_URL,
  audience: env.OIDC_AUDIENCE || undefined,
});
```

- **Issuer validation**: token `iss` must match `OIDC_ISSUER_URL`
- **Audience validation**: optional, only checked if `OIDC_AUDIENCE` is set
- **Signature**: verified against JWKS (RS256/ES256)
- **Expiry**: jose automatically rejects expired tokens

### Role Extraction

Roles are extracted from JWT claims in priority order:

```
1. claims.groups[]              ← Authentik default (groups as roles)
2. claims.realm_access.roles[]  ← Keycloak-compatible mapper
3. claims.resource_access.*.roles[]  ← Per-client roles
```

All candidates are normalized (lowercase, trim) and matched against the known roles. The **highest-privilege** match wins:

```
admin > engineer > operator > viewer
```

Default: `viewer` (if no recognized role found in claims).

### Public Paths

These paths skip authentication entirely:

| Path | Why |
|------|-----|
| `/health/*` | Kubernetes probes must work without tokens |
| `/docs/*` | Swagger UI is public |
| `/metrics` | Prometheus scraper has no auth |
| `/` | Root info endpoint |

## Role-Based Access Control (rbac.ts)

### Role Hierarchy

```
  admin (3)
    │
    ▼
  engineer (2)
    │
    ▼
  operator (1)
    │
    ▼
  viewer (0)
```

### Permission Matrix

| Action | admin | engineer | operator | viewer |
|--------|:-----:|:--------:|:--------:|:------:|
| View devices/tags | Y | Y | Y | Y |
| Create/edit devices/tags | Y | Y | - | - |
| Delete devices/tags | Y | Y | - | - |
| Test connection / browse | Y | Y | Y | - |
| Toggle device enabled | Y | Y | Y | - |
| Manage OPC UA certificates | Y | Y | - | - |
| View system logs/containers | Y | Y | - | - |
| View system health/info | Y | Y | Y | Y |
| Query audit log | Y | - | - | - |

### Usage in Routes

```typescript
// Exact role match (any of the listed roles)
fastify.post('/api/devices', {
  preHandler: requireRole('admin', 'engineer'),
  handler: createDevice,
});

// Minimum role level (operator and above)
fastify.post('/api/devices/:id/test', {
  preHandler: requireMinRole('operator'),
  handler: testDevice,
});
```

### Behavior When Auth is Disabled

When `AUTH_ENABLED=false`, both `requireRole()` and `requireMinRole()` are no-ops — all requests pass through regardless of role. This allows development without an identity provider.

## Audit Logging (audit.ts)

### What Gets Logged

Only **successful mutations** are logged:
- HTTP method is POST, PUT, or DELETE
- Response status is 2xx
- Action can be derived from the URL pattern

### Action Derivation

| Method + URL Pattern | Action | Resource Type |
|---------------------|--------|---------------|
| `POST /api/devices` | `device.create` | `device` |
| `PUT /api/devices/:id` | `device.update` | `device` |
| `DELETE /api/devices/:id` | `device.delete` | `device` |
| `POST /api/devices/:id/toggle` | `device.toggle` | `device` |
| `POST /api/devices/:id/test` | `device.test` | `device` |
| `POST /api/devices/:id/browse` | `device.browse` | `device` |
| `POST /api/tags` | `tag.create` | `tag` |
| `POST /api/tags/bulk` | `tag.bulk_create` | `tag` |
| `PUT /api/tags/:id` | `tag.update` | `tag` |
| `DELETE /api/tags/:id` | `tag.delete` | `tag` |
| `POST /api/opcua/certificates/trust` | `certificate.trust` | `certificate` |

### Audit Log Entry

```json
{
  "id": "uuid",
  "userSub": "authentik-subject-id",
  "username": "john.doe",
  "action": "device.create",
  "resourceType": "device",
  "resourceId": "device-uuid",
  "details": {
    "method": "POST",
    "url": "/api/devices",
    "statusCode": 201
  },
  "ipAddress": "192.168.1.50",
  "createdAt": "2026-03-19T10:30:00.000Z"
}
```

### Best-Effort Guarantee

Audit logging runs in the `onResponse` hook. If the database insert fails, the error is **logged but not propagated** — the client already received its response. This prevents audit infrastructure issues from breaking the API.

## Rate Limiting

Controlled by three env vars:

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `false` | Master switch |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Time window |

Uses `@fastify/rate-limit` with per-IP tracking. Returns `429 Too Many Requests` when limit is exceeded with `Retry-After` header.

---

*Previous: [Chapter 5 — Domain Model](domain_model.md) | Next: [Chapter 7 — MQTT Architecture](mqtt_architecture.md)*
