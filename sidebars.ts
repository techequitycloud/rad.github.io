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
          label: 'Platform Modules',
          items: [
            { type: 'doc', id: 'modules/AKS_GKE/AKS_GKE', label: 'AKS GKE' },
            { type: 'doc', id: 'modules/Bank_GKE/Bank_GKE', label: 'Bank GKE' },
            { type: 'doc', id: 'modules/EKS_GKE/EKS_GKE', label: 'EKS GKE' },
            { type: 'doc', id: 'modules/Istio_GKE/Istio_GKE', label: 'Istio GKE' },
            { type: 'doc', id: 'modules/MC_Bank_GKE/MC_Bank_GKE', label: 'MC Bank GKE' },
          ],
        },
        {
          type: 'category',
          label: 'Partner Modules',
          items: [
            {
              type: 'category',
              label: 'Activepieces',
              items: [
                { type: 'doc', id: 'modules/Activepieces_CloudRun/Activepieces_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Activepieces_GKE/Activepieces_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Activepieces_Common/Activepieces_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Application',
              items: [
                { type: 'doc', id: 'modules/App_CloudRun/App_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/App_GKE/App_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/App_Common/App_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Cyclos',
              items: [
                { type: 'doc', id: 'modules/Cyclos_CloudRun/Cyclos_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Cyclos_GKE/Cyclos_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Cyclos_Common/Cyclos_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Directus',
              items: [
                { type: 'doc', id: 'modules/Directus_CloudRun/Directus_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Directus_GKE/Directus_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Directus_Common/Directus_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Django',
              items: [
                { type: 'doc', id: 'modules/Django_CloudRun/Django_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Django_GKE/Django_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Django_Common/Django_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Elasticsearch',
              items: [
                { type: 'doc', id: 'modules/Elasticsearch_GKE/Elasticsearch_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Flowise',
              items: [
                { type: 'doc', id: 'modules/Flowise_CloudRun/Flowise_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Flowise_GKE/Flowise_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Flowise_Common/Flowise_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Ghost',
              items: [
                { type: 'doc', id: 'modules/Ghost_CloudRun/Ghost_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Ghost_GKE/Ghost_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Ghost_Common/Ghost_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Kestra',
              items: [
                { type: 'doc', id: 'modules/Kestra_CloudRun/Kestra_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Kestra_GKE/Kestra_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Kestra_Common/Kestra_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Moodle',
              items: [
                { type: 'doc', id: 'modules/Moodle_CloudRun/Moodle_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Moodle_GKE/Moodle_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Moodle_Common/Moodle_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'N8N',
              items: [
                { type: 'doc', id: 'modules/N8N_CloudRun/N8N_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/N8N_GKE/N8N_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/N8N_Common/N8N_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'N8N AI',
              items: [
                { type: 'doc', id: 'modules/N8N_AI_CloudRun/N8N_AI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/N8N_AI_GKE/N8N_AI_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/N8N_AI_Common/N8N_AI_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Node-RED',
              items: [
                { type: 'doc', id: 'modules/NodeRED_CloudRun/NodeRED_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/NodeRED_GKE/NodeRED_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/NodeRED_Common/NodeRED_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Odoo',
              items: [
                { type: 'doc', id: 'modules/Odoo_CloudRun/Odoo_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Odoo_GKE/Odoo_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Odoo_Common/Odoo_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Ollama',
              items: [
                { type: 'doc', id: 'modules/Ollama_CloudRun/Ollama_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Ollama_GKE/Ollama_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Ollama_Common/Ollama_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'OpenClaw',
              items: [
                { type: 'doc', id: 'modules/OpenClaw_CloudRun/OpenClaw_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/OpenClaw_GKE/OpenClaw_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/OpenClaw_Common/OpenClaw_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'OpenEMR',
              items: [
                { type: 'doc', id: 'modules/OpenEMR_CloudRun/OpenEMR_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/OpenEMR_GKE/OpenEMR_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/OpenEMR_Common/OpenEMR_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'RAGFlow',
              items: [
                { type: 'doc', id: 'modules/RAGFlow_CloudRun/RAGFlow_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/RAGFlow_GKE/RAGFlow_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/RAGFlow_Common/RAGFlow_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Sample',
              items: [
                { type: 'doc', id: 'modules/Sample_CloudRun/Sample_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Sample_GKE/Sample_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Sample_Common/Sample_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Strapi',
              items: [
                { type: 'doc', id: 'modules/Strapi_CloudRun/Strapi_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Strapi_GKE/Strapi_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Strapi_Common/Strapi_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'VMware Engine',
              items: [
                { type: 'doc', id: 'modules/VMware_Engine/VMware_Engine', label: 'VMware Engine' },
              ],
            },
            {
              type: 'category',
              label: 'Wiki.js',
              items: [
                { type: 'doc', id: 'modules/Wikijs_CloudRun/Wikijs_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Wikijs_GKE/Wikijs_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Wikijs_Common/Wikijs_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Wordpress',
              items: [
                { type: 'doc', id: 'modules/Wordpress_CloudRun/Wordpress_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Wordpress_GKE/Wordpress_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Wordpress_Common/Wordpress_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Foundation',
              items: [
                { type: 'doc', id: 'modules/GCP_Services/GCP_Services', label: 'Services' },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Platform Practices',
      items: [
        { type: 'doc', id: 'practices/cicd', label: 'CI/CD' },
        { type: 'doc', id: 'practices/devsecops', label: 'DevSecOps' },
        { type: 'doc', id: 'practices/finops', label: 'FinOps' },
        { type: 'doc', id: 'practices/gitops-iac', label: 'GitOps & IaC' },
        { type: 'doc', id: 'practices/idp', label: 'IDP' },
        { type: 'doc', id: 'practices/sre', label: 'SRE' },
      label: 'Platform Capabilities',
      items: [
        { type: 'doc', id: 'capabilities/ai', label: 'Artificial Intelligence' },
        { type: 'doc', id: 'capabilities/container-orchestration', label: 'Container Orchestration' },
        { type: 'doc', id: 'capabilities/data-and-databases', label: 'Data & Databases' },
        { type: 'doc', id: 'capabilities/disaster-recovery', label: 'Disaster Recovery' },
        { type: 'doc', id: 'capabilities/hybrid-cloud', label: 'Hybrid Cloud' },
        { type: 'doc', id: 'capabilities/infrastructure-as-code', label: 'Infrastructure as Code' },
        { type: 'doc', id: 'capabilities/modernization', label: 'Modernization' },
        { type: 'doc', id: 'capabilities/multicloud', label: 'Multicloud' },
        { type: 'doc', id: 'capabilities/multitenancy-saas', label: 'Multitenancy & SaaS' },
        { type: 'doc', id: 'capabilities/networking', label: 'Networking' },
        { type: 'doc', id: 'capabilities/observability', label: 'Observability' },
        { type: 'doc', id: 'capabilities/security', label: 'Security' },
        { type: 'doc', id: 'capabilities/serverless', label: 'Serverless' },
        { type: 'doc', id: 'capabilities/service-mesh', label: 'Service Mesh' },
        { type: 'doc', id: 'capabilities/zero-trust', label: 'Zero Trust' },
      ],
    },
    {
      type: 'category',
      label: 'Platform Outcomes',
      items: [
        { type: 'doc', id: 'outcomes/compliance-governance', label: 'Compliance & Governance' },
        { type: 'doc', id: 'outcomes/cost-optimization', label: 'Cost Optimization' },
        { type: 'doc', id: 'outcomes/developer-productivity', label: 'Developer Productivity' },
        { type: 'doc', id: 'outcomes/modernization', label: 'Modernization' },
        { type: 'doc', id: 'outcomes/skills-development', label: 'Skills Development' },
        { type: 'doc', id: 'outcomes/zero-trust-security', label: 'Zero Trust Security' },
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
