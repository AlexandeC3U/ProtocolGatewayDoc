# Chapter 16 — Edge Cases & Gotchas

> Operational notes, known limitations, auth recovery scenarios,
> and things that can go wrong in production.

---

## Authentication Edge Cases

### Token Expiry During Active Session

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TOKEN EXPIRY SCENARIO                                         │
│                                                                                 │
│  Operator is actively using the UI                                              │
│       │                                                                         │
│       ├── Access token expires (typically 5-15 min)                              │
│       │                                                                         │
│       ├── Next API call returns 401                                             │
│       │                                                                         │
│       ├── API client automatically:                                             │
│       │   1. Reads refresh_token from sessionStorage                            │
│       │   2. POSTs to Authentik /token endpoint                                 │
│       │   3. Stores new access_token                                            │
│       │   4. Retries original request                                           │
│       │                                                                         │
│       └── User sees: brief delay, then data loads normally                      │
│                                                                                 │
│  GOTCHA: If refresh token is also expired (long idle), user is                  │
│  redirected to login. This can be jarring mid-task.                             │
│                                                                                 │
│  MITIGATION: 30-second redirect loop guard prevents infinite                    │
│  login → callback → 401 → login cycles.                                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Authentik Unreachable

| Scenario | Behavior |
|----------|---------|
| Authentik down at app start | Auth detection fails → `authEnabled = false` → app works without login |
| Authentik down during session | Token refresh fails → redirect to login → login page can't redirect to Authentik |
| Authentik down, tokens still valid | App works normally until tokens expire |

**Gotcha:** If Authentik goes down and comes back up, existing sessions may be
invalidated. Users will need to re-authenticate.

### Multiple Browser Tabs

- Each tab has **independent** sessionStorage (by design)
- Logging out in one tab does NOT log out other tabs
- Each tab maintains its own token lifecycle
- No cross-tab token synchronization

**Gotcha:** Operator opens 3 tabs, logs out of one — the other 2 continue working
until their tokens expire. This is intentional (sessionStorage isolation) but can
be confusing.

---

## API & Network Edge Cases

### Gateway Core Unavailable

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    GATEWAY CORE DOWN                                             │
│                                                                                 │
│  Scenario: Gateway Core process crashes or network partition                    │
│                                                                                 │
│  Effect:                                                                        │
│  • All API calls fail with network error                                        │
│  • TanStack Query retries once (default config)                                 │
│  • After retry: error state shown on all pages                                  │
│  • Dashboard health cards show "Error"                                          │
│  • Device list shows error state with "Retry" button                            │
│                                                                                 │
│  Recovery:                                                                      │
│  • Gateway Core comes back → user clicks "Retry" → data loads                  │
│  • Or: TanStack Query auto-refetches on window focus                            │
│    (disabled by default — user must manually refresh)                            │
│                                                                                 │
│  GOTCHA: Error state persists until user action — there is no automatic         │
│  reconnection polling. This is intentional to avoid hammering a downed          │
│  service, but means the operator must manually verify recovery.                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Slow API Responses

| Duration | Effect |
|----------|--------|
| < 1s | Normal — user sees loading spinner briefly |
| 1-5s | Noticeable — spinner visible, but mutation buttons show loading state |
| 5-30s | Frustrating — no timeout by default, button stays in loading state |
| > 30s | Effective hang — browser may show "page unresponsive" |

**Gotcha:** Neither the API client nor TanStack Query have explicit request timeouts.
Very slow Gateway Core responses (e.g., OPC UA browse through a VPN) can leave the
UI in a loading state indefinitely.

**Mitigation:** Add `AbortController` with timeout to `apiFetch()`.

### Concurrent Mutations

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    RACE CONDITION SCENARIO                                       │
│                                                                                 │
│  Operator A: Editing device "PLC-1" name to "Main PLC"                         │
│  Operator B: Editing device "PLC-1" port to 503                                │
│                                                                                 │
│  Timeline:                                                                      │
│  T1: A reads device (name: "PLC-1", port: 502)                                │
│  T2: B reads device (name: "PLC-1", port: 502)                                │
│  T3: A saves (name: "Main PLC", port: 502)  ← A's change wins                 │
│  T4: B saves (name: "PLC-1", port: 503)     ← B overwrites A's name change!   │
│                                                                                 │
│  Result: name reverted to "PLC-1", port changed to 503                         │
│                                                                                 │
│  This is a classic "lost update" problem.                                       │
│                                                                                 │
│  MITIGATION: Gateway Core uses PATCH-style updates (only changed fields),       │
│  reducing but not eliminating the window. Full ETag/optimistic concurrency      │
│  control is not yet implemented.                                                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## UI Edge Cases

### Device Dialog Protocol Switching

When changing a device's protocol in the edit dialog, the protocol config form
resets to defaults. This is intentional but can surprise users:

- User creates Modbus device with specific config
- User opens edit dialog, changes protocol to OPC UA
- Modbus config is replaced with OPC UA defaults
- If user switches back to Modbus, the original config is **lost**

**Gotcha:** There is no "are you sure?" confirmation when switching protocols.

### OPC UA Browse with Many Nodes

- The Browse Dialog loads children lazily, but deep trees with many nodes can
  cause performance issues
- Each expand is a synchronous API call — expanding many nodes in rapid succession
  queues requests
- No virtualization in the tree — rendering 1000+ nodes may cause jank

**Mitigation:** Browse typically targets specific paths. Production OPC UA servers
rarely have flat lists of 1000+ children at a single level.

### Tag Pagination Offset Drift

When tags are created or deleted while the operator is on a specific page of the
tag table, the offset can drift:

- Operator is viewing tags 26-50 (page 2)
- Another user deletes tag #10
- Server now has 155 tags instead of 156
- Page 2 offset still says 25 → may show a tag that was on page 1, or skip one

**Mitigation:** Keyset pagination (cursor-based) would solve this, but offset
pagination is used currently for simplicity.

---

## Stale Cache Scenarios

### Config Changed Outside Web UI

If someone modifies a device directly in PostgreSQL or via the Gateway Core API
(e.g., curl), the Web UI won't know about it until:

- The 5-second stale time expires and user triggers a refetch
- User manually refreshes the page
- A TanStack Query refetch interval fires (Dashboard only)

**Future fix:** WebSocket config change notifications would solve this — see
[Real-time Architecture](realtime_architecture.md).

### Browser Back Button + Stale Data

```
Devices list → Device detail → Edit device → Save → Back button
                                                      │
                                                      ▼
                                            Devices list shows STALE data
                                            (TQ cache may be older than 5s)
```

TanStack Query mitigates this — the cache is still relatively fresh. But on slow
networks or after long operations, the user may briefly see outdated data.

---

## Build & Deploy Gotchas

### VITE_* Variables Are Build-Time

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  COMMON MISTAKE                                                                 │
│                                                                                 │
│  ✗ Setting VITE_API_URL at Docker runtime (has no effect)                       │
│    docker run -e VITE_API_URL=https://api.example.com nexus/web-ui             │
│                                                                                 │
│  ✓ Setting VITE_API_URL at Docker BUILD time                                    │
│    docker build --build-arg VITE_API_URL=https://api.example.com ...           │
│                                                                                 │
│  Vite replaces import.meta.env.VITE_API_URL with a string literal              │
│  during the build step. The runtime container has no access to Vite.            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Nginx Proxy Hostnames

In Docker Compose, `gateway-core` in `nginx.conf` resolves via Docker DNS. If the
service name changes in `docker-compose.yml`, the nginx config must also be updated.

In Kubernetes, `gateway-core` must match the Service name in the nexus namespace.

### Source Maps in Production

Source maps are enabled (`sourcemap: true`) which means:
- DevTools can show original TypeScript source
- Source map files are ~2x the size of the JS bundle
- They are only downloaded when DevTools is open
- **Security note:** Source maps expose source code to anyone with DevTools

For sensitive deployments, consider disabling source maps: `build.sourcemap: false`.

---

## Known Limitations

| Limitation | Impact | Workaround |
|-----------|--------|-----------|
| No offline mode | UI blank when Gateway Core down | Edge deployment: GC is always local |
| No request timeout | UI hangs on slow API responses | Browser native timeout eventually triggers |
| No optimistic updates | Brief flash of old data after mutation | Small delay, acceptable |
| No WebSocket live updates | Status updates on polling interval | Dashboard polls every 15-30s |
| Single-language (English) | No i18n | Sufficient for current user base |
| No dark/light toggle | Dark only | Intentional for control room use |

---

## Related Documentation

- [Auth Architecture](auth_architecture.md) — token lifecycle details
- [State Management](state_management.md) — cache invalidation strategy
- [Real-time Architecture](realtime_architecture.md) — planned WebSocket improvements
- [API Client](api_client.md) — error handling flow

---

*Document Version: 1.0*
*Last Updated: March 2026*
