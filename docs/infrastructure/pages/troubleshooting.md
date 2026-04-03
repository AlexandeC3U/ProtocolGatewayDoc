# Chapter 15 — Troubleshooting

> Common issues, diagnostic commands, log analysis, and resolution procedures
> for Docker Compose and Kubernetes deployments.

---

## Quick Diagnostic Commands

### Docker Compose

```bash
# Overall status
docker compose ps
docker compose logs --tail=50

# Specific service
docker compose logs -f nexus-gateway-core
docker compose exec nexus-emqx emqx ctl status

# Resource usage
docker stats --no-stream

# Network connectivity
docker compose exec nexus-gateway-core wget -qO- http://emqx:18083/status
docker compose exec nexus-gateway-core nc -z postgres 5432
```

### Kubernetes

```bash
# Pod status
kubectl get pods -n nexus -o wide
kubectl describe pod -n nexus <pod-name>

# Logs
kubectl logs -n nexus deployment/gateway-core --tail=100
kubectl logs -n nexus deployment/gateway-core --previous  # crashed container

# Events (most recent issues)
kubectl get events -n nexus --sort-by='.lastTimestamp' | tail -20

# Resource usage
kubectl top pods -n nexus
kubectl top nodes
```

---

## Service Won't Start

### Gateway Core: "Connection refused" to PostgreSQL

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Symptom:  Gateway Core logs show ECONNREFUSED to postgres:5432                 │
│                                                                                 │
│  Causes:                                                                        │
│  1. PostgreSQL not healthy yet (most common)                                    │
│  2. Wrong DATABASE_URL                                                          │
│  3. PostgreSQL init.sql failed                                                  │
│                                                                                 │
│  Diagnosis:                                                                     │
│  $ docker compose ps nexus-postgres          # Check health status              │
│  $ docker compose logs nexus-postgres        # Check init errors                │
│  $ docker compose exec nexus-postgres pg_isready -U nexus                       │
│                                                                                 │
│  Fix:                                                                           │
│  • Wait: docker compose depends_on waits for healthy, but restart may help      │
│  • Check .env: POSTGRES_PASSWORD must match DATABASE_URL                        │
│  • Reinit: docker compose down -v && docker compose up -d (destroys data!)      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Data Ingestion: "Connection refused" to EMQX

```
Symptom:  "dial tcp emqx:1883: connect: connection refused"

Causes:
1. EMQX not ready (healthcheck takes 15s × 5 retries = 75s max)
2. EMQX crashed (check logs)
3. Network issue (wrong Docker network)

Fix:
$ docker compose logs nexus-emqx             # Check for startup errors
$ docker compose restart nexus-data-ingestion  # Retry after EMQX is healthy
```

### TimescaleDB: Init Script Failed

```
Symptom:  "relation 'metrics' does not exist" in data-ingestion logs

Causes:
1. init.sql had a syntax error
2. Database already existed (init scripts skip on existing data)
3. Volume from old version still mounted

Diagnosis:
$ docker compose exec nexus-historian psql -U postgres -d nexus_historian \
    -c "\dt"    # List tables

Fix (if tables missing):
$ docker compose exec nexus-historian psql -U postgres -d nexus_historian \
    -f /docker-entrypoint-initdb.d/init.sql

Fix (clean restart):
$ docker compose down -v    # WARNING: destroys all data
$ docker compose up -d
```

---

## MQTT Issues

### Services Can't Connect to EMQX

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Diagnosis checklist:                                                           │
│                                                                                 │
│  1. Is EMQX running?                                                            │
│     $ docker compose ps nexus-emqx                                              │
│     $ docker compose exec nexus-emqx emqx ctl status                            │
│                                                                                 │
│  2. Can services reach EMQX?                                                    │
│     $ docker compose exec nexus-gateway-core nc -z emqx 1883                    │
│                                                                                 │
│  3. Is authentication blocking? (production)                                    │
│     $ docker compose logs nexus-emqx | grep "authentication"                    │
│     Check: EMQX dashboard → Clients tab → see rejected connections              │
│                                                                                 │
│  4. Are ACLs blocking publish/subscribe?                                        │
│     $ docker compose logs nexus-emqx | grep "acl"                               │
│     EMQX dashboard → Authorization → check denied actions                       │
│                                                                                 │
│  5. EMQX Dashboard (http://localhost:18083):                                    │
│     • Clients: see who is connected                                             │
│     • Topics: see active topics                                                 │
│     • Subscriptions: verify shared subscription groups                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Shared Subscription Not Distributing

```
Symptom:  Only one data-ingestion pod receives messages

Causes:
1. Client IDs are identical (must be unique per pod)
2. Not using $share/ prefix in subscription
3. EMQX shared subscription disabled

Check:
$ docker compose logs nexus-data-ingestion | grep "subscribe"
# Verify topic is: $share/ingestion/dev/#

# In EMQX dashboard → Subscriptions → verify group members
```

### Messages Not Reaching Data Ingestion

```
Symptom:  Protocol Gateway publishes but Data Ingestion receives nothing

Diagnosis:
1. Check EMQX dashboard → Topics tab → verify dev/# has messages
2. Check EMQX dashboard → Subscriptions → verify data-ingestion subscribed
3. Use EMQX WebSocket client to manually subscribe to dev/# and test

Quick test with mosquitto:
$ docker compose exec nexus-emqx \
    emqx ctl pub dev/test/temperature '{"value": 23.5}' --qos 1
```

---

## Database Issues

### Connection Pool Exhaustion

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Symptom:  "too many connections" or long connection wait times                 │
│                                                                                 │
│  Gateway Core → PostgreSQL:                                                     │
│  $ docker compose exec nexus-postgres psql -U nexus -d nexus_config \           │
│      -c "SELECT count(*) FROM pg_stat_activity;"                                │
│                                                                                 │
│  Data Ingestion → TimescaleDB:                                                  │
│  $ docker compose exec nexus-historian psql -U postgres -d nexus_historian \    │
│      -c "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"          │
│                                                                                 │
│  Fix:                                                                           │
│  • Increase max_connections in PostgreSQL (-c max_connections=300)              │
│  • Reduce application pool size if over-provisioned                             │
│  • Check for connection leaks (idle connections growing)                        │
│  • Kill idle connections:                                                       │
│    SELECT pg_terminate_backend(pid) FROM pg_stat_activity                       │
│    WHERE state = 'idle' AND query_start < now() - interval '10 minutes';        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### TimescaleDB Disk Full

```
Symptom:  "could not extend file" or "No space left on device"

Immediate fix:
1. Check compression status:
   SELECT * FROM timescaledb_information.compression_settings;

2. Force-compress old chunks:
   SELECT compress_chunk(c.chunk_name::regclass)
   FROM timescaledb_information.chunks c
   WHERE c.hypertable_name = 'metrics'
     AND NOT c.is_compressed
     AND c.range_end < now() - interval '2 days';

3. Drop oldest data if critical:
   SELECT drop_chunks('metrics', older_than => interval '14 days');

Long-term fix:
• Expand PVC (K8s: kubectl edit pvc)
• Reduce retention period
• Increase compression aggressiveness
• Reduce poll interval for less critical tags
```

---

## Network Issues

### K8s NetworkPolicy Blocking Traffic

```
Symptom:  Service timeouts that work in dev but not prod

Diagnosis:
$ kubectl get networkpolicies -n nexus
$ kubectl describe networkpolicy gateway-core -n nexus

# Test connectivity from inside a pod
$ kubectl exec -n nexus deployment/gateway-core -- nc -z postgres 5432
$ kubectl exec -n nexus deployment/gateway-core -- nc -z emqx 1883

Fix:
• Verify NetworkPolicy selectors match pod labels
• Check port numbers in policy match actual service ports
• Temporarily delete policy to confirm it's the cause:
  kubectl delete networkpolicy <name> -n nexus   # DEBUG ONLY
```

### DNS Resolution Failure

```
Symptom:  "getaddrinfo ENOTFOUND emqx" or similar

Docker:
$ docker compose exec nexus-gateway-core nslookup emqx
# Should resolve to EMQX container IP

K8s:
$ kubectl exec -n nexus deployment/gateway-core -- nslookup emqx
$ kubectl exec -n nexus deployment/gateway-core -- nslookup emqx.nexus.svc.cluster.local

Fix:
• Docker: ensure services are on the same network
• K8s: ensure kube-dns is running (kubectl get pods -n kube-system)
• K8s: check NetworkPolicy allows DNS egress (port 53)
```

---

## Authentication Issues

### JWT Validation Fails

```
Symptom:  401 Unauthorized on all API requests with AUTH_ENABLED=true

Diagnosis:
1. Is Authentik running?
   $ docker compose ps nexus-authentik-server
   $ curl http://localhost:9000/-/health/live/

2. Can Gateway Core reach JWKS endpoint?
   $ docker compose exec nexus-gateway-core \
       wget -qO- http://authentik-server:9000/application/o/nexus-gateway/jwks/

3. Is the token expired?
   # Decode JWT at jwt.io (paste access token)
   # Check 'exp' claim vs current time

4. Is the issuer URL correct?
   # Gateway Core OIDC_ISSUER_URL must match token 'iss' claim

Fix:
• Restart Authentik if JWKS endpoint is down
• Re-authenticate in Web UI (token may be expired)
• Verify OIDC_ISSUER_URL in gateway-core environment
```

### Authentik Blueprint Not Applied

```
Symptom:  No OIDC application/provider found in Authentik

Check:
$ docker compose logs nexus-authentik-worker | grep "blueprint"

Fix:
• Verify blueprint is mounted: ls config/authentik/blueprints/
• Restart worker: docker compose restart nexus-authentik-worker
• Check YAML syntax in nexus-setup.yaml
• Manual apply: Authentik admin → System → Blueprints → Sync
```

---

## Performance Issues

### High API Latency

```
Check in order:
1. Database queries: Enable Drizzle query logging, check slow queries
2. Connection pool: pg_stat_activity count vs pool size
3. MQTT subscriber backpressure: Check message queue size
4. Circuit breaker: proxy_circuit_breaker_state metric
5. Rate limiting: Check if requests are being throttled
```

### Data Ingestion Falling Behind

```
Metrics to check:
• ingestion_buffer_size (should be < 80% of 200K)
• ingestion_write_duration_seconds (should be < 100ms P99)
• ingestion_errors_total (any write errors?)

If buffer is filling:
1. Scale horizontally: add more replicas
2. Check TimescaleDB performance (CPU, disk I/O)
3. Verify COPY protocol is being used (not row-by-row INSERT)
4. Check for lock contention in TimescaleDB
```

---

## Log Locations

| Service          | Docker                                             | K8s                                             |
| ---------------- | -------------------------------------------------- | ----------------------------------------------- |
| Gateway Core     | `docker compose logs nexus-gateway-core`           | `kubectl logs -n nexus deploy/gateway-core`     |
| Protocol Gateway | `docker compose logs nexus-protocol-gateway`       | `kubectl logs -n nexus sts/protocol-gateway`    |
| Data Ingestion   | `docker compose logs nexus-data-ingestion`         | `kubectl logs -n nexus deploy/data-ingestion`   |
| EMQX             | `docker compose logs nexus-emqx` + emqx-log volume | `kubectl logs -n nexus sts/emqx`                |
| PostgreSQL       | `docker compose logs nexus-postgres`               | `kubectl logs -n nexus sts/postgres`            |
| TimescaleDB      | `docker compose logs nexus-historian`              | `kubectl logs -n nexus sts/timescaledb`         |
| Nginx            | `docker compose logs nexus-nginx`                  | `kubectl logs -n nexus deploy/nginx`            |
| Authentik        | `docker compose logs nexus-authentik-server`       | `kubectl logs -n nexus deploy/authentik-server` |

---

## Related Documentation

- [Docker Compose](docker_compose.md) — service configuration and health checks
- [Kubernetes](kubernetes.md) — pod management, init containers
- [Network Architecture](network_architecture.md) — network topology
- [Observability Stack](observability_stack.md) — metrics for diagnosis
- [Edge Cases](edge_cases.md) — known gotchas and workarounds

---

_Document Version: 1.0_
_Last Updated: March 2026_
