import React from 'react';
import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useLocation} from '@docusaurus/router';

// Replaces the theme-classic BreadcrumbList generator. The default filters
// out link-less sidebar categories and never includes Home, which on this
// site (categories have no index pages) collapses every trail to a single
// item whose name is the category label but whose URL is the current page —
// invalid for Google's breadcrumb rich result. Google requires a URL on
// every item except the last, so: emit Home, keep only ancestors that have
// real URLs, and close with the current page under its own URL.
type Breadcrumb = {label: string; href?: string};

export default function DocBreadcrumbsStructuredData(props: {
  breadcrumbs: Breadcrumb[];
}): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const {pathname} = useLocation();
  const absolute = (path: string) =>
    `${siteConfig.url}${path === '/' ? '' : path}` || siteConfig.url;

  const ancestors = props.breadcrumbs.slice(0, -1).filter((b) => b.href);
  const active = props.breadcrumbs[props.breadcrumbs.length - 1];

  const itemListElement = [
    {
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: `${siteConfig.url}/`,
    },
    ...ancestors.map((b, index) => ({
      '@type': 'ListItem',
      position: index + 2,
      name: b.label,
      item: absolute(b.href!),
    })),
    ...(active
      ? [
          {
            '@type': 'ListItem',
            position: ancestors.length + 2,
            name: active.label,
            item: absolute(active.href ?? pathname),
          },
        ]
      : []),
  ];

  return (
    <Head>
      <script type="application/ld+json">
        {JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement,
        })}
      </script>
    </Head>
  );
}
