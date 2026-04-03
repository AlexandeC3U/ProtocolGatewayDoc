import React from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

// ─── Data ────────────────────────────────────────────────────────────────────

const STATS = [
  { number: '6',       label: 'Industrial Protocols',  sub: 'Modbus TCP · RTU · OPC UA · S7 · BACnet · EtherNet/IP' },
  { number: '5',       label: 'Core Services',          sub: 'Gateway · Ingestion · Core API · Web UI · Auth' },
  { number: 'MQTT',    label: 'Unified Namespace',      sub: 'EMQX broker, UNS topic hierarchy' },
  { number: 'Full',    label: 'Observability Stack',    sub: 'Prometheus · Grafana · TimescaleDB' },
];

const FEATURES = [
  {
    title: 'Protocol Gateway',
    accent: 'teal',
    icon: '⚡',
    body: 'Industrial data acquisition in Go — Modbus, OPC UA, S7 adapters with per-device connection pools and circuit breakers.',
  },
  {
    title: 'Gateway Core',
    accent: 'red',
    icon: '🔀',
    body: 'Fastify-based API gateway with WebSocket bridge, middleware pipeline, MQTT integration, and reverse proxy layer.',
  },
  {
    title: 'Data Ingestion',
    accent: 'purple',
    icon: '📥',
    body: 'High-throughput MQTT-to-TimescaleDB pipeline using PostgreSQL COPY protocol for efficient time-series storage.',
  },
  {
    title: 'Web UI',
    accent: 'teal',
    icon: '🖥️',
    body: 'React SPA with real-time dashboards, OIDC authentication via Authentik, and a comprehensive design system.',
  },
  {
    title: 'Full Observability',
    accent: 'red',
    icon: '📊',
    body: 'Prometheus metrics from every service, Grafana dashboards, structured logging, and health endpoints with flapping protection.',
  },
  {
    title: 'Production Infrastructure',
    accent: 'purple',
    icon: '🏛️',
    body: 'Docker Compose & Kubernetes deployments, Nginx reverse proxy, TLS termination, Authentik OIDC, and automated backups.',
  },
];

const SECTIONS = [
  { num: '01', title: 'Platform Overview',        href: '/docs',                                                  desc: 'Architecture, services & getting started' },
  { num: '02', title: 'Infrastructure',           href: '/docs/infrastructure',                                   desc: 'Docker, K8s, Nginx, TLS, databases, observability' },
  { num: '03', title: 'Platform Guides',          href: '/docs/platform/GETTING_STARTED',                         desc: 'Getting started, API reference, MQTT contracts' },
  { num: '04', title: 'Protocol Gateway',         href: '/docs/services/protocol-gateway',                        desc: 'Industrial protocol adapters, connection pools, breakers' },
  { num: '05', title: 'Gateway Core',             href: '/docs/services/gateway-core',                            desc: 'API gateway, WebSocket bridge, middleware, proxy' },
  { num: '06', title: 'Data Ingestion',           href: '/docs/services/data-ingestion',                          desc: 'MQTT subscriber, TimescaleDB writer, pipeline' },
  { num: '07', title: 'Web UI',                   href: '/docs/services/web-ui',                                  desc: 'React SPA, state management, real-time dashboards' },
  { num: '08', title: 'Security Overview',        href: '/docs/platform/SECURITY_OVERVIEW',                       desc: 'OIDC, TLS, credential management, hardening' },
  { num: '09', title: 'Operations Runbook',       href: '/docs/platform/OPERATIONS_RUNBOOK',                      desc: 'Deployment, scaling, backup & recovery' },
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
      title="Conduit Edge"
      description="Industrial IoT platform — Protocol Gateway · Data Ingestion · Gateway Core · Web UI"
    >
      {/* ═══════════════ HERO ═══════════════ */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroPills}>
            <span className={styles.pill}>Go · Node.js · React</span>
            <span className={styles.pill}>Docker & K8s</span>
            <span className={styles.pill}>MQTT / UNS</span>
            <span className={clsx(styles.pill, styles.pillTeal)}>April 2026</span>
          </div>

          <Heading as="h1" className={styles.heroTitle}>
            Conduit <span className={styles.heroAccent}>Edge</span>
          </Heading>

          <p className={styles.heroSubtitle}>
            A complete Industrial IoT platform bridging shop-floor devices to modern
            IT infrastructure — from protocol acquisition to real-time dashboards,
            built on the{' '}
            <strong>Unified Namespace</strong> pattern.
          </p>

          <div className={styles.heroProtocols}>
            {['Protocol Gateway', 'Data Ingestion', 'Gateway Core', 'Web UI'].map((p) => (
              <span key={p} className={styles.proto}>{p}</span>
            ))}
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
              to="/docs/platform/GETTING_STARTED"
            >
              Getting Started →
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
          <h2 className={styles.sectionTitle}>Platform Architecture</h2>
          <p className={styles.sectionSub}>
            From industrial devices through protocol acquisition to real-time dashboards and time-series storage.
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
              <strong>Conduit Edge</strong>
              <span>Gateway · Ingestion · Core · UI</span>
            </div>
            <span className={styles.archArrow}>→</span>

            <div className={styles.archNode}>
              <span className={styles.archIcon}>📡</span>
              <strong>EMQX Broker</strong>
              <span>UNS topic hierarchy</span>
            </div>
            <span className={styles.archArrow}>→</span>

            <div className={styles.archNode}>
              <span className={styles.archIcon}>🖥️</span>
              <strong>IT Infrastructure</strong>
              <span>TimescaleDB · Grafana · Analytics</span>
            </div>
          </div>

          <div className={styles.archMeta}>
            <span className={styles.archMetaItem}>🔌 &nbsp;6 industrial protocols</span>
            <span className={styles.archMetaItem}>🛡️ &nbsp;OIDC + TLS security</span>
            <span className={styles.archMetaItem}>📦 &nbsp;Docker & Kubernetes</span>
            <span className={styles.archMetaItem}>📊 &nbsp;Prometheus + Grafana</span>
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

      {/* ═══════════════ DOCUMENTATION ═══════════════ */}
      <section className={styles.section}>
        <div className={styles.sectionWrap}>
          <h2 className={styles.sectionTitle}>Documentation</h2>
          <p className={styles.sectionSub}>
            Every service, infrastructure component, and platform-level concern
          </p>
          <div className={styles.chaptersGrid}>
            {SECTIONS.map((c) => <ChapterCard key={c.num} {...c} />)}
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
              { task: 'Get the platform running',     ref: 'Getting Started',         link: '/docs/platform/GETTING_STARTED' },
              { task: 'Understand the API',            ref: 'API Reference',           link: '/docs/platform/API_REFERENCE' },
              { task: 'Configure infrastructure',      ref: 'Infrastructure',          link: '/docs/infrastructure' },
              { task: 'Set up TLS & security',         ref: 'Security Overview',       link: '/docs/platform/SECURITY_OVERVIEW' },
              { task: 'Deploy to production',          ref: 'Infrastructure — K8s',    link: '/docs/infrastructure/pages/kubernetes' },
              { task: 'Set up monitoring',             ref: 'Observability Stack',     link: '/docs/infrastructure/pages/observability_stack' },
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
