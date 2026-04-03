# Chapter 15 — Testing Strategy

> Vitest setup, test categories, and recommended testing approach.

---

## Test Runner

| Property  | Value                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| Framework | Vitest 1.6.x                                                                 |
| Runtime   | Node 20+ (ESM)                                                               |
| Commands  | `pnpm test` (run once), `pnpm test:watch` (watch mode), `pnpm test:coverage` |

## Architecture Testing Approach

Gateway Core's architecture naturally divides into testable layers:

```
┌─────────────────────────────────────────────────────────────┐
│                     E2E / API Tests                         │
│  Full HTTP requests against running server                  │
│  (requires PostgreSQL + MQTT, or mocked services)           │
├─────────────────────────────────────────────────────────────┤
│                   Integration Tests                         │
│  Service layer with real DB, MQTT mocked at boundary        │
├──────────────┬──────────────┬──────────────┬────────────────┤
│  Unit Tests  │  Unit Tests  │  Unit Tests  │  Unit Tests    │
│  Transform   │  Validation  │  Errors      │  Metrics       │
│  (pure)      │  (Zod)       │  (classes)   │  (normalize)   │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

## Unit Test Targets

### Transform Layer (`mqtt/transform.ts`)

The transform module is **pure** — no external dependencies, no side effects. Ideal for exhaustive unit testing:

| Test Case             | Input                                | Expected Output                  |
| --------------------- | ------------------------------------ | -------------------------------- |
| Protocol mapping      | `{protocol: 'modbus'}`               | `{protocol: 'modbus_tcp'}`       |
| Duration formatting   | `{pollIntervalMs: 1000}`             | `{poll_interval: '1000ms'}`      |
| Timeout extraction    | `{protocolConfig: {timeout: 10000}}` | `{connection: {timeout: '10s'}}` |
| Null defaults         | `{scaleFactor: null}`                | `{scale_factor: 1}`              |
| Topic suffix fallback | `{topicSuffix: null, name: 'temp'}`  | `{topic_suffix: 'temp'}`         |
| OPC node ID fallback  | `{address: 'ns=2;s=Tag1'}`           | `{opc_node_id: 'ns=2;s=Tag1'}`   |
| Snake case conversion | `{byteOrder: 'big_endian'}`          | `{byte_order: 'big_endian'}`     |

### Validation Schemas (`routes/*/schema.ts`)

Zod schemas can be tested directly:

```typescript
import { createDeviceSchema } from './schema';

test('rejects missing required fields', () => {
  const result = createDeviceSchema.safeParse({});
  expect(result.success).toBe(false);
});

test('accepts valid device', () => {
  const result = createDeviceSchema.safeParse({
    name: 'PLC-1',
    protocol: 'modbus',
    host: '192.168.1.1',
    port: 502,
  });
  expect(result.success).toBe(true);
});
```

### Error Classes (`lib/errors.ts`)

```typescript
test('NotFoundError has correct status', () => {
  const err = new NotFoundError('Device', 'abc');
  expect(err.statusCode).toBe(404);
  expect(err.code).toBe('NOT_FOUND');
  expect(err.message).toBe("Device with id 'abc' not found");
});
```

### Route Normalization (`lib/metrics.ts`)

```typescript
test('normalizes UUIDs in URLs', () => {
  expect(normalizeRoute('/api/devices/550e8400-e29b-41d4-a716-446655440000')).toBe(
    '/api/devices/:id'
  );
});

test('strips query strings', () => {
  expect(normalizeRoute('/api/tags?limit=50&offset=0')).toBe('/api/tags');
});
```

### Environment Validation (`config/env.ts`)

```typescript
test('booleanEnv parses "false" as false', () => {
  // Test the custom boolean transform
});

test('defaults are applied for missing vars', () => {
  // PORT defaults to 3001, etc.
});
```

### Circuit Breaker State (`proxy/protocol-gateway.ts`)

```typescript
test('trips after 5 consecutive failures', () => {
  for (let i = 0; i < 5; i++) recordFailure();
  expect(getCircuitBreakerState().state).toBe('OPEN');
});

test('transitions to HALF_OPEN after cooldown', () => {
  // Simulate time passage
});
```

### Topic Matching (`websocket/bridge.ts`)

```typescript
test('# matches remaining levels', () => {
  expect(topicMatchesPattern('a/b/c/d', 'a/#')).toBe(true);
});

test('+ matches single level', () => {
  expect(topicMatchesPattern('a/b/c', 'a/+/c')).toBe(true);
  expect(topicMatchesPattern('a/b/c/d', 'a/+/c')).toBe(false);
});
```

## Integration Test Targets

### Service Layer (DeviceService, TagService)

Tests against a real PostgreSQL instance (test database):

| Test                      | What It Validates                   |
| ------------------------- | ----------------------------------- |
| Create device             | INSERT + unique constraint handling |
| Update with configVersion | Atomic increment                    |
| Delete cascades tags      | ON DELETE CASCADE                   |
| Toggle enabled            | State flip                          |
| List with filters         | WHERE clause generation             |
| Search (ILIKE)            | Wildcard escaping                   |
| Bulk create tags          | Multi-row insert + constraint       |
| Setup status transitions  | State machine correctness           |

### MQTT Subscriber

| Test              | What It Validates                            |
| ----------------- | -------------------------------------------- |
| Status ingest     | JSON parse → DB update                       |
| Config sync       | Fetch all devices → transform → publish bulk |
| Malformed payload | Error handling (logged, not thrown)          |

## API Test Targets

Full HTTP request/response tests via `fastify.inject()`:

| Endpoint                     | Test Cases                                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| `POST /api/devices`          | Valid create, missing fields, duplicate name (409), auth required |
| `GET /api/devices`           | List, filter by protocol/status, search, pagination               |
| `PUT /api/devices/:id`       | Update, not found (404), configVersion incremented                |
| `DELETE /api/devices/:id`    | Delete, not found (404), cascades tags                            |
| `POST /api/devices/:id/test` | Proxy success, PG down (502), circuit open (503)                  |
| `GET /health/ready`          | Healthy (200), degraded (503 when DB/MQTT down)                   |

## npm Scripts

```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

## Type Checking

TypeScript strict mode with additional checks:

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true
}
```

Run independently: `pnpm typecheck` (`tsc --noEmit`)

## Linting

ESLint with TypeScript parser:

```bash
pnpm lint        # Check
pnpm lint:fix    # Auto-fix
```

---

_Previous: [Chapter 14 — Deployment](deployment.md) | Next: [Chapter 16 — Configuration Reference](configuration_reference.md)_
