import React from 'react';
import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import type {WrapperProps} from '@docusaurus/types';
import {AUTHOR_NAME, AUTHOR_CERT_CODES} from '@site/src/data/author';

type Props = WrapperProps<typeof ContentType>;

// Visible authorship (E-E-A-T): a compact byline above every doc's content.
// The matching machine-readable author lives in the DocItem JSON-LD wrapper.
export default function ContentWrapper(props: Props): React.JSX.Element {
  return (
    <>
      <p className="doc-byline">
        By <strong>{AUTHOR_NAME}</strong> · Google Cloud certified:{' '}
        {AUTHOR_CERT_CODES.join(' · ')}
      </p>
      <Content {...props} />
    </>
  );
}
