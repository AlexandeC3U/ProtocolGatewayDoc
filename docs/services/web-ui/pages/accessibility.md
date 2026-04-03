# Chapter 14 — Accessibility

> WCAG AA compliance, keyboard navigation, ARIA patterns, focus management,
> and color contrast for industrial control room environments.

---

## Accessibility Strategy

The Web UI targets **WCAG 2.1 Level AA** compliance with emphasis on:

1. **Keyboard navigation** — all interactions reachable without a mouse
2. **Screen reader support** — semantic HTML + ARIA labels
3. **Color contrast** — meets AA ratios on dark background
4. **Focus management** — visible focus indicators, trapped focus in dialogs

---

## Radix UI: Accessibility Built In

The choice of Radix UI as the component primitive layer provides significant
accessibility out of the box:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    RADIX UI ACCESSIBILITY FEATURES                              │
│                                                                                 │
│  Component       │ Built-in Behavior                                            │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Dialog          │ Focus trap, Escape to close, aria-labelledby,                │
│                  │ aria-describedby, background scroll lock                     │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Tabs            │ Arrow key navigation, role="tablist", role="tab",            │
│                  │ role="tabpanel", aria-selected                               │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Tooltip         │ role="tooltip", aria-describedby, ESC to dismiss,            │
│                  │ delay for intentional hover                                  │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Dropdown Menu   │ Arrow key navigation, role="menu", role="menuitem",          │
│                  │ Home/End keys, type-ahead search                             │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Select          │ Arrow keys, type-ahead, role="listbox",                      │
│                  │ role="option", aria-expanded                                 │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Switch          │ role="switch", aria-checked, Space to toggle                 │
│  ────────────────┼──────────────────────────────────────────────────────────    │
│  Toast           │ role="status", aria-live="polite", auto-dismiss              │
│                  │ with configurable timeout                                    │
│                                                                                 │
│  Radix handles WAI-ARIA patterns so individual components don't have to.        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Keyboard Navigation

### Global Navigation

| Key               | Action                                     |
| ----------------- | ------------------------------------------ |
| `Tab`             | Move focus to next interactive element     |
| `Shift+Tab`       | Move focus to previous interactive element |
| `Enter` / `Space` | Activate focused button or link            |
| `Escape`          | Close open dialog, dropdown, or tooltip    |

### Sidebar Navigation

| Key                                   | Action                   |
| ------------------------------------- | ------------------------ |
| `Tab`                                 | Focus next sidebar link  |
| `Enter`                               | Navigate to focused page |
| Active link has `aria-current="page"` |

### Dialog Interaction

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DIALOG FOCUS MANAGEMENT                                      │
│                                                                                 │
│  1. Dialog opens                                                                │
│     ├── Focus moves to first focusable element in dialog                        │
│     ├── Background content is inert (aria-hidden="true")                        │
│     └── Scroll lock on body                                                     │
│                                                                                 │
│  2. Inside dialog                                                               │
│     ├── Tab cycles through dialog elements only (focus trap)                    │
│     ├── Shift+Tab cycles in reverse                                             │
│     └── Escape closes dialog                                                    │
│                                                                                 │
│  3. Dialog closes                                                               │
│     ├── Focus returns to element that triggered the dialog                      │
│     ├── Background content is restored                                          │
│     └── Scroll lock removed                                                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Device Cards

| Key                                                               | Action                         |
| ----------------------------------------------------------------- | ------------------------------ |
| `Tab`                                                             | Focus next device card         |
| `Enter`                                                           | Navigate to device detail page |
| Card actions (Edit, Delete) are focusable via Tab within the card |

### Tabs (Device Detail Page)

| Key                | Action               |
| ------------------ | -------------------- |
| `Arrow Left/Right` | Switch between tabs  |
| `Home`             | Focus first tab      |
| `End`              | Focus last tab       |
| `Enter` / `Space`  | Activate focused tab |

### Browse Dialog (Tree)

| Key           | Action                    |
| ------------- | ------------------------- |
| `Arrow Down`  | Focus next tree node      |
| `Arrow Up`    | Focus previous tree node  |
| `Arrow Right` | Expand focused node       |
| `Arrow Left`  | Collapse focused node     |
| `Space`       | Toggle checkbox selection |

---

## Color Contrast

### Dark Theme Contrast Ratios

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    COLOR CONTRAST (WCAG AA requires ≥ 4.5:1 for text)           │
│                                                                                 │
│  Combination                              Ratio     Status                      │
│  ──────────────────────────────────────── ──────── ──────                       │
│  Foreground (#e2e8f0) on Background       12.5:1     AAA                        │
│  (#080f1d)                                                                      │
│  Muted text (#94a3b8) on Background       7.1:1      AAA                        │
│  (#080f1d)                                                                      │
│  Primary white (#f8fafc) on Background    14.2:1     AAA                        │
│  (#080f1d)                                                                      │
│  Destructive red (#ef4444) on Background  5.8:1       AA                        │
│  (#080f1d)                                                                      │
│  Emerald status (#10b981) on Background   5.3:1       AA                        │
│  (#080f1d)                                                                      │
│  Yellow status (#eab308) on Background    8.9:1      AAA                        │
│  (#080f1d)                                                                      │
│                                                                                 │
│  All text combinations meet WCAG AA (4.5:1).                                    │
│  Most meet WCAG AAA (7:1).                                                      │
│  Dark backgrounds provide excellent contrast for status indicators.             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Non-Color Indicators

Status is never conveyed by color alone:

| Status  | Color  | Additional Indicator                       |
| ------- | ------ | ------------------------------------------ |
| Online  | Green  | Solid dot + "Online" text                  |
| Offline | Grey   | Ring dot + "Offline" text                  |
| Error   | Red    | Pulsing dot + "Error" text + error message |
| Unknown | Yellow | Half-filled dot + "Unknown" text           |

---

## Semantic HTML

```html
<!-- Page structure -->
<main>
  <!-- Main content landmark -->
  <nav aria-label="Sidebar">
    <!-- Navigation landmark -->
    <header>
      <!-- Page header -->
      <section aria-label="Devices">
        <!-- Content sections -->

        <!-- Interactive elements -->
        <button>
          <!-- All clickable actions are buttons -->
          <a href="/devices/123">
            <!-- Navigation uses anchor tags -->
            <input aria-label="Search devices" />
            <!-- Inputs have labels -->
            <table>
              <!-- Data grids use table elements -->
              <thead>
                <tr>
                  <th><!-- Proper table headers --></th>
                </tr>
              </thead>
            </table></a
          >
        </button>
      </section>
    </header>
  </nav>
</main>
```

---

## ARIA Patterns

### Live Regions

```html
<!-- Toast notifications -->
<div role="status" aria-live="polite">Device created successfully</div>

<!-- Loading states -->
<div role="status" aria-busy="true">Loading devices...</div>
```

### Labels

```html
<!-- Form inputs -->
<label htmlFor="device-name">Device Name</label>
<input id="device-name" aria-required="true" />

<!-- Icon-only buttons -->
<button aria-label="Delete device">
  <Trash2 aria-hidden="true" />
</button>

<!-- Status indicators -->
<span aria-label="Device status: online" className="...">●</span>
```

---

## Accessibility Testing Checklist

| Check               | Tool             | Frequency                 |
| ------------------- | ---------------- | ------------------------- |
| Keyboard navigation | Manual           | Every new component       |
| Color contrast      | Chrome DevTools  | Every theme change        |
| Screen reader       | NVDA / VoiceOver | Major flows               |
| ARIA validation     | axe DevTools     | Every PR                  |
| Focus visible       | Manual           | Every interactive element |
| Zoom to 200%        | Manual           | Layout changes            |

---

## Known Limitations

| Limitation              | Impact                       | Mitigation                                                         |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------ |
| No skip-to-content link | Minor — sidebar is short     | Add `<a href="#main" class="sr-only">`                             |
| Browse Dialog tree      | Complex keyboard interaction | Follows ARIA tree pattern, but nested trees are inherently complex |
| Grafana iframe          | Not controllable             | Grafana has its own accessibility                                  |
| React Flow diagram      | Not keyboard navigable       | Informational only, not interactive data                           |

---

## Related Documentation

- [Design System](design_system.md) — color system and contrast ratios
- [Component Architecture](component_architecture.md) — Radix UI usage patterns
- [Edge Cases](edge_cases.md) — accessibility-related edge cases

---

_Document Version: 1.0_
_Last Updated: March 2026_
