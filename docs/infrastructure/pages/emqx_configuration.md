# Chapter 5 — EMQX Configuration

> MQTT broker setup, clustering, authentication, ACLs, shared subscriptions,
> listener config, and topic design.

---

## Overview

EMQX v5.3.2 is the central message broker for NEXUS Edge. All inter-service
communication flows through MQTT topics.

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EMQX MESSAGE FLOWS                                      │
│                                                                                 │
│  Protocol Gateway ───publish──> dev/{deviceId}/{tagName}                        │
│                    ───publish──> $nexus/status/device/{id}                      │
│                                                                                 │
│  Gateway Core ────publish──> $nexus/config/{type}/updated                       │
│               ────subscribe──> $nexus/status/#                                  │
│                                                                                 │
│  Data Ingestion ──subscribe──> $share/ingestion/dev/#                           │
│                 ──subscribe──> $share/ingestion/uns/#                           │
│                                                                                 │
│  Web UI (via WS bridge) ──subscribe──> $nexus/status/device/#                   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Clustering

### Docker Compose (Single Node)

```hocon
cluster {
  discovery_strategy = static
  static { seeds = [] }
}
```

Single-node mode — no clustering overhead for development.

### Kubernetes (Multi-Node)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    EMQX CLUSTER IN KUBERNETES                                   │
│                                                                                 │
│  Discovery: DNS SRV records via headless service                                │
│                                                                                 │
│  emqx-0.emqx-headless.nexus.svc.cluster.local                                   │
│  emqx-1.emqx-headless.nexus.svc.cluster.local                                   │
│  emqx-2.emqx-headless.nexus.svc.cluster.local                                   │
│                                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                                   │
│  │ emqx-0   │◄──►│ emqx-1   │◄──►│ emqx-2   │                                   │
│  │          │    │          │    │          │                                   │
│  │ Erlang   │    │ Erlang   │    │ Erlang   │                                   │
│  │ cluster  │    │ cluster  │    │ cluster  │                                   │
│  └──────────┘    └──────────┘    └──────────┘                                   │
│       ▲               ▲               ▲                                         │
│       │  Port 4370 (ekka) + 5370 (erlang distribution)                          │
│       │                                                                         │
│  Cluster ports used for:                                                        │
│  • Session replication (client connects to any node)                            │
│  • Subscription routing (message delivered to correct node)                     │
│  • Shared subscription coordination (load balancing across group)               │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Environment variables for K8s clustering:

```yaml
EMQX_CLUSTER__DISCOVERY_STRATEGY: dns
EMQX_CLUSTER__DNS__RECORD_TYPE: srv
EMQX_CLUSTER__DNS__NAME: emqx-headless.nexus.svc.cluster.local
```

---

## Listeners

| Listener      | Port  | Protocol | Purpose                                 |
| ------------- | ----- | -------- | --------------------------------------- |
| TCP           | 1883  | MQTT     | Primary — all services connect here     |
| SSL           | 8883  | MQTTS    | TLS-encrypted MQTT (production)         |
| WebSocket     | 8083  | WS       | Browser MQTT via Gateway Core WS bridge |
| WebSocket SSL | 8084  | WSS      | TLS-encrypted WebSocket                 |
| Dashboard     | 18083 | HTTP     | EMQX management UI                      |

### Performance Tuning

```hocon
listeners.tcp.default {
  max_connections = 100000
  acceptors = 64
}

mqtt {
  max_topic_levels = 10
  max_packet_size = 10MB
  max_qos_allowed = 2
}
```

---

## Shared Subscriptions

Shared subscriptions are the foundation of horizontal scaling for Data Ingestion:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    SHARED SUBSCRIPTION MECHANICS                                │
│                                                                                 │
│  Topic pattern: $share/{group}/{topic}                                          │
│                                                                                 │
│  Example: $share/ingestion/dev/#                                                │
│           ^^^^^^ ^^^^^^^^^ ^^^^^                                                │
│           prefix  group     topic filter                                        │
│                                                                                 │
│  Behavior:                                                                      │
│  • Messages to dev/plc-1/temperature arrive at EMQX                             │
│  • EMQX distributes to ONE subscriber in group "ingestion"                      │
│  • Round-robin by default (strategy: round_robin)                               │
│  • No duplicates — each message processed exactly once per group                │
│                                                                                 │
│  Scaling:                                                                       │
│  1 pod  → receives 100% of messages                                             │
│  2 pods → each receives ~50%                                                    │
│  4 pods → each receives ~25%                                                    │
│  8 pods → each receives ~12.5%                                                  │
│                                                                                 │
│  EMQX rebalances automatically when pods join/leave.                            │
│  No application-level coordination needed.                                      │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Topic Design

| Topic Pattern                  | Publisher        | Subscriber           | QoS | Purpose                     |
| ------------------------------ | ---------------- | -------------------- | --- | --------------------------- |
| `dev/{deviceId}/{tagName}`     | Protocol Gateway | Data Ingestion       | 1   | Real-time tag values        |
| `uns/{path}`                   | Protocol Gateway | Data Ingestion       | 1   | Unified Namespace data      |
| `$nexus/status/device/{id}`    | Protocol Gateway | Gateway Core, Web UI | 1   | Device status changes       |
| `$nexus/status/service/{name}` | All services     | Gateway Core         | 1   | Service health updates      |
| `$nexus/config/{type}/updated` | Gateway Core     | Protocol Gateway     | 1   | Config change notifications |
| `cmd/{deviceId}/{command}`     | Gateway Core     | Protocol Gateway     | 1   | Device commands (write)     |

---

## ACL Configuration (acl.conf)

Access control rules for production deployments:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    MQTT ACL RULES                                               │
│                                                                                 │
│  Client                │ Publish              │ Subscribe                       │
│  ──────────────────────┼──────────────────────┼────────────────────────────     │
│  protocol-gateway      │ dev/#, uns/#,        │ $nexus/config/#, cmd/#          │
│                        │ $nexus/status/#       │                                │
│  ──────────────────────┼──────────────────────┼────────────────────────────     │
│  gateway-core          │ $nexus/config/#,     │ $nexus/status/#                 │
│                        │ cmd/#                 │                                │
│  ──────────────────────┼──────────────────────┼────────────────────────────     │
│  data-ingestion-*      │ (none)               │ $share/ingestion/dev/#,         │
│                        │                       │ $share/ingestion/uns/#         │
│  ──────────────────────┼──────────────────────┼────────────────────────────     │
│  web-ui-*              │ (none)               │ $nexus/status/#                 │
│                                                                                 │
│  Production: EMQX built-in authentication with username/password                │
│  Development: Authentication disabled (allow_anonymous = true)                  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Dashboard

EMQX Dashboard at `http://localhost:18083`:

| Feature       | URL                        | Credentials            |
| ------------- | -------------------------- | ---------------------- |
| Overview      | /dashboard                 | admin / public (dev)   |
| Clients       | /dashboard/#/clients       | See connected services |
| Topics        | /dashboard/#/topics        | Monitor active topics  |
| Subscriptions | /dashboard/#/subscriptions | Verify shared subs     |
| Metrics       | /api/v5/prometheus/stats   | Prometheus endpoint    |

---

## Health Check

Custom health check script (`healthcheck.sh`) verifies:

1. MQTT listener on port 1883 is accepting TCP connections
2. Dashboard on port 18083 is responding

```bash
#!/bin/bash
# Check MQTT TCP listener
perl -e 'use IO::Socket::INET; my $s = IO::Socket::INET->new(
  PeerAddr => "127.0.0.1", PeerPort => 1883, Timeout => 5
) or die; close($s)' || exit 1

# Check Dashboard HTTP
perl -e 'use IO::Socket::INET; my $s = IO::Socket::INET->new(
  PeerAddr => "127.0.0.1", PeerPort => 18083, Timeout => 5
) or die; close($s)' || exit 1
```

---

## Related Documentation

- [Network Architecture](network_architecture.md) — MQTT ports and network access
- [Scaling Playbook](scaling_playbook.md) — EMQX cluster sizing
- [Security Hardening](security_hardening.md) — MQTT authentication in production
- [Troubleshooting](troubleshooting.md) — MQTT connection issues

---

_Document Version: 1.0_
_Last Updated: March 2026_
