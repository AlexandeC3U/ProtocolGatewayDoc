# Chapter 6 — Pipeline Architecture

> The accumulator loop, flush triggers, batchChan, and writer workers — the core of the ingestion pipeline.

---

## Pipeline Overview

The pipeline is a three-stage streaming architecture:

```
Stage 1: Receive           Stage 2: Accumulate         Stage 3: Write
(MQTT callbacks)           (single goroutine)          (N goroutines)

┌──────────────┐           ┌──────────────┐            ┌──────────────┐
│  Paho MQTT   │           │  Accumulator │            │  Writer 0    │
│  callbacks   │──push──>  │    Loop      │──flush──>  │  Writer 1    │
│  (N threads) │  (non-    │              │  (batch    │  Writer 2    │
│              │  blocking)│  currentBatch│  channel)  │  ...         │
│              │           │  + flush     │            │  Writer 7    │
└──────────────┘           │  triggers    │            └──────┬───────┘
       │                   └──────────────┘                   │
       │                                                      │
  pointsChan                batchChan                    TimescaleDB
  (200,000)                (WriterCount×2=16)           (COPY protocol)
```

---

## Stage 1: Message Reception

The `handleMessage()` function is called by Paho's internal goroutines for every MQTT message:

```go
func (s *IngestionService) handleMessage(topic string, payload []byte, receivedAt time.Time) {
    defer func() {
        if r := recover(); r != nil {
            // Channel closed during shutdown — safe to discard
        }
    }()

    // Fast-path shutdown check (atomic load, no lock)
    if s.shutdownFlag.Load() {
        return
    }

    // Parse JSON → DataPoint (from sync.Pool)
    dp, err := s.subscriber.ParseMessage(topic, payload, receivedAt)
    if err != nil {
        return  // Parse error already counted in metrics
    }

    s.pointsReceived.Add(1)
    s.metrics.IncPointsReceived()

    // Non-blocking send — never blocks MQTT callbacks
    select {
    case s.pointsChan <- dp:
        s.metrics.SetBufferUsage(float64(len(s.pointsChan)) / float64(cap(s.pointsChan)))
    default:
        // Buffer full — drop point
        domain.ReleaseDataPoint(dp)
        s.pointsDropped.Add(1)
        s.droppedSinceLastLog.Add(1)
        s.metrics.IncPointsDropped()
    }
}
```

**Key design decisions:**

1. **`defer recover()`** — During shutdown, `pointsChan` is closed. A send to a closed channel panics. The recover catches this safely.

2. **Atomic shutdown flag** — Checked before any work. Avoids allocating/parsing DataPoints that will be discarded.

3. **Non-blocking send** — The `select` with `default` ensures MQTT callbacks never block. This prevents Paho client stalls that would halt all topic processing.

4. **Release on drop** — When the buffer is full, the DataPoint is returned to the pool immediately to prevent memory leaks.

### Drop Reporting

A separate goroutine aggregates drops to avoid log flooding:

```go
func (s *IngestionService) dropReporter(ctx context.Context) {
    ticker := time.NewTicker(5 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            dropped := s.droppedSinceLastLog.Swap(0)
            if dropped > 0 {
                s.logger.Warn().Uint64("dropped", dropped).
                    Msg("Dropped data points (buffer full)")
            }
        }
    }
}
```

---

## Stage 2: Accumulator Loop

A single goroutine reads from `pointsChan` and accumulates points into batches:

```go
func (b *Batcher) accumulatorLoop() {
    defer b.wg.Done()
    defer b.flushAndClose()  // Flush remaining + close(batchChan)

    ticker := time.NewTicker(b.config.FlushInterval)  // 250ms default
    defer ticker.Stop()

    for {
        select {
        case dp, ok := <-b.pointsChan:
            if !ok {
                return  // Channel closed — shutdown
            }
            b.addToBatch(dp)

        case <-ticker.C:
            b.flushIfNotEmpty()
        }
    }
}
```

**Note:** The accumulator does NOT check `ctx.Done()` in the select. It only exits when `pointsChan` is closed. This ensures all buffered points are drained before shutdown.

### addToBatch

```go
func (b *Batcher) addToBatch(dp *domain.DataPoint) {
    b.batchMu.Lock()
    defer b.batchMu.Unlock()

    b.currentBatch.Points = append(b.currentBatch.Points, dp)
    b.pointsBatched.Add(1)

    if b.currentBatch.Size() >= b.config.BatchSize {
        b.flush()  // Must hold batchMu
    }
}
```

### Flush Triggers

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLUSH TRIGGERS                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Batch Full (BatchSize = 10,000 points)                      │
│     └── Triggered inside addToBatch() when len >= BatchSize     │
│     └── Immediate flush, no waiting                             │
│                                                                 │
│  2. Timer Expiry (FlushInterval = 250ms)                        │
│     └── Ticker fires every 250ms                                │
│     └── Flushes partial batch if not empty                      │
│     └── Caps maximum latency from receive to write              │
│                                                                 │
│  3. Shutdown (pointsChan closed)                                │
│     └── accumulatorLoop returns                                 │
│     └── flushAndClose() flushes remaining + closes batchChan    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### flush (internal)

```go
func (b *Batcher) flush() {
    // Must hold batchMu

    batch := b.currentBatch
    b.currentBatch = domain.AcquireBatchWithCap(b.config.BatchSize)
    b.batchesFlushed.Add(1)
    b.metrics.IncBatchesFlushed()

    // Non-blocking send to batchChan
    select {
    case b.batchChan <- batch:
        b.metrics.SetBatchQueueDepth(float64(len(b.batchChan)))
    default:
        // batchChan full OR context cancelled — direct write
        if err := b.writer.WriteBatch(context.Background(), batch); err != nil {
            b.logger.Error().Err(err).Msg("Direct write failed (batch channel full)")
        }
        domain.ReleaseBatch(batch)
    }
}
```

**Fallback direct write:** If `batchChan` is full (all writers busy, queue saturated), the accumulator writes directly to the database instead of dropping the batch. This is a last-resort path that trades accumulator goroutine blocking for data preservation.

---

## Stage 3: Writer Workers

N writer goroutines (default: 8) consume batches from `batchChan`:

```go
func (b *Batcher) writerLoop() {
    defer b.wg.Done()

    for batch := range b.batchChan {
        if err := b.writer.WriteBatch(context.Background(), batch); err != nil {
            b.logger.Error().Err(err).
                Int("batch_size", batch.Size()).
                Msg("Failed to write batch")
        }
        domain.ReleaseBatch(batch)
        b.metrics.SetBatchQueueDepth(float64(len(b.batchChan)))
    }
}
```

**Key design decisions:**

1. **`context.Background()`** — Not the batcher's context. This ensures in-flight DB writes complete even after shutdown cancels the root context.

2. **`range batchChan`** — The loop exits when `batchChan` is closed (by `flushAndClose()`). This is the clean shutdown signal.

3. **`ReleaseBatch()` always called** — Whether the write succeeds or fails, the batch and its DataPoints are returned to the pool.

---

## Channel Sizing

```
┌─────────────────────────────────────────────────────────────────┐
│                    CHANNEL CAPACITY                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  pointsChan: 200,000 DataPoint pointers                         │
│  ├── Memory: ~1.6 MB (200k × 8 bytes per pointer)               │
│  ├── At 40k msg/s: ~5 seconds of buffer                         │
│  └── Purpose: absorb MQTT burst, decouple from batcher          │
│                                                                 │
│  batchChan: WriterCount × 2 = 16 Batch pointers                 │
│  ├── Memory: ~128 bytes (16 × 8 bytes per pointer)              │
│  ├── At 10k points/batch: 160k points queued                    │
│  └── Purpose: decouple accumulator from slow writers            │
│                                                                 │
│  Total buffered: 200k (pointsChan) + 160k (batchChan) = 360k    │
│  At 40k msg/s: ~9 seconds of total buffering                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Concurrency Model

```
Goroutines:
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Paho MQTT goroutines (managed by Paho, not by us)           │
│  ├── Connection manager (1)                                  │
│  ├── Message dispatch (1)                                    │
│  └── Per-callback goroutine (unknown count)                  │
│                                                              │
│  Service goroutines (managed by us):                         │
│  ├── Accumulator loop (1)         ─── tracked by wg          │
│  ├── Writer workers (8)           ─── tracked by wg          │
│  └── Drop reporter (1)           ─── exits on ctx.Done()     │
│                                                              │
│  Total service goroutines: 10                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Synchronization:
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  Channels (primary coordination):                            │
│  ├── pointsChan: MQTT callbacks → accumulator                │
│  └── batchChan:  accumulator → writers                       │
│                                                              │
│  Atomics (counters, flags):                                  │
│  ├── shutdownFlag       (IngestionService)                   │
│  ├── pointsReceived     (IngestionService)                   │
│  ├── pointsDropped      (IngestionService)                   │
│  ├── droppedSinceLastLog(IngestionService)                   │
│  ├── batchesFlushed     (Batcher)                            │
│  ├── pointsBatched      (Batcher)                            │
│  ├── batchesWritten     (Writer)                             │
│  ├── pointsWritten      (Writer)                             │
│  ├── writeErrors        (Writer)                             │
│  ├── retriesTotal       (Writer)                             │
│  ├── totalWriteTime     (Writer)                             │
│  ├── isConnected        (Subscriber)                         │
│  ├── everConnected      (Subscriber)                         │
│  └── parseErrors        (Subscriber)                         │
│                                                              │
│  Mutex (batch state):                                        │
│  └── batchMu: guards currentBatch + flush                    │
│                                                              │
│  RWMutex (handler setup):                                    │
│  └── handlerMu: guards MQTT message handler assignment       │
│                                                              │
│  WaitGroup (shutdown):                                       │
│  └── batcher.wg: accumulator + writers                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Batcher Stats

The batcher exposes runtime statistics via the `/status` endpoint:

```json
{
  "batches_flushed": 15234,
  "points_batched": 152340000,
  "current_batch_size": 4521,
  "current_batch_age_ms": 123,
  "pending_batches": 2
}
```

| Field                  | Source                         | Meaning                                 |
| ---------------------- | ------------------------------ | --------------------------------------- |
| `batches_flushed`      | `atomic.Uint64`                | Total batches sent to writers           |
| `points_batched`       | `atomic.Uint64`                | Total points accumulated into batches   |
| `current_batch_size`   | `len(currentBatch.Points)`     | Points in the current (unflushed) batch |
| `current_batch_age_ms` | `now - currentBatch.CreatedAt` | How long since last flush (ms)          |
| `pending_batches`      | `len(batchChan)`               | Batches queued waiting for writers      |

---

_Previous: [Chapter 5 — Domain Model](domain_model.md) — Next: [Chapter 7 — Writer Internals](writer_internals.md)_

---

_Document Version: 1.0 — March 2026_
