# Chapter 6 — State Management

> TanStack Query as the sole server-state layer, React Context for auth,
> component state for UI — and why there is no Redux or Zustand.

---

## State Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       STATE MANAGEMENT LAYERS                                   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    SERVER STATE (TanStack Query v5)                     │    │
│  │                                                                         │    │
│  │  What: Devices, tags, health status, system info                        │    │
│  │  How:  useQuery() fetches, caches (5s stale), auto-refetches            │    │
│  │  Why:  Server is source of truth; cache is a performance optimization   │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    AUTH STATE (React Context)                           │    │
│  │                                                                         │    │
│  │  What: User profile, tokens, auth status, login/logout functions        │    │
│  │  How:  AuthProvider + useAuth() hook                                    │    │
│  │  Why:  Needs to be accessible from any component in the tree            │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    UI STATE (Component useState)                        │    │
│  │                                                                         │    │
│  │  What: Dialog open/close, form values, filter strings, sort state       │    │
│  │  How:  Local useState() in each component                               │    │
│  │  Why:  Ephemeral, component-scoped, no need to share                    │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                    URL STATE (React Router)                             │    │
│  │                                                                         │    │
│  │  What: Current page, device ID, tab selection                           │    │
│  │  How:  useParams(), useNavigate(), useSearchParams()                    │    │
│  │  Why:  Bookmarkable, shareable, back-button friendly                    │    │
│  │                                                                         │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## TanStack Query Configuration

The QueryClient is created in `main.tsx` with these defaults:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,        // 5 seconds before refetch on focus
      retry: 1,                // 1 retry on failure
      refetchOnWindowFocus: false,  // Disable auto-refetch on tab focus
    },
  },
});
```

| Setting | Value | Rationale |
|---------|-------|-----------|
| `staleTime` | 5s | Balance between freshness and API load |
| `retry` | 1 | One retry covers transient network blips |
| `refetchOnWindowFocus` | false | Avoid jarring UI updates when switching tabs |
| `gcTime` | 5min (default) | Keep unused data in cache for 5 minutes |

---

## Query Key Design

Query keys are structured for targeted invalidation:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       QUERY KEY HIERARCHY                                       │
│                                                                                 │
│  ['devices']                          ← All device queries                      │
│  ['devices', { search, protocol, status }]  ← Filtered device list              │
│  ['device', id]                       ← Single device by ID                     │
│                                                                                 │
│  ['tags']                             ← All tag queries                         │
│  ['tags', { search, deviceId, dataType, accessMode, limit, offset }]            │
│  ['tag', id]                          ← Single tag by ID                        │
│                                                                                 │
│  ['dashboard', 'devices']             ← Dashboard device stats                  │
│  ['dashboard', 'tags']                ← Dashboard tag stats                     │
│  ['dashboard', 'health']              ← Dashboard health status                 │
│                                                                                 │
│  ['health']                           ← Health check data                       │
│  ['system', 'health']                 ← System health cards                     │
│  ['system', 'info']                   ← System info                             │
│                                                                                 │
│  Invalidation examples:                                                         │
│  ──────────────────────                                                         │
│  invalidateQueries({ queryKey: ['devices'] })                                   │
│    → Refetches ALL queries starting with 'devices'                              │
│    → Covers both device list and individual device queries                      │
│                                                                                 │
│  invalidateQueries({ queryKey: ['device', '123'] })                             │
│    → Refetches only device '123'                                                │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Query Patterns

### Basic Data Fetching

```typescript
// DevicesPage.tsx
const { data: devices, isLoading, isError, error, refetch } = useQuery({
  queryKey: ['devices', { search, protocol, status }],
  queryFn: () => devicesApi.list({ search, protocol, status }),
});
```

### Auto-Refresh with Interval

```typescript
// DashboardPage.tsx — health refreshes every 15 seconds
const { data: health } = useQuery({
  queryKey: ['dashboard', 'health'],
  queryFn: () => healthApi.ready(),
  refetchInterval: 15_000,
});

// Devices refresh every 30 seconds
const { data: devices } = useQuery({
  queryKey: ['dashboard', 'devices'],
  queryFn: () => devicesApi.list(),
  refetchInterval: 30_000,
});
```

### Dependent Query

```typescript
// DeviceDetailPage.tsx — tags query depends on device ID
const { id } = useParams();

const { data: device } = useQuery({
  queryKey: ['device', id],
  queryFn: () => devicesApi.get(id!),
  enabled: !!id,
});

const { data: tags } = useQuery({
  queryKey: ['tags', { deviceId: id }],
  queryFn: () => tagsApi.list({ deviceId: id }),
  enabled: !!id,
});
```

### Paginated Query

```typescript
// TagsPage.tsx — server-side pagination
const [page, setPage] = useState(0);
const limit = 25;

const { data } = useQuery({
  queryKey: ['tags', { search, deviceId, dataType, limit, offset: page * limit }],
  queryFn: () => tagsApi.list({
    search, deviceId, dataType,
    limit,
    offset: page * limit,
  }),
});

// data.items = Tag[], data.total = number
// Render: "Showing 1-25 of 156 tags"
```

---

## Mutation Patterns

### Standard CRUD Mutation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     MUTATION LIFECYCLE                                          │
│                                                                                 │
│  User action (click "Save")                                                     │
│       │                                                                         │
│       ▼                                                                         │
│  mutation.mutate(data)                                                          │
│       │                                                                         │
│       ├── isPending = true (button shows spinner, disabled)                     │
│       │                                                                         │
│       ├── mutationFn: API call (POST/PUT/DELETE)                                │
│       │       │                                                                 │
│       │       ├── Success                                                       │
│       │       │   ├── onSuccess callback fires                                  │
│       │       │   ├── invalidateQueries (refetch stale data)                    │
│       │       │   ├── Toast success notification                                │
│       │       │   └── Close dialog / navigate away                              │
│       │       │                                                                 │
│       │       └── Error                                                         │
│       │           ├── onError callback fires                                    │
│       │           └── Toast error notification                                  │
│       │                                                                         │
│       └── isPending = false (button re-enabled)                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

```typescript
// DeviceDialog.tsx — Create device
const createMutation = useMutation({
  mutationFn: (data: CreateDeviceInput) => devicesApi.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    toast({ title: 'Device created successfully' });
    onClose();
  },
  onError: (error: ApiError) => {
    toast({ title: 'Failed to create device', description: error.message, variant: 'destructive' });
  },
});
```

### Toggle Mutation (Inline)

```typescript
// DevicesPage.tsx — Toggle device enabled state
const toggleMutation = useMutation({
  mutationFn: (id: string) => devicesApi.toggle(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    toast({ title: 'Device toggled' });
  },
});

// Usage: <Button onClick={() => toggleMutation.mutate(device.id)} />
```

### Delete with Confirmation

```typescript
// Pattern: confirm state + delete mutation
const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

const deleteMutation = useMutation({
  mutationFn: (id: string) => devicesApi.delete(id),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['devices'] });
    toast({ title: 'Device deleted' });
    setConfirmDelete(null);
  },
});

// Two-click flow: first click shows "Are you sure?", second click confirms
```

### Bulk Mutation (Browse → Create Tags)

```typescript
// BrowseDialog.tsx — create multiple tags from OPC UA browse selection
const bulkCreateMutation = useMutation({
  mutationFn: (tags: CreateTagInput[]) => tagsApi.bulkCreate(tags),
  onSuccess: (result) => {
    queryClient.invalidateQueries({ queryKey: ['tags'] });
    toast({ title: `${result.created} tags created` });
    onClose();
  },
});
```

---

## Refetch Intervals by Page

| Page | Data | Interval | Rationale |
|------|------|----------|-----------|
| Dashboard | Devices | 30s | Summary stats, not real-time |
| Dashboard | Tags | 30s | Count doesn't change fast |
| Dashboard | Health | 15s | Operators need timely health status |
| System | Health | 10s | Dedicated monitoring page |
| Devices | Device list | None | User-triggered (filter change, mutation) |
| Device Detail | Device | None | Static until user mutates |
| Device Detail | Tags | None | Static until user mutates |
| Tags | Tag list | None | Static until user mutates |

---

## Cache Invalidation Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    INVALIDATION RULES                                           │
│                                                                                 │
│  Mutation                    │ Invalidated Query Keys                           │
│  ────────────────────────────┼──────────────────────────────────────────────    │
│  Create device               │ ['devices'], ['dashboard']                       │
│  Update device               │ ['devices'], ['device', id]                      │
│  Delete device               │ ['devices'], ['dashboard']                       │
│  Toggle device               │ ['devices'], ['device', id]                      │
│  Test connection             │ ['device', id]                                   │
│  ────────────────────────────┼──────────────────────────────────────────────    │
│  Create tag                  │ ['tags'], ['device', deviceId]                   │
│  Update tag                  │ ['tags'], ['tag', id]                            │
│  Delete tag                  │ ['tags'], ['device', deviceId]                   │
│  Toggle tag                  │ ['tags'], ['tag', id]                            │
│  Bulk create tags            │ ['tags'], ['device', deviceId]                   │ 
│                                                                                 │
│  Note: Dashboard queries are invalidated by prefix match — invalidating         │
│  ['devices'] catches ['dashboard', 'devices'] via TQ's fuzzy matching.          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Why No Redux / Zustand / MobX

| Argument | Counter |
|----------|---------|
| "Need global state" | TanStack Query IS global state for server data; auth is in Context |
| "Complex UI state" | Filter values and dialog state are component-local; no sharing needed |
| "Time-travel debugging" | Not useful for an operational tool; React DevTools + TQ DevTools suffice |
| "Undo/redo" | Not a requirement; mutations are intentional operator actions |
| "Offline support" | Not needed; edge platform always has local network connectivity |

**Note:** Zustand 4.5.2 is installed in `package.json` but has minimal usage. The
codebase intentionally avoids it for application state, preferring the simpler
TanStack Query + Context + useState pattern.

---

## Loading & Error States

### Loading Pattern

```typescript
if (isLoading) {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
```

### Error Pattern

```typescript
if (isError) {
  return (
    <div className="text-center py-12">
      <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
      <p className="text-muted-foreground">{error.message}</p>
      <Button onClick={() => refetch()} className="mt-4">
        Retry
      </Button>
    </div>
  );
}
```

### Empty State Pattern

```typescript
if (devices?.length === 0) {
  return (
    <div className="text-center py-12">
      <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
      <p>No devices configured yet</p>
      <Button onClick={() => setDialogOpen(true)} className="mt-4">
        Add Device
      </Button>
    </div>
  );
}
```

---

## Related Documentation

- [API Client](api_client.md) — the fetch functions behind query/mutation functions
- [Component Architecture](component_architecture.md) — how components consume queries
- [Edge Cases](edge_cases.md) — stale cache, concurrent mutations, race conditions

---

*Document Version: 1.0*
*Last Updated: March 2026*
