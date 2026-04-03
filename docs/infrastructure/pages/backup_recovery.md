# Chapter 13 — Backup & Recovery

> PostgreSQL backup strategies, TimescaleDB-specific procedures, EMQX state,
> volume snapshots, disaster recovery, and restore procedures.

---

## Backup Strategy Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    BACKUP PRIORITIES                                            │
│                                                                                 │
│  Priority   Component           Size       Strategy        RPO    RTO           │
│  ────────── ──────────────────  ─────────  ──────────────  ─────  ─────         │
│  Critical   nexus_config (PG)   < 1GB      pg_dump daily   24h    < 1h          │
│  Critical   nexus_historian     10-500GB   pg_dump + WAL   1h     < 4h          │
│  High       Authentik DB        < 500MB    pg_dump daily   24h    < 1h          │
│  Medium     EMQX data           < 1GB      Volume snapshot 24h    < 30m         │
│  Medium     Grafana data        < 100MB    Volume snapshot 24h    < 30m         │
│  Low        Prometheus TSDB     1-10GB     Recreatable     —      < 1h          │
│  Low        PKI trust store     < 1MB      Volume snapshot weekly < 30m         │
│                                                                                 │
│  RPO = Recovery Point Objective (max data loss)                                 │
│  RTO = Recovery Time Objective (max downtime)                                   │
│                                                                                 │
│  Config and historian data are the only truly irreplaceable assets.             │
│  All other state can be regenerated or re-provisioned.                          │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## PostgreSQL Config Database

### pg_dump (Logical Backup)

```bash
# Full database dump (compressed)
docker compose exec nexus-postgres pg_dump \
  -U nexus \
  -d nexus_config \
  --format=custom \
  --compress=9 \
  -f /tmp/nexus_config_$(date +%Y%m%d_%H%M%S).dump

# Copy dump from container to host
docker compose cp nexus-postgres:/tmp/nexus_config_*.dump ./backups/
```

### Restore

```bash
# Drop and recreate (clean restore)
docker compose exec nexus-postgres dropdb -U nexus nexus_config
docker compose exec nexus-postgres createdb -U nexus nexus_config

# Restore from dump
docker compose cp ./backups/nexus_config_20260320.dump nexus-postgres:/tmp/
docker compose exec nexus-postgres pg_restore \
  -U nexus \
  -d nexus_config \
  --clean \
  --if-exists \
  /tmp/nexus_config_20260320.dump
```

### Scheduled Backup (cron)

```bash
#!/bin/bash
# /opt/nexus/scripts/backup-config.sh
BACKUP_DIR="/opt/nexus/backups/config"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup
docker compose -f /opt/nexus/infrastructure/docker/docker-compose.yml \
  exec -T nexus-postgres pg_dump \
  -U nexus -d nexus_config --format=custom --compress=9 \
  > "${BACKUP_DIR}/nexus_config_${TIMESTAMP}.dump"

# Cleanup old backups
find "${BACKUP_DIR}" -name "*.dump" -mtime +${RETENTION_DAYS} -delete

echo "Backup completed: nexus_config_${TIMESTAMP}.dump"
```

```cron
# Daily at 2:00 AM
0 2 * * * /opt/nexus/scripts/backup-config.sh >> /var/log/nexus-backup.log 2>&1
```

---

## TimescaleDB Historian

### pg_dump (Full Logical Backup)

```bash
# Full dump — WARNING: can be very large (10-500GB)
docker compose exec nexus-historian pg_dump \
  -U postgres \
  -d nexus_historian \
  --format=custom \
  --compress=9 \
  -f /tmp/nexus_historian_$(date +%Y%m%d).dump
```

**For large databases, prefer WAL-based backup or volume snapshots.**

### WAL Archiving (Continuous Backup)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    WAL-BASED CONTINUOUS BACKUP                                  │
│                                                                                 │
│  TimescaleDB ──WAL segments──► Archive location (NFS/S3/local)                  │
│                                                                                 │
│  postgresql.conf additions:                                                     │
│  ┌──────────────────────────────────────────────────────────────┐               │
│  │ archive_mode = on                                            │               │
│  │ archive_command = 'cp %p /archive/wal/%f'                    │               │
│  │ archive_timeout = 300    # Force archive every 5 minutes     │               │
│  └──────────────────────────────────────────────────────────────┘               │
│                                                                                 │
│  Recovery:                                                                      │
│  1. Restore base backup (pg_basebackup snapshot)                                │
│  2. Replay WAL segments up to target time                                       │
│  3. Result: point-in-time recovery (PITR)                                       │
│                                                                                 │
│  This achieves RPO of ~5 minutes (archive_timeout).                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### pg_basebackup (Physical Base Backup)

```bash
# Create base backup for PITR
docker compose exec nexus-historian pg_basebackup \
  -U postgres \
  -D /tmp/basebackup \
  -Ft -z -Xs \
  -P

# Copy to backup storage
docker compose cp nexus-historian:/tmp/basebackup ./backups/historian/
```

### Restore TimescaleDB

```bash
# 1. Stop data-ingestion (stop writes)
docker compose stop nexus-data-ingestion

# 2. Stop TimescaleDB
docker compose stop nexus-historian

# 3. Remove data volume
docker volume rm docker_timescale-data

# 4. Start fresh TimescaleDB (runs init.sql)
docker compose up -d nexus-historian

# 5. Restore from dump
docker compose cp ./backups/nexus_historian_20260320.dump nexus-historian:/tmp/
docker compose exec nexus-historian pg_restore \
  -U postgres \
  -d nexus_historian \
  --clean --if-exists \
  /tmp/nexus_historian_20260320.dump

# 6. Restart data-ingestion
docker compose up -d nexus-data-ingestion
```

---

## Authentik Database

```bash
# Backup
docker compose exec nexus-authentik-db pg_dump \
  -U authentik \
  -d authentik \
  --format=custom \
  --compress=9 \
  -f /tmp/authentik_$(date +%Y%m%d).dump

# Restore
docker compose exec nexus-authentik-db pg_restore \
  -U authentik \
  -d authentik \
  --clean --if-exists \
  /tmp/authentik_20260320.dump
```

**Note:** Authentik blueprints re-provision core config on startup. A restore
is only needed to preserve user accounts, sessions, and audit history.

---

## EMQX State

EMQX stores minimal persistent state (retained messages, client sessions).
For most deployments, losing EMQX state is acceptable — clients reconnect
and re-subscribe automatically.

```bash
# Volume snapshot (if state preservation needed)
docker compose stop nexus-emqx
docker run --rm \
  -v docker_emqx-data:/source:ro \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/emqx-data-$(date +%Y%m%d).tar.gz -C /source .
docker compose start nexus-emqx
```

---

## Kubernetes Volume Snapshots

### VolumeSnapshot (CSI driver required)

```yaml
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: timescaledb-snapshot-20260320
  namespace: nexus
spec:
  volumeSnapshotClassName: csi-hostpath-snapclass
  source:
    persistentVolumeClaimName: timescaledb-data-timescaledb-0
```

### Restore from Snapshot

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: timescaledb-data-restored
  namespace: nexus
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 500Gi
  dataSource:
    name: timescaledb-snapshot-20260320
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
```

---

## Disaster Recovery Playbook

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DR SCENARIOS                                                 │
│                                                                                 │
│  Scenario 1: Single service failure                                             │
│  ─────────────────────────────────                                              │
│  Action: docker compose restart <service>                                       │
│  Impact: Seconds of downtime, no data loss                                      │
│  Data: Persisted in Docker volumes                                              │
│                                                                                 │
│  Scenario 2: Database corruption                                                │
│  ──────────────────────────────                                                 │
│  Action: Restore from latest pg_dump                                            │
│  Impact: Data loss since last backup (up to RPO)                                │
│  Steps:                                                                         │
│    1. Stop dependent services                                                   │
│    2. Drop and recreate database                                                │
│    3. pg_restore from backup                                                    │
│    4. Restart dependent services                                                │
│    5. Verify data integrity                                                     │
│                                                                                 │
│  Scenario 3: Host machine failure                                               │
│  ───────────────────────────────                                                │
│  Action: Deploy on new host, restore from off-site backups                      │
│  Impact: Full RTO (up to 4 hours for historian)                                 │
│  Steps:                                                                         │
│    1. Provision new host with Docker/K8s                                        │
│    2. Clone repo, copy env configuration                                        │
│    3. Restore config DB from backup                                             │
│    4. Restore historian from backup or WAL                                      │
│    5. Start services: docker compose up -d                                      │
│    6. Verify: all health checks pass                                            │
│                                                                                 │
│  Scenario 4: Full cluster rebuild (K8s)                                         │
│  ─────────────────────────────────────                                          │
│  Action: kubectl apply -k + restore PVCs from snapshots                         │
│  Impact: Full RTO                                                               │
│  Steps:                                                                         │
│    1. Restore PVCs from VolumeSnapshots                                         │
│    2. kubectl apply -k infrastructure/k8s/overlays/prod                         │
│    3. Verify pod startup and health                                             │
│    4. Re-sync External Secrets                                                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Backup Verification

```bash
# Verify config DB backup integrity
pg_restore --list /path/to/nexus_config_20260320.dump

# Test restore to temporary database
createdb nexus_config_test
pg_restore -d nexus_config_test /path/to/nexus_config_20260320.dump
psql -d nexus_config_test -c "SELECT count(*) FROM devices;"
dropdb nexus_config_test
```

**Schedule monthly backup restore tests** to ensure backups are valid.

---

## Related Documentation

- [PostgreSQL Architecture](postgresql_architecture.md) — database schema details
- [TimescaleDB Operations](timescaledb_operations.md) — compression, retention
- [Docker Compose](docker_compose.md) — volume definitions
- [Kubernetes](kubernetes.md) — PVC and storage configuration
- [Scaling Playbook](scaling_playbook.md) — storage capacity planning

---

_Document Version: 1.0_
_Last Updated: March 2026_
