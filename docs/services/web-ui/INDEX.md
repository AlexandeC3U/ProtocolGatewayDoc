# Web UI Service — Documentation Index

> Modern React application for NEXUS Edge industrial device management.
> Dark-themed, protocol-aware, built for 24/7 control room environments.

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              WEB UI SERVICE                                     │
│                                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │                         REACT APPLICATION                                 │  │
│  │                                                                           │  │
│  │  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  ┌────────────┐   │  │
│  │  │    Pages     │  │  Components   │  │  Providers    │  │   Hooks    │   │  │
│  │  │              │  │               │  │               │  │            │   │  │
│  │  │ Dashboard    │  │ Layout        │  │ AuthProvider  │  │ useQuery   │   │  │
│  │  │ Devices      │  │ ProtectedRoute│  │ QueryClient   │  │ useMutation│   │  │
│  │  │ DeviceDetail │  │ ui/ (Radix)   │  │ BrowserRouter │  │ useToast   │   │  │
│  │  │ Tags         │  │ ArchDiagram   │  │ Toaster       │  │ useAuth    │   │  │
│  │  │ System       │  │ Protocol/*    │  │               │  │            │   │  │
│  │  │ Health       │  │               │  │               │  │            │   │  │
│  │  │ Login        │  │               │  │               │  │            │   │  │
│  │  └──────┬───────┘  └───────────────┘  └───────────────┘  └────────────┘   │  │
│  │         │                                                                 │  │
│  │         ▼                                                                 │  │
│  │  ┌──────────────────────────────────────────────────────────────────────┐ │  │
│  │  │                     API CLIENT (lib/api.ts)                          │ │  │
│  │  │                                                                      │ │  │
│  │  │  devicesApi    tagsApi    healthApi    systemApi    historianApi     │ │  │
│  │  │  CRUD+toggle   CRUD+bulk  ready/live   health/info  history query    │ │  │
│  │  └──────────────────────────────┬───────────────────────────────────────┘ │  │
│  │                                 │                                         │  │
│  └─────────────────────────────────┼─────────────────────────────────────────┘  │
│                                    │                                            │
│           ┌────────────────────────┼─────────────────────────┐                  │
│           │  HTTP/REST             │  OIDC/OAuth2            │                  │
│           ▼                        ▼                         ▼                  │
│  ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐            │
│  │  Gateway Core   │    │    Authentik     │    │     Grafana      │            │
│  │  (Port 3001)    │    │  (OIDC Provider) │    │   (Dashboards)   │            │
│  │                 │    │                  │    │                  │            │
│  │  REST API       │    │  PKCE Flow       │    │  Iframe embed    │            │
│  │  WebSocket      │    │  JWT tokens      │    │  /grafana/d/...  │            │
│  └─────────────────┘    └──────────────────┘    └──────────────────┘            │
│                                                                                 │
│  Production: Nginx serves static + reverse-proxies API, Grafana                 │
│  Development: Vite dev server + HMR + proxy to localhost:3001                   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

| #   | Chapter                                                       | Description                                               |
| --- | ------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | [Executive Summary](pages/summary.md)                         | Purpose, capabilities, design philosophy                  |
| 2   | [System Overview](pages/system_overview.md)                   | Architecture diagram, dependency graph, port map          |
| 3   | [Architectural Principles](pages/architectural_principles.md) | Design decisions, patterns, trade-offs                    |
| 4   | [Component Architecture](pages/component_architecture.md)     | Pages, shared components, protocol configs, UI patterns   |
| 5   | [Auth Architecture](pages/auth_architecture.md)               | OIDC/PKCE flow, Authentik integration, token lifecycle    |
| 6   | [State Management](pages/state_management.md)                 | TanStack Query patterns, cache strategy, mutation flows   |
| 7   | [API Client](pages/api_client.md)                             | Typed REST client, endpoint map, error handling           |
| 8   | [Routing & Navigation](pages/routing_navigation.md)           | React Router v6, protected routes, layout system          |
| 9   | [Real-time Architecture](pages/realtime_architecture.md)      | WebSocket integration, MQTT topic subscriptions           |
| 10  | [Design System](pages/design_system.md)                       | Dark theme, Tailwind config, shadcn/ui, Delaware branding |
| 11  | [Deployment](pages/deployment.md)                             | Docker multi-stage, Nginx config, Kubernetes manifests    |
| 12  | [Testing Strategy](pages/testing_strategy.md)                 | Vitest, React Testing Library, test patterns              |
| 13  | [Performance](pages/performance.md)                           | Code splitting, caching, bundle optimization              |
| 14  | [Accessibility](pages/accessibility.md)                       | WCAG AA, keyboard navigation, ARIA patterns               |
| 15  | [Configuration Reference](pages/configuration_reference.md)   | All env vars, Vite config, Nginx config                   |
| 16  | [Edge Cases & Gotchas](pages/edge_cases.md)                   | Auth expiry, API timeouts, stale cache, known limitations |
| 17  | [Appendices](pages/appendices.md)                             | Dependency inventory, browser support, icon set           |

---

## Quick Reference

| Concern               | Where to Look                                          |
| --------------------- | ------------------------------------------------------ |
| Add a new page        | `src/pages/<name>/`, register in `App.tsx` routes      |
| Add a UI component    | `src/components/ui/` (shadcn/ui pattern)               |
| Add a protocol config | `src/pages/devices/protocols/`, register in `index.ts` |
| API endpoint          | `src/lib/api.ts` — all REST calls and types            |
| Auth flow             | `src/lib/auth.ts` + `src/lib/AuthContext.tsx`          |
| Protected route       | `src/components/auth/ProtectedRoute.tsx`               |
| Styles / theme        | `src/styles/globals.css` + `tailwind.config.js`        |
| Dev proxy config      | `vite.config.ts` — `/api` and `/health` → `:3001`      |
| Production proxy      | `nginx.conf` — API, health, Grafana reverse proxies    |
| Build & deploy        | `Dockerfile` (multi-stage: pnpm build → nginx)         |
| Environment vars      | `.env` / build args: `VITE_API_URL`, `VITE_WS_URL`     |

---

## Tech Stack

| Layer         | Technology      | Version | Purpose                          |
| ------------- | --------------- | ------- | -------------------------------- |
| Framework     | React           | 18.3    | Component-based UI               |
| Build         | Vite + SWC      | 5.2     | Fast builds, HMR, proxy          |
| Language      | TypeScript      | 5.4     | Strict type safety               |
| Styling       | TailwindCSS     | 3.4     | Utility-first CSS, dark mode     |
| UI Primitives | Radix UI        | latest  | Accessible headless components   |
| Server State  | TanStack Query  | 5.32    | Caching, mutations, refetch      |
| Tables        | TanStack Table  | 8.17    | Headless table with pagination   |
| Routing       | React Router    | 6.23    | Client-side SPA routing          |
| Forms         | React Hook Form | 7.51    | Performant form handling         |
| Validation    | Zod             | 3.23    | Schema validation                |
| Icons         | Lucide React    | 0.378   | Consistent icon set              |
| Charts        | Recharts        | 3.8     | Data visualization               |
| Diagrams      | @xyflow/react   | 12.10   | Interactive architecture diagram |
| Auth          | Native OIDC     | —       | PKCE flow (zero dependencies)    |
| MQTT          | mqtt.js         | 5.5     | WebSocket MQTT client            |
| Production    | Nginx           | alpine  | Static serving, reverse proxy    |

---

## Protocol Support

| Protocol    | Config Component       | Key Fields                                |
| ----------- | ---------------------- | ----------------------------------------- |
| Modbus TCP  | `ModbusConfig.tsx`     | Slave ID, timeout, retries                |
| OPC UA      | `OpcuaConfig.tsx`      | Security policy/mode, auth, subscriptions |
| Siemens S7  | `S7Config.tsx`         | Rack, slot, PDU size                      |
| MQTT        | `MqttConfig.tsx`       | Broker URL, client ID, credentials        |
| BACnet      | `BacnetConfig.tsx`     | Device instance                           |
| EtherNet/IP | `EthernetipConfig.tsx` | Slot number                               |

---

## File Structure

```
services/web-ui/
├── src/
│   ├── main.tsx                          # Entry: QueryClient + AuthProvider + Router
│   ├── App.tsx                           # Route definitions (protected)
│   ├── lib/
│   │   ├── api.ts                        # Typed REST client (devices, tags, health)
│   │   ├── auth.ts                       # OIDC/PKCE implementation (Authentik)
│   │   ├── AuthContext.tsx               # React context for auth state
│   │   └── utils.ts                      # cn(), formatDate(), helpers
│   ├── components/
│   │   ├── auth/
│   │   │   └── ProtectedRoute.tsx        # Auth gate + loading state
│   │   ├── layout/
│   │   │   └── Layout.tsx                # Sidebar + topbar + Outlet
│   │   ├── system/
│   │   │   └── ArchitectureDiagram.tsx   # React Flow platform diagram
│   │   └── ui/                           # Radix-based primitives
│   │       ├── badge.tsx                 # Status/protocol badges
│   │       ├── button.tsx                # CVA button variants
│   │       ├── card.tsx                  # Card layout
│   │       ├── input.tsx                 # Form inputs
│   │       ├── separator.tsx             # Visual divider
│   │       ├── tabs.tsx                  # Tab navigation
│   │       ├── toaster.tsx               # Toast notifications
│   │       └── tooltip.tsx               # Hover tooltips
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx             # SSO login button
│   │   │   └── AuthCallbackPage.tsx      # OAuth2 callback handler
│   │   ├── dashboard/
│   │   │   └── DashboardPage.tsx         # Overview: stats, recent, health
│   │   ├── devices/
│   │   │   ├── DevicesPage.tsx           # Device grid + filters + CRUD
│   │   │   ├── DeviceDetailPage.tsx      # Tabs: overview, tags, config
│   │   │   ├── DeviceDialog.tsx          # Create/edit modal
│   │   │   ├── BrowseDialog.tsx          # OPC UA address space browser
│   │   │   ├── TagDialog.tsx             # Tag create/edit modal
│   │   │   └── protocols/               # Protocol-specific config forms
│   │   │       ├── index.ts             # Component registry
│   │   │       ├── ModbusConfig.tsx
│   │   │       ├── OpcuaConfig.tsx
│   │   │       ├── S7Config.tsx
│   │   │       ├── MqttConfig.tsx
│   │   │       ├── BacnetConfig.tsx
│   │   │       └── EthernetipConfig.tsx
│   │   ├── tags/
│   │   │   ├── TagsPage.tsx             # Global tag table + filters
│   │   │   └── TagDetailPage.tsx        # Individual tag view
│   │   ├── health/
│   │   │   └── HealthPage.tsx           # Grafana iframe
│   │   └── system/
│   │       └── SystemPage.tsx           # Service health cards + diagram
│   └── styles/
│       └── globals.css                   # CSS variables, theme, custom classes
├── Dockerfile                            # Multi-stage: pnpm build → nginx
├── nginx.conf                            # Production reverse proxy
├── vite.config.ts                        # Dev proxy, SWC, path aliases
├── tailwind.config.js                    # Delaware brand, protocol colors
├── package.json                          # Dependencies & scripts
└── tsconfig.json                         # Strict TypeScript config
```

---

_Document Version: 1.0_
_Last Updated: March 2026_
_Service Version: web-ui v2.0_
