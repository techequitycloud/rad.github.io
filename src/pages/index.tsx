import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/workflows/getting-started">
            Get Started →
          </Link>
        </div>
      </div>
    </header>
  );
}

function HomepageVideo() {
  return (
    <section>
      <div className="container" style={{textAlign: 'center', margin: '2rem auto'}}>
        <video
          controls
          style={{maxWidth: '50%', height: 'auto', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)'}}
          poster="https://storage.googleapis.com/rad-public-2b65/gcp/gcp_cert_accelerator.png"
        >
          <source src="https://storage.googleapis.com/rad-public-2b65/gcp/gcp_cert_accelerator.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`Hello from ${siteConfig.title}`}
      description="RAD Platform technical documentation for enterprise-grade infrastructure deployment across AWS, Azure, and Google Cloud Platform">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <HomepageVideo />
      </main>
    </Layout>
  );
}
