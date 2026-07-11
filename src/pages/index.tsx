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
        <Heading as="h1" className={clsx('hero__title', styles.heroTitle)}>
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p className={styles.heroIntro}>
          RAD (Rapid Application Deployment) by Tech Equity Cloud deploys real,
          pre-configured infrastructure into your own Google Cloud project — so
          every exam objective maps to a resource you deployed, verified, and
          operated yourself.
        </p>
        <p className={styles.heroIntroSecondary}>
          Seven certification study paths map every official exam section to
          deployment labs drawn from 100+ open-source application modules on
          Cloud Run and GKE Autopilot. Every guide is written by one author
          holding six Google Cloud certifications, from the same infrastructure
          code the platform actually runs — deploy it, inspect it, break it,
          and fix it before you sit the exam.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/guides/using-rad">
            Get Started →
          </Link>
        </div>
      </div>
    </header>
  );
}

const CERTIFICATIONS = [
  {
    code: 'ACE',
    name: 'Associate Cloud Engineer',
    level: 'Associate',
    blurb: 'Deploy, monitor, and operate solutions on Google Cloud.',
  },
  {
    code: 'PCA',
    name: 'Professional Cloud Architect',
    level: 'Professional',
    blurb: 'Design, plan, and manage secure cloud solution architecture.',
  },
  {
    code: 'PCD',
    name: 'Professional Cloud Developer',
    level: 'Professional',
    blurb: 'Build and deploy scalable cloud-native applications.',
  },
  {
    code: 'PCDE',
    name: 'Professional Cloud Database Engineer',
    level: 'Professional',
    blurb: 'Design, manage, and migrate database solutions.',
  },
  {
    code: 'PCNE',
    name: 'Professional Cloud Network Engineer',
    level: 'Professional',
    blurb: 'Implement and manage VPC, hybrid, and multicloud networks.',
  },
  {
    code: 'PDE',
    name: 'Professional Cloud DevOps Engineer',
    level: 'Professional',
    blurb: 'Apply SRE, CI/CD, and observability practices at scale.',
  },
  {
    code: 'PSE',
    name: 'Professional Cloud Security Engineer',
    level: 'Professional',
    blurb: 'Configure access, boundary protection, and data security.',
  },
];

function CertificationPaths() {
  return (
    <section className={styles.certSection}>
      <div className="container">
        <Heading as="h2" className="text--center">
          Certification Study Paths
        </Heading>
        <p className={clsx('text--center', styles.sectionLead)}>
          Each guide maps the official exam sections to RAD deployment labs, so
          you study every domain hands-on — from Associate to Professional level.
        </p>
        <div className="row">
          {CERTIFICATIONS.map((cert) => (
            <div key={cert.code} className={clsx('col col--3', styles.certCol)}>
              <Link
                to={`/docs/certification/${cert.code}_Certification_Guide`}
                className={styles.certCard}>
                <span className={styles.certLevel}>{cert.level}</span>
                <Heading as="h3" className={styles.certTitle}>
                  {cert.name} ({cert.code})
                </Heading>
                <p className={styles.certBlurb}>{cert.blurb}</p>
                <span className={styles.certCta}>View lab map →</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PlatformStats() {
  const stats = [
    {value: '7', label: 'Google Cloud certifications covered', to: '/docs/certification/ACE_Certification_Guide'},
    {value: '111', label: 'hands-on deployment labs', to: '/docs/labs/Services_GCP'},
    {value: '159', label: 'module configuration guides', to: '/docs/modules/Services_GCP'},
  ];
  return (
    <section className={styles.statsSection}>
      <div className="container">
        <div className="row">
          {stats.map((stat) => (
            <div key={stat.label} className={clsx('col col--4', 'text--center')}>
              <Link to={stat.to} className={styles.statCard}>
                <span className={styles.statValue}>{stat.value}</span>
                <span className={styles.statLabel}>{stat.label}</span>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="Google Cloud Certification Prep"
      description="Master Google Cloud certifications with RAD Platform — structured learning modules, hands-on labs, and certification guides from Associate to Professional.">
      <HomepageHeader />
      <main>
        <PlatformStats />
        <CertificationPaths />
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
