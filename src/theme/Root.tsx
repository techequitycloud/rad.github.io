import React from 'react';
import Head from '@docusaurus/Head';

export default function Root({children}) {
  return (
    <>
      <Head>
        {/* Open Graph / Facebook */}
        <meta property="og:site_name" content="RAD Platform Documentation" />
        <meta property="og:locale" content="en_US" />
        
        {/* Twitter */}
        <meta name="twitter:site" content="@techequitycloud" />
        <meta name="twitter:creator" content="@techequitycloud" />
        
        {/* Additional SEO */}
        <meta name="robots" content="index, follow" />
        <meta name="googlebot" content="index, follow" />
        <meta name="author" content="Tech Equity Cloud" />
        
        {/* Canonical URL is handled by Docusaurus automatically */}
        
        {/* Structured Data - Organization */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Tech Equity Cloud',
            url: 'https://techequitycloud.github.io/rad.github.io/',
            logo: 'https://techequitycloud.github.io/rad.github.io/img/logo.svg',
            description: 'Enterprise-grade infrastructure deployment platform',
            sameAs: [
              'https://github.com/techequitycloud'
            ]
          })}
        </script>
        
        {/* Structured Data - WebSite */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'RAD Platform Documentation',
            url: 'https://techequitycloud.github.io/rad.github.io/',
            description: 'Technical documentation for RAD Platform - enterprise-grade infrastructure deployment across AWS, Azure, and Google Cloud Platform',
            publisher: {
              '@type': 'Organization',
              name: 'Tech Equity Cloud'
            }
          })}
        </script>
        
        {/* Structured Data - TechArticle for documentation */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: 'RAD Platform Technical Documentation',
            description: 'Comprehensive technical documentation for deploying multi-cloud infrastructure using RAD Platform',
            author: {
              '@type': 'Organization',
              name: 'Tech Equity Cloud'
            },
            publisher: {
              '@type': 'Organization',
              name: 'Tech Equity Cloud',
              logo: {
                '@type': 'ImageObject',
                url: 'https://techequitycloud.github.io/rad.github.io/img/logo.svg'
              }
            },
            datePublished: '2024-01-01',
            dateModified: new Date().toISOString().split('T')[0]
          })}
        </script>
      </Head>
      {children}
    </>
  );
}
