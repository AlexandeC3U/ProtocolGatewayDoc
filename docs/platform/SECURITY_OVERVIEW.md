# Security Overview — NEXUS Edge

> Platform-wide security architecture. Authentication flow, authorization model,
> network segmentation, TLS configuration, secret management, and audit trail.
> Covers all layers from browser to PLC.

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    NEXUS EDGE — SECURITY LAYERS                                 │
│                                                                                 │
│  LAYER 1: PERIMETER                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Nginx Reverse Proxy                                                    │    │
│  │  • TLS termination (TLSv1.2+)                                           │    │
│  │  • Single entry point (:80/:443)                                        │    │
│  │  • Route-based access control                                           │    │
│  │  • WebSocket upgrade handling                                           │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│  LAYER 2: AUTHENTICATION                                                        │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Authentik (OIDC Provider)          Gateway Core (JWT Validator)        │    │
│  │  • OIDC Authorization Code + PKCE   • JWKS auto-discovery               │    │
│  │  • Token issuance (1h access)       • JWT signature verification        │    │
│  │  • Group claims injection           • Issuer + expiry validation        │    │
│  │  • Refresh tokens (30d)             • Role extraction from claims       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│  LAYER 3: AUTHORIZATION                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  RBAC Middleware                                                        │    │
│  │  • Role hierarchy: viewer → operator → engineer → admin                 │    │
│  │  • Per-route permission enforcement                                     │    │
│  │  • Higher roles inherit lower permissions                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│  LAYER 4: AUDIT                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Audit Middleware                                                       │    │
│  │  • Logs all mutations (POST, PUT, DELETE, PATCH)                        │    │
│  │  • Captures: user, action, resource, IP, timestamp                      │    │
│  │  • Queryable via API (admin only)                                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                              │                                                  │
│  LAYER 5: NETWORK ISOLATION                                                     │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Docker Networks                    K8s NetworkPolicy                   │    │
│  │  • nexus-internal (IT services)     • Namespace isolation               │    │
│  │  • nexus-ot (OT/PLC network)        • Pod-to-pod rules                  │    │
│  │  • No direct external DB access     • Ingress/egress constraints        │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication Flow

### OIDC Authorization Code + PKCE (Web UI)

```
┌──────────┐          ┌──────────┐          ┌───────────────┐
│  Browser │          │  Nginx   │          │   Authentik   │
│ (Web UI) │          │  Proxy   │          │ OIDC Provider │
└────┬─────┘          └────┬─────┘          └──────┬────────┘
     │                     │                       │
     │  1. User clicks "Login"                     │
     │  ──────────────────────────────────────────►│
     │  GET /authorize                             │
     │    ?response_type=code                      │
     │    &client_id=nexus-gateway                 │
     │    &redirect_uri=.../auth/callback          │
     │    &code_challenge=SHA256(verifier)         │
     │    &code_challenge_method=S256              │
     │    &state=<random-16-chars>                 │
     │    &scope=openid profile email groups       │
     │                                             │
     │  2. User authenticates (username/password)  │
     │  ◄──────────────────────────────────────────│
     │  302 Redirect to callback with ?code=...    │
     │                                             │
     │  3. Exchange code for tokens                │
     │  ──────────────────────────────────────────►│
     │  POST /token                                │
     │    grant_type=authorization_code            │
     │    code=<auth_code>                         │
     │    code_verifier=<original_verifier>        │
     │    redirect_uri=.../auth/callback           │
     │                                             │
     │  4. Receive tokens                          │
     │  ◄──────────────────────────────────────────│
     │  {access_token, refresh_token, id_token}    │
     │                                             │
     │  5. Store in sessionStorage                 │
     │  (cleared on browser close)                 │
     │                                             │
```

### Token Details

| Token             | Validity | Storage                            | Purpose                           |
| ----------------- | -------- | ---------------------------------- | --------------------------------- |
| **Access Token**  | 1 hour   | `sessionStorage` (`nexus_token`)   | API authorization (Bearer header) |
| **Refresh Token** | 30 days  | `sessionStorage` (`nexus_refresh`) | Obtain new access token           |
| **ID Token**      | 1 hour   | `sessionStorage`                   | User info + role detection        |

### PKCE (Proof Key for Code Exchange)

Prevents authorization code interception attacks — critical for public clients (SPAs):

```
1. Generate verifier:  64-character random hex string
2. Compute challenge:  SHA-256(verifier) → base64url (no padding)
3. Send challenge:     code_challenge=<hash> in /authorize
4. Prove possession:   code_verifier=<original> in /token
5. Server verifies:    SHA-256(code_verifier) == stored challenge
```

### Token Refresh

```
Access token expired (60-second buffer)
    │
    ├── POST /token
    │     grant_type=refresh_token
    │     refresh_token=<stored_refresh>
    │
    ├── Success → new access_token + new refresh_token
    │             (rotation: old refresh token invalidated)
    │
    └── Failure → clear all tokens → redirect to login
```

### Auth Detection (Runtime)

The Web UI detects auth availability at runtime — no build-time configuration needed:

```
On app load:
    │
    ├── Fetch /.well-known/openid-configuration
    │
    ├── Success → auth is enabled
    │             extract authorization_endpoint, token_endpoint, etc.
    │
    └── Failure → auth is disabled
                  allow anonymous access
```

This allows the same build to work in both auth-enabled and auth-disabled environments.

---

## JWT Validation (Gateway Core)

### JWKS Discovery & Caching

```
Request arrives with Bearer token
    │
    ├── Is AUTH_ENABLED=true?
    │   └── No → skip auth, proceed
    │
    ├── Is path public? (/health, /metrics, /docs, /)
    │   └── Yes → skip auth, proceed
    │
    ├── Extract Bearer token from Authorization header
    │   └── Missing → 401 Unauthorized
    │
    ├── Fetch JWKS (cached, auto-refresh)
    │   ├── Primary: OIDC discovery → jwks_uri
    │   └── Fallback: OIDC_JWKS_URL env var
    │
    ├── Verify JWT signature (RS256)
    │   └── Invalid → 401 "Invalid token"
    │
    ├── Validate claims
    │   ├── iss (issuer) matches OIDC_ISSUER_URL
    │   ├── exp (expiration) is in the future
    │   └── aud (audience) matches (if configured)
    │
    ├── Extract user info
    │   ├── username: preferred_username || email
    │   ├── sub: user ID (hashed)
    │   └── roles: from groups || realm_access.roles || resource_access
    │
    └── Attach to request → proceed to RBAC
```

### Role Extraction Priority

Gateway Core checks multiple JWT claim locations for roles:

```
1. groups[]                        ← Authentik default (injected by custom scope)
2. realm_access.roles[]            ← Keycloak compatibility
3. resource_access[client].roles[] ← Keycloak client-specific roles
```

First non-empty source wins. Roles are mapped to the RBAC hierarchy.

---

## Role-Based Access Control (RBAC)

### Role Hierarchy

```
admin (3) ──── Can do everything
  │
  ▼
engineer (2) ── Create/edit/delete devices, tags, certificates
  │             View system logs, containers, topics
  ▼
operator (1) ── Test connections, browse devices, toggle enabled
  │             View devices, tags, health
  ▼
viewer (0) ──── Read-only access to devices, tags, health, history
```

### Permission Matrix

| Endpoint                       | Viewer | Operator | Engineer | Admin |
| ------------------------------ | ------ | -------- | -------- | ----- |
| `GET /api/devices`             | Y      | Y        | Y        | Y     |
| `GET /api/tags`                | Y      | Y        | Y        | Y     |
| `GET /api/devices/:id/status`  | Y      | Y        | Y        | Y     |
| `GET /api/system/health`       | Y      | Y        | Y        | Y     |
| `GET /api/system/info`         | Y      | Y        | Y        | Y     |
| `GET /api/historian/history`   | Y      | Y        | Y        | Y     |
| `POST /api/devices/:id/test`   | -      | Y        | Y        | Y     |
| `POST /api/devices/:id/browse` | -      | Y        | Y        | Y     |
| `POST /api/devices/:id/toggle` | -      | Y        | Y        | Y     |
| `POST /api/tags/:id/toggle`    | -      | Y        | Y        | Y     |
| `POST /api/devices`            | -      | -        | Y        | Y     |
| `PUT /api/devices/:id`         | -      | -        | Y        | Y     |
| `DELETE /api/devices/:id`      | -      | -        | Y        | Y     |
| `POST /api/tags`               | -      | -        | Y        | Y     |
| `POST /api/tags/bulk`          | -      | -        | Y        | Y     |
| `PUT /api/tags/:id`            | -      | -        | Y        | Y     |
| `DELETE /api/tags/:id`         | -      | -        | Y        | Y     |
| `* /api/opcua/certificates/*`  | -      | -        | Y        | Y     |
| `GET /api/system/containers`   | -      | -        | Y        | Y     |
| `GET /api/system/logs`         | -      | -        | Y        | Y     |
| `GET /api/system/topics`       | -      | -        | Y        | Y     |
| `GET /api/system/audit`        | -      | -        | -        | Y     |

### RBAC Enforcement

```typescript
// Per-route enforcement via Fastify preHandler
fastify.post(
  '/api/devices',
  {
    preHandler: [authMiddleware, requireMinRole('engineer')],
  },
  handler
);

// Admin-only
fastify.get(
  '/api/system/audit',
  {
    preHandler: [authMiddleware, requireMinRole('admin')],
  },
  handler
);
```

---

## Authentik Configuration

### Blueprint Auto-Provisioning

The Authentik blueprint (`infrastructure/docker/config/authentik/blueprints/nexus-setup.yaml`)
automatically configures the identity provider on first boot:

```
Blueprint creates:
├── OAuth2/OIDC Provider: "nexus-gateway-provider"
│   ├── Client ID: nexus-gateway
│   ├── Client Type: public (SPA, no secret)
│   ├── Signing Key: managed RSA key pair
│   ├── Access token validity: 1 hour
│   ├── Refresh token validity: 30 days
│   ├── Sub mode: hashed_user_id
│   └── Include claims in ID token: true
│
├── Application: "nexus-edge"
│   ├── Provider: nexus-gateway-provider
│   └── Launch URL: http://localhost
│
├── Custom Scope: "groups"
│   └── Expression: return {"groups": [g.name for g in request.user.groups.all()]}
│
├── Redirect URIs:
│   ├── http://localhost:8080/auth/callback (Docker host)
│   ├── http://localhost:5173/auth/callback (Vite dev)
│   └── http://localhost/auth/callback (Nginx)
│
└── Groups:
    ├── admin   (full access)
    ├── engineer (config + monitoring)
    ├── operator (monitoring + ops)
    └── viewer   (read-only)
```

### User Management

Users are created in Authentik admin UI (`http://localhost/auth/`) and assigned to groups.
Group membership determines their RBAC role in Gateway Core.

---

## Audit Trail

### What Gets Logged

| Logged                      | Not Logged                |
| --------------------------- | ------------------------- |
| All POST requests (creates) | GET requests (reads)      |
| All PUT requests (updates)  | OPTIONS/HEAD requests     |
| All DELETE requests         | Failed requests (non-2xx) |
| All PATCH requests          | Health check requests     |

### Audit Record Fields

| Field          | Description                   | Example                                                   |
| -------------- | ----------------------------- | --------------------------------------------------------- |
| `userSub`      | Authentik subject ID (hashed) | `ak-...`                                                  |
| `username`     | Display name from JWT         | `admin`                                                   |
| `action`       | Method + resource type        | `device.create`                                           |
| `resourceType` | Affected entity type          | `device`                                                  |
| `resourceId`   | UUID of affected resource     | `550e8400-...`                                            |
| `details`      | HTTP context                  | `{"method":"POST","url":"/api/devices","statusCode":201}` |
| `ipAddress`    | Request origin                | `172.28.0.1`                                              |
| `createdAt`    | Timestamp                     | `2026-03-23T10:30:45.000Z`                                |

### Audit Action Catalog

| Action               | Trigger               |
| -------------------- | --------------------- |
| `device.create`      | New device            |
| `device.update`      | Device config change  |
| `device.delete`      | Device removal        |
| `device.toggle`      | Enable/disable device |
| `device.test`        | Connection test       |
| `device.browse`      | Address space browse  |
| `tag.create`         | New tag               |
| `tag.update`         | Tag config change     |
| `tag.delete`         | Tag removal           |
| `certificate.trust`  | OPC UA cert promotion |
| `certificate.delete` | OPC UA cert removal   |
| `system.bulk_create` | Bulk tag creation     |

### Querying Audit Logs

```bash
# Admin only — via API
curl -H "Authorization: Bearer <admin-token>" \
  "http://localhost/api/system/audit?limit=20"

# Filter by user
curl -H "Authorization: Bearer <admin-token>" \
  "http://localhost/api/system/audit?username=admin&action=device.delete"

# Filter by time range
curl -H "Authorization: Bearer <admin-token>" \
  "http://localhost/api/system/audit?since=2026-03-23T00:00:00Z"
```

---

## Network Security

### Docker Compose Networks

```
┌─────────────────────────────────────────────────────────────────────┐
│  nexus-internal (172.28.0.0/16)                                     │
│                                                                     │
│  All IT services: Nginx, Web UI, Gateway Core, EMQX, PostgreSQL,    │
│  TimescaleDB, Authentik, Prometheus, Grafana, Data Ingestion,       │
│  Protocol Gateway                                                   │
│                                                                     │
│  Only Nginx port is exposed externally (:80/:443)                   │
│  All other ports are internal-only                                  │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  nexus-ot (bridge)                                                  │
│                                                                     │
│  Protocol Gateway only — bridges to OT network                      │
│  Connects to PLCs, sensors, RTUs                                    │
│  No other service has access to this network                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Key isolation:**

- Databases (PostgreSQL, TimescaleDB) have **no external port mapping** — accessible only within `nexus-internal`
- EMQX ports exposed only for development; production uses internal-only access
- Only Protocol Gateway bridges IT and OT networks

### Kubernetes Network Policy (Production)

```yaml
# Restrict pod-to-pod communication
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: gateway-core-policy
spec:
  podSelector:
    matchLabels:
      app: gateway-core
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: nginx
      ports:
        - port: 3001
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: postgres
      ports:
        - port: 5432
    - to:
        - podSelector:
            matchLabels:
              app: emqx
      ports:
        - port: 1883
```

---

## MQTT Security

### Per-Service Credentials

| Service          | Username           | Purpose                                          |
| ---------------- | ------------------ | ------------------------------------------------ |
| Gateway Core     | `gateway`          | Config publish, status subscribe                 |
| Protocol Gateway | `protocol-gateway` | Data publish, config subscribe, command handling |
| Data Ingestion   | `historian`        | Data subscribe (shared subscription)             |

### ACL Recommendations (Production)

```erlang
%% Development: {allow, all}.

%% Production: per-service topic restrictions
{allow, {user, "gateway"}, publish, ["$nexus/config/#"]}.
{allow, {user, "gateway"}, subscribe, ["$nexus/status/#", "$nexus/config/sync/request"]}.

{allow, {user, "protocol-gateway"}, publish, ["#", "$nexus/status/#", "$nexus/cmd/response/#"]}.
{allow, {user, "protocol-gateway"}, subscribe, ["$nexus/config/#", "$nexus/cmd/#"]}.

{allow, {user, "historian"}, subscribe, ["$share/ingestion/#"]}.

{deny, all}.
```

---

## TLS Configuration

### Certificate Matrix

| Component  | Port   | Protocol   | TLS Required (Prod)                     |
| ---------- | ------ | ---------- | --------------------------------------- |
| Nginx      | 443    | HTTPS      | **Yes** — cert-manager or Let's Encrypt |
| EMQX       | 8883   | MQTTS      | Recommended (device connections)        |
| EMQX       | 8084   | WSS        | Recommended (browser MQTT)              |
| Authentik  | 9443   | HTTPS      | Built-in self-signed                    |
| PostgreSQL | 5432   | PG+SSL     | Optional (`sslmode=require`)            |
| OPC UA     | varies | OPC UA PKI | Per-server certificates                 |

### Nginx TLS Config

```
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
ssl_prefer_server_ciphers on;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
```

---

## API Security

### Rate Limiting

| Scope           | Default                 | Config                    |
| --------------- | ----------------------- | ------------------------- |
| Global          | 100 req/min per user/IP | `RATE_LIMIT_ENABLED=true` |
| Device test     | 10 req/min              | Per-route                 |
| Device browse   | 10 req/min              | Per-route                 |
| Allowlisted IPs | `127.0.0.1`, `::1`      | Bypass rate limit         |

### HTTP Security Headers

**Fastify Helmet** provides:

- `X-DNS-Prefetch-Control`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`

**Recommended additions for Nginx (production):**

```
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
```

### Circuit Breaker (DDoS Protection for Downstream)

Proxy routes to Protocol Gateway and Data Ingestion use circuit breaker:

- **5 consecutive failures** → circuit opens (fail-fast)
- **30-second cooldown** → half-open probe
- Prevents cascading failures from overwhelming downstream services

### CORS Policy

```
CORS_ORIGIN=http://localhost:5173,http://localhost:8080,http://web-ui
credentials: true
```

Only configured origins can make cross-origin requests with credentials.

---

## Secret Management

### Development

Secrets defined in `infrastructure/docker/env.template` with placeholder values:

| Secret                | Env Var                 | Minimum Strength      |
| --------------------- | ----------------------- | --------------------- |
| JWT signing           | `AUTHENTIK_SECRET_KEY`  | 50+ random chars      |
| Config DB password    | `POSTGRES_PASSWORD`     | Strong password       |
| Historian DB password | `HISTORIAN_PASSWORD`    | Strong password       |
| Authentik DB password | `AUTHENTIK_DB_PASSWORD` | Strong password       |
| MQTT passwords        | `MQTT_*_PASS`           | Per-service passwords |
| Grafana admin         | `GRAFANA_PASSWORD`      | Strong password       |

### Production (Kubernetes)

**Current state:** K8s Secrets (base64 encoded, **not encrypted at rest**).

**Recommended:** Replace with one of:

- **sealed-secrets** — encrypted in git, decrypted in-cluster
- **external-secrets** — synced from HashiCorp Vault, AWS Secrets Manager, etc.
- **SOPS** — encrypted YAML files

```yaml
# Example: external-secrets (production)
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: nexus-secrets
spec:
  secretStoreRef:
    name: vault-backend
  target:
    name: nexus-secrets
  data:
    - secretKey: POSTGRES_PASSWORD
      remoteRef:
        key: nexus/config-db
        property: password
```

---

## Production Readiness Checklist

### Critical (Must Do Before Production)

- [ ] Rotate ALL default passwords in `.env`
- [ ] Generate TLS certificates for Nginx (not self-signed)
- [ ] Implement EMQX ACL rules (replace `{allow, all}`)
- [ ] Enable K8s secrets encryption (sealed-secrets or external-secrets)
- [ ] Change EMQX dashboard admin password
- [ ] Enable `RATE_LIMIT_ENABLED=true`
- [ ] Set `AUTH_ENABLED=true` and `AUDIT_ENABLED=true`

### High (Should Do)

- [ ] Add security headers to Nginx (CSP, HSTS)
- [ ] Enable database SSL connections (`sslmode=require`)
- [ ] Restrict EMQX dashboard to internal network only
- [ ] Configure cert-manager for automatic certificate renewal
- [ ] Enable Protocol Gateway API auth (`API_AUTH_ENABLED=true`)
- [ ] Set up log aggregation (ELK, Datadog, Grafana Loki)

### Medium (Nice to Have)

- [ ] Implement K8s NetworkPolicy for pod-to-pod isolation
- [ ] Add request ID correlation across services
- [ ] Perform container image security scanning
- [ ] Document certificate rotation procedures
- [ ] Implement backup encryption for database dumps

---

## Cross-References

| Topic                      | Document                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| Auth middleware code       | [Gateway Core — Middleware Architecture](services/gateway-core/pages/middleware_architecture.md) |
| Web UI auth implementation | [Web UI — Auth Architecture](services/web-ui/pages/auth_architecture.md)                         |
| Authentik deployment       | [Infrastructure — Authentik](infrastructure/pages/authentik_architecture.md)                     |
| TLS certificates           | [Infrastructure — TLS Certificates](infrastructure/pages/tls_certificates.md)                    |
| Network architecture       | [Infrastructure — Network Architecture](infrastructure/pages/network_architecture.md)            |
| Security hardening         | [Infrastructure — Security Hardening](infrastructure/pages/security_hardening.md)                |
| MQTT broker security       | [Infrastructure — EMQX Configuration](infrastructure/pages/emqx_configuration.md)                |

---

_Document Version: 1.0_
_Last Updated: March 2026_
