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
      label: 'Getting Started',
      items: [
        {
          type: 'doc',
          id: 'workflows/rad-benefits',
          label: 'RAD Benefits',
        },
        {
          type: 'doc',
          id: 'workflows/using-rad',
          label: 'Using RAD',
        },
      ],
    },
    {
      type: 'category',
      label: 'Certification Guides',
      items: [
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
      ],
    },
    {
      type: 'category',
      label: 'Module Guides',
      items: [
        {
          type: 'category',
          label: 'Application',
          items: [
            { type: 'doc', id: 'modules/App_CloudRun/App_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/App_GKE/App_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Cyclos',
          items: [
            { type: 'doc', id: 'modules/Cyclos_CloudRun/Cyclos_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Cyclos_GKE/Cyclos_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Directus',
          items: [
            { type: 'doc', id: 'modules/Directus_CloudRun/Directus_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Directus_GKE/Directus_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Django',
          items: [
            { type: 'doc', id: 'modules/Django_CloudRun/Django_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Django_GKE/Django_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Ghost',
          items: [
            { type: 'doc', id: 'modules/Ghost_CloudRun/Ghost_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Ghost_GKE/Ghost_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Moodle',
          items: [
            { type: 'doc', id: 'modules/Moodle_CloudRun/Moodle_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Moodle_GKE/Moodle_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'N8N',
          items: [
            { type: 'doc', id: 'modules/N8N_CloudRun/N8N_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/N8N_GKE/N8N_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'N8N AI',
          items: [
            { type: 'doc', id: 'modules/N8N_AI_CloudRun/N8N_AI_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/N8N_AI_GKE/N8N_AI_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Odoo',
          items: [
            { type: 'doc', id: 'modules/Odoo_CloudRun/Odoo_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Odoo_GKE/Odoo_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'OpenEMR',
          items: [
            { type: 'doc', id: 'modules/OpenEMR_CloudRun/OpenEMR_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/OpenEMR_GKE/OpenEMR_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Sample',
          items: [
            { type: 'doc', id: 'modules/Sample_CloudRun/Sample_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Sample_GKE/Sample_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Strapi',
          items: [
            { type: 'doc', id: 'modules/Strapi_CloudRun/Strapi_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Strapi_GKE/Strapi_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Wiki.js',
          items: [
            { type: 'doc', id: 'modules/Wikijs_CloudRun/Wikijs_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Wikijs_GKE/Wikijs_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Wordpress',
          items: [
            { type: 'doc', id: 'modules/Wordpress_CloudRun/Wordpress_CloudRun_Guide', label: 'Cloud Run' },
            { type: 'doc', id: 'modules/Wordpress_GKE/Wordpress_GKE_Guide', label: 'GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Foundation',
          items: [
            { type: 'doc', id: 'modules/GCP_Services/GCP_Services_Guide', label: 'GCP Services' },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Platform Guides',
      items: [
        {
          type: 'category',
          label: 'Feature Guides',
          items: [
            { type: 'doc', id: 'features/user', label: 'User' },
            { type: 'doc', id: 'features/partner', label: 'Partner' },
            { type: 'doc', id: 'features/agent', label: 'Agent' },
            { type: 'doc', id: 'features/finance', label: 'Finance' },
            { type: 'doc', id: 'features/support', label: 'Support' },
            { type: 'doc', id: 'features/admin', label: 'Admin' },
          ],
        },
        {
          type: 'category',
          label: 'Workflow Guides',
          items: [
            { type: 'doc', id: 'workflows/user', label: 'User' },
            { type: 'doc', id: 'workflows/partner', label: 'Partner' },
            { type: 'doc', id: 'workflows/agent', label: 'Agent' },
            { type: 'doc', id: 'workflows/finance', label: 'Finance' },
            { type: 'doc', id: 'workflows/support', label: 'Support' },
            { type: 'doc', id: 'workflows/admin', label: 'Admin' },
          ],
        },
        {
          type: 'category',
          label: 'User Guides',
          items: [
            { type: 'doc', id: 'guides/user', label: 'User' },
            { type: 'doc', id: 'guides/partner', label: 'Partner' },
            { type: 'doc', id: 'guides/agent', label: 'Agent' },
            { type: 'doc', id: 'guides/finance', label: 'Finance' },
            { type: 'doc', id: 'guides/support', label: 'Support' },
            { type: 'doc', id: 'guides/admin', label: 'Admin' },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Platform Demos',
      items: [
        { type: 'doc', id: 'demos/user', label: 'User' },
        { type: 'doc', id: 'demos/partner', label: 'Partner' },
        { type: 'doc', id: 'demos/support', label: 'Support' },
        { type: 'doc', id: 'demos/agent', label: 'Agent' },
        { type: 'doc', id: 'demos/finance', label: 'Finance' },
        { type: 'doc', id: 'demos/admin', label: 'Admin' },
      ],
    },
  ],
};

export default sidebars;
