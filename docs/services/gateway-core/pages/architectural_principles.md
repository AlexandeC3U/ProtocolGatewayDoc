# Chapter 3 — Architectural Principles

> Design decisions, patterns, and trade-offs that shaped gateway-core.

---

## 1. Control Plane, Not Data Plane

Gateway Core handles **configuration and coordination only**. It never touches raw device data, never interprets Modbus registers, and never parses OPC UA nodes. This separation allows:

- Protocol-gateway (Go) to be optimized for high-throughput polling with goroutines
- Gateway Core (TypeScript) to focus on API ergonomics, validation, and developer experience
- Independent scaling — the control plane can remain a single instance while the data plane scales

```
  ┌─────────────────────────────────────────────────────┐
  │              CONTROL PLANE (gateway-core)           │
  │                                                     │
  │  • Device/Tag CRUD                                  │
  │  • Auth, RBAC, Audit                                │
  │  • Config notifications via MQTT                    │
  │  • Proxy to protocol-gateway for runtime operations │
  └─────────────────────────┬───────────────────────────┘
                            │ MQTT config / HTTP proxy
                            ▼
  ┌─────────────────────────────────────────────────────┐
  │               DATA PLANE (protocol-gateway)         │
  │                                                     │
  │  • PLC connections, polling, subscriptions          │
  │  • Data normalization, UNS publishing               │
  │  • Protocol-specific logic (Modbus, OPC UA, S7)     │
  └─────────────────────────────────────────────────────┘
```

## 2. PostgreSQL as Single Source of Truth

All device and tag configuration lives in PostgreSQL. Protocol-gateway is a consumer of this configuration, never an owner.

**Why not store config in protocol-gateway?**

- Protocol-gateway instances may restart, scale, or be replaced
- Multiple instances would need shared config (distributed state)
- PostgreSQL provides ACID guarantees, schema enforcement, and audit trails

**Config propagation:**

1. Web UI → gateway-core REST API → PostgreSQL (write)
2. Gateway Core → MQTT `$nexus/config/` notification (push)
3. Protocol-gateway subscribes → applies config (pull)
4. On PG startup: publishes sync request → gateway-core sends bulk config

## 3. Protocol-Agnostic Design

Gateway Core stores protocol-specific details as **opaque data**:

- `protocol` — enum value (`modbus`, `opcua`, `s7`, `mqtt`, `bacnet`, `ethernetip`)
- `protocolConfig` — JSONB blob (contents vary by protocol)
- `address` — string (could be "40001" for Modbus or "ns=2;s=Temperature" for OPC UA)
- Protocol-specific tag columns (`opcNodeId`, `s7Address`, `registerType`) — nullable, used by transform layer

This means gateway-core can support new protocols without code changes — only the transform layer (`mqtt/transform.ts`) needs updating to map new fields to the protocol-gateway format.

## 4. Two-Phase Device Setup

Devices go through a controlled setup flow to prevent half-configured devices from being polled:

```
  ┌──────────┐    POST /api/devices     ┌──────────┐   POST /test     ┌───────────┐
  │          │ ──────────────────────>  │          │ ──────────────>  │           │
  │  (none)  │     Create device        │ created  │  Test connection │ connected │
  │          │                          │          │  (auto-promote)  │           │
  └──────────┘                          └──────────┘                  └─────┬─────┘
                                                                            │
                                              POST /api/tags (first tag)    │
                                         ┌──────────────────────────────────┘
                                         ▼
                                    ┌────────────┐    Device starts    ┌──────────┐
                                    │            │    receiving data   │          │
                                    │ configured │ ──────────────────> │  active  │
                                    │            │    (status=online)  │          │
                                    └────────────┘                     └──────────┘
```

**Rules:**

- `created` → device exists in DB but no connectivity verified
- `connected` → auto-promoted when test-connection succeeds
- `configured` → auto-promoted when first tag is added
- `active` → auto-promoted when protocol-gateway reports `status=online`

## 5. Best-Effort MQTT Notifications

MQTT config notifications are **fire-and-forget** with QoS 1 (at-least-once):

- If protocol-gateway is offline when a config change happens, it misses the notification
- On reconnect, protocol-gateway publishes a sync request to `$nexus/config/sync/request`
- Gateway Core responds with a bulk publish of all enabled devices + tags
- This provides **eventual consistency** without requiring protocol-gateway to have direct DB access

**Trade-off:** This means there's a brief window after a config change where protocol-gateway may have stale config. This is acceptable because:

1. Config changes are infrequent (human-driven, not automated)
2. The sync mechanism recovers state within seconds of reconnect
3. `configVersion` field allows protocol-gateway to detect staleness

## 6. Transform Layer Isolation

The `mqtt/transform.ts` module is the only place in gateway-core that knows about the protocol-gateway's expected data format. It converts DB entities (camelCase, nullable) to PG format (snake_case, defaults).

This isolation means:

- DB schema can evolve independently of the PG message format
- Protocol-gateway format changes only touch one file
- Testing is straightforward — input a DB entity, assert the PG format

---

_Previous: [Chapter 2 — System Overview](system_overview.md) | Next: [Chapter 4 — Layer Architecture](layer_architecture.md)_
