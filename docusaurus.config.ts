import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'RAD Platform',
  tagline: 'From theoretical concepts to hands-on mastery for Google Cloud certifications',
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

  // Custom fields for additional metadata
  customFields: {
    metadata: [
      {name: 'keywords', content: 'RAD Platform, infrastructure deployment, Terraform, multi-cloud, AWS, Azure, GCP, DevOps, infrastructure as code'},
      {name: 'description', content: 'RAD Platform technical documentation for enterprise-grade infrastructure deployment across AWS, Azure, and Google Cloud Platform'},
      {name: 'og:type', content: 'website'},
      {name: 'twitter:card', content: 'summary_large_image'},
    ],
  },

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
    // Social card image for Open Graph and Twitter
    image: 'https://storage.googleapis.com/rad-public-2b65/gcp/gcp_cert_accelerator.png',
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
          href: 'https://techequity.cloud',
          label: 'RAD Console',
          position: 'left',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      ],
    },
    footer: {
      style: 'light',
      copyright: `© ${new Date().getFullYear()} Tech Equity Cloud. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
