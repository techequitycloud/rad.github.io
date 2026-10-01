import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import {copyFile, access} from 'node:fs/promises';
import path from 'node:path';

const config: Config = {
  title: 'RAD Platform',
  tagline: 'Hands-on Google Cloud certification training — from Associate to Professional',
  favicon: 'img/favicon.ico',

  // Brand typography, matching techequity.cloud: Fraunces display, Inter body, JetBrains Mono.
  stylesheets: [
    { href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=JetBrains+Mono:wght@400;500&display=swap',
      type: 'text/css' },
  ],

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

  // English is the source; French is a translation. A page with no French
  // version falls back to its English one, so French can be added page by page
  // (Phase 1: the RAD guides, design pages and site pages).
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'fr'],
    localeConfigs: {
      en: {label: 'English', htmlLang: 'en'},
      fr: {label: 'Français', htmlLang: 'fr'},
    },
  },

  // Consent-gated analytics. Not @docusaurus/plugin-google-gtag: that loads
  // gtag.js on first paint with no consent gate, which would contradict the
  // privacy policy covering this site and the two marketing sites.
  clientModules: ['./src/clientModules/analytics.js'],

  plugins: [
    // The section landing pages (/docs/labs, /docs/modules, /docs/certification)
    // build to <section>.html, but each section is also a FOLDER of pages, and
    // GitHub Pages gives a folder precedence: /docs/labs redirects to /docs/labs/
    // and looks for labs/index.html (the reason static/docs/index.html exists).
    // Copy each landing page into its folder so both forms serve it. Runs once
    // per locale (outDir is build/ or build/fr/).
    () => ({
      name: 'section-index-pages',
      async postBuild({outDir}) {
        for (const section of ['labs', 'modules', 'certification']) {
          const page = path.join(outDir, 'docs', `${section}.html`);
          try {
            await access(page);
          } catch {
            continue;
          }
          await copyFile(page, path.join(outDir, 'docs', section, 'index.html'));
        }
      },
    }),
  ],

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
    announcementBar: {
      id: 'live-sessions-2026-09',
      // The bar is not covered by the theme's translation files, so it picks its
      // text from the locale being built (Docusaurus builds each locale
      // separately and sets DOCUSAURUS_CURRENT_LOCALE for each).
      content:
        process.env.DOCUSAURUS_CURRENT_LOCALE === 'fr'
          ? 'Sessions Google Cloud pratiques en direct &mdash; déployez un module de bout en bout ou ' +
            'préparez une certification lors d’un lab en direct. Soixante minutes, participation gratuite. ' +
            '<a target="_blank" rel="noopener" href="https://ghost.radbusiness.dev/sessions/' +
            '?utm_source=docs&utm_medium=announcement&utm_campaign=live-sessions"><b>S’inscrire</b></a>'
          : 'Live, hands-on Google Cloud sessions &mdash; deploy a module end to end, or work a ' +
            'certification as a live lab. Sixty minutes, free to attend. ' +
            '<a target="_blank" rel="noopener" href="https://ghost.radbusiness.dev/sessions/' +
            '?utm_source=docs&utm_medium=announcement&utm_campaign=live-sessions"><b>Register</b></a>',
      backgroundColor: '#1d4ed8',
      textColor: '#ffffff',
      isCloseable: true,
    },
    navbar: {
      title: 'RAD Platform',
      logo: {
        alt: 'Tech Equity',
        src: 'img/techequity-logo.png',
        srcDark: 'img/techequity-logo-dark.png',
        // Explicit dimensions reserve layout space before CSS loads (CLS).
        // Infima forces height:2rem (32px) on the navbar logo, so width must be what the
        // 442x107 source implies at that height (4.13:1 -> 132) or the lockup is squashed.
        width: 132,
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
        {
          type: 'localeDropdown',
          position: 'right',
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
