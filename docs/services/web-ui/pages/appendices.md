# Chapter 17 — Appendices

> Dependency inventory, browser support matrix, icon reference,
> and quick-reference tables.

---

## A. Dependency Inventory

### Production Dependencies

| Package | Version | Purpose | License |
|---------|---------|---------|---------|
| `react` | 18.3.1 | UI framework | MIT |
| `react-dom` | 18.3.1 | DOM rendering | MIT |
| `react-router-dom` | 6.23.1 | Client-side routing | MIT |
| `@tanstack/react-query` | 5.32.0 | Server state management | MIT |
| `@tanstack/react-table` | 8.17.3 | Headless table | MIT |
| `zustand` | 4.5.2 | State management (minimal usage) | MIT |
| `zod` | 3.23.8 | Schema validation | MIT |
| `react-hook-form` | 7.51.4 | Form handling | MIT |
| `mqtt` | 5.5.0 | MQTT over WebSocket | MIT |
| `@xyflow/react` | 12.10.0 | Interactive diagrams | MIT |
| `recharts` | 3.8.0 | Charts and graphs | MIT |
| `lucide-react` | 0.378.0 | Icon library | ISC |
| `class-variance-authority` | 0.7.0 | Component variants | Apache-2.0 |
| `clsx` | 2.1.1 | Conditional classes | MIT |
| `tailwind-merge` | 2.3.0 | Tailwind class deduplication | MIT |

### Radix UI Primitives

| Package | Purpose |
|---------|---------|
| `@radix-ui/react-dialog` | Modal dialogs |
| `@radix-ui/react-dropdown-menu` | Action menus |
| `@radix-ui/react-label` | Form labels |
| `@radix-ui/react-select` | Select dropdowns |
| `@radix-ui/react-slot` | Component composition |
| `@radix-ui/react-switch` | Toggle switches |
| `@radix-ui/react-tabs` | Tab navigation |
| `@radix-ui/react-toast` | Toast notifications |
| `@radix-ui/react-tooltip` | Hover tooltips |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `typescript` | 5.4.5 | Type system |
| `vite` | 5.2.11 | Build tool + dev server |
| `@vitejs/plugin-react-swc` | 3.6.0 | SWC-based React plugin |
| `vitest` | 1.6.0 | Test runner |
| `tailwindcss` | 3.4.3 | Utility CSS |
| `autoprefixer` | 10.4.19 | CSS vendor prefixes |
| `postcss` | 8.4.38 | CSS processing |
| `tailwindcss-animate` | latest | Animation utilities |
| `eslint` | latest | Code linting |
| `@typescript-eslint/*` | latest | TypeScript ESLint rules |

---

## B. Browser Support

| Browser | Minimum Version | Status | Notes |
|---------|----------------|--------|-------|
| Chrome | 90+ | Primary | Development and production target |
| Edge | 90+ | Supported | Chromium-based, same as Chrome |
| Firefox | 90+ | Supported | Full feature parity |
| Safari | 14+ | Supported | Requires BigInt, Web Crypto API |
| Mobile Chrome | 90+ | Limited | Responsive layout works but not primary target |
| Mobile Safari | 14+ | Limited | Responsive layout works but not primary target |
| IE 11 | — | Not supported | No ES module support |

### Required Browser APIs

| API | Used By | Fallback |
|-----|---------|---------|
| `fetch()` | API client | None (core requirement) |
| `crypto.getRandomValues()` | PKCE generation | None (auth fails without) |
| `crypto.subtle.digest()` | PKCE SHA-256 | None (auth fails without) |
| `sessionStorage` | Token storage | None (auth fails without) |
| `WebSocket` | MQTT.js | Polling fallback |
| `ResizeObserver` | React Flow | Layout may not adapt |
| `IntersectionObserver` | Lazy loading | Eager load fallback |

---

## C. Icon Reference (Lucide)

### Navigation Icons

| Icon | Component | Usage |
|------|-----------|-------|
| `LayoutDashboard` | Sidebar | Dashboard navigation |
| `Server` | Sidebar, cards | Devices navigation, device icon |
| `Tags` | Sidebar | Tags navigation |
| `Monitor` | Sidebar | System navigation |
| `Activity` | Sidebar | Health navigation |

### Action Icons

| Icon | Component | Usage |
|------|-----------|-------|
| `Plus` | Buttons | Create/Add actions |
| `Pencil` | Buttons | Edit actions |
| `Trash2` | Buttons | Delete actions |
| `Power` | Buttons | Toggle enable/disable |
| `RefreshCw` | Buttons | Retry/refresh actions |
| `MoreVertical` | Menus | Overflow action menu |
| `X` | Dialogs | Close dialog |

### Status Icons

| Icon | Component | Usage |
|------|-----------|-------|
| `CheckCircle` | Toast, status | Success indicator |
| `AlertCircle` | Toast, error | Error indicator |
| `AlertTriangle` | Warning | Warning indicator |
| `Loader2` | Loading | Spinning loader (with `animate-spin`) |
| `Wifi` | Status | Connection indicator |
| `WifiOff` | Status | Disconnected indicator |

### Content Icons

| Icon | Component | Usage |
|------|-----------|-------|
| `ChevronRight` | Tree | Collapsed node |
| `ChevronDown` | Tree | Expanded node |
| `Folder` | Browse | Object node |
| `FileText` | Browse | Variable node |
| `ArrowLeft` | Navigation | Back button |
| `ExternalLink` | Links | External link indicator |

---

## D. Protocol Reference

### Protocol Enum Values

```typescript
type Protocol = 'modbus' | 'opcua' | 's7' | 'mqtt' | 'bacnet' | 'ethernetip';
```

### Default Ports

| Protocol | Default Port | Transport |
|----------|-------------|-----------|
| Modbus TCP | 502 | TCP |
| OPC UA | 4840 | TCP |
| Siemens S7 | 102 | TCP (ISO-on-TCP) |
| MQTT | 1883 (plain) / 8883 (TLS) | TCP |
| BACnet/IP | 47808 | UDP |
| EtherNet/IP | 44818 | TCP/UDP |

### Tag Data Types

```typescript
type TagDataType =
  | 'bool'
  | 'int16' | 'uint16'
  | 'int32' | 'uint32'
  | 'int64' | 'uint64'
  | 'float32' | 'float64'
  | 'string';
```

### Status Enums

```typescript
type DeviceStatus = 'online' | 'offline' | 'error' | 'unknown';
type SetupStatus = 'created' | 'connected' | 'configured' | 'active';
type AccessMode = 'read' | 'write' | 'readwrite';
```

---

## E. API Error Codes

| HTTP Status | Code | Description | User-Facing Message |
|-------------|------|-------------|-------------------|
| 400 | `VALIDATION_ERROR` | Invalid request body | "Validation error: {details}" |
| 401 | `UNAUTHORIZED` | Missing or invalid token | Triggers refresh flow |
| 403 | `FORBIDDEN` | Insufficient permissions | "You don't have permission" |
| 404 | `NOT_FOUND` | Resource doesn't exist | "Device not found" |
| 409 | `CONFLICT` | Duplicate name or constraint | "A device with this name already exists" |
| 422 | `UNPROCESSABLE` | Business rule violation | Server-provided message |
| 500 | `INTERNAL_ERROR` | Server error | "An unexpected error occurred" |
| 502 | `BAD_GATEWAY` | Protocol Gateway unreachable | "Protocol Gateway is not responding" |
| 0 | `NETWORK_ERROR` | No network response | "Network error — is Gateway Core running?" |

---

## F. Quick Command Reference

```bash
# Development
pnpm install                  # Install dependencies
pnpm dev                      # Start dev server (5173)
pnpm build                    # Production build
pnpm preview                  # Preview prod build

# Quality
pnpm lint                     # ESLint check
pnpm lint:fix                 # Auto-fix lint issues
pnpm typecheck                # TypeScript check

# Docker
docker build -t nexus/web-ui .
docker run -p 80:80 nexus/web-ui

# Docker Compose (from project root)
docker compose up web-ui       # Start Web UI only
docker compose up -d           # Start all services
docker compose logs -f web-ui  # Follow logs
```

---

*Document Version: 1.0*
*Last Updated: March 2026*
