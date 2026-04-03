# Chapter 1 — Executive Summary

> Gateway Core is the central API gateway and configuration owner for the NEXUS Edge platform.

---

## Purpose

Gateway Core serves as the **control plane** for the entire NEXUS Edge platform. It is the single point of entry for the web UI and any external system that needs to interact with the platform. Every device configuration, tag definition, and system management operation flows through this service.

## Key Capabilities

| Capability | Description |
|-----------|-------------|
| **Device & Tag Management** | Full CRUD for industrial device configurations and data tags with Zod-validated schemas |
| **Protocol-Agnostic Proxy** | Transparent HTTP proxy to protocol-gateway for test connections, OPC UA browse, certificate management |
| **MQTT Config Notifications** | Publishes device/tag changes to `$nexus/config/` topics so protocol-gateway reloads without restart |
| **Status Ingest** | Subscribes to `$nexus/status/` topics to receive real-time device status from protocol-gateway |
| **Config Sync** | Responds to sync requests by publishing full device configuration (bulk) on protocol-gateway startup |
| **OIDC Authentication** | JWT verification via Authentik (or any OIDC provider) with automatic JWKS rotation |
| **Role-Based Access Control** | Four-tier role hierarchy (admin > engineer > operator > viewer) with per-route enforcement |
| **Audit Logging** | Immutable audit trail of all mutations (who did what, when, from where) |
| **WebSocket Bridge** | MQTT→WebSocket bridge with ref-counted subscriptions and topic ACL for live UI updates |
| **Prometheus Metrics** | HTTP, WebSocket, MQTT, and proxy metrics with route-level granularity |
| **Rate Limiting** | Configurable global and per-route throttling via @fastify/rate-limit |

## What This Service Does NOT Do

- **Does not connect to PLCs/devices** — that is the protocol-gateway's job
- **Does not store time-series data** — that is TimescaleDB via data-ingestion
- **Does not process/transform data** — it is a control plane, not a data plane
- **Does not serve the frontend** — the web-ui has its own Nginx container

## Design Philosophy

1. **Single source of truth**: PostgreSQL owns all configuration. Protocol-gateway receives config via MQTT notifications and treats it as authoritative.
2. **Protocol-agnostic**: Gateway Core has no knowledge of Modbus registers, OPC UA nodes, or S7 addresses. It stores them as opaque `address` strings and `protocolConfig` JSONB.
3. **Two-phase device setup**: Phase 1 creates the device and tests connectivity. Phase 2 browses available tags and adds them. This prevents half-configured devices from being polled.
4. **Best-effort notifications**: MQTT publishes are fire-and-forget (QoS 1). If protocol-gateway misses a notification, it can request a full sync.

## Scale

| Metric | Value |
|--------|-------|
| Codebase | ~2,375 lines TypeScript |
| Dependencies | 15 runtime, 10 dev |
| Docker image | ~120MB (node:20-alpine + prod deps) |
| Memory footprint | ~60–80MB at rest, ~120MB under load |
| Startup time | ~2–4s (including DB migration + MQTT connect) |

---

*Next: [Chapter 2 — System Overview](system_overview.md)*
