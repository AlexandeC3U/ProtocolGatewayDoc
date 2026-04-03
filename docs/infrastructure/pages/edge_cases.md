# Chapter 17 — Edge Cases & Known Gotchas

> Docker socket permissions, volume ownership, K8s PVC resize, EMQX split-brain,
> TimescaleDB chunk management, and platform-specific quirks.

---

## Docker

### Volume Ownership Mismatch

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Symptom:  "Permission denied" on PostgreSQL or TimescaleDB startup             │
│                                                                                 │
│  Cause:   Docker volume created by root, but PostgreSQL runs as UID 999         │
│                                                                                 │
│  Scenario:                                                                      │
│  1. First run: volume created, init succeeds (entrypoint handles ownership)     │
│  2. Manual file copy into volume (as root)                                      │
│  3. Restart: PostgreSQL can't read files owned by root                          │
│                                                                                 │
│  Fix:                                                                           │
│  $ docker compose exec nexus-historian chown -R 999:999 /var/lib/postgresql     │
│                                                                                 │
│  Prevention:                                                                    │
│  • Never manually copy files into database volumes                              │
│  • Use pg_restore or COPY for data import                                       │
│  • K8s init container handles this: chown -R 999:999 /var/lib/postgresql/data   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Docker Socket Permissions (Linux)

```
Symptom:  "Got permission denied while trying to connect to the Docker daemon socket"

Cause:   User not in 'docker' group

Fix:
$ sudo usermod -aG docker $USER
$ newgrp docker    # Apply without logout

Note: On Windows/macOS with Docker Desktop, this is not an issue.
```

### Port Conflicts

```
Symptom:  "Bind for 0.0.0.0:5432 failed: port is already allocated"

Cause:   Another PostgreSQL (or other service) using the same port

Common conflicts:
• 5432 — local PostgreSQL vs TimescaleDB
• 3000 — local dev server vs Grafana
• 80   — local web server vs Nginx
• 9090 — other Prometheus instance

Fix:
• Change host port mapping in docker-compose.yml (already done for PostgreSQL → 5433)
• Stop conflicting service: sudo systemctl stop postgresql
• Check what's using the port: lsof -i :5432 (Linux) / netstat -ano | findstr :5432 (Windows)
```

### Docker Compose V1 vs V2

```
Symptom:  "docker-compose" command not found, or service names don't resolve

Background:
• V1 (docker-compose): hyphenated command, project name prefix with underscore
• V2 (docker compose): space-separated, project name prefix with hyphen

NEXUS Edge uses Docker Compose V2 syntax:
$ docker compose up -d        # ✓ correct
$ docker-compose up -d        # ✗ may work but not guaranteed

Volume names may differ:
• V1: docker_timescale-data
• V2: docker-timescale-data

If migrating from V1 to V2, volumes may not match. Check:
$ docker volume ls | grep nexus
```

---

## Kubernetes

### PVC Resize

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Symptom:  TimescaleDB PVC at 100%, needs expansion                             │
│                                                                                 │
│  Prerequisites:                                                                 │
│  • StorageClass must have allowVolumeExpansion: true                            │
│  • CSI driver must support expansion                                            │
│                                                                                 │
│  Steps:                                                                         │
│  1. Edit PVC:                                                                   │
│     $ kubectl edit pvc timescaledb-data-timescaledb-0 -n nexus                  │
│     Change spec.resources.requests.storage to new size                          │
│                                                                                 │
│  2. Some CSI drivers require pod restart:                                       │
│     $ kubectl delete pod timescaledb-0 -n nexus                                 │
│     StatefulSet recreates it, PVC expansion completes                           │
│                                                                                 │
│  3. Verify:                                                                     │
│     $ kubectl get pvc -n nexus                                                  │
│     Check CAPACITY column shows new size                                        │
│                                                                                 │
│  GOTCHA: You can only INCREASE PVC size, never decrease.                        │
│  GOTCHA: Some cloud providers require pod deletion before resize completes.     │
│  GOTCHA: K3s with local-path provisioner does NOT support expansion.            │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Init Container Race Conditions

```
Symptom:  Init container loops forever: "waiting for emqx:1883"

Cause:   Target service not yet scheduled, or NetworkPolicy blocking init container

Diagnosis:
$ kubectl get pods -n nexus -o wide           # Check all pods are scheduled
$ kubectl logs -n nexus gateway-core-xxx -c wait-for-emqx   # Check init logs

Fix:
• Ensure target service exists and is healthy
• Check NetworkPolicy allows init container egress to target port
• Increase init container timeout (default retries every 2s)

Note: Init containers use busybox 'nc' — it needs port access, not just DNS.
```

### StatefulSet Pod Stuck in Terminating

```
Symptom:  kubectl delete pod hangs, pod stuck in "Terminating"

Causes:
1. PVC still mounted (filesystem busy)
2. Finalizer blocking deletion
3. Node is down/unreachable

Fix (graceful):
$ kubectl delete pod emqx-0 -n nexus --grace-period=30

Fix (force — data loss risk):
$ kubectl delete pod emqx-0 -n nexus --force --grace-period=0

GOTCHA: Force-deleting a StatefulSet pod while PVC is attached can cause
data corruption if the pod is still writing.
```

---

## EMQX

### Split-Brain in Cluster

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Symptom:  EMQX nodes can't see each other, cluster reports partial membership  │
│                                                                                 │
│  Cause:   Network partition between EMQX pods (K8s node failure, DNS issue)     │
│                                                                                 │
│  Diagnosis:                                                                     │
│  $ kubectl exec -n nexus emqx-0 -- emqx ctl cluster status                      │
│  # Should show all nodes as 'running'                                           │
│                                                                                 │
│  Fix:                                                                           │
│  1. Check inter-node connectivity (ports 4370, 5370)                            │
│  2. Verify Erlang cookies match across all nodes                                │
│  3. Restart isolated node:                                                      │
│     $ kubectl delete pod emqx-2 -n nexus                                        │
│  4. If persistent, restart entire cluster (rolling):                            │
│     $ kubectl rollout restart statefulset/emqx -n nexus                         │
│                                                                                 │
│  Prevention:                                                                    │
│  • PodDisruptionBudget: minAvailable=2 (of 3)                                   │
│  • Anti-affinity: spread EMQX pods across nodes                                 │
│  • Monitor: emqx_cluster_nodes_running metric                                   │
│                                                                                 │
│  GOTCHA: EMQX does NOT auto-heal split-brain. Manual intervention required.     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Erlang Cookie Mismatch

```
Symptom:  "Node ... not responding to pings" in EMQX logs

Cause:   EMQX_NODE__COOKIE differs between nodes (e.g., old pod with stale config)

Fix:
• Ensure all nodes use the same cookie value
• Check: EMQX_NODE__COOKIE environment variable matches across pods
• Restart all EMQX pods after changing the cookie
```

---

## TimescaleDB

### Compression on Active Chunks

```
Symptom:  INSERT fails with "cannot insert into compressed chunk"

Cause:   Late-arriving data targets an already-compressed chunk

Prevention:
• Compression policy has 7-day delay — data older than 7 days cannot be inserted
• If ingestion has significant delays, increase compress_after interval

Fix (decompress specific chunk):
SELECT decompress_chunk('_timescaledb_internal._hyper_1_42_chunk');
-- Insert the data
-- Chunk will be re-compressed on next policy run
```

### Continuous Aggregate Refresh Lag

```
Symptom:  Grafana dashboard shows stale aggregate data

Cause:   Aggregate refresh policy hasn't run yet (end_offset creates intentional lag)

Check:
SELECT * FROM timescaledb_information.continuous_aggregate_stats;
-- completed_threshold shows last materialized time

Force refresh:
CALL refresh_continuous_aggregate('metrics_1min', now() - interval '2 hours', now());
```

### Hypertable Chunk Count Growing

```
Symptom:  Query planning slow, pg_stat_user_tables shows thousands of chunks

Cause:   1-day chunk interval + long retention = many chunks

Check:
SELECT count(*) FROM timescaledb_information.chunks
WHERE hypertable_name = 'metrics';

Fix:
• Ensure retention policy is active and dropping old chunks
• Consider larger chunk_time_interval for very long retention
• Vacuum: VACUUM ANALYZE metrics;
```

---

## Authentication

### Multi-Tab Session Conflict

```
Symptom:  User logs in on tab A, tab B shows stale session

Cause:   Web UI stores tokens in sessionStorage (per-tab)

Behavior:
• Each tab has its own session
• Logging out in one tab doesn't affect others
• Token refresh in one tab doesn't update others

Not a bug — by design. sessionStorage isolation prevents:
• Cross-tab token overwrite during concurrent refresh
• XSS in one tab compromising all sessions
```

### Authentik Token Expiry During Long Operations

```
Symptom:  API returns 401 mid-operation (e.g., during OPC UA browse)

Cause:   Access token expired (1-hour validity) during a long-running operation

Mitigation:
• Web UI has 30-second loop guard for token refresh
• API client retries with fresh token on 401
• Long operations should be broken into smaller requests

GOTCHA: If Authentik is down when token expires, user is locked out until
Authentik recovers. No cached token validation (JWKS is fetched live).
```

---

## Nginx

### WebSocket Upgrade Timeout

```
Symptom:  WebSocket connection drops after 60 seconds of inactivity

Cause:   Default proxy_read_timeout is 60s, WebSocket has no data flowing

Fix:   Already configured in nginx.conf:
  proxy_read_timeout 86400s;    # 24 hours
  proxy_send_timeout 86400s;

If still dropping, check:
• Load balancer in front of Nginx (AWS ALB has 60s idle timeout by default)
• Client-side ping/pong (Web UI WS bridge should send keepalives)
```

### Buffering Large API Responses

```
Symptom:  Large API responses (e.g., tag list with 10K+ tags) are slow or truncated

Cause:   Nginx proxy buffering defaults may be too small

Fix:
  proxy_buffer_size 16k;
  proxy_buffers 8 32k;
  proxy_busy_buffers_size 64k;
```

---

## Cross-Platform

### Windows Line Endings in Config Files

```
Symptom:  Shell scripts fail with "^M: bad interpreter" inside Docker containers

Cause:   Git on Windows converts LF to CRLF, but Linux containers expect LF

Fix:
• .gitattributes should include:
  *.sh text eol=lf
  *.conf text eol=lf
  *.sql text eol=lf

• Convert existing files:
  $ git ls-files -z '*.sh' | xargs -0 dos2unix
```

### Docker Desktop Memory Limits

```
Symptom:  Services OOMKilled on Docker Desktop (Windows/macOS)

Cause:   Docker Desktop default memory limit is 2GB — insufficient for full stack

Fix:
• Docker Desktop → Settings → Resources → Memory → Set to 8GB+
• Minimum for full NEXUS stack: 6GB
• Recommended: 8-12GB
```

---

## Related Documentation

- [Troubleshooting](troubleshooting.md) — diagnostic procedures
- [Docker Compose](docker_compose.md) — container configuration
- [Kubernetes](kubernetes.md) — K8s-specific issues
- [EMQX Configuration](emqx_configuration.md) — broker clustering
- [TimescaleDB Operations](timescaledb_operations.md) — chunk and aggregate management

---

_Document Version: 1.0_
_Last Updated: March 2026_
