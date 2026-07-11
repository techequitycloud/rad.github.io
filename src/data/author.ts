// Site-wide author identity used for visible bylines and structured data.
const SITE_URL = 'https://docs.radmodules.dev';

export const AUTHOR_NAME = 'Dr Shiyghan Emmanuel Navti';

// Stable @id URIs so every page's JSON-LD references the same graph nodes
// instead of emitting anonymous duplicates Google can't consolidate.
export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const AUTHOR_ID = `${SITE_URL}/author#person`;
export const AUTHOR_URL = `${SITE_URL}/author`;

export const AUTHOR_CERTIFICATIONS = [
  'Associate Cloud Engineer (ACE)',
  'Professional Cloud Architect (PCA)',
  'Professional Cloud Developer (PCD)',
  'Professional Cloud DevOps Engineer (PDE)',
  'Professional Cloud Security Engineer (PSE)',
  'Cloud Digital Leader (CDL)',
];

export const AUTHOR_CERT_CODES = ['ACE', 'PCA', 'PCD', 'PDE', 'PSE', 'CDL'];

export const AUTHOR_JSONLD = {
  '@type': 'Person',
  '@id': AUTHOR_ID,
  name: AUTHOR_NAME,
  honorificPrefix: 'Dr',
  url: AUTHOR_URL,
  affiliation: {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: 'Tech Equity Cloud',
  },
  hasCredential: AUTHOR_CERTIFICATIONS.map((name) => ({
    '@type': 'EducationalOccupationalCredential',
    credentialCategory: 'certification',
    name: `Google Cloud ${name}`,
  })),
};

export const PUBLISHER_JSONLD = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'Tech Equity Cloud',
  url: SITE_URL,
  logo: {
    '@type': 'ImageObject',
    url: `${SITE_URL}/img/logo.svg`,
    width: 200,
    height: 200,
  },
};
