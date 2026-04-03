# Chapter 15 — Configuration Reference

> All environment variables, config.yaml schema, defaults, validation rules, and env var expansion.

---

## Configuration Loading

Configuration is loaded in this order (later overrides earlier):

```
1. config/config.yaml (default values in YAML)
        │
        ▼
2. ${VAR:default} expansion (env vars substituted into YAML)
        │
        ▼
3. applyDefaults() (code-level defaults for missing fields)
        │
        ▼
4. applyEnvOverrides() (direct env var overrides, highest priority)
        │
        ▼
5. validate() (reject invalid combinations)
```

Config file path: `CONFIG_PATH` env var or `./config/config.yaml` (default).

---

## config.yaml Schema

```yaml
service:
  name: data-ingestion               # Service name (for logging, metrics)
  environment: development            # "development" or "production"

http:
  port: 8080                          # Public HTTP port (health, history)
  internalPort: 8081                  # Internal port (metrics, status, pprof)
  readTimeout: 10s                    # HTTP read timeout
  writeTimeout: 10s                   # HTTP write timeout
  idleTimeout: 60s                    # HTTP idle connection timeout
  enablePprof: false                  # Enable /debug/pprof/* endpoints

mqtt:
  broker_url: "${INGESTION_MQTT_BROKER_URL:tcp://localhost:1883}"
  client_id: "${INGESTION_MQTT_CLIENT_ID:data-ingestion}"
  username: "${MQTT_USERNAME:}"
  password: "${MQTT_PASSWORD:}"
  topics:
    - "$share/ingestion/dev/#"
    - "$share/ingestion/uns/#"
  qos: 1
  keepAlive: 30s
  cleanSession: false
  reconnectDelay: 5s
  connectTimeout: 30s

database:
  host: "${INGESTION_DB_HOST:localhost}"
  port: 5432
  database: "${INGESTION_DB_NAME:nexus_historian}"
  user: "${INGESTION_DB_USER:nexus_ingestion}"
  password: "${INGESTION_DB_PASSWORD:}"
  poolSize: 20
  maxIdleTime: 5m
  connectTimeout: 10s

ingestion:
  bufferSize: 200000
  batchSize: 10000
  flushInterval: 250ms
  writerCount: 8
  useCopyProtocol: true
  maxRetries: 3
  retryDelay: 100ms
  writeTimeout: 30s

logging:
  level: "${INGESTION_LOGGING_LEVEL:info}"
  format: json                        # "json" or "console"/"pretty"
```

---

## Environment Variable Expansion

The config loader supports `${VAR}` and `${VAR:default}` syntax in YAML values:

```yaml
# With default — uses "localhost" if INGESTION_DB_HOST not set
host: "${INGESTION_DB_HOST:localhost}"

# Without default — empty string if MQTT_PASSWORD not set
password: "${MQTT_PASSWORD:}"

# No expansion — $share is preserved (no braces)
topics:
  - "$share/ingestion/dev/#"
```

**Regex:** `\$\{([^}:]+)(?::([^}]*))\}` — matches `${VAR}` and `${VAR:default}`.

**Special case:** `$share` (used in MQTT shared subscription topics) does NOT match the regex because it has no braces. The expansion is intentionally designed to preserve this syntax.

---

## Environment Variable Overrides

These env vars take the highest priority, overriding YAML values:

| Variable                     | Config Path            | Type    | Default                            |
| ---------------------------- | ---------------------- | ------- | ---------------------------------- |
| `INGESTION_HTTP_PORT`        | `http.port`            | int     | 8080                               |
| `INGESTION_MQTT_BROKER_URL`  | `mqtt.broker_url`      | string  | `tcp://localhost:1883`             |
| `INGESTION_MQTT_CLIENT_ID`   | `mqtt.client_id`       | string  | `data-ingestion-{hostname}`        |
| `INGESTION_MQTT_TOPICS`      | `mqtt.topics`          | string  | `$share/ingestion/dev/#,...`       |
| `MQTT_USERNAME`              | `mqtt.username`        | string  | (empty)                            |
| `MQTT_PASSWORD`              | `mqtt.password`        | string  | (empty)                            |
| `INGESTION_DB_HOST`          | `database.host`        | string  | `localhost`                        |
| `INGESTION_DB_PORT`          | `database.port`        | int     | 5432                               |
| `INGESTION_DB_NAME`          | `database.database`    | string  | `nexus_historian`                  |
| `INGESTION_DB_USER`          | `database.user`        | string  | `nexus_ingestion`                  |
| `INGESTION_DB_PASSWORD`      | `database.password`    | string  | (empty)                            |
| `INGESTION_LOGGING_LEVEL`    | `logging.level`        | string  | `info`                             |
| `CONFIG_PATH`                | (file path)            | string  | `./config/config.yaml`             |

**INGESTION_MQTT_TOPICS** is comma-separated:
```bash
INGESTION_MQTT_TOPICS="$share/ingestion/dev/#,$share/ingestion/uns/#"
```

---

## Default Values

Applied by `applyDefaults()` when config fields are zero-valued:

### Service

| Field         | Default            |
| ------------- | ------------------ |
| `name`        | `"data-ingestion"` |
| `environment` | `"development"`    |

### HTTP

| Field          | Default  |
| -------------- | -------- |
| `port`         | 8080     |
| `internalPort` | 8081     |
| `readTimeout`  | 10s      |
| `writeTimeout` | 10s      |
| `idleTimeout`  | 60s      |
| `enablePprof`  | false    |

### MQTT

| Field            | Default                           |
| ---------------- | --------------------------------- |
| `broker_url`     | `tcp://localhost:1883`            |
| `client_id`      | `data-ingestion-{hostname}`       |
| `topics`         | `[$share/ingestion/dev/#, $share/ingestion/uns/#]` |
| `qos`            | 1                                 |
| `keepAlive`      | 30s                               |
| `cleanSession`   | false                             |
| `reconnectDelay` | 5s                                |
| `connectTimeout` | 30s                               |

### Database

| Field            | Default            |
| ---------------- | ------------------ |
| `host`           | `localhost`        |
| `port`           | 5432               |
| `database`       | `nexus_historian`  |
| `user`           | `nexus_ingestion`  |
| `poolSize`       | 20                 |
| `maxIdleTime`    | 5m                 |
| `connectTimeout` | 10s                |

### Ingestion

| Field              | Default  |
| ------------------ | -------- |
| `bufferSize`       | 200,000  |
| `batchSize`        | 10,000   |
| `flushInterval`    | 250ms    |
| `writerCount`      | 8        |
| `useCopyProtocol`  | true     |
| `maxRetries`       | 3        |
| `retryDelay`       | 100ms    |
| `writeTimeout`     | 30s      |

### Logging

| Field    | Default  |
| -------- | -------- |
| `level`  | `info`   |
| `format` | `json`   |

---

## Validation Rules

Applied after all defaults and overrides:

| Rule                              | Error                                       |
| --------------------------------- | ------------------------------------------- |
| `batchSize > bufferSize`          | `"batch_size cannot exceed buffer_size"`     |
| `writerCount < 1`                 | `"writer_count must be at least 1"`         |
| Production + empty DB password    | `"database password required in production"` |

---

## Configuration for Common Scenarios

### Docker Compose (Development)

```yaml
environment:
  - INGESTION_MQTT_BROKER_URL=tcp://emqx:1883
  - INGESTION_DB_HOST=timescaledb
  - INGESTION_DB_PASSWORD=ingestion_password
  - INGESTION_LOGGING_LEVEL=debug
```

### Kubernetes (Production)

```yaml
env:
  - name: INGESTION_MQTT_BROKER_URL
    value: "tcp://emqx.nexus.svc.cluster.local:1883"
  - name: INGESTION_MQTT_CLIENT_ID
    valueFrom:
      fieldRef:
        fieldPath: metadata.name  # Pod name for unique client ID
  - name: INGESTION_DB_HOST
    value: "timescaledb.nexus.svc.cluster.local"
  - name: INGESTION_DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: ingestion-db-credentials
        key: password
```

### High Throughput Override

```bash
INGESTION_MQTT_BROKER_URL=tcp://emqx:1883
INGESTION_DB_HOST=timescaledb
INGESTION_DB_PASSWORD=secret
# Override YAML defaults via config.yaml with larger values:
# bufferSize: 500000, batchSize: 20000, writerCount: 12
```

---

*Previous: [Chapter 14 — Testing Strategy](testing_strategy.md) — Next: [Chapter 16 — Database Schema](database_schema.md)*

---

*Document Version: 1.0 — March 2026*
