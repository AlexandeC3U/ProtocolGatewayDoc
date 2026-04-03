// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Conduit Edge',
  tagline: 'Industrial IoT platform — Protocol Gateway · Data Ingestion · Gateway Core · Web UI',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://AlexandeC3U.github.io',
  baseUrl: '/',

  organizationName: 'AlexandeC3U',
  projectName: 'ConduitEdge',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    format: 'detect',
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: './docs',
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
        title: 'Conduit Edge',
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
              { label: 'Architecture', to: '/docs/ARCHITECTURE' },
              { label: 'Infrastructure', to: '/docs/infrastructure' },
            ],
          },
          {
            title: 'Services',
            items: [
              { label: 'Protocol Gateway', to: '/docs/services/protocol-gateway' },
              { label: 'Gateway Core', to: '/docs/services/gateway-core' },
              { label: 'Data Ingestion', to: '/docs/services/data-ingestion' },
              { label: 'Web UI', to: '/docs/services/web-ui' },
            ],
          },
        ],
        copyright: `Conduit Edge Documentation · Updated April 2026`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['go', 'yaml', 'bash', 'docker'],
      },
    }),
};

export default config;
