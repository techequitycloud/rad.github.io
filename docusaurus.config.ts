import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'RAD Platform',
  tagline: 'Enterprise-grade infrastructure deployment platform for technical teams and partners',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://techequitycloud.github.io',
  baseUrl: '/rad.github.io/',

  organizationName: 'techequitycloud',
  projectName: 'rad.github.io',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
        },
        blog: false, // Disable blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/rad-social-card.jpg',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'RAD Platform',
      logo: {
        alt: 'RAD Platform Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/techequitycloud/rad.github.io',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
            {
              label: 'Administrator Guide',
              to: '/docs/guides/admin',
            },
            {
              label: 'Partner Guide',
              to: '/docs/guides/partner',
            },
            {
              label: 'User Guide',
              to: '/docs/guides/user',
            },
          ],
        },
        {
          title: 'Features',
          items: [
            {
              label: 'Deployments',
              to: '/docs/features/deployments',
            },
            {
              label: 'Modules',
              to: '/docs/features/modules',
            },
            {
              label: 'Billing & Credits',
              to: '/docs/billing/credits',
            },
            {
              label: 'Administration',
              to: '/docs/admin/settings',
            },
          ],
        },
        {
          title: 'Resources',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/techequitycloud/rad.github.io',
            },
            {
              label: 'Support',
              to: '/docs/support',
            },
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Tech Equity Cloud. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
