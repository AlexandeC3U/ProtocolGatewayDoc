# Chapter 3 — Architectural Principles

> Design decisions, patterns, and trade-offs that shape the Web UI codebase.

---

## Core Principles

### 1. Server Is the Source of Truth

The Web UI has **no local database, no persistent client-side store**. All device,
tag, and health data lives in Gateway Core's PostgreSQL and is fetched on demand via
REST. This means:

- **No state synchronization** — the server is always authoritative
- **No offline mode** — the app requires Gateway Core to function
- **Simpler mental model** — "fetch, display, mutate, invalidate" is the entire data flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      DATA OWNERSHIP MODEL                                       │
│                                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐           │
│  │     Web UI      │     │  Gateway Core   │     │   PostgreSQL    │           │
│  │                 │     │                 │     │                 │           │
│  │  Displays data  │────>│  Validates &    │────>│  Stores data    │           │
│  │  Captures input │<────│  transforms     │<────│  Source of truth│           │
│  │  Caches briefly │     │                 │     │                 │           │
│  │  (5s stale)     │     │  Publishes MQTT │     │                 │           │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘           │
│                                                                                 │
│  The UI never writes to a local store that needs syncing.                       │
│  Every mutation goes to the server; cache is invalidated on success.            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Trade-off:** No offline capability. Acceptable because NEXUS Edge operates on
local networks where the gateway is always reachable.

---

### 2. Colocation Over Abstraction

Each page owns its components, dialogs, and protocol configs. There is no
`components/devices/` shared across pages — the `DeviceDialog`, `BrowseDialog`,
`TagDialog`, and protocol configs all live under `src/pages/devices/`.

```
pages/devices/
├── DevicesPage.tsx          # Grid view, filters, CRUD actions
├── DeviceDetailPage.tsx     # Tabs: overview, tags, config
├── DeviceDialog.tsx         # Create/edit modal
├── BrowseDialog.tsx         # OPC UA address space browser
├── TagDialog.tsx            # Tag create/edit modal
└── protocols/               # Protocol-specific config forms
    ├── index.ts             # Component registry
    ├── ModbusConfig.tsx
    ├── OpcuaConfig.tsx
    ├── S7Config.tsx
    ├── MqttConfig.tsx
    ├── BacnetConfig.tsx
    └── EthernetipConfig.tsx
```

**Why:** Finding related code is trivial — everything for "devices" is in one folder.
Shared primitives (buttons, cards, inputs) live in `components/ui/`, but business
logic stays colocated with the page that uses it.

**Trade-off:** Some duplication between DeviceDialog and DeviceDetailPage. Acceptable
because each has different UX requirements.

---

### 3. TanStack Query as the State Layer

Rather than introducing Redux, Zustand, or MobX for state management, the app
uses TanStack Query as its **sole server state layer**:

| Concern | Solution |
|---------|---------|
| Fetching data | `useQuery` with query keys |
| Caching | Automatic, 5-second stale time |
| Background refresh | `refetchInterval` per query |
| Mutations | `useMutation` with `onSuccess` invalidation |
| Loading states | `isLoading`, `isPending` from query hooks |
| Error states | `isError`, `error` from query hooks |
| Optimistic updates | Not used (prefer consistency over speed) |

**Why not Redux/Zustand?** There is no client-only state complex enough to warrant
a dedicated store. Auth state lives in React Context. UI state (dialog open, filter
values, form state) lives in component `useState`. Everything else comes from the
server.

**Trade-off:** No time-travel debugging, no undo/redo. Acceptable for an operational
tool where server state is authoritative.

---

### 4. Zero-Dependency Auth

The OIDC/PKCE implementation in `lib/auth.ts` uses **no external auth libraries** —
no `oidc-client-ts`, no `react-oidc-context`, no `@auth0/auth0-react`. Instead:

- PKCE code verifier/challenge generated with `crypto.getRandomValues()` + `crypto.subtle.digest()`
- Token exchange via standard `fetch()` to Authentik's token endpoint
- Token storage in `sessionStorage` (not `localStorage` — cleared on tab close)
- Automatic 401 detection with refresh attempt + redirect loop guard (30s cooldown)

**Why?** Fewer dependencies = fewer supply chain risks, smaller bundle, no version
conflicts with React 18, and full control over the token lifecycle.

**Trade-off:** Must maintain OIDC compliance manually. Mitigated by Authentik being
a standards-compliant provider with well-documented endpoints.

---

### 5. Protocol-Agnostic UI with Protocol-Specific Forms

The device management UI is protocol-agnostic at the page level — `DevicesPage`,
`DeviceDetailPage`, and `DeviceDialog` work identically for all protocols. Protocol
specifics are isolated to:

1. **Protocol config components** — pluggable forms registered in `protocols/index.ts`
2. **Tag address fields** — the `TagDialog` renders different address inputs per protocol
3. **Visual indicators** — protocol badge colors and sidebar stripes

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PROTOCOL COMPONENT REGISTRY                                  │
│                                                                                 │
│  protocols/index.ts:                                                            │
│                                                                                 │
│  const PROTOCOL_CONFIG_COMPONENTS = {                                           │
│    modbus:     ModbusConfig,          // Slave ID, timeout, retries             │
│    opcua:      OpcuaConfig,           // Security, auth, subscriptions          │
│    s7:         S7Config,              // Rack, slot, PDU                        │
│    mqtt:       MqttConfig,            // Broker, client ID, credentials         │
│    bacnet:     BacnetConfig,          // Device instance                        │
│    ethernetip: EthernetipConfig,      // Slot number                           │
│  };                                                                             │
│                                                                                 │
│  Usage in DeviceDialog:                                                         │
│                                                                                 │
│  const ConfigComponent = PROTOCOL_CONFIG_COMPONENTS[form.protocol];             │
│  <ConfigComponent config={form.protocolConfig} onChange={handleConfigChange} />  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Adding a new protocol** requires only:
1. Create `NewProtocolConfig.tsx` with config form fields
2. Register it in `protocols/index.ts`
3. Add default config values to `getProtocolDefaults()`
4. Add tag address field handling in `TagDialog`

---

### 6. Radix UI + Tailwind (shadcn/ui Pattern)

UI components follow the [shadcn/ui](https://ui.shadcn.com/) pattern:

- **Radix UI** provides accessible, unstyled headless components (Dialog, Tabs, Toast,
  Tooltip, Select, Switch, Dropdown)
- **TailwindCSS** applies styling via utility classes
- **class-variance-authority (CVA)** manages component variants (button sizes, colors)
- **clsx + tailwind-merge** handles conditional class composition

```typescript
// Example: Button component with CVA variants
const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm ...",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground ...",
        destructive: "bg-destructive text-destructive-foreground ...",
        outline: "border border-input bg-background ...",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
  }
);
```

**Why not Material UI / Ant Design / Chakra?** These include opinionated styling that
conflicts with the Delaware brand dark theme. Radix + Tailwind gives full visual
control while maintaining accessibility.

---

### 7. Conditional Authentication

Auth is not hard-coded — it can be toggled at runtime:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    AUTH DETECTION FLOW                                           │
│                                                                                 │
│  App startup                                                                    │
│       │                                                                         │
│       ▼                                                                         │
│  Fetch /.well-known/openid-configuration                                        │
│       │                                                                         │
│       ├── 200 OK ──> Auth is ENABLED                                            │
│       │              • Login required                                            │
│       │              • OIDC flow active                                          │
│       │              • Bearer tokens on API calls                                │
│       │                                                                          │
│       └── Error ───> Auth is DISABLED                                            │
│                      • No login screen                                           │
│                      • All routes accessible                                     │
│                      • No Bearer tokens                                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Why runtime detection?** Development environments typically run without Authentik.
Rather than a build-time flag, the app probes the OIDC discovery endpoint and adapts.
This means the same Docker image works in both authenticated and unauthenticated
deployments.

---

### 8. Two-Phase Device Setup (UI Stepper)

The UI visualizes the two-phase device setup flow defined by Gateway Core:

| Phase | Steps | UI Representation |
|-------|-------|------------------|
| Phase 1 | Created → Connected | Device creation form, "Test Connection" button |
| Phase 2 | Configured → Active | Browse/add tags, enable device |

Each device card and detail page shows a **setup stepper** — a row of dots indicating
which phase the device has reached. This gives operators immediate visual feedback
on which devices are fully operational and which need attention.

---

## Patterns Summary

| Pattern | Implementation | Benefit |
|---------|---------------|---------|
| Server-first | TanStack Query, no local store | Simple, no sync bugs |
| Colocation | Page-level file organization | Easy to find related code |
| Headless UI | Radix + Tailwind + CVA | Full brand control + a11y |
| Plugin protocols | Component registry pattern | Easy to add new protocols |
| Runtime auth | OIDC discovery probe | Same image, any environment |
| Zero-dep auth | Native crypto APIs | Smaller bundle, fewer CVEs |
| Typed everything | TypeScript strict, Zod | Compile-time error catching |

---

## Related Documentation

- [Component Architecture](component_architecture.md) — detailed page and component structure
- [Auth Architecture](auth_architecture.md) — full OIDC/PKCE implementation details
- [State Management](state_management.md) — TanStack Query patterns and cache strategy
- [Design System](design_system.md) — theme, colors, and component variants

---

*Document Version: 1.0*
*Last Updated: March 2026*
