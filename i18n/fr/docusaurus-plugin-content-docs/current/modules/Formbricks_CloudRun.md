---
title: "Formbricks sur Google Cloud Run"
description: "Référence de configuration pour déployer Formbricks sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Formbricks_CloudRun.md @ 3055034 sha256:1f748ba172d1 -->

# Formbricks sur Google Cloud Run {#formbricks-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Formbricks_CloudRun.png" alt="Formbricks sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce document fournit une référence complète du module `modules/Formbricks_CloudRun`. Il couvre l'architecture, IAM, les variables de configuration, les comportements propres à Formbricks et les modèles d'exploitation pour déployer Formbricks sur Google Cloud Run (v2).

---

## 1. Vue d'ensemble du module {#1-module-overview}

Formbricks est une plateforme open source de gestion des enquêtes et de l'expérience. Elle permet aux équipes de créer, depuis une seule plateforme, des enquêtes produit, des enquêtes NPS, des parcours d'intégration et des widgets de retour intégrés à l'application. Construite sur Next.js avec l'ORM Prisma, elle nécessite PostgreSQL, Redis (facultatif) et un stockage d'objets compatible S3. `Formbricks CloudRun` est un **module wrapper** construit au-dessus de `App CloudRun`. Il s'appuie sur `App CloudRun` pour tout le provisionnement de l'infrastructure GCP et injecte, via `Formbricks Common`, la configuration applicative propre à Formbricks, les secrets, l'initialisation de la base de données et un stockage compatible S3 adossé à GCS.

**Fonctionnalités clés :**
*   **Calcul** : Cloud Run v2 (Gen2), conteneur Next.js sur le port 3000, 1 vCPU / 2 Gi par défaut (2 vCPU / 2 Gi recommandés en production). Mise à l'échelle à zéro (`min_instance_count = 0`) avec `max_instance_count = 1`.
*   **Persistance des données** : Cloud SQL **PostgreSQL 15**. NFS (VM GCE ou Filestore) activé par défaut. Un bucket GCS `uploads` est provisionné automatiquement par `Formbricks Common` pour le stockage de fichiers compatible S3 via des identifiants HMAC GCS.
*   **Sécurité** : hérite de Cloud Armor WAF, IAP, Binary Authorization et VPC Service Controls depuis `App CloudRun`. Plusieurs secrets applicatifs générés automatiquement (clé NextAuth, clé de chiffrement, jeton cron, clés HMAC) sont provisionnés dans Secret Manager par `Formbricks Common`.
*   **Cache** : Redis **activé par défaut** (`enable_redis = true`) — Formbricks utilise Redis pour le cache et les files de tâches en arrière-plan.
*   **CI/CD** : pipeline d'image personnalisée Cloud Build par défaut ; livraison progressive Cloud Deploy en option.
*   **Sondes de santé** : la sonde de démarrage est **TCP** sur le port du conteneur, par conception, et non HTTP `/api/v2/health` — ce point de terminaison ne renvoie un code 2xx qu'une fois que Formbricks signale une disponibilité COMPLÈTE (base de données + Redis + dépendances), si bien qu'une sonde de démarrage HTTP ne réussit jamais, alors que Next.js écoute déjà (« Ready » dans les journaux, mais le service n'est jamais créé). La sonde de vivacité est **désactivée par défaut** pour la même raison : la vivacité Cloud Run ne peut pas utiliser de socket TCP, et le point de terminaison HTTP `/api/v2/health` provoquerait une boucle de redémarrage d'un conteneur sain avant qu'il n'atteigne la disponibilité complète. La sonde de démarrage TCP suffit à conditionner le routage.

**Identité du projet et de l'application**

| Variable | Groupe | Type | Valeur par défaut | Description |
|---|---|---|---|---|
| `project_id` | 1 | `string` | — | ID du projet GCP. **Obligatoire.** |
| `tenant_id` | 2 | `string` | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `list(string)` | `[]` | Destinataires e-mail des alertes de surveillance. |
| `resource_labels` | 2 | `map(string)` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `string` | `'formbricks'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `display_name` | 3 | `string` | `'Formbricks Surveys'` | Nom lisible affiché dans la console GCP. |
| `description` | 3 | `string` | `'Formbricks - Open Source Survey and Experience Management'` | Description du service Cloud Run. |
| `application_version` | 3 | `string` | `'latest'` | Tag de version de l'image Formbricks. Incrémentez-le pour déployer une nouvelle version. |
| `webapp_url` | 3 | `string` | `""` | URL publique de l'instance Formbricks. À définir après le premier déploiement. |

**Architecture wrapper :** `Formbricks CloudRun` appelle `Formbricks Common` pour construire un objet `application_config` contenant les variables d'environnement propres à Formbricks, les secrets générés automatiquement, le câblage du stockage S3/GCS, la configuration des sondes et la définition du job `db-init`. `module_storage_buckets` transporte le bucket `uploads` provisionné par `Formbricks Common`. `scripts_dir` est résolu vers le répertoire `Formbricks_Common/scripts` au moment de l'apply.

**Remarque sur l'URL de la webapp :** lorsque `webapp_url` est laissé vide, `main.tf` calcule une URL de service Cloud Run déterministe (`https://<service>-<project-number>.<region>.run.app`) et la transmet à `Formbricks Common` sous la forme `WEBAPP_URL`/`NEXTAUTH_URL` — Formbricks ne se rabat donc jamais réellement sur la valeur par défaut `localhost:3000` de l'image sur Cloud Run (Cloud Run n'interpole pas les références `$(VAR)`, l'URL est donc calculée comme une simple chaîne). Ne définissez `webapp_url` explicitement que pour faire pointer les callbacks OAuth et les liens des e-mails vers un domaine personnalisé plutôt que vers l'URL `run.app` prévue.

---

## 2. IAM et contrôle d'accès {#2-iam--access-control}

`Formbricks_CloudRun` délègue tout le provisionnement IAM à `App_CloudRun`. Le compte de service Cloud Run, le compte de service Cloud Build, l'agent de service IAP et les ensembles de rôles de rotation des mots de passe sont identiques à ceux du module App_CloudRun.

**Secrets applicatifs générés automatiquement :** contrairement à Ghost, `Formbricks Common` génère automatiquement plusieurs secrets au niveau de l'application et les stocke dans Secret Manager. Ils sont créés une seule fois et restent stables d'un déploiement à l'autre :

| Secret | Variable d'environnement | Remarques |
|---|---|---|
| `NEXTAUTH_SECRET` | `NEXTAUTH_SECRET` | Clé de chiffrement des sessions NextAuth.js (32 caractères aléatoires). |
| `ENCRYPTION_KEY` | `ENCRYPTION_KEY` | Clé de chiffrement des données Formbricks. |
| `CRON_SECRET` | `CRON_SECRET` | Jeton d'authentification des tâches cron. |
| `HUB_API_KEY` | `HUB_API_KEY` | Clé API de Formbricks Hub. |
| `CUBEJS_API_SECRET` | `CUBEJS_API_SECRET` | Secret d'analytique Cube.js. |
| `S3_ACCESS_KEY` | `S3_ACCESS_KEY` | Clé d'accès HMAC GCS pour les téléversements compatibles S3. |
| `S3_SECRET_KEY` | `S3_SECRET_KEY` | Clé secrète HMAC GCS pour les téléversements compatibles S3. |
| `SMTP_PASSWORD` | `SMTP_PASSWORD` | Créé uniquement lorsque `smtp_host` est configuré. |
| `REDIS_URL` | `REDIS_URL` | Créé uniquement lorsque Redis est activé avec authentification. |

Les secrets `DB_PASSWORD` et `ROOT_PASSWORD` sont provisionnés automatiquement par `App CloudRun` et consommés par le job `db-init`.

**Accès à Secret Manager :** le compte de service Cloud Run reçoit `roles/secretmanager.secretAccessor` sur tous les secrets provisionnés. Les valeurs en clair ne sont jamais écrites dans l'état du déploiement.

---

## 3. Configuration du service principal {#3-core-service-configuration}

### A. Calcul (Cloud Run) {#a-compute-cloud-run}

Formbricks est une application Next.js qui exécute les migrations de base de données Prisma au démarrage. `Formbricks CloudRun` expose `cpu_limit` et `memory_limit` comme variables de premier niveau, avec des valeurs par défaut raisonnables.

**La mise à l'échelle à zéro est activée** (`min_instance_count = 0` par défaut). Les démarrages à froid de Formbricks prennent généralement 15 à 20 secondes, le temps que Next.js compile et que Prisma valide sa connexion à la base de données. Pour des enquêtes de production soumises à un SLA, définissez `min_instance_count = 1` afin d'éliminer les démarrages à froid.

**Startup CPU Boost** est toujours activé (codé en dur dans `App CloudRun`).

**Image de conteneur :** `container_image_source` vaut `'custom'` par défaut, ce qui signifie que Cloud Build construit une image personnalisée à partir du Dockerfile de `Formbricks_Common` (qui encapsule `ghcr.io/formbricks/formbricks`). Définissez `container_image_source = 'prebuilt'` et `container_image = 'ghcr.io/formbricks/formbricks:latest'` pour ignorer le build et déployer directement l'image amont.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure seule (SQL, stockage, secrets). |
| `container_image_source` | 4 | `'custom'` | `'custom'` construit via Cloud Build. `'prebuilt'` déploie un URI d'image existant. |
| `container_image` | 4 | `""` | URI d'image de remplacement. Laissez vide pour que Cloud Build gère l'image. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. 1 vCPU minimum ; `'2000m'` recommandé en production. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. 2 Gi par défaut ; ne descendez pas sous 512 Mi. |
| `container_port` | 4 | `3000` | Port HTTP natif de Formbricks. Ne le modifiez pas. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. Augmentez-la pour les téléversements de fichiers volumineux. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le volume de socket Unix du Cloud SQL Auth Proxy. Vaut `true` par défaut : une connexion TCP directe par IP impose `sslmode=require`, et le client `pg` de Formbricks/Prisma vérifie le certificat Cloud SQL de l'IP privée, ce qui échoue face à son autorité de certification non approuvée (chaque requête renvoie une erreur 500). Le socket évite ce problème — le proxy gère le mTLS et l'application se connecte avec `sslmode=disable`. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green en pourcentages. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution. Définissez `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances simultanées. Augmentez-le pour les déploiements à fort trafic. |
| `cpu_always_allocated` | 4 | `false` | Facturation à la requête par défaut : Formbricks sert les enquêtes et le tableau de bord à la demande, et son pipeline de réponses (e-mails de notification, webhooks, intégrations) ne s'exécute qu'après une réponse à une enquête. Définissez `true` si vous menez des enquêtes en direct qui exigent la livraison en temps réel des notifications/webhooks sans attendre que la requête suivante réveille l'instance. |

**Différences par rapport aux valeurs par défaut de `App CloudRun` :**

| Variable | `App CloudRun` | `Formbricks CloudRun` | Raison |
|---|---|---|---|
| `container_port` | `8080` | `3000` | Le serveur Next.js de Formbricks écoute sur le port 3000. |
| `cpu_limit` | `'1000m'` | `'1000m'` | Même valeur par défaut — passez à `'2000m'` en production. |
| `memory_limit` | `'512Mi'` | `'2Gi'` | Next.js + Prisma + le rendu des enquêtes nécessitent nettement plus de RAM. |
| `enable_image_mirroring` | `false` | `true` | Formbricks met en miroir dans Artifact Registry pour éviter les limites de débit de ghcr.io. |

### B. Base de données (Cloud SQL — PostgreSQL 15) {#b-database-cloud-sql--postgresql-15}

Formbricks nécessite PostgreSQL. `Formbricks Common` fixe `database_type = "POSTGRES_15"`. Le module utilise `db_name` et `db_user` comme variables abrégées propres à Formbricks.

**Connexion par socket Unix :** `enable_cloudsql_volume` vaut `true` par défaut. Formbricks se connecte à Cloud SQL PostgreSQL via le socket Unix du Cloud SQL Auth Proxy (monté sur `cloudsql_volume_mount_path`, par défaut `/cloudsql`), injecté sous la forme `DB_HOST`. Cela évite l'échec de vérification du certificat qui survient lorsque le client `pg` de Formbricks/Prisma se connecte directement en TCP sur l'IP privée avec `sslmode=require` face à l'autorité de certification non approuvée de Cloud SQL. Ne définissez `enable_cloudsql_volume = false` que pour une connexion TCP directe par IP dont vous savez qu'elle présente un certificat vérifiable.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `db_name` | 12 | `'formbricks'` | Nom de la base de données PostgreSQL. **Ne le modifiez pas après le déploiement initial.** |
| `db_user` | 12 | `'formbricks'` | Utilisateur applicatif PostgreSQL. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après la rotation avant de redémarrer le service. |
| `sql_instance_name` | 12 | `""` | Nom d'une instance Cloud SQL existante. Laissez vide pour la découverte automatique. |
| `sql_instance_base_name` | 12 | `'app-sql'` | Nom de base d'une instance Cloud SQL intégrée. L'ID de déploiement y est ajouté. |

> `database_type` est fixé à `"POSTGRES_15"` par `Formbricks Common` et ne peut pas être remplacé par l'utilisateur via la variable standard `database_type`. Formbricks nécessite PostgreSQL et ne démarrera pas avec MySQL ou SQL Server.

### C. Stockage (NFS et GCS) {#c-storage-nfs--gcs}

**NFS est activé par défaut** (`enable_nfs = true`). Formbricks stocke les fichiers partagés sur le volume NFS lorsque plusieurs instances sont actives. Nécessite `execution_environment = 'gen2'`.

**Bucket de téléversements GCS :** `Formbricks Common` provisionne automatiquement un bucket GCS `uploads` dédié et configure Formbricks pour utiliser l'API XML compatible S3 de GCS via des identifiants HMAC. Le nom du bucket est injecté sous la forme `S3_BUCKET_NAME`, et `S3_ENDPOINT_URL=https://storage.googleapis.com` oriente le client S3 de Formbricks vers GCS. Ce bucket est distinct des buckets listés dans `storage_buckets`.

**Injection des clés HMAC :** `S3_ACCESS_KEY` et `S3_SECRET_KEY` sont des identifiants HMAC GCS générés automatiquement, stockés dans Secret Manager et injectés comme variables d'environnement secrètes à l'exécution.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_nfs` | 11 | `true` | Provisionne un volume NFS pour le stockage de fichiers partagé. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où le partage NFS est monté. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ne pas créer de buckets supplémentaires. Le bucket `uploads` est toujours provisionné. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires, en plus du bucket de téléversements provisionné automatiquement. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse (nécessite `gen2`). |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base d'une VM GCE NFS intégrée. L'ID de déploiement y est ajouté. |
| `manage_storage_kms_iam` | 11 | `false` | Crée un trousseau de clés KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

### D. Réseau {#d-networking}

Cloud Run utilise Direct VPC Egress pour joindre Cloud SQL. Comme `enable_cloudsql_volume = true` est la valeur par défaut, Formbricks se connecte à PostgreSQL via le socket Unix du Cloud SQL Auth Proxy plutôt que par une connexion TCP directe à l'IP privée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `ingress_settings` | 5 | `'all'` | `'all'` — internet public ; `'internal'` — VPC uniquement ; `'internal-and-cloud-load-balancing'` — force le trafic à passer par l'équilibreur de charge HTTPS. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` achemine uniquement le trafic RFC 1918 via le VPC. |

### E. Initialisation et amorçage {#e-initialization--bootstrap}

Un job Cloud Run `db-init` est provisionné automatiquement par `Formbricks Common` lorsque `initialization_jobs` conserve sa valeur par défaut (liste vide). Il utilise une image compatible PostgreSQL et exécute `Formbricks_Common/scripts/db-init.sh`, qui crée de manière idempotente la base de données et l'utilisateur avant le démarrage du service Formbricks.

**Les migrations Prisma** sont gérées par Formbricks lui-même au démarrage du conteneur (`PRISMA_MIGRATE=false` est défini pour désactiver la migration forcée, car Formbricks exécute sa propre logique de migration Prisma au démarrage).

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Formbricks Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

---

## 4. Sécurité avancée {#4-advanced-security}

### A. Cloud Armor WAF {#a-cloud-armor-waf}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global doté d'une stratégie Cloud Armor WAF (OWASP Top 10, protection DDoS adaptative, limitation de débit) est provisionné devant Cloud Run.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. Requis pour les domaines personnalisés, le CDN et la protection DDoS. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF (par exemple, VPN de bureau, IP de sortie CI/CD). |

### B. Identity-Aware Proxy (IAP) {#b-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, l'intégration IAP native de Cloud Run est activée directement sur le service. Une authentification par identité Google est exigée avant que les requêtes n'atteignent Formbricks. Utile pour les déploiements internes ou les environnements d'enquêtes de préproduction.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service autorisés. Format : `'user:email'` ou `'serviceAccount:sa@...'`. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google autorisés. Format : `'group:name@example.com'`. |

### C. Binary Authorization {#c-binary-authorization}

Lorsque `enable_binary_authorization = true`, Cloud Run exige que les images déployées portent une attestation cryptographique valide.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images. Nécessite une stratégie Binary Authorization préconfigurée dans le projet. |

### D. VPC Service Controls {#d-vpc-service-controls}

Lorsque `enable_vpc_sc = true`, tous les appels d'API GCP de ce module sont confinés dans un périmètre VPC-SC existant.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API du module dans le périmètre VPC-SC du projet. Un périmètre doit déjà exister avant l'activation. |

### E. Intégration de Secret Manager {#e-secret-manager-integration}

Les secrets applicatifs de Formbricks sont stockés dans Secret Manager et injectés nativement par Cloud Run au démarrage de la révision — les valeurs en clair ne sont jamais écrites dans l'état.

`Formbricks Common` génère automatiquement tous les secrets applicatifs requis. Des secrets définis par l'utilisateur peuvent être ajoutés via `secret_environment_variables` pour les mots de passe SMTP et d'autres valeurs sensibles personnalisées.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `secret_environment_variables` | 6 | `{}` | Table de correspondance nom de variable d'environnement → ID de secret Secret Manager. Résolue à l'exécution. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence à laquelle Secret Manager émet des notifications de rotation. Par défaut : 30 jours. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret avant que les ressources dépendantes ne poursuivent. |

---

## 5. Trafic et entrée {#5-traffic--ingress}

### A. Équilibreur de charge HTTPS {#a-https-load-balancer}

Lorsque `enable_cloud_armor = true`, un équilibreur de charge HTTPS global adossé à un NEG sans serveur est provisionné. Le trafic suit ce chemin : Internet → Cloud Armor → équilibreur de charge HTTPS global → NEG sans serveur → Cloud Run.

Définir `ingress_settings = 'internal-and-cloud-load-balancing'` force tout le trafic Formbricks à passer par l'équilibreur de charge, ce qui empêche l'accès direct par l'URL `*.run.app`.

### B. Cloud CDN {#b-cloud-cdn}

Lorsque `enable_cdn = true` (nécessite `enable_cloud_armor = true`), Cloud CDN est rattaché au backend de l'équilibreur de charge HTTPS. Formbricks sert un mélange de pages Next.js rendues côté serveur et de ressources statiques. Le CDN convient bien aux ressources statiques (bundles JS, CSS, images d'enquêtes téléversées), mais les soumissions d'enquêtes et les points de terminaison d'API ne doivent pas être mis en cache.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. Effectif uniquement lorsque `enable_cloud_armor = true`. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag (orphelines) d'Artifact Registry. |
| `image_retention_days` | 10 | `30` | Nombre de jours au-delà duquel les images peuvent être supprimées. |

### C. Domaines personnalisés {#c-custom-domains}

Les domaines personnalisés sont rattachés à l'équilibreur de charge HTTPS global via `application_domains`. Des certificats SSL gérés par Google sont provisionnés automatiquement. Le DNS doit pointer vers l'IP de l'équilibreur de charge après l'apply.

Après avoir défini un domaine personnalisé, mettez à jour `webapp_url` en conséquence — NextAuth.js utilise cette valeur pour les URI de redirection OAuth et les liens des e-mails.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `application_domains` | 10 | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. Des certificats SSL gérés par Google sont provisionnés pour chaque domaine. |

---

## 6. CI/CD et livraison {#6-cicd--delivery}

### A. Déclencheurs Cloud Build {#a-cloud-build-triggers}

Lorsque `enable_cicd_trigger = true`, une connexion GitHub Cloud Build et un déclencheur sur push sont provisionnés. Le déclencheur construit et déploie une image Formbricks personnalisée lorsque du code est poussé sur la branche configurée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. Nécessite `github_repository_url` et des identifiants. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub (portées `repo`, `admin:repo_hook`). Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub (à privilégier pour les dépôts d'organisation). |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur : `branch_pattern`, `included_files`, `ignored_files`, `trigger_name`, `substitutions`. |

### B. Pipeline Cloud Deploy {#b-cloud-deploy-pipeline}

Lorsque `enable_cloud_deploy = true` (nécessite `enable_cicd_trigger = true`), le pipeline CI/CD est remplacé par un pipeline de livraison Cloud Deploy géré, avec des étapes de promotion séquentielles.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline Cloud Deploy. Nécessite `enable_cicd_trigger = true`. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion ordonnées. Chacune comporte : `name`, `require_approval`, `auto_promote`. |

---

## 7. Fiabilité et planification {#7-reliability--scheduling}

### A. Mise à l'échelle et concurrence {#a-scaling--concurrency}

`min_instance_count = 0` et `max_instance_count = 1` sont les valeurs par défaut. Les démarrages à froid de Formbricks prennent 15 à 20 secondes en raison de l'initialisation de Next.js et de l'établissement de la connexion Prisma. Pour les déploiements de production, définissez `min_instance_count = 1`.

Lorsque Redis est activé (`enable_redis = true`), plusieurs instances Formbricks peuvent partager l'état du cache, ce qui rend la mise à l'échelle horizontale sûre. Augmentez `max_instance_count` pendant les périodes d'enquêtes à fort trafic.

### B. Répartition du trafic {#b-traffic-splitting}

La répartition du trafic est prise en charge. Comme Formbricks externalise l'état des sessions dans PostgreSQL et l'état du cache dans Redis, les déploiements canary sont sûrs — les requêtes sont traitées de manière cohérente quelle que soit l'instance qui les reçoit.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `traffic_split` | 4 | `[]` | Répartition du trafic en pourcentages entre des révisions nommées. La somme de toutes les entrées doit être égale à 100. |

### C. Sondes de santé et surveillance de la disponibilité {#c-health-probes--uptime-monitoring}

Formbricks expose `/api/v2/health` — un point de terminaison de santé dédié qui ne renvoie `HTTP 200` qu'une fois que l'application ET ses dépendances base de données/Redis signalent une disponibilité complète. En raison de cette sémantique de « disponibilité complète », les sondes ne le ciblent délibérément **pas** toutes deux sous forme de vérification HTTP :

- **`startup_probe` est TCP par défaut**, et non HTTP `/api/v2/health` : une sonde HTTP sur ce chemin ne réussit jamais avant la disponibilité complète, si bien que la sonde de démarrage de Cloud Run n'aboutirait jamais alors que Next.js écoute déjà sur le port du conteneur (« Ready » dans les journaux, mais le service ne devient jamais routable). Une sonde TCP réussit dès que l'application se lie au port — le bon critère pour « acheminer le trafic ici ».
- **`liveness_probe` est désactivée par défaut** (`enabled = false`) : les sondes de vivacité Cloud Run ne peuvent pas utiliser de socket TCP, et le chemin HTTP `/api/v2/health` provoquerait une boucle de redémarrage d'un conteneur par ailleurs sain avant qu'il n'atteigne la disponibilité complète. La sonde de démarrage TCP conditionne déjà le trafic, la vivacité est donc laissée désactivée.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `startup_probe` | 14 | `{ enabled=true, type="TCP", path="/api/v2/health", initial_delay_seconds=30, timeout_seconds=5, period_seconds=20, failure_threshold=10 }` | Sonde de disponibilité au démarrage. **TCP par conception** — voir l'explication ci-dessus. Le conteneur ne reçoit aucun trafic tant qu'elle n'a pas réussi. |
| `liveness_probe` | 14 | `{ enabled=false, type="HTTP", path="/api/v2/health", initial_delay_seconds=15, timeout_seconds=5, period_seconds=30, failure_threshold=3 }` | Sonde de vivacité. **Désactivée par défaut** — voir l'explication ci-dessus. Ne l'activez que si vous comprenez le risque de boucle de redémarrage sur `/api/v2/health` avant la disponibilité complète. |
| `startup_probe_config` | 14 | `{ enabled=true, type="TCP" }` | Sonde de démarrage du service au niveau App_CloudRun, indépendante de la `startup_probe` propre à Formbricks ci-dessus. |
| `health_check_config` | 14 | `{ enabled=true, type="HTTP", path="/" }` | Sonde de vivacité du service au niveau App_CloudRun, indépendante de la `liveness_probe` propre à Formbricks ci-dessus. |
| `uptime_check_config` | 14 | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut ; activez-le pour la surveillance en production — des alertes sont envoyées à `support_users` en cas d'indisponibilité. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques Cloud Monitoring. |

### D. Rotation automatique des mots de passe {#d-auto-password-rotation}

Lorsque `enable_auto_password_rotation = true`, un pipeline de rotation des mots de passe sans interruption de service est provisionné :

1. Secret Manager émet une notification de rotation à chaque intervalle `secret_rotation_period`.
2. Eventarc déclenche un job Cloud Run de rotation.
3. Le job génère un nouveau mot de passe, met à jour l'utilisateur Cloud SQL PostgreSQL et écrit une nouvelle version du secret.
4. Après `rotation_propagation_delay_sec` secondes, le job redémarre le service Formbricks.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_auto_password_rotation` | 12 | `false` | Active la rotation automatisée des mots de passe. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après l'écriture du nouveau secret avant de redémarrer le service. |

---

## 8. Intégrations {#8-integrations}

### A. Cache Redis {#a-redis-cache}

Redis est **activé par défaut** (`enable_redis = true`). Formbricks utilise Redis pour mettre en cache les réponses d'API, limiter le débit et gérer les files de tâches en arrière-plan. Lorsque Redis est activé et que `redis_host` n'est pas fourni, le module utilise par défaut l'IP du serveur NFS comme hôte Redis (une instance Redis légère colocalisée sur la VM GCE NFS). Pour les déploiements de production, faites pointer `redis_host` vers une instance dédiée Google Cloud Memorystore for Redis.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `enable_redis` | 21 | `true` | Active Redis pour le cache et la limitation de débit de Formbricks. Recommandé pour tous les déploiements. |
| `redis_host` | 21 | `""` | Nom d'hôte ou IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | 21 | `'6379'` | Port TCP du serveur Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Sensible — jamais stocké dans l'état. |

### B. E-mail (SMTP) {#b-email-smtp}

Formbricks utilise SMTP pour les e-mails transactionnels : invitations d'utilisateurs, notifications de réponses aux enquêtes et e-mails d'intégration. Les variables SMTP dédiées offrent une interface plus claire que `environment_variables` :

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `smtp_host` | 5 | `'smtp.gmail.com'` | Nom d'hôte du serveur SMTP. Définissez `""` pour désactiver l'e-mail. |
| `smtp_port` | 5 | `587` | Port SMTP. Utilisez 587 pour STARTTLS (recommandé) ou 465 pour le TLS implicite. |
| `smtp_user` | 5 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | 5 | `""` | Mot de passe SMTP. Généré automatiquement et stocké dans Secret Manager s'il est laissé vide. Sensible. |
| `smtp_secure_enabled` | 5 | `false` | Active le TLS implicite. Définissez `true` lorsque `smtp_port = 465`. |
| `mail_from` | 5 | `""` | Adresse d'expéditeur affichée dans les e-mails de Formbricks (par exemple, `'noreply@surveys.example.com'`). |

### C. Formbricks Hub et Cube.js {#c-formbricks-hub--cubejs}

À partir de Formbricks v5, la plateforme se connecte à un service Formbricks Hub pour les licences et l'analytique, et à un sidecar Cube.js pour les requêtes analytiques.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `hub_api_url` | 21 | `'http://localhost:8080'` | URL de l'API Formbricks Hub. À remplacer lorsque Hub s'exécute comme service Cloud Run distinct. |
| `cubejs_api_url` | 21 | `'http://localhost:4000'` | URL de l'API d'analytique Cube.js. À remplacer pour un déploiement Cube.js distinct. |

### D. Import de sauvegarde et restauration {#d-backup-import--recovery}

Lorsque `enable_backup_import = true`, un job Cloud Run dédié restaure une sauvegarde de base de données existante dans l'instance Cloud SQL PostgreSQL provisionnée pendant l'apply.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes quotidiennes automatisées. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. Repassez à `false` après un import réussi. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI GCS complet) ou `'gdrive'` (ID de fichier Drive). |
| `backup_uri` | 7 | `""` | URI GCS complet (par exemple, `'gs://my-bucket/formbricks-2024.sql'`) ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format du fichier de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |

---

## 9. Comportements gérés par la plateforme {#9-platform-managed-behaviours}

Les comportements suivants sont appliqués automatiquement par `Formbricks CloudRun`, quelles que soient les valeurs des variables.

| Comportement | Mise en œuvre | Détail |
|---|---|---|
| **PostgreSQL 15 obligatoire** | `database_type = "POSTGRES_15"` fixé par `Formbricks Common` | Formbricks nécessite PostgreSQL. MySQL et SQL Server ne sont pas pris en charge. |
| **Stockage compatible S3 via GCS** | `STORAGE_PROVIDER=s3`, `S3_ENDPOINT_URL=https://storage.googleapis.com` injectés automatiquement | Le client de téléversement de fichiers S3 de Formbricks est dirigé vers GCS via l'API XML. Des identifiants HMAC stockés dans Secret Manager authentifient la connexion. |
| **Bucket de téléversements GCS** | Bucket `uploads` provisionné par `Formbricks Common` via `module_storage_buckets` | Un bucket GCS dédié aux téléversements de fichiers Formbricks est provisionné séparément de `storage_buckets`. |
| **Secrets générés automatiquement** | `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Tous les secrets au niveau de l'application sont créés une seule fois par `Formbricks Common` et restent stables. |
| **NFS activé par défaut** | Valeur par défaut `enable_nfs = true` | Un stockage NFS partagé est provisionné. Nécessite `execution_environment = 'gen2'`. |
| **Redis activé par défaut** | Valeur par défaut `enable_redis = true` | Le cache Redis est activé par défaut. Lorsque `redis_host` est vide, l'IP du serveur NFS est utilisée. |
| **Mise en miroir des images** | Valeur par défaut `enable_image_mirroring = true` | Les images Formbricks sont mises en miroir de `ghcr.io` vers Artifact Registry pour éviter les limites de débit. |
| **Connexion à la base de données par socket Unix** | Valeur par défaut `enable_cloudsql_volume = true` | Formbricks se connecte à PostgreSQL par le socket Unix du Cloud SQL Auth Proxy plutôt qu'en TCP direct par IP, ce qui évite l'échec de vérification du certificat par Prisma face à l'autorité de certification non approuvée de Cloud SQL. |
| **Sonde de démarrage TCP** | Valeur par défaut `startup_probe.type = "TCP"` | Le point de terminaison `/api/v2/health` de Formbricks ne renvoie un code 2xx qu'à disponibilité complète (base de données + Redis + dépendances), si bien qu'une sonde HTTP sur celui-ci ne réussit jamais ; TCP réussit dès que l'application se lie au port. |
| **Sonde de vivacité désactivée** | Valeur par défaut `liveness_probe.enabled = false` | La vivacité Cloud Run ne peut pas utiliser TCP, et HTTP `/api/v2/health` provoquerait une boucle de redémarrage d'un conteneur sain mais pas encore pleinement disponible. La sonde de démarrage TCP conditionne déjà le routage. |
| **Répertoire des scripts** | `scripts_dir = abspath("${module.formbricks_app.path}/scripts")` | Les scripts d'initialisation proviennent de `Formbricks Common`. |

---

## 10. Explorer avec la console GCP {#10-exploring-with-the-gcp-console}

Après le déploiement, utilisez la console GCP pour observer et exploiter le déploiement Formbricks.

**Service Cloud Run :**
- Accédez à **Cloud Run** dans la console et sélectionnez votre service Formbricks (nommé `appformbricks<tenant><id>`).
- L'onglet **Revisions** affiche chaque révision déployée avec sa répartition du trafic, son nombre d'instances et son horodatage de création.
- L'onglet **Metrics** affiche le nombre de requêtes, les latences des requêtes, le nombre d'instances de conteneur et la latence de démarrage — utile pour évaluer les réglages de `min_instance_count`.
- L'onglet **Logs** diffuse directement les journaux du conteneur. Au premier démarrage, recherchez la sortie des migrations Prisma et les messages de démarrage de NextAuth.js.
- L'onglet **YAML** révèle la spécification complète du service Cloud Run, y compris toutes les variables d'environnement injectées (les références de secrets apparaissent sous forme de noms de secrets, et non de valeurs).

**Secret Manager :**
- Accédez à **Security → Secret Manager** et filtrez sur le préfixe du déploiement (par exemple, `formbricks-demo`).
- Les secrets générés automatiquement — `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `HUB_API_KEY`, `CUBEJS_API_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — seront tous présents.
- L'onglet **Versions** de chaque secret indique quand il a été créé. Un secret qui n'a qu'une seule version et aucune activité de rotation est dans son état initial.
- Cliquez sur le nom d'un secret pour voir quels services Cloud Run y font référence (sous **Usage**).

**Cloud SQL :**
- Accédez à **SQL** et sélectionnez l'instance PostgreSQL utilisée par Formbricks.
- L'onglet **Connections** affiche les connexions actives à la base de données depuis le compte de service Cloud Run.
- L'onglet **Databases** confirme l'existence de la base de données `formbricks`.
- L'onglet **Users** confirme que l'utilisateur `formbricks` a été créé par le job `db-init`.
- L'onglet **Operations** journalise toutes les actions d'administration, y compris la création d'utilisateurs et les changements de mot de passe.

**Cloud Storage :**
- Accédez à **Cloud Storage → Buckets** et recherchez le bucket `uploads` (nommé avec le préfixe de l'application et du déploiement).
- Les pièces jointes des réponses aux enquêtes téléversées par les utilisateurs apparaissent comme des objets dans le bucket.
- L'onglet **Permissions** confirme que le compte de service HMAC dispose de `roles/storage.objectAdmin` sur le bucket.
- L'onglet **Configuration** affiche l'état CMEK si `manage_storage_kms_iam = true`.

**Cloud Build :**
- Accédez à **Cloud Build → History** pour consulter l'historique des builds de l'image Formbricks.
- Chaque build correspond à un déploiement ou à une incrémentation de version.
- Cliquez sur un build pour voir les étapes du Dockerfile, les arguments de build et la cible de push dans Artifact Registry.

**Artifact Registry :**
- Accédez à **Artifact Registry** et trouvez le dépôt du déploiement Formbricks.
- Les images portent le tag correspondant à la valeur de `application_version`.
- L'onglet **Vulnerabilities** (si l'analyse est activée) affiche les CVE détectées dans l'image Formbricks.

**Cloud Monitoring :**
- Accédez à **Monitoring → Uptime checks** pour voir le test de disponibilité créé par le module (lorsque `uptime_check_config.enabled = true`).
- Accédez à **Monitoring → Alerting** pour voir les `alert_policies` configurées.
- Dans **Metrics Explorer**, interrogez `run.googleapis.com/request_latencies` en filtrant sur le nom de votre service pour suivre les temps de réponse p50/p95/p99.

---

## 11. Explorer avec gcloud {#11-exploring-with-gcloud}

Les commandes suivantes sont utiles pour l'exploitation quotidienne d'un déploiement Formbricks sur Cloud Run. Remplacez `PROJECT_ID`, `REGION` et `DEPLOYMENT_ID` par vos valeurs.

**Décrire le service Cloud Run et récupérer son URL :**
```bash
gcloud run services describe appformbricks<DEPLOYMENT_ID> \
  --region=REGION \
  --project=PROJECT_ID \
  --format="yaml(status.url, spec.template.spec.containers[0].resources)"
```

**Lister toutes les révisions Cloud Run et leur répartition du trafic :**
```bash
gcloud run revisions list \
  --service=appformbricks<DEPLOYMENT_ID> \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(metadata.name, status.conditions[0].status, spec.containerConcurrency, metadata.creationTimestamp)"
```

**Suivre en direct les journaux du conteneur Cloud Run :**
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="appformbricks<DEPLOYMENT_ID>"' \
  --project=PROJECT_ID \
  --freshness=10m \
  --format="table(timestamp, textPayload)" \
  --order=asc
```

**Lister tous les secrets Formbricks dans Secret Manager :**
```bash
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, replication.automatic, createTime)"
```

**Afficher la dernière version d'un secret donné (métadonnées uniquement — pas la valeur) :**
```bash
gcloud secrets versions describe latest \
  --secret=formbricks-nextauth-secret \
  --project=PROJECT_ID
```

**Lister les jobs Cloud Run (y compris db-init) :**
```bash
gcloud run jobs list \
  --region=REGION \
  --project=PROJECT_ID \
  --filter="metadata.name~formbricks"
```

**Exécuter manuellement le job db-init (par exemple, après une modification du schéma) :**
```bash
gcloud run jobs execute formbricks-db-init-<DEPLOYMENT_ID> \
  --region=REGION \
  --project=PROJECT_ID \
  --wait
```

**Vérifier l'instance Cloud SQL et la base de données :**
```bash
gcloud sql instances describe <SQL_INSTANCE_NAME> \
  --project=PROJECT_ID \
  --format="table(name, state, databaseVersion, settings.tier, ipAddresses)"

gcloud sql databases list \
  --instance=<SQL_INSTANCE_NAME> \
  --project=PROJECT_ID
```

**Lister les buckets GCS du déploiement Formbricks :**
```bash
gcloud storage buckets list \
  --project=PROJECT_ID \
  --filter="name~formbricks" \
  --format="table(name, location, storageClass)"
```

**Consulter l'historique Cloud Build des builds d'image :**
```bash
gcloud builds list \
  --project=PROJECT_ID \
  --filter="substitutions.REPO_NAME~formbricks" \
  --limit=10 \
  --format="table(id, status, createTime, duration)"
```

**Lister les images Artifact Registry :**
```bash
gcloud artifacts docker images list \
  REGION-docker.pkg.dev/PROJECT_ID/REPO_NAME \
  --filter="package~formbricks" \
  --format="table(package, tags, updateTime)"
```

**Vérifier l'état du test de disponibilité :**
```bash
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --filter="displayName~formbricks"
```

---

## 12. Référence des variables {#12-variable-reference}

Toutes les variables configurables par l'utilisateur exposées par `Formbricks CloudRun`, triées par groupe d'interface puis par ordre.

| Variable | Groupe | Valeur par défaut | Description |
|---|---|---|---|
| `project_id` | 1 | — | ID du projet GCP. **Obligatoire.** |
| `region` | 1 | `'us-central1'` | Région GCP de déploiement des ressources. |
| `tenant_id` | 2 | `'demo'` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | 2 | `[]` | Adresses e-mail destinataires des alertes de surveillance. |
| `resource_labels` | 2 | `{}` | Libellés appliqués à toutes les ressources provisionnées. |
| `application_name` | 3 | `'formbricks'` | Nom de base des ressources. Ne le modifiez pas après le déploiement initial. |
| `display_name` | 3 | `'Formbricks Surveys'` | Nom lisible affiché dans la console GCP. |
| `description` | 3 | `'Formbricks - Open Source Survey and Experience Management'` | Description du service. |
| `application_version` | 3 | `'latest'` | Tag de l'image de conteneur. Incrémentez-le pour déployer une nouvelle version. |
| `webapp_url` | 3 | `""` | URL publique de l'instance Formbricks. **À définir après le premier déploiement.** |
| `deploy_application` | 4 | `true` | Définissez `false` pour un déploiement d'infrastructure seule. |
| `container_image_source` | 4 | `'custom'` | `'custom'` (Cloud Build) ou `'prebuilt'` (image existante). |
| `container_image` | 4 | `""` | URI de l'image de conteneur. Laissez vide pour que Cloud Build la gère. |
| `container_build_config` | 4 | `{ enabled = true }` | Configuration Cloud Build : chemin du Dockerfile, contexte, arguments de build. |
| `cpu_limit` | 4 | `'1000m'` | CPU par instance. Passez à `'2000m'` en production. |
| `memory_limit` | 4 | `'2Gi'` | Mémoire par instance. Formbricks (Next.js 16) nécessite au minimum 2Gi — 512Mi provoque des plantages OOM au démarrage. |
| `container_port` | 4 | `3000` | Port natif de Formbricks. Ne le modifiez pas. |
| `execution_environment` | 4 | `'gen2'` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | 4 | `300` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | 4 | `true` | Monte le socket du Cloud SQL Auth Proxy. Vaut `true` par défaut — évite un échec de vérification du certificat en TCP direct par IP. |
| `cloudsql_volume_mount_path` | 4 | `'/cloudsql'` | Chemin du conteneur pour le socket de l'Auth Proxy lorsque `enable_cloudsql_volume = true`. |
| `container_protocol` | 4 | `'http1'` | `'http1'` ou `'h2c'`. |
| `enable_image_mirroring` | 4 | `true` | Met en miroir l'image Formbricks dans Artifact Registry. |
| `traffic_split` | 4 | `[]` | Répartition du trafic canary/blue-green. |
| `min_instance_count` | 4 | `0` | Nombre minimal d'instances en cours d'exécution. Définissez `1` en production. |
| `max_instance_count` | 4 | `1` | Nombre maximal d'instances simultanées. Augmentez-le pour un trafic plus élevé. |
| `cpu_always_allocated` | 4 | `false` | Facturation à la requête par défaut (Formbricks sert les enquêtes et le tableau de bord à la demande ; le pipeline de réponses — e-mails de notification, webhooks, intégrations — ne s'exécute qu'après une réponse à une enquête). Définissez `true` pour les enquêtes en direct qui exigent des notifications/webhooks en temps réel sans attendre la requête suivante. |
| `max_revisions_to_retain` | 4 | `7` | Nombre maximal de révisions Cloud Run à conserver. |
| `service_annotations` | 4 | `{}` | Annotations Cloud Run avancées. |
| `service_labels` | 4 | `{}` | Libellés appliqués au service Cloud Run. |
| `ingress_settings` | 5 | `'all'` | `'all'`, `'internal'` ou `'internal-and-cloud-load-balancing'`. |
| `vpc_egress_setting` | 5 | `'PRIVATE_RANGES_ONLY'` | `'PRIVATE_RANGES_ONLY'` ou `'ALL_TRAFFIC'`. |
| `enable_iap` | 5 | `false` | Active IAP nativement sur le service Cloud Run. |
| `iap_authorized_users` | 5 | `[]` | Utilisateurs/comptes de service disposant d'un accès IAP. |
| `iap_authorized_groups` | 5 | `[]` | Groupes Google disposant d'un accès IAP. |
| `smtp_host` | 5 | `'smtp.gmail.com'` | Nom d'hôte du serveur SMTP. Définissez `""` pour désactiver l'e-mail. |
| `smtp_port` | 5 | `587` | Port SMTP (587 pour STARTTLS, 465 pour le TLS implicite). |
| `smtp_user` | 5 | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | 5 | `""` | Mot de passe SMTP. Généré automatiquement dans Secret Manager s'il est vide. Sensible. |
| `smtp_secure_enabled` | 5 | `false` | Active le TLS implicite (`true` pour le port 465). |
| `mail_from` | 5 | `""` | Adresse d'expéditeur des e-mails de Formbricks. |
| `environment_variables` | 6 | Valeurs SMTP par défaut | Variables d'environnement en clair. Valeurs SMTP par défaut préremplies. |
| `secret_environment_variables` | 6 | `{}` | Références Secret Manager pour d'autres valeurs sensibles. |
| `secret_propagation_delay` | 6 | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | 6 | `'2592000s'` | Fréquence des notifications de rotation de Secret Manager. |
| `backup_schedule` | 7 | `'0 2 * * *'` | Expression cron (UTC) pour les sauvegardes automatisées. |
| `backup_retention_days` | 7 | `7` | Nombre de jours de conservation des fichiers de sauvegarde dans GCS. |
| `enable_backup_import` | 7 | `false` | Déclenche une restauration ponctuelle lors de l'apply. |
| `backup_source` | 7 | `'gcs'` | `'gcs'` (URI complet) ou `'gdrive'` (ID de fichier). |
| `backup_uri` | 7 | `""` | URI GCS complet ou ID de fichier Google Drive. |
| `backup_format` | 7 | `'sql'` | Format de sauvegarde. Options : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`. |
| `enable_cicd_trigger` | 8 | `false` | Provisionne un déclencheur GitHub Cloud Build. |
| `github_repository_url` | 8 | `""` | URL HTTPS complète du dépôt GitHub. |
| `github_token` | 8 | `""` | PAT GitHub. Requis lors du premier apply. Sensible. |
| `github_app_installation_id` | 8 | `""` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | 8 | `{ branch_pattern = "^main$" }` | Configuration avancée du déclencheur Cloud Build. |
| `enable_cloud_deploy` | 8 | `false` | Provisionne un pipeline de livraison progressive Cloud Deploy. |
| `cloud_deploy_stages` | 8 | `[dev, staging, prod(approval)]` | Étapes de promotion Cloud Deploy ordonnées. |
| `enable_binary_authorization` | 8 | `false` | Impose l'attestation des images lors du déploiement. |
| `enable_custom_sql_scripts` | 9 | `false` | Exécute des scripts SQL depuis GCS après le provisionnement. |
| `custom_sql_scripts_bucket` | 9 | `""` | Bucket GCS contenant les scripts SQL. |
| `custom_sql_scripts_path` | 9 | `""` | Préfixe de chemin dans le bucket. |
| `custom_sql_scripts_use_root` | 9 | `false` | Exécute les scripts avec l'utilisateur root de la base de données. |
| `nfs_instance_name` | 9 | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | 9 | `'app-nfs'` | Nom de base de la VM NFS intégrée. |
| `enable_cloud_armor` | 10 | `false` | Provisionne un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | 10 | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | 10 | `[]` | Domaines personnalisés avec certificats SSL gérés par Google. |
| `enable_cdn` | 10 | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` | 10 | `7` | Nombre maximal d'images de conteneur à conserver dans Artifact Registry. |
| `delete_untagged_images` | 10 | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | 10 | `30` | Nombre de jours au-delà duquel les images peuvent être supprimées. |
| `create_cloud_storage` | 11 | `true` | Définissez `false` pour ne pas créer de buckets GCS. |
| `storage_buckets` | 11 | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | 11 | `true` | Provisionne un stockage partagé NFS. Nécessite `gen2`. |
| `nfs_mount_path` | 11 | `'/mnt/nfs'` | Chemin du conteneur où NFS est monté. |
| `gcs_volumes` | 11 | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` | 11 | `false` | Crée une clé KMS CMEK et active CMEK sur les buckets de stockage. |
| `enable_artifact_registry_cmek` | 11 | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |
| `db_name` | 12 | `'formbricks'` | Nom de la base de données PostgreSQL. Ne le modifiez pas après le déploiement initial. |
| `db_user` | 12 | `'formbricks'` | Utilisateur applicatif PostgreSQL. |
| `database_type` | 12 | `'POSTGRES_15'` | Moteur de base de données. Ne le modifiez pas — Formbricks nécessite PostgreSQL. |
| `database_password_length` | 12 | `32` | Longueur du mot de passe généré automatiquement. Plage : 16–64. |
| `enable_auto_password_rotation` | 12 | `false` | Rotation automatisée des mots de passe sans interruption de service. |
| `rotation_propagation_delay_sec` | 12 | `90` | Secondes d'attente après la rotation avant de redémarrer le service. |
| `initialization_jobs` | 13 | `[]` | Jobs Cloud Run ponctuels. Laissez vide pour que `Formbricks Common` fournisse le job `db-init` par défaut. |
| `cron_jobs` | 13 | `[]` | Jobs Cloud Run planifiés récurrents. |
| `startup_probe` | 14 | `{ path="/api/v2/health", initial_delay_seconds=30, failure_threshold=10 }` | Sonde de démarrage ciblant le point de terminaison de santé de Formbricks. |
| `liveness_probe` | 14 | `{ path="/api/v2/health", initial_delay_seconds=15, failure_threshold=3 }` | Sonde de vivacité. |
| `startup_probe_config` | 14 | `{ enabled=true, type="TCP" }` | Sonde de démarrage du service au niveau App_CloudRun. |
| `health_check_config` | 14 | `{ enabled=true, type="HTTP", path="/" }` | Sonde de vivacité du service au niveau App_CloudRun. |
| `uptime_check_config` | 14 | `{ enabled=true, path="/" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | 14 | `[]` | Règles d'alerte sur les métriques Cloud Monitoring. |
| `enable_redis` | 21 | `true` | Redis pour le cache et la limitation de débit de Formbricks. |
| `redis_host` | 21 | `""` | Nom d'hôte/IP Redis. Par défaut, l'IP du serveur NFS lorsqu'il est vide. |
| `redis_port` | 21 | `'6379'` | Port TCP Redis (chaîne). |
| `redis_auth` | 21 | `""` | Mot de passe Redis AUTH. Sensible. |
| `hub_api_url` | 21 | `'http://localhost:8080'` | URL de l'API Formbricks Hub (v5+). |
| `cubejs_api_url` | 21 | `'http://localhost:4000'` | URL de l'API d'analytique Cube.js (v5+). |
| `enable_vpc_sc` | 22 | `false` | Inscrit les appels d'API dans le périmètre VPC-SC du projet. |
| `vpc_cidr_ranges` | 22 | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | 22 | `true` | Journalise les violations VPC-SC sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | 22 | `""` | ID d'organisation GCP pour VPC-SC. Découvert automatiquement s'il est vide. |
| `enable_audit_logging` | 22 | `false` | Active les journaux Cloud Audit Logs détaillés. |

---

## 13. Sorties {#13-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique du service Cloud Run. |
| `service_location` | Région GCP où le service Cloud Run est déployé. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe d'ID de déploiement utilisé dans les noms de ressources. |
| `database_instance_name` | Nom de l'instance Cloud SQL PostgreSQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés (y compris le bucket `uploads`). |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critical** (perte de données, panne totale, faille de sécurité) — **High** (service indisponible ou dégradation importante) — **Medium** (fonctionnement dégradé ou coût accru) — **Low** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critical** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `webapp_url` | `""` (calculée automatiquement) | **Medium** | Lorsqu'elle est laissée vide, `main.tf` calcule une URL de service Cloud Run déterministe et l'injecte sous la forme `WEBAPP_URL`/`NEXTAUTH_URL` — Formbricks ne se rabat donc pas réellement sur `localhost:3000` sur cette plateforme. Définissez `webapp_url` explicitement pour faire pointer les URI de redirection OAuth et les liens des e-mails vers un domaine personnalisé plutôt que vers l'URL `run.app` prévue. |
| `db_name` | `"formbricks"` | **Critical** | Immuable après le premier déploiement — la modifier entraîne la recréation de la base de données et détruit toutes les définitions d'enquêtes, les réponses et les données utilisateur. |
| `db_user` | `"formbricks"` | **Critical** | Immuable après le premier déploiement — la modifier recrée l'utilisateur PostgreSQL et invalide tous les identifiants stockés. |
| `enable_redis` | `true` | **High** | Redis est activé par défaut. Lorsque `redis_host = ""`, le module se rabat sur l'IP du serveur NFS. Si `enable_nfs = false` et que `redis_host` est également vide, Formbricks ne peut pas initialiser sa couche de cache et échoue au démarrage. |
| `redis_host` | `""` (résolue automatiquement vers l'IP NFS) | **High** | S'appuie sur l'IP du serveur NFS lorsqu'elle est vide. Si NFS est également désactivé, la connexion à Redis échoue au démarrage. |
| `enable_nfs` | `true` | **High** | Sans NFS, les ressources d'enquêtes et les pièces jointes téléversées sont stockées sur le système de fichiers éphémère du conteneur. Tous les téléversements sont perdus à chaque nouvelle révision Cloud Run. Plusieurs instances servent alors des contenus de fichiers incohérents. |
| `memory_limit` | `"2Gi"` | **High** | Le runtime Next.js et l'ORM Prisma de Formbricks exigent une mémoire importante. Descendre sous `512Mi` provoque des plantages OOM avec un trafic d'enquêtes normal. `2Gi` est le minimum recommandé en production. |
| `min_instance_count` | `0` | **Medium** | La mise à l'échelle à zéro entraîne des démarrages à froid de 15 à 20 secondes. Les utilisateurs qui consultent une enquête juste après une période d'inactivité subissent ce délai. Définissez `1` pour toute enquête de production soumise à un SLA. |
| `cpu_always_allocated` | `false` | **Medium** | Facturation à la requête par défaut — le pipeline de réponses (e-mails de notification, webhooks, intégrations) ne s'exécute que lorsqu'une instance sert une requête. Si vous menez des enquêtes en direct qui exigent la livraison en temps réel des notifications/webhooks sans attendre que la requête suivante réveille l'instance, définissez `true` (facturation à l'instance, coût plus élevé). |
| `smtp_host` | `'smtp.gmail.com'` (valeur fictive) | **High** | Vaut par défaut un nom d'hôte fictif afin que la validation de l'environnement de Formbricks dispose d'un bloc SMTP complet ; sans véritables identifiants `smtp_user`/`smtp_password`, l'envoi d'e-mails échoue tout de même. Configurez un véritable fournisseur SMTP avant d'inviter des membres de l'équipe. |
| `enable_cloud_armor` | `false` | **Medium** | Sans Cloud Armor, le panneau d'administration de Formbricks est accessible depuis l'internet public, protégé uniquement par l'authentification propre à Formbricks. Activez-le pour tout déploiement de production. |
| `backup_retention_days` | `7` | **Medium** | Sept jours sont insuffisants pour des déploiements d'enquêtes actifs. Portez cette valeur à 30 jours ou plus pour toute instance Formbricks de production qui collecte des réponses d'enquêtes précieuses. |
| `container_port` | `3000` | **Critical** | Formbricks écoute sur le port 3000. Le modifier sans adapter la configuration du serveur d'application fait échouer toutes les sondes de santé Cloud Run et marque le service comme non sain. |
| `enable_backup_import` | `false` | **Critical** | Exige que `backup_uri` soit un chemin GCS ou Drive valide et accessible. L'activer avec un `backup_uri` vide fait échouer le job de restauration pendant l'apply. |
| `secret_propagation_delay` | `30` | **Low** | Parfois insuffisant dans les configurations multirégions. Portez-le à 60–90 s si les secrets Formbricks sont introuvables pendant l'apply. |

---

## Destruction des ressources {#destroying-resources}

### Problème de suppression connu : libération des adresses IPv4 sans serveur {#known-deletion-issue-serverless-ipv4-address-release}

Lors de la destruction d'un déploiement Cloud Run, vous pouvez rencontrer une erreur semblable à celle-ci :

```
Error: Error waiting for Subnetwork to be deleted: The following serverless IPv4 address(es) on subnet ... are still in use.
```

**Cause :** GCP conserve de manière asynchrone les adresses IPv4 sans serveur sur le sous-réseau VPC après la suppression d'un service Cloud Run. Ces adresses sont libérées environ **20 à 30 minutes** après la suppression du service Cloud Run.

**Résolution :** attendez 20 à 30 minutes après la première tentative de destruction, puis relancez la commande de destruction :

```bash
tofu destroy
```

La seconde exécution réussit une fois que GCP a libéré les adresses réservées.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Formbricks sur Cloud Run](../labs/Formbricks_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Module Formbricks GKE — Guide de configuration](Formbricks_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Formbricks Common](Formbricks_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Flarum sur Google Cloud Run](Flarum_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md), [Rallly sur Google Cloud Run](Rallly_CloudRun.md) dans la solution **Community & Voice of Customer**.
