# Chapter 9 — Real-time Architecture

> WebSocket and MQTT integration for live device status updates,
> current capabilities, and planned enhancements.

---

## Overview

The Web UI has **infrastructure in place** for real-time updates but the feature
is in early stages. The current implementation:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     REAL-TIME DATA FLOW                                         │
│                                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  PLCs /  │    │  Protocol    │    │    EMQX      │    │  Gateway     │      │
│  │  Devices │───>│  Gateway     │───>│   Broker     │───>│  Core        │      │
│  │          │    │  (Go)        │    │              │    │              │      │
│  └──────────┘    └──────────────┘    └──────────────┘    └──────┬───────┘      │
│                                                                  │              │
│                                                          MQTT→WS Bridge        │
│                                                                  │              │
│                                                                  ▼              │
│                                                         ┌──────────────┐       │
│                                                         │   Web UI     │       │
│                                                         │  (Browser)   │       │
│                                                         │              │       │
│                                                         │  mqtt.js     │       │
│                                                         │  over WS     │       │
│                                                         └──────────────┘       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Current State

### What's Available

| Component | Status | Details |
|-----------|--------|---------|
| Gateway Core MQTT→WS bridge | Implemented | Ref-counted subscriptions, topic filtering |
| mqtt.js dependency | Installed | v5.5.0 in package.json |
| VITE_WS_URL build arg | Available | Dockerfile supports WS URL configuration |
| System page WS status card | Implemented | Shows WebSocket connection status |

### What's Polling-Based (Current)

| Data | Method | Interval | Page |
|------|--------|----------|------|
| Device status | HTTP GET `/api/devices` | 30s | Dashboard |
| System health | HTTP GET `/health/ready` | 15s | Dashboard |
| Service health | HTTP GET `/api/system/health` | 10s | System |
| Tag data | HTTP GET `/api/tags` | On demand | Tags |

---

## Gateway Core WebSocket Bridge

Gateway Core provides an MQTT-to-WebSocket bridge that the Web UI can connect to:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    GATEWAY CORE WS BRIDGE                                       │
│                                                                                 │
│  Browser (mqtt.js)                    Gateway Core                    EMQX      │
│       │                                    │                           │        │
│       │  1. WS connect                     │                           │        │
│       │  ws://gateway-core:3001/ws         │                           │        │
│       │ ─────────────────────────>         │                           │        │
│       │                                    │                           │        │
│       │  2. MQTT SUBSCRIBE                 │                           │        │
│       │  topic: $nexus/status/#            │                           │        │
│       │ ─────────────────────────>         │                           │        │
│       │                                    │  3. Forward subscription  │        │
│       │                                    │ ────────────────────────> │        │
│       │                                    │                           │        │
│       │                                    │  4. MQTT PUBLISH          │        │
│       │                                    │  (device status change)   │        │
│       │                                    │ <──────────────────────── │        │
│       │  5. WS message                     │                           │        │
│       │  (device status update)            │                           │        │
│       │ <─────────────────────────         │                           │        │
│       │                                    │                           │        │
│       │  TanStack Query cache              │                           │        │
│       │  invalidated → UI re-renders       │                           │        │
│       │                                    │                           │        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Bridge Features (Gateway Core Side)

- **Ref-counted subscriptions** — multiple browser tabs subscribing to the same topic
  share a single EMQX subscription
- **Topic filtering** — clients can only subscribe to allowed topic patterns
- **Heartbeat** — ping/pong to detect dead connections
- **Authentication** — WS connections use the same JWT as REST API

---

## MQTT Topics Relevant to Web UI

| Topic Pattern | Direction | Content | Use Case |
|--------------|-----------|---------|----------|
| `$nexus/status/device/{id}` | EMQX → Browser | Device online/offline/error | Live status badges |
| `$nexus/status/service/{name}` | EMQX → Browser | Service health changes | System page cards |
| `dev/{deviceId}/{tagName}` | EMQX → Browser | Live tag values | Real-time data display |
| `$nexus/config/+/updated` | EMQX → Browser | Config change notifications | Cache invalidation |

---

## Planned WebSocket Integration

### Phase 1: Live Device Status (Planned)

Replace polling with WebSocket subscriptions for device status:

```
Current (polling):
  Dashboard → GET /api/devices every 30s → re-render device list

Planned (WebSocket):
  Dashboard → WS subscribe $nexus/status/device/# → instant re-render on change
```

**Benefits:**
- Instant status updates (vs 30s delay)
- Lower API load (no polling requests)
- Better UX (status badges update in real-time)

### Phase 2: Live Tag Values (Planned)

Stream live tag values for device detail pages:

```
DeviceDetailPage → WS subscribe dev/{deviceId}/# → live value column in tag table
```

### Phase 3: Config Change Notifications (Planned)

Use MQTT notifications to auto-invalidate TanStack Query cache:

```
WS subscribe $nexus/config/+/updated
  → on message: queryClient.invalidateQueries({ queryKey: ['devices'] })
  → UI automatically refetches and re-renders
```

This eliminates the need for manual refetch intervals entirely.

---

## mqtt.js Client Pattern

The mqtt.js library (v5.5.0) supports MQTT over WebSocket natively:

```typescript
import mqtt from 'mqtt';

// Connect to Gateway Core WS bridge
const client = mqtt.connect('ws://gateway-core:3001/ws', {
  clientId: `web-ui-${Date.now()}`,
  username: accessToken,  // JWT as MQTT username
  clean: true,
});

client.on('connect', () => {
  client.subscribe('$nexus/status/device/#');
});

client.on('message', (topic, payload) => {
  const status = JSON.parse(payload.toString());
  // Update TanStack Query cache or trigger refetch
  queryClient.setQueryData(['device', status.deviceId], (old) => ({
    ...old,
    status: status.status,
    lastSeen: status.timestamp,
  }));
});
```

---

## Related Documentation

- [State Management](state_management.md) — how TanStack Query integrates with real-time data
- [System Overview](system_overview.md) — WebSocket in the architecture diagram
- [Configuration Reference](configuration_reference.md) — VITE_WS_URL environment variable
- Gateway Core: [WebSocket Bridge](../../gateway-core/pages/websocket_bridge.md)

---

*Document Version: 1.0*
*Last Updated: March 2026*
