// App-category → exam-domain mapping: the single source of truth for topical
// cross-cluster links. Drives both directions at render time (DocItem/Content):
//   spoke → hub: "Certification track" chip on every lab/module page
//   hub → spoke: "Practice hands-on" lab list on every certification page
//
// The cert assignments encode editorial judgment about which exam each app
// best teaches — refine them here (one line per app) and both directions of
// links update sitewide on the next build.

export type CertCode = 'ACE' | 'PCA' | 'PCD' | 'PCDE' | 'PCNE' | 'PDE' | 'PSE';

export const CERT_HUBS: Record<CertCode, {name: string; path: string}> = {
  ACE: {name: 'Associate Cloud Engineer', path: '/docs/certification/ACE_Certification_Guide'},
  PCA: {name: 'Professional Cloud Architect', path: '/docs/certification/PCA_Certification_Guide'},
  PCD: {name: 'Professional Cloud Developer', path: '/docs/certification/PCD_Certification_Guide'},
  PCDE: {name: 'Professional Cloud Database Engineer', path: '/docs/certification/PCDE_Certification_Guide'},
  PCNE: {name: 'Professional Cloud Network Engineer', path: '/docs/certification/PCNE_Certification_Guide'},
  PDE: {name: 'Professional Cloud DevOps Engineer', path: '/docs/certification/PDE_Certification_Guide'},
  PSE: {name: 'Professional Cloud Security Engineer', path: '/docs/certification/PSE_Certification_Guide'},
};

export const AI_HUB = {name: 'AI Tooling on GCP', path: '/docs/guides/ai-tooling-gcp'};

type AppTrack = {
  name: string;
  certs: CertCode[];
  ai?: boolean;
  // Apps without platform-suffixed pages (single standalone doc).
  standalone?: boolean;
};

// Keyed by the permalink base name (filename minus _CloudRun/_GKE/_Common).
// Sample_* template pages are intentionally absent (noindexed).
export const APP_TRACKS: Record<string, AppTrack> = {
  Services_GCP: {name: 'GCP Services', certs: ['ACE'], standalone: true},
  App: {name: 'App (custom image)', certs: ['ACE', 'PCD']},
  Activepieces: {name: 'Activepieces', certs: ['PDE']},
  AKS: {name: 'Azure AKS fleet attach', certs: ['PCA', 'PCNE']},
  AnythingLLM: {name: 'AnythingLLM', certs: ['ACE'], ai: true},
  Bank: {name: 'Bank of Anthos', certs: ['PCD', 'PCA']},
  CalDiy: {name: 'CalDiy', certs: ['ACE']},
  Chroma: {name: 'Chroma', certs: ['PCDE'], ai: true},
  Container_Migration: {name: 'Container Migration', certs: ['PCA'], standalone: true},
  Crawl4AI: {name: 'Crawl4AI', certs: [], ai: true},
  Cyclos: {name: 'Cyclos', certs: ['ACE']},
  Dify: {name: 'Dify', certs: [], ai: true},
  Directus: {name: 'Directus', certs: ['PCD']},
  Django: {name: 'Django', certs: ['PCD']},
  EKS: {name: 'AWS EKS fleet attach', certs: ['PCA', 'PCNE']},
  Elasticsearch: {name: 'Elasticsearch', certs: ['PCDE']},
  Flowise: {name: 'Flowise', certs: [], ai: true},
  Formbricks: {name: 'Formbricks', certs: ['ACE']},
  Ghost: {name: 'Ghost', certs: ['ACE']},
  Grafana: {name: 'Grafana', certs: ['PDE']},
  InvoiceNinja: {name: 'Invoice Ninja', certs: ['ACE']},
  Istio: {name: 'Istio', certs: ['PCNE', 'PSE']},
  Kestra: {name: 'Kestra', certs: ['PDE']},
  LibreChat: {name: 'LibreChat', certs: [], ai: true},
  Listmonk: {name: 'Listmonk', certs: ['ACE']},
  LiteLLM: {name: 'LiteLLM', certs: [], ai: true},
  Mattermost: {name: 'Mattermost', certs: ['ACE']},
  Mautic: {name: 'Mautic', certs: ['ACE']},
  MC_Bank: {name: 'Multi-cluster Bank of Anthos', certs: ['PCA', 'PCNE']},
  Metabase: {name: 'Metabase', certs: ['PCDE']},
  Migration_Center: {name: 'Migration Center', certs: ['PCA'], standalone: true},
  MongoDB: {name: 'MongoDB', certs: ['PCDE']},
  Moodle: {name: 'Moodle', certs: ['ACE']},
  N8N: {name: 'n8n', certs: ['PDE']},
  N8N_AI: {name: 'n8n AI', certs: ['PDE'], ai: true},
  Nextcloud: {name: 'Nextcloud', certs: ['ACE']},
  NocoDB: {name: 'NocoDB', certs: ['PCDE']},
  NodeRED: {name: 'Node-RED', certs: ['PDE']},
  Odoo: {name: 'Odoo', certs: ['ACE']},
  Ollama: {name: 'Ollama', certs: [], ai: true},
  OpenClaw: {name: 'OpenClaw', certs: ['ACE']},
  OpenEMR: {name: 'OpenEMR', certs: ['ACE']},
  OpenWebUI: {name: 'Open WebUI', certs: [], ai: true},
  Paperless: {name: 'Paperless-ngx', certs: ['ACE']},
  Penpot: {name: 'Penpot', certs: ['ACE']},
  Postiz: {name: 'Postiz', certs: ['ACE']},
  Qdrant: {name: 'Qdrant', certs: ['PCDE'], ai: true},
  RAGFlow: {name: 'RAGFlow', certs: [], ai: true},
  SearXNG: {name: 'SearXNG', certs: [], ai: true},
  Strapi: {name: 'Strapi', certs: ['PCD']},
  Supabase: {name: 'Supabase', certs: ['PCDE']},
  Superset: {name: 'Superset', certs: ['PCDE']},
  Temporal: {name: 'Temporal', certs: ['PDE']},
  Twenty: {name: 'Twenty CRM', certs: ['ACE']},
  Umami: {name: 'Umami', certs: ['ACE']},
  Vaultwarden: {name: 'Vaultwarden', certs: ['PSE']},
  VMware_Engine: {name: 'VMware Engine', certs: ['PCA'], standalone: true},
  Wikijs: {name: 'Wiki.js', certs: ['ACE']},
  Windmill: {name: 'Windmill', certs: ['PDE']},
  Wordpress: {name: 'WordPress', certs: ['ACE']},
  Zammad: {name: 'Zammad', certs: ['ACE']},
};

const appKeyFromPermalink = (permalink: string): string | undefined => {
  const match = permalink.match(/^\/docs\/(?:labs|modules)\/(.+)$/);
  if (!match) return undefined;
  return match[1].replace(/_(CloudRun|GKE|Common)$/, '');
};

/** Topical track(s) for a lab/module page; null on non-app pages. */
export function trackForDocPermalink(
  permalink: string,
): {app: AppTrack; certs: {code: CertCode; name: string; path: string}[]} | null {
  const key = appKeyFromPermalink(permalink);
  const app = key ? APP_TRACKS[key] : undefined;
  if (!app) return null;
  return {
    app,
    certs: app.certs.map((code) => ({code, ...CERT_HUBS[code]})),
  };
}

/** Cert code for a certification-guide page; null elsewhere. */
export function certCodeFromPermalink(permalink: string): CertCode | null {
  const match = permalink.match(/^\/docs\/certification\/([A-Z]+)_/);
  return match && match[1] in CERT_HUBS ? (match[1] as CertCode) : null;
}

/** Labs that practice a given cert's domains (inverse of APP_TRACKS). */
export function labsForCert(code: CertCode): {name: string; path: string}[] {
  return Object.entries(APP_TRACKS)
    .filter(([, app]) => app.certs.includes(code))
    .map(([key, app]) => ({
      name: app.name,
      path: `/docs/labs/${app.standalone ? key : `${key}_GKE`}`,
    }));
}
