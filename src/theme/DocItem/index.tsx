import React from 'react';
import DocItem from '@theme-original/DocItem';
import type DocItemType from '@theme/DocItem';
import type {WrapperProps} from '@docusaurus/types';
import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {AUTHOR_JSONLD, PUBLISHER_JSONLD} from '@site/src/data/author';
import DATE_PUBLISHED from '@site/src/data/datePublished';

type Props = WrapperProps<typeof DocItemType>;

// Emit page-type-appropriate JSON-LD for every doc: Course on certification
// guides (the site's core value proposition), TechArticle everywhere else.
// dateModified comes from git via showLastUpdateTime; datePublished from the
// generated first-commit map (scripts/generate-date-published.mjs).
export default function DocItemWrapper(props: Props): React.JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  const {metadata} = props.content;
  const {title, description, permalink} = metadata;
  const ts = metadata.lastUpdatedAt;
  // lastUpdatedAt was seconds in Docusaurus v2, milliseconds in v3 — accept either.
  const dateModified = ts
    ? new Date(ts > 1e12 ? ts : ts * 1000).toISOString()
    : undefined;
  const datePublished = DATE_PUBLISHED[permalink];
  const url = `${siteConfig.url}${permalink}`;
  // Google requires `image` for Article-family rich-result eligibility; the
  // 1200x630 social-preview asset doubles as the fallback page image.
  const image = `${siteConfig.url}/img/rad-social-preview.png`;

  const schema = permalink.startsWith('/docs/certification/')
    ? {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: title,
        description,
        url,
        image,
        provider: PUBLISHER_JSONLD,
        author: AUTHOR_JSONLD,
        educationalLevel: title.includes('Associate')
          ? 'Associate'
          : 'Professional',
        hasCourseInstance: {
          '@type': 'CourseInstance',
          courseMode: 'Online',
        },
        ...(datePublished && {datePublished}),
        ...(dateModified && {dateModified}),
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: title,
        description,
        url,
        image,
        mainEntityOfPage: url,
        author: AUTHOR_JSONLD,
        publisher: PUBLISHER_JSONLD,
        ...(datePublished && {datePublished}),
        ...(dateModified && {dateModified}),
      };

  return (
    <>
      <Head>
        <script type="application/ld+json">{JSON.stringify(schema)}</script>
      </Head>
      <DocItem {...props} />
    </>
  );
}
