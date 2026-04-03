# Chapter 8 — Authentik Architecture

> OIDC provider configuration, blueprint auto-provisioning, group/role mapping,
> branding customization, and deployment topology.

---

## Overview

Authentik 2026.2.1 provides identity and access management for NEXUS Edge.
It implements OpenID Connect (OIDC) with PKCE for the Web UI and JWT validation
for the Gateway Core API.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    AUTHENTIK IN NEXUS EDGE                                      │
│                                                                                 │
│  ┌──────────┐     OIDC/PKCE       ┌────────────────────┐                        │
│  │  Web UI  │ ◄─────────────────► │  Authentik Server  │                        │
│  │ (browser)│  login + tokens     │  (port 9000)       │                        │
│  └────┬─────┘                     │                    │                        │
│       │                           │  • OAuth2 Provider │                        │
│       │ Bearer token              │  • OIDC Discovery  │                        │
│       │                           │  • JWKS endpoint   │                        │
│       ▼                           │  • Group claims    │                        │
│  ┌──────────┐     JWKS fetch      │                    │                        │
│  │ Gateway  │ ◄──────────────────►│                    │                        │
│  │  Core    │  validate JWT       └────────┬───────────┘                        │
│  │ (API)    │                              │                                    │
│  └──────────┘                     ┌────────┴───────────┐                        │
│                                   │  Authentik Worker  │                        │
│                                   │  (background tasks)│                        │
│                                   │  • Blueprint sync  │                        │
│                                   │  • Token cleanup   │                        │
│                                   │  • Email delivery  │                        │
│                                   └────────┬───────────┘                        │
│                                            │                                    │
│                                   ┌────────┴───────────┐                        │
│                                   │  Authentik DB      │                        │
│                                   │  (PostgreSQL 16)   │                        │
│                                   │  Port: 5434        │                        │
│                                   └────────────────────┘                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Blueprint Auto-Provisioning

Authentik blueprints declaratively configure the identity provider on first boot.
NEXUS Edge uses a single blueprint (`nexus-setup.yaml`) mounted into the container.

### What the Blueprint Creates

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    BLUEPRINT PROVISIONING ORDER                                 │
│                                                                                 │
│  1. Brand ──────────────── "NEXUS Edge" branding, custom domain                 │
│                                                                                 │
│  2. Scope Mapping ──────── Custom "groups" scope (includes group names          │
│                             in ID token claims)                                 │
│                                                                                 │
│  3. OAuth2/OIDC Provider ─ "NEXUS Gateway" provider config                      │
│     │                       • Client type: public (SPA, no secret)              │
│     │                       • Access token: 1 hour validity                     │
│     │                       • Refresh token: 30 days validity                   │
│     │                       • PKCE required                                     │
│     │                       • Scopes: openid, email, profile, groups            │
│     │                                                                           │
│  4. Application ────────── "NEXUS Edge Gateway" application                     │
│     │                       • Slug: nexus-gateway                               │
│     │                       • Redirect URIs:                                    │
│     │                         - http://localhost:8080/auth/callback             │
│     │                         - http://localhost:5173/auth/callback             │
│     │                         - http://localhost/auth/callback                  │
│     │                                                                           │
│  5. Groups ─────────────── Four RBAC groups:                                    │
│                             • nexus-admin    (full access)                      │
│                             • nexus-engineer (config + monitoring)              │
│                             • nexus-operator (monitoring + basic ops)           │
│                             • nexus-viewer   (read-only)                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Blueprint YAML Structure

```yaml
# Mounted at: /blueprints/custom/nexus-setup.yaml
version: 1
metadata:
  name: NEXUS Edge Setup
  labels:
    blueprints.goauthentik.io/instantiate: 'true'

entries:
  # 1. Brand
  - model: authentik_brands.brand
    identifiers:
      domain: localhost
    attrs:
      branding_title: 'NEXUS Edge'
      branding_logo: '/static/dist/assets/icons/icon_left_brand.svg'
      branding_favicon: '/static/dist/assets/icons/icon.png'

  # 2. Custom scope mapping (groups in token)
  - model: authentik_providers_oauth2.scopemapping
    id: nexus-groups-scope
    identifiers:
      managed: goauthentik.io/providers/proxy/scope-nexus-groups
    attrs:
      name: 'NEXUS Groups'
      scope_name: groups
      expression: |
        return {
          "groups": [group.name for group in request.user.ak_groups.all()]
        }

  # 3. OAuth2/OIDC Provider
  - model: authentik_providers_oauth2.oauth2provider
    id: nexus-provider
    identifiers:
      name: NEXUS Gateway
    attrs:
      client_type: public
      access_token_validity: hours=1
      refresh_token_validity: days=30
      signing_key:
        !Find [authentik_crypto.certificatekeypair, [name, 'authentik Self-signed Certificate']]
      property_mappings:
        - !Find [
            authentik_providers_oauth2.scopemapping,
            [managed, goauthentik.io/providers/oauth2/scope-openid],
          ]
        - !Find [
            authentik_providers_oauth2.scopemapping,
            [managed, goauthentik.io/providers/oauth2/scope-email],
          ]
        - !Find [
            authentik_providers_oauth2.scopemapping,
            [managed, goauthentik.io/providers/oauth2/scope-profile],
          ]
        - !Find [
            authentik_providers_oauth2.scopemapping,
            [managed, goauthentik.io/providers/proxy/scope-nexus-groups],
          ]

  # 4. Application
  - model: authentik_core.application
    identifiers:
      slug: nexus-gateway
    attrs:
      name: 'NEXUS Edge Gateway'
      provider: !KeyOf nexus-provider
      open_in_new_tab: false

  # 5. RBAC Groups
  - model: authentik_core.group
    identifiers: { name: nexus-admin }
  - model: authentik_core.group
    identifiers: { name: nexus-engineer }
  - model: authentik_core.group
    identifiers: { name: nexus-operator }
  - model: authentik_core.group
    identifiers: { name: nexus-viewer }
```

---

## OIDC Configuration

### Discovery Endpoint

```
GET http://localhost:9000/application/o/nexus-gateway/.well-known/openid-configuration
```

Returns standard OIDC discovery document including:

| Field                    | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| `issuer`                 | `http://localhost:9000/application/o/nexus-gateway/`      |
| `authorization_endpoint` | `http://localhost:9000/application/o/authorize/`          |
| `token_endpoint`         | `http://localhost:9000/application/o/token/`              |
| `userinfo_endpoint`      | `http://localhost:9000/application/o/userinfo/`           |
| `jwks_uri`               | `http://localhost:9000/application/o/nexus-gateway/jwks/` |

### Token Claims

The ID token includes these claims after authentication:

```json
{
  "iss": "http://localhost:9000/application/o/nexus-gateway/",
  "sub": "user-uuid-here",
  "aud": "nexus-gateway",
  "exp": 1711036800,
  "iat": 1711033200,
  "email": "operator@nexus.local",
  "preferred_username": "operator",
  "groups": ["nexus-operator"]
}
```

### PKCE Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PKCE AUTHORIZATION FLOW                                      │
│                                                                                 │
│  Web UI (Browser)                    Authentik                                  │
│  ─────────────────                   ─────────                                  │
│                                                                                 │
│  1. Generate code_verifier (random 128 bytes)                                   │
│  2. Derive code_challenge = SHA256(code_verifier)                               │
│                                                                                 │
│  3. ──── /authorize? ──────────────────────►                                    │
│          response_type=code                                                     │
│          client_id=nexus-gateway                                                │
│          redirect_uri=http://localhost/auth/callback                            │
│          scope=openid email profile groups                                      │
│          code_challenge={hash}                                                  │
│          code_challenge_method=S256                                             │
│                                                                                 │
│  4. ◄──── redirect to login page ──────────                                     │
│                                                                                 │
│  5. User enters credentials                                                     │
│                                                                                 │
│  6. ◄──── redirect with ?code={auth_code} ─                                     │
│                                                                                 │
│  7. ──── POST /token ──────────────────────►                                    │
│          grant_type=authorization_code                                          │
│          code={auth_code}                                                       │
│          code_verifier={original_verifier}     ← proves possession              │
│          redirect_uri=http://localhost/auth/callback                            │
│                                                                                 │
│  8. ◄──── { access_token, id_token, refresh_token } ──                          │
│                                                                                 │
│  WHY PKCE?                                                                      │
│  • Public client (SPA) — cannot store client_secret                             │
│  • code_verifier proves the token requester is the same as the                  │
│    authorization requester (prevents authorization code interception)           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Group-Based RBAC

### Role Hierarchy

| Group            | Scope                                          | Typical User           |
| ---------------- | ---------------------------------------------- | ---------------------- |
| `nexus-admin`    | Full access: config, monitoring, users, system | Platform administrator |
| `nexus-engineer` | Device config, tag management, monitoring      | Automation engineer    |
| `nexus-operator` | View devices, view tags, view dashboards       | Plant operator         |
| `nexus-viewer`   | Read-only access to all resources              | Auditor, stakeholder   |

### Gateway Core Enforcement

Gateway Core extracts groups from the JWT and maps them to permissions:

```
Token → decode JWT → extract groups[] → match highest role → apply middleware
```

| Endpoint Pattern             | Required Role | Method                 |
| ---------------------------- | ------------- | ---------------------- |
| `GET /api/*`                 | viewer        | Any authenticated user |
| `POST /api/devices`          | engineer      | Create device          |
| `PUT /api/devices/:id`       | engineer      | Update device          |
| `DELETE /api/devices/:id`    | admin         | Delete device          |
| `POST /api/devices/:id/tags` | engineer      | Add tags               |
| `GET /api/system/*`          | admin         | System management      |
| `GET /api/audit/*`           | admin         | Audit log access       |

---

## Custom Branding

### CSS Customization

A custom CSS file is mounted into the Authentik container to apply Delaware/NEXUS
branding to the login page:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    BRANDING CUSTOMIZATION                                       │
│                                                                                 │
│  Mount: ./config/authentik/branding/custom.css                                  │
│     →   /web/dist/custom.css                                                    │
│                                                                                 │
│  Theme:                                                                         │
│  • Background: Dark industrial (#0a0a0a) with grid pattern                      │
│  • Primary color: Delaware red (#c42828)                                        │
│  • Font: System sans-serif stack                                                │
│  • Login card: Frosted glass effect (backdrop-filter: blur)                     │
│  • Logo: "d." monogram replacing default Authentik logo                         │
│                                                                                 │
│  Key overrides:                                                                 │
│  • ak-flow-executor background → dark gradient                                  │
│  • ak-stage-prompt input fields → dark theme inputs                             │
│  • Primary buttons → Delaware red (#c42828)                                     │
│  • Brand logo → Custom "d." with red accent dot                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Deployment Topology

### Docker Compose

```yaml
# Authentik Server (API + Web UI)
nexus-authentik-server:
  image: ghcr.io/goauthentik/server:2026.2.1
  command: server
  ports:
    - '9000:9000' # HTTP
    - '9443:9443' # HTTPS
  environment:
    AUTHENTIK_SECRET_KEY: ${AUTHENTIK_SECRET_KEY}
    AUTHENTIK_POSTGRESQL__HOST: authentik-db
    AUTHENTIK_POSTGRESQL__NAME: authentik
    AUTHENTIK_POSTGRESQL__USER: authentik
    AUTHENTIK_POSTGRESQL__PASSWORD: ${AUTHENTIK_DB_PASSWORD}
    AUTHENTIK_BOOTSTRAP_PASSWORD: ${AUTHENTIK_ADMIN_PASSWORD}
    AUTHENTIK_BOOTSTRAP_EMAIL: ${AUTHENTIK_ADMIN_EMAIL}
  volumes:
    - ./config/authentik/blueprints:/blueprints/custom:ro
    - ./config/authentik/branding/custom.css:/web/dist/custom.css:ro

# Authentik Worker (background tasks)
nexus-authentik-worker:
  image: ghcr.io/goauthentik/server:2026.2.1
  command: worker
  environment:
    # Same env as server
  depends_on:
    nexus-authentik-server:
      condition: service_healthy

# Authentik Database (dedicated PostgreSQL)
nexus-authentik-db:
  image: postgres:16-alpine
  environment:
    POSTGRES_DB: authentik
    POSTGRES_USER: authentik
    POSTGRES_PASSWORD: ${AUTHENTIK_DB_PASSWORD}
  volumes:
    - authentik-db-data:/var/lib/postgresql/data
```

### Kubernetes

```yaml
# Server Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: authentik-server
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: server
          image: ghcr.io/goauthentik/server:2026.2.1
          command: ['ak', 'server']
          ports:
            - containerPort: 9000 # HTTP
            - containerPort: 9443 # HTTPS
          resources:
            requests: { cpu: 100m, memory: 256Mi }
            limits: { cpu: 1000m, memory: 512Mi }
          livenessProbe:
            httpGet: { path: '/-/health/live/', port: 9000 }
          readinessProbe:
            httpGet: { path: '/-/health/ready/', port: 9000 }
```

### Why No Redis?

Authentik 2026.2+ removed the Redis dependency. Session state and task queuing
use the built-in PostgreSQL backend. This simplifies the NEXUS Edge deployment
by eliminating one more infrastructure component.

---

## Conditional Authentication

Authentication is **disabled by default** in development:

```
AUTH_ENABLED=false    →  All requests bypass JWT validation
AUTH_ENABLED=true     →  Full OIDC/PKCE + JWT validation active
```

This is controlled via:

- Docker: `AUTH_ENABLED` env var in docker-compose.yml
- K8s: `gateway-core-config` ConfigMap

When disabled, Gateway Core skips the auth middleware entirely — no token
required. The Web UI shows no login flow and hides user/role UI elements.

---

## Related Documentation

- [Security Hardening](security_hardening.md) — production auth configuration
- [Docker Compose](docker_compose.md) — Authentik container setup
- [Configuration Reference](configuration_reference.md) — auth environment variables
- [TLS & Certificates](tls_certificates.md) — HTTPS for Authentik

---

_Document Version: 1.0_
_Last Updated: March 2026_
