import React from 'react';
import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import type {WrapperProps} from '@docusaurus/types';
import Link from '@docusaurus/Link';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {AUTHOR_NAME, AUTHOR_CERT_CODES} from '@site/src/data/author';
import {
  AI_HUB,
  certCodeFromPermalink,
  CERT_HUBS,
  labsForCert,
  trackForDocPermalink,
} from '@site/src/data/certMap';

type Props = WrapperProps<typeof ContentType>;

const MAX_RELATED_LABS = 8;

// Spoke → hub: topical link from a lab/module page to the certification
// track(s) it teaches (and the AI hub for LLM-stack apps), replacing the old
// one-size-fits-all path where every app page led to the ACE guide.
function CertTrackChip({permalink}: {permalink: string}) {
  const track = trackForDocPermalink(permalink);
  if (!track || (track.certs.length === 0 && !track.app.ai)) return null;
  const links = [
    ...track.certs.map((cert) => ({
      label: `${cert.name} (${cert.code})`,
      path: cert.path,
    })),
    ...(track.app.ai ? [{label: AI_HUB.name, path: AI_HUB.path}] : []),
  ];
  return (
    <p className="doc-cert-track">
      Certification track:{' '}
      {links.map((link, i) => (
        <React.Fragment key={link.path}>
          {i > 0 && ' · '}
          <Link to={link.path}>{link.label}</Link>
        </React.Fragment>
      ))}
    </p>
  );
}

// Hub → spoke: every certification page closes with the labs that practice
// its exam domains, sourced from the same mapping.
function RelatedLabs({permalink}: {permalink: string}) {
  const code = certCodeFromPermalink(permalink);
  if (!code) return null;
  const labs = labsForCert(code);
  if (labs.length === 0) return null;
  const shown = labs.slice(0, MAX_RELATED_LABS);
  return (
    <div className="doc-related-labs">
      <strong>Practice the {code} domains hands-on:</strong>{' '}
      {shown.map((lab, i) => (
        <React.Fragment key={lab.path}>
          {i > 0 && ' · '}
          <Link to={lab.path}>{lab.name}</Link>
        </React.Fragment>
      ))}
      {labs.length > shown.length && <> · and {labs.length - shown.length} more</>}
      {' — '}
      <Link to="/docs/labs/Services_GCP">view the full lab map →</Link>
    </div>
  );
}

// Visible authorship (E-E-A-T): a compact byline above every doc's content,
// linked to the /author profile page so the named author is verifiable.
// The matching machine-readable author lives in the DocItem JSON-LD wrapper.
export default function ContentWrapper(props: Props): React.JSX.Element {
  const {metadata} = useDoc();
  const {permalink} = metadata;
  return (
    <>
      <p className="doc-byline">
        By{' '}
        <Link to="/author" rel="author">
          <strong>{AUTHOR_NAME}</strong>
        </Link>{' '}
        · Google Cloud certified: {AUTHOR_CERT_CODES.join(' · ')}
      </p>
      <CertTrackChip permalink={permalink} />
      <Content {...props} />
      <RelatedLabs permalink={permalink} />
    </>
  );
}
