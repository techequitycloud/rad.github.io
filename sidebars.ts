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
      label: 'Module Guides',
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
            { type: 'doc', id: 'modules/AKS_GKE/AKS_GKE', label: 'AKS (Azure)' },
            {
              type: 'category',
              label: 'AnythingLLM',
              items: [
                { type: 'doc', id: 'modules/AnythingLLM_CloudRun/AnythingLLM_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/AnythingLLM_GKE/AnythingLLM_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/AnythingLLM_Common/AnythingLLM_Common', label: 'Common' },
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
              label: 'Chroma',
              items: [
                { type: 'doc', id: 'modules/Chroma_CloudRun/Chroma_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Chroma_GKE/Chroma_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Chroma_Common/Chroma_Common', label: 'Common' },
              ],
            },
            { type: 'doc', id: 'modules/Bank_GKE/Bank_GKE', label: 'Cloud Service Mesh' },
            { type: 'doc', id: 'modules/Container_Migration/Container_Migration', label: 'Container Migration' },
            {
              type: 'category',
              label: 'Crawl4AI',
              items: [
                { type: 'doc', id: 'modules/Crawl4AI_CloudRun/Crawl4AI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Crawl4AI_GKE/Crawl4AI_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Crawl4AI_Common/Crawl4AI_Common', label: 'Common' },
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
              label: 'Dify',
              items: [
                { type: 'doc', id: 'modules/Dify_CloudRun/Dify_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Dify_GKE/Dify_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Dify_Common/Dify_Common', label: 'Common' },
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
            { type: 'doc', id: 'modules/EKS_GKE/EKS_GKE', label: 'EKS (AWS)' },
            { type: 'doc', id: 'modules/Elasticsearch_GKE/Elasticsearch_GKE', label: 'Elasticsearch' },
            {
              type: 'category',
              label: 'Flowise',
              items: [
                { type: 'doc', id: 'modules/Flowise_CloudRun/Flowise_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Flowise_GKE/Flowise_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Flowise_Common/Flowise_Common', label: 'Common' },
              ],
            },
            { type: 'doc', id: 'modules/GCP_Services/GCP_Services', label: 'GCP Services' },
            { type: 'doc', id: 'modules/Services_GCP/Services_GCP', label: 'GCP Services' },
            {
              type: 'category',
              label: 'Ghost',
              items: [
                { type: 'doc', id: 'modules/Ghost_CloudRun/Ghost_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Ghost_GKE/Ghost_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Ghost_Common/Ghost_Common', label: 'Common' },
              ],
            },
            { type: 'doc', id: 'modules/MC_Bank_GKE/MC_Bank_GKE', label: 'GKE Multi-Cluster' },
            {
              type: 'category',
              label: 'Grafana',
              items: [
                { type: 'doc', id: 'modules/Grafana_CloudRun/Grafana_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Grafana_GKE/Grafana_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Grafana_Common/Grafana_Common', label: 'Common' },
              ],
            },
            { type: 'doc', id: 'modules/Istio_GKE/Istio_GKE', label: 'Istio Service Mesh' },
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
              label: 'LibreChat',
              items: [
                { type: 'doc', id: 'modules/LibreChat_CloudRun/LibreChat_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/LibreChat_GKE/LibreChat_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/LibreChat_Common/LibreChat_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'LiteLLM',
              items: [
                { type: 'doc', id: 'modules/LiteLLM_CloudRun/LiteLLM_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/LiteLLM_GKE/LiteLLM_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/LiteLLM_Common/LiteLLM_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Metabase',
              items: [
                { type: 'doc', id: 'modules/Metabase_CloudRun/Metabase_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Metabase_GKE/Metabase_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Metabase_Common/Metabase_Common', label: 'Common' },
              ],
            },
            { type: 'doc', id: 'modules/Migration_Center/Migration_Center', label: 'Migration Center' },
            { type: 'doc', id: 'modules/MongoDB_GKE/MongoDB_GKE', label: 'MongoDB' },
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
                { type: 'doc', id: 'modules/N8N_AI_CloudRun/N8N_AI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/N8N_CloudRun/N8N_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/N8N_AI_GKE/N8N_AI_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/N8N_GKE/N8N_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/N8N_AI_Common/N8N_AI_Common', label: 'Common' },
                { type: 'doc', id: 'modules/N8N_Common/N8N_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'NocoDB',
              items: [
                { type: 'doc', id: 'modules/NocoDB_CloudRun/NocoDB_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/NocoDB_GKE/NocoDB_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/NocoDB_Common/NocoDB_Common', label: 'Common' },
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
              label: 'OpenWebUI',
              items: [
                { type: 'doc', id: 'modules/OpenWebUI_CloudRun/OpenWebUI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/OpenWebUI_GKE/OpenWebUI_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/OpenWebUI_Common/OpenWebUI_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Qdrant',
              items: [
                { type: 'doc', id: 'modules/Qdrant_CloudRun/Qdrant_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Qdrant_GKE/Qdrant_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Qdrant_Common/Qdrant_Common', label: 'Common' },
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
              label: 'SearXNG',
              items: [
                { type: 'doc', id: 'modules/SearXNG_CloudRun/SearXNG_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/SearXNG_GKE/SearXNG_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/SearXNG_Common/SearXNG_Common', label: 'Common' },
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
              label: 'Supabase',
              items: [
                { type: 'doc', id: 'modules/Supabase_GKE/Supabase_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Supabase_Common/Supabase_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Superset',
              items: [
                { type: 'doc', id: 'modules/Superset_CloudRun/Superset_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Superset_GKE/Superset_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Superset_Common/Superset_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Temporal',
              items: [
                { type: 'doc', id: 'modules/Temporal_GKE/Temporal_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Temporal_Common/Temporal_Common', label: 'Common' },
              ],
            },
            {
              type: 'category',
              label: 'Vaultwarden',
              items: [
                { type: 'doc', id: 'modules/Vaultwarden_CloudRun/Vaultwarden_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Vaultwarden_GKE/Vaultwarden_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Vaultwarden_Common/Vaultwarden_Common', label: 'Common' },
              ],
            },
            { type: 'doc', id: 'modules/VMware_Engine/VMware_Engine', label: 'VMware Engine' },
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
              label: 'Windmill',
              items: [
                { type: 'doc', id: 'modules/Windmill_CloudRun/Windmill_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'modules/Windmill_GKE/Windmill_GKE', label: 'GKE' },
                { type: 'doc', id: 'modules/Windmill_Common/Windmill_Common', label: 'Common' },
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
      ],
    },
    {
      type: 'category',
      label: 'Module Labs',
      items: [
            {
              type: 'category',
              label: 'Activepieces',
              items: [
                { type: 'doc', id: 'labs/Activepieces_CloudRun/Activepieces_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Activepieces_GKE/Activepieces_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/AKS_GKE/AKS_GKE', label: 'AKS (Azure)' },
            {
              type: 'category',
              label: 'AnythingLLM',
              items: [
                { type: 'doc', id: 'labs/AnythingLLM_CloudRun/AnythingLLM_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/AnythingLLM_GKE/AnythingLLM_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Application',
              items: [
                { type: 'doc', id: 'labs/App_CloudRun/App_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/App_GKE/App_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Chroma',
              items: [
                { type: 'doc', id: 'labs/Chroma_CloudRun/Chroma_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Chroma_GKE/Chroma_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/Bank_GKE/Bank_GKE', label: 'Cloud Service Mesh' },
            { type: 'doc', id: 'labs/Container_Migration/Container_Migration', label: 'Container Migration' },
            {
              type: 'category',
              label: 'Crawl4AI',
              items: [
                { type: 'doc', id: 'labs/Crawl4AI_CloudRun/Crawl4AI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Crawl4AI_GKE/Crawl4AI_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Cyclos',
              items: [
                { type: 'doc', id: 'labs/Cyclos_CloudRun/Cyclos_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Cyclos_GKE/Cyclos_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Dify',
              items: [
                { type: 'doc', id: 'labs/Dify_CloudRun/Dify_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Dify_GKE/Dify_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Directus',
              items: [
                { type: 'doc', id: 'labs/Directus_CloudRun/Directus_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Directus_GKE/Directus_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Django',
              items: [
                { type: 'doc', id: 'labs/Django_CloudRun/Django_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Django_GKE/Django_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/EKS_GKE/EKS_GKE', label: 'EKS (AWS)' },
            { type: 'doc', id: 'labs/Elasticsearch_GKE/Elasticsearch_GKE', label: 'Elasticsearch' },
            {
              type: 'category',
              label: 'Flowise',
              items: [
                { type: 'doc', id: 'labs/Flowise_CloudRun/Flowise_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Flowise_GKE/Flowise_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/Services_GCP/Services_GCP', label: 'GCP Services' },
            {
              type: 'category',
              label: 'Ghost',
              items: [
                { type: 'doc', id: 'labs/Ghost_CloudRun/Ghost_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Ghost_GKE/Ghost_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/MC_Bank_GKE/MC_Bank_GKE', label: 'GKE Multi-Cluster' },
            {
              type: 'category',
              label: 'Grafana',
              items: [
                { type: 'doc', id: 'labs/Grafana_CloudRun/Grafana_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Grafana_GKE/Grafana_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/Istio_GKE/Istio_GKE', label: 'Istio Service Mesh' },
            {
              type: 'category',
              label: 'Kestra',
              items: [
                { type: 'doc', id: 'labs/Kestra_CloudRun/Kestra_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Kestra_GKE/Kestra_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'LibreChat',
              items: [
                { type: 'doc', id: 'labs/LibreChat_CloudRun/LibreChat_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/LibreChat_GKE/LibreChat_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'LiteLLM',
              items: [
                { type: 'doc', id: 'labs/LiteLLM_CloudRun/LiteLLM_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/LiteLLM_GKE/LiteLLM_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Metabase',
              items: [
                { type: 'doc', id: 'labs/Metabase_CloudRun/Metabase_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Metabase_GKE/Metabase_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/Migration_Center/Migration_Center', label: 'Migration Center' },
            { type: 'doc', id: 'labs/MongoDB_GKE/MongoDB_GKE', label: 'MongoDB' },
            {
              type: 'category',
              label: 'Moodle',
              items: [
                { type: 'doc', id: 'labs/Moodle_CloudRun/Moodle_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Moodle_GKE/Moodle_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'N8N',
              items: [
                { type: 'doc', id: 'labs/N8N_CloudRun/N8N_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/N8N_GKE/N8N_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'N8N AI',
              items: [
                { type: 'doc', id: 'labs/N8N_AI_CloudRun/N8N_AI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/N8N_AI_GKE/N8N_AI_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'NocoDB',
              items: [
                { type: 'doc', id: 'labs/NocoDB_CloudRun/NocoDB_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/NocoDB_GKE/NocoDB_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Node-RED',
              items: [
                { type: 'doc', id: 'labs/NodeRED_CloudRun/NodeRED_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/NodeRED_GKE/NodeRED_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Odoo',
              items: [
                { type: 'doc', id: 'labs/Odoo_CloudRun/Odoo_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Odoo_GKE/Odoo_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Ollama',
              items: [
                { type: 'doc', id: 'labs/Ollama_CloudRun/Ollama_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Ollama_GKE/Ollama_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'OpenClaw',
              items: [
                { type: 'doc', id: 'labs/OpenClaw_CloudRun/OpenClaw_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/OpenClaw_GKE/OpenClaw_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'OpenEMR',
              items: [
                { type: 'doc', id: 'labs/OpenEMR_CloudRun/OpenEMR_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/OpenEMR_GKE/OpenEMR_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'OpenWebUI',
              items: [
                { type: 'doc', id: 'labs/OpenWebUI_CloudRun/OpenWebUI_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/OpenWebUI_GKE/OpenWebUI_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Postiz',
              items: [
                { type: 'doc', id: 'labs/Postiz_CloudRun/Postiz_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Postiz_GKE/Postiz_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Qdrant',
              items: [
                { type: 'doc', id: 'labs/Qdrant_CloudRun/Qdrant_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Qdrant_GKE/Qdrant_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'RAGFlow',
              items: [
                { type: 'doc', id: 'labs/RAGFlow_CloudRun/RAGFlow_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/RAGFlow_GKE/RAGFlow_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Sample',
              items: [
                { type: 'doc', id: 'labs/Sample_CloudRun/Sample_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Sample_GKE/Sample_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'SearXNG',
              items: [
                { type: 'doc', id: 'labs/SearXNG_CloudRun/SearXNG_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/SearXNG_GKE/SearXNG_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Strapi',
              items: [
                { type: 'doc', id: 'labs/Strapi_CloudRun/Strapi_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Strapi_GKE/Strapi_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Supabase',
              items: [
                { type: 'doc', id: 'labs/Supabase_GKE/Supabase_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Superset',
              items: [
                { type: 'doc', id: 'labs/Superset_CloudRun/Superset_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Superset_GKE/Superset_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Temporal',
              items: [
                { type: 'doc', id: 'labs/Temporal_GKE/Temporal_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Vaultwarden',
              items: [
                { type: 'doc', id: 'labs/Vaultwarden_CloudRun/Vaultwarden_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Vaultwarden_GKE/Vaultwarden_GKE', label: 'GKE' },
              ],
            },
            { type: 'doc', id: 'labs/VMware_Engine/VMware_Engine', label: 'VMware Engine' },
            {
              type: 'category',
              label: 'Wiki.js',
              items: [
                { type: 'doc', id: 'labs/Wikijs_CloudRun/Wikijs_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Wikijs_GKE/Wikijs_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Windmill',
              items: [
                { type: 'doc', id: 'labs/Windmill_CloudRun/Windmill_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Windmill_GKE/Windmill_GKE', label: 'GKE' },
              ],
            },
            {
              type: 'category',
              label: 'Wordpress',
              items: [
                { type: 'doc', id: 'labs/Wordpress_CloudRun/Wordpress_CloudRun', label: 'Cloud Run' },
                { type: 'doc', id: 'labs/Wordpress_GKE/Wordpress_GKE', label: 'GKE' },
              ],
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
            { type: 'doc', id: 'ace/section1', label: '1 — Setting Up a Cloud Solution Environment' },
            { type: 'doc', id: 'ace/section2', label: '2 — Planning and Implementing Solutions' },
            { type: 'doc', id: 'ace/section3', label: '3 — Ensuring Successful Cloud Operations' },
            { type: 'doc', id: 'ace/section4', label: '4 — Configuring Access and Security' },
          ],
        },
        {
          type: 'category',
          label: 'Professional Cloud Architect',
          items: [
            { type: 'doc', id: 'pca/section1', label: '1 — Designing Cloud Solution Architecture' },
            { type: 'doc', id: 'pca/section2', label: '2 — Managing and Provisioning Infrastructure' },
            { type: 'doc', id: 'pca/section3', label: '3 — Designing for Security and Compliance' },
            { type: 'doc', id: 'pca/section4', label: '4 — Analyzing and Optimizing Processes' },
            { type: 'doc', id: 'pca/section5', label: '5 — Managing Implementation' },
            { type: 'doc', id: 'pca/section6', label: '6 — Solution and Operations Excellence' },
          ],
        },
        {
          type: 'category',
          label: 'Professional Cloud Developer',
          items: [
            { type: 'doc', id: 'pcd/section1', label: '1 — Designing Scalable Applications' },
            { type: 'doc', id: 'pcd/section2', label: '2 — Building and Testing Applications' },
            { type: 'doc', id: 'pcd/section3', label: '3 — Deploying Applications' },
            { type: 'doc', id: 'pcd/section4', label: '4 — Integrating with Google Cloud Services' },
          ],
        },
        {
          type: 'category',
          label: 'Professional Cloud DevOps Engineer',
          items: [
            { type: 'doc', id: 'pde/section1', label: '1 — Bootstrapping a Cloud Organization' },
            { type: 'doc', id: 'pde/section2', label: '2 — Building and Implementing CI/CD' },
            { type: 'doc', id: 'pde/section3', label: '3 — Site Reliability Engineering' },
            { type: 'doc', id: 'pde/section4', label: '4 — Observability and Troubleshooting' },
            { type: 'doc', id: 'pde/section5', label: '5 — Performance and Cost Optimization' },
          ],
        },
        {
          type: 'category',
          label: 'Professional Cloud Security Engineer',
          items: [
            { type: 'doc', id: 'pse/section1', label: '1 — Configuring Access' },
            { type: 'doc', id: 'pse/section2', label: '2 — Securing Communications and Boundaries' },
            { type: 'doc', id: 'pse/section3', label: '3 — Ensuring Data Protection' },
            { type: 'doc', id: 'pse/section4', label: '4 — Managing Operations' },
            { type: 'doc', id: 'pse/section5', label: '5 — Supporting Compliance Requirements' },
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
    {
      type: 'category',
      label: 'Platform Tutorials',
      items: [
        { type: 'doc', id: 'tutorials/getting-started', label: 'Quick Start' },
        { type: 'doc', id: 'tutorials/admin', label: 'Admin' },
        { type: 'doc', id: 'tutorials/partner', label: 'Partner' },
        { type: 'doc', id: 'tutorials/user', label: 'User' },
        { type: 'doc', id: 'tutorials/agent', label: 'Agent' },
        { type: 'doc', id: 'tutorials/finance', label: 'Finance' },
        { type: 'doc', id: 'workflows/credits', label: 'Credit Management' },
        { type: 'doc', id: 'tutorials/support', label: 'Support' },
        { type: 'doc', id: 'tutorials/roi', label: 'ROI' },
      ],
    },
  ],
};
      type: 'category',
      label: 'Platform Capabilities',
      items: [
        { type: 'doc', id: 'capabilities/ai', label: 'Artificial Intelligence' },
        { type: 'doc', id: 'capabilities/kubernetes', label: 'Container Orchestration' },
        { type: 'doc', id: 'capabilities/data_and_databases', label: 'Data & Databases' },
        { type: 'doc', id: 'capabilities/disaster_recovery', label: 'Disaster Recovery' },
        { type: 'doc', id: 'capabilities/hybrid-cloud', label: 'Hybrid Cloud' },
        { type: 'doc', id: 'capabilities/infrastructure-as-code', label: 'Infrastructure as Code' },
        { type: 'doc', id: 'capabilities/modernization', label: 'Modernization' },
        { type: 'doc', id: 'capabilities/multicloud', label: 'Multicloud' },
        { type: 'doc', id: 'capabilities/multitenancy_saas', label: 'Multitenancy & SaaS' },
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
      label: 'Platform Practices',
      items: [
        { type: 'doc', id: 'practices/cicd', label: 'CI/CD' },
        { type: 'doc', id: 'practices/devsecops', label: 'DevSecOps' },
        { type: 'doc', id: 'practices/finops', label: 'FinOps' },
        { type: 'doc', id: 'practices/gitops_iac', label: 'GitOps & IaC' },
        { type: 'doc', id: 'practices/platform_engineering', label: 'IDP' },
        { type: 'doc', id: 'practices/sre', label: 'SRE' },
      ],
    },
    {
      type: 'category',
      label: 'Platform Outcomes',
      items: [
        { type: 'doc', id: 'outcomes/compliance_governance', label: 'Compliance & Governance' },
        { type: 'doc', id: 'outcomes/cost_optimisation', label: 'Cost Optimization' },
        { type: 'doc', id: 'outcomes/developer_productivity', label: 'Developer Productivity' },
        { type: 'doc', id: 'outcomes/modernisation', label: 'Modernization' },
        { type: 'doc', id: 'outcomes/education_enablement', label: 'Skills Development' },
        { type: 'doc', id: 'outcomes/security_zero_trust', label: 'Zero Trust Security' },
      ],
    },

export default sidebars;
