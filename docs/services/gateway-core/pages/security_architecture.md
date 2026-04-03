# Chapter 13 — Security Architecture

> OIDC flow, JWT validation, role extraction, RBAC enforcement, and defense-in-depth.

---

## Authentication Overview

Gateway Core uses **Authentik** as its OIDC identity provider. Authentication is optional (controlled by `AUTH_ENABLED`) but recommended for production.

```
Browser                  Authentik                    Gateway Core
   │                        │                              │
   │  1. Login flow         │                              │
   │  (browser redirect)    │                              │
   │───────────────────────>│                              │
   │                        │                              │
   │  2. Username/password  │                              │
   │───────────────────────>│                              │
   │                        │                              │
   │  3. JWT (access token) │                              │
   │<───────────────────────│                              │
   │                        │                              │
   │  4. API request        │                              │
   │  Authorization: Bearer │                              │
   │  <JWT>                 │                              │
   │──────────────────────────────────────────────────────>│
   │                        │                              │
   │                        │  5. Fetch JWKS (cached)      │
   │                        │<─────────────────────────────│
   │                        │                              │
   │                        │  6. Return public keys       │
   │                        │─────────────────────────────>│
   │                        │                              │
   │                        │       7. Verify signature    │
   │                        │       8. Check issuer        │
   │                        │       9. Check expiry        │
   │                        │      10. Extract role        │
   │                        │                              │
   │  11. API response      │                              │
   │<──────────────────────────────────────────────────────│
```

## JWKS Resolution

On startup, the auth middleware resolves the JWKS endpoint using a three-level priority:

```
Priority 1: OIDC_JWKS_URL env var
     │
     │ not set?
     ▼
Priority 2: OIDC discovery
             GET {OIDC_ISSUER_URL}/.well-known/openid-configuration
             → extract jwks_uri from JSON response
     │
     │ discovery fails?
     ▼
Priority 3: Standard fallback
             {OIDC_ISSUER_URL}/jwks
```

The `jose` library's `createRemoteJWKSet` handles:

- **Caching:** Keys are fetched once and reused
- **Key rotation:** When a token's `kid` (Key ID) doesn't match cached keys, jose automatically re-fetches

## JWT Verification

```typescript
const { payload } = await jwtVerify(token, getJWKS(), {
  issuer: env.OIDC_ISSUER_URL,
  audience: env.OIDC_AUDIENCE || undefined,
});
```

| Check            | Behavior                               |
| ---------------- | -------------------------------------- |
| Signature        | Verified against JWKS (RS256/ES256)    |
| Issuer (`iss`)   | Must match `OIDC_ISSUER_URL`           |
| Audience (`aud`) | Only checked if `OIDC_AUDIENCE` is set |
| Expiry (`exp`)   | Automatically rejected by jose         |
| Token source     | `Authorization: Bearer <token>` header |

## Role Extraction

Roles are extracted from JWT claims in priority order to support multiple OIDC providers:

```
1. payload.groups[]                    ← Authentik default
   └─ e.g., ["admin", "users"]

2. payload.realm_access.roles[]        ← Keycloak realm roles
   └─ e.g., ["engineer", "default-roles"]

3. payload.resource_access.*.roles[]   ← Keycloak per-client roles
   └─ e.g., { "nexus": { "roles": ["operator"] } }
```

All candidates are:

1. Normalized (lowercase, trimmed)
2. Matched against the four known roles
3. The **highest-privilege** match wins

```
admin (3) > engineer (2) > operator (1) > viewer (0)
```

**Default:** If no recognized role is found in any claim, the user is assigned `viewer`.

## Role-Based Access Control (RBAC)

### Role Hierarchy

```
  admin (3)     ← Full access, audit log query
    │
    ▼
  engineer (2)  ← Device/tag CRUD, certificate management, system ops
    │
    ▼
  operator (1)  ← Test connection, browse, toggle enabled
    │
    ▼
  viewer (0)    ← Read-only access to devices, tags, health
```

### Permission Matrix

| Action                       | Route                                    | Min Role |
| ---------------------------- | ---------------------------------------- | -------- |
| List/get devices & tags      | `GET /api/devices`, `GET /api/tags`      | viewer   |
| View health/info             | `GET /health/*`, `GET /api/system/info`  | viewer   |
| Test connection              | `POST /api/devices/:id/test`             | operator |
| Browse address space         | `POST /api/devices/:id/browse`           | operator |
| Toggle device enabled        | `POST /api/devices/:id/toggle`           | operator |
| Create/update/delete devices | `POST/PUT/DELETE /api/devices`           | engineer |
| Create/update/delete tags    | `POST/PUT/DELETE /api/tags`              | engineer |
| Bulk create tags             | `POST /api/tags/bulk`                    | engineer |
| Manage OPC UA certificates   | `POST/DELETE /api/opcua/*`               | engineer |
| View containers/logs/topics  | `GET /api/system/containers,logs,topics` | engineer |
| Query audit log              | `GET /api/system/audit`                  | admin    |

### RBAC Middleware

Two preHandler factories:

```typescript
// Exact role match (any of the listed roles)
requireRole('admin', 'engineer');

// Minimum role level (this role and above)
requireMinRole('operator'); // operator, engineer, admin all pass
```

### When Auth is Disabled

When `AUTH_ENABLED=false`:

- The `onRequest` auth hook is a no-op (doesn't validate tokens)
- `requireRole()` and `requireMinRole()` are no-ops (all requests pass)
- `request.user` is undefined
- This allows development without an identity provider

## Public Paths

These paths skip authentication entirely (even when `AUTH_ENABLED=true`):

| Path        | Reason                                         |
| ----------- | ---------------------------------------------- |
| `/health/*` | Kubernetes probes must work without tokens     |
| `/docs/*`   | Swagger UI is public for developer convenience |
| `/metrics`  | Prometheus scraper has no auth mechanism       |
| `/`         | Root info endpoint                             |

## WebSocket Authentication

WebSocket connections are authenticated at upgrade time:

```
GET /ws (upgrade request)
     │
     ├── AUTH_ENABLED=true AND request.user is undefined
     │   → send error: "Authentication required"
     │   → close with code 4001
     │
     └── AUTH_ENABLED=false OR request.user exists
         → connection accepted
```

The JWT must be valid at connection time. There is no token refresh mechanism for long-lived WebSocket connections — if the token expires, the client must reconnect with a fresh token.

## Error Response Security

The global error handler sanitizes error responses:

| Status            | Response                                                                 |
| ----------------- | ------------------------------------------------------------------------ |
| 4xx               | Actual error message returned                                            |
| 5xx               | Generic `"Internal server error"` — no stack traces, no internal details |
| 5xx (development) | Includes `details` field with Zod errors, stack traces                   |

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token",
    "requestId": "req-abc-123"
  }
}
```

## Transport Security

| Layer         | Mechanism                                                      |
| ------------- | -------------------------------------------------------------- |
| HTTP headers  | Helmet (X-Frame-Options, X-Content-Type-Options, etc.)         |
| CORS          | Origin validation against `CORS_ORIGIN` (comma-separated list) |
| CSP           | Disabled in current config (for development flexibility)       |
| Body limit    | 1 MB max — prevents payload bombs                              |
| Rate limiting | Optional per-IP/per-user throttling                            |

## Audit Trail

All successful mutations (POST/PUT/DELETE with 2xx response) are logged to the `audit_log` table:

```json
{
  "id": "uuid",
  "userSub": "authentik-subject-id",
  "username": "john.doe",
  "action": "device.create",
  "resourceType": "device",
  "resourceId": "device-uuid",
  "details": { "method": "POST", "url": "/api/devices", "statusCode": 201 },
  "ipAddress": "192.168.1.50",
  "createdAt": "2026-03-19T10:30:00.000Z"
}
```

Audit logging is controlled by `AUDIT_ENABLED` and is independent of `AUTH_ENABLED` — you can audit anonymous actions when auth is disabled.

---

_Previous: [Chapter 12 — Observability](observability.md) | Next: [Chapter 14 — Deployment](deployment.md)_
