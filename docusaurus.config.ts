import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'RAD Platform',
  tagline: 'Hands-on Google Cloud certification training — from Associate to Professional',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.radmodules.dev',
  baseUrl: '/',

  organizationName: 'techequitycloud',
  projectName: 'rad.github.io',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

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
          // Surface git-derived freshness signals to users and crawlers
          // (requires full git history at build time — see fetch-depth in deploy.yml).
          showLastUpdateTime: true,
          showLastUpdateAuthor: false,
        },
        sitemap: {
          // Google ignores changefreq/priority; lastmod (from git history) is
          // the one field it actually uses as a recrawl signal.
          lastmod: 'date',
          changefreq: null,
          priority: null,
          ignorePatterns: ['/tags/**'],
          filename: 'sitemap.xml',
        },
        blog: false, // Disable blog
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/rad-social-preview.png',
    metadata: [
      {name: 'description', content: 'Hands-on Google Cloud certification training — structured modules, labs, and certification guides from Associate to Professional level.'},
      {name: 'keywords', content: 'RAD Platform, Google Cloud, GCP certifications, hands-on labs, cloud training, Associate, Professional'},
      {property: 'og:type', content: 'website'},
      {property: 'og:image:width', content: '1200'},
      {property: 'og:image:height', content: '630'},
      {name: 'twitter:card', content: 'summary_large_image'},
    ],
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'RAD Platform',
      logo: {
        alt: 'RAD Platform Logo',
        src: 'img/logo.svg',
        // Explicit dimensions reserve layout space before CSS loads (CLS).
        width: 32,
        height: 32,
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'certificationSidebar',
          position: 'left',
          label: 'Certification Guides',
        },
        {
          type: 'docSidebar',
          sidebarId: 'modulesSidebar',
          position: 'left',
          label: 'Module Guides',
        },
        {
          type: 'docSidebar',
          sidebarId: 'labsSidebar',
          position: 'left',
          label: 'Module Labs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'designSidebar',
          position: 'left',
          label: 'Design Principles',
        },
        {
          type: 'docSidebar',
          sidebarId: 'guidesSidebar',
          position: 'left',
          label: 'RAD Guide',
        },
        {
          href: 'https://radmodules.dev',
          label: 'RAD Console',
          position: 'left',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [
        {
          title: 'Tech Equity Cloud',
          items: [
            {label: 'About', to: '/about'},
            {label: 'Contact', to: '/contact'},
            {label: 'RAD Console', href: 'https://radmodules.dev'},
          ],
        },
        {
          title: 'Legal',
          items: [
            {label: 'Privacy Policy', to: '/privacy'},
            {label: 'Terms of Use', to: '/terms'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/techequitycloud'},
            {label: 'Report an Issue', href: 'https://github.com/techequitycloud/rad.github.io/issues'},
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
