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
      type: 'category',
      label: 'Associate Cloud Engineer',
      items: [
        { type: 'doc', id: 'ace/section1', label: 'Section 1' },
        { type: 'doc', id: 'ace/section2', label: 'Section 2' },
        { type: 'doc', id: 'ace/section3', label: 'Section 3' },
        { type: 'doc', id: 'ace/section4', label: 'Section 4' },
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Architect',
      items: [
        { type: 'doc', id: 'pca/section1', label: 'Section 1' },
        { type: 'doc', id: 'pca/section2', label: 'Section 2' },
        { type: 'doc', id: 'pca/section3', label: 'Section 3' },
        { type: 'doc', id: 'pca/section4', label: 'Section 4' },
        { type: 'doc', id: 'pca/section5', label: 'Section 5' },
        { type: 'doc', id: 'pca/section6', label: 'Section 6' },
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Developer',
      items: [
        { type: 'doc', id: 'pcd/section1', label: 'Section 1' },
        { type: 'doc', id: 'pcd/section2', label: 'Section 2' },
        { type: 'doc', id: 'pcd/section3', label: 'Section 3' },
        { type: 'doc', id: 'pcd/section4', label: 'Section 4' },
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud DevOps Engineer',
      items: [
        { type: 'doc', id: 'pde/section1', label: 'Section 1' },
        { type: 'doc', id: 'pde/section2', label: 'Section 2' },
        { type: 'doc', id: 'pde/section3', label: 'Section 3' },
        { type: 'doc', id: 'pde/section4', label: 'Section 4' },
        { type: 'doc', id: 'pde/section5', label: 'Section 5' },
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Security Engineer',
      items: [
        { type: 'doc', id: 'pse/section1', label: 'Section 1' },
        { type: 'doc', id: 'pse/section2', label: 'Section 2' },
        { type: 'doc', id: 'pse/section3', label: 'Section 3' },
        { type: 'doc', id: 'pse/section4', label: 'Section 4' },
        { type: 'doc', id: 'pse/section5', label: 'Section 5' },
      ],
    },
    {
      type: 'category',
      label: 'Enterprise Applications',
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
    {
      type: 'doc',
      id: 'workflows/getting-started',
      label: 'Getting Started',
    },
  ],
};

export default sidebars;
