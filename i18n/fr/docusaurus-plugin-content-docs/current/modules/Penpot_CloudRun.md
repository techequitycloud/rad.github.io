---
title: "Penpot sur Google Cloud Run"
description: "Référence de configuration pour déployer Penpot sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Penpot_CloudRun.md @ 3055034 sha256:f7d75db23e8a -->

# Penpot sur Google Cloud Run {#penpot-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Penpot_CloudRun.png" alt="Penpot sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète du module `modules/Penpot_CloudRun`. Il couvre l'architecture, IAM, les variables de configuration, les comportements propres à Penpot et les schémas d'exploitation pour déployer Penpot sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Penpot est une plateforme open source de design et de prototypage — une alternative auto-hébergée à Figma. Elle offre l'édition de designs vectoriels, le prototypage interactif, les bibliothèques de composants, les design tokens, la transmission aux développeurs avec inspection du code, et la collaboration multijoueur en temps réel via WebSockets. `Penpot CloudRun` est un **module wrapper** construit au-dessus de `App CloudRun`. Il utilise `App CloudRun` pour tout le provisionnement de l'infrastructure GCP et injecte, via `Penpot Common`, la configuration applicative propre à Penpot, l'architecture multi-services et la configuration du stockage des ressources.

**Capacités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), trois services coordonnés — backend (API HTTP Clojure + serveur WebSocket), frontend (nginx servant la SPA React) et exporter (Chromium headless pour l'export PDF/PNG/SVG). Le backend dispose par défaut de 2 vCPU / 2 Gi.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Bucket GCS de ressources pour les éléments de design (polices, images, miniatures), accessible nativement via Workload Identity / ADC.
*   **Collaboration en temps réel** : Redis est **obligatoire** comme bus d'événements pub/sub WebSocket. Toutes les répliques du backend partagent l'état des événements via la base Redis 0. Sans Redis, l'édition multijoueur en temps réel ne fonctionne plus dès que plus d'une instance backend est en cours d'exécution.
*   **Sécurité** : hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls depuis `App CloudRun`. Aucun secret applicatif n'est généré automatiquement par `Penpot Common`.
*   **Protocole** : `container_protocol` vaut `'http1'` par défaut ; définissez `'h2c'` (HTTP/2 en clair) pour un multiplexage WebSocket de bout en bout.
*   **CI/CD** : pipeline Cloud Build d'image personnalisée par défaut ; livraison progressive Cloud Deploy en option.
*   **Contrôles de santé** : la sonde de démarrage utilise TCP sur le port 6060 (Penpot 2.x n'expose pas de point de terminaison de santé HTTP non authentifié). Le module expose également `startup_probe_config` et `health_check_config` ciblant `/api/health` pour les contrôles de santé de l'équilibreur de charge.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires des e-mails d'alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `region` | 1 | `string` | `'us-central1'` | Région GCP de toutes les ressources. |
| `application_name` | 3 | `string` | `'penpot'` | Nom de base des ressources. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Penpot - Open Source Design Tool'` | Nom lisible affiché dans la console GCP. |
| `description` | 3 | `string` | `'Penpot - Open-source design and prototyping tool for teams'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image Penpot appliqué aux trois services. |

**Architecture wrapper :** `Penpot CloudRun` appelle `Penpot Common` pour construire l'objet de configuration applicative contenant les variables d'environnement propres à Penpot, la configuration des sondes et les définitions multi-services du backend, du frontend et de l'exporter. `module_storage_buckets` transporte le bucket `penpot-assets` provisionné par `Penpot Common`. `scripts_dir` est résolu en `abspath("${module.penpot_app.path}/scripts")` au moment de l'apply.

**Note sur PostgreSQL :** Penpot nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être remplacée par MySQL ou SQL Server — le backend Clojure de Penpot ne prend en charge que PostgreSQL.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Penpot_CloudRun` délègue tout le provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux de `App_CloudRun`.

**Aucun secret applicatif :** `Penpot Common` ne génère pas automatiquement de secrets applicatifs (aucun équivalent de `SECRET_KEY` ou `DIRECTUS_KEY`). Penpot gère ses propres clés de signature internes à l'exécution. Le secret `DB_PASSWORD` est provisionné automatiquement par `App CloudRun`. Les secrets définis par l'utilisateur — y compris un mot de passe SMTP — peuvent être ajoutés via `secret_environment_variables`.

**Accès aux ressources GCS :** le backend Penpot lit et écrit les éléments de design (images, polices, miniatures) dans le bucket GCS `penpot-assets`. L'accès est accordé via la liaison Workload Identity du compte de service Cloud Run — aucun identifiant explicite n'est nécessaire. `PENPOT_STORAGE_BACKEND=gcs` et `PENPOT_STORAGE_GCS_BUCKET_NAME` sont injectés automatiquement.

**Délai de propagation IAM de 120 secondes :** hérité de `App CloudRun` — les services Penpot ne sont pas déployés avant la fin de ce délai, ce qui évite les échecs de lecture de secrets au premier démarrage d'une révision.

Pour les tableaux complets des rôles et les détails sur IAP, la rotation des mots de passe et l'accès public, consultez la documentation de `App_CloudRun`.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Le backend de Penpot est une application JVM Clojure. Les démarrages à froid exigent l'initialisation de la JVM et l'exécution des migrations PostgreSQL par l'application, ce qui peut prendre 60 à 120 secondes au premier démarrage. `min_instance_count` vaut `0` par défaut (mise à l'échelle à zéro, priorité au coût) ; définissez-le à `1` pour garder le backend actif pour la collaboration en temps réel, lorsque les utilisateurs attendent une connexion instantanée.

**Protocole du conteneur :** `container_protocol` vaut `'http1'` par défaut. Définissez `'h2c'` (HTTP/2 en clair) pour activer le multiplexage WebSocket sur la même connexion pour l'édition multijoueur en temps réel.

**Déploiement multi-services :** le frontend (nginx, port 80) et l'exporter (Chromium headless) sont déployés comme services Cloud Run supplémentaires aux côtés du backend principal. La variable `PENPOT_PUBLIC_URI` est automatiquement définie sur l'URL prévue du service frontend. Pour les domaines personnalisés, mettez à jour `PENPOT_PUBLIC_URI` via `environment_variables` afin qu'elle corresponde à l'URL réellement utilisée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement (PostgreSQL, GCS, secrets). |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance backend. 2 vCPU minimum pour la JVM et la gestion des WebSockets. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance backend. Augmentez à 4 Gi pour les grandes équipes ou les designs complexes. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances backend. Portez-le à 1 ou plus pour la collaboration en temps réel. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances backend. |
| `container_port` | 4 | `6060` | Port HTTP + WebSocket du backend Penpot. Ne pas modifier. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `3600` | Durée maximale d'une requête. Un délai long permet les grosses opérations d'export. |
| `enable_cloudsql_volume` | 4 | `true` | Se connecte à Cloud SQL par socket Unix via le sidecar Auth Proxy. |
| `container_protocol` | 4 | `'http1'` | Définissez `'h2c'` pour un multiplexage WebSocket HTTP/2 de bout en bout. |
| `enable_image_mirroring` | 4 | `true` | Copie les images Penpot dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green en pourcentages. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Penpot CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `6060` | Port natif du backend Penpot. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | La JVM exige plus de marge mémoire que les applications Node.js/Python classiques. |
| `enable_image_mirroring` | `false` | `true` | Les images Penpot proviennent de Docker Hub ; la copie évite les limites de débit. |
| `timeout_seconds` | `300` | `3600` | Les grosses opérations d'export (PDF/PNG de designs complexes) peuvent prendre plusieurs minutes. |

### B. Flags de fonctionnalités Penpot et réglage de la JVM {#b-penpot-feature-flags--jvm-tuning}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `penpot_flags` | 5 | `'enable-registration enable-login disable-demo-users'` | Flags de fonctionnalités Penpot séparés par des espaces. Flags principaux : `enable-registration` (autoriser l'inscription libre), `disable-registration` (sur invitation uniquement), `enable-login-with-password`, `enable-oidc-<provider>`. |
| `jvm_max_heap` | 5 | `'1g'` | Tas maximal de la JVM. Fixez-le à environ la moitié de `memory_limit`. Pour un conteneur de 2 Gi, `'1g'` convient ; pour 4 Gi, utilisez `'2g'`. |
| `jvm_min_heap` | 5 | `'512m'` | Tas initial de la JVM. Détermine la quantité de mémoire que la JVM réserve au démarrage. |

### C. Base de données (Cloud SQL — PostgreSQL 15) {#c-database-cloud-sql--postgresql-15}

Penpot nécessite **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut. Contrairement à Ghost (MySQL), toutes les fonctionnalités standard de PostgreSQL sont disponibles. Penpot exécute ses propres migrations de base de données au démarrage — aucun job `db-init` distinct n'est nécessaire ni fourni par `Penpot Common`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `db_name` | 13 | `'penpot'` | Nom de la base de données PostgreSQL. **Ne pas modifier après le déploiement initial.** |
| `db_user` | 13 | `'penpot'` | Utilisateur applicatif PostgreSQL. Mot de passe généré automatiquement et stocké dans Secret Manager. |
| `database_type` | 13 | `'POSTGRES_15'` | Moteur de base de données Cloud SQL. Ne pas modifier — Penpot nécessite PostgreSQL. |
| `database_password_length` | 13 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 6 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 6 | `90` | Secondes d'attente après la rotation avant le redémarrage des services. |

### D. Stockage (bucket GCS de ressources) {#d-storage-gcs-assets-bucket}

`Penpot Common` provisionne automatiquement un bucket GCS `penpot-assets` pour les éléments de design (polices, images téléversées par les utilisateurs, miniatures). Le backend accède à ce bucket via `PENPOT_STORAGE_BACKEND=gcs` et ADC/Workload Identity — aucun identifiant explicite n'est nécessaire.

NFS est également disponible (`enable_nfs = true`) pour le stockage de fichiers partagé. Lorsque `redis_host` n'est pas fourni, le module utilise à défaut l'adresse IP du serveur NFS comme hôte Redis.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `create_cloud_storage` | 12 | `true` | Définissez `false` pour ignorer la création de buckets supplémentaires. Le bucket `penpot-assets` de `Penpot Common` est toujours provisionné. |
| `storage_buckets` | 12 | `[]` | Buckets GCS supplémentaires en plus du bucket de ressources provisionné automatiquement. |
| `enable_nfs` | 12 | `true` | Provisionne un volume NFS pour le stockage partagé. Sert aussi d'hôte Redis de repli. |
| `nfs_mount_path` | 12 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. |
| `gcs_volumes` | 12 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `manage_storage_kms_iam` | 12 | `false` | Crée un trousseau de clés KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 12 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### E. Réseau {#e-networking}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 8 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 8 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` n'achemine via le VPC que le trafic RFC 1918. |

### F. Initialisation {#f-initialization}

Penpot exécute ses propres migrations PostgreSQL au démarrage du backend. Aucun job Cloud Run `db-init` distinct n'est injecté par `Penpot Common` — le processus Clojure du backend applique automatiquement les migrations avant que l'application n'accepte du trafic. Prévoyez 60 à 120 secondes pour le premier démarrage.

Les jobs d'initialisation et les jobs cron personnalisés restent pris en charge via les variables `initialization_jobs` et `cron_jobs`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 15 | `[]` | Jobs Cloud Run ponctuels exécutés pendant le déploiement. Laissez vide — Penpot gère ses propres migrations. |
| `cron_jobs` | 15 | `[]` | Jobs Cloud Run planifiés récurrents. Chaque entrée : `name`, `schedule`, `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une stratégie Cloud Armor WAF (OWASP Top 10, protection DDoS adaptative, limitation de débit à 500 req/min) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 14 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés et la protection DDoS. |
| `admin_ip_ranges` | 14 | `[]` | Plages CIDR exemptées des règles WAF (par ex. VPN de l'équipe design, IP de sortie CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, une authentification par identité Google est exigée avant que les requêtes n'atteignent Penpot. Utile pour restreindre l'accès aux équipes design internes sans gérer de comptes Penpot pour chaque visiteur.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 8 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 8 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 8 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run exige que les images Penpot déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 10 | `false` | Impose l'attestation des images. Nécessite une stratégie Binary Authorization préconfigurée dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont confinés dans un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 18 | `false` | Inscrit les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister. |
| `vpc_cidr_ranges` | 18 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. Découvertes automatiquement si vide. |
| `vpc_sc_dry_run` | 18 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | 18 | `""` | Remplacement de l'ID d'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet si vide. |
| `enable_audit_logging` | 18 | `false` | Active les Cloud Audit Logs détaillés (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets Penpot sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de chaque révision.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Correspondance nom de variable d'environnement → ID de secret Secret Manager. À utiliser pour les mots de passe SMTP, les secrets client OIDC, etc. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret avant que les ressources dépendantes ne continuent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG sans serveur est provisionné. Le trafic circule ainsi : Internet → Cloud Armor → équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Penpot à passer par l'équilibreur de charge, ce qui empêche l'accès direct à l'URL `*.run.app`. C'est recommandé pour les déploiements de production où l'adresse IP de l'équilibreur de charge est le point d'entrée de référence.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est rattaché au backend de l'équilibreur de charge HTTPS.

**Point d'attention Penpot :** Penpot sert à la fois des appels d'API de design authentifiés et des ressources statiques du frontend (SPA React, CSS, polices). Le CDN convient bien aux ressources statiques du frontend, mais ne doit pas mettre en cache les réponses d'API ni les connexions WebSocket. Le frontend nginx sert les ressources avec des en-têtes de cache appropriés ; l'API du backend ne doit pas être mise en cache par le CDN.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 14 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 14 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 14 | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | 14 | `30` | Nombre de jours après lequel les images deviennent éligibles à la suppression. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont rattachés à l'équilibreur de charge HTTPS global via `application_domains`. Les certificats SSL gérés par Google sont provisionnés automatiquement.

**Important pour Penpot :** après avoir ajouté un domaine personnalisé, définissez `PENPOT_PUBLIC_URI` via `environment_variables` pour qu'elle corresponde à l'URL du domaine personnalisé. Penpot utilise `PENPOT_PUBLIC_URI` pour générer les liens des e-mails d'invitation et pour acheminer les connexions WebSocket. Une incohérence provoque des liens d'invitation cassés et des échecs de connexion WebSocket.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 14 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. (par ex. `['design.example.com']`) |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 10 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 10 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 10 | `""` | PAT GitHub (portées `repo`, `admin:repo_hook`). Sensible. |
| `github_app_installation_id` | 10 | `""` | ID d'installation de la GitHub App (préférable pour les dépôts d'organisation). |
| `cicd_trigger_config` | 10 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est remplacé par un pipeline de livraison Cloud Deploy géré, avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 10 | `false` | Provisionne un pipeline Cloud Deploy. |
| `cloud_deploy_stages` | 10 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count` vaut `0` par défaut (mise à l'échelle à zéro). Le définir à `1` maintient en permanence au moins une instance backend en cours d'exécution, ce qui compte pour Penpot car :

1. Les connexions WebSocket des collaborateurs actifs sont interrompues lors des mises à l'échelle à zéro.
2. Les démarrages à froid de la JVM prennent 30 à 60 secondes, pendant lesquelles les nouvelles tentatives de connexion échouent.
3. La collaboration en temps réel exige une connexion persistante au bus d'événements via Redis.

Redis gère la diffusion WebSocket entre les répliques du backend, de sorte que la mise à l'échelle horizontale est sûre. Toutes les instances backend publient sur le même canal Redis et s'y abonnent, et les événements de modification de design sont diffusés à tous les clients connectés, quelle que soit l'instance à laquelle ils sont connectés.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge pour les déploiements canary.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentages entre des révisions nommées. La somme des entrées doit être égale à 100. Vide, 100 % du trafic va à la dernière révision. |

**Point d'attention Penpot :** les déploiements canary exigent une gestion attentive des connexions WebSocket. Les sessions actives connectées à l'ancienne révision y restent jusqu'à leur reconnexion. Prévoyez que les deux révisions soient actives simultanément pendant la fenêtre canary.

### C. Sondes de santé {#c-health-probes}

Penpot 2.x n'expose pas de point de terminaison de santé HTTP non authentifié sur le chemin racine. Le module utilise une **sonde de démarrage TCP** sur le port 6060 (qui vérifie que le processus backend est à l'écoute), combinée à `startup_probe_config` et `health_check_config` ciblant `/api/health` pour les contrôles de santé de l'équilibreur de charge.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 16 | `{ type="TCP", port=6060, initial_delay_seconds=5, period_seconds=5, failure_threshold=40 }` | Sonde de démarrage TCP. Autorise jusqu'à 200 secondes de démarrage au total (5s × 40). |
| `liveness_probe` | 16 | `{ enabled=false }` | Désactivée par défaut — Cloud Run ne prend pas en charge les sondes de vivacité TCP. |
| `startup_probe_config` | 16 | `{ enabled=true, type="TCP", path="/api/health", timeout_seconds=240 }` | Sonde de démarrage alternative pour les contrôles de santé de l'équilibreur de charge. |
| `health_check_config` | 16 | `{ enabled=true, type="HTTP", path="/api/health", period_seconds=10 }` | Sonde de vivacité HTTP ciblant `/api/health`. |
| `uptime_check_config` | 16 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif. Les alertes sont envoyées à `support_users`. |
| `alert_policies` | 16 | `[]` | Règles d'alerte sur métriques Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job Cloud Run de rotation.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur PostgreSQL Cloud SQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le backend Penpot.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 6 | `false` | Active la rotation automatisée des mots de passe. |
| `rotation_propagation_delay_sec` | 6 | `90` | Secondes d'attente après la rotation avant le redémarrage des services. |

---

## 8. Intégrations {#8-integrations}

### A. Redis (obligatoire pour les déploiements multi-instances) {#a-redis-mandatory-for-multi-instance-deployments}

Redis est **activé par défaut** (`enable_redis = true`). Penpot utilise Redis comme bus d'événements pub/sub WebSocket. Lorsqu'un designer effectue une modification, le backend publie l'événement dans Redis, et toutes les autres instances backend le reçoivent et le transmettent à leurs clients WebSocket connectés. Sans Redis, la collaboration en temps réel ne fonctionne que si tous les clients sont connectés à la même instance backend — ce qui n'est pas garanti avec l'équilibrage de charge de Cloud Run.

Lorsque `enable_redis = true` et que `redis_host` n'est pas fourni, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis. Pour les déploiements de production comportant plusieurs instances backend, faites pointer `redis_host` vers une instance dédiée Google Cloud Memorystore for Redis.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 17 | `true` | Active Redis pour le pub/sub WebSocket. Obligatoire pour la collaboration multi-instances. |
| `redis_host` | 17 | `""` | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS. Utilisez Memorystore en production. |
| `redis_port` | 17 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 17 | `""` | Mot de passe AUTH de Redis. Sensible — jamais stocké dans l'état. |

### B. E-mail (SMTP) {#b-email-smtp}

Penpot utilise SMTP pour les invitations d'équipe et les réinitialisations de mot de passe. `smtp_enabled` doit être défini à `true` pour activer l'envoi d'e-mails. Contrairement à d'autres modules, SMTP est désactivé par défaut dans Penpot CloudRun — il doit être activé explicitement.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `smtp_enabled` | 7 | `false` | Active l'envoi d'e-mails SMTP. Doit valoir `true` pour que les invitations et les réinitialisations de mot de passe fonctionnent. |
| `smtp_from` | 7 | `""` | Adresse d'expéditeur par défaut. (par ex. `'noreply@example.com'`) |
| `smtp_reply_to` | 7 | `""` | Adresse de réponse par défaut. |
| `smtp_host` | 7 | `""` | Nom d'hôte du serveur SMTP. |
| `smtp_port` | 7 | `587` | Port SMTP. `587` pour STARTTLS, `465` pour SSL. |
| `smtp_username` | 7 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_use_tls` | 7 | `true` | Active STARTTLS. |
| `smtp_use_ssl` | 7 | `false` | Active SSL/TLS. |

Pour le mot de passe SMTP, utilisez `secret_environment_variables` :

```
secret_environment_variables = {
  PENPOT_SMTP_PASSWORD = "penpot-smtp-password"
}
```

### C. Import de sauvegarde et restauration {#c-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde PostgreSQL existante dans l'instance Cloud SQL provisionnée pendant l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 9 | `'0 2 * * *'` | Expression cron (UTC) des sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 9 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 9 | `false` | Déclenche une restauration unique lors de l'apply. Repassez à `false` après un import réussi. |
| `backup_source` | 9 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 9 | `""` | URI GCS complet (par ex. `'gs://my-bucket/penpot-2024-01.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 9 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### D. Scripts SQL personnalisés {#d-custom-sql-scripts}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_custom_sql_scripts` | 11 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 11 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 11 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 11 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |

### E. Observabilité et alertes {#e-observability--alerting}

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 16 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif sur `/api/health`. |
| `alert_policies` | 16 | `[]` | Règles d'alerte personnalisées. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées lors du déclenchement des tests de disponibilité et des règles d'alerte. |

---

## 9. Explorer avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, les chemins suivants de la console GCP sont les plus utiles pour comprendre et valider le déploiement Penpot.

**Services Cloud Run**

Accédez à **Cloud Run** dans la console GCP. Vous verrez plusieurs services :
- Le service backend principal de Penpot (port 6060) avec son URL `*.run.app`.
- Le service frontend (nginx, port 80), dont l'URL est le point d'entrée des utilisateurs.
- Le service exporter (Chromium headless) pour l'export PDF/PNG/SVG.

Cliquez sur le service backend pour afficher :
- L'onglet **Revisions** : révision active, répartition du trafic, nombre d'instances.
- L'onglet **Logs** : messages de démarrage de la JVM, sortie des migrations, événements de connexion WebSocket.
- L'onglet **Metrics** : nombre de requêtes, centiles de latence, nombre d'instances dans le temps, utilisation CPU/mémoire du conteneur.

**Cloud SQL**

Accédez à **SQL** dans la console GCP. L'instance PostgreSQL 15 de Penpot affiche :
- Le nom de connexion (nécessaire pour `gcloud sql connect`).
- Les connexions en cours et les informations sur les requêtes.
- La planification des sauvegardes automatisées et l'horodatage de la dernière sauvegarde.

Cliquez sur le nom de l'instance, puis sur **Databases** pour vérifier que la base de données `penpot` existe, et sur **Users** pour vérifier que l'utilisateur `penpot` est présent.

**Cloud Storage**

Accédez à **Cloud Storage → Buckets**. Le bucket `penpot-assets` stocke :
- `thumbnails/` — les images de miniatures des fichiers de design.
- `objects/` — les éléments de design téléversés (images, polices).

Vérifiez que le bucket existe et que le compte de service Cloud Run dispose de `roles/storage.objectAdmin` sur celui-ci.

**Secret Manager**

Accédez à **Security → Secret Manager**. Les secrets provisionnés pour ce déploiement comprennent :
- `DB_PASSWORD` (mot de passe de l'utilisateur applicatif PostgreSQL de Penpot).

Si SMTP est activé, votre secret SMTP apparaîtra également ici s'il a été ajouté via `secret_environment_variables`.

**Tests de disponibilité de Monitoring**

Accédez à **Monitoring → Uptime checks**. Le test de disponibilité de Penpot interroge `/api/health` depuis plusieurs régions GCP dans le monde. Un test en échec déclenche un e-mail d'alerte à `support_users`.

**Artifact Registry**

Accédez à **Artifact Registry**. Les images backend, frontend et exporter de Penpot y sont stockées après leur copie depuis Docker Hub. Vérifiez que les trois images sont présentes et correctement taguées.

---

## 10. Explorer avec gcloud {#10-exploring-with-gcloud}

Les commandes gcloud suivantes sont utiles pour inspecter le déploiement Penpot sur Cloud Run et en diagnostiquer les problèmes. Remplacez `PROJECT_ID`, `REGION` et `SERVICE_NAME` par vos valeurs réelles.

**Lister tous les services Cloud Run Penpot du projet :**
```bash
gcloud run services list \
  --project=PROJECT_ID \
  --region=REGION \
  --filter="metadata.name:penpot" \
  --format="table(metadata.name,status.url,status.conditions[0].status)"
```

**Décrire le service backend Penpot (affiche les variables d'environnement, la mise à l'échelle, la répartition du trafic) :**
```bash
gcloud run services describe penpot-backend \
  --project=PROJECT_ID \
  --region=REGION \
  --format=yaml
```

**Vérifier la révision actuelle et le nombre d'instances :**
```bash
gcloud run revisions list \
  --project=PROJECT_ID \
  --region=REGION \
  --service=penpot-backend \
  --format="table(metadata.name,status.observedGeneration,spec.containerConcurrency,status.conditions[0].status)"
```

**Suivre en direct les journaux du backend Penpot :**
```bash
gcloud run services logs tail penpot-backend \
  --project=PROJECT_ID \
  --region=REGION
```

**Récupérer les journaux récents filtrés sur les seules erreurs :**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="penpot-backend" AND severity>=ERROR' \
  --project=PROJECT_ID \
  --limit=50 \
  --format="table(timestamp,jsonPayload.message)"
```

**Vérifier l'état de l'instance Cloud SQL :**
```bash
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,databaseVersion,settings.dataDiskSizeGb,ipAddresses[0].ipAddress)"
```

**Lister les bases de données Cloud SQL de l'instance Penpot :**
```bash
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID
```

**Se connecter à la base de données PostgreSQL de Penpot (nécessite Cloud SQL Auth Proxy ou Cloud Shell) :**
```bash
gcloud sql connect INSTANCE_NAME \
  --user=penpot \
  --database=penpot \
  --project=PROJECT_ID
```

**Lister le contenu du bucket GCS penpot-assets par préfixe :**
```bash
gcloud storage ls gs://penpot-assets-PROJECT_ID/thumbnails/ --recursive
```

**Vérifier les secrets Secret Manager de ce déploiement :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name:penpot" \
  --format="table(name,createTime,replication.automatic)"
```

**Récupérer le mot de passe actuel de la base de données (à des fins de diagnostic uniquement) :**
```bash
gcloud secrets versions access latest \
  --secret=penpot-db-password \
  --project=PROJECT_ID
```

**Vérifier les instances Memorystore Redis (en cas d'utilisation d'un Redis dédié) :**
```bash
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"
```

**Lister les jobs Cloud Run (jobs d'initialisation ou cron) :**
```bash
gcloud run jobs list \
  --project=PROJECT_ID \
  --region=REGION \
  --filter="metadata.name:penpot" \
  --format="table(metadata.name,status.latestCreatedExecution.completionTimestamp,status.latestCreatedExecution.succeededCount)"
```

**Vérifier la présence des images Penpot copiées dans Artifact Registry :**
```bash
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY \
  --filter="package:penpot" \
  --format="table(package,tags,createTime,updateTime)"
```

**Vérifier que le compte de service Cloud Run a accès au bucket de ressources :**
```bash
gcloud storage buckets get-iam-policy gs://penpot-assets-PROJECT_ID \
  --format="table(bindings.role,bindings.members)"
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Penpot CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Mise en œuvre | Détail |
|---|---|---|
| **PostgreSQL 15 requis** | Valeur par défaut `database_type = "POSTGRES_15"` | Penpot ne prend en charge que PostgreSQL. Ne pas remplacer par MySQL ou SQL Server. |
| **Aucun job db-init** | Penpot exécute ses propres migrations au démarrage | Contrairement à Django ou Ghost, aucun job Cloud Run `db-init` n'est injecté. Le processus Clojure de Penpot applique automatiquement les migrations au premier démarrage. |
| **Protocole http1 par défaut** | `container_protocol = "http1"` | Définissez `"h2c"` (HTTP/2 en clair) pour activer le multiplexage WebSocket pour la collaboration en temps réel. |
| **Mise à l'échelle à zéro par défaut** | Valeur par défaut `min_instance_count = 0` | Valeur par défaut privilégiant le coût. Définissez `1` pour une collaboration active — les sessions WebSocket sont interrompues lors de la réduction d'échelle. |
| **Bucket GCS de ressources** | Bucket `penpot-assets` provisionné par `Penpot Common` | Utilisé pour le stockage des éléments de design. Accessible via `PENPOT_STORAGE_BACKEND=gcs`. |
| **Copie des images activée par défaut** | Valeur par défaut `enable_image_mirroring = true` | Les trois images Penpot sont copiées dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| **Redis pour la diffusion WebSocket** | Valeur par défaut `enable_redis = true` | Sans Redis, la collaboration en temps réel ne fonctionne plus avec l'équilibrage de charge entre plusieurs instances. |
| **Délai de requête long** | Valeur par défaut `timeout_seconds = 3600` | Les exports PDF et PNG de designs complexes de plusieurs pages peuvent prendre plusieurs minutes. |
| **Aucun secret applicatif généré automatiquement** | `module_secret_env_vars = {}` | Penpot gère ses propres clés de signature internes. Aucun équivalent de `SECRET_KEY` n'est créé. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur, triées par groupe d'interface puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP de déploiement. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail des alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'penpot'` | Nom de base des ressources. Ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Penpot - Open Source Design Tool'` | Nom lisible. |
| `description` | 3 | `'Penpot - Open-source design and prototyping tool for teams'` | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image de conteneur Penpot. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement. |
| `cpu_limit` | 4 | `'2000m'` | CPU par instance backend. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance backend. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances backend. Portez-le à 1 pour la collaboration en temps réel. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances backend. |
| `container_port` | 4 | `6060` | Port du backend Penpot. Ne pas modifier. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | 4 | `3600` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | 4 | `true` | Se connecte via le socket Unix de Cloud SQL Auth Proxy. |
| `container_protocol` | 4 | `'http1'` | Définissez `'h2c'` pour le multiplexage WebSocket HTTP/2. |
| `enable_image_mirroring` | 4 | `true` | Copie les images dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `penpot_flags` | 5 | `'enable-registration enable-login disable-demo-users'` | Flags de fonctionnalités Penpot. |
| `jvm_max_heap` | 5 | `'1g'` | Tas maximal de la JVM. ~50 % de `memory_limit`. |
| `jvm_min_heap` | 5 | `'512m'` | Tas initial de la JVM. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `enable_auto_password_rotation` | 6 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 6 | `90` | Secondes après la rotation avant le redémarrage des services. |
| `smtp_enabled` | 7 | `false` | Active l'e-mail SMTP. Requis pour les invitations et les réinitialisations de mot de passe. |
| `smtp_from` | 7 | `""` | Adresse e-mail de l'expéditeur. |
| `smtp_reply_to` | 7 | `""` | Adresse e-mail de réponse. |
| `smtp_host` | 7 | `""` | Nom d'hôte du serveur SMTP. |
| `smtp_port` | 7 | `587` | Port SMTP. |
| `smtp_username` | 7 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_use_tls` | 7 | `true` | Active STARTTLS. |
| `smtp_use_ssl` | 7 | `false` | Active SSL/TLS. |
| `ingress_settings` | 8 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 8 | `'PRIVATE_RANGES_ONLY'` | Routage de sortie VPC. |
| `enable_iap` | 8 | `false` | Active IAP sur le service Cloud Run. |
| `iap_authorized_users` | 8 | `[]` | Utilisateurs/comptes de service disposant de l'accès IAP. |
| `iap_authorized_groups` | 8 | `[]` | Groupes Google disposant de l'accès IAP. |
| `backup_schedule` | 9 | `'0 2 * * *'` | Expression cron des sauvegardes automatisées. |
| `backup_retention_days` | 9 | `7` | Nombre de jours de conservation des fichiers de sauvegarde. |
| `enable_backup_import` | 9 | `false` | Déclenche une restauration unique lors de l'apply. |
| `backup_source` | 9 | `'gcs'` | `'gcs'` ou `'gdrive'`. |
| `backup_uri` | 9 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 9 | `'sql'` | Format de sauvegarde. |
| `enable_cicd_trigger` | 10 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 10 | `""` | URL GitHub HTTPS complète. |
| `github_token` | 10 | `""` | PAT GitHub. Sensible. |
| `github_app_installation_id` | 10 | `""` | ID d'installation de la GitHub App. |
| `cicd_trigger_config` | 10 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 10 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 10 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy. |
| `enable_binary_authorization` | 10 | `false` | Impose l'attestation des images. |
| `enable_custom_sql_scripts` | 11 | `false` | Exécute des scripts SQL depuis GCS. |
| `custom_sql_scripts_bucket` | 11 | `""` | Bucket GCS des scripts SQL. |
| `custom_sql_scripts_path` | 11 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 11 | `false` | Exécute les scripts en tant qu'utilisateur root de la base de données. |
| `create_cloud_storage` | 12 | `true` | Définissez `false` pour ignorer la création de buckets supplémentaires. |
| `storage_buckets` | 12 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 12 | `true` | Provisionne un stockage partagé NFS. |
| `nfs_mount_path` | 12 | `'/mnt/nfs'` | Chemin de montage NFS dans le conteneur. |
| `nfs_instance_name` | 12 | `""` | Nom d'une VM NFS existante. |
| `nfs_instance_base_name` | 12 | `'app-nfs'` | Nom de base de la VM NFS intégrée. |
| `gcs_volumes` | 12 | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` | 12 | `false` | Clé KMS CMEK pour les buckets de stockage. |
| `enable_artifact_registry_cmek` | 12 | `false` | CMEK pour les images Artifact Registry. |
| `database_type` | 13 | `'POSTGRES_15'` | Moteur Cloud SQL. Ne pas modifier. |
| `db_name` | 13 | `'penpot'` | Nom de la base de données PostgreSQL. Immuable. |
| `db_user` | 13 | `'penpot'` | Utilisateur applicatif PostgreSQL. Immuable. |
| `database_password_length` | 13 | `32` | Longueur du mot de passe généré automatiquement. |
| `enable_cloud_armor` | 14 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 14 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 14 | `[]` | Domaines personnalisés avec SSL géré par Google. |
| `enable_cdn` | 14 | `false` | Active Cloud CDN sur l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 14 | `7` | Nombre maximal d'images Artifact Registry à conserver. |
| `delete_untagged_images` | 14 | `true` | Supprime les images orphelines d'Artifact Registry. |
| `image_retention_days` | 14 | `30` | Nombre de jours avant que les images ne deviennent éligibles à la suppression. |
| `initialization_jobs` | 15 | `[]` | Jobs Cloud Run ponctuels. Laissez vide — Penpot gère ses propres migrations. |
| `cron_jobs` | 15 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 16 | Sonde TCP, port 6060, 40 tentatives | Sonde de démarrage TCP. |
| `liveness_probe` | 16 | `{ enabled=false }` | Désactivée — Cloud Run ne prend pas en charge la vivacité TCP. |
| `startup_probe_config` | 16 | `{ enabled=true, type="TCP", timeout_seconds=240 }` | Sonde de démarrage de l'équilibreur de charge. |
| `health_check_config` | 16 | `{ enabled=true, type="HTTP", path="/api/health" }` | Sonde de vivacité HTTP. |
| `uptime_check_config` | 16 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | 16 | `[]` | Règles d'alerte sur métriques Cloud Monitoring. |
| `enable_redis` | 17 | `true` | Redis pour le pub/sub WebSocket. Obligatoire en multi-instances. |
| `redis_host` | 17 | `""` | Nom d'hôte/adresse IP de Redis. Par défaut, l'adresse IP du serveur NFS. |
| `redis_port` | 17 | `'6379'` | Port TCP de Redis. |
| `redis_auth` | 17 | `""` | Mot de passe AUTH de Redis. Sensible. |
| `enable_vpc_sc` | 18 | `false` | Application du périmètre VPC-SC. |
| `vpc_cidr_ranges` | 18 | `[]` | Plages CIDR VPC-SC. |
| `vpc_sc_dry_run` | 18 | `true` | Journalise les violations sans les bloquer. |
| `organization_id` | 18 | `""` | ID d'organisation GCP pour VPC-SC. |
| `enable_audit_logging` | 18 | `false` | Cloud Audit Logs détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run backend de Penpot. |
| `backend_url` | URL publique du service Cloud Run backend. |
| `frontend_url` | URL publique du service Cloud Run frontend (nginx) — l'URL qu'ouvrent les utilisateurs. |
| `exporter_url` | URL publique du service Cloud Run exporter. |
| `service_location` | Région GCP du déploiement. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL 15. |
| `database_name` | Nom de la base de données applicative de Penpot. |
| `database_user` | Nom de l'utilisateur de la base de données applicative de Penpot. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (y compris `penpot-assets`). |
| `container_image` | Image de conteneur utilisée pour le déploiement du backend. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD. |

---

## Pièges de configuration et valeurs par défaut raisonnables {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critical** (perte de données, panne totale, faille de sécurité) — **High** (service indisponible ou dégradation importante) — **Medium** (fonctionnement dégradé ou coût accru) — **Low** (impact mineur).

| Variable | Valeur par défaut raisonnable | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critical** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"POSTGRES_15"` | **Critical** | Penpot ne prend en charge que PostgreSQL. Toute autre valeur fait échouer le backend au démarrage. |
| `container_protocol` | `"h2c"` pour le multijoueur (valeur par défaut du module : `"http1"`) | **Critical** | Avec `"http1"`, le multiplexage WebSocket n'est pas disponible et la collaboration en temps réel se dégrade. Les designs peuvent toujours être enregistrés, mais l'édition multijoueur peut ne pas fonctionner. |
| `min_instance_count` | `1` pour une collaboration active (valeur par défaut du module : `0`) | **High** | Avec la mise à l'échelle à zéro, les sessions WebSocket actives sont interrompues et tous les collaborateurs sont déconnectés. Les démarrages à froid de la JVM entraînent des délais de reconnexion de 30 à 60 secondes. |
| `redis_host` | `""` (résolu automatiquement vers l'IP NFS) | **High** | Si `enable_nfs = false` et que `redis_host` est également vide, le backend ne peut pas se connecter à Redis et la collaboration multi-instances ne pourra pas démarrer. |
| `enable_redis` | `true` | **High** | Désactiver Redis rompt la collaboration en temps réel dès qu'il y a équilibrage de charge. Les déploiements à instance unique survivent sans Redis, mais la mise à l'échelle devient impossible. |
| `jvm_max_heap` | `"1g"` | **High** | Doit être inférieur à `memory_limit`. Définir `jvm_max_heap = "2g"` sur un conteneur `memory_limit = "2Gi"` ne laisse aucune marge pour la mémoire hors tas de la JVM, ce qui provoque un OOMKill. Un ratio sûr est 50 % de `memory_limit`. |
| `memory_limit` | `"2Gi"` | **High** | La JVM de Penpot a besoin de marge pour la mémoire hors tas, les tampons NIO et le metaspace. Descendre sous `1Gi` provoque de fréquents OOMKill sous des charges de travail réelles. |
| `db_name` | `"penpot"` | **Critical** | Immuable après le déploiement. Le modifier amène Terraform à recréer la base de données, ce qui détruit tous les designs, fichiers et données d'équipe Penpot. |
| `db_user` | `"penpot"` | **Critical** | Immuable après le déploiement. Le modifier recrée l'utilisateur Cloud SQL et rompt toutes les connexions à la base de données. |
| `penpot_flags` | `"enable-registration enable-login disable-demo-users"` | **Medium** | Laisser `enable-registration` actif sur un déploiement public permet à n'importe qui de créer un compte. Utilisez `disable-registration` pour les déploiements réservés à une équipe et invitez les utilisateurs par e-mail. |
| `smtp_enabled` | `false` | **High** | Avec SMTP désactivé, Penpot ne peut pas envoyer d'invitations d'équipe ni d'e-mails de réinitialisation de mot de passe. Les nouveaux membres ne peuvent être ajoutés que par un administrateur via la création directe de compte. |
| `application_domains` | `[]` | **Medium** | Sans domaine personnalisé, `PENPOT_PUBLIC_URI` est définie sur l'URL `*.run.app` prévue. Si les utilisateurs accèdent à Penpot via un domaine personnalisé sans mise à jour de `PENPOT_PUBLIC_URI`, les liens des e-mails d'invitation pointent vers la mauvaise URL. |
| `backup_retention_days` | `7` | **Medium** | Insuffisant pour des équipes design actives. Portez-le à 30 jours ou plus. Une semaine de designs et de fichiers peut représenter un travail créatif considérable. |
| `enable_cloud_armor` | `false` | **Medium** | Sans Cloud Armor, le frontend et l'API de Penpot sont directement exposés à internet. Les règles WAF protègent l'API de design contre les attaques web courantes. |
| `timeout_seconds` | `3600` | **Low** | Descendre sous 300 secondes peut faire expirer en cours de route les grosses opérations d'export PDF/PNG, renvoyant une erreur au designer. |

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur semblable à :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve de manière asynchrone les adresses IPv4 sans serveur sur le sous-réseau VPC après la suppression d'un service Cloud Run. Ces adresses sont libérées environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** attendez 20 à 30 minutes après la première tentative de destruction, puis relancez la commande de destruction :

```bash
tofu destroy
```

La seconde exécution réussira une fois que GCP aura libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Penpot sur Cloud Run](../labs/Penpot_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module Penpot GKE — Guide de configuration](Penpot_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Penpot Common](Penpot_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md), [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) dans la solution **Design & Visual Collaboration**.
