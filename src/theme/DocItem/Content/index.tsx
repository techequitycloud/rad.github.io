import React from 'react';
import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import type {WrapperProps} from '@docusaurus/types';
import Link from '@docusaurus/Link';
import {AUTHOR_NAME, AUTHOR_CERT_CODES} from '@site/src/data/author';

type Props = WrapperProps<typeof ContentType>;

// Visible authorship (E-E-A-T): a compact byline above every doc's content,
// linked to the /author profile page so the named author is verifiable.
// The matching machine-readable author lives in the DocItem JSON-LD wrapper.
export default function ContentWrapper(props: Props): React.JSX.Element {
  return (
    <>
      <p className="doc-byline">
        By{' '}
        <Link to="/author" rel="author">
          <strong>{AUTHOR_NAME}</strong>
        </Link>{' '}
        · Google Cloud certified: {AUTHOR_CERT_CODES.join(' · ')}
      </p>
      <Content {...props} />
    </>
  );
}
