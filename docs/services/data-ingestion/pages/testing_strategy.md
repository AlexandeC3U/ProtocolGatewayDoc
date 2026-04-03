# Chapter 14 — Testing Strategy

> Unit tests, integration tests, end-to-end tests, fuzz testing, benchmarks, and the test environment.

---

## Test Pyramid

```
                    ┌─────────────┐
                    │   E2E Tests │  Full pipeline: MQTT → DB
                    │  (few, slow)│  Real EMQX + TimescaleDB
                    ├─────────────┤
                    │ Integration │  Real DB/MQTT dependencies
                    │  (moderate) │  Isolated test ports
                    ├─────────────┤
                    │  Unit Tests │  Mocked interfaces
                    │ (many, fast)│  No external deps
                    └─────────────┘
```

---

## Unit Tests

Unit tests use mock implementations of `domain.MQTTSubscriber` and `domain.BatchWriter` interfaces. No external dependencies required.

### What to Test

| Component        | Test Focus                                                       |
| ---------------- | ---------------------------------------------------------------- |
| `ParsePayload`   | JSON parsing, value coercion, quality mapping, validation guards |
| `DataPoint pool` | Acquire/Release lifecycle, field zeroing on release              |
| `Batch pool`     | Cascade release (DataPoints returned), capacity management       |
| `Batcher`        | Batch-full flush, timer flush, shutdown flush, drop on full      |
| `Config loader`  | YAML parsing, env var expansion, defaults, validation errors     |
| `Error classify` | SQLSTATE classification, string pattern matching                 |
| `Health checker` | Healthy/degraded/unhealthy responses, component status           |

### Running Unit Tests

```bash
# All unit tests
make test

# Short mode (skip slow tests)
make test-unit

# With race detector
make test-race

# With coverage report
make test-cover
```

### Example: ParsePayload Tests

```go
func TestParsePayload_NumericValue(t *testing.T) {
    payload := `{"v": 23.5, "q": "good", "ts": 1709712000000}`
    dp, err := domain.ParsePayload("dev/plc-001/temp", payload, time.Now())
    require.NoError(t, err)
    assert.Equal(t, 23.5, *dp.Value)
    assert.Equal(t, int16(192), dp.Quality)
    domain.ReleaseDataPoint(dp)
}

func TestParsePayload_BooleanToFloat(t *testing.T) {
    payload := `{"v": true, "q": "good", "ts": 1709712000000}`
    dp, err := domain.ParsePayload("dev/plc-001/alarm", payload, time.Now())
    require.NoError(t, err)
    assert.Equal(t, 1.0, *dp.Value)
    domain.ReleaseDataPoint(dp)
}

func TestParsePayload_TimestampTooOld(t *testing.T) {
    oldTs := time.Now().Add(-31 * 24 * time.Hour).UnixMilli()
    payload := fmt.Sprintf(`{"v": 1, "ts": %d}`, oldTs)
    _, err := domain.ParsePayload("dev/x/y", payload, time.Now())
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "too old")
}

func TestParsePayload_PayloadTooLarge(t *testing.T) {
    payload := make([]byte, domain.MaxPayloadSize+1)
    _, err := domain.ParsePayload("dev/x/y", payload, time.Now())
    assert.Error(t, err)
}
```

---

## Integration Tests

Integration tests run against real EMQX and TimescaleDB instances using the test compose file:

### Test Environment

```bash
# Start test dependencies (isolated ports)
make test-env-up
# EMQX on :11883, TimescaleDB on :15432

# Run integration tests
make test-integration

# Stop test dependencies
make test-env-down
```

### What to Test

| Test                       | Dependencies     | Validates                                         |
| -------------------------- | ---------------- | ------------------------------------------------- |
| MQTT subscribe + receive   | EMQX             | Shared subscriptions, message delivery, reconnect |
| COPY batch write           | TimescaleDB      | COPY protocol, data integrity, column mapping     |
| INSERT batch write         | TimescaleDB      | Fallback path, per-row error handling             |
| Circuit breaker trip/reset | TimescaleDB      | Breaker opens on failure, closes on recovery      |
| History query              | TimescaleDB      | Stats aggregation, time range filtering, limits   |
| Full pipeline              | EMQX+TimescaleDB | Publish MQTT → verify row in DB                   |

### Example: Full Pipeline Test

```go
func TestFullPipeline(t *testing.T) {
    // Start MQTT subscriber and DB writer against test instances
    // Publish a test message to EMQX
    // Wait for ingestion to process
    // Query TimescaleDB to verify the point was written
    // Assert: topic, value, quality, timestamp match
}
```

---

## End-to-End Tests

E2E tests exercise the complete service binary against real dependencies:

```bash
make test-e2e
```

### E2E Test Flow

```
1. Start data-ingestion binary (as subprocess)
2. Wait for /health/ready to return 200
3. Publish N messages to EMQX via mosquitto_pub
4. Wait for lag metric to settle
5. Query TimescaleDB: verify N rows written
6. Verify metrics: received == written, dropped == 0
7. Shutdown service (SIGTERM)
8. Verify graceful shutdown (all data flushed)
```

---

## Fuzz Testing

Fuzz tests exercise `ParsePayload` with random inputs to find crashes and panics:

```bash
make test-fuzz
```

```go
func FuzzParsePayload(f *testing.F) {
    // Seed corpus with valid payloads
    f.Add("dev/plc/temp", []byte(`{"v":1,"ts":1709712000000}`))
    f.Add("dev/plc/state", []byte(`{"v":"RUNNING","q":"good","ts":1709712000000}`))

    f.Fuzz(func(t *testing.T, topic string, payload []byte) {
        dp, err := domain.ParsePayload(topic, payload, time.Now())
        if err == nil && dp != nil {
            domain.ReleaseDataPoint(dp)  // Must not panic
        }
    })
}
```

**Goal:** Ensure `ParsePayload` never panics on any input. All invalid inputs should return an error, not crash.

---

## Benchmarks

```bash
# All benchmarks
make bench

# Domain-specific benchmarks
make bench-domain

# Compare with baseline
make bench-compare
```

### Key Benchmarks

| Benchmark                    | What It Measures                       | Target          |
| ---------------------------- | -------------------------------------- | --------------- |
| `BenchmarkParsePayload`      | JSON parse + validation + pool acquire | < 500ns/op      |
| `BenchmarkAcquireRelease`    | DataPoint pool acquire/release cycle   | < 50ns/op       |
| `BenchmarkBatchAccumulate`   | addToBatch with mutex                  | < 100ns/op      |
| `BenchmarkBuildMetadataJSON` | Manual JSON builder vs json.Marshal    | < 200ns/op      |
| `BenchmarkWriteBatchCopy`    | COPY protocol write (requires DB)      | < 10ms/10k pts  |
| `BenchmarkWriteBatchInsert`  | INSERT batch write (requires DB)       | < 100ms/10k pts |

### Example Benchmark

```go
func BenchmarkParsePayload(b *testing.B) {
    topic := "dev/plc-001/temperature"
    payload := []byte(`{"v":23.5,"q":"good","u":"°C","ts":1709712000000,"device_id":"plc-001","tag_id":"temperature"}`)
    now := time.Now()

    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        dp, err := domain.ParsePayload(topic, payload, now)
        if err != nil {
            b.Fatal(err)
        }
        domain.ReleaseDataPoint(dp)
    }
}
```

---

## Test Mocks

Mock implementations for unit testing:

```go
// MockBatchWriter implements domain.BatchWriter
type MockBatchWriter struct {
    WriteBatchFunc func(ctx context.Context, batch *domain.Batch) error
    IsHealthyFunc  func(ctx context.Context) bool
    CloseFunc      func()
    StatsFunc      func() map[string]interface{}
    Batches        []*domain.Batch  // Captured for assertion
    mu             sync.Mutex
}

// MockMQTTSubscriber implements domain.MQTTSubscriber
type MockMQTTSubscriber struct {
    ConnectFunc    func(ctx context.Context) error
    DisconnectFunc func()
    IsConnectedVal bool
    // ...
}
```

---

## Makefile Test Targets

| Target                  | Description                           |
| ----------------------- | ------------------------------------- |
| `make test`             | Run all tests (short mode)            |
| `make test-unit`        | Unit tests only                       |
| `make test-race`        | All tests with Go race detector       |
| `make test-cover`       | Generate HTML coverage report         |
| `make test-integration` | Integration tests (requires test-env) |
| `make test-e2e`         | End-to-end tests (requires test-env)  |
| `make test-fuzz`        | Fuzz testing (ParsePayload)           |
| `make bench`            | Run all benchmarks                    |
| `make bench-domain`     | Domain-layer benchmarks only          |
| `make bench-compare`    | Compare benchmarks against baseline   |
| `make test-env-up`      | Start test EMQX + TimescaleDB         |
| `make test-env-down`    | Stop test dependencies                |
| `make test-env-health`  | Check test dependency health          |

---

_Previous: [Chapter 13 — Performance Tuning](performance_tuning.md) — Next: [Chapter 15 — Configuration Reference](configuration_reference.md)_

---

_Document Version: 1.0 — March 2026_
