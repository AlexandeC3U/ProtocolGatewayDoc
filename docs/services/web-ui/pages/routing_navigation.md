# Chapter 8 — Routing & Navigation

> React Router v6 setup, route definitions, protected routes, layout system,
> and navigation patterns.

---

## Route Map

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ROUTE HIERARCHY                                        │
│                                                                                 │
│  <BrowserRouter>                                                                │
│  │                                                                              │
│  ├── /auth/callback ─────── AuthCallbackPage     (public, no layout)            │
│  ├── /login ─────────────── LoginPage            (public, no layout)            │
│  │                                                                              │
│  └── <ProtectedRoute> ──── (auth gate)                                          │
│      └── <Layout> ──────── (sidebar + topbar + Outlet)                          │
│          │                                                                      │
│          ├── / ──────────── Navigate → /dashboard  (redirect)                   │
│          ├── /dashboard ─── DashboardPage          (overview + stats)           │
│          ├── /devices ───── DevicesPage            (device grid + CRUD)         │
│          ├── /devices/:id ─ DeviceDetailPage       (tabs: overview/tags/config) │
│          ├── /tags ──────── TagsPage               (global tag table)           │
│          ├── /tags/:id ──── TagDetailPage           (single tag view)           │
│          ├── /system ────── SystemPage             (health cards + diagram)     │
│          └── /health ────── HealthPage             (Grafana iframe)             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Route Definition

Routes are defined in `App.tsx` using React Router v6's declarative API:

```typescript
<Routes>
  {/* Public routes — outside ProtectedRoute */}
  <Route path="/auth/callback" element={<AuthCallbackPage />} />
  <Route path="/login" element={<LoginPage />} />

  {/* Protected routes — require authentication */}
  <Route element={<ProtectedRoute />}>
    <Route element={<Layout />}>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/devices" element={<DevicesPage />} />
      <Route path="/devices/:id" element={<DeviceDetailPage />} />
      <Route path="/tags" element={<TagsPage />} />
      <Route path="/tags/:id" element={<TagDetailPage />} />
      <Route path="/system" element={<SystemPage />} />
      <Route path="/health" element={<HealthPage />} />
    </Route>
  </Route>
</Routes>
```

**Key design decisions:**
- `/auth/callback` is **outside** ProtectedRoute — it must handle the OAuth redirect
  before authentication is established
- `/login` is **outside** ProtectedRoute — it must be accessible when not authenticated
- All other routes are wrapped in both `ProtectedRoute` (auth) and `Layout` (shell)
- Root `/` redirects to `/dashboard` (no standalone root page)

---

## ProtectedRoute Component

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      PROTECTEDROUTE DECISION TREE                               │
│                                                                                 │
│  ProtectedRoute renders                                                         │
│       │                                                                         │
│       ├── authEnabled === false                                                 │
│       │   └── Render <Outlet /> (no auth required, pass through)                │
│       │                                                                         │
│       ├── isLoading === true                                                    │
│       │   └── Render loading spinner (auth state being determined)              │
│       │                                                                         │
│       ├── isAuthenticated === true                                              │
│       │   └── Render <Outlet /> (user has valid tokens)                         │
│       │                                                                         │
│       └── isAuthenticated === false                                             │
│           └── <Navigate to="/login" replace /> (redirect to login)              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

ProtectedRoute uses React Router's **layout route** pattern — it renders `<Outlet />`
which renders the child routes (Layout → Pages).

---

## Layout Component

The Layout component provides the persistent application shell:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ┌────────┐                                                                   │
│ │        │  NEXUS Edge                                     [User ▾] [*]      │
│ │  SIDE  │  ─────────────────────────────────────────────────────────────    │
│ │  BAR   │                                                                   │
│ │        │  ┌────────────────────────────────────────────────────────────┐   │
│ │ - Dash │  │                                                            │   │
│ │ - Dev  │  │                                                            │   │
│ │ - Tags │  │                <Outlet />                                  │   │
│ │ - Sys  │  │                                                            │   │
│ │ - Hlth │  │           Current page renders here                        │   │
│ │        │  │                                                            │   │
│ │        │  │                                                            │   │
│ │        │  └────────────────────────────────────────────────────────────┘   │
│ └────────┘                                                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Sidebar Navigation Links

| Icon | Label | Path | Component |
|------|-------|------|-----------|
| LayoutDashboard | Dashboard | `/dashboard` | DashboardPage |
| Server | Devices | `/devices` | DevicesPage |
| Tags | Tags | `/tags` | TagsPage |
| Monitor | System | `/system` | SystemPage |
| Activity | Health | `/health` | HealthPage |

- Active link is highlighted with accent background color
- Icons from Lucide React
- Sidebar can collapse to icon-only mode

---

## Navigation Patterns

### Programmatic Navigation

```typescript
// Navigate to device detail
const navigate = useNavigate();
navigate(`/devices/${device.id}`);

// Navigate back
navigate(-1);

// Replace current route (no back-button entry)
navigate('/dashboard', { replace: true });
```

### Link Navigation

```typescript
// Device card click → detail page
<div onClick={() => navigate(`/devices/${device.id}`)}>
  {/* card content */}
</div>

// Back link on detail page
<Button variant="ghost" onClick={() => navigate('/devices')}>
  ← Back to Devices
</Button>
```

### Post-Mutation Navigation

```typescript
// After creating a device, stay on devices page (dialog closes)
// After deleting a device from detail page, navigate back to list
const deleteMutation = useMutation({
  mutationFn: (id: string) => devicesApi.delete(id),
  onSuccess: () => {
    navigate('/devices');
    toast({ title: 'Device deleted' });
  },
});
```

---

## URL Parameters

### Route Params

```typescript
// DeviceDetailPage — device ID from URL
const { id } = useParams<{ id: string }>();
const { data: device } = useQuery({
  queryKey: ['device', id],
  queryFn: () => devicesApi.get(id!),
  enabled: !!id,
});
```

### Query Parameters (Not Used)

The current implementation uses **component state** for filters rather than URL
search params. This means filter state is lost on navigation. Future improvement:
encode filters in URL for shareability.

---

## SPA Routing

### Development (Vite)

Vite's dev server handles SPA routing natively — all non-file requests return
`index.html`, which loads the React app and React Router resolves the route.

### Production (Nginx)

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

The `try_files` directive ensures that direct navigation to `/devices/123` or
browser refresh on any route returns `index.html`, allowing React Router to handle
client-side routing.

---

## Related Documentation

- [Auth Architecture](auth_architecture.md) — ProtectedRoute and auth callback details
- [Component Architecture](component_architecture.md) — page components for each route
- [Deployment](deployment.md) — Nginx SPA routing configuration

---

*Document Version: 1.0*
*Last Updated: March 2026*
