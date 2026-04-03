# Chapter 15 — Configuration Reference

> All environment variables, Vite configuration, Nginx settings,
> and build-time vs runtime configuration.

---

## Environment Variables

### Build-Time Variables (Vite)

These are embedded into the bundle during `pnpm build` via `import.meta.env.*`:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `VITE_API_URL` | string | `""` (empty) | Base URL for API calls. Empty = relative URLs (proxied) |
| `VITE_WS_URL` | string | `""` (empty) | WebSocket URL for MQTT-over-WS |
| `VITE_PORT` | number | `5173` | Dev server port |

**Important:** `VITE_*` variables are **baked into the JavaScript bundle** at build
time. Changing them requires a rebuild. They are NOT read at runtime.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    BUILD-TIME vs RUNTIME CONFIG                                 │
│                                                                                 │
│  Build-time (Vite):                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  VITE_API_URL, VITE_WS_URL                                              │    │
│  │  → Replaced at build time by Vite                                       │    │
│  │  → Embedded as string literals in the JS bundle                         │    │
│  │  → Cannot change without rebuilding                                     │    │
│  │  → Docker: pass as build args (--build-arg VITE_API_URL=...)            │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  Runtime (Browser):                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  OIDC discovery URL (/.well-known/openid-configuration)                 │    │
│  │  → Fetched at runtime from same origin                                  │    │
│  │  → No build-time configuration needed                                   │    │
│  │  → Works automatically when Authentik is deployed                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Vite Configuration (`vite.config.ts`)

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },

  build: {
    sourcemap: true,
  },
});
```

### Configuration Breakdown

| Section | Setting | Purpose |
|---------|---------|---------|
| `plugins` | `react()` (SWC) | Fast TypeScript + JSX compilation |
| `resolve.alias` | `@/` → `./src/` | Clean imports (`@/lib/api` instead of `../../lib/api`) |
| `server.port` | 5173 | Dev server port |
| `server.proxy./api` | → `localhost:3001` | Dev proxy for API calls |
| `server.proxy./health` | → `localhost:3001` | Dev proxy for health checks |
| `build.sourcemap` | `true` | Source maps in production builds |

---

## TypeScript Configuration (`tsconfig.json`)

| Setting | Value | Purpose |
|---------|-------|---------|
| `strict` | `true` | Strict type checking (no implicit any, null checks) |
| `target` | `ES2020` | Modern JS features (optional chaining, nullish coalescing) |
| `module` | `ESNext` | ES modules for Vite tree shaking |
| `moduleResolution` | `bundler` | Vite module resolution |
| `jsx` | `react-jsx` | React 18 JSX transform (no `import React`) |
| `baseUrl` | `.` | Required for path aliases |
| `paths` | `@/*: [src/*]` | Path alias matching Vite alias |
| `noEmit` | `true` | TypeScript only type-checks; SWC compiles |

---

## Tailwind Configuration (`tailwind.config.js`)

| Setting | Value | Purpose |
|---------|-------|---------|
| `darkMode` | `'class'` | Dark mode via CSS class (not media query) |
| `content` | `['./src/**/*.{ts,tsx}']` | Files to scan for class usage |
| `theme.extend.colors` | CSS variable mapping | shadcn/ui color system |
| `theme.extend.colors.delaware` | Brand colors | Delaware red + teal |
| `theme.extend.colors.protocol` | Protocol colors | 6 protocol color sets |
| `theme.extend.keyframes` | Custom animations | Accordion, pulse, shimmer |
| `plugins` | `tailwindcss-animate` | Animation utilities |

---

## Nginx Configuration (`nginx.conf`)

### Proxy Rules

| Location | Target | Headers |
|----------|--------|---------|
| `/api/` | `http://gateway-core:3001/api/` | Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto |
| `/health/` | `http://gateway-core:3001/health/` | Host |
| `/grafana/` | `http://grafana:3000/` | Host, X-Real-IP |
| `/` | Static files | Cache headers |

### Compression

| Setting | Value |
|---------|-------|
| `gzip` | on |
| `gzip_vary` | on |
| `gzip_min_length` | 1024 bytes |
| `gzip_types` | text/plain, text/css, application/json, application/javascript, text/xml, image/svg+xml |

### Caching

| Asset Pattern | Cache Duration | Cache-Control |
|--------------|---------------|--------------|
| `*.js, *.css` | 1 year | `public, immutable` |
| `*.png, *.jpg, *.svg` | 1 year | `public, immutable` |
| `*.woff, *.woff2` | 1 year | `public, immutable` |
| `index.html` | No cache | `no-cache` (implicit) |

### Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `SAMEORIGIN` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-XSS-Protection` | `1; mode=block` | XSS filter |

---

## Docker Build Args

| Arg | Default | Description |
|-----|---------|-------------|
| `VITE_API_URL` | `""` | API base URL (empty = use proxy) |
| `VITE_WS_URL` | `""` | WebSocket URL |

```bash
# Standard build (uses Nginx proxy)
docker build -t nexus/web-ui:latest .

# Build for external API
docker build \
  --build-arg VITE_API_URL=https://api.edge.example.com \
  --build-arg VITE_WS_URL=wss://api.edge.example.com/ws \
  -t nexus/web-ui:external .
```

---

## Package Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite` | Start dev server with HMR |
| `build` | `vite build` | Production build |
| `preview` | `vite preview` | Preview production build locally |
| `lint` | `eslint src/` | Run ESLint checks |
| `lint:fix` | `eslint src/ --fix` | Auto-fix ESLint issues |
| `typecheck` | `tsc --noEmit` | TypeScript type checking |

---

## Auth Configuration (Runtime)

Auth is configured entirely at runtime via OIDC discovery:

| Setting | Source | Description |
|---------|--------|-------------|
| OIDC enabled | `/.well-known/openid-configuration` response | 200 = enabled, error = disabled |
| Authorization URL | Discovered from well-known | Authentik authorization endpoint |
| Token URL | Discovered from well-known | Authentik token endpoint |
| Userinfo URL | Discovered from well-known | Authentik userinfo endpoint |
| End session URL | Discovered from well-known | Authentik logout endpoint |
| Client ID | Configured in Authentik | OIDC client ID for Web UI app |
| Redirect URI | `{window.origin}/auth/callback` | Automatically derived |

**No auth-related environment variables are needed in the Web UI itself.**
Auth configuration lives in Authentik and is discovered at runtime.

---

## Related Documentation

- [Deployment](deployment.md) — how these configs are used in Docker/K8s
- [System Overview](system_overview.md) — proxy architecture diagram
- [Auth Architecture](auth_architecture.md) — OIDC discovery details

---

*Document Version: 1.0*
*Last Updated: March 2026*
