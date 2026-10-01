---
title: "Listmonk sur Google Cloud Run"
description: "Référence de configuration pour déployer Listmonk sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Listmonk_CloudRun.md @ 3055034 sha256:73fdec144f2f -->

# Listmonk sur Google Cloud Run {#listmonk-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Listmonk_CloudRun.png" alt="Listmonk sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document constitue une référence complète du module `modules/Listmonk_CloudRun`. Il couvre l'architecture, IAM, les variables de configuration, les comportements propres à Listmonk et les modes d'exploitation pour déployer Listmonk sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Listmonk est un gestionnaire de newsletters et de listes de diffusion auto-hébergé et très performant, écrit en Go. `Listmonk CloudRun` est un **module wrapper** construit au-dessus de `App CloudRun`. Il s'appuie sur `App CloudRun` pour tout le provisionnement de l'infrastructure GCP et injecte, via `Listmonk Common`, la configuration applicative propre à Listmonk, l'initialisation de la base de données et la configuration du stockage.

**Fonctionnalités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur exécutant un binaire Go, 1 vCPU / 512Mi par défaut. Mise à l'échelle à zéro par défaut (`min_instance_count = 0`) avec `max_instance_count = 1` ; `cpu_always_allocated = true` maintient le CPU alloué sur une instance réveillée afin que l'expéditeur de campagnes asynchrone puisse terminer avant le retour à zéro.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. Volume GCS Fuse facultatif pour les fichiers téléversés, monté sur `/listmonk/uploads`. NFS facultatif pour un stockage partagé supplémentaire.
*   **Sécurité** : hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls depuis `App CloudRun`. Le mot de passe administrateur est généré automatiquement et stocké dans Secret Manager.
*   **Mise en cache** : Redis **désactivé par défaut** (`enable_redis = false`). Listmonk est un binaire Go sans état et n'a pas besoin de Redis en fonctionnement normal.
*   **CI/CD** : pipeline Cloud Build d'image personnalisée par défaut ; livraison progressive Cloud Deploy en option.
*   **Fiabilité** : la sonde de démarrage est une vérification de port TCP (délai initial de 30 secondes, 30 tentatives) — `/api/health` exige une session authentifiée et renvoie 403 à une sonde HTTP ; Cloud Run vérifie donc plutôt que le conteneur est à l'écoute. La sonde de vivacité est désactivée par défaut (Cloud Run n'offre pas de sonde de vivacité TCP, et `/api/health` renvoie également 403). Listmonk exécute automatiquement les migrations de schéma PostgreSQL au premier démarrage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté au nom de toutes les ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires e-mail des alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'listmonk'` | Nom de base des ressources. À ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `string` | `'Listmonk'` | Nom lisible affiché dans la console GCP. |
| `description` | 3 | `string` | `'Listmonk is a high-performance, self-hosted newsletter and mailing list manager'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image Listmonk. Incrémentez-le pour déployer une nouvelle version. |

**Architecture du wrapper :** `Listmonk CloudRun` appelle `Listmonk Common` pour construire un objet `application_config` contenant les variables d'environnement propres à Listmonk, la configuration des sondes et la définition du job `db-init`. `module_storage_buckets` transporte le bucket de téléversements éventuellement provisionné par `Listmonk Common`. `scripts_dir` est résolu vers le répertoire `Listmonk_Common/scripts` au moment de l'apply.

**Remarque sur PostgreSQL :** Listmonk exige **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut, et Listmonk ne démarre avec aucun autre moteur de base de données.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Listmonk_CloudRun` délègue tout le provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux de `App_CloudRun`.

**Secrets applicatifs :** `Listmonk Common` génère automatiquement un secret au niveau de l'application :
- `LISTMONK_ADMIN_PASSWORD` — le mot de passe de l'utilisateur administrateur Listmonk, stocké dans Secret Manager et injecté à l'exécution (l'ancien nom de style configuration à double tiret bas `LISTMONK_app__admin_password`, déprécié, a été supprimé — `__` n'est pas une clé de Secret k8s valide).

Le mot de passe de la base de données est stocké dans un secret distinct (`database_password_secret`) provisionné automatiquement par `App CloudRun`. Aucune de ces valeurs n'est écrite dans l'état Terraform.

**Nom de la variable d'environnement du mot de passe de base de données :** Listmonk lit directement `LISTMONK_db__password`. La variable `db_password_env_var_name` est préréglée sur cette valeur afin que `App CloudRun` injecte le secret sous le bon nom.

**Délai de propagation IAM de 120 secondes :** hérité de `App CloudRun` — le service Listmonk n'est déployé qu'une fois ce délai écoulé, ce qui évite les échecs de lecture de secrets au démarrage de la première révision.

**Interface d'administration :** l'interface complète de Listmonk, y compris la gestion des abonnés, les campagnes, les modèles et les paramètres, est disponible à la racine `/`. Le nom d'utilisateur administrateur et le mot de passe généré automatiquement sont les seuls identifiants requis.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Listmonk est un binaire Go compilé. Il est économe en mémoire et démarre rapidement par rapport aux applications écrites dans des langages interprétés. L'allocation de ressources par défaut (1 vCPU / 512Mi) suffit pour des listes de taille modérée et des charges de travail de campagnes courantes.

**Mise à l'échelle à zéro par défaut** (`min_instance_count = 0`) — l'ancienne valeur par défaut `min = 1` n'existait que pour garder chaud le cache en mémoire, propre à chaque instance, de l'utilisateur d'API. Cette raison a disparu : le point d'entrée de `Listmonk_Common` effectue un UPSERT, à chaque démarrage, d'un utilisateur d'API déterministe adossé à un secret dans la base de données, de sorte qu'une instance démarrée à froid recharge toujours un identifiant valide. `cpu_always_allocated = true` (valeur par défaut) garantit qu'une instance réveillée conserve le CPU alloué assez longtemps pour que l'expéditeur de campagnes asynchrone termine avant le retour à zéro. Passez `min_instance_count` à `1` uniquement si Listmonk doit rester chaud pour une utilisation intensive et interactive de l'administration.

**Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` vaut `'custom'` par défaut, ce qui signifie que Cloud Build compile une image personnalisée à partir du Dockerfile de `Listmonk_Common`. Définissez `container_image_source = 'prebuilt'` et fournissez une URI `container_image` pour ignorer le build et déployer directement.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement (SQL, stockage, secrets). |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU suffit pour le binaire Go de Listmonk. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. Augmentez à 1–2 Gi pour de grandes listes d'abonnés ou un traitement intensif de campagnes. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution. Mise à l'échelle à zéro ; l'utilisateur d'API auto-réparé, injecté en base, rend les démarrages à froid sûrs. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances en cours d'exécution. Maintenu à 1 — Listmonk ne coordonne pas plusieurs processeurs de campagnes concurrents. |
| `cpu_always_allocated` | 4 | `true` | Maintient le CPU alloué pendant toute la durée de vie d'une instance active afin que l'expéditeur de campagnes asynchrone, exécuté dans le processus, puisse terminer après le retour de la requête HTTP déclenchante. |
| `container_port` | 4 | `9000` | Port HTTP natif de Listmonk. À modifier uniquement si votre Dockerfile personnalisé écoute sur un autre port. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. Les points de terminaison d'API de Listmonk répondent généralement en quelques secondes. |
| `enable_cloudsql_volume` | 4 | `true` | Injecte le sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix à PostgreSQL. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Listmonk dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage pour les déploiements canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. Définissez `0` pour désactiver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Listmonk CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `9000` | Port natif de Listmonk. |
| `cpu_always_allocated` | `false` | `true` | L'expéditeur de campagnes exécuté dans le processus tourne après le retour de la requête HTTP déclenchante ; une facturation à la requête le briderait en plein lot. |
| `enable_image_mirroring` | `false` | `true` | Listmonk met par défaut son image de base en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Listmonk exige **PostgreSQL 15**. `database_type = "POSTGRES_15"` est la valeur par défaut et ne doit pas être modifiée. Listmonk gère lui-même la création de son schéma et ses migrations au premier démarrage — le job Cloud Run `db-init` crée uniquement la base de données et l'utilisateur ; l'application remplit le schéma.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. Listmonk exige PostgreSQL. À ne pas modifier. |
| `db_name` | 12 | `'listmonk'` | Nom de la base de données PostgreSQL. **À ne pas modifier après le déploiement initial.** |
| `db_user` | 12 | `'listmonk'` | Utilisateur applicatif PostgreSQL. Mot de passe généré automatiquement et stocké dans Secret Manager. |
| `db_password_env_var_name` | 12 | `'LISTMONK_db__password'` | Nom de la variable d'environnement sous laquelle le mot de passe de la base est injecté. Préréglé pour Listmonk ; à ne pas modifier. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après la rotation avant le redémarrage du service. |

> `sql_instance_name` et `sql_instance_base_name` ne sont pas exposées ; la découverte ou le provisionnement intégré (inline) de Cloud SQL est géré de manière transparente par `App CloudRun`.

### C. Stockage (GCS Fuse et NFS) {#c-storage-gcs-fuse--nfs}

**NFS est désactivé par défaut** (`enable_nfs = false`). Listmonk est un binaire Go sans état et n'a pas besoin d'un système de fichiers partagé. Plusieurs instances Cloud Run partagent une même base de données PostgreSQL ; les données des abonnés et le contenu des campagnes sont stockés en base.

**Volume de téléversements GCS Fuse :** pour un stockage persistant des fichiers et médias téléversés, montez un bucket GCS sur `/listmonk/uploads` à l'aide de `gcs_volumes`. `Listmonk Common` définit `LISTMONK_upload__provider=filesystem` et `LISTMONK_upload__filesystem__upload_path=/listmonk/uploads` — le bucket GCS monté sur ce chemin satisfait ces paramètres. Sans volume persistant, les pièces jointes téléversées sont éphémères et perdues au redémarrage d'une révision.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). Chaque entrée : `name`, `bucket_name`, `mount_path`, `readonly`, `mount_options`. Montez le bucket de téléversements sur `/listmonk/uploads`. |
| `enable_nfs` | 11 | `false` | Provisionne un volume NFS partagé. Non requis pour les déploiements Listmonk standard. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin dans le conteneur où le partage NFS est monté. Pertinent uniquement lorsque `enable_nfs = true`. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ne pas créer les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau et une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement CMEK des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise la sortie VPC directe (Direct VPC Egress) pour atteindre l'IP interne de Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, le sidecar Auth Proxy gère la connexion à Cloud SQL via un socket Unix, et la connexion à la base de données ne nécessite pas de routage VPC.

Listmonk se connecte à des fournisseurs externes SMTP/Mailgun/SES/Postmark pour l'envoi des campagnes. Conservez `vpc_egress_setting = 'PRIVATE_RANGES_ONLY'` (valeur par défaut) afin que la sortie publique directe soit disponible pour les ports SMTP 587/465/25.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine via le VPC uniquement le trafic RFC 1918. Définissez `'ALL_TRAFFIC'` uniquement si tout le trafic sortant (SMTP compris) doit transiter par le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est provisionné automatiquement par `Listmonk Common` lorsque `initialization_jobs` conserve sa valeur par défaut de liste vide (`[]`). Il utilise l'image `postgres:15-alpine` et exécute `Listmonk_Common/scripts/db-init.sh`, qui réalise les opérations idempotentes suivantes :

1. Se connecte à Cloud SQL PostgreSQL via le socket Unix de l'Auth Proxy.
2. Crée l'utilisateur de base de données `listmonk` avec le mot de passe issu de Secret Manager.
3. Crée la base de données `listmonk` si elle n'existe pas.
4. Accorde à l'utilisateur `listmonk` tous les privilèges sur la base de données.

Listmonk exécute lui-même `--install` au premier démarrage pour remplir le schéma et créer l'utilisateur administrateur à partir de `LISTMONK_ADMIN_USER` (codé en dur à `"admin"` dans `main.tf`) et de `LISTMONK_ADMIN_PASSWORD` provenant de l'environnement — les anciens noms de style configuration à double tiret bas `LISTMONK_app__admin_username`/`LISTMONK_app__admin_password` ont été supprimés (dépréciés en v6 ; `__` n'est pas une clé de Secret k8s valide).

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Listmonk Common` fournisse le job `db-init` par défaut. Une liste non vide le remplace entièrement. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. Chaque entrée : `name`, `schedule` (cron UTC), `image`, `command`, `args`, `env_vars`, `secret_env_vars`, `cpu_limit`, `memory_limit`, `timeout_seconds`, `max_retries`, `task_count`, `parallelism`, `mount_nfs`, `mount_gcs_volumes`, `script_path`, `paused`. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une politique Cloud Armor WAF (OWASP Top 10, protection DDoS adaptative, limitation de débit) est provisionné devant Cloud Run.

Pour les déploiements Listmonk de production qui traitent des données d'abonnés et envoient des campagnes, Cloud Armor est fortement recommandé pour se protéger contre le bourrage d'identifiants sur la connexion administrateur et les abus de l'API.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par ex. VPN de bureau, IP de sortie CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. Une authentification par identité Google est exigée avant que les requêtes n'atteignent Listmonk. Recommandé pour les déploiements de newsletters internes dont l'accès doit être limité aux comptes Google de l'organisation.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run exige que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images. Nécessite une politique Binary Authorization et un attesteur préconfigurés dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont confinés dans un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit exister avant l'activation. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés (DATA_READ, DATA_WRITE, ADMIN_READ). |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets applicatifs de Listmonk sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — le texte en clair n'est jamais écrit dans l'état Terraform.

`Listmonk Common` génère automatiquement le secret du mot de passe administrateur, injecté dans le conteneur sous `LISTMONK_ADMIN_PASSWORD`. Le mot de passe de la base de données (`LISTMONK_db__password`) est provisionné automatiquement par `App CloudRun`. Des secrets supplémentaires peuvent être ajoutés via `secret_environment_variables`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Table associant un nom de variable d'environnement → un ID de secret Secret Manager. Résolue à l'exécution ; jamais stockée dans l'état. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret avant que les ressources dépendantes ne poursuivent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG serverless est provisionné. Le trafic suit le chemin : Internet → Cloud Armor → équilibreur de charge HTTPS global → NEG serverless → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Listmonk à passer par l'équilibreur de charge et empêche l'accès direct via l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est rattaché au backend de l'équilibreur de charge HTTPS.

**Point d'attention pour Listmonk :** Listmonk sert à la fois des points de terminaison d'API et des ressources statiques. Le CDN est surtout utile pour les ressources statiques de l'interface (HTML, JS, CSS). Les réponses de l'API Listmonk (`/api/*`) ne peuvent pas être mises en cache et doivent être exclues de la mise en cache CDN au moyen d'en-têtes Cache-Control ou de règles de motifs d'URL.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. Effectif uniquement lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. Définissez `0` pour désactiver. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag (orphelines) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lequel les images peuvent être supprimées. Définissez `0` pour désactiver la suppression basée sur l'âge. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont rattachés à l'équilibreur de charge HTTPS global via `application_domains`. Des certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Un certificat SSL géré par Google est provisionné par domaine. (par ex. `['newsletters.example.com']`) |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés. Le déclencheur construit et déploie une image Listmonk personnalisée lorsque du code est poussé sur la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur Cloud Build GitHub. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (portées `repo`, `admin:repo_hook`). Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (à privilégier pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est remplacé par un pipeline de livraison Cloud Deploy géré, avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune : `name`, `target_name`, `service_name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

Listmonk est un binaire Go sans état — plusieurs instances Cloud Run peuvent servir des requêtes simultanément sans problème d'état de session partagé. La valeur par défaut `min_instance_count = 0` ramène le service à zéro entre deux envois ; l'utilisateur d'API auto-réparé, injecté en base, rend une instance démarrée à froid immédiatement utilisable. `max_instance_count` vaut `1` par défaut, car Listmonk ne coordonne pas plusieurs processeurs de campagnes concurrents — augmentez-le uniquement si la charge de lecture interactive ou via l'API l'exige.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. La conception sans état de Listmonk rend les déploiements canary sûrs — toutes les requêtes partagent le même backend PostgreSQL, quelle que soit l'instance qui les traite.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentage entre des révisions nommées. La somme des entrées doit être égale à 100. Vide : 100 % vers la dernière révision. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Listmonk expose un point de terminaison dédié `/api/health`, mais depuis Listmonk v6.1.0 celui-ci se trouve derrière l'authentification par session et renvoie `403 {"message":"invalid session"}` à un appelant non authentifié — une sonde HTTP qui l'interroge n'aboutit donc jamais. La sonde de démarrage utilise donc par défaut une vérification **TCP** d'écoute du port (elle confirme que le serveur est lié au port du conteneur), et la sonde de vivacité est **désactivée** par défaut (Cloud Run n'offre pas de sonde de vivacité TCP, et la forme HTTP renverrait 403 de la même façon). La sonde de démarrage TCP conditionne la disponibilité, et Cloud Run redémarre le conteneur s'il s'arrête.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="TCP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=10, failure_threshold=30 }` | Sonde de disponibilité au démarrage (TCP). Le conteneur ne reçoit aucun trafic tant qu'elle n'a pas réussi. |
| `liveness_probe` | 14 | `{ enabled=false, type="HTTP", path="/api/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. Désactivée par défaut ; la sonde de démarrage TCP couvre la disponibilité. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut — activez-le pour que les alertes notifient `support_users` en cas d'indisponibilité. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques Cloud Monitoring. |

**Comportement de la sonde de démarrage :** `failure_threshold=30` combiné à `period_seconds=10` laisse à Listmonk jusqu'à 300 secondes (plus le délai initial de 30 secondes) pour terminer l'installation du schéma au premier démarrage. C'est généreux — l'installation du schéma Listmonk se termine généralement en moins de 30 secondes sur une instance PostgreSQL neuve.

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job Cloud Run de rotation.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur PostgreSQL de Cloud SQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Listmonk.

Au redémarrage, Listmonk rétablit sa connexion à la base de données et lit le mot de passe mis à jour dans Secret Manager.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatisée des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après l'écriture du nouveau secret avant le redémarrage du service. |

---

## 8. Intégrations {#8-integrations}

### A. Envoi d'e-mails (SMTP / API) {#a-mail-sending-smtp--api}

Listmonk se connecte à des fournisseurs de messagerie externes pour envoyer les campagnes et les messages transactionnels. Configurez le fournisseur de messagerie dans l'interface d'administration de Listmonk, sous **Settings → SMTP**, après le déploiement. Les fournisseurs courants sont Mailgun, Amazon SES, Postmark et SendGrid.

Listmonk prend en charge à la fois SMTP et des intégrations API natives (Mailgun, SES, Postmark, Sparkpost). Pour les envois à fort volume, les intégrations API sont préférables à SMTP.

**Méthode de configuration :** les identifiants du fournisseur de messagerie ne sont pas définis via les variables du module. Après le déploiement, accédez à l'interface d'administration de Listmonk et configurez :
1. **Settings → SMTP** pour l'envoi via SMTP.
2. **Settings → Sending settings** pour la limitation de débit (messages par minute), la concurrence et les paramètres de nouvelle tentative.

Pour conserver ces paramètres d'un redéploiement à l'autre, exportez les paramètres Listmonk sous forme de dump SQL et importez-le lors de la restauration.

### B. Import de sauvegarde et restauration {#b-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde PostgreSQL existante dans l'instance Cloud SQL provisionnée. Il s'exécute après le job `db-init` et avant le déploiement du service Listmonk.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) des sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. Repassez à `false` après un import réussi. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complète) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complète (par ex. `'gs://my-bucket/listmonk-backup.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

### C. Observabilité et alertes {#c-observability--alerting}

Un test de disponibilité Cloud Monitoring peut interroger le point de terminaison `/api/health` depuis plusieurs emplacements dans le monde ; il est désactivé par défaut. Des règles d'alerte personnalisées peuvent surveiller les métriques Cloud Run et notifier `support_users`.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/health" }` | Test de disponibilité : `enabled`, `path`, `check_interval`, `timeout`. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques. Chacune : `name`, `metric_type`, `comparison`, `threshold_value`, `duration_seconds`, `aggregation_period`. |
| `support_users` | 2 | `[]` | Adresses e-mail notifiées lors du déclenchement des tests de disponibilité et des règles d'alerte. |

---

## 9. Explorer avec la console GCP {#9-exploring-with-the-gcp-console}

Après un déploiement réussi, utilisez la console GCP pour vérifier et explorer le déploiement Listmonk.

**Service Cloud Run**

Accédez à **Cloud Run** dans la console et sélectionnez le service `listmonk` (nommé `app<listmonk><tenant><id>`). Points clés à examiner :
- **Onglet Revisions** : affiche toutes les révisions de conteneur déployées, les pourcentages de répartition du trafic et les condensés (digests) des images. La révision active doit afficher le tag `latest` ou une version précise.
- **Onglet Logs** : diffuse en temps réel les journaux du conteneur Cloud Run. Filtrez sur `severity=ERROR` pour faire ressortir les problèmes de démarrage de Listmonk ou de connexion à la base. Au premier démarrage, repérez les lignes de journal d'installation du schéma de Listmonk (`Running install...`, `Admin user created`).
- **Onglet Metrics** : affiche le nombre de requêtes, la latence des requêtes (P50/P95/P99), le nombre d'instances et la latence de démarrage des conteneurs. Un pic du nombre d'instances lors de l'envoi d'une grande campagne est normal.
- **Onglet YAML** : affiche la spécification complète du service Cloud Run, y compris les noms des variables d'environnement (pas leurs valeurs), les montages de volumes, la configuration des sondes de santé et les limites de ressources.

**Secret Manager**

Accédez à **Secret Manager** et filtrez sur le nom du déploiement. Deux secrets sont pertinents :
- `app<listmonk><tenant><id>-admin-password` ou similaire — le secret qui alimente la variable d'environnement de conteneur `LISTMONK_ADMIN_PASSWORD`. Cliquez sur **View secret versions** pour confirmer qu'une version existe. **Ne cliquez pas sur View secret value** en production.
- `app<listmonk><tenant><id>-db-password` — le secret du mot de passe PostgreSQL. Utilisé à la fois par le service Cloud Run et par le job `db-init`.

Sélectionnez l'un ou l'autre secret et consultez l'onglet **Replication** pour confirmer que le secret est répliqué dans la région du déploiement.

**Cloud SQL**

Accédez à **SQL** et ouvrez l'instance Cloud SQL de Listmonk. Points clés :
- **Overview** : confirme le moteur PostgreSQL 15, le niveau de l'instance et la taille du stockage.
- **Onglet Databases** : la base de données `listmonk` doit figurer dans la liste. Après le premier déploiement, les tables du schéma Listmonk sont présentes.
- **Onglet Users** : l'utilisateur applicatif `listmonk` doit figurer dans la liste.
- **Onglet Connections** : examinez **Authorized networks** et confirmez que seul le Cloud SQL Auth Proxy (via le compte de service Cloud Run) dispose d'un accès. Aucune IP publique ne devrait être nécessaire.
- **Onglet Backups** : confirme la planification des sauvegardes automatisées et liste les fichiers de sauvegarde récents.
- **Onglet Operations** : affiche les opérations récentes, y compris l'historique des connexions du job `db-init`.

**Cloud Build**

Accédez à **Cloud Build → History** pour examiner les exécutions de build récentes. Le déploiement initial déclenche un build qui empaquette l'image de conteneur Listmonk. Chaque entrée de build indique le tag de l'image, la durée du build et les journaux de chaque étape. Cliquez sur un build pour voir les étapes du Dockerfile et le `docker push` final vers Artifact Registry.

**Artifact Registry**

Accédez à **Artifact Registry** et ouvrez le dépôt `listmonk`. Le dépôt liste tous les tags d'image poussés, avec leurs condensés, leurs horodatages de push et leurs tailles. Vérifiez que l'image la plus récente est présente.

**Cloud Monitoring**

Accédez à **Monitoring → Uptime checks** et trouvez le test de disponibilité de Listmonk. Le test interroge `/api/health` depuis plusieurs emplacements dans le monde. Un statut vert confirme que le service est joignable et en bonne santé depuis le réseau mondial de GCP.

Accédez à **Monitoring → Alerting** pour voir les règles d'alerte actives créées par le module. Les `support_users` sont automatiquement ajoutés comme destinataires des canaux de notification.

---

## 10. Explorer avec gcloud {#10-exploring-with-gcloud}

Les commandes gcloud suivantes offrent une visibilité opérationnelle sur le déploiement Cloud Run de Listmonk. Remplacez `PROJECT_ID`, `REGION` et `SERVICE_NAME` par les valeurs de votre déploiement. Le nom du service suit le modèle `app<listmonk><tenant><id>` — récupérez-le depuis la sortie Terraform `service_name`.

**Récupérer l'URL et la configuration du service :**

```bash
# Get the Cloud Run service URL
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(status.url)"

# Describe the full service configuration
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format=yaml
```

**Vérifier la santé du service et ses révisions :**

```bash
# List all revisions and their traffic allocations
gcloud run revisions list \
  --service=SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name,status.conditions[0].status,spec.containers[0].image,status.observedGeneration)"

# Check revision traffic split
gcloud run services describe SERVICE_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --format="value(spec.traffic[].percent,spec.traffic[].revisionName)"
```

**Diffuser et filtrer les journaux :**

```bash
# Tail live logs from the Listmonk service
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME" \
  --project=PROJECT_ID \
  --limit=50 \
  --freshness=10m \
  --format="table(timestamp,severity,textPayload)"

# Filter for errors only
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=SERVICE_NAME AND severity>=ERROR" \
  --project=PROJECT_ID \
  --limit=20

# View db-init job logs
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name~db-init" \
  --project=PROJECT_ID \
  --limit=30 \
  --format="table(timestamp,severity,textPayload)"
```

**Inspecter les secrets :**

```bash
# List all Secret Manager secrets in the project (filter by deployment)
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~listmonk" \
  --format="table(name,replication.automatic,createTime)"

# Check secret versions for the admin password
gcloud secrets versions list LISTMONK_ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Access the admin password (use with caution — only in break-glass scenarios)
gcloud secrets versions access latest \
  --secret=LISTMONK_ADMIN_PASSWORD_SECRET_NAME \
  --project=PROJECT_ID
```

**Inspection de Cloud SQL :**

```bash
# List Cloud SQL instances
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,settings.tier,region,state)"

# Describe the Listmonk instance
gcloud sql instances describe SQL_INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="yaml(databaseVersion,settings.tier,settings.ipConfiguration,state)"

# List databases on the instance
gcloud sql databases list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID

# List users on the instance
gcloud sql users list \
  --instance=SQL_INSTANCE_NAME \
  --project=PROJECT_ID
```

**Jobs Cloud Run (db-init) :**

```bash
# List all Cloud Run Jobs in the region
gcloud run jobs list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name,status.conditions[0].status,metadata.creationTimestamp)"

# Describe the db-init job
gcloud run jobs describe JOB_NAME \
  --region=REGION \
  --project=PROJECT_ID

# Manually execute the db-init job (e.g., after a database recreation)
gcloud run jobs execute JOB_NAME \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Disponibilité et surveillance :**

```bash
# List uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,httpCheck.path,period,checkerType)"

# List Cloud Monitoring alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].displayName)"
```

**Artifact Registry :**

```bash
# List images in the Listmonk repository
gcloud artifacts docker images list REGION-docker.pkg.dev/PROJECT_ID/listmonk \
  --project=PROJECT_ID \
  --format="table(image,tags,createTime)" \
  --include-tags

# List all tags for the Listmonk image
gcloud artifacts docker tags list REGION-docker.pkg.dev/PROJECT_ID/listmonk/listmonk \
  --project=PROJECT_ID
```

---

## 11. Comportements gérés par la plateforme {#11-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Listmonk CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Détail |
|---|---|
| **PostgreSQL 15 obligatoire** | `database_type = "POSTGRES_15"` par défaut. Listmonk ne prend pas en charge MySQL ni d'autres moteurs. |
| **Mot de passe administrateur généré automatiquement** | Généré par `Listmonk Common` et injecté dans le conteneur sous `LISTMONK_ADMIN_PASSWORD` (tiret bas simple ; l'ancien nom de style configuration `LISTMONK_app__admin_password`, déprécié, a été supprimé). Stocké dans Secret Manager, jamais dans l'état. |
| **Variable d'environnement du mot de passe de base préréglée** | `db_password_env_var_name = "LISTMONK_db__password"` est préconfiguré afin que `App CloudRun` injecte le mot de passe de la base de données sous le nom attendu par la configuration de Listmonk. |
| **Chemin de téléversement GCS Fuse** | `LISTMONK_upload__provider=filesystem` et `LISTMONK_upload__filesystem__upload_path=/listmonk/uploads` sont injectés automatiquement. Montez un bucket GCS sur `/listmonk/uploads` via `gcs_volumes` pour des téléversements persistants. |
| **Job db-init par défaut** | Fourni par `Listmonk Common` lorsque `initialization_jobs = []`. La base de données et l'utilisateur PostgreSQL sont créés automatiquement. |
| **Mise en miroir des images activée** | `enable_image_mirroring = true` par défaut. L'image de base Listmonk est mise en miroir dans Artifact Registry avant le déploiement. |
| **Redis désactivé par défaut** | `enable_redis = false`. Listmonk n'a pas besoin de Redis en fonctionnement standard. |
| **Répertoire des scripts** | `scripts_dir` est résolu vers `Listmonk_Common/scripts` au moment de l'apply. |

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Listmonk CloudRun`, triées par groupe d'interface puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP de toutes les ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté au nom de toutes les ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail destinataires des alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'listmonk'` | Nom de base des ressources. À ne pas modifier après le déploiement initial. |
| `display_name` | 3 | `'Listmonk'` | Nom lisible. |
| `description` | 3 | (description de Listmonk) | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image de conteneur Listmonk. |
| `admin_username` | 3 | `'listmonk'` | Déclarée mais actuellement inutilisée par `main.tf` — le nom d'utilisateur administrateur injecté est codé en dur à `"admin"` via `LISTMONK_ADMIN_USER`, quelle que soit la valeur de cette variable. |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure uniquement. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. |
| `memory_limit` | 4 | `'512Mi'` | Mémoire par instance. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution. Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances en cours d'exécution. |
| `cpu_always_allocated` | 4 | `true` | Maintient le CPU alloué sur une instance active afin que l'expéditeur de campagnes asynchrone puisse terminer après le retour de la requête déclenchante. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête, en secondes. |
| `enable_cloudsql_volume` | 4 | `true` | Sidecar Auth Proxy pour les connexions par socket Unix à PostgreSQL. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin dans le conteneur du socket Unix de l'Auth Proxy. |
| `container_port` | 4 | `9000` | Port HTTP natif de Listmonk. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Listmonk dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service ayant accès via IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google ayant accès via IAP. |
| `environment_variables` | 6 | `{}` | Variables d'environnement en texte clair. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) des sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI complète) ou `'gdrive'` (ID de fichier). |
| `backup_uri` | 7 | `""` | URI GCS complète ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur Cloud Build GitHub. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images au déploiement. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts avec l'utilisateur root de la base. |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM NFS GCE existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base de la VM NFS créée en mode intégré. L'ID de déploiement y est ajouté. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours après lequel les images peuvent être supprimées. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ne pas créer de buckets GCS. |
| `storage_buckets` | 11 | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `false` | Provisionne un stockage partagé NFS. Non requis pour les déploiements Listmonk standard. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin dans le conteneur où NFS est monté. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. Montez le bucket de téléversements sur `/listmonk/uploads`. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur Cloud SQL. À ne pas modifier — Listmonk exige PostgreSQL. |
| `db_name` | 12 | `'listmonk'` | Nom de la base de données PostgreSQL. À ne pas modifier après le déploiement initial. |
| `db_user` | 12 | `'listmonk'` | Utilisateur applicatif PostgreSQL. |
| `db_password_env_var_name` | 12 | `'LISTMONK_db__password'` | Nom de la variable d'environnement d'injection du mot de passe de la base. À ne pas modifier. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après la rotation avant le redémarrage du service. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 14 | `{ enabled=true, type="TCP", path="/api/health", initial_delay_seconds=30, failure_threshold=30, ... }` | Sonde de démarrage. TCP — `/api/health` exige une session authentifiée. |
| `liveness_probe` | 14 | `{ enabled=false, type="HTTP", path="/api/health", initial_delay_seconds=30, failure_threshold=3, ... }` | Sonde de vivacité. Désactivée par défaut. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques Cloud Monitoring. |
| `enable_redis` | 21 | `false` | Intégration Redis. Non requise pour Listmonk. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP de Redis. |
| `redis_port` | 21 | `'6379'` | Port TCP de Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Sensible. |
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | 22 | `""` | ID de l'organisation GCP pour VPC-SC. Découvert automatiquement à partir du projet s'il est vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux d'audit Cloud détaillés. |

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
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Nom de l'utilisateur de la base de données applicative. |
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
| `database_type` | `"POSTGRES_15"` | **Critique** | Listmonk prend exclusivement en charge PostgreSQL. Passer à MySQL ou SQL Server fait échouer Listmonk au démarrage. |
| `db_name` | `"listmonk"` | **Critique** | Immuable après le premier déploiement — la modifier pousse Terraform à recréer la base de données, ce qui détruit tous les abonnés, campagnes et paramètres. |
| `db_user` | `"listmonk"` | **Critique** | Immuable après le premier déploiement — la modifier recrée l'utilisateur Cloud SQL et invalide tous les identifiants stockés. |
| `db_password_env_var_name` | `"LISTMONK_db__password"` | **Critique** | Listmonk lit exactement ce nom de variable d'environnement pour le mot de passe de sa base de données. Le modifier empêche Listmonk de se connecter à PostgreSQL au démarrage. |
| `min_instance_count` | `0` | **Faible** | La mise à l'échelle à zéro est la valeur par défaut et elle est sûre : l'utilisateur d'API auto-réparé, injecté en base, garantit qu'une instance démarrée à froid recharge toujours un identifiant valide, et `cpu_always_allocated = true` permet à l'expéditeur de campagnes asynchrone de l'instance réveillée d'aller jusqu'au bout. Passez à `1` uniquement pour une utilisation interactive intensive de l'administration où les démarrages à froid sont indésirables. |
| `memory_limit` | `"512Mi"` | **Moyen** | Suffisant pour de petites listes. Des listes de plusieurs millions d'abonnés ou un traitement concurrent de campagnes peuvent épuiser 512Mi sous charge. Augmentez à 1–2 Gi pour les déploiements de production comptant de nombreux abonnés. |
| `enable_cloudsql_volume` | `true` | **Critique** | Listmonk se connecte par défaut à PostgreSQL via le socket Unix de l'Auth Proxy. Désactiver le volume sans fournir de chemin de connexion TCP fait échouer toutes les opérations sur la base de données. |
| `gcs_volumes` | `[]` | **Moyen** | Sans volume GCS Fuse sur `/listmonk/uploads`, les fichiers médias téléversés sont stockés de manière éphémère sur le système de fichiers du conteneur et perdus lors du remplacement de la révision. À configurer pour tout déploiement qui accepte des pièces jointes ou des téléversements de médias. |
| `ingress_settings` | `"all"` | **Moyen** | `"all"` expose l'interface d'administration de Listmonk sur l'internet public. Pour les déploiements de newsletters internes, envisagez `enable_iap = true` ou `ingress_settings = "internal"`. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, l'API et l'interface d'administration de Listmonk sont exposées sans protection WAF. Les grandes listes d'abonnés sont des cibles de choix pour le moissonnage de données. Recommandé pour tout déploiement de production. |
| `backup_retention_days` | `7` | **Moyen** | Sept jours sont insuffisants pour des bases d'abonnés de production. Perdre les données des abonnés, l'historique des campagnes et les enregistrements de désabonnement représente un risque de conformité sérieux. Augmentez à 30 jours ou plus pour tout déploiement de production. |
| `enable_backup_import` | `false` | **Critique** | Exige que `backup_uri` soit un chemin GCS ou Drive valide et accessible. L'activer avec un `backup_uri` vide fait échouer le job Cloud Run de restauration pendant l'apply. |
| `vpc_egress_setting` | `"PRIVATE_RANGES_ONLY"` | **Moyen** | Listmonk doit joindre des fournisseurs SMTP/API externes pour envoyer les campagnes. `PRIVATE_RANGES_ONLY` autorise la sortie publique directe. Passer à `"ALL_TRAFFIC"` avec un pare-feu VPC restrictif bloquera les connexions SMTP/API sortantes et empêchera silencieusement la distribution des campagnes. |
| `secret_propagation_delay` | `30` | **Faible** | Parfois insuffisant dans les configurations multirégionales. Augmentez à 60–90 s si des secrets sont introuvables pendant l'apply. |

---

## 15. Destruction des ressources {#15-destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur semblable à celle-ci :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve de manière asynchrone les adresses IPv4 serverless sur le sous-réseau VPC après la suppression d'un service Cloud Run. Ces adresses sont libérées par GCP environ **20–30 minutes** après la suppression du service Cloud Run.

**Résolution :** attendez 20–30 minutes après la première tentative de destruction, puis relancez la commande de destruction :

```bash
tofu destroy
```

La seconde exécution réussit dès que GCP a libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Listmonk sur Cloud Run](../labs/Listmonk_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module Listmonk GKE — Guide de configuration](Listmonk_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Listmonk Common](Listmonk_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md), [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **CRM & Sales Operations**.
