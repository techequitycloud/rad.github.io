---
title: "N8N AI sur Cloud Run"
description: "Référence de configuration pour déployer N8N AI sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/N8N_AI_CloudRun.md @ 3055034 sha256:a05f59c05069 -->

# N8N AI sur Cloud Run {#n8n-ai-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_AI_CloudRun.png" alt="N8N AI sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme open source d'automatisation de workflows dotée d'une interface
visuelle à base de nœuds pour connecter des services, exécuter de la logique et construire
des pipelines alimentés par l'IA. Ce module déploie n8n sur **Cloud Run v2** avec deux
services d'IA compagnons — **Qdrant** (base de données vectorielle pour le RAG et la
recherche sémantique) et **Ollama** (inférence LLM locale pour une IA respectueuse de la
confidentialité) — au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise n8n AI et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toute application Cloud Run — identité du service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

n8n AI s'exécute sous forme de conteneur Node.js sur Cloud Run v2. Le déploiement associe
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — n8n requiert PostgreSQL ; le moteur est fixe |
| Fichiers partagés | Filestore (NFS) | Volume persistant partagé pour les données des workflows ; découverte par défaut de l'hôte Redis |
| Stockage d'objets | Cloud Storage (GCS Fuse) | Bucket de données d'IA partagé, monté sur `/mnt/gcs` |
| Cache et file d'attente | Redis | Activé par défaut ; requis pour le mode file d'attente de n8n (multi-instances) |
| Base de données vectorielle | Qdrant (service Cloud Run compagnon) | Service Cloud Run interne uniquement ; non accessible publiquement |
| Inférence LLM | Ollama (service Cloud Run compagnon) | Service Cloud Run interne uniquement ; non accessible publiquement |
| Secrets | Secret Manager | `N8N_ENCRYPTION_KEY` et `N8N_SMTP_PASS` générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS facultatif + domaine personnalisé via Cloud Armor |

**Valeurs par défaut judicieuses à connaître dès le départ :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  configuration commune ; `database_type` vaut `POSTGRES_15` par défaut. Le remplacer par
  MySQL empêche le démarrage de n8n.
- **`N8N_ENCRYPTION_KEY` est générée automatiquement** et stockée dans Secret Manager.
  Sauvegardez-la avant de détruire le module — les identifiants chiffrés avec une clé ne
  peuvent pas être déchiffrés avec une autre.
- **Qdrant et Ollama sont des services Cloud Run distincts**, déployés dans le même projet
  et accessibles uniquement depuis le VPC. Ils ne sont pas accessibles publiquement.
- **La persistance GCS Fuse** garantit la durabilité de l'index vectoriel de Qdrant et des
  poids des modèles d'Ollama lors des redémarrages de conteneurs et des nouvelles
  révisions.
- **`min_instance_count` vaut `0` par défaut** (réduction à zéro). Définissez `1` pour une
  disponibilité fiable des webhooks et pour éviter la latence de démarrage à froid des
  workflows d'inférence d'IA.
- **Redis est activé par défaut.** Une instance n8n unique peut fonctionner sans lui, mais
  plusieurs instances requièrent Redis pour une exécution distribuée sûre.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service n8n AI et ses compagnons d'IA {#a-cloud-run--the-n8n-ai-service-and-ai-companions}

n8n s'exécute comme un service Cloud Run v2. Qdrant et Ollama s'exécutent chacun comme un
service Cloud Run compagnon distinct dans le même projet, accessible uniquement en interne
via le VPC.

- **Console :** Cloud Run → sélectionnez chaque service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service n8nai-<tenant-id> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de workflows, l'historique des exécutions et les
identifiants dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte
en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix. Lors du premier
déploiement, une tâche d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Outputs](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage (GCS Fuse) {#c-filestore-nfs-and-cloud-storage-gcs-fuse}

**Filestore (NFS)** fournit un volume persistant partagé, monté dans le service n8n, pour
la persistance des données des workflows et des identifiants entre les instances. Il sert
également d'hôte de découverte Redis par défaut lorsque `redis_host` est vide.

**Cloud Storage** est monté via GCS Fuse dans les trois services (n8n, Qdrant, Ollama) pour
la persistance des données propres à l'IA :

- l'index vectoriel de Qdrant dans `/mnt/gcs/qdrant`
- les poids des modèles d'Ollama dans `/mnt/gcs/ollama/models`
- les données des workflows n8n dans `/home/node/.n8n`

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<ai-data-bucket>/   # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les montages NFS, GCS Fuse et les options
CMEK.

### D. Backend de file d'attente Redis {#d-redis-queue-backend}

Redis prend en charge le mode file d'attente de n8n, ce qui permet une exécution fiable des
workflows sur plusieurs instances. Lorsqu'aucun `redis_host` n'est configuré et que NFS est
activé, l'adresse IP du serveur NFS est utilisée. Pour une production en haute
disponibilité, pointez vers une instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  gcloud run services describe n8nai-<tenant-id> \
    --project "$PROJECT" --region "$REGION" \
    --format='yaml(spec.template.spec.containers[0].env)'
  redis-cli -h <redis-host> ping
  ```

### E. Qdrant — base de données vectorielle {#e-qdrant--vector-database}

Qdrant fournit une recherche de similarité vectorielle hautes performances pour les
pipelines RAG, les embeddings de documents et la mémoire de l'IA dans les workflows n8n. Il
s'exécute comme un service Cloud Run compagnon interne uniquement, accessible depuis n8n
via la variable d'environnement `QDRANT_URL`.

- **Console :** Cloud Run → sélectionnez le service Qdrant.
- **CLI :**
  ```bash
  gcloud run services describe qdrant-<tenant-id> --project "$PROJECT" --region "$REGION"
  # Confirm QDRANT_URL in the n8n service
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Ollama — serveur LLM local {#f-ollama--local-llm-server}

Ollama exécute des modèles de langage open source (Llama 3, Mistral, Gemma) sur votre
infrastructure, permettant une inférence d'IA respectueuse de la confidentialité sans
dépendance à des API externes. Il s'agit d'un service Cloud Run interne uniquement ;
`OLLAMA_HOST` est injecté dans n8n.

- **Console :** Cloud Run → sélectionnez le service Ollama.
- **CLI :**
  ```bash
  gcloud run services describe ollama-<tenant-id> --project "$PROJECT" --region "$REGION"
  # Confirm OLLAMA_HOST in the n8n service
  gcloud run services describe n8nai-<tenant-id> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### G. Secret Manager {#g-secret-manager}

La clé de chiffrement de n8n et le mot de passe SMTP sont générés automatiquement et
stockés dans Secret Manager, puis injectés dans la révision Cloud Run à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Outputs](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour les détails de
l'injection et de la rotation.

### H. Réseau et entrée {#h-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé (via Cloud Armor), Cloud CDN et des contrôles VPC
d'entrée et de sortie peuvent y être ajoutés. Pour les webhooks publics,
`ingress_settings` doit rester à `"all"`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe n8nai-<tenant-id> \
    --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés et les adresses
IP statiques.

### I. Cloud Logging et Monitoring {#i-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud
SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read n8nai-<tenant-id> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application N8N AI {#3-n8n-ai-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche
  d'initialisation se connecte à Cloud SQL via le socket Unix de l'Auth Proxy, crée la base
  de données PostgreSQL `n8n_db` et l'utilisateur `n8n_user`, accorde tous les privilèges,
  puis arrête proprement le proxy. La tâche est idempotente et peut être relancée sans
  risque.
- **Clé de chiffrement.** `N8N_ENCRYPTION_KEY` est générée automatiquement au premier
  déploiement et stockée dans Secret Manager. **Sauvegardez ce secret avant de détruire le
  module.** Tous les identifiants n8n (clés d'API, jetons OAuth, mots de passe des
  workflows) sont chiffrés avec cette clé ; ils ne peuvent plus être déchiffrés après un
  redéploiement avec une clé différente.
- **Sondes de santé.** La sonde de démarrage cible `GET /` sur le port 5678 avec un délai
  initial de 120 secondes, ce qui laisse à n8n le temps de se connecter à PostgreSQL et de
  charger l'état des workflows. Cloud Run n'achemine pas de trafic tant que la sonde de
  démarrage n'a pas réussi.
- **URL des webhooks et de l'éditeur.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définies
  sur l'URL de service prévue avant le déploiement de la révision, afin que les webhooks
  fonctionnent sans nouvelle application après le déploiement.
- **Mode file d'attente.** Lorsque Redis est activé, n8n fonctionne en mode file d'attente
  pour une exécution fiable des workflows sur plusieurs instances. Avec une seule instance
  (`max_instance_count = 1`), le mode file d'attente est facultatif.
- **Réduction à zéro et démarrages à froid.** Avec `min_instance_count = 0`, les instances
  s'arrêtent lorsqu'elles sont inactives. La première requête après une réduction déclenche
  un démarrage à froid qui inclut l'initialisation de n8n sur la base de données — cela peut
  prendre 30 à 60 secondes. Définissez `min_instance_count = 1` pour éliminer ce délai.
- **Mot de passe SMTP.** `N8N_SMTP_PASS` est généré automatiquement comme valeur fictive.
  Remplacez la valeur du secret dans Secret Manager par de véritables identifiants SMTP
  avant d'activer l'envoi d'e-mails.
- **Inspecter les tâches Cloud Run Jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à n8n AI ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8nai` | Nom de base des ressources. **Ne le modifiez pas après le premier déploiement.** |
| `application_display_name` | `N8N AI Starter Kit` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Annotation de description du service. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance n8n. 2 vCPU recommandés pour les workflows d'IA. |
| `memory_limit` | `4Gi` | Mémoire par instance n8n. 4 GiB minimum pour les workflows d'IA. |
| `min_instance_count` | `0` | Définissez `1` pour une disponibilité continue des webhooks. `0` active la réduction à zéro. |
| `cpu_always_allocated` | `true` | Facturation à l'instance (CPU toujours actif). Obligatoire — les déclencheurs cron/planifiés et l'exécution de la file d'attente se lancent sans requête entrante. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Augmentez-le uniquement si Redis est activé. |
| `container_port` | `5678` | n8n écoute sur le port 5678. Ne le modifiez pas. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. Conservez `gen2`. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les longs workflows d'inférence d'IA. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du système de fichiers où est monté le socket Unix du Cloud SQL Auth Proxy. Utilisé uniquement lorsque `enable_cloudsql_volume = true`. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs sûrs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service. **Doit valoir `all` pour les webhooks publics.** |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Remarque :** activer IAP bloque les webhooks publics. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | valeurs SMTP fictives | Paramètres non sensibles. Les variables n8n principales sont injectées automatiquement ; ne définissez pas `N8N_PORT`, `DB_TYPE`, `DB_POSTGRESDB_*`, `N8N_ENCRYPTION_KEY`, `WEBHOOK_URL`, `QDRANT_URL` ni `OLLAMA_HOST`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. À utiliser pour les clés d'API des fournisseurs d'IA externes. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant le déploiement. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation (30 jours). |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — NFS et SQL personnalisé {#group-9--nfs--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base d'une instance créée en ligne. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe un équilibreur de charge HTTPS Cloud Armor + une règle WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés ; requiert `enable_cloud_armor`. |
| `admin_ip_ranges` | `[]` | Plages CIDR disposant d'un accès privilégié. |
| `enable_cdn` | `false` | Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneur conservées par révision. |
| `delete_untagged_images` | `true` | Supprime les images orphelines ou sans tag d'Artifact Registry. |
| `image_retention_days` | `30` | Seuil d'âge pour la suppression des images. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données des workflows et la découverte de l'hôte Redis. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` | `true` | Provisionne les buckets GCS. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de données d'IA provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. n8n requiert PostgreSQL. |
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. **Immuable après le premier déploiement.** |
| `db_user` | `n8n_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes après la rotation avant le redémarrage des instances. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Alias des informations de connexion injectés sous forme de variables d'environnement supplémentaires. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |
| `cron_jobs` | `[]` | Tâches Cloud Run Jobs planifiées pour les exportations de workflows ou la maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` — délai de 120 s | Sonde de démarrage de n8n ; laisse le temps de se connecter à la base de données et de charger les workflows. |
| `liveness_probe` | HTTP `/` — délai de 30 s | Sonde de vivacité de n8n. |
| `startup_probe_config` | TCP — activée | Sonde de démarrage standard d'App_CloudRun. |
| `health_check_config` | HTTP — activée | Sonde de vivacité standard d'App_CloudRun. |
| `uptime_check_config` | désactivé — `/` | Test de disponibilité Cloud Monitoring ; désactivé par défaut — activez-le une fois le point de terminaison accessible publiquement. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 21 — Backend de file d'attente Redis {#group-21--redis-queue-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le mode file d'attente de n8n. **Requis lorsque `max_instance_count > 1`.** |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS ; définissez-le explicitement pour une instance Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — Composants d'IA {#group-22--ai-components}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_ai_components` | `true` | Interrupteur principal. Définissez `false` pour déployer n8n sans Qdrant ni Ollama. |
| `enable_qdrant` | `true` | Déploie Qdrant comme service Cloud Run interne. |
| `qdrant_version` | `latest` | Tag de l'image Qdrant. Fixez une version précise pour la stabilité en production. |
| `enable_ollama` | `true` | Déploie Ollama comme service Cloud Run interne. |
| `ollama_version` | `latest` | Tag de l'image Ollama. Fixez une version précise pour la stabilité en production. |
| `ollama_model` | `llama3.2` | Modèle par défaut déclaré. Remarque : cette variable n'est actuellement pas transmise au service Ollama — les modèles doivent être téléchargés séparément au niveau de l'API Ollama. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `organization_id` | `""` | Requis lorsque `enable_vpc_sc = true`. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run de n8n. |
| `service_url` | URL `run.app` par défaut du service n8n. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsque Cloud Armor est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de données d'IA). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` (générée automatiquement) | Sauvegarder immédiatement | Critical | La modifier après la première exécution détruit définitivement tous les identifiants n8n enregistrés. |
| `application_name` | `n8nai` — défini une seule fois | Critical | Immuable après le premier déploiement ; un renommage recrée toutes les ressources GCP avec perte de données. |
| `db_name` / `db_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; un renommage fait pointer n8n vers une nouvelle base de données vide, avec perte de tous les workflows. |
| `database_type` | `POSTGRES_15` | Critical | n8n requiert PostgreSQL ; passer à MySQL ou NONE empêche le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation et bloque le démarrage. |
| `enable_qdrant` | `true` | High | Les workflows RAG actifs échouent à l'exécution avec des erreurs de connexion si Qdrant est supprimé. |
| `enable_ollama` | `true` | High | Les workflows utilisant le nœud LLM local échouent ; ne le désactivez que si vous utilisez exclusivement des fournisseurs d'IA externes. |
| `enable_redis` | `true` | High | Sans Redis, plusieurs instances entrent en conflit sur l'état des workflows ; une exécution en split-brain corrompt les exécutions. |
| `redis_host` | `""` (NFS) ou explicite | High | Lorsque Redis est activé mais que ni `redis_host` ni NFS ne sont définis, n8n ne démarre pas. |
| `memory_limit` | `4Gi` | High | En dessous de 4 GiB, les workflows d'IA (embeddings, recherche vectorielle, chaînage de LLM) provoquent des arrêts pour OOM. |
| `ingress_settings` | `all` pour les webhooks publics | High | `internal` ou `internal-and-cloud-load-balancing` bloquent la réception des webhooks externes. |
| `max_instance_count` | `1` sauf si Redis est configuré | High | Dépasser 1 sans Redis provoque un split-brain ; l'augmenter avec Redis ne pose pas de problème. |
| `min_instance_count` | `1` pour les webhooks | Medium | `0` provoque des délais de démarrage à froid (30–60s) ; les webhooks manquent le premier événement pendant le préchauffage. |
| `enable_nfs` | `true` | High | Sans NFS, les données des workflows ne sont pas partagées entre les instances et la découverte de l'hôte Redis échoue. |
| `enable_iap` | uniquement avec des identifiants OAuth valides | High | L'activer sans `iap_authorized_users` / `iap_authorized_groups` bloque tout accès. IAP bloque aussi les webhooks publics. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |
| `execution_environment` | `gen2` | High | `gen1` ne prend pas en charge les montages NFS ; l'intégration Filestore requiert `gen2`. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à n8n AI,
partagée avec la variante GKE, est décrite dans
**[N8N_AI_Common](N8N_AI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : N8N_AI sur Cloud Run](../labs/N8N_AI_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [N8N AI sur GKE Autopilot](N8N_AI_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [N8N AI Common — Configuration applicative partagée](N8N_AI_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) dans la solution **AI Automation Starter**.
