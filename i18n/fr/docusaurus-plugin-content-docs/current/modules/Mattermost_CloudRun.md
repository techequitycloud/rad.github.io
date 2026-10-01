---
title: "Mattermost sur Google Cloud Run"
description: "Référence de configuration pour déployer Mattermost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mattermost_CloudRun.md @ 3055034 sha256:8cfa4f66363e -->

# Mattermost sur Google Cloud Run {#mattermost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mattermost_CloudRun.png" alt="Mattermost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète du module `modules/Mattermost_CloudRun`. Il couvre l'architecture, l'IAM, les variables de configuration, les comportements propres à Mattermost et les modèles d'exploitation pour déployer Mattermost sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Mattermost est une plateforme open source et auto-hébergeable de messagerie d'équipe et de collaboration — une alternative sécurisée à Slack avec des canaux persistants, des messages directs, le partage de fichiers, des intégrations, des bots, des commandes slash et des fonctionnalités de sécurité d'entreprise. `Mattermost CloudRun` est un **module wrapper** construit sur `App CloudRun`. Il utilise `App CloudRun` pour tout le provisionnement de l'infrastructure GCP et injecte la configuration applicative propre à Mattermost, l'initialisation de la base de données et le stockage via `Mattermost Common`.

**Capacités principales :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Mattermost personnalisé, 2 vCPU / 2 Gi par défaut. Le nombre minimal d'instances vaut 1 par défaut — Mattermost maintient des connexions WebSocket persistantes pour la messagerie en temps réel, ce qui rend la mise à l'échelle jusqu'à zéro inadaptée à la plupart des déploiements.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Volume GCS FUSE monté sur `/mattermost/data` pour la persistance des fichiers envoyés et des pièces jointes.
*   **Sécurité** : hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls depuis `App CloudRun`. Mattermost génère ses propres clés de signature internes au premier démarrage et les stocke dans la base de données — ce module ne génère automatiquement aucun secret au niveau de l'application.
*   **Mise en cache** : Redis est **facultatif** (`enable_redis = false` par défaut). Lorsqu'il est activé, Mattermost utilise Redis comme cache distribué et backend de sessions — ce qui est nécessaire à un comportement correct avec plusieurs réplicas.
*   **Éditions** : Team Edition (gratuite, par défaut) ou Enterprise Edition (licence payante requise). Contrôlée par la variable `edition`.
*   **Messagerie en temps réel** : Mattermost maintient des connexions WebSocket pour la remise des messages en temps réel. Le délai d'expiration des requêtes de 60 minutes de Cloud Run signifie que `timeout_seconds` doit être défini sur `3600` pour les déploiements faisant un usage intensif des WebSocket. Pour les charges de travail de production nécessitant des connexions persistantes de longue durée, envisagez `Mattermost GKE`.

**Projet et identité de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 1 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 1 | `list(string)` | `[]` | Destinataires e-mail pour l'accès IAM et les alertes de surveillance. |
| `resource_labels` | 1 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'mattermost'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `display_name` | 3 | `string` | `'Mattermost'` | Nom lisible affiché dans l'interface de la plateforme. |
| `description` | 3 | `string` | `'Mattermost - Open-source team messaging and collaboration'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'9.11.2'` | Tag de version de l'image Mattermost. Incrémentez-le pour déployer une nouvelle version. |

**Architecture du wrapper :** `Mattermost CloudRun` appelle `Mattermost Common` pour construire un objet `application_config` contenant les variables d'environnement propres à Mattermost, la configuration des sondes et la définition du job `db-init`. `module_storage_buckets` transporte tout bucket de données GCS configuré pour un montage FUSE. `scripts_dir` est résolu vers le répertoire de scripts de `Mattermost Common` au moment de l'apply.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Mattermost_CloudRun` délègue tout le provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux d'`App_CloudRun`.

**Aucun secret au niveau de l'application n'est généré automatiquement :** contrairement à de nombreux autres modules applicatifs, `Mattermost Common` ne génère pas automatiquement de secrets applicatifs tels qu'une `SECRET_KEY`. Mattermost génère ses propres clés de signature internes au premier démarrage et les stocke dans PostgreSQL. Les secrets `DB_PASSWORD` et `ROOT_PASSWORD` sont provisionnés automatiquement par `App CloudRun` et utilisés par le job `db-init`.

**Identité d'initialisation de la base de données :** le job Cloud Run `db-init` s'exécute sous le compte de service Cloud Run. Il se connecte à Cloud SQL PostgreSQL via le socket Unix de l'Auth Proxy, en utilisant `DB_HOST`, `DB_USER` et le secret `DB_PASSWORD` de Secret Manager.

**Délai de propagation IAM de 120 secondes :** hérité d'`App CloudRun` — le service Mattermost n'est déployé qu'une fois ce délai écoulé, ce qui évite les échecs de lecture des secrets au démarrage de la première révision.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Mattermost est une application écrite en Go, économe en ressources au démarrage, mais qui bénéficie d'une allocation de CPU constante pour la gestion des connexions WebSocket et la remise des messages. `Mattermost CloudRun` expose `cpu_limit` et `memory_limit` comme variables de premier niveau.

**Le nombre minimal d'instances vaut 1 par défaut** (`min_instance_count = 1`). Cela évite les démarrages à froid liés à la mise à l'échelle jusqu'à zéro, qui interrompraient les connexions WebSocket actives. Pour les environnements de développement ou sensibles aux coûts, `min_instance_count = 0` est pris en charge, mais les sessions des utilisateurs seront interrompues lorsque l'instance sera réduite.

**Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` vaut `'custom'` par défaut, ce qui signifie que Cloud Build compile une image personnalisée à l'aide du Dockerfile de `Mattermost Common` (basé sur l'image officielle `mattermost/mattermost-team-edition` ou `mattermost/mattermost-enterprise-edition`, selon `edition`). Définissez `container_image_source = 'prebuilt'` et `container_image` sur une URI d'image pour ignorer l'étape de build.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement de l'infrastructure seule (SQL, stockage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` effectue un build via Cloud Build. `'prebuilt'` déploie une URI d'image existante. |
| `container_image` | 4 | `""` | URI d'image de remplacement. Laissez vide pour que Cloud Build gère l'image. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés pour Mattermost. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi est le minimum ; augmentez-la pour les grandes équipes. |
| `cpu_always_allocated` | 4 | `true` | CPU alloué en permanence (facturation à l'instance). Maintenu à `true` : les connexions WebSocket en temps réel nécessitent une instance non bridée (à associer à `min_instance_count >= 1`). |
| `container_resources` | 4 | `null` | Lorsqu'elle est définie, remplace `cpu_limit` et `memory_limit`. |
| `min_instance_count` | 4 | `1` | Conservez `1` en production pour éviter les interruptions des WebSocket. |
| `max_instance_count` | 4 | `5` | Plafond de coût pour la mise à l'échelle automatique. |
| `container_port` | 4 | `8065` | Port HTTP natif de Mattermost. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages de volumes GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. Définissez `3600` pour les déploiements faisant un usage intensif des WebSocket. |
| `enable_cloudsql_volume` | 4 | `true` | Injecte le sidecar Cloud SQL Auth Proxy. Définissez `false` pour TCP. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met l'image Mattermost en miroir dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage pour les déploiements canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. Définissez `0` pour désactiver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut d'`App CloudRun` :**

| Variable | `App CloudRun` | `Mattermost CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `8065` | Port natif de Mattermost. |
| `cpu_limit` | `'1000m'` | `'2000m'` | Mattermost gère des connexions WebSocket simultanées et l'indexation des messages. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Mattermost met en cache les canaux, les utilisateurs et les sessions en mémoire. |
| `min_instance_count` | `0` | `1` | La mise à l'échelle jusqu'à zéro coupe les connexions WebSocket actives des utilisateurs. |
| `cpu_always_allocated` | `false` | `true` | La remise en temps réel via WebSocket ne doit pas être bridée en CPU entre les requêtes. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Mattermost exige **PostgreSQL 13 ou une version ultérieure** — PostgreSQL 15 est la valeur par défaut. Mattermost exécute ses propres migrations de schéma au démarrage ; aucune configuration manuelle du schéma n'est nécessaire au-delà de la création de la base de données et de l'utilisateur (prise en charge par le job `db-init`).

Le module utilise les variables abrégées `db_name` et `db_user`, qui transitent par `Mattermost Common` jusqu'à la configuration de l'application.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur de base de données Cloud SQL. Ne quittez pas PostgreSQL. |
| `db_name` | 12 | `'mattermost'` | Nom de la base de données PostgreSQL. **Ne le modifiez pas après le déploiement initial.** |
| `db_user` | 12 | `'mattermost'` | Utilisateur applicatif PostgreSQL. Mot de passe généré automatiquement et stocké dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16 à 64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer le service. |

### C. Stockage (GCS FUSE) {#c-storage-gcs-fuse}

Mattermost stocke les fichiers envoyés, les pièces jointes et les données des plugins sous `/mattermost/data`. Sans stockage persistant, tous les fichiers envoyés par les utilisateurs sont perdus au redémarrage du conteneur ou au déploiement d'une nouvelle révision.

**GCS FUSE est la méthode de stockage recommandée pour Cloud Run.** Montez un bucket GCS sur `/mattermost/data` via `gcs_volumes`. Cela fournit un stockage d'objets durable et répliqué au niveau régional, sans la latence supplémentaire de NFS pour les opérations sur fichiers typiques de Mattermost (envois de documents, images jointes, données des plugins).

NFS (`enable_nfs`) est également pris en charge pour les déploiements qui nécessitent une sémantique de système de fichiers POSIX.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisionne une instance NFS Cloud Filestore. Facultatif — GCS FUSE est préféré pour Mattermost. |
| `nfs_mount_path` | 11 | `'/mattermost/data'` | Chemin du conteneur où NFS est monté. |
| `nfs_instance_name` | 11 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base de la VM GCE NFS intégrée. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Montez sur `/mattermost/data` pour des envois persistants. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

**Configuration GCS FUSE recommandée pour le stockage des fichiers de Mattermost :**

```hcl
gcs_volumes = [
  {
    name        = "mattermost-data"
    bucket_name = "my-project-mattermost-data"
    mount_path  = "/mattermost/data"
    readonly    = false
    mount_options = [
      "implicit-dirs",
      "stat-cache-ttl=60s",
      "type-cache-ttl=60s"
    ]
  }
]
```

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour joindre l'adresse IP privée de Cloud SQL. Le sidecar Auth Proxy (`enable_cloudsql_volume = true`) gère la connexion à la base de données via un socket Unix.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via le VPC. `'ALL_TRAFFIC'` achemine toute la sortie via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est provisionné automatiquement par `Mattermost Common` lorsque `initialization_jobs` est laissé à la liste vide par défaut (`[]`). Il utilise une image basée sur `postgres` et exécute `Mattermost_Common/scripts/db-init.sh`, qui effectue les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via le socket Unix de l'Auth Proxy.
2. Crée la base de données `mattermost` si elle n'existe pas.
3. Crée l'utilisateur `mattermost` avec le mot de passe issu de Secret Manager.
4. Accorde à l'utilisateur tous les privilèges sur la base de données.

Mattermost exécute ensuite ses propres migrations de schéma au premier démarrage — aucune configuration manuelle du schéma n'est requise.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Mattermost Common` fournisse le job `db-init` par défaut. Une liste non vide le remplace entièrement. Chaque entrée : `name`, `description`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `execution_mode`, `mount_nfs`, `mount_gcs_volumes`, `depends_on_jobs`, `execute_on_apply`, `script_path`. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. Chaque entrée : `name`, `schedule`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une règle Cloud Armor WAF (OWASP Top 10, protection DDoS adaptative, limitation de débit à 500 requêtes/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global et Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par ex. VPN de bureau, adresses IP de sortie du CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée sur le service. Une authentification par identité Google est exigée avant que les requêtes n'atteignent Mattermost. Utile pour les déploiements internes, où les utilisateurs doivent s'authentifier avec le compte Google Workspace de leur organisation avant d'atteindre la page de connexion de Mattermost.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP de manière native sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs et comptes de service autorisés via IAP. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés via IAP. Format : `'group:name@example.com'`. |

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run impose que les images Mattermost déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images. Nécessite une règle Binary Authorization et un attesteur préconfigurés dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont confinés à un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets applicatifs de Mattermost sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — aucune valeur en clair n'est jamais écrite dans l'état. Des secrets définis par l'utilisateur peuvent être ajoutés via `secret_environment_variables`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Correspondance nom de variable d'environnement → ID de secret Secret Manager. Résolue à l'exécution. |
| `explicit_secret_values` | 6 | `{}` | Valeurs sensibles brutes écrites dans Secret Manager pendant le déploiement. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Nombre de secondes d'attente après la création d'un secret avant que les ressources dépendantes ne poursuivent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG sans serveur est provisionné. Le trafic circule ainsi : Internet → Cloud Armor → équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic de Mattermost à passer par l'équilibreur de charge, ce qui empêche l'accès direct via l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est associé au backend de l'équilibreur de charge HTTPS.

**Point d'attention pour Mattermost :** Mattermost sert un mélange de trafic d'API en temps réel (WebSocket, REST) et de ressources statiques (bundles JavaScript, CSS, fichiers de plugins). Cloud CDN convient à la diffusion des ressources statiques, mais ne doit pas mettre en cache les réponses de l'API ni les mises à niveau WebSocket. Mattermost définit des en-têtes `Cache-Control` appropriés sur ses ressources statiques, de sorte que le CDN peut être activé sans risque pour la mise en cache en périphérie du bundle de l'application.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. Effectif uniquement lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lequel les images peuvent être supprimées. Définissez `0` pour désactiver la suppression selon l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont associés à l'équilibreur de charge HTTPS global via `application_domains`. Des certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'adresse IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés. Des certificats SSL gérés par Google sont provisionnés pour chaque domaine. |

Après le premier apply, récupérez l'adresse IP de l'équilibreur de charge et créez un enregistrement `A`. Le provisionnement du certificat SSL prend de 10 à 30 minutes après la propagation DNS. Définissez ensuite `site_url` sur le domaine personnalisé afin que Mattermost génère des liens d'invitation et des URL de webhook corrects.

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés. Le déclencheur construit et déploie une image Mattermost personnalisée lorsque du code est poussé vers la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (portées `repo`, `admin:repo_hook`). Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (préféré pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est transformé en pipeline de livraison géré Cloud Deploy, avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count` vaut `1` par défaut — Mattermost maintient des connexions WebSocket actives pour la messagerie en temps réel, et une mise à l'échelle jusqu'à zéro déconnecterait tous les utilisateurs actifs. `max_instance_count` vaut `5` par défaut et sert de plafond de coût.

Lorsque plusieurs instances s'exécutent, Redis (`enable_redis = true`) est requis pour le partage distribué des sessions et la cohérence du cache. Sans Redis, différentes instances peuvent servir un cache obsolète ou créer des conflits de sessions.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge pour les déploiements canary.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage entre des révisions nommées. La somme de toutes les entrées doit être égale à 100. Une liste vide envoie 100 % du trafic à la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Mattermost expose un point de terminaison de santé dédié à `/api/v4/system/ping`, qui renvoie `HTTP 200` lorsque l'application est entièrement initialisée et connectée à la base de données. Les sondes de santé ciblent ce point de terminaison.

Mattermost effectue des migrations de schéma au premier démarrage. La sonde de démarrage laisse suffisamment de temps pour que la migration se termine avant que le trafic ne soit dirigé vers la nouvelle révision.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, period_seconds=15, failure_threshold=30 }` | Sonde de démarrage. Le conteneur ne reçoit aucun trafic tant qu'elle n'a pas réussi. |
| `liveness_probe` | 14 | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=60, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Le conteneur est redémarré après `failure_threshold` échecs consécutifs. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60 }` | **Inerte pour Mattermost.** `App_CloudRun` ne la câble que dans son propre préréglage interne d'exemple/de repli `cloudrunapp`, inutilisé (`cloudrunapp.tf`) — elle n'atteint jamais le service Mattermost déployé. |
| `health_check_config` | 14 | `{ enabled=true, path="/", initial_delay_seconds=60 }` | **Inerte pour Mattermost**, comme `startup_probe_config` ci-dessus. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). Lorsqu'il est activé, des alertes notifient `support_users` en cas d'indisponibilité. |
| `alert_policies` | 14 | `[]` | Règles d'alerte Cloud Monitoring sur les métriques. |

**Remarque sur le chemin des sondes :** les sondes réellement déployées proviennent uniquement de `startup_probe`/`liveness_probe` (transmises à `Mattermost_Common`, puis à `local.selected_module.startup_probe`/`.liveness_probe` d'`App_CloudRun`) — elles utilisent par défaut `path = "/"` dans le module Cloud Run, alors que la variante GKE utilise par défaut `/api/v4/system/ping`. Pour un signal de santé plus précis sur Cloud Run, remplacez le `path` de `startup_probe`/`liveness_probe` par `/api/v4/system/ping`. `startup_probe_config`/`health_check_config` forment une paire de variables distincte et inerte (voir le tableau ci-dessus) — les surcharger n'a aucun effet sur les sondes déployées de Mattermost, inutile donc de s'en occuper.

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job Cloud Run de rotation.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Mattermost.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatique des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après l'écriture du nouveau secret avant le redémarrage. |

---

## 8. Intégrations {#8-integrations}

### A. Paramètres de l'application Mattermost {#a-mattermost-application-settings}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `site_url` | 20 | `""` | URL publique à laquelle Mattermost est accessible. Définit `MM_SERVICESETTINGS_SITEURL`. Requise après le premier déploiement pour que les liens d'invitation, les webhooks et les notifications par e-mail soient corrects. (par ex. `'https://chat.example.com'`) |
| `edition` | 20 | `'team'` | `'team'` (gratuite) ou `'enterprise'` (payante — nécessite une clé de licence définie via `environment_variables`). Détermine l'image de conteneur Mattermost sélectionnée. |

**L'URL du site est essentielle.** Sans `site_url`, Mattermost utilise par défaut `http://localhost:8065` pour générer les liens, ce qui casse les liens d'invitation dans les e-mails et les callbacks OAuth. Définissez `site_url` sur l'URL du service Cloud Run (ou sur le domaine personnalisé) après le premier déploiement.

### B. Variables d'environnement {#b-environment-variables}

Mattermost se configure entièrement au moyen de variables d'environnement utilisant le préfixe `MM_`. La variable `environment_variables` accepte n'importe quelle clé de configuration de Mattermost :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair. À utiliser pour la configuration de Mattermost, comme l'e-mail, les plugins et les paramètres du service. |

Variables de configuration courantes de Mattermost injectées automatiquement par `Mattermost Common` :

| Variable d'environnement | Valeur | Rôle |
|---|---|---|
| `MM_SERVICESETTINGS_LISTENADDRESS` | `:8065` | Adresse d'écoute du serveur HTTP de Mattermost. |
| `MM_METRICSSETTINGS_LISTENADDRESS` | `:8067` | Point de terminaison des métriques Prometheus. |
| `MM_FILESETTINGS_DRIVERTYPE` | `local` | Type de stockage des fichiers (remplacé lorsque GCS FUSE est monté). |
| `MM_FILESETTINGS_DIRECTORY` | `/mattermost/data/` | Chemin de stockage des fichiers — correspond au point de montage GCS FUSE ou NFS. |
| `MM_LOGSETTINGS_CONSOLELEVEL` | `INFO` | Niveau de journalisation envoyé vers stdout (capturé par Cloud Logging). |
| `MM_LOGSETTINGS_ENABLEFILE` | `false` | Journalisation dans des fichiers désactivée — Cloud Run envoie stdout vers Cloud Logging. |
| `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER` | `X-Forwarded-For` | Permet d'extraire correctement l'adresse IP du client à partir des en-têtes de proxy de Cloud Run et de l'équilibreur de charge. |
| `MM_EMAILSETTINGS_ENABLEEMAILBATCHING` | `false` | Désactivé pour la compatibilité avec la mise à l'échelle jusqu'à zéro de Cloud Run. Le regroupement des e-mails nécessite des files d'attente persistantes en mémoire. |
| `MM_CACHEBACKEND` | `redis` ou `memory` | Défini sur `redis` lorsque `enable_redis = true` ; sinon `memory`. |
| `MM_REDIS_ADDRESS` | hôte:port Redis | Injectée lorsque `enable_redis = true`. |

### C. Cache Redis {#c-redis-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Activez Redis pour tout déploiement exécutant plus d'une instance — sans Redis, plusieurs instances de Mattermost ne peuvent pas partager l'état des sessions ni les caches, ce qui entraîne des échecs d'authentification intermittents et des données obsolètes.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `false` | Active Redis pour la mise en cache et le stockage des sessions de Mattermost. Recommandé pour les déploiements à plusieurs réplicas. |
| `redis_host` | 21 | `""` | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS lorsque `enable_redis = true`. Remplacez-la par une instance Memorystore en production. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe AUTH de Redis. Laissez vide si l'authentification n'est pas requise. Sensible — jamais stocké dans l'état. |

### D. Métriques {#d-metrics}

Mattermost expose des métriques au format Prometheus sur le port 8067 (`/metrics`). Activez les métriques dans la System Console de Mattermost, sous **Environment → Performance Monitoring**, puis intégrez-les à Google Cloud Monitoring via un point de terminaison Prometheus remote write ou un collecteur s'exécutant dans le même VPC.

### E. Import de sauvegarde et restauration {#e-backup-import--recovery}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes quotidiennes automatiques. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. Repassez à `false` après une importation réussie. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (nom de fichier dans un bucket GCS) ou `'gdrive'` (ID de fichier Drive). |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde dans le bucket GCS de sauvegardes géré par le module. |
| `backup_format` | 7 | `'sql'` | Format de la sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### F. Observabilité et alertes {#f-observability--alerting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |
| `support_users` | 1 | `[]` | Adresses e-mail notifiées par les déclenchements des tests de disponibilité et des règles d'alerte. |

---

## 9. Explorer avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, la console GCP est le principal outil pour inspecter le déploiement Mattermost en fonctionnement.

**Service Cloud Run**
Accédez à **Cloud Run** dans la console GCP et sélectionnez le service Mattermost (nommé `app<name><tenant><id>` par défaut, par ex. `appmattermostdemo`). Depuis la page du service, vous pouvez :
- Consulter l'URL du service pour accéder au client web Mattermost.
- Inspecter les révisions actives et leurs pourcentages de répartition du trafic.
- Examiner la configuration du conteneur, y compris les variables d'environnement, les volumes montés et les limites de ressources.
- Ouvrir l'onglet **Logs** pour suivre directement les journaux de l'application Mattermost — toute la sortie `stdout` est capturée par Cloud Logging.
- Surveiller les **Metrics** : nombre de requêtes, latence (p50, p95, p99), nombre d'instances de conteneur, utilisation de la mémoire et latence de démarrage.
- Afficher les **Revisions** pour voir l'historique des déploiements, les pondérations de trafic actuelles et les tags des révisions actives.

**Cloud SQL**
Accédez à **SQL** et sélectionnez l'instance PostgreSQL 15. Vérifications utiles :
- Onglet **Connections** : nombre de connexions actives depuis le service Cloud Run (via l'Auth Proxy).
- **Operations & logs** : activité récente de CREATE DATABASE, d'attribution de droits aux utilisateurs et de migration.
- Onglet **Databases** : vérifiez que la base de données `mattermost` existe après le premier déploiement.
- Onglet **Users** : confirmez que l'utilisateur `mattermost` a été créé par le job `db-init`.
- **Backups** : sauvegardes automatiques et à la demande. Comparez avec la variable `backup_schedule`.

**Cloud Storage**
Si `gcs_volumes` est configuré avec un bucket de données pour `/mattermost/data`, accédez à **Cloud Storage** et sélectionnez le bucket. Parcourez l'arborescence que Mattermost crée sous le point de montage :
- `teams/` — icônes des équipes et pièces jointes.
- `users/` — photos de profil.
- `plugins/` — fichiers de données des plugins.
Les opérations sur les fichiers du bucket reflètent les envois et les pièces jointes effectués par les utilisateurs de Mattermost.

**Secret Manager**
Accédez à **Secret Manager** et filtrez selon les libellés de ressources du déploiement. Les secrets créés par `App CloudRun` pour Mattermost comprennent :
- `DB_PASSWORD` — le mot de passe de l'utilisateur applicatif PostgreSQL.
- `ROOT_PASSWORD` — le mot de passe root/superutilisateur PostgreSQL utilisé par le job `db-init`.
Cliquez sur un secret pour afficher ses versions, son historique d'accès et sa configuration de rotation.

**Cloud Build**
Accédez à **Cloud Build → History** pour inspecter les journaux de build des images. Chaque déploiement crée un build qui compile l'image Mattermost personnalisée (lorsque `container_image_source = 'custom'`). Les journaux de build montrent les étapes du build Docker, le comportement de mise en cache des couches et l'envoi vers Artifact Registry.

**Artifact Registry**
Accédez à **Artifact Registry** et trouvez le dépôt du projet. L'image Mattermost y est stockée après chaque exécution de Cloud Build. Les images plus anciennes sont nettoyées selon `max_images_to_retain` et `image_retention_days`.

**Cloud Monitoring**
Accédez à **Monitoring → Dashboards** pour afficher les tableaux de bord des métriques Cloud Run. Si `uptime_check_config` est activé, le test de disponibilité apparaît sous **Monitoring → Uptime checks**. Les règles d'alerte créées via `alert_policies` apparaissent sous **Monitoring → Alerting**.

---

## 10. Explorer avec gcloud {#10-exploring-with-gcloud}

Les commandes `gcloud` suivantes sont utiles pour l'exploitation quotidienne et le dépannage après le déploiement. Remplacez `PROJECT_ID`, `REGION` et `SERVICE_NAME` par vos valeurs réelles.

**Décrire le service Cloud Run :**
```bash
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(spec.template.spec.containers[0].env)"
```

**Afficher l'URL du service et la répartition actuelle du trafic :**
```bash
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(status.url, status.traffic[].revisionName, status.traffic[].percent)"
```

**Lister toutes les révisions et leurs pondérations de trafic :**
```bash
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --sort-by="~metadata.creationTimestamp" \
  --format="table(metadata.name, status.conditions[0].type, status.conditions[0].status, metadata.creationTimestamp)"
```

**Suivre en direct les journaux du service Mattermost :**
```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" \
  --project=PROJECT_ID \
  --format="value(textPayload)" \
  --freshness=10m \
  --order=asc
```

**Consulter l'historique d'exécution du job Cloud Run db-init :**
```bash
gcloud run jobs executions list \
  --job=SERVICE_NAME-db-init \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name, status.conditions[0].type, metadata.creationTimestamp)"
```

**Déclencher manuellement le job db-init (par ex. après une restauration de la base de données) :**
```bash
gcloud run jobs execute SERVICE_NAME-db-init \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Inspecter l'instance Cloud SQL et vérifier la connectivité à la base de données :**
```bash
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier, ipAddresses[].ipAddress)"
```

**Lister les bases de données Cloud SQL de l'instance :**
```bash
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Afficher les secrets Secret Manager du déploiement :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="labels.app=mattermost" \
  --format="table(name, createTime, replication.automatic)"
```

**Accéder à la dernière version du secret du mot de passe de la base de données :**
```bash
gcloud secrets versions access latest \
  --secret=DB_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID
```

**Lister les images de conteneur dans Artifact Registry :**
```bash
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --filter="tags:mattermost" \
  --sort-by="~createTime" \
  --format="table(IMAGE, TAGS, CREATE_TIME, UPDATE_TIME)"
```

**Forcer un nouveau déploiement (redéployer la dernière révision) :**
```bash
gcloud run services update SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --update-env-vars=DEPLOY_TIMESTAMP=$(date +%s)
```

**Vérifier l'état des tests de disponibilité Cloud Monitoring :**
```bash
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName, httpCheck.path, period, selectedRegions)"
```

**Afficher les règles d'alerte actives :**
```bash
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName, enabled, conditions[0].displayName)"
```

**Inspecter le bucket GCS utilisé pour le stockage des fichiers de Mattermost :**
```bash
gsutil ls -l gs://BUCKET_NAME/
gsutil du -s gs://BUCKET_NAME/
```

**Vérifier la présence d'un fichier envoyé précis dans Mattermost :**
```bash
gsutil stat gs://BUCKET_NAME/teams/TEAM_ID/channels/CHANNEL_ID/attachments/FILE_ID
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Mattermost CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Mise en œuvre | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | `database_type = "POSTGRES_15"` par défaut | Mattermost exige PostgreSQL 13 ou une version ultérieure. La chaîne de connexion à la base de données et le pilote sont configurés par `Mattermost Common`. |
| **Volumes GCS FUSE pour les données** | `gcs_volumes` configuré via `Mattermost Common` | `/mattermost/data` est relié à un montage GCS FUSE pour un stockage durable des fichiers lorsque `gcs_volumes` est renseigné. |
| **Mise en miroir des images activée par défaut** | `enable_image_mirroring = true` | L'image Docker Hub de Mattermost est mise en miroir dans Artifact Registry avant le déploiement, ce qui évite de dépendre de registres externes. |
| **Au moins 1 instance** | `min_instance_count = 1` par défaut | Empêche la mise à l'échelle jusqu'à zéro de déconnecter les sessions WebSocket actives des utilisateurs. |
| **Aucun secret applicatif généré automatiquement** | Mattermost génère ses clés au premier démarrage | Les clés de signature internes, les secrets de session et les clés de chiffrement symétrique sont générés par Mattermost lui-même et stockés dans PostgreSQL — et non dans Secret Manager. |
| **Job db-init par défaut** | Fourni par `Mattermost Common` lorsque `initialization_jobs = []` | La base de données et l'utilisateur PostgreSQL sont créés automatiquement avant le démarrage de Mattermost. Fournissez une liste `initialization_jobs` non vide pour le remplacer. |
| **Confiance dans l'en-tête du proxy** | `MM_SERVICESETTINGS_TRUSTEDPROXYIPHEADER=X-Forwarded-For` | Nécessaire pour extraire correctement l'adresse IP du client lorsque Cloud Run se trouve derrière Cloud Armor ou un équilibreur de charge. Injecté automatiquement. |
| **Regroupement des e-mails désactivé** | `MM_EMAILSETTINGS_ENABLEEMAILBATCHING=false` | Le regroupement nécessite des files d'attente persistantes en mémoire, incompatibles avec le modèle d'exécution sans état de Cloud Run. |
| **Variable d'environnement de l'URL du site** | `MM_SERVICESETTINGS_SITEURL` défini à partir de la variable `site_url` | Lorsque `site_url` n'est pas vide, elle est injectée sous la forme `MM_SERVICESETTINGS_SITEURL`. Définissez-la après le premier déploiement pour garantir une génération correcte des liens. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Mattermost CloudRun`, triées par groupe d'interface puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP de déploiement des ressources. |
| `tenant_id` | 1 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 1 | `[]` | Adresses e-mail pour l'accès IAM et les alertes de surveillance. |
| `resource_labels` | 1 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'mattermost'` | Nom de base des ressources. Ne le modifiez pas après le déploiement. |
| `display_name` | 3 | `'Mattermost'` | Nom lisible affiché dans l'interface. |
| `description` | 3 | `'Mattermost - Open-source team messaging and collaboration'` | Description du service. |
| `application_version` | 3 | `'9.11.2'` | Tag de l'image de conteneur Mattermost. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement de l'infrastructure seule. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `""` | URI de l'image de conteneur. Laissez vide pour que Cloud Build la gère. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance. 2 vCPU recommandés. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. |
| `cpu_always_allocated` | 4 | `true` | CPU alloué en permanence. Maintenu à `true` pour la gestion des WebSocket en temps réel. |
| `container_resources` | 4 | `null` | Remplace `cpu_limit` et `memory_limit` lorsqu'elle est définie. |
| `min_instance_count` | 4 | `1` | Conservez `1` pour éviter les déconnexions WebSocket. |
| `max_instance_count` | 4 | `5` | Plafond de coût de la mise à l'échelle automatique. |
| `container_port` | 4 | `8065` | Port HTTP natif de Mattermost. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. Définissez `3600` pour les connexions WebSocket. |
| `enable_cloudsql_volume` | 4 | `true` | Sidecar Cloud SQL Auth Proxy. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met l'image Mattermost en miroir dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP de manière native sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs et comptes de service autorisés via IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés via IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair pour la configuration de Mattermost. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `explicit_secret_values` | 6 | `{}` | Valeurs sensibles brutes écrites dans Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Nombre de secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes automatiques. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_file` | 7 | `'backup.sql'` | Nom du fichier de sauvegarde dans le bucket de sauvegardes géré par le module. |
| `backup_format` | 7 | `'sql'` | Format de la sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images lors du déploiement. |
| `binauthz_evaluation_mode` | 8 | `'ALWAYS_ALLOW'` | `'ALWAYS_ALLOW'`, `'REQUIRE_ATTESTATION'` ou `'ALWAYS_DENY'`. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global et Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lequel les images peuvent être supprimées. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne un stockage partagé NFS. |
| `nfs_mount_path` | 11 | `'/mattermost/data'` | Chemin du conteneur où NFS est monté. |
| `nfs_instance_name` | 11 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 11 | `'app-nfs'` | Nom de base de la VM NFS intégrée. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Mattermost exige PostgreSQL. |
| `db_name` | 12 | `'mattermost'` | Nom de la base de données PostgreSQL. Ne le modifiez pas après le déploiement. |
| `db_user` | 12 | `'mattermost'` | Utilisateur applicatif PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16 à 64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatique des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour utiliser le job `db-init` par défaut de `Mattermost Common`. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run récurrents planifiés. |
| `startup_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=30 }` | Sonde de démarrage. |
| `liveness_probe` | 14 | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, path="/" }` | Inerte pour Mattermost — voir §C. Utilisez plutôt `startup_probe`. |
| `health_check_config` | 14 | `{ enabled=true, path="/" }` | Inerte pour Mattermost — voir §C. Utilisez plutôt `liveness_probe`. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring (désactivé par défaut). |
| `alert_policies` | 14 | `[]` | Règles d'alerte Cloud Monitoring sur les métriques. |
| `site_url` | 20 | `""` | URL publique de Mattermost. Définit `MM_SERVICESETTINGS_SITEURL`. |
| `edition` | 20 | `'team'` | `'team'` (gratuite) ou `'enterprise'` (payante). |
| `enable_redis` | 21 | `false` | Redis pour la mise en cache de Mattermost. Requis avec plusieurs réplicas. |
| `redis_host` | 21 | `""` | Nom d'hôte ou adresse IP de Redis. Utilise par défaut l'adresse IP du serveur NFS lorsqu'il est vide. |
| `redis_port` | 21 | `'6379'` | Port TCP de Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe AUTH de Redis. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement lorsqu'il est vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux Cloud Audit Logs détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP dans laquelle le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |

---

## 14. Pièges de configuration et valeurs par défaut judicieuses {#14-configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critique** | Mattermost exige PostgreSQL 13 ou une version ultérieure. Choisir une variante MySQL ou SQL Server empêche Mattermost de démarrer, avec une erreur de connexion du pilote. |
| `db_name` | `"mattermost"` | **Critique** | Immuable après le premier déploiement — le modifier amène Mattermost à recréer la base de données, ce qui détruit tout l'historique des messages, les utilisateurs et la configuration. |
| `db_user` | `"mattermost"` | **Critique** | Immuable après le premier déploiement — le modifier recrée l'utilisateur Cloud SQL et rompt la connexion à la base de données. |
| `min_instance_count` | `1` | **Élevé** | La mise à l'échelle jusqu'à zéro (`0`) coupe les connexions WebSocket actives (messagerie en temps réel) de tous les utilisateurs en ligne chaque fois que l'instance unique est réduite. Définissez `1` pour tout déploiement de production. |
| `timeout_seconds` | `300` | **Élevé** | Mattermost maintient des connexions WebSocket pour la messagerie en temps réel. Un délai d'expiration de 5 minutes amène Cloud Run à interrompre toutes les connexions WebSocket actives toutes les 5 minutes. Définissez `3600` pour les déploiements de production faisant un usage intensif des WebSocket. |
| `enable_redis` | `false` | **Élevé** | Lorsque plusieurs réplicas s'exécutent (`max_instance_count > 1`), Redis est requis pour le partage distribué des sessions. Sans lui, les utilisateurs subissent des échecs d'authentification intermittents et des données obsolètes, car les requêtes sont acheminées vers différentes instances dotées de caches mémoire indépendants. |
| `site_url` | `""` | **Élevé** | Sans `site_url`, Mattermost utilise `http://localhost:8065` pour générer les liens. Cela casse les liens d'invitation par e-mail, les URI de redirection OAuth et les URL de callback des webhooks. Définissez-la sur l'URL du service Cloud Run ou sur le domaine personnalisé après le premier déploiement. |
| `gcs_volumes` | `[]` | **Élevé** | Sans volume persistant sur `/mattermost/data`, tous les fichiers et pièces jointes envoyés par les utilisateurs sont stockés sur le système de fichiers éphémère du conteneur. Tous les fichiers envoyés sont définitivement perdus lors du déploiement d'une nouvelle révision ou du redémarrage du conteneur. |
| `edition` | `"team"` | **Moyen** | Définir `edition = "enterprise"` sélectionne l'image de conteneur Enterprise Edition. Sans clé de licence valide définie via `environment_variables`, Mattermost démarre en mode d'essai Enterprise et finit par revenir aux fonctionnalités de la Team Edition. |
| `memory_limit` | `"2Gi"` | **Moyen** | Mattermost met en cache en mémoire les listes de canaux, les sessions des utilisateurs et les index des messages. Descendre en dessous de `1Gi` provoque des redémarrages pour OOM sous une activité d'équipe modérée. Passez à `4Gi` pour les équipes de plus de 100 utilisateurs actifs. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours ne suffisent pas pour des équipes actives. Passez à 30 jours ou plus pour toute instance Mattermost de production, afin de permettre une récupération à un instant donné en cas de corruption des données ou de suppression accidentelle. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, Mattermost est exposé directement sur l'URL `*.run.app`. Pour les équipes en production, activez Cloud Armor afin de protéger l'API contre les attaques de bots et le bourrage d'identifiants. |
| `enable_iap` | `false` | **Faible** | Lorsque IAP est désactivé, Mattermost est responsable de sa propre authentification. Envisagez d'activer IAP pour les déploiements internes afin d'ajouter une couche d'authentification supplémentaire avant que les requêtes n'atteignent Mattermost. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multirégionales. Passez à 60–90 s si des secrets sont introuvables pendant l'apply. |

---

## 15. Destruction des ressources {#15-destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur semblable à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve de manière asynchrone les adresses IPv4 sans serveur sur le sous-réseau VPC après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** attendez 20 à 30 minutes après la première tentative de destruction, puis relancez la commande de destruction :

```bash
tofu destroy
```

La deuxième exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mattermost sur Cloud Run](../labs/Mattermost_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module Mattermost GKE — Guide de configuration](Mattermost_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Mattermost Common](Mattermost_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **Team Workspace**.
