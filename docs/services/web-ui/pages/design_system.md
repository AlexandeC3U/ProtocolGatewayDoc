# Chapter 10 — Design System

> Dark theme, Delaware branding, TailwindCSS configuration, shadcn/ui components,
> protocol color system, and status indicators.

---

## Design Philosophy

The Web UI targets **industrial control room environments** — typically dimly-lit
24/7 operations centers where operators monitor equipment for extended shifts.

| Principle | Implementation |
|-----------|---------------|
| **Dark by default** | `class="dark"` on `<html>`, no light mode toggle |
| **High contrast** | Status indicators pop against dark backgrounds |
| **Information density** | Device cards show 6+ data points without scrolling |
| **Protocol-aware colors** | Each protocol has a unique visual identity |
| **Consistent status language** | Green = online, Red = error, Amber = warning, Grey = offline |

---

## Theme Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       THEME LAYERS                                              │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  CSS Variables (globals.css)                                            │    │
│  │  :root { --background, --foreground, --primary, --accent, ... }         │    │
│  │  .dark { /* overrides for dark theme */ }                               │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                         │
│       ▼                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  TailwindCSS Config (tailwind.config.js)                                │    │
│  │  Maps CSS variables to Tailwind utilities:                              │    │
│  │  bg-background, text-foreground, border-border, etc.                    │    │
│  │  Adds Delaware brand colors, protocol colors, status colors             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│       │                                                                         │
│       ▼                                                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Component Variants (CVA in ui/*.tsx)                                   │    │
│  │  Button: default, destructive, outline, ghost, link                     │    │
│  │  Badge: default, secondary, destructive, outline                        │    │
│  │  Uses Tailwind utilities → CSS variables → actual colors                │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Color System

### CSS Variables (globals.css)

```css
:root {
  --background: 224 71% 4%;        /* Deep blue-black (#080f1d) */
  --foreground: 213 31% 91%;       /* Light gray (#e2e8f0) */
  --card: 224 71% 4%;              /* Same as background */
  --card-foreground: 213 31% 91%;  /* Same as foreground */
  --popover: 224 71% 4%;           /* Same as background */
  --primary: 210 40% 98%;          /* Near white (#f8fafc) */
  --primary-foreground: 222 47% 11%; /* Dark blue (#0f172a) */
  --secondary: 217 33% 17%;        /* Muted blue (#1e293b) */
  --muted: 217 33% 17%;            /* Muted blue */
  --accent: 217 33% 17%;           /* Muted blue */
  --destructive: 0 63% 31%;        /* Dark red (#811d1d) */
  --border: 216 34% 17%;           /* Border color */
  --input: 216 34% 17%;            /* Input border */
  --ring: 212 97% 87%;             /* Focus ring (blue) */
}
```

### Delaware Brand Colors

```
┌────────────────────────────────────────────────────────────────────────────┐
│  DELAWARE BRAND PALETTE                                                    │
│                                                                            │
│  Primary Red    ██████  #c42828  — Accent, destructive actions           │
│  Primary Teal   ██████  #72c4bf  — Secondary accent, links               │
│                                                                            │
│  Used in:                                                                  │
│  • Login page branding ("d." logo)                                         │
│  • Footer text ("Secured by Authentik · delaware")                         │
│  • Accent highlights in UI                                                 │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Protocol Colors

Each protocol has a distinct color for instant visual identification:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  PROTOCOL COLOR MAP                                                        │
│                                                                            │
│  Protocol       Sidebar   Badge BG      Badge Text    Tailwind Class       │
│  ─────────────  ────────  ────────────  ────────────  ──────────────       │
│  modbus         Blue      blue-500/20   blue-400      protocol-modbus      │
│  opcua          Amber     amber-500/20  amber-400     protocol-opcua       │
│  s7             Green     green-500/20  green-400     protocol-s7          │
│  mqtt           Purple    purple-500/20 purple-400    protocol-mqtt        │
│  bacnet         Teal      teal-500/20   teal-400      protocol-bacnet      │
│  ethernetip     Cyan      cyan-500/20   cyan-400      protocol-ethernetip  │
│                                                                            │
│  Usage:                                                                    │
│  • Device card left border (4px solid)                                     │
│  • Protocol badge in device list                                           │
│  • Tab indicator on detail page                                            │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Status Colors

```
┌────────────────────────────────────────────────────────────────────────────┐
│  STATUS INDICATORS                                                         │
│                                                                            │
│  Status     Color      Dot       Usage                                     │
│  ─────────  ─────────  ────────  ─────────────────────────────────────     │
│  online     Emerald    ● (solid) Device connected, service healthy         │
│  offline    Slate      ○ (ring)  Device disconnected, service down         │
│  error      Red        ● (pulse) Connection error, service error           │
│  unknown    Yellow     ◐ (half)  Status undetermined                       │
│  degraded   Amber      ◐ (half)  Service partially available               │
│                                                                            │
│  Status dots use Tailwind classes:                                         │
│  • bg-emerald-500 + animate-pulse (online, pulsing glow)                   │
│  • bg-slate-500 (offline, static)                                          │
│  • bg-red-500 + animate-pulse (error, attention-drawing)                   │
│  • bg-yellow-500 (unknown/degraded)                                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Tailwind Configuration

### Custom Extensions (tailwind.config.js)

```javascript
module.exports = {
  darkMode: 'class',            // Dark mode via class, not media query
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // CSS variable mapping (shadcn/ui standard)
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: '...' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: '...' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: '...' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: '...' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: '...' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        // Delaware brand
        delaware: { red: '#c42828', teal: '#72c4bf' },

        // Protocol colors (custom)
        protocol: {
          modbus: { DEFAULT: '#3b82f6', light: '#60a5fa' },
          opcua:  { DEFAULT: '#f59e0b', light: '#fbbf24' },
          s7:     { DEFAULT: '#22c55e', light: '#4ade80' },
          mqtt:   { DEFAULT: '#a855f7', light: '#c084fc' },
          bacnet: { DEFAULT: '#14b8a6', light: '#2dd4bf' },
          ethernetip: { DEFAULT: '#06b6d4', light: '#22d3ee' },
        },
      },
      keyframes: {
        'accordion-down': { ... },
        'accordion-up': { ... },
        'pulse-status': {              // Glow effect for online status dots
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 },
        },
        'shimmer': { ... },            // Loading skeleton animation
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
```

---

## Component Variant System (CVA)

### Button Variants

```
┌────────────────────────────────────────────────────────────────────────────┐
│  BUTTON VARIANTS                                                           │
│                                                                            │
│  Variant        Appearance              Use Case                           │
│  ─────────────  ──────────────────────  ──────────────────────────────     │
│  default        White bg, dark text     Primary actions (Save, Create)     │
│  destructive    Red bg, white text      Dangerous actions (Delete)         │
│  outline        Border, transparent bg  Secondary actions (Cancel, Back)   │
│  ghost          No border, transparent  Tertiary actions (sidebar links)   │
│  link           Text only, underline    Inline text links                  │
│                                                                            │
│  Size           Dimensions              Use Case                           │
│  ─────────────  ──────────────────────  ──────────────────────────────     │
│  default        h-10, px-4              Standard buttons                   │
│  sm             h-9, px-3               Compact areas (table rows)         │
│  lg             h-11, px-8              Hero actions                       │
│  icon           h-10, w-10             Icon-only buttons (close, menu)     │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Badge Variants

| Variant | Appearance | Use Case |
|---------|-----------|----------|
| default | Primary bg | Protocol badges |
| secondary | Muted bg | Status labels |
| destructive | Red bg | Error badges |
| outline | Border only | Metadata tags |

---

## Custom CSS Classes (globals.css)

Beyond Tailwind utilities, the app defines custom classes for patterns that repeat:

```css
/* Setup stepper dots */
.setup-dot {
  @apply w-2 h-2 rounded-full;
}
.setup-dot-active {
  @apply bg-primary;
}
.setup-dot-completed {
  @apply bg-emerald-500;
}
.setup-dot-pending {
  @apply bg-muted;
}

/* Protocol sidebar stripe */
.protocol-stripe {
  @apply absolute left-0 top-0 bottom-0 w-1 rounded-l;
}
```

---

## Utility Functions (lib/utils.ts)

### `cn()` — Class Name Merger

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Usage:
cn('bg-red-500', isActive && 'bg-blue-500')
// → 'bg-blue-500' (twMerge deduplicates conflicting classes)
```

### `formatDate()` — Timestamp Formatting

```typescript
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
}
```

---

## Icon System

All icons use **Lucide React** (v0.378.0) — a fork of Feather Icons with 1400+ icons:

| Icon | Usage |
|------|-------|
| `Server` | Device representation |
| `LayoutDashboard` | Dashboard nav |
| `Tags` | Tags nav |
| `Monitor` | System nav |
| `Activity` | Health nav |
| `Plus` | Add/Create buttons |
| `Pencil` | Edit buttons |
| `Trash2` | Delete buttons |
| `Loader2` | Loading spinners (with `animate-spin`) |
| `AlertCircle` | Error states |
| `CheckCircle` | Success states |
| `ChevronRight/Down` | Tree expansion (Browse Dialog) |
| `Power` | Toggle enable/disable |
| `Wifi` | Connection status |

---

## Responsive Breakpoints

| Breakpoint | Width | Layout Change |
|-----------|-------|--------------|
| `sm` | 640px | Device grid: 1 → 2 columns |
| `md` | 768px | Sidebar expands from icons to full |
| `lg` | 1024px | Device grid: 2 → 3 columns |
| `xl` | 1280px | Device grid: 3 → 4 columns |
| `2xl` | 1536px | Max content width |

---

## Related Documentation

- [Component Architecture](component_architecture.md) — how components use these styles
- [Accessibility](accessibility.md) — color contrast and visual accessibility
- [Performance](performance.md) — Tailwind purging and CSS optimization

---

*Document Version: 1.0*
*Last Updated: March 2026*
