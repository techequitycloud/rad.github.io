import React from 'react';
import Head from '@docusaurus/Head';

const SITE_URL = 'https://docs.radmodules.dev';

export default function Root({children}) {
  return (
    <>
      <Head>
        {/* Mobile browser chrome colour */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1b1b1d" />

        {/* Open Graph */}
        <meta property="og:site_name" content="RAD Platform Documentation" />
        <meta property="og:locale" content="en_US" />

        {/* Twitter */}
        <meta name="twitter:site" content="@techequitycloud" />
        <meta name="twitter:creator" content="@techequitycloud" />

        {/* Indexing */}
        <meta name="robots" content="index, follow" />
        <meta name="googlebot" content="index, follow" />
        <meta name="author" content="Tech Equity Cloud" />

        {/* Structured Data - Organization */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Tech Equity Cloud',
            url: SITE_URL,
            logo: `${SITE_URL}/img/logo.svg`,
            description: 'Google Cloud certification training and hands-on lab platform',
            sameAs: [
              'https://github.com/techequitycloud',
              'https://www.linkedin.com/company/techequitycloud',
              'https://twitter.com/techequitycloud'
            ]
          })}
        </script>

        {/* Structured Data - WebSite */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'RAD Platform Documentation',
            url: SITE_URL,
            description: 'Hands-on Google Cloud certification training — structured modules, labs, and certification guides from Associate to Professional level',
            publisher: {
              '@type': 'Organization',
              name: 'Tech Equity Cloud'
            },
            potentialAction: {
              '@type': 'SearchAction',
              target: `${SITE_URL}/search?q={search_term_string}`,
              'query-input': 'required name=search_term_string'
            }
          })}
        </script>
      </Head>
      {children}
    </>
  );
}
