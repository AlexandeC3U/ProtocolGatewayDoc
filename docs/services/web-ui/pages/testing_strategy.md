# Chapter 12 — Testing Strategy

> Vitest setup, React Testing Library patterns, test organization,
> and testing approach for the Web UI.

---

## Test Infrastructure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       TEST STACK                                                │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Vitest 1.6                                                             │    │
│  │  • Vite-native test runner (same config as dev server)                  │    │
│  │  • Jest-compatible API (describe, it, expect)                           │    │
│  │  • Fast startup (uses SWC transform, no tsc)                            │    │
│  │  • Watch mode with HMR                                                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  React Testing Library (planned)                                        │    │
│  │  • Render components in jsdom                                           │    │
│  │  • User-centric queries (getByRole, getByText)                          │    │
│  │  • Fire events (click, type, submit)                                    │    │
│  │  • Async utilities (waitFor, findBy)                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  MSW (planned)                                                          │    │
│  │  • Mock Service Worker for API mocking                                  │    │
│  │  • Intercepts fetch() at the network level                              │    │
│  │  • Same mock definitions for dev server and tests                       │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Test Pyramid

```
                    ┌─────────┐
                    │  E2E    │   Playwright (future)
                    │  Tests  │   Full browser, real API
                    ├─────────┤
                    │         │
                ┌───┤ Integr. ├───┐   Component + API mock
                │   │  Tests  │   │   RTL + MSW
                │   ├─────────┤   │
                │   │         │   │
            ┌───┤   │  Unit   │   ├───┐   Pure functions
            │   │   │  Tests  │   │   │   Utils, transforms
            │   │   └─────────┘   │   │
            └───┘                 └───┘
```

| Layer | Tool | Scope | Current Status |
|-------|------|-------|---------------|
| Unit | Vitest | `lib/utils.ts`, transform functions, validators | Minimal |
| Integration | Vitest + RTL + MSW | Pages, components, API flows | Planned |
| E2E | Playwright | Full user flows in browser | Future |

---

## Current Test Setup

### Vitest Configuration

Vitest shares the Vite configuration, so path aliases (`@/`), SWC transforms,
and environment settings work identically in tests and development:

```typescript
// vitest inherits from vite.config.ts
// Additional test config can be added via vitest.config.ts or inline:
{
  test: {
    environment: 'jsdom',        // Browser-like DOM for component tests
    globals: true,               // describe, it, expect without imports
    setupFiles: ['./src/test/setup.ts'],  // Global test setup
    css: false,                  // Skip CSS processing in tests
  }
}
```

---

## Test Patterns

### Unit Test: Utility Functions

```typescript
// __tests__/lib/utils.test.ts
import { cn, formatDate } from '@/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
  });

  it('deduplicates conflicting Tailwind classes', () => {
    expect(cn('bg-red-500', 'bg-blue-500')).toBe('bg-blue-500');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', true && 'visible')).toBe('base visible');
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-03-15T10:30:00Z');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
  });
});
```

### Component Test Pattern (Recommended)

```typescript
// __tests__/pages/devices/DevicesPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DevicesPage } from '@/pages/devices/DevicesPage';

// Test wrapper with required providers
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DevicesPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<DevicesPage />);
    expect(screen.getByRole('status')).toBeInTheDocument(); // spinner
  });

  it('shows empty state when no devices', async () => {
    // With MSW handler returning empty array
    renderWithProviders(<DevicesPage />);
    await waitFor(() => {
      expect(screen.getByText(/no devices/i)).toBeInTheDocument();
    });
  });

  it('renders device cards', async () => {
    // With MSW handler returning mock devices
    renderWithProviders(<DevicesPage />);
    await waitFor(() => {
      expect(screen.getByText('Production PLC')).toBeInTheDocument();
    });
  });
});
```

### API Mock Pattern (MSW)

```typescript
// src/test/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/devices', () => {
    return HttpResponse.json([
      {
        id: '1',
        name: 'Production PLC',
        protocol: 'modbus',
        status: 'online',
        host: '192.168.1.100',
        port: 502,
        enabled: true,
        setupStatus: 'active',
      },
    ]);
  }),

  http.get('/health/ready', () => {
    return HttpResponse.json({
      status: 'ok',
      checks: { database: 'ok', mqtt: 'ok' },
    });
  }),
];
```

### Auth Mock Pattern

```typescript
// Mock AuthContext for tests that don't need real auth
const mockAuthContext = {
  authEnabled: false,
  isAuthenticated: true,
  isLoading: false,
  user: { name: 'Test User', email: 'test@example.com', role: 'admin' },
  login: vi.fn(),
  logout: vi.fn(),
  getToken: vi.fn(() => 'mock-token'),
};

// Wrap component with mocked auth
<AuthContext.Provider value={mockAuthContext}>
  <ComponentUnderTest />
</AuthContext.Provider>
```

---

## What to Test

### High-Value Test Targets

| Component | Test Focus | Priority |
|-----------|-----------|----------|
| `lib/api.ts` | Error handling, 401 recovery, response parsing | HIGH |
| `lib/auth.ts` | PKCE generation, token exchange, refresh flow | HIGH |
| `DevicesPage` | Loading, empty, error states; filter behavior | HIGH |
| `DeviceDialog` | Form validation, protocol config switching | HIGH |
| `BrowseDialog` | Tree expansion, selection, bulk tag creation | MEDIUM |
| `TagDialog` | Protocol-specific address fields, validation | MEDIUM |
| `ProtectedRoute` | Auth enabled/disabled, redirect behavior | MEDIUM |
| `lib/utils.ts` | `cn()`, `formatDate()` | LOW (simple) |

### What NOT to Test

- Radix UI primitives (tested by Radix team)
- TailwindCSS classes (visual, not behavioral)
- React Router (tested by React Router team)
- TanStack Query internals (tested by TanStack team)

---

## Test Commands

```bash
pnpm test          # Run tests once
pnpm test:watch    # Watch mode with HMR
pnpm test:coverage # Run with coverage report
pnpm test:ui       # Vitest UI (browser-based test dashboard)
```

---

## E2E Testing (Future)

When E2E tests are implemented, Playwright would cover:

| Flow | Steps |
|------|-------|
| Login | Navigate → SSO → Callback → Dashboard |
| Create device | Dashboard → Devices → Add → Fill form → Save → Verify in list |
| Browse OPC UA | Device detail → Tags tab → Browse → Expand → Select → Add |
| Delete device | Device detail → Delete → Confirm → Verify redirected to list |
| System health | System → Verify all cards show status |

---

## Related Documentation

- [Component Architecture](component_architecture.md) — components to test
- [API Client](api_client.md) — API functions to mock
- [Auth Architecture](auth_architecture.md) — auth flows to test

---

*Document Version: 1.0*
*Last Updated: March 2026*
