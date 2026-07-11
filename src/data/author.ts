// Site-wide author identity used for visible bylines and structured data.
export const AUTHOR_NAME = 'Dr Shiyghan Emmanuel Navti';

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
  name: AUTHOR_NAME,
  honorificPrefix: 'Dr',
  affiliation: {'@type': 'Organization', name: 'Tech Equity Cloud'},
  hasCredential: AUTHOR_CERTIFICATIONS.map((name) => ({
    '@type': 'EducationalOccupationalCredential',
    credentialCategory: 'certification',
    name: `Google Cloud ${name}`,
  })),
};

export const PUBLISHER_JSONLD = {
  '@type': 'Organization',
  name: 'Tech Equity Cloud',
  url: 'https://docs.radmodules.dev',
  logo: {
    '@type': 'ImageObject',
    url: 'https://docs.radmodules.dev/img/logo.svg',
  },
};
