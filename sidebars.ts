import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  guidesSidebar: [
    {type: 'doc', id: 'guides/using-rad', label: 'Using RAD'},
    {type: 'doc', id: 'guides/ai-tooling-gcp', label: 'AI Tooling'},
    {type: 'doc', id: 'guides/user-guide', label: 'User Guide'},
    {type: 'doc', id: 'guides/partner-guide', label: 'Partner Guide'},
    {type: 'doc', id: 'guides/agent-guide', label: 'Agent Guide'},
    {type: 'doc', id: 'guides/support-guide', label: 'Support Guide'},
    {type: 'doc', id: 'guides/admin-guide', label: 'Admin Guide'},
    {type: 'doc', id: 'guides/finance-guide', label: 'Finance Guide'},
  ],
  modulesSidebar: [
    {
      type: 'category',
      label: 'Foundation Services',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Services_GCP', label: 'Services GCP'},
        {type: 'doc', id: 'modules/App_CloudRun', label: 'App Cloud Run'},
        {type: 'doc', id: 'modules/App_GKE', label: 'App GKE'},
        {type: 'doc', id: 'modules/App_Common', label: 'App Common'},
      ],
    },
    {
      type: 'category',
      label: 'AI & LLM Tools',
      collapsed: true,
      items: [
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
          label: 'Hermes',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Hermes_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Hermes_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Hermes_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'LangFlow',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/LangFlow_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/LangFlow_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/LangFlow_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Langfuse',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Langfuse_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Langfuse_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Langfuse_Common', label: 'Common'},
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
          label: 'LobeChat',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/LobeChat_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/LobeChat_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/LobeChat_Common', label: 'Common'},
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
      ],
    },
    {
      type: 'category',
      label: 'Automation & Workflow',
      collapsed: true,
      items: [
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
          label: 'Temporal',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Temporal_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Temporal_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'EvolutionAPI',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/EvolutionAPI_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/EvolutionAPI_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/EvolutionAPI_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Changedetection',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Changedetection_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Changedetection_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Changedetection_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Mixpost',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Mixpost_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Mixpost_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Mixpost_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Data Infrastructure',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/MongoDB_GKE', label: 'MongoDB GKE'},
        {type: 'doc', id: 'modules/Elasticsearch_GKE', label: 'Elasticsearch GKE'},
        {type: 'doc', id: 'modules/ClickHouse_GKE', label: 'ClickHouse GKE'},
        {
          type: 'category',
          label: 'Azimutt',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Azimutt_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Azimutt_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Azimutt_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'CloudBeaver',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/CloudBeaver_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/CloudBeaver_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/CloudBeaver_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Hasura',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Hasura_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Hasura_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Hasura_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Meilisearch',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Meilisearch_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Meilisearch_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Meilisearch_Common', label: 'Common'},
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
          label: 'PhpMyAdmin',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/PhpMyAdmin_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/PhpMyAdmin_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/PhpMyAdmin_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'PocketBase',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/PocketBase_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/PocketBase_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/PocketBase_Common', label: 'Common'},
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
      ],
    },
    {
      type: 'category',
      label: 'Business Intelligence',
      collapsed: true,
      items: [
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
          label: 'Matomo',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Matomo_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Matomo_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Matomo_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Plausible',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Plausible_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Plausible_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'CMS & Website Builders',
      collapsed: true,
      items: [
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
          label: 'ClassicPress',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/ClassicPress_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/ClassicPress_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/ClassicPress_Common', label: 'Common'},
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
          label: 'WriteFreely',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/WriteFreely_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/WriteFreely_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/WriteFreely_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Identity & Security',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Authentik',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Authentik_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Authentik_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Authentik_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Keycloak',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Keycloak_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Keycloak_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Keycloak_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Logto',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Logto_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Logto_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Logto_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Zitadel',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Zitadel_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Zitadel_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Zitadel_Common', label: 'Common'},
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
      ],
    },
    {
      type: 'category',
      label: 'Developer Tools',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Appsmith',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Appsmith_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Appsmith_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Budibase',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Budibase_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Budibase_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Budibase_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'CodeServer',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/CodeServer_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/CodeServer_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/CodeServer_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Coder',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Coder_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Coder_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Coder_Common', label: 'Common'},
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
        {
          type: 'category',
          label: 'Forgejo',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Forgejo_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Forgejo_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Forgejo_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Gitea',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Gitea_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Gitea_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Gitea_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Hoppscotch',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Hoppscotch_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Hoppscotch_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Hoppscotch_Common', label: 'Common'},
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
          label: 'ToolJet',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/ToolJet_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/ToolJet_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/ToolJet_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Unleash',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Unleash_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Unleash_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Unleash_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Tolgee',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Tolgee_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Tolgee_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Tolgee_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Observability & Monitoring',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Beszel',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Beszel_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Beszel_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Beszel_Common', label: 'Common'},
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
          label: 'GlitchTip',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/GlitchTip_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/GlitchTip_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/GlitchTip_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Netdata',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Netdata_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Netdata_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Netdata_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Gotify',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Gotify_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Gotify_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Gotify_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Ntfy',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Ntfy_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Ntfy_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Ntfy_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'UptimeKuma',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/UptimeKuma_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/UptimeKuma_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/UptimeKuma_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Media & File Management',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Audiobookshelf',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Audiobookshelf_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Audiobookshelf_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Audiobookshelf_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'CalibreWeb',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/CalibreWeb_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/CalibreWeb_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/CalibreWeb_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Castopod',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Castopod_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Castopod_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Castopod_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Chibisafe',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Chibisafe_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Chibisafe_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Chibisafe_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Cloudreve',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Cloudreve_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Cloudreve_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Cloudreve_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Filebrowser',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Filebrowser_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Filebrowser_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Filebrowser_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'FreshRSS',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/FreshRSS_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/FreshRSS_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/FreshRSS_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Gokapi',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Gokapi_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Gokapi_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Gokapi_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Immich',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Immich_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Immich_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Jellyfin',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Jellyfin_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Jellyfin_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Jellyfin_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Kavita',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Kavita_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Kavita_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Kavita_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Miniflux',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Miniflux_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Miniflux_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Miniflux_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Navidrome',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Navidrome_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Navidrome_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Navidrome_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'PhotoPrism',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/PhotoPrism_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/PhotoPrism_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/PhotoPrism_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Shlink',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Shlink_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Shlink_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Shlink_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Enterprise Business Apps',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'ActualBudget',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/ActualBudget_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/ActualBudget_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/ActualBudget_Common', label: 'Common'},
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
          label: 'Dolibarr',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Dolibarr_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Dolibarr_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Dolibarr_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'EspoCRM',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/EspoCRM_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/EspoCRM_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/EspoCRM_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'FireflyIII',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/FireflyIII_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/FireflyIII_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/FireflyIII_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'MaybeFinance',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/MaybeFinance_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/MaybeFinance_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/MaybeFinance_Common', label: 'Common'},
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
        {
          type: 'category',
          label: 'Documenso',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Documenso_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Documenso_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Documenso_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Docuseal',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Docuseal_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Docuseal_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Docuseal_Common', label: 'Common'},
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
          label: 'SnipeIT',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/SnipeIT_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/SnipeIT_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/SnipeIT_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Business & Collaboration',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Affine',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Affine_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Affine_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Affine_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'BookStack',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/BookStack_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/BookStack_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/BookStack_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'CalCom',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/CalCom_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/CalCom_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/CalCom_Common', label: 'Common'},
          ],
        },
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
          label: 'Docmost',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Docmost_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Docmost_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Docmost_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'DokuWiki',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/DokuWiki_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/DokuWiki_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/DokuWiki_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Excalidraw',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Excalidraw_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Excalidraw_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Excalidraw_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Fider',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Fider_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Fider_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Fider_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Focalboard',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Focalboard_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Focalboard_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Focalboard_Common', label: 'Common'},
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
          label: 'LimeSurvey',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/LimeSurvey_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/LimeSurvey_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/LimeSurvey_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Monica',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Monica_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Monica_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Monica_Common', label: 'Common'},
          ],
        },
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
          label: 'OnlyOffice',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/OnlyOffice_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/OnlyOffice_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/OnlyOffice_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'OpenProject',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/OpenProject_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/OpenProject_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/OpenProject_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Outline',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Outline_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Outline_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Outline_Common', label: 'Common'},
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
          label: 'Plane',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Plane_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Plane_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Plane_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Rallly',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Rallly_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Rallly_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Rallly_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'StirlingPDF',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/StirlingPDF_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/StirlingPDF_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/StirlingPDF_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Vikunja',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Vikunja_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Vikunja_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Vikunja_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Communication & Support',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Chatwoot',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Chatwoot_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Chatwoot_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Chatwoot_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Element',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Element_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Element_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Element_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Synapse',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Synapse_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Synapse_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Synapse_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'Flarum',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Flarum_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Flarum_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Flarum_Common', label: 'Common'},
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
          label: 'Zammad',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Zammad_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Zammad_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Zammad_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'FreeScout',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/FreeScout_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/FreeScout_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/FreeScout_Common', label: 'Common'},
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
          label: 'Mautic',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/Mautic_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/Mautic_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/Mautic_Common', label: 'Common'},
          ],
        },
        {
          type: 'category',
          label: 'RocketChat',
          collapsed: true,
          items: [
            {type: 'doc', id: 'modules/RocketChat_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'modules/RocketChat_GKE', label: 'GKE'},
            {type: 'doc', id: 'modules/RocketChat_Common', label: 'Common'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Multicloud & Migration',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/AKS_GKE', label: 'AKS GKE'},
        {type: 'doc', id: 'modules/EKS_GKE', label: 'EKS GKE'},
        {type: 'doc', id: 'modules/Container_Migration', label: 'Container Migration'},
        {type: 'doc', id: 'modules/Migration_Center', label: 'Migration Center'},
        {type: 'doc', id: 'modules/VMware_Engine', label: 'VMware Engine'},
        {type: 'doc', id: 'modules/Istio_GKE', label: 'Istio GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Sample & Reference Apps',
      collapsed: true,
      items: [
        {type: 'doc', id: 'modules/Bank_GKE', label: 'Bank GKE'},
        {type: 'doc', id: 'modules/MC_Bank_GKE', label: 'MC Bank GKE'},
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
      ],
    },
  ],
  labsSidebar: [
    {
      type: 'category',
      label: 'Foundation Services',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Services_GCP', label: 'Services GCP'},
        {type: 'doc', id: 'labs/App_CloudRun', label: 'App Cloud Run'},
        {type: 'doc', id: 'labs/App_GKE', label: 'App GKE'},
      ],
    },
    {
      type: 'category',
      label: 'AI & LLM Tools',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'AnythingLLM',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/AnythingLLM_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/AnythingLLM_GKE', label: 'GKE'},
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
          label: 'Dify',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Dify_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Dify_GKE', label: 'GKE'},
          ],
        },
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
          label: 'Hermes',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Hermes_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Hermes_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'LangFlow',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/LangFlow_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/LangFlow_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Langfuse',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Langfuse_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Langfuse_GKE', label: 'GKE'},
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
          label: 'LiteLLM',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/LiteLLM_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/LiteLLM_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'LobeChat',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/LobeChat_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/LobeChat_GKE', label: 'GKE'},
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
          label: 'OpenWebUI',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/OpenWebUI_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/OpenWebUI_GKE', label: 'GKE'},
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
      ],
    },
    {
      type: 'category',
      label: 'Automation & Workflow',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Activepieces',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Activepieces_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Activepieces_GKE', label: 'GKE'},
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
          label: 'Windmill',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Windmill_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Windmill_GKE', label: 'GKE'},
          ],
        },
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
          label: 'NodeRED',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/NodeRED_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/NodeRED_GKE', label: 'GKE'},
          ],
        },
        {type: 'doc', id: 'labs/Temporal_GKE', label: 'Temporal GKE'},
        {
          type: 'category',
          label: 'EvolutionAPI',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/EvolutionAPI_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/EvolutionAPI_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Changedetection',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Changedetection_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Changedetection_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Mixpost',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Mixpost_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Mixpost_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Data Infrastructure',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/MongoDB_GKE', label: 'MongoDB GKE'},
        {type: 'doc', id: 'labs/Elasticsearch_GKE', label: 'Elasticsearch GKE'},
        {type: 'doc', id: 'labs/ClickHouse_GKE', label: 'ClickHouse GKE'},
        {
          type: 'category',
          label: 'Azimutt',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Azimutt_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Azimutt_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'CloudBeaver',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/CloudBeaver_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/CloudBeaver_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Hasura',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Hasura_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Hasura_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Meilisearch',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Meilisearch_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Meilisearch_GKE', label: 'GKE'},
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
          label: 'PhpMyAdmin',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/PhpMyAdmin_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/PhpMyAdmin_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'PocketBase',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/PocketBase_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/PocketBase_GKE', label: 'GKE'},
          ],
        },
        {type: 'doc', id: 'labs/Supabase_GKE', label: 'Supabase GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Business Intelligence',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Metabase',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Metabase_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Metabase_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Superset',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Superset_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Superset_GKE', label: 'GKE'},
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
          label: 'Matomo',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Matomo_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Matomo_GKE', label: 'GKE'},
          ],
        },
        {type: 'doc', id: 'labs/Plausible_GKE', label: 'Plausible GKE'},
      ],
    },
    {
      type: 'category',
      label: 'CMS & Website Builders',
      collapsed: true,
      items: [
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
          label: 'ClassicPress',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/ClassicPress_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/ClassicPress_GKE', label: 'GKE'},
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
          label: 'Directus',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Directus_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Directus_GKE', label: 'GKE'},
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
          label: 'WriteFreely',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/WriteFreely_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/WriteFreely_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Identity & Security',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Authentik',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Authentik_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Authentik_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Keycloak',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Keycloak_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Keycloak_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Logto',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Logto_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Logto_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Zitadel',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Zitadel_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Zitadel_GKE', label: 'GKE'},
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
      ],
    },
    {
      type: 'category',
      label: 'Developer Tools',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Appsmith_GKE', label: 'Appsmith GKE'},
        {
          type: 'category',
          label: 'Budibase',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Budibase_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Budibase_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'CodeServer',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/CodeServer_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/CodeServer_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Coder',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Coder_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Coder_GKE', label: 'GKE'},
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
        {
          type: 'category',
          label: 'Forgejo',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Forgejo_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Forgejo_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Gitea',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Gitea_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Gitea_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Hoppscotch',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Hoppscotch_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Hoppscotch_GKE', label: 'GKE'},
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
          label: 'ToolJet',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/ToolJet_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/ToolJet_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Unleash',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Unleash_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Unleash_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Tolgee',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Tolgee_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Tolgee_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Observability & Monitoring',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Beszel',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Beszel_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Beszel_GKE', label: 'GKE'},
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
          label: 'GlitchTip',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/GlitchTip_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/GlitchTip_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Netdata',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Netdata_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Netdata_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Gotify',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Gotify_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Gotify_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Ntfy',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Ntfy_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Ntfy_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'UptimeKuma',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/UptimeKuma_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/UptimeKuma_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Media & File Management',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Audiobookshelf',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Audiobookshelf_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Audiobookshelf_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'CalibreWeb',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/CalibreWeb_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/CalibreWeb_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Castopod',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Castopod_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Castopod_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Chibisafe',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Chibisafe_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Chibisafe_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Cloudreve',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Cloudreve_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Cloudreve_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Filebrowser',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Filebrowser_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Filebrowser_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'FreshRSS',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/FreshRSS_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/FreshRSS_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Gokapi',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Gokapi_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Gokapi_GKE', label: 'GKE'},
          ],
        },
        {type: 'doc', id: 'labs/Immich_GKE', label: 'Immich GKE'},
        {
          type: 'category',
          label: 'Jellyfin',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Jellyfin_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Jellyfin_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Kavita',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Kavita_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Kavita_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Miniflux',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Miniflux_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Miniflux_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Navidrome',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Navidrome_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Navidrome_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'PhotoPrism',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/PhotoPrism_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/PhotoPrism_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Shlink',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Shlink_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Shlink_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Enterprise Business Apps',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'ActualBudget',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/ActualBudget_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/ActualBudget_GKE', label: 'GKE'},
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
          label: 'Dolibarr',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Dolibarr_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Dolibarr_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'EspoCRM',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/EspoCRM_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/EspoCRM_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'FireflyIII',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/FireflyIII_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/FireflyIII_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'MaybeFinance',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/MaybeFinance_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/MaybeFinance_GKE', label: 'GKE'},
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
        {
          type: 'category',
          label: 'Documenso',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Documenso_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Documenso_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Docuseal',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Docuseal_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Docuseal_GKE', label: 'GKE'},
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
          label: 'Twenty',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Twenty_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Twenty_GKE', label: 'GKE'},
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
          label: 'SnipeIT',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/SnipeIT_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/SnipeIT_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Business & Collaboration',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Affine',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Affine_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Affine_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'BookStack',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/BookStack_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/BookStack_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'CalCom',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/CalCom_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/CalCom_GKE', label: 'GKE'},
          ],
        },
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
          label: 'Docmost',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Docmost_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Docmost_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'DokuWiki',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/DokuWiki_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/DokuWiki_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Excalidraw',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Excalidraw_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Excalidraw_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Fider',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Fider_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Fider_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Focalboard',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Focalboard_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Focalboard_GKE', label: 'GKE'},
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
          label: 'LimeSurvey',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/LimeSurvey_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/LimeSurvey_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Monica',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Monica_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Monica_GKE', label: 'GKE'},
          ],
        },
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
          label: 'Nextcloud',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Nextcloud_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Nextcloud_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'OnlyOffice',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/OnlyOffice_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/OnlyOffice_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'OpenProject',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/OpenProject_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/OpenProject_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Outline',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Outline_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Outline_GKE', label: 'GKE'},
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
          label: 'Plane',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Plane_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Plane_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Rallly',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Rallly_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Rallly_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'StirlingPDF',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/StirlingPDF_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/StirlingPDF_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Vikunja',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Vikunja_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Vikunja_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Communication & Support',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Chatwoot',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Chatwoot_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Chatwoot_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Element',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Element_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Element_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Synapse',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Synapse_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Synapse_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'Flarum',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Flarum_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Flarum_GKE', label: 'GKE'},
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
          label: 'Zammad',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Zammad_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Zammad_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'FreeScout',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/FreeScout_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/FreeScout_GKE', label: 'GKE'},
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
          label: 'Mautic',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Mautic_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Mautic_GKE', label: 'GKE'},
          ],
        },
        {
          type: 'category',
          label: 'RocketChat',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/RocketChat_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/RocketChat_GKE', label: 'GKE'},
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Multicloud & Migration',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/AKS_GKE', label: 'AKS GKE'},
        {type: 'doc', id: 'labs/EKS_GKE', label: 'EKS GKE'},
        {type: 'doc', id: 'labs/Container_Migration', label: 'Container Migration'},
        {type: 'doc', id: 'labs/Migration_Center', label: 'Migration Center'},
        {type: 'doc', id: 'labs/VMware_Engine', label: 'VMware Engine'},
        {type: 'doc', id: 'labs/Istio_GKE', label: 'Istio GKE'},
      ],
    },
    {
      type: 'category',
      label: 'Sample & Reference Apps',
      collapsed: true,
      items: [
        {type: 'doc', id: 'labs/Bank_GKE', label: 'Bank GKE'},
        {type: 'doc', id: 'labs/MC_Bank_GKE', label: 'MC Bank GKE'},
        {
          type: 'category',
          label: 'Sample',
          collapsed: true,
          items: [
            {type: 'doc', id: 'labs/Sample_CloudRun', label: 'Cloud Run'},
            {type: 'doc', id: 'labs/Sample_GKE', label: 'GKE'},
          ],
        },
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
