# Chapter 17 — Edge Cases & Operational Notes

> Known limitations, operational gotchas, and debugging tips.

---

## Known Limitations

### Single Instance Only

Gateway Core is designed for **single-replica deployment**. Running multiple instances causes:

| Problem | Cause |
|---------|-------|
| Duplicate MQTT subscriptions | Each instance subscribes to `$nexus/status/devices/+` |
| Race conditions on status update | Two instances may update the same device row simultaneously |
| Inconsistent circuit breaker state | Each instance has its own in-memory breaker |
| WebSocket bridge fragmentation | Clients connect to different instances, each with partial subscriptions |

**Mitigation:** The K8s deployment uses `replicas: 1` and a PodDisruptionBudget with `minAvailable: 1`.

### Config Sync Limit

The bulk config sync query uses `LIMIT 1000` on devices. Deployments with more than 1000 devices will have incomplete initial sync. Tags are included per-device, so the actual data volume is `devices × avg_tags_per_device`.

### No Token Refresh for WebSocket

WebSocket connections are authenticated at upgrade time. If the JWT expires during a long-lived connection, the connection remains active until the client disconnects. There is no server-side token expiry check on established connections.

**Workaround:** Clients should implement reconnect-on-401 logic — close and reconnect with a fresh token.

### MQTT QoS Trade-offs

Config notifications use QoS 1 (at-least-once). This means:
- Protocol-gateway may receive duplicate notifications (must be idempotent)
- If MQTT is down during a device change, the notification is lost (no persistent session because `clean: true`)

### No Distributed Transactions

Device creation writes to PostgreSQL first, then publishes to MQTT. If the process crashes between these operations, the device exists in DB but protocol-gateway doesn't know about it. The next config change or manual sync will correct this.

## Operational Gotchas

### "Device stuck in 'created' status"

**Cause:** The test-connection proxy call failed or was never made.

**Check:**
1. Is protocol-gateway running? (`GET /api/system/health`)
2. Is the circuit breaker open? (check `protocol_gateway.circuitBreaker` in health response)
3. Was the test-connection endpoint called? (check audit log)

**Fix:** Retry `POST /api/devices/:id/test` or manually update setupStatus via DB.

### "WebSocket clients not receiving data"

**Cause possibilities:**
1. MQTT broker disconnected (`GET /health/ready` → mqtt status)
2. Topic doesn't match allowed prefixes (`$nexus/data/` or `$nexus/status/` only)
3. Protocol-gateway not publishing (check its status)
4. Client subscribed to wrong topic pattern

**Debug:** Check `GET /api/system/info` → `websocket.connections` and `websocket.subscriptions` to verify the bridge has active state.

### "Circuit breaker won't close"

**Cause:** Protocol-gateway is still failing health probes.

**Check:** The health probe uses `skipCircuitBreaker: true` so it always attempts the call. If it keeps failing:
1. Verify `PROTOCOL_GATEWAY_URL` is correct
2. Check network connectivity between containers
3. Check protocol-gateway logs

**Note:** The circuit transitions to HALF_OPEN after 30 seconds automatically. The next real request (not health check) serves as the probe.

### "Audit log missing entries"

**Cause:** Audit logging is best-effort. If the DB insert fails (e.g., connection pool exhausted), the entry is lost.

**Also check:**
- `AUDIT_ENABLED=true` in environment
- Only successful mutations (2xx, POST/PUT/DELETE) are logged
- GET requests are never audited

### "Rate limiting affects health checks"

**Won't happen:** The rate limiter exempts `127.0.0.1` and `::1` (localhost). Kubernetes probes hit `localhost:3001`, so they're always allowed through.

External health checks from monitoring tools will count against the rate limit. Set `RATE_LIMIT_MAX` appropriately or add the monitoring tool's IP to the network.

### "Database migration fails on startup"

**Common causes:**
1. PostgreSQL not ready yet → the 5-attempt retry should handle this
2. Schema conflict → existing tables with incompatible columns
3. No `./drizzle` folder → falls back to inline DDL (CREATE IF NOT EXISTS)

**Fix for schema conflicts:** If the inline DDL fallback creates tables but with the wrong columns (e.g., after a schema change), you may need to drop and recreate:
```sql
DROP TABLE IF EXISTS tags, devices, audit_log CASCADE;
DROP TYPE IF EXISTS protocol, device_status, setup_status, tag_data_type CASCADE;
```
Then restart gateway-core to recreate the schema.

## Debugging Tips

### Enable Debug Logging

```env
LOG_LEVEL=debug
```

This exposes:
- Every MQTT publish/subscribe operation
- WebSocket bridge subscription changes
- Proxy request details
- Auth/RBAC decision details

### Check All Component Health at Once

```bash
curl http://localhost:3001/api/system/health | jq
```

Returns status of all 5 components: database, mqtt, websocket, protocol_gateway, data_ingestion.

### Inspect Circuit Breaker State

The circuit breaker state is reported in the health endpoint:

```bash
curl http://localhost:3001/api/system/health | jq '.components.protocol_gateway'
```

### View Memory Usage

```bash
curl http://localhost:3001/api/system/info | jq '.memory'
```

Returns RSS, heap used, heap total in MB.

### Query Audit Log

```bash
# Recent device operations
curl "http://localhost:3001/api/system/audit?resourceType=device&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Operations by a specific user
curl "http://localhost:3001/api/system/audit?username=john.doe" \
  -H "Authorization: Bearer $TOKEN"
```

### Check MQTT Connectivity

```bash
curl http://localhost:3001/health/ready | jq '.checks.mqtt'
```

### Prometheus Metrics Snapshot

```bash
curl http://localhost:3001/metrics | grep gateway_core
```

---

*Previous: [Chapter 16 — Configuration Reference](configuration_reference.md) | Next: [Chapter 18 — Appendices](appendices.md)*
