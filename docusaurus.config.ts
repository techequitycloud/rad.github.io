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
          // SEO settings for docs
          showLastUpdateTime: false,
          showLastUpdateAuthor: false,
        },
        sitemap: {
          changefreq: 'weekly',
          priority: 0.5,
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
    image: 'https://storage.googleapis.com/rad-public-2b65/gcp/gcp_cert_accelerator.png',
    metadata: [
      {name: 'keywords', content: 'RAD Platform, Google Cloud, GCP certifications, hands-on labs, cloud training, Associate, Professional'},
      {property: 'og:type', content: 'website'},
      {property: 'og:image', content: 'https://storage.googleapis.com/rad-public-2b65/gcp/gcp_cert_accelerator.png'},
      {property: 'og:image:width', content: '1200'},
      {property: 'og:image:height', content: '630'},
      {name: 'twitter:card', content: 'summary_large_image'},
      {name: 'twitter:image', content: 'https://storage.googleapis.com/rad-public-2b65/gcp/gcp_cert_accelerator.png'},
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
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'guidesSidebar',
          position: 'left',
          label: 'RAD Guide',
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
          sidebarId: 'certificationSidebar',
          position: 'left',
          label: 'Certification Guides',
        },
        {
          type: 'docSidebar',
          sidebarId: 'designSidebar',
          position: 'left',
          label: 'Design Principles',
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
      copyright: `<div style="text-align: center; margin-bottom: 8px;"><a href="https://github.com/techequitycloud/rad.github.io/issues" target="_blank" rel="noopener noreferrer">Report an Issue</a></div>© ${new Date().getFullYear()} Tech Equity Cloud. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
