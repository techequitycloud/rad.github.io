import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  guidesSidebar: [
    {type: 'doc', id: 'guides/using-rad', label: 'Using RAD'},
    {type: 'doc', id: 'guides/ai-tooling-gcp', label: 'AI Tooling on GCP'},
    {type: 'doc', id: 'guides/user-guide', label: 'User Guide'},
    {type: 'doc', id: 'guides/partner-guide', label: 'Partner Guide'},
    {type: 'doc', id: 'guides/agent-guide', label: 'Agent Guide'},
    {type: 'doc', id: 'guides/support-guide', label: 'Support Guide'},
    {type: 'doc', id: 'guides/admin-guide', label: 'Admin Guide'},
    {type: 'doc', id: 'guides/finance-guide', label: 'Finance Guide'},
  ],
  modulesSidebar: [
    {type: 'doc', id: 'modules/Services_GCP', label: 'Services GCP'},
    {
      type: 'category',
      label: 'App',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/App_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/App_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/App_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Activepieces',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Activepieces_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Activepieces_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Activepieces_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/AKS_GKE', label: 'AKS GKE'},
    {
      type: 'category',
      label: 'AnythingLLM',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/AnythingLLM_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/AnythingLLM_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/AnythingLLM_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/Bank_GKE', label: 'Bank GKE'},
    {
      type: 'category',
      label: 'CalDiy',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/CalDiy_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/CalDiy_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/CalDiy_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Chroma',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Chroma_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Chroma_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Chroma_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/Container_Migration', label: 'Container Migration'},
    {
      type: 'category',
      label: 'Crawl4AI',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Crawl4AI_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Crawl4AI_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Crawl4AI_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Cyclos',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Cyclos_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Cyclos_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Cyclos_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Dify',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Dify_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Dify_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Dify_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Directus',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Directus_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Directus_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Directus_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Django',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Django_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Django_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Django_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/EKS_GKE', label: 'EKS GKE'},
    {type: 'doc', id: 'modules/Elasticsearch_GKE', label: 'Elasticsearch GKE'},
    {
      type: 'category',
      label: 'Flowise',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Flowise_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Flowise_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Flowise_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Formbricks',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Formbricks_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Formbricks_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Formbricks_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Ghost',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Ghost_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Ghost_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Ghost_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Grafana',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Grafana_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Grafana_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Grafana_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'InvoiceNinja',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/InvoiceNinja_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/InvoiceNinja_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/InvoiceNinja_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/Istio_GKE', label: 'Istio GKE'},
    {
      type: 'category',
      label: 'Kestra',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Kestra_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Kestra_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Kestra_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'LibreChat',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/LibreChat_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/LibreChat_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/LibreChat_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Listmonk',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Listmonk_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Listmonk_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Listmonk_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'LiteLLM',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/LiteLLM_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/LiteLLM_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/LiteLLM_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Mattermost',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Mattermost_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Mattermost_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Mattermost_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Mautic',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Mautic_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Mautic_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Mautic_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/MC_Bank_GKE', label: 'MC Bank GKE'},
    {
      type: 'category',
      label: 'Metabase',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Metabase_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Metabase_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Metabase_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/Migration_Center', label: 'Migration Center'},
    {type: 'doc', id: 'modules/MongoDB_GKE', label: 'MongoDB GKE'},
    {
      type: 'category',
      label: 'Moodle',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Moodle_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Moodle_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Moodle_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'N8N',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/N8N_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/N8N_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/N8N_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'N8N AI',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/N8N_AI_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/N8N_AI_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/N8N_AI_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Nextcloud',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Nextcloud_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Nextcloud_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Nextcloud_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'NocoDB',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/NocoDB_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/NocoDB_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/NocoDB_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'NodeRED',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/NodeRED_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/NodeRED_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/NodeRED_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Odoo',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Odoo_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Odoo_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Odoo_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Ollama',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Ollama_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Ollama_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Ollama_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'OpenClaw',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/OpenClaw_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/OpenClaw_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/OpenClaw_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'OpenEMR',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/OpenEMR_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/OpenEMR_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/OpenEMR_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'OpenWebUI',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/OpenWebUI_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/OpenWebUI_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/OpenWebUI_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Paperless',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Paperless_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Paperless_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Paperless_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Penpot',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Penpot_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Penpot_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Penpot_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Qdrant',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Qdrant_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Qdrant_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Qdrant_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'RAGFlow',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/RAGFlow_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/RAGFlow_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/RAGFlow_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Sample',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Sample_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Sample_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Sample_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'SearXNG',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/SearXNG_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/SearXNG_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/SearXNG_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Strapi',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Strapi_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Strapi_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Strapi_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Supabase',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Supabase_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Supabase_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Superset',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Superset_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Superset_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Superset_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Temporal',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Temporal_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Temporal_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Twenty',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Twenty_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Twenty_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Twenty_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Umami',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Umami_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Umami_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Umami_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Vaultwarden',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Vaultwarden_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Vaultwarden_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Vaultwarden_Common', label: 'Common'},
      ],
    },
    {type: 'doc', id: 'modules/VMware_Engine', label: 'VMware Engine'},
    {
      type: 'category',
      label: 'Wikijs',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Wikijs_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Wikijs_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Wikijs_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Windmill',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Windmill_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Windmill_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Windmill_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Wordpress',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Wordpress_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Wordpress_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Wordpress_Common', label: 'Common'},
      ],
    },
    {
      type: 'category',
      label: 'Zammad',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Zammad_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'modules/Zammad_GKE', label: 'GKE'},
        {type: 'doc', id: 'modules/Zammad_Common', label: 'Common'},
      ],
    },
  ],
  labsSidebar: [
    {type: 'doc', id: 'labs/Services_GCP', label: 'Services GCP'},
    {
      type: 'category',
      label: 'App',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/App_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/App_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Activepieces',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Activepieces_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Activepieces_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/AKS_GKE', label: 'AKS GKE'},
    {
      type: 'category',
      label: 'AnythingLLM',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/AnythingLLM_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/AnythingLLM_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/Bank_GKE', label: 'Bank GKE'},
    {
      type: 'category',
      label: 'CalDiy',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/CalDiy_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/CalDiy_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Chroma',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Chroma_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Chroma_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/Container_Migration', label: 'Container Migration'},
    {
      type: 'category',
      label: 'Crawl4AI',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Crawl4AI_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Crawl4AI_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Cyclos',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Cyclos_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Cyclos_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Dify',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Dify_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Dify_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Directus',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Directus_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Directus_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Django',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Django_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Django_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/EKS_GKE', label: 'EKS GKE'},
    {type: 'doc', id: 'labs/Elasticsearch_GKE', label: 'Elasticsearch GKE'},
    {
      type: 'category',
      label: 'Flowise',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Flowise_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Flowise_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Formbricks',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Formbricks_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Formbricks_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Ghost',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Ghost_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Ghost_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Grafana',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Grafana_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Grafana_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'InvoiceNinja',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/InvoiceNinja_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/InvoiceNinja_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/Istio_GKE', label: 'Istio GKE'},
    {
      type: 'category',
      label: 'Kestra',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Kestra_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Kestra_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'LibreChat',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/LibreChat_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/LibreChat_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Listmonk',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Listmonk_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Listmonk_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'LiteLLM',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/LiteLLM_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/LiteLLM_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Mattermost',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Mattermost_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Mattermost_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Mautic',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Mautic_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Mautic_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/MC_Bank_GKE', label: 'MC Bank GKE'},
    {
      type: 'category',
      label: 'Metabase',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Metabase_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Metabase_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/Migration_Center', label: 'Migration Center'},
    {type: 'doc', id: 'labs/MongoDB_GKE', label: 'MongoDB GKE'},
    {
      type: 'category',
      label: 'Moodle',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Moodle_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Moodle_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'N8N',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/N8N_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/N8N_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'N8N AI',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/N8N_AI_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/N8N_AI_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Nextcloud',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Nextcloud_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Nextcloud_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'NocoDB',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/NocoDB_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/NocoDB_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'NodeRED',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/NodeRED_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/NodeRED_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Odoo',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Odoo_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Odoo_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Ollama',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Ollama_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Ollama_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'OpenClaw',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/OpenClaw_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/OpenClaw_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'OpenEMR',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/OpenEMR_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/OpenEMR_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'OpenWebUI',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/OpenWebUI_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/OpenWebUI_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Paperless',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Paperless_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Paperless_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Penpot',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Penpot_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Penpot_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Postiz',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Postiz_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Postiz_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Qdrant',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Qdrant_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Qdrant_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'RAGFlow',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/RAGFlow_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/RAGFlow_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Sample',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Sample_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Sample_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'SearXNG',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/SearXNG_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/SearXNG_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Strapi',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Strapi_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Strapi_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/Supabase_GKE', label: 'Supabase GKE'},
    {
      type: 'category',
      label: 'Superset',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Superset_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Superset_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/Temporal_GKE', label: 'Temporal GKE'},
    {
      type: 'category',
      label: 'Twenty',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Twenty_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Twenty_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Umami',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Umami_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Umami_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Vaultwarden',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Vaultwarden_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Vaultwarden_GKE', label: 'GKE'},
      ],
    },
    {type: 'doc', id: 'labs/VMware_Engine', label: 'VMware Engine'},
    {
      type: 'category',
      label: 'Wikijs',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Wikijs_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Wikijs_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Windmill',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Windmill_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Windmill_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Wordpress',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Wordpress_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Wordpress_GKE', label: 'GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Zammad',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Zammad_CloudRun', label: 'Cloud Run'},
        {type: 'doc', id: 'labs/Zammad_GKE', label: 'GKE'},
      ],
    },
  ],
  certificationSidebar: [
    {
      type: 'category',
      label: 'Associate Cloud Engineer',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/ACE_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/ACE_Section_1_Exploration_Guide', label: 'Section 1 — Setting up a cloud solution environment'},
        {type: 'doc', id: 'certification/ACE_Section_2_Exploration_Guide', label: 'Section 2 — Planning and implementing a cloud solution'},
        {type: 'doc', id: 'certification/ACE_Section_3_Exploration_Guide', label: 'Section 3 — Ensuring successful operation of a cloud solution'},
        {type: 'doc', id: 'certification/ACE_Section_4_Exploration_Guide', label: 'Section 4 — Configuring access and security'},
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Architect',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/PCA_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/PCA_Section_1_Exploration_Guide', label: 'Section 1 — Designing and planning a cloud solution architecture'},
        {type: 'doc', id: 'certification/PCA_Section_2_Exploration_Guide', label: 'Section 2 — Managing and provisioning a cloud solution infrastructure'},
        {type: 'doc', id: 'certification/PCA_Section_3_Exploration_Guide', label: 'Section 3 — Designing for security and compliance'},
        {type: 'doc', id: 'certification/PCA_Section_4_Exploration_Guide', label: 'Section 4 — Analyzing and optimizing technical and business processes'},
        {type: 'doc', id: 'certification/PCA_Section_5_Exploration_Guide', label: 'Section 5 — Managing implementation'},
        {type: 'doc', id: 'certification/PCA_Section_6_Exploration_Guide', label: 'Section 6 — Ensuring solution and operations excellence'},
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Developer',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/PCD_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/PCD_Section_1_Exploration_Guide', label: 'Section 1 — Designing highly scalable, available, and reliable cloud-native applications'},
        {type: 'doc', id: 'certification/PCD_Section_2_Exploration_Guide', label: 'Section 2 — Building and testing applications'},
        {type: 'doc', id: 'certification/PCD_Section_3_Exploration_Guide', label: 'Section 3 — Deploying applications'},
        {type: 'doc', id: 'certification/PCD_Section_4_Exploration_Guide', label: 'Section 4 — Integrating applications with Google Cloud services'},
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud DevOps Engineer',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/PDE_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/PDE_Section_1_Exploration_Guide', label: 'Section 1 — Bootstrapping and maintaining a Google Cloud organization'},
        {type: 'doc', id: 'certification/PDE_Section_2_Exploration_Guide', label: 'Section 2 — Building and implementing CI/CD pipelines'},
        {type: 'doc', id: 'certification/PDE_Section_3_Exploration_Guide', label: 'Section 3 — Applying site reliability engineering practices'},
        {type: 'doc', id: 'certification/PDE_Section_4_Exploration_Guide', label: 'Section 4 — Implementing observability practices and troubleshooting issues'},
        {type: 'doc', id: 'certification/PDE_Section_5_Exploration_Guide', label: 'Section 5 — Optimizing performance and cost'},
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Security Engineer',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/PSE_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/PSE_Section_1_Exploration_Guide', label: 'Section 1 — Configuring access'},
        {type: 'doc', id: 'certification/PSE_Section_2_Exploration_Guide', label: 'Section 2 — Securing communications and establishing boundary protection'},
        {type: 'doc', id: 'certification/PSE_Section_3_Exploration_Guide', label: 'Section 3 — Ensuring data protection'},
        {type: 'doc', id: 'certification/PSE_Section_4_Exploration_Guide', label: 'Section 4 — Managing operations'},
        {type: 'doc', id: 'certification/PSE_Section_5_Exploration_Guide', label: 'Section 5 — Supporting compliance requirements'},
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Database Engineer',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/PCDE_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/PCDE_Section_1_Exploration_Guide', label: 'Section 1 — Design innovative, scalable, and highly available cloud database solutions'},
        {type: 'doc', id: 'certification/PCDE_Section_2_Exploration_Guide', label: 'Section 2 — Manage a solution that can span multiple database technologies'},
        {type: 'doc', id: 'certification/PCDE_Section_3_Exploration_Guide', label: 'Section 3 — Migrate data solutions'},
        {type: 'doc', id: 'certification/PCDE_Section_4_Exploration_Guide', label: 'Section 4 — Deploy scalable and highly available databases in Google Cloud'},
      ],
    },
    {
      type: 'category',
      label: 'Professional Cloud Network Engineer',
      collapsed: true,
      items: [
        {type: 'doc', id: 'certification/PCNE_Certification_Guide', label: 'Overview'},
        {type: 'doc', id: 'certification/PCNE_Section_1_Exploration_Guide', label: 'Section 1 — Designing and planning a Google Cloud VPC network'},
        {type: 'doc', id: 'certification/PCNE_Section_2_Exploration_Guide', label: 'Section 2 — Implementing a VPC network'},
        {type: 'doc', id: 'certification/PCNE_Section_3_Exploration_Guide', label: 'Section 3 — Configuring managed network services'},
        {type: 'doc', id: 'certification/PCNE_Section_4_Exploration_Guide', label: 'Section 4 — Configuring and implementing hybrid and multicloud network interconnectivity'},
        {type: 'doc', id: 'certification/PCNE_Section_5_Exploration_Guide', label: 'Section 5 — Managing, monitoring, and troubleshooting network operations'},
        {type: 'doc', id: 'certification/PCNE_Section_6_Exploration_Guide', label: 'Section 6 — Configuring, implementing and managing a cloud network security solution'},
      ],
    },
  ],
  designSidebar: [
    {type: 'doc', id: 'design/platform_capabilities', label: 'Platform Capabilities'},
    {type: 'doc', id: 'design/engineering_practices', label: 'Engineering Practices'},
    {type: 'doc', id: 'design/engineering_excellence', label: 'Engineering Excellence'},
  ],
};

export default sidebars;
