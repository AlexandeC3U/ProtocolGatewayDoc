# Chapter 4 — Component Architecture

> Page structure, shared components, protocol-specific forms, dialog patterns,
> and UI composition in the Web UI.

---

## Component Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          COMPONENT TREE                                         │
│                                                                                 │
│  <QueryClientProvider>                                                          │
│    <AuthProvider>                                                                │
│      <BrowserRouter>                                                            │
│        <Toaster />                                                              │
│        <Routes>                                                                 │
│          <Route path="/auth/callback" element={<AuthCallbackPage />} />         │
│          <Route path="/login" element={<LoginPage />} />                        │
│          <Route element={<ProtectedRoute />}>                                   │
│            <Route element={<Layout />}>                                         │
│              <Route path="/" element={<Navigate to="/dashboard" />} />          │
│              <Route path="/dashboard" element={<DashboardPage />} />            │
│              <Route path="/devices" element={<DevicesPage />} />                │
│              <Route path="/devices/:id" element={<DeviceDetailPage />} />       │
│              <Route path="/tags" element={<TagsPage />} />                      │
│              <Route path="/tags/:id" element={<TagDetailPage />} />             │
│              <Route path="/system" element={<SystemPage />} />                  │
│              <Route path="/health" element={<HealthPage />} />                  │
│            </Route>                                                             │
│          </Route>                                                               │
│        </Routes>                                                                │
│      </BrowserRouter>                                                           │
│    </AuthProvider>                                                              │
│  </QueryClientProvider>                                                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Page Components

### Dashboard Page (`pages/dashboard/DashboardPage.tsx`)

The landing page providing at-a-glance platform status.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Dashboard                                                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Total Devices│  │Online Devices│  │  Total Tags  │  │System Status │        │
│  │     12       │  │      8       │  │     156      │  │   Healthy    │        │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                                 │
│  Recent Devices                           System Health                         │
│  ┌────────────────────────────────┐       ┌──────────────────────────┐          │
│  │ ● Production PLC    modbus    │       │ ● Database      Online  │          │
│  │ ● OPC UA Server     opcua     │       │ ● MQTT Broker   Online  │          │
│  │ ● S7-1500           s7        │       │                         │          │
│  │ ● Temp Sensor       mqtt      │       │                         │          │
│  │ ● BACnet Device     bacnet    │       │                         │          │
│  └────────────────────────────────┘       └──────────────────────────┘          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| Data Source | Query Key | Refetch Interval |
|-------------|-----------|-----------------|
| Device stats | `['dashboard', 'devices']` | 30s |
| Tag count | `['dashboard', 'tags']` | 30s |
| System health | `['dashboard', 'health']` | 15s |
| Recent devices | derived from devices query | — |

---

### Devices Page (`pages/devices/DevicesPage.tsx`)

The primary device management interface.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Devices                                                        [+ Add Device] │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [Search...            ] [Protocol ▾] [Status ▾]                                │
│                                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │█                 │  │█                 │  │█                 │              │
│  │█ Production PLC  │  │█ OPC UA Server   │  │█ S7-1500         │              │
│  │█                 │  │█                 │  │█                 │              │
│  │█ modbus-tcp      │  │█ opcua           │  │█ s7              │              │
│  │█ 192.168.1.100   │  │█ 192.168.1.101   │  │█ 192.168.1.102   │              │
│  │█ :502            │  │█ :4840           │  │█ :102            │              │
│  │█                 │  │█                 │  │█                 │              │
│  │█ ● Online        │  │█ ● Online        │  │█ ◐ Error         │              │
│  │█ 1000ms poll     │  │█ 2000ms poll     │  │█ 500ms poll      │              │
│  │█                 │  │█                 │  │█                 │              │
│  │█ ○──●──○──○      │  │█ ○──○──●──○      │  │█ ●──○──○──○      │              │
│  │█ Setup: Connected│  │█ Setup: Config'd │  │█ Setup: Created  │              │
│  │█                 │  │█                 │  │█                 │              │
│  │█  [Edit] [⋮]     │  │█  [Edit] [⋮]     │  │█  [Edit] [⋮]     │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
│                                                                                 │
│  █ = Protocol color sidebar stripe (blue=modbus, amber=opcua, green=s7)        │
│  ● = Setup progress stepper (Created → Connected → Configured → Active)         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key patterns:**
- Responsive grid: 1 col (mobile) → 2 (sm) → 3 (lg) → 4 (xl)
- Protocol sidebar stripe: left border colored per protocol
- Setup stepper: 4-dot indicator showing device lifecycle progress
- Actions: click card = navigate to detail, Edit = dialog, overflow menu = toggle/delete
- Filters: real-time search, protocol dropdown, status dropdown
- Empty state: centered message with "Add Device" CTA

---

### Device Detail Page (`pages/devices/DeviceDetailPage.tsx`)

Full device view with three tabs.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ← Back    Production PLC                    [Test] [Toggle] [Edit] [Delete]   │
│            modbus-tcp · ● Online · Setup: Connected                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│  [Overview]  [Tags (24)]  [Configuration]                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  OVERVIEW TAB:                                                                  │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐              │
│  │ Connection                  │  │ Configuration               │              │
│  │                             │  │                             │              │
│  │ Protocol: modbus-tcp        │  │ Poll Interval: 1000ms       │              │
│  │ Host: 192.168.1.100         │  │ Timeout: 5000ms             │              │
│  │ Port: 502                   │  │ Retries: 3                  │              │
│  └─────────────────────────────┘  └─────────────────────────────┘              │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐              │
│  │ Status                      │  │ Metadata                    │              │
│  │                             │  │                             │              │
│  │ Status: Online              │  │ Created: 2026-03-15 10:30   │              │
│  │ Setup: Connected            │  │ Updated: 2026-03-20 14:22   │              │
│  │ Enabled: Yes                │  │                             │              │
│  │ Last Error: —               │  │                             │              │
│  └─────────────────────────────┘  └─────────────────────────────┘              │
│                                                                                 │
│  TAGS TAB:                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ [Browse OPC UA]  [+ Add Tag]                                           │    │
│  │                                                                         │    │
│  │ Name          │ Address        │ Type    │ Mode │ Unit │ On │ Actions  │    │
│  │───────────────┼────────────────┼─────────┼──────┼──────┼────┼──────────│    │
│  │ temperature   │ HR:40001       │ float32 │ read │ °C   │ ✓  │ [E] [D] │    │
│  │ pressure      │ HR:40003       │ float32 │ read │ bar  │ ✓  │ [E] [D] │    │
│  │ motor_speed   │ HR:40005       │ uint16  │ r/w  │ RPM  │ ✗  │ [E] [D] │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  CONFIGURATION TAB:                                                             │
│  Protocol-specific JSON config + device settings summary                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Tags Page (`pages/tags/TagsPage.tsx`)

Global tag management with pagination and advanced filters.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Tags                                                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  [Search...       ] [Device ▾] [Data Type ▾] [Access Mode ▾]                   │
│                                                                                 │
│  Name          │ Device         │ Address     │ Type    │ Mode │ Unit │ On     │
│  ──────────────┼────────────────┼─────────────┼─────────┼──────┼──────┼─────── │
│  temperature   │ Production PLC │ HR:40001    │ float32 │ read │ °C   │ ✓      │
│  pressure      │ Production PLC │ HR:40003    │ float32 │ read │ bar  │ ✓      │
│  motor_speed   │ Production PLC │ HR:40005    │ uint16  │ r/w  │ RPM  │ ✗      │
│  node_temp     │ OPC UA Server  │ ns=2;s=Tmp  │ float64 │ read │ °C   │ ✓      │
│  ...           │                │             │         │      │      │        │
│                                                                                 │
│  Showing 1-25 of 156 tags                              [← Prev] [Next →]       │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- Uses TanStack Table for headless table with sorting and pagination
- 25 tags per page
- Server-side pagination via API `offset` and `limit` params
- Filters: search, device, data type, access mode

---

### System Page (`pages/system/SystemPage.tsx`)

Service health monitoring and architecture visualization.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  System                                                                         │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ Gateway Core │  │  PostgreSQL  │  │ MQTT Broker  │  │  WebSocket   │        │
│  │              │  │              │  │              │  │              │        │
│  │  ● Online    │  │  ● Online    │  │  ● Online    │  │  ◐ Degraded  │        │
│  │  v2.0.0      │  │  v16.1       │  │  v5.x        │  │  12 clients  │        │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘        │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    ARCHITECTURE DIAGRAM (React Flow)                     │    │
│  │                                                                         │    │
│  │  ┌────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐            │    │
│  │  │ Web UI │───>│ Gateway  │───>│PostgreSQL│    │ Authentik│            │    │
│  │  │        │    │ Core     │───>│          │    │          │            │    │
│  │  │        │    │          │───>│   EMQX   │    │          │            │    │
│  │  └────────┘    └──────────┘    └──────────┘    └──────────┘            │    │
│  │                     │                                                   │    │
│  │              ┌──────▼──────┐                                            │    │
│  │              │  Protocol   │                                            │    │
│  │              │  Gateway    │                                            │    │
│  │              └─────────────┘                                            │    │
│  │                                                                         │    │
│  │  Interactive: nodes are draggable, edges show data flow direction       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

### Health Page (`pages/health/HealthPage.tsx`)

Embedded Grafana dashboard via iframe.

- URL: `/grafana/d/gateway-system/...`
- Nginx proxies `/grafana/` to Grafana at port 3000
- Fallback message if Grafana is unreachable
- Full-screen iframe with minimal chrome

---

### Auth Pages

**LoginPage** (`pages/auth/LoginPage.tsx`):
- Delaware branding: logo, brand name, tagline
- Single "Sign in with SSO" button that triggers OIDC redirect
- Only shown when auth is enabled (runtime detection)

**AuthCallbackPage** (`pages/auth/AuthCallbackPage.tsx`):
- Handles OAuth2 redirect from Authentik
- Extracts `code` from URL params
- Exchanges code for tokens using PKCE `code_verifier`
- Redirects to `/dashboard` on success
- Shows error state on failure

---

## Shared Components

### Layout (`components/layout/Layout.tsx`)

The main application shell wrapping all protected routes.

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌──────┐  NEXUS Edge                             [User] [⚙]   │
│  │      │                                                        │
│  │ SIDE │  ┌──────────────────────────────────────────────────┐  │
│  │ BAR  │  │                                                  │  │
│  │      │  │              <Outlet />                           │  │
│  │ 📊   │  │                                                  │  │
│  │ 🔧   │  │           (page content rendered here)           │  │
│  │ 🏷️   │  │                                                  │  │
│  │ 🖥️   │  │                                                  │  │
│  │ 📈   │  │                                                  │  │
│  │      │  │                                                  │  │
│  └──────┘  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

- Collapsible sidebar with icon + label navigation links
- Top bar with app name, user info, settings
- React Router `<Outlet />` renders active page
- Active link highlighted with accent color

### ProtectedRoute (`components/auth/ProtectedRoute.tsx`)

Wraps routes that require authentication:
- If auth disabled: renders children directly
- If auth enabled + authenticated: renders children
- If auth enabled + not authenticated: redirects to `/login`
- Shows loading spinner during auth check

### ArchitectureDiagram (`components/system/ArchitectureDiagram.tsx`)

Interactive platform topology built with `@xyflow/react`:
- Nodes represent services (Web UI, Gateway Core, Protocol Gateway, etc.)
- Edges show data flow between services
- Nodes are draggable for layout customization
- Color-coded by service status

### UI Primitives (`components/ui/`)

All built on Radix UI + Tailwind + CVA:

| Component | Radix Primitive | Variants |
|-----------|----------------|----------|
| `Button` | — | default, destructive, outline, ghost, link; sm, default, lg, icon |
| `Card` | — | Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| `Badge` | — | default, secondary, destructive, outline |
| `Input` | — | Standard text input with focus ring |
| `Tabs` | `@radix-ui/react-tabs` | Tabs, TabsList, TabsTrigger, TabsContent |
| `Tooltip` | `@radix-ui/react-tooltip` | Tooltip, TooltipTrigger, TooltipContent |
| `Toast` | `@radix-ui/react-toast` | Success, error, warning variants |
| `Separator` | `@radix-ui/react-separator` | Horizontal, vertical |

---

## Dialog Pattern

All dialogs (DeviceDialog, TagDialog, BrowseDialog) follow a consistent pattern:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         DIALOG LIFECYCLE                                        │
│                                                                                 │
│  1. Trigger                                                                     │
│     └── Button click (Add, Edit) sets dialog open state                         │
│                                                                                 │
│  2. Initialize form                                                             │
│     ├── Create mode: empty defaults + protocol defaults                         │
│     └── Edit mode: populate from existing entity                                │
│                                                                                 │
│  3. User interaction                                                            │
│     ├── Field updates via updateField(key, value)                               │
│     ├── Errors cleared per-field on change                                      │
│     └── Protocol config changes via nested handler                              │
│                                                                                 │
│  4. Submit                                                                      │
│     ├── Client-side validation (required fields, format checks)                 │
│     ├── useMutation → POST/PUT to API                                           │
│     ├── onSuccess: invalidate queries + toast + close dialog                    │
│     └── onError: toast error message                                            │
│                                                                                 │
│  5. Cleanup                                                                     │
│     └── Dialog close resets form state                                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Form State Management

Dialogs use local `useState` rather than React Hook Form for device/tag forms:

```typescript
const [form, setForm] = useState(buildInitialForm(device));
const [errors, setErrors] = useState<Record<string, string>>({});

const updateField = (key: string, value: unknown) => {
  setForm(prev => ({ ...prev, [key]: value }));
  setErrors(prev => {
    const next = { ...prev };
    delete next[key];
    return next;
  });
};
```

**Why `useState` over React Hook Form in dialogs?** The forms have dynamic fields
based on protocol type. Protocol config changes reset nested field groups. This
dynamic behavior is simpler with explicit state than RHF's registration model.

---

## Protocol Config Components

Each protocol config component receives a standard interface:

```typescript
interface ProtocolConfigProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}
```

### Protocol Defaults

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Protocol      │ Default Fields                                            │
│───────────────┼───────────────────────────────────────────────────────────│
│ modbus        │ slaveId: 1, timeout: 5000, retries: 3                    │
│ opcua         │ securityPolicy: "None", securityMode: "None",            │
│               │ authentication: "anonymous", publishInterval: 1000,       │
│               │ queueSize: 10                                             │
│ s7            │ rack: 0, slot: 1, pduSize: 960                           │
│ mqtt          │ brokerUrl: "", clientId: "", qos: 1                      │
│ bacnet        │ deviceInstance: 0                                         │
│ ethernetip    │ slot: 0                                                   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## OPC UA Browse Dialog

The Browse Dialog is the most complex component — a recursive tree browser for
OPC UA address spaces.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      BROWSE DIALOG ARCHITECTURE                                 │
│                                                                                 │
│  BrowseDialog                                                                   │
│  ├── State: tree (BrowseNode[]), selected (Set<string>), filter (string)       │
│  │                                                                              │
│  ├── Initial load: POST /devices/{id}/browse { nodeId: "i=85" }               │
│  │   Returns root children (Objects, Types, Views folders)                     │
│  │                                                                              │
│  ├── Expand node: POST /devices/{id}/browse { nodeId: "ns=2;s=..." }          │
│  │   Returns children, merged into tree via recursive update                   │
│  │                                                                              │
│  ├── Selection rules:                                                           │
│  │   ├── Only Variable nodes are selectable (checkbox)                          │
│  │   ├── Object nodes show "Select all children" button                        │
│  │   └── Selection stored as Set<nodeId>                                       │
│  │                                                                              │
│  └── "Add Selected Tags": creates tags in bulk via POST /tags/bulk             │
│      Maps each selected node to a tag:                                         │
│      { name: browseName, address: nodeId, dataType: mapped, ... }              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Tree update pattern** (recursive immutable update):

```typescript
const updateNode = (nodes: BrowseNode[], targetId: string,
                     updater: (n: BrowseNode) => BrowseNode): BrowseNode[] =>
  nodes.map(node => {
    if (node.nodeId === targetId) return updater(node);
    if (node.children?.length) {
      return { ...node, children: updateNode(node.children, targetId, updater) };
    }
    return node;
  });
```

---

## Tag Address Fields by Protocol

The TagDialog renders different address inputs depending on the device protocol:

| Protocol | Address Field | Format Example | Help Text |
|----------|--------------|----------------|-----------|
| Modbus | Register Type + Address | `HR:40001` | Holding/Input/Coil/Discrete + register number |
| OPC UA | Node ID | `ns=2;s=Temperature` | Standard OPC UA node ID format |
| S7 | Symbolic Address | `DB1.DBD0` | Data block + offset notation |
| MQTT | Topic Path | `sensors/temp/value` | MQTT topic for subscription |
| BACnet | Object Reference | `AI:1` | Object type + instance |
| EtherNet/IP | Tag Path | `Program:Main.Tag1` | Controller tag path |

For Modbus tags, additional fields appear:
- **Register Type** dropdown: holding, input, coil, discrete
- **Byte Order** dropdown: big-endian, little-endian, big-endian-word-swap, little-endian-word-swap

---

## Related Documentation

- [State Management](state_management.md) — TanStack Query patterns used by these components
- [API Client](api_client.md) — the API functions these components call
- [Design System](design_system.md) — visual styling and component variants
- [Auth Architecture](auth_architecture.md) — ProtectedRoute and auth context details

---

*Document Version: 1.0*
*Last Updated: March 2026*
