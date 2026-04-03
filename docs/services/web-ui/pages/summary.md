# Chapter 1 — Executive Summary

> The Web UI is NEXUS Edge's operator-facing application — a React SPA purpose-built
> for industrial device management in 24/7 control room environments.

---

## Purpose

The Web UI is the **human interface** to the NEXUS Edge platform. It gives plant
operators, engineers, and administrators a single pane of glass for:

- **Device lifecycle management** — create, configure, test, enable, and monitor
  industrial devices across 6 protocols (Modbus, OPC UA, S7, MQTT, BACnet, EtherNet/IP)
- **Tag configuration** — browse OPC UA address spaces, bulk-create tags, configure
  scaling/deadband/clamping, and manage data collection points
- **System observability** — real-time health monitoring of all platform services,
  embedded Grafana dashboards, architecture visualization
- **Authentication & authorization** — SSO via Authentik (OIDC/PKCE), role-based
  access control, secure session management

---

## What It Is

| Aspect | Description |
|--------|------------|
| **Type** | Single-Page Application (SPA) |
| **Framework** | React 18 + TypeScript 5.4 (strict mode) |
| **Build system** | Vite 5 with SWC for sub-second HMR |
| **Styling** | TailwindCSS 3.4, dark theme default, Delaware brand colors |
| **State** | TanStack Query v5 (server cache) — no Redux, no Zustand for app state |
| **Auth** | OIDC Authorization Code + PKCE (zero dependency, native crypto) |
| **Production** | Multi-stage Docker build → Nginx serving static + reverse proxying API |

---

## What It Is NOT

- **Not a dashboard builder** — it displays operational data, it does not let users
  design custom dashboards (Grafana handles that via iframe embed)
- **Not a historian UI** — historical data queries go through the Grafana integration;
  the Web UI focuses on device/tag CRUD and system health
- **Not a protocol configurator** — protocol implementation lives in the Protocol
  Gateway (Go); the Web UI only captures connection parameters
- **Not a standalone application** — it requires Gateway Core (REST API), Authentik
  (SSO), and optionally Grafana (dashboards)

---

## Key Capabilities

### Device Management

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DEVICE LIFECYCLE                                      │
│                                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │ Created  │───>│Connected │───>│Configured│───>│  Active  │                  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘                  │
│       │               │               │               │                         │
│   Create form    Test connection  Browse tags     Enable device                │
│   Set protocol   Validate params  Add/configure   Start polling               │
│   Set address    Check reachable  Set intervals   Monitor status              │
│                                                                                 │
│  Visual stepper on Device Detail page tracks progress through phases           │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Protocol-Specific Configuration

Each of the 6 supported protocols has its own configuration form component that
captures protocol-specific parameters:

| Protocol | Config Fields | Special Features |
|----------|--------------|-----------------|
| Modbus TCP | Slave ID, timeout, retries | Register type/address in tags |
| OPC UA | Security policy, mode, auth, subscriptions | Address space browser (tree) |
| Siemens S7 | Rack, slot, PDU size | Symbolic addressing (DB1.DBD0) |
| MQTT | Broker URL, client ID, credentials | Topic path as tag address |
| BACnet | Device instance | Generic address |
| EtherNet/IP | Slot number | Generic address |

### OPC UA Address Space Browser

The Browse Dialog enables OPC UA tag discovery — a tree-based browser that:
- Lazy-loads child nodes on expansion
- Filters by name or Node ID
- Supports checkbox selection of Variable nodes
- Bulk-creates tags from selected nodes

### System Observability

- **Service health cards** — Gateway Core, PostgreSQL, MQTT Broker, WebSocket status
- **Architecture diagram** — interactive React Flow visualization of platform topology
- **Grafana embed** — dedicated health page with embedded Grafana dashboards
- **Dashboard** — at-a-glance stats (device count, online count, tag count, system status)

---

## Design Philosophy

### Industrial-First

The UI is designed for industrial environments, not consumer web apps:
- **Dark theme default** — reduced eye strain for operators in dimly-lit control rooms
- **High contrast** — status indicators are immediately visible at arm's length
- **Information density** — device cards show protocol, address, status, poll interval,
  setup progress, and last-seen time without expanding
- **Color-coded protocols** — each protocol has a distinct sidebar stripe color for
  instant visual identification

### Delaware Branding

The application carries Delaware consulting branding:
- Primary red (`#c42828`) and teal (`#72c4bf`) accent colors
- Delaware logo on login page
- "Secured by Authentik · delaware" footer on auth screens
- Custom CSS variables integrated into the Tailwind theme

### Minimalist State Management

The UI deliberately avoids complex client-side state management:
- **TanStack Query** handles all server state (devices, tags, health)
- **React Context** handles auth state (user, token, login/logout)
- **Component state** handles UI state (form values, dialogs, filters)
- No Redux, no MobX, no Zustand for application state — server is the source of truth

---

## Target Users

| Role | Primary Use Cases |
|------|------------------|
| **Operator** | Monitor device status, view health, observe data flow |
| **Engineer** | Configure devices and tags, test connections, browse OPC UA |
| **Administrator** | Manage all devices, view audit logs, system administration |
| **Viewer** | Read-only access to device status and system health |

---

## Related Documentation

- [System Overview](system_overview.md) — full architecture diagram and dependency graph
- [Component Architecture](component_architecture.md) — page structure and UI patterns
- [Auth Architecture](auth_architecture.md) — OIDC/PKCE flow details
- [API Client](api_client.md) — typed REST client implementation

---

*Document Version: 1.0*
*Last Updated: March 2026*
