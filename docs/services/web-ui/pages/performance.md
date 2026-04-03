# Chapter 13 — Performance

> Build optimization, code splitting, caching strategy, bundle analysis,
> and runtime performance considerations.

---

## Build Optimization

### Vite + SWC

The Web UI uses Vite 5 with the SWC plugin (`@vitejs/plugin-react-swc`) instead
of Babel. SWC compiles TypeScript and JSX ~20x faster than Babel.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       BUILD PERFORMANCE                                         │
│                                                                                 │
│  Tool           Dev Start    HMR Update    Prod Build                           │
│  ─────────────  ───────────  ────────────  ────────────                         │
│  Vite + SWC     < 500ms      < 50ms        ~10-15s                              │
│  Vite + Babel   < 800ms      < 100ms       ~20-30s                              │
│  CRA (webpack)  ~5s          ~500ms        ~60-90s                              │
│                                                                                 │
│  SWC handles:                                                                   │
│  • TypeScript → JavaScript                                                      │
│  • JSX → React.createElement                                                    │
│  • React Fast Refresh (HMR)                                                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Tree Shaking

Vite uses Rollup for production builds, which performs aggressive tree shaking:

- Unused exports from `lucide-react` (1400+ icons) are eliminated — only imported
  icons end up in the bundle
- Unused Radix UI components are removed
- Unused TanStack Query features are removed

### CSS Purging

TailwindCSS scans `src/**/*.{ts,tsx}` and removes all unused utility classes in
production. A typical Tailwind build goes from ~3MB of CSS to ~20-50KB.

---

## Bundle Composition

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    APPROXIMATE BUNDLE BREAKDOWN                                 │
│                                                                                 │
│  Chunk                    Size (gzip)     Contents                              │
│  ───────────────────────  ──────────────  ──────────────────────────────────    │
│  vendor-react.js          ~45KB           React, ReactDOM, React Router         │
│  vendor-query.js          ~15KB           TanStack Query + Table                │
│  vendor-radix.js          ~20KB           Radix UI primitives                   │
│  vendor-xyflow.js         ~30KB           React Flow (architecture diagram)     │
│  vendor-recharts.js       ~40KB           Recharts (if used)                    │
│  vendor-mqtt.js           ~25KB           mqtt.js                               │
│  app.js                   ~30KB           Application code                      │
│  styles.css               ~25KB           Tailwind + custom CSS                 │
│  ───────────────────────  ──────────────  ──────────────────────────────────    │
│  Total                    ~230KB gzip     Initial load                          │
│                                                                                 │
│  Note: Sizes are approximate. Actual sizes depend on import usage.              │
│  Content-hashed filenames ensure cache-busting on deploys.                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Bundle Analysis

```bash
# Analyze production bundle
pnpm build -- --report

# Or use rollup-plugin-visualizer:
# Add to vite.config.ts plugins, then open stats.html
```

---

## Caching Strategy

### Static Assets (Nginx)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CACHING STRATEGY                                             │
│                                                                                 │
│  Asset Type            Cache Header                    Duration                 │
│  ────────────────────  ──────────────────────────────  ─────────                │
│  /assets/*.js          Cache-Control: public, immutable  1 year                 │
│  /assets/*.css         Cache-Control: public, immutable  1 year                 │
│  /assets/*.woff2       Cache-Control: public, immutable  1 year                 │
│  /index.html           Cache-Control: no-cache            0 (always fresh)      │
│  /api/*                No caching (proxied)               —                     │
│                                                                                 │
│  Why this works:                                                                │
│  • Vite adds content hashes to filenames: index-a1b2c3.js                       │
│  • New deploy = new hash = new URL = cache miss (automatic bust)                │
│  • index.html is never cached so it always references latest assets             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Gzip Compression (Nginx)

Nginx compresses all text-based responses (HTML, CSS, JS, JSON, SVG). Typical
compression ratios:
- JavaScript: 60-70% reduction
- CSS: 70-80% reduction
- JSON (API responses): 60-70% reduction

---

## Runtime Performance

### TanStack Query Caching

TanStack Query acts as an **in-memory client-side cache** that reduces API calls:

| Scenario | Without TQ Cache | With TQ Cache (5s stale) |
|----------|-----------------|-------------------------|
| Navigate Devices → Detail → Back | 3 API calls | 1 API call (2 cache hits) |
| Switch between tabs | Re-fetch every tab switch | Cache hit for 5 seconds |
| Multiple components using same data | Duplicate fetches | Single fetch, shared cache |

### Render Optimization

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    RENDER PERFORMANCE PATTERNS                                  │
│                                                                                 │
│  Pattern                    Implementation                                      │
│  ─────────────────────────  ────────────────────────────────────────────────    │
│  Avoid unnecessary renders  TanStack Query structural sharing —                 │
│                              only re-renders when data actually changes         │
│                                                                                 │
│  Lazy loading               React.lazy() for heavy components                   │
│                              (React Flow diagram, Recharts)                     │
│                                                                                 │
│  Virtualization             Not yet needed — device/tag lists                   │
│                              typically < 500 items                              │
│                                                                                 │
│  Debounced search           Search filter input debounced to                    │
│                              reduce API calls while typing                      │
│                                                                                 │
│  Pagination                  Server-side pagination (25/page) —                 │
│                              never load full dataset                            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Source Maps

Source maps are enabled in production builds (`sourcemap: true` in Vite config).
This enables debugging in production but adds ~2x to JS file sizes (source maps
are only downloaded when DevTools is open).

---

## Performance Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| First Contentful Paint | < 1.5s | Fast perception of app loading |
| Largest Contentful Paint | < 2.5s | Page usable within ~2s |
| Time to Interactive | < 3s | All buttons/links responsive |
| Bundle size (gzip) | < 300KB | Reasonable for SPA with data viz |
| API response display | < 100ms | TQ cache hit → instant display |

### Lighthouse Considerations

The app is optimized for **desktop Chrome** in internal network environments. Mobile
Lighthouse scores are secondary since the primary use case is desktop control rooms.

---

## Future Optimizations

| Optimization | Impact | Effort |
|-------------|--------|--------|
| Route-based code splitting | Reduce initial load by ~30% | Low |
| React.lazy for ArchitectureDiagram | Remove @xyflow from main bundle | Low |
| React.lazy for Recharts | Remove recharts from main bundle | Low |
| Service Worker caching | Offline shell capability | Medium |
| Image optimization (SVG sprites) | Reduce icon requests | Low |
| Pre-connect to API origin | Faster first API call | Low |

---

## Related Documentation

- [Deployment](deployment.md) — Nginx caching and compression config
- [Design System](design_system.md) — Tailwind purging configuration
- [Configuration Reference](configuration_reference.md) — Vite build options

---

*Document Version: 1.0*
*Last Updated: March 2026*
