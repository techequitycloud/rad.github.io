import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  /** The illustration's own accessible title (its SVG <title>), kept distinct from the heading. */
  svgTitle: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'> & {title?: string}>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: translate({id: 'homepage.features.certificationAligned.title', message: 'Certification Aligned'}),
    Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
    svgTitle: translate({id: 'homepage.features.certificationAligned.svgTitle', message: 'Certification aligned learning paths'}),
    description: (
      <>
        {translate({
          id: 'homepage.features.certificationAligned.description',
          message:
            'Deploy pre-configured industry solutions to Google Cloud platform and map infrastructure components to specific Google Cloud associate and professional certification exams.',
        })}
      </>
    ),
  },
  {
    title: translate({id: 'homepage.features.industrySolutions.title', message: 'Industry Solutions'}),
    Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
    svgTitle: translate({id: 'homepage.features.industrySolutions.svgTitle', message: 'Real-world industry solutions'}),
    description: (
      <>
        {translate({
          id: 'homepage.features.industrySolutions.description',
          message:
            'Go beyond certification by developing in-depth expertise on architecture principles and implementation options for real world industry solutions.',
        })}
      </>
    ),
  },
  {
    title: translate({id: 'homepage.features.theoryToMastery.title', message: 'Theory to Mastery'}),
    Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
    svgTitle: translate({id: 'homepage.features.theoryToMastery.svgTitle', message: 'Hands-on cloud engineering practice'}),
    description: (
      <>
        {translate({
          id: 'homepage.features.theoryToMastery.description',
          message:
            'Build hands-on experience by implementing the competencies required for Cloud Architect, Developer, Security, Database, Networking and DevOps Engineer certifications.',
        })}
      </>
    ),
  },
];

function Feature({title, svgTitle, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" aria-label={title} title={svgTitle} />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <Heading as="h2" className="text--center margin-bottom--lg">
          {translate({id: 'homepage.features.title', message: 'Platform Capabilities'})}
        </Heading>
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
