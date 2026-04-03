# Chapter 6 — PostgreSQL Architecture

> Two separate PostgreSQL instances: config store (nexus_config) and
> historian (nexus_historian/TimescaleDB). Schema design, connection management.

---

## Two-Database Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DATABASE TOPOLOGY                                            │
│                                                                                 │
│  ┌──────────────────────────────────┐    ┌──────────────────────────────────┐   │
│  │  PostgreSQL 15 (Config Store)    │    │  TimescaleDB 2.13 (Historian)    │   │
│  │                                  │    │                                  │   │
│  │  Database: nexus_config          │    │  Database: nexus_historian       │   │
│  │  Host port: 5433                 │    │  Host port: 5432                 │   │
│  │  Internal: postgres:5432         │    │  Internal: historian:5432        │   │
│  │                                  │    │                                  │   │
│  │  Tables:                         │    │  Tables:                         │   │
│  │  ├── devices (config)            │    │  ├── metrics (hypertable)        │   │
│  │  ├── tags (config)               │    │  ├── metrics_1min (aggregate)    │   │
│  │  └── audit_log (mutations)       │    │  ├── metrics_1hour (aggregate)   │   │
│  │                                  │    │  └── metrics_1day (aggregate)    │   │
│  │  Accessed by: Gateway Core       │    │                                  │   │
│  │  Size: < 1GB                     │    │  Accessed by: Data Ingestion,    │   │
│  │  Pattern: OLTP (read/write)      │    │               Grafana            │   │
│  │                                  │    │  Size: 10-500GB                  │   │
│  │                                  │    │  Pattern: OLAP (write-heavy)     │   │
│  └──────────────────────────────────┘    └──────────────────────────────────┘   │
│                                                                                 │
│  WHY SEPARATE?                                                                  │
│  • Different performance profiles (OLTP vs OLAP workloads)                      │
│  • Different scaling needs (config is tiny, historian grows linearly)           │
│  • Different retention (config: forever, historian: compressed + aged out)      │
│  • Different backup strategies (config: pg_dump, historian: pg_dump + WAL)      │
│  • Failure isolation (historian full → config DB unaffected)                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Config Database Schema (nexus_config)

### devices Table

```sql
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL UNIQUE,
    description     TEXT,
    protocol        protocol_type NOT NULL,    -- enum
    host            VARCHAR(255) NOT NULL,
    port            INTEGER NOT NULL,
    poll_interval   INTEGER DEFAULT 1000,      -- milliseconds
    timeout         INTEGER DEFAULT 5000,
    retries         INTEGER DEFAULT 3,
    enabled         BOOLEAN DEFAULT false,
    status          device_status DEFAULT 'unknown',
    setup_status    setup_status DEFAULT 'created',
    protocol_config JSONB DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    last_error      TEXT,
    last_seen       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### tags Table

```sql
CREATE TABLE tags (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    address         VARCHAR(512) NOT NULL,
    data_type       tag_data_type NOT NULL,    -- enum
    access_mode     access_mode DEFAULT 'read',
    unit            VARCHAR(50),
    description     TEXT,
    enabled         BOOLEAN DEFAULT true,
    poll_interval   INTEGER,
    -- Modbus-specific
    register_type   register_type,
    byte_order      byte_order,
    -- Scaling
    scaling_enabled BOOLEAN DEFAULT false,
    raw_min         DOUBLE PRECISION,
    raw_max         DOUBLE PRECISION,
    eng_min         DOUBLE PRECISION,
    eng_max         DOUBLE PRECISION,
    -- Clamping
    clamp_enabled   BOOLEAN DEFAULT false,
    clamp_min       DOUBLE PRECISION,
    clamp_max       DOUBLE PRECISION,
    -- Deadband
    deadband_enabled BOOLEAN DEFAULT false,
    deadband_value  DOUBLE PRECISION,
    deadband_type   VARCHAR(20) DEFAULT 'absolute',
    -- Metadata
    priority        INTEGER DEFAULT 0,
    topic_suffix    VARCHAR(255),
    opc_node_id     VARCHAR(512),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_id, name)
);
```

### audit_log Table

```sql
CREATE TABLE audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_sub      VARCHAR(255),              -- Authentik user subject
    action        VARCHAR(50) NOT NULL,      -- create, update, delete
    resource_type VARCHAR(50) NOT NULL,      -- device, tag
    resource_id   UUID,
    changes       JSONB,                     -- Before/after diff
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### Enums

```sql
CREATE TYPE protocol_type AS ENUM (
    'modbus', 'opcua', 's7', 'mqtt', 'bacnet', 'ethernetip'
);

CREATE TYPE device_status AS ENUM (
    'online', 'offline', 'error', 'unknown', 'connecting'
);

CREATE TYPE setup_status AS ENUM (
    'created', 'connected', 'configured', 'active'
);

CREATE TYPE tag_data_type AS ENUM (
    'bool', 'int16', 'int32', 'int64',
    'uint16', 'uint32', 'uint64',
    'float32', 'float64', 'string'
);
```

### Indexes

```sql
CREATE INDEX idx_devices_name ON devices(name);
CREATE INDEX idx_tags_device_id ON tags(device_id);
CREATE INDEX idx_tags_device_name ON tags(device_id, name);
CREATE INDEX idx_audit_user ON audit_log(user_sub);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, created_at);
```

---

## Connection Pooling

### Gateway Core → PostgreSQL

Gateway Core uses Drizzle ORM with the `postgres` driver (node-postgres):

| Setting            | Value        | Purpose                     |
| ------------------ | ------------ | --------------------------- |
| Pool size          | 10 (default) | Concurrent connections      |
| Idle timeout       | 30s          | Release unused connections  |
| Connection timeout | 5s           | Max wait for new connection |

### Data Ingestion → TimescaleDB

Data Ingestion uses pgxpool (Go):

| Setting            | Value | Purpose                         |
| ------------------ | ----- | ------------------------------- |
| Pool size          | 10    | Parallel COPY writers           |
| Max conn lifetime  | 1h    | Rotate connections periodically |
| Max conn idle time | 30m   | Release idle connections        |

---

## Users & Permissions

### Config Database Users

| User       | Password Source     | Permissions                        |
| ---------- | ------------------- | ---------------------------------- |
| `nexus`    | `POSTGRES_PASSWORD` | Owner of `nexus_config`, full CRUD |
| `postgres` | `POSTGRES_PASSWORD` | Superuser (admin only)             |

### Historian Database Users

| User              | Password Source         | Permissions                                  |
| ----------------- | ----------------------- | -------------------------------------------- |
| `nexus_ingestion` | `INGESTION_DB_PASSWORD` | INSERT on metrics, SELECT on aggregates      |
| `nexus_historian` | `HISTORIAN_PASSWORD`    | SELECT on all tables (read-only for Grafana) |
| `postgres`        | `HISTORIAN_PASSWORD`    | Superuser (admin only)                       |

---

## Related Documentation

- [TimescaleDB Operations](timescaledb_operations.md) — hypertables, compression, retention
- [Docker Compose](docker_compose.md) — PostgreSQL container config
- [Backup & Recovery](backup_recovery.md) — database backup procedures
- [Configuration Reference](configuration_reference.md) — database environment variables

---

_Document Version: 1.0_
_Last Updated: March 2026_
