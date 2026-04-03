# Chapter 5 — Auth Architecture

> OIDC Authorization Code flow with PKCE, Authentik integration, token lifecycle,
> and role-based access — all implemented with zero external auth libraries.

---

## Overview

The Web UI authenticates users via **OAuth2 Authorization Code + PKCE** against
Authentik as the OIDC identity provider. The implementation uses native browser
crypto APIs — no `oidc-client-ts`, no `@auth0/auth0-react`, no auth middleware.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         AUTH ARCHITECTURE                                       │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                          WEB UI (Browser)                                 │  │
│  │                                                                           │  │
│  │  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────────────────┐  │  │
│  │  │  auth.ts    │  │  AuthContext.tsx │  │  ProtectedRoute.tsx          │  │  │
│  │  │             │  │                  │  │                              │  │  │
│  │  │ PKCE gen    │  │  AuthProvider    │  │  Wraps all app routes        │  │  │
│  │  │ Token fetch │  │  useAuth hook    │  │  Checks isAuthenticated      │  │  │
│  │  │ Token store │  │  State: user,    │  │  Redirects to /login         │  │  │
│  │  │ 401 refresh │  │  token, roles    │  │  or renders children         │  │  │
│  │  │             │  │  login/logout    │  │                              │  │  │
│  │  └──────┬──────┘  └────────┬─────────┘  └──────────────────────────────┘  │  │
│  │         │                  │                                              │  │
│  │         │    Token storage: sessionStorage                                │  │
│  │         │    Keys: access_token, refresh_token, pkce_verifier             │  │
│  │         │                                                                 │  │
│  └─────────┼──────────────────┼──────────────────────────────────────────────┘  │
│            │                  │                                                 │
│  ┌─────────▼──────────────────▼──────────────────────────────────────────────┐  │
│  │                         AUTHENTIK (OIDC Provider)                         │  │
│  │                                                                           │  │
│  │  /.well-known/openid-configuration  ←  Runtime discovery                  │  │
│  │  /authorize                          ←  PKCE authorization request        │  │
│  │  /token                              ←  Code-for-token exchange           │  │
│  │  /userinfo                           ←  User profile + roles              │  │
│  │  /end-session                        ←  Logout (revoke session)           │  │
│  │                                                                           │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## OIDC Discovery (Runtime)

Auth is **not assumed** — the app probes for OIDC at startup:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      AUTH DETECTION SEQUENCE                                    │
│                                                                                 │
│  App boots (AuthProvider mounts)                                                │
│       │                                                                         │
│       ▼                                                                         │
│  GET /.well-known/openid-configuration                                          │
│       │                                                                         │
│       ├── 200 OK (JSON with endpoints)                                          │
│       │   │                                                                     │
│       │   ├── Store authorization_endpoint                                      │
│       │   ├── Store token_endpoint                                              │
│       │   ├── Store userinfo_endpoint                                           │
│       │   ├── Store end_session_endpoint                                        │
│       │   │                                                                     │
│       │   ├── Check sessionStorage for existing tokens                          │
│       │   │   ├── Found + valid ──> isAuthenticated = true                      │
│       │   │   │                     Fetch userinfo, extract roles               │
│       │   │   └── Not found ──────> isAuthenticated = false                     │
│       │   │                         Show login page                             │
│       │   │                                                                     │
│       │   └── authEnabled = true                                                │
│       │                                                                         │
│       └── Error (network, 404, etc.)                                            │
│           │                                                                     │
│           └── authEnabled = false                                               │
│               All routes accessible without login                               │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Why runtime detection?** The same Docker image deploys to both authenticated
(production with Authentik) and unauthenticated (development without Authentik)
environments. No build-time flags needed.

---

## PKCE Flow

### Step 1: Generate PKCE Parameters

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PKCE GENERATION                                         │
│                                                                                 │
│  1. Generate code_verifier (43-128 char random string)                          │
│     crypto.getRandomValues(new Uint8Array(32))                                  │
│     → base64url encode → 43-char string                                         │
│                                                                                 │
│  2. Derive code_challenge                                                       │
│     SHA-256(code_verifier)                                                      │
│     → base64url encode                                                          │
│     → code_challenge                                                            │
│                                                                                 │
│  3. Store code_verifier in sessionStorage                                       │
│     (needed later for token exchange)                                           │
│                                                                                 │
│  Note: All crypto operations use Web Crypto API:                                │
│  - crypto.getRandomValues() for random bytes                                    │
│  - crypto.subtle.digest('SHA-256', ...) for hashing                             │
│  - No external dependencies                                                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Step 2: Authorization Request

User clicks "Sign in with SSO" → browser redirects to Authentik:

```
GET {authorization_endpoint}?
  response_type=code
  &client_id={client_id}
  &redirect_uri={origin}/auth/callback
  &scope=openid profile email
  &code_challenge={code_challenge}
  &code_challenge_method=S256
  &state={random_state}
```

### Step 3: User Authenticates

Authentik presents its login UI. User enters credentials (or uses existing session).
On success, Authentik redirects back to the app:

```
GET /auth/callback?code={authorization_code}&state={state}
```

### Step 4: Token Exchange

The `AuthCallbackPage` component handles the redirect:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      TOKEN EXCHANGE                                             │
│                                                                                 │
│  AuthCallbackPage receives ?code=xxx&state=yyy                                  │
│       │                                                                         │
│       ├── Verify state matches stored state (CSRF protection)                   │
│       │                                                                         │
│       ├── Retrieve code_verifier from sessionStorage                            │
│       │                                                                         │
│       ├── POST {token_endpoint}                                                 │
│       │   Content-Type: application/x-www-form-urlencoded                       │
│       │                                                                         │
│       │   grant_type=authorization_code                                         │
│       │   &code={authorization_code}                                            │
│       │   &redirect_uri={origin}/auth/callback                                  │
│       │   &client_id={client_id}                                                │
│       │   &code_verifier={code_verifier}                                        │
│       │                                                                         │
│       ├── Response: { access_token, refresh_token, id_token, expires_in }       │
│       │                                                                         │
│       ├── Store tokens in sessionStorage                                        │
│       │                                                                         │
│       ├── Fetch userinfo to get profile + roles                                 │
│       │                                                                         │
│       └── Navigate to /dashboard                                                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Token Storage

| Key | Storage | Contents | Lifetime |
|-----|---------|----------|----------|
| `access_token` | sessionStorage | JWT for API calls | Until tab close or expiry |
| `refresh_token` | sessionStorage | Opaque token for refresh | Until tab close |
| `pkce_verifier` | sessionStorage | PKCE code verifier | Until token exchange |

**Why sessionStorage over localStorage?**
- Cleared when browser tab closes (security benefit)
- Not shared across tabs (prevents cross-tab token confusion)
- Not accessible from other origins (same-origin policy)
- Acceptable trade-off: user must re-authenticate in new tabs

---

## API Request Authentication

Every API call in `lib/api.ts` attaches the Bearer token:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATED REQUEST FLOW                                   │
│                                                                                 │
│  Component calls API function (e.g., devicesApi.list())                         │
│       │                                                                         │
│       ▼                                                                         │
│  api.ts: getAccessToken()                                                       │
│       │                                                                         │
│       ├── Read access_token from sessionStorage                                 │
│       │                                                                         │
│       ├── If token exists:                                                      │
│       │   └── Add header: Authorization: Bearer {access_token}                  │
│       │                                                                         │
│       └── If no token:                                                          │
│           └── Send request without auth header                                  │
│               (works when auth is disabled)                                     │
│                                                                                 │
│  fetch(url, { headers: { Authorization: `Bearer ${token}` } })                  │
│       │                                                                         │
│       ├── 200 OK ──> Return data                                                │
│       │                                                                         │
│       └── 401 Unauthorized ──> Refresh flow                                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 401 Handling & Token Refresh

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    401 RECOVERY FLOW                                            │
│                                                                                 │
│  API returns 401 Unauthorized                                                   │
│       │                                                                         │
│       ▼                                                                         │
│  Check: has refresh_token?                                                      │
│       │                                                                         │
│       ├── Yes: POST {token_endpoint}                                            │
│       │        grant_type=refresh_token                                         │
│       │        &refresh_token={refresh_token}                                   │
│       │        &client_id={client_id}                                           │
│       │   │                                                                     │
│       │   ├── 200 OK: store new tokens, retry original request                  │
│       │   │                                                                     │
│       │   └── Error: redirect to /login                                         │
│       │                                                                         │
│       └── No: redirect to /login                                                │
│                                                                                 │
│  LOOP GUARD:                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  A 30-second cooldown prevents infinite redirect loops:                 │    │
│  │                                                                         │    │
│  │  • Store timestamp of last redirect to /login                           │    │
│  │  • If another 401 occurs within 30 seconds of last redirect:            │    │
│  │    → Do NOT redirect again                                              │    │
│  │    → Show error to user instead                                         │    │
│  │                                                                         │    │
│  │  This prevents: 401 → login → callback → 401 → login → ... (loop)       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Role Extraction

User roles are extracted from JWT claims returned by Authentik:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    ROLE HIERARCHY                                               │
│                                                                                 │
│  Authentik groups → JWT claims → Web UI roles                                   │
│                                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                     │
│  │  Authentik   │     │  JWT Claim   │     │   UI Role    │                     │
│  │  Group       │────>│  groups[]    │────>│              │                     │
│  ├──────────────┤     ├──────────────┤     ├──────────────┤                     │
│  │ nexus-admin  │     │ "nexus-admin"│     │ admin        │  Full access        │
│  │ nexus-eng    │     │ "nexus-eng"  │     │ engineer     │  CRUD devices/tags  │
│  │ nexus-op     │     │ "nexus-op"   │     │ operator     │  View + toggle      │
│  │ nexus-viewer │     │ "nexus-view" │     │ viewer       │  Read-only          │
│  └──────────────┘     └──────────────┘     └──────────────┘                     │
│                                                                                 │
│  Priority: admin > engineer > operator > viewer                                 │
│  If user belongs to multiple groups, highest role wins.                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## AuthContext API

The `AuthProvider` exposes the following via `useAuth()` hook:

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `authEnabled` | `boolean` | Whether OIDC discovery succeeded |
| `isAuthenticated` | `boolean` | Whether user has valid tokens |
| `isLoading` | `boolean` | Auth state being determined |
| `user` | `{ name, email, role } \| null` | Current user profile |
| `login()` | `() => void` | Initiates OIDC redirect |
| `logout()` | `() => void` | Clears tokens, redirects to Authentik end-session |
| `getToken()` | `() => string \| null` | Returns current access token |

---

## Logout Flow

```
User clicks Logout
     │
     ├── Clear sessionStorage (access_token, refresh_token)
     │
     ├── Clear AuthContext state (user, isAuthenticated)
     │
     └── Redirect to Authentik end_session_endpoint
         with post_logout_redirect_uri = {origin}/login
```

---

## Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Token theft (XSS) | sessionStorage not accessible cross-origin; CSP headers in production |
| CSRF | PKCE `state` parameter verified on callback |
| Token expiry | Automatic refresh on 401; redirect loop guard prevents loops |
| Redirect loop | 30-second cooldown between login redirects |
| Tab isolation | sessionStorage per-tab; no cross-tab token leakage |
| Supply chain | Zero auth dependencies; native Web Crypto API only |

---

## Related Documentation

- [Routing & Navigation](routing_navigation.md) — how ProtectedRoute integrates with React Router
- [API Client](api_client.md) — how Bearer tokens are attached to requests
- [Configuration Reference](configuration_reference.md) — OIDC-related environment variables
- [Edge Cases](edge_cases.md) — auth token expiry scenarios and recovery

---

*Document Version: 1.0*
*Last Updated: March 2026*
