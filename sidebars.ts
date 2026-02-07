import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'doc',
      id: 'workflows/getting-started',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        { type: 'doc', id: 'guides/user', label: 'Users' },
        { type: 'doc', id: 'guides/partner', label: 'Partner' },
        { type: 'doc', id: 'guides/agent', label: 'Agent' },
        { type: 'doc', id: 'guides/support', label: 'Support' },
        { type: 'doc', id: 'guides/finance', label: 'Finance' },
        { type: 'doc', id: 'guides/admin', label: 'Admin' },
      ],
    },
    {
      type: 'category',
      label: 'Workflows',
      items: [
        { type: 'doc', id: 'workflows/user', label: 'Users' },
        { type: 'doc', id: 'workflows/partner', label: 'Partner' },
        { type: 'doc', id: 'workflows/agent', label: 'Agent' },
        { type: 'doc', id: 'workflows/support', label: 'Support' },
        { type: 'doc', id: 'workflows/finance', label: 'Finance' },
        { type: 'doc', id: 'workflows/admin', label: 'Admin' },
      ],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        { type: 'doc', id: 'features/user', label: 'Users' },
        { type: 'doc', id: 'features/partner', label: 'Partner' },
        { type: 'doc', id: 'features/agent', label: 'Agent' },
        { type: 'doc', id: 'features/support', label: 'Support' },
        { type: 'doc', id: 'features/finance', label: 'Finance' },
        { type: 'doc', id: 'features/admin', label: 'Admin' },
      ],
    },
    {
      type: 'category',
      label: 'Demos',
      items: [
        { type: 'doc', id: 'demos/user', label: 'User' },
        { type: 'doc', id: 'demos/partner', label: 'Partner' },
        { type: 'doc', id: 'demos/agent', label: 'Agent' },
        { type: 'doc', id: 'demos/support', label: 'Support' },
        { type: 'doc', id: 'demos/finance', label: 'Finance' },
        { type: 'doc', id: 'demos/admin', label: 'Admin' },
      ],
    },
    {
      type: 'category',
      label: 'Applications',
      items: [
        { type: 'doc', id: 'applications/gcp-services', label: 'GCP Services' },
        { type: 'doc', id: 'applications/cloud-run-app', label: 'Cloud Run App' },
        { type: 'doc', id: 'applications/cyclos', label: 'Cyclos' },
        { type: 'doc', id: 'applications/directus', label: 'Directus' },
        { type: 'doc', id: 'applications/django', label: 'Django' },
        { type: 'doc', id: 'applications/ghost', label: 'Ghost' },
        { type: 'doc', id: 'applications/moodle', label: 'Moodle' },
        { type: 'doc', id: 'applications/n8n', label: 'N8N' },
        { type: 'doc', id: 'applications/n8n-ai', label: 'N8N AI' },
        { type: 'doc', id: 'applications/odoo', label: 'Odoo' },
        { type: 'doc', id: 'applications/openemr', label: 'OpenEMR' },
        { type: 'doc', id: 'applications/sample', label: 'Sample' },
        { type: 'doc', id: 'applications/strapi', label: 'Strapi' },
        { type: 'doc', id: 'applications/wiki-js', label: 'Wiki.js' },
        { type: 'doc', id: 'applications/wordpress', label: 'Wordpress' },
      ],
    },
  ],
};

export default sidebars;
