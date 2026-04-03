# Chapter 11 — TLS & Certificates

> SSL termination at Nginx, MQTT over TLS, OPC UA PKI trust store,
> cert-manager for Kubernetes, and certificate rotation procedures.

---

## Certificate Landscape

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TLS CERTIFICATE MAP                                          │
│                                                                                 │
│  Component          Protocol    Port   Certificate Source                       │
│  ────────────────── ─────────── ────── ──────────────────────────────────────   │
│  Nginx              HTTPS       443    Manual / cert-manager / Let's Encrypt    │
│  EMQX               MQTTS       8883   Self-signed or CA-signed                 │
│  EMQX               WSS         8084   Same as MQTTS                            │
│  Authentik           HTTPS       9443   Self-signed (built-in)                  │
│  Protocol Gateway    OPC UA      —      PKI trust store (per-server certs)      │
│  PostgreSQL          PG + SSL    5432   Optional (sslmode=require)              │
│  TimescaleDB         PG + SSL    5432   Optional (sslmode=require)              │
│                                                                                 │
│  Development: All TLS disabled (plaintext HTTP, MQTT, WS)                       │
│  Production:  Nginx SSL mandatory, MQTT TLS recommended, DB TLS optional        │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Nginx SSL Termination

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SSL TERMINATION PATTERN                                      │
│                                                                                 │
│  Client ──HTTPS──► Nginx ──HTTP──► Internal services                            │
│                     │                                                           │
│                     ├── gateway-core:3001 (HTTP)                                │
│                     ├── web-ui:80 (HTTP)                                        │
│                     ├── grafana:3000 (HTTP)                                     │
│                     └── authentik:9000 (HTTP)                                   │
│                                                                                 │
│  TLS terminates at Nginx. Internal traffic is plaintext on the                  │
│  Docker/K8s internal network (trusted, not exposed externally).                 │
│                                                                                 │
│  Benefits:                                                                      │
│  • Single certificate to manage                                                 │
│  • No TLS overhead on application services                                      │
│  • Centralized TLS configuration and rotation                                   │
│  • Internal network is isolated (Docker bridge / K8s NetworkPolicy)             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Certificate Files

```
infrastructure/docker/config/nginx/ssl/
├── fullchain.pem      # Server certificate + intermediate CA chain
├── privkey.pem        # Private key (chmod 600)
└── dhparam.pem        # DH parameters for forward secrecy (optional)
```

### Nginx TLS Configuration

```nginx
ssl_certificate     /etc/nginx/ssl/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/privkey.pem;

# Protocol versions
ssl_protocols TLSv1.2 TLSv1.3;

# Cipher suites (TLS 1.2 — TLS 1.3 ciphers are automatic)
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:
            ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
ssl_prefer_server_ciphers on;

# Session caching (reduces TLS handshake overhead)
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;

# HSTS (tell browsers to always use HTTPS)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

# OCSP stapling (faster certificate validation)
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
```

---

## EMQX MQTT over TLS

### Configuration (emqx.conf)

```hocon
listeners.ssl.default {
    bind = "0.0.0.0:8883"
    ssl_options {
        certfile = "/opt/emqx/etc/certs/cert.pem"
        keyfile  = "/opt/emqx/etc/certs/key.pem"
        cacertfile = "/opt/emqx/etc/certs/ca.pem"
        verify = verify_none          # verify_peer for mutual TLS
    }
    max_connections = 100000
}

listeners.wss.default {
    bind = "0.0.0.0:8084"
    ssl_options {
        certfile = "/opt/emqx/etc/certs/cert.pem"
        keyfile  = "/opt/emqx/etc/certs/key.pem"
    }
}
```

### Client Connection Strings

| Environment | Protocol Gateway (Go) | Gateway Core (Node.js) |
| ----------- | --------------------- | ---------------------- |
| Development | `tcp://emqx:1883`     | `mqtt://emqx:1883`     |
| Production  | `ssl://emqx:8883`     | `mqtts://emqx:8883`    |

---

## OPC UA PKI Trust Store

The Protocol Gateway maintains a PKI trust store for OPC UA server certificates.
This is a persistent volume mounted at `/app/certs/pki`.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    OPC UA PKI DIRECTORY STRUCTURE                               │
│                                                                                 │
│  /app/certs/pki/                                                                │
│  ├── own/                                                                       │
│  │   ├── cert.pem          ← Protocol Gateway's own certificate                 │
│  │   └── key.pem           ← Protocol Gateway's private key                     │
│  │                                                                              │
│  ├── trusted/                                                                   │
│  │   └── certs/                                                                 │
│  │       ├── server1.pem   ← Trusted OPC UA server certificates                 │
│  │       └── server2.pem                                                        │
│  │                                                                              │
│  ├── rejected/                                                                  │
│  │   └── certs/                                                                 │
│  │       └── unknown.pem   ← Auto-rejected on first connection                  │
│  │                                                                              │
│  └── issuers/                                                                   │
│      └── certs/                                                                 │
│          └── ca.pem        ← CA certificates for chain validation               │
│                                                                                 │
│  TRUST FLOW:                                                                    │
│  1. Protocol Gateway connects to OPC UA server                                  │
│  2. Server presents its certificate                                             │
│  3. If cert is in trusted/ → connection proceeds                                │
│  4. If cert is unknown → saved to rejected/, connection denied                  │
│  5. Operator moves cert from rejected/ to trusted/ → retry succeeds             │
│                                                                                 │
│  Volume: protocol-gateway-pki (100Mi PVC)                                       │
│  Persists across pod restarts — trust decisions are durable.                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Kubernetes: cert-manager

### Installation

```bash
# Install cert-manager CRDs + controllers
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.0/cert-manager.yaml
```

### Let's Encrypt Issuer

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@example.com
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
      - http01:
          ingress:
            class: nginx
```

### Certificate Resource

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: nexus-tls
  namespace: nexus
spec:
  secretName: nexus-tls-secret
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - nexus.example.com
    - '*.nexus.example.com'
  renewBefore: 720h # Renew 30 days before expiry
```

cert-manager automatically:

- Requests certificates from Let's Encrypt
- Stores them as K8s Secrets
- Renews before expiry
- Updates the Secret (Nginx picks up on reload)

### Ingress Integration

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: nexus-ingress
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  tls:
    - hosts:
        - nexus.example.com
      secretName: nexus-tls-secret
  rules:
    - host: nexus.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: nginx
                port:
                  number: 80
```

---

## Certificate Rotation

### Manual Rotation (Docker Compose)

```bash
# 1. Replace certificate files
cp new-fullchain.pem infrastructure/docker/config/nginx/ssl/fullchain.pem
cp new-privkey.pem infrastructure/docker/config/nginx/ssl/privkey.pem

# 2. Reload Nginx (zero-downtime)
docker compose exec nexus-nginx nginx -s reload

# 3. Verify
curl -vI https://nexus.example.com 2>&1 | grep "expire date"
```

### Automated Rotation (K8s + cert-manager)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    CERT-MANAGER RENEWAL CYCLE                                   │
│                                                                                 │
│  cert-manager ──checks──► Certificate resource                                  │
│       │                    • renewBefore: 720h (30 days)                        │
│       │                    • Let's Encrypt cert: 90 days validity               │
│       │                                                                         │
│       ├── Day 0:  Certificate issued, stored in Secret                          │
│       ├── Day 60: cert-manager triggers renewal (30 days before expiry)         │
│       ├── Day 60: New cert issued, Secret updated                               │
│       └── Ingress controller detects Secret change → reload TLS                 │
│                                                                                 │
│  No manual intervention required.                                               │
│  Monitor: kubectl get certificates -n nexus                                     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Self-Signed Certificates (Development)

For local development or air-gapped environments:

```bash
# Generate self-signed cert (valid 365 days)
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout privkey.pem \
  -out fullchain.pem \
  -subj "/CN=nexus.local/O=NEXUS Edge"

# Generate EMQX MQTT TLS cert
openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout emqx-key.pem \
  -out emqx-cert.pem \
  -subj "/CN=emqx/O=NEXUS Edge"
```

---

## Related Documentation

- [Nginx Configuration](nginx_configuration.md) — SSL listener setup
- [Security Hardening](security_hardening.md) — TLS requirements for production
- [EMQX Configuration](emqx_configuration.md) — MQTT TLS listeners
- [Docker Compose](docker_compose.md) — certificate volume mounts

---

_Document Version: 1.0_
_Last Updated: March 2026_
