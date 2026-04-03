# Chapter 12 — Security Hardening

> Container security contexts, Kubernetes network policies, secret management,
> MQTT authentication, database access control, and production checklist.

---

## Security Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                                              │
│                                                                                 │
│  Layer 1: Network Segmentation                                                  │
│  ├── Docker: nexus-internal + nexus-ot (bridge isolation)                       │
│  ├── K8s: default-deny NetworkPolicies, explicit allow rules                    │
│  └── Only protocol-gateway bridges IT ↔ OT networks                             │
│                                                                                 │
│  Layer 2: Authentication & Authorization                                        │
│  ├── Authentik OIDC/PKCE for Web UI users                                       │
│  ├── JWT validation in Gateway Core middleware                                  │
│  ├── RBAC groups: admin, engineer, operator, viewer                             │
│  └── MQTT username/password per service                                         │
│                                                                                 │
│  Layer 3: Transport Encryption                                                  │
│  ├── Nginx TLS termination (HTTPS)                                              │
│  ├── EMQX MQTTS (port 8883)                                                     │
│  └── PostgreSQL sslmode=require (optional)                                      │
│                                                                                 │
│  Layer 4: Container Security                                                    │
│  ├── Non-root containers                                                        │
│  ├── Read-only root filesystems                                                 │
│  ├── Dropped capabilities                                                       │
│  └── Resource limits (CPU, memory, storage)                                     │
│                                                                                 │
│  Layer 5: Secret Management                                                     │
│  ├── Dev: K8s Secrets (base64, namespace-scoped)                                │
│  ├── Prod: External Secrets Operator → Vault / AWS / Azure / GCP                │
│  └── Docker: .env file (gitignored)                                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Kubernetes Network Policies

### Default Deny-All

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: nexus
spec:
  podSelector: {} # Applies to ALL pods
  policyTypes:
    - Ingress
    - Egress
```

This blocks **all** traffic by default. Every allowed connection must be
explicitly defined in a service-specific NetworkPolicy.

### Service-Specific Policies

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    NETWORK POLICY RULES                                         │
│                                                                                 │
│  gateway-core:                                                                  │
│  ├── Ingress: external (port 3001)                                              │
│  ├── Egress:  postgres (5432), emqx (1883), protocol-gateway (8080)             │
│  ├── Egress:  kube-dns (53), external HTTPS (443) for JWKS                      │
│  └── Why external HTTPS? → Fetch Authentik JWKS for JWT validation              │
│                                                                                 │
│  protocol-gateway:                                                              │
│  ├── Ingress: gateway-core (8080), monitoring (8081)                            │
│  ├── Egress:  emqx (1883, 8883), kube-dns (53)                                  │
│  ├── Egress:  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16                         │
│  └── Why private IPs? → Reach PLCs/OPC UA servers on OT network                 │
│                                                                                 │
│  data-ingestion:                                                                │
│  ├── Ingress: internal (8080), monitoring (8081)                                │
│  ├── Egress:  emqx (1883), timescaledb (5432), kube-dns (53)                    │
│  └── No external egress — fully contained                                       │
│                                                                                 │
│  postgres:                                                                      │
│  ├── Ingress: gateway-core ONLY (5432)                                          │
│  ├── Egress:  kube-dns (53)                                                     │
│  └── Most restricted — only one client                                          │
│                                                                                 │
│  timescaledb:                                                                   │
│  ├── Ingress: data-ingestion (5432), monitoring (9187)                          │
│  ├── Egress:  kube-dns (53)                                                     │
│  └── Write access from data-ingestion only                                      │
│                                                                                 │
│  emqx:                                                                          │
│  ├── Ingress: gateway-core, protocol-gateway, data-ingestion (1883)             │
│  ├── Ingress: cluster peers (4370, 5370)                                        │
│  ├── Egress:  cluster peers (4370, 5370), kube-dns (53)                         │
│  └── Erlang clustering requires inter-pod communication                         │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## MQTT Authentication

### Development (Default)

```hocon
# emqx.conf
authentication = []        # No authentication
authorization {
  no_match = allow         # Allow all
}
```

### Production

```hocon
# emqx.conf (production override)
authentication = [{
  mechanism = password_based
  backend = built_in_database
  user_id_type = username
}]

authorization {
  no_match = deny
  cache {
    enable = true
    max_size = 1024
    ttl = 1m
  }
}
```

### Service Credentials

| Client ID          | Username              | Password Source       | Publish                             | Subscribe                                          |
| ------------------ | --------------------- | --------------------- | ----------------------------------- | -------------------------------------------------- |
| `protocol-gateway` | `MQTT_PROTOCOL_USER`  | `MQTT_PROTOCOL_PASS`  | `dev/#`, `uns/#`, `$nexus/status/#` | `$nexus/config/#`, `cmd/#`                         |
| `gateway-core`     | `MQTT_GATEWAY_USER`   | `MQTT_GATEWAY_PASS`   | `$nexus/config/#`, `cmd/#`          | `$nexus/status/#`                                  |
| `data-ingestion-*` | `MQTT_HISTORIAN_USER` | `MQTT_HISTORIAN_PASS` | —                                   | `$share/ingestion/dev/#`, `$share/ingestion/uns/#` |

Each service has unique credentials. The ACL rules enforce topic-level access
control matching the credential.

---

## Secret Management

### Development: Kubernetes Secrets

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: nexus-secrets
  namespace: nexus
type: Opaque
data:
  MQTT_USERNAME: bmV4dXM= # base64("nexus")
  MQTT_PASSWORD: bmV4dXNfbXF0dA== # base64("nexus_mqtt")
```

**Limitations:**

- base64 is encoding, not encryption
- Stored in etcd (encrypted at rest if enabled)
- Visible to anyone with namespace read access

### Production: External Secrets Operator

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: nexus-secrets
  namespace: nexus
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: ClusterSecretStore
  target:
    name: nexus-secrets
  data:
    - secretKey: MQTT_USERNAME
      remoteRef:
        key: secret/nexus-edge/mqtt
        property: username
    - secretKey: MQTT_PASSWORD
      remoteRef:
        key: secret/nexus-edge/mqtt
        property: password
```

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SECRETS FLOW                                        │
│                                                                                 │
│  Vault / AWS SM / Azure KV / GCP SM                                             │
│         │                                                                       │
│         ▼                                                                       │
│  ┌──────────────────────┐                                                       │
│  │ External Secrets     │  Syncs every 1 hour                                   │
│  │ Operator             │  (refreshInterval: 1h)                                │
│  └──────────┬───────────┘                                                       │
│             │                                                                   │
│             ▼ Creates/updates                                                   │
│  ┌──────────────────────┐                                                       │
│  │ K8s Secret           │  Standard Secret — pods consume normally              │
│  │ (nexus-secrets)      │                                                       │
│  └──────────┬───────────┘                                                       │
│             │                                                                   │
│             ▼ envFrom / volume mount                                            │
│  ┌──────────────────────┐                                                       │
│  │ Application Pod      │                                                       │
│  └──────────────────────┘                                                       │
│                                                                                 │
│  Supported backends:                                                            │
│  • HashiCorp Vault (path: secret/nexus-edge/{service}/{key})                    │
│  • AWS Secrets Manager                                                          │
│  • Google Secret Manager                                                        │
│  • Azure Key Vault                                                              │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Docker: .env File

```bash
# infrastructure/docker/.env (gitignored, created from env.template)
POSTGRES_PASSWORD=strong_random_password_here
HISTORIAN_PASSWORD=another_strong_password
AUTHENTIK_SECRET_KEY=long_random_key_64_chars
```

**Rules:**

- `.env` is in `.gitignore` — never committed
- `env.template` contains placeholder values for documentation
- Each deployment generates unique passwords

---

## Container Security

### Security Contexts (K8s)

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  runAsGroup: 1000
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

### Per-Service Security

| Service          | Run As         | Read-Only FS | Capabilities | Notes                      |
| ---------------- | -------------- | :----------: | :----------: | -------------------------- |
| Gateway Core     | 1000 (node)    |     Yes      |     None     | tmpfs for /tmp             |
| Protocol Gateway | 1000           |     Yes      |     None     | Writable PVC for PKI only  |
| Data Ingestion   | 1000           |     Yes      |     None     | Fully stateless            |
| EMQX             | 1000 (emqx)    |      No      |     None     | Writes to data/log volumes |
| PostgreSQL       | 999 (postgres) |      No      |     None     | Writes to data volume      |
| TimescaleDB      | 999 (postgres) |      No      |     None     | Writes to data volume      |
| Nginx            | 101 (nginx)    |     Yes      |     None     | Config mounted read-only   |
| Authentik        | 1000           |      No      |     None     | Writes session/cache data  |

---

## Database Access Control

### Principle of Least Privilege

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    DATABASE ACCESS MATRIX                                       │
│                                                                                 │
│  Config DB (nexus_config):                                                      │
│  ├── nexus (owner)        → Full CRUD (used by Gateway Core)                    │
│  └── postgres (superuser) → Admin only                                          │
│                                                                                 │
│  Historian DB (nexus_historian):                                                │
│  ├── nexus_ingestion → INSERT on metrics, SELECT on aggregates                  │
│  │                     (Data Ingestion service)                                 │
│  ├── nexus_historian → SELECT only on all tables + functions                    │
│  │                     (Grafana, read-only API queries)                         │
│  └── postgres        → Admin only                                               │
│                                                                                 │
│  Authentik DB (authentik):                                                      │
│  ├── authentik → Full access (Authentik server/worker)                          │
│  └── No other service connects to this database                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Production Hardening Checklist

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION SECURITY CHECKLIST                                │
│                                                                                 │
│  Network:                                                                       │
│  □ NetworkPolicies applied (default deny-all + explicit allows)                 │
│  □ Nginx HTTPS enabled with valid certificate                                   │
│  □ HSTS header configured                                                       │
│  □ EMQX MQTTS enabled (port 8883)                                               │
│  □ Protocol Gateway egress limited to OT subnet (not 0.0.0.0/0)                 │
│                                                                                 │
│  Authentication:                                                                │
│  □ AUTH_ENABLED=true in Gateway Core                                            │
│  □ Authentik configured with strong admin password                              │
│  □ EMQX authentication enabled (no anonymous access)                            │
│  □ EMQX ACLs configured per service                                             │
│  □ Default dashboard password changed (EMQX, Grafana)                           │
│                                                                                 │
│  Secrets:                                                                       │
│  □ External Secrets Operator deployed                                           │
│  □ All passwords rotated from development defaults                              │
│  □ .env file not present in production (use Vault/SM)                           │
│  □ K8s etcd encryption at rest enabled                                          │
│                                                                                 │
│  Containers:                                                                    │
│  □ All containers run as non-root                                               │
│  □ Read-only root filesystems where possible                                    │
│  □ Resource limits set (CPU + memory)                                           │
│  □ No privileged containers                                                     │
│  □ Image tags pinned to specific versions (no :latest)                          │
│                                                                                 │
│  Monitoring:                                                                    │
│  □ Audit logging enabled in Gateway Core                                        │
│  □ Prometheus scraping all services                                             │
│  □ Alert rules configured for critical failures                                 │
│  □ Grafana anonymous access disabled or restricted                              │
│                                                                                 │
│  Database:                                                                      │
│  □ Unique passwords per database user                                           │
│  □ No superuser connections from application services                           │
│  □ PostgreSQL sslmode=require (if network untrusted)                            │
│  □ TimescaleDB retention policies active                                        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Related Documentation

- [Network Architecture](network_architecture.md) — network policy details
- [TLS & Certificates](tls_certificates.md) — certificate management
- [Authentik Architecture](authentik_architecture.md) — OIDC configuration
- [EMQX Configuration](emqx_configuration.md) — MQTT ACL rules
- [Configuration Reference](configuration_reference.md) — security-related env vars

---

_Document Version: 1.0_
_Last Updated: March 2026_
