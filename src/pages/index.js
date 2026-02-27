import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

// ─── Data ────────────────────────────────────────────────────────────────────

const STATS = [
  { number: '4',      label: 'Industrial Protocols',  sub: 'Modbus TCP · RTU · OPC UA · S7' },
  { number: '~67 MB', label: 'Container Image',        sub: 'Compiled Go binary, minimal deps' },
  { number: '10 000', label: 'MQTT Buffer Slots',      sub: 'Ring buffer, configurable QoS 0/1/2' },
  { number: '3-tier', label: 'Circuit Breakers',       sub: 'Per-device fault isolation' },
];

const FEATURES = [
  {
    title: 'Per-Device Connection Pools',
    accent: 'teal',
    icon: '⚡',
    body: 'Each device owns its own pool with idle-connection reaping and MaxTTL rotation — no thundering herd on restart.',
  },
  {
    title: 'Multi-Tier Circuit Breakers',
    accent: 'red',
    icon: '🛡️',
    body: 'sony/gobreaker wired per device. Trips on consecutive failures, recovers via configurable half-open probes.',
  },
  {
    title: 'Priority-Based Polling',
    accent: 'purple',
    icon: '⚙️',
    body: 'Worker pool with jitter, back-pressure skip, and load shaping so high-priority tags always get serviced first.',
  },
  {
    title: 'MQTT Publishing',
    accent: 'teal',
    icon: '📡',
    body: 'Eclipse Paho client with a 10 000-message ring buffer, auto-reconnect, and UNS-structured topic hierarchy.',
  },
  {
    title: 'Full Observability',
    accent: 'red',
    icon: '📊',
    body: 'Prometheus metrics, zerolog structured logs, health endpoints with flapping protection, and NTP drift tracking.',
  },
  {
    title: 'Clean Hexagonal Architecture',
    accent: 'purple',
    icon: '🏛️',
    body: 'Pure domain core with zero external dependencies. Adapters plug in via interfaces — swappable without touching domain logic.',
  },
];

const CHAPTERS = [
  { num: '01', title: 'Executive Summary',        href: '/docs/pages/summary',                    desc: 'Purpose, capabilities & philosophy' },
  { num: '02', title: 'System Overview',           href: '/docs/pages/system_overview',            desc: 'High-level architecture & tech stack' },
  { num: '03', title: 'Architectural Principles',  href: '/docs/pages/architectural_principles',   desc: 'Clean Architecture, DI, interface segregation' },
  { num: '04', title: 'Layer Architecture',        href: '/docs/pages/layer_architecture',         desc: 'Domain & adapter layer structure' },
  { num: '05', title: 'Domain Model',              href: '/docs/pages/domain_model',               desc: 'Entities, validation logic, error taxonomy' },
  { num: '06', title: 'Protocol Adapters',         href: '/docs/pages/protocol_adapters',          desc: 'Modbus TCP/RTU, OPC UA, S7, MQTT publisher' },
  { num: '07', title: 'Connection Management',     href: '/docs/pages/connection_management',      desc: 'Pooling strategies, idle reaping, MaxTTL' },
  { num: '08', title: 'Data Flow Architecture',    href: '/docs/pages/dataflow_architecture',      desc: 'Read path (polling), write path, workers' },
  { num: '09', title: 'Resilience Patterns',       href: '/docs/pages/resilience_patterns',        desc: 'Circuit breakers, retry/backoff, degradation' },
  { num: '10', title: 'Observability',             href: '/docs/pages/observability_infrastructure', desc: 'Prometheus, structured logs, health checks' },
  { num: '11', title: 'Security Architecture',     href: '/docs/pages/security_architecture',      desc: 'TLS, OPC UA profiles, credential management' },
  { num: '12', title: 'Deployment Architecture',   href: '/docs/pages/deployment_architecture',    desc: 'Docker, Compose, Kubernetes reference' },
  { num: '13', title: 'Web UI Architecture',       href: '/docs/pages/web_architecture',           desc: 'React SPA & REST API endpoints' },
  { num: '14', title: 'Testing Strategy',          href: '/docs/pages/testing_strategy',           desc: 'Test pyramid & simulator infrastructure' },
  { num: '15', title: 'Standards Compliance',      href: '/docs/pages/standards_compliance',       desc: 'IEC 61158, IEC 62541, UNS, Sparkplug B' },
  { num: '16', title: 'Appendices',                href: '/docs/pages/appendices',                 desc: 'Config reference, error codes, dependencies' },
  { num: '17', title: 'Edge Cases & Gotchas',      href: '/docs/pages/edge_cases',                 desc: 'Operational notes & hot-reload scope' },
  { num: '18', title: 'Device Configuration',      href: '/docs/pages/device_configuration',       desc: 'YAML examples & validation rules' },
  { num: '19', title: 'Conclusion',                href: '/docs/pages/conclusion',                 desc: 'Summary of architectural achievements' },
];

// ─── Small Components ─────────────────────────────────────────────────────────

function StatCard({ number, label, sub }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statNumber}>{number}</span>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statSub}>{sub}</span>
    </div>
  );
}

function FeatureCard({ title, accent, icon, body }) {
  return (
    <div className={clsx(styles.featureCard, styles[`featureCard__${accent}`])}>
      <span className={styles.featureIcon}>{icon}</span>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureBody}>{body}</p>
    </div>
  );
}

function ChapterCard({ num, title, href, desc }) {
  return (
    <Link to={href} className={styles.chapterCard}>
      <span className={styles.chapterNum}>{num}</span>
      <span className={styles.chapterBody}>
        <span className={styles.chapterTitle}>{title}</span>
        <span className={styles.chapterDesc}>{desc}</span>
      </span>
    </Link>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title="Protocol Gateway"
      description="Industrial-grade data acquisition — Modbus · OPC UA · Siemens S7 → MQTT"
    >
      {/* ═══════════════ HERO ═══════════════ */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroPills}>
            <span className={styles.pill}>Go 1.22+</span>
            <span className={styles.pill}>v2.3.0</span>
            <span className={styles.pill}>~25 MB</span>
            <span className={clsx(styles.pill, styles.pillTeal)}>February 2026</span>
          </div>

          <Heading as="h1" className={styles.heroTitle}>
            Protocol <span className={styles.heroAccent}>Gateway</span>
          </Heading>

          <p className={styles.heroSubtitle}>
            Industrial-grade data acquisition bridging heterogeneous automation devices
            to modern IT infrastructure via MQTT — following the{' '}
            <strong>Unified Namespace</strong> pattern.
          </p>

          <div className={styles.heroProtocols}>
            {['Modbus TCP', 'Modbus RTU', 'OPC UA', 'Siemens S7'].map((p) => (
              <span key={p} className={styles.proto}>{p}</span>
            ))}
            <span className={styles.protoArrow}>→</span>
            <span className={clsx(styles.proto, styles.protoMqtt)}>MQTT</span>
          </div>

          <div className={styles.heroCta}>
            <Link
              className={clsx('button button--lg', styles.ctaPrimary)}
              to="/docs"
            >
              Browse Documentation
            </Link>
            <Link
              className={clsx('button button--lg', styles.ctaOutline)}
              to="/docs/pages/summary"
            >
              Executive Summary →
            </Link>
          </div>
        </div>
      </section>

      {/* ═══════════════ STATS ═══════════════ */}
      <section className={styles.statsSection}>
        <div className={styles.statsGrid}>
          {STATS.map((s) => <StatCard key={s.label} {...s} />)}
        </div>
      </section>

      {/* ═══════════════ ARCHITECTURE FLOW ═══════════════ */}
      <section className={styles.archSection}>
        <div className={styles.sectionWrap}>
          <h2 className={styles.sectionTitle}>System Architecture</h2>
          <p className={styles.sectionSub}>
            Hexagonal core, per-protocol adapter pools, and a unified MQTT publishing layer.
          </p>

          <div className={styles.archFlow}>
            <div className={styles.archNode}>
              <span className={styles.archIcon}>🏭</span>
              <strong>Industrial Floor</strong>
              <span>PLCs · Sensors · RTUs</span>
            </div>
            <span className={styles.archArrow}>→</span>

            <div className={clsx(styles.archNode, styles.archNodeCore)}>
              <span className={styles.archIcon}>⚙️</span>
              <strong>Protocol Gateway</strong>
              <span>Adapters · Pools · Breakers · Domain</span>
            </div>
            <span className={styles.archArrow}>→</span>

            <div className={styles.archNode}>
              <span className={styles.archIcon}>📡</span>
              <strong>MQTT Broker</strong>
              <span>UNS topic hierarchy</span>
            </div>
            <span className={styles.archArrow}>→</span>

            <div className={styles.archNode}>
              <span className={styles.archIcon}>🖥️</span>
              <strong>IT Infrastructure</strong>
              <span>InfluxDB · SCADA · Analytics</span>
            </div>
          </div>

          <div className={styles.archMeta}>
            <span className={styles.archMetaItem}>🔌 &nbsp;Per-device connection pools</span>
            <span className={styles.archMetaItem}>🛡️ &nbsp;3-tier circuit breakers</span>
            <span className={styles.archMetaItem}>📦 &nbsp;10 000-slot MQTT buffer</span>
            <span className={styles.archMetaItem}>📊 &nbsp;Prometheus + zerolog</span>
          </div>
        </div>
      </section>

      {/* ═══════════════ FEATURES ═══════════════ */}
      <section className={clsx(styles.section, styles.sectionAlt)}>
        <div className={styles.sectionWrap}>
          <h2 className={styles.sectionTitle}>Core Capabilities</h2>
          <div className={styles.featuresGrid}>
            {FEATURES.map((f) => <FeatureCard key={f.title} {...f} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════ CHAPTERS ═══════════════ */}
      <section className={styles.section}>
        <div className={styles.sectionWrap}>
          <h2 className={styles.sectionTitle}>Documentation</h2>
          <p className={styles.sectionSub}>
            19 chapters covering every architectural layer and operational concern
          </p>
          <div className={styles.chaptersGrid}>
            {CHAPTERS.map((c) => <ChapterCard key={c.num} {...c} />)}
          </div>
        </div>
      </section>

      {/* ═══════════════ QUICK REFERENCE ═══════════════ */}
      <section className={clsx(styles.section, styles.sectionAlt, styles.quickRefSection)}>
        <div className={styles.sectionWrap}>
          <h2 className={styles.sectionTitle}>Quick Reference</h2>
          <p className={styles.sectionSub}>Know what to look at for common tasks</p>
          <div className={styles.quickGrid}>
            {[
              { task: 'Add a new protocol adapter',  ref: 'Ch. 3 — Interfaces',     link: '/docs/pages/architectural_principles' },
              { task: 'Tune polling performance',     ref: 'Ch. 8 — Worker pool',    link: '/docs/pages/dataflow_architecture' },
              { task: 'Debug connectivity issues',    ref: 'Ch. 9 — Circuit breakers', link: '/docs/pages/resilience_patterns' },
              { task: 'Configure TLS / security',     ref: 'Ch. 11 — Security',      link: '/docs/pages/security_architecture' },
              { task: 'Deploy to production',         ref: 'Ch. 12 — Deployment',    link: '/docs/pages/deployment_architecture' },
              { task: 'Set up Prometheus monitoring', ref: 'Ch. 10 — Observability', link: '/docs/pages/observability_infrastructure' },
            ].map(({ task, ref, link }) => (
              <Link key={task} to={link} className={styles.quickCard}>
                <span className={styles.quickTask}>{task}</span>
                <span className={styles.quickRef}>{ref} →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </Layout>
  );
}
