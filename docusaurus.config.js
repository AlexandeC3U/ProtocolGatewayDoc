// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Protocol Gateway',
  tagline: 'Industrial data acquisition — Modbus · OPC UA · Siemens S7 → MQTT',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://AlexanderC3U.github.io',
  baseUrl: '/ProtocolGatewayDoc/',

  organizationName: 'AlexanderC3U',
  projectName: 'ProtocolGatewayDoc',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: './markdown',
          sidebarPath: './sidebars.js',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        defaultMode: 'light',
        disableSwitch: true,
        respectPrefersColorScheme: false,
      },
      navbar: {
        title: 'Protocol Gateway',
        style: 'dark',

        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docs',
            position: 'left',
            label: 'Documentation',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              { label: 'Overview', to: '/docs' },
              { label: 'Executive Summary', to: '/docs/pages/summary' },
              { label: 'System Overview', to: '/docs/pages/system_overview' },
              { label: 'Deployment', to: '/docs/pages/deployment_architecture' },
            ],
          },
          {
            title: 'Protocols & Infrastructure',
            items: [
              { label: 'Protocol Adapters', to: '/docs/pages/protocol_adapters' },
              { label: 'Connection Management', to: '/docs/pages/connection_management' },
              { label: 'Resilience Patterns', to: '/docs/pages/resilience_patterns' },
              { label: 'Security Architecture', to: '/docs/pages/security_architecture' },
            ],
          },
        ],
        copyright: `Protocol Gateway Documentation v2.3.0 · Updated February 2026`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['go', 'yaml', 'bash', 'docker'],
      },
    }),
};

export default config;
