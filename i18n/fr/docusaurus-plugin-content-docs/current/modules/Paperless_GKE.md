---
title: "Module Paperless-ngx GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Paperless sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Paperless_GKE.md @ df67eef sha256:8697495f24a4 -->

# Module Paperless-ngx GKE — Guide de configuration {#paperless-ngx-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Paperless_GKE.png" alt="Module Paperless-ngx GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit toutes les variables de configuration disponibles dans le module `Paperless_GKE`. `Paperless_GKE` est un **module enveloppant** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Paperless_Common`](./Paperless_Common) pour déployer [Paperless-ngx](https://docs.paperless-ngx.com/) — un système de gestion de documents open source avec OCR, recherche plein texte et étiquetage automatisé — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Paperless GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Paperless-ngx** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Paperless |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Paperless ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Calcul (GKE Autopilot) | Valeurs par défaut spécifiques à Paperless pour `container_port`, `cpu_limit`, `memory_limit` et `timeout_seconds` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Configuration du service principal | Deux secrets auto-générés par `Paperless Common` ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et stratégies réseau | §3.D Réseau et stratégies réseau | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Un job `db-init` par défaut (de `Paperless Common`) crée la base de données et l'utilisateur ; les migrations Django s'exécutent ensuite automatiquement au démarrage ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Services supplémentaires | `additional_services` peut être utilisé pour ajouter Gotenberg ou Tika ; voir [Groupe 8 : Jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Stockage — NFS | §3.C Stockage (NFS / GCS / GCS Fuse) | `enable_nfs` utilise `true` par défaut ; requis lorsqu'aucun `redis_host` explicite n'est fourni ; voir [Groupe 9 : Stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Bucket GCS `paperless-media` provisionné automatiquement ; GCS FUSE monté automatiquement à `/usr/src/paperless/media` ; voir [Groupe 10 : Stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **PostgreSQL 15 requis** ; voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Plan de sauvegarde et rétention | §3.B Base de données (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Jobs d'initialisation et CronJobs | Identique. |
| Observabilité et vérifications de santé | §3.A Calcul (GKE Autopilot) | Système de sonde à deux chemins ; voir [Groupe 13 : Observabilité et santé](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Proxy conscient de l'identité | §4.B Proxy conscient de l'identité (IAP) | Identique. |
| Autorisation binaire | §4.C Autorisation binaire | Identique. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |
| Pilote CSI du magasin de secrets | §4.E Pilote CSI du magasin de secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | §5 Trafic et Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | Identique. |
| Déclencheurs Cloud Build | §6.A Déclencheurs Cloud Build | Identique. |
| Pipeline Cloud Deploy | §6.B Pipeline Cloud Deploy | Identique. |
| Mise en miroir des images | §6.C Mise en miroir des images | `enable_image_mirroring` utilise `true` par défaut ; les images Paperless-ngx sont hébergées sur GHCR. |
| Budgets d'interruption de pod | §7.A Budgets d'interruption de pod | `enable_pod_disruption_budget` utilise `false` par défaut ; voir [Groupe 14 : Politiques de fiabilité](#group-14-reliability-policies). |
| Contraintes de répartition de topologie | §7.B Contraintes de répartition de topologie | Identique. |
| Quotas de ressources | §7.C Quotas de ressources | Identique. |
| Rotation automatique des mots de passe | §7.D Rotation automatique des mots de passe | Voir [Groupe 11 : Configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` utilise `true` par défaut — Redis est **obligatoire**, pas facultatif ; voir [Groupe 16 : Redis (Celery Broker)](#group-16-redis-celery-broker). |
| Importation de sauvegarde | §8.B Importation de sauvegarde | Voir [Groupe 6 : Sauvegarde et maintenance](#group-6-backup--maintenance). |
| Maillage de services (ASM) | §8.C Maillage de services (ASM via Fleet) | Identique. |
| Services multi-clusters | §8.D Services multi-clusters (MCS) | Identique. |

---

## Comment Paperless GKE est lié à App GKE {#how-paperless-gke-relates-to-app-gke}

`Paperless GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Paperless Common` qui fournit des valeurs par défaut et une configuration d'application spécifiques à Paperless-ngx. Les principaux effets sont les suivants :

1.  **PostgreSQL 15 est requis.** Paperless-ngx ne prend en charge que PostgreSQL. Le type de base de données est fixé à `"POSTGRES_15"`.
2.  **Deux secrets sont auto-générés par `Paperless Common`.** `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY` sont créés dans Secret Manager et injectés automatiquement dans le conteneur. Vous n'avez pas besoin de les créer ou de les gérer manuellement.
3.  **Un bucket GCS `paperless-media` est provisionné automatiquement.** `Paperless Common` fournit une définition de bucket `paperless-media`. Par défaut, le pilote CSI GCS FUSE monte ce bucket à `/usr/src/paperless/media` à l'intérieur du conteneur. Vous n'avez pas besoin de définir ce bucket dans `storage_buckets`.
4.  **Redis est obligatoire.** Paperless-ngx utilise Redis comme courtier de messages Celery pour tous les traitements de documents en arrière-plan, l'OCR, les jobs du pipeline de consommation et la planification des tâches asynchrones. Contrairement à d'autres modules où Redis est facultatif pour la mise en cache, la suppression de Redis de Paperless-ngx entraîne l'arrêt complet du traitement des documents en arrière-plan.
5.  **Un job `db-init` par défaut est fourni par `Paperless Common`.** Lorsque `initialization_jobs` est vide, un job Kubernetes `db-init` (image `postgres:15-alpine`, script `db-init.sh`) crée la base de données PostgreSQL et l'utilisateur de l'application avant le démarrage de la charge de travail. Les migrations de schéma Django s'exécutent ensuite automatiquement au démarrage du conteneur via le script de point d'entrée.
6.  **Les valeurs par défaut des ressources sont dimensionnées pour les charges de travail OCR.** Les valeurs par défaut `cpu_limit` (2 vCPU) et `memory_limit` (2 Gi) reflètent les exigences de Tesseract OCR. L'OCR sur les PDF de plusieurs pages est gourmand en CPU — envisagez d'augmenter `cpu_limit` pour une ingestion à volume élevé.
7.  **La mise en miroir des images est activée par défaut.** Les images Paperless-ngx sont hébergées sur GitHub Container Registry (GHCR). Le module met en miroir l'image vers Artifact Registry par défaut pour éviter les limites de débit de GHCR.
8.  **`timeout_seconds` est défini par défaut à 300 secondes** (identique à la valeur par défaut de la fondation `App_GKE` — pas une surcharge). Le traitement OCR sur de gros documents peut être lent, donc cette valeur par défaut généreuse empêche Kubernetes de terminer prématurément les requêtes d'ingestion lentes.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(requis)* | ID du projet GCP. |
| `region` | `"us-central1"` | Région GCP pour le déploiement des ressources. Utilisé comme solution de repli lorsque la découverte du réseau ne peut pas déterminer la région à partir des sous-réseaux VPC existants. Également utilisé comme emplacement du bucket de stockage pour le bucket `paperless-media`. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-3--application-identity) pour les descriptions.

**Valeurs par défaut spécifiques à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"paperless"` | `"gkeapp"` | Utilisé comme nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `display_name` | `"Paperless-ngx - Document Management System"` | `"App GKE Application"` | Affiché dans l'interface utilisateur et les tableaux de bord de la plateforme. Peut être modifié librement. |
| `description` | `"Paperless-ngx - open-source document management system with OCR, full-text search, and automated tagging"` | `"App GKE Custom Application…"` | Étiquette descriptive. Peut être modifiée librement. |
| `application_version` | `"latest"` | `"1.0.0"` | Balise de version de l'image Paperless-ngx. Épinglez à une version spécifique (par exemple, `"2.13.5"`) pour les déploiements de production afin d'assurer des builds reproductibles. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

**Valeurs par défaut et comportement spécifiques à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `8000` | `8080` | Le gunicorn Paperless-ngx écoute sur le port 8000. Ne pas modifier sauf si votre Dockerfile personnalisé se lie à un port différent. |
| `cpu_limit` | `"2000m"` | `"1000m"` | Tesseract OCR est gourmand en CPU, surtout pour les PDF de plusieurs pages. 2 vCPU est le minimum recommandé pour la production. Augmenter à 4000m pour les pipelines d'ingestion de documents à volume élevé. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Paperless-ngx charge les miniatures de documents, les modèles linguistiques Tesseract et les modèles de classification ML en mémoire. 2 Gi est le minimum ; augmenter à 4 Gi pour les déploiements traitant de gros documents ou plusieurs langues simultanément. |
| `min_instance_count` | `1` | `1` | Toujours au moins un pod en cours d'exécution. La mise à l'échelle à zéro n'est pas recommandée — maintenir un pod en vie garantit que le processus de travail Celery écoute toujours sur le répertoire de consommation. |
| `max_instance_count` | `3` | `3` | Nombre maximal de réplicas de pods. Augmenter pour l'ingestion de documents à volume élevé. |
| `timeout_seconds` | `300` | `300` | Non surchargé — la valeur par défaut d'App_GKE est déjà de 300s, ce qui couvre confortablement l'OCR sur les PDF volumineux et de plusieurs pages. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy est requis. Paperless-ngx se connecte à PostgreSQL via le socket Unix d'Auth Proxy. |
| `enable_image_mirroring` | `true` | `true` | Non surchargé — App_GKE met déjà en miroir par défaut. Toujours important pour Paperless-ngx : les images hébergées sur GHCR bénéficient de la copie Artifact Registry pour éviter les limites de débit et satisfaire aux exigences d'autorisation binaire. |

Les variables d'exécution restantes (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `container_resources`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy), [App_GKE](./App_GKE.md#group-19--access--networking) et [App_GKE](./App_GKE.md#group-21--cloud-armor--cdn).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. Recommandé pour les déploiements de gestion de documents où l'accès doit être restreint à votre organisation. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service ayant accès à IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google ayant accès à IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration IAP. |
| `enable_custom_domain` | `true` | Configure Ingress/Gateway pour le routage de domaine personnalisé avec des certificats SSL gérés. Activé par défaut — une Gateway avec une IP statique est provisionnée automatiquement. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple `["paperless.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; auto-généré si vide. |
| `network_tags` | `["nfsserver"]` | Balises de pare-feu appliquées aux nœuds du cluster GKE. La balise `nfsserver` est requise pour la connectivité NFS. |
| `enable_cloud_armor` | `false` | Active une politique de sécurité Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées via Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_vpc_sc` | `false` | Active l'application du périmètre des contrôles de service VPC. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Secrets auto-générés spécifiques à Paperless :**

`Paperless Common` crée et gère automatiquement deux secrets au niveau de l'application dans Secret Manager :

| Secret | Description |
|---|---|
| `PAPERLESS_ADMIN_PASSWORD` | Mot de passe du compte superutilisateur initial. Auto-généré au moment du déploiement. Récupérer de Secret Manager pour la première connexion. |
| `PAPERLESS_SECRET_KEY` | Clé secrète de l'application Django. Utilisée pour la signature de session et la protection CSRF. Auto-générée au moment du déploiement ; non renouvelée automatiquement — sa régénération invalide toutes les sessions utilisateur actives. |

Les deux secrets sont injectés dans le conteneur au démarrage du pod via le pilote CSI du magasin de secrets. Le texte en clair n'est jamais écrit dans l'état Terraform.

**Paramètres d'application spécifiques à Paperless-ngx** (`time_zone`, `ocr_language`, `admin_user`, `admin_email`) sont documentés dans [Groupe 15 : Paramètres d'application Paperless-ngx](#group-15-paperless-ngx-application-settings).

Les variables de secrets standard (`environment_variables`, `secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-17--backup--maintenance).

**Valeurs par défaut spécifiques à Paperless :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajuster pour correspondre à votre objectif de point de récupération et à vos heures d'ouverture. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmenter à 30-90 jours pour les déploiements de production gérant des documents légaux ou de conformité. |

**Importation de sauvegarde** — Paperless GKE prend en charge l'importation d'une sauvegarde de base de données existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'importation unique pendant le déploiement pour restaurer la sauvegarde spécifiée par `backup_uri`. |
| `backup_source` | `"gcs"` | Système source pour le fichier de sauvegarde. `"gcs"` importe à partir d'un URI Cloud Storage ; `"gdrive"` importe à partir d'un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (par exemple `"gs://my-bucket/backups/paperless.sql"`) ou ID de fichier Google Drive. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

> **Note :** Une importation de sauvegarde ne restaure que la base de données PostgreSQL. Les fichiers de documents stockés dans le bucket multimédia GCS doivent être migrés séparément — copiez-les dans le bucket `paperless-media` une fois la restauration de la base de données terminée.

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

Variables disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation).

**Job `db-init` par défaut :** Lorsque `initialization_jobs` est vide (la valeur par défaut), `Paperless Common` fournit un job Kubernetes `db-init` (image `postgres:15-alpine`, script `scripts/db-init.sh`, `execute_on_apply = true`) qui crée la base de données PostgreSQL et l'utilisateur de l'application. Les migrations de schéma Django s'exécutent ensuite automatiquement dans le cadre du point d'entrée du conteneur au premier démarrage. La fourniture d'une liste `initialization_jobs` non vide remplace le job par défaut.

**Gotenberg et Tika comme services supplémentaires :** Paperless-ngx prend en charge l'intégration facultative avec [Gotenberg](https://gotenberg.dev/) (conversion de documents avancée) et [Apache Tika](https://tika.apache.org/) (extraction de contenu à partir de fichiers Office). Ceux-ci ne sont pas provisionnés par défaut. Pour les ajouter, définissez-les dans `additional_services` :

| Service | Image | Port | Objectif |
|---|---|---|---|
| Gotenberg | `gotenberg/gotenberg:7` | `3000` | Convertir des documents Office, HTML et URL en PDF avant l'OCR |
| Tika | `apache/tika:latest` | `9998` | Extraire le contenu textuel de `.docx`, `.xlsx`, `.pptx` et d'autres formats Office |

Une fois ajoutés, configurez Paperless-ngx pour les utiliser en définissant `PAPERLESS_TIKA_ENABLED=true`, `PAPERLESS_TIKA_ENDPOINT` et `PAPERLESS_TIKA_GOTENBERG_ENDPOINT` dans `environment_variables`.

**CronJobs :**

La variable `cron_jobs` est disponible pour des tâches telles que la re-classification périodique de documents ou la reconstruction d'index. Voir [App_GKE](./App_GKE.md#group-11--workload-automation) pour la documentation complète du schéma.

> **Note :** Contrairement aux jobs de type Cloud Run, les CronJobs GKE utilisent les champs `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds` et `suspend`. Les champs de type Cloud Run (`parallelism`, `paused`, `max_retries`, `task_count`) ne sont pas disponibles.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-13--nfs-storage).

**Valeurs par défaut spécifiques à Paperless :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Le stockage NFS est activé par défaut. Lorsque `enable_redis = true` et qu'aucun `redis_host` externe n'est fourni, le module utilise l'adresse IP du serveur NFS comme hôte Redis. Si vous désactivez NFS, vous devez fournir un `redis_host` explicite. |
| `nfs_mount_path` | `"/mnt/nfs"` | Le chemin où le volume NFS est monté à l'intérieur du conteneur. Ceci est distinct du chemin de stockage des documents (`/usr/src/paperless/media`), qui est monté via GCS FUSE. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

**Bucket auto-provisionné spécifique à Paperless :**

`Paperless Common` provisionne automatiquement un bucket GCS `paperless-media` et, par défaut, le monte via le pilote CSI GCS FUSE à `/usr/src/paperless/media` à l'intérieur du conteneur. C'est le chemin où Paperless-ngx stocke :

- Fichiers de documents originaux (avant le traitement OCR)
- Fichiers de documents traités (après OCR et classification)
- Images miniatures pour l'interface utilisateur web
- Répertoire de consommation temporaire pour l'ingestion de nouveaux documents

| Bucket | `name_suffix` | Chemin de montage | Objectif |
|---|---|---|---|
| Auto-provisionné | `paperless-media` | `/usr/src/paperless/media` | Stockage de documents persistant via GCS FUSE |

Vous n'avez pas besoin de définir ce bucket dans `storage_buckets`. Surchargez `gcs_volumes` pour personnaliser les options de montage ou ajouter des montages de volume supplémentaires.

**Options de montage par défaut de GCS FUSE :**

La configuration `gcs_volumes` par défaut monte le bucket multimédia avec `implicit-dirs`, `stat-cache-ttl=60s` et `type-cache-ttl=60s`. Ces paramètres sont appropriés pour le modèle d'écriture séquentielle de Paperless-ngx (les documents sont écrits une fois puis lus). Pour une ingestion à haut débit, envisagez de réduire les TTL de cache ou d'utiliser `metadata-cache-ttl=0` pour assurer une cohérence immédiate.

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` se comportent comme décrit dans [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-16--database-configuration).

**Valeurs par défaut et restrictions spécifiques à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `db_name` | `"paperless"` | `"gkeappdb"` | Nom de la base de données PostgreSQL créée pour Paperless-ngx. **Immuable après le déploiement** — la modification de cette valeur recrée la base de données et détruit toutes les métadonnées des documents. |
| `db_user` | `"paperless"` | `"gkeappuser"` | Utilisateur PostgreSQL pour Paperless-ngx. **Immuable après le déploiement.** |
| `database_password_length` | `32` | `32` | Longueur du mot de passe de la base de données auto-généré. Plage valide : 16-64 caractères. |

> **Important :** Paperless-ngx nécessite PostgreSQL. Ne changez pas `database_type` pour une variante MySQL ou SQL Server — l'ORM Django de Paperless-ngx ne prend en charge que PostgreSQL.

**Découverte d'instances Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laisser vide pour découvrir automatiquement une instance gérée par Services GCP ou créer une instance intégrée. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est ajouté. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job de rotation automatique des mots de passe de la base de données. Lorsque `true`, le mot de passe de la base de données est renouvelé selon le calendrier défini par `secret_rotation_period` et les pods GKE sont redémarrés pour prendre en compte la nouvelle information d'identification. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods, pour permettre la réplication de Secret Manager. |

---

## Groupe 12 : Scripts SQL personnalisés {#group-12-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-18--custom-sql-scripts).

Variables disponibles : `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-10--observability).

**Valeurs par défaut spécifiques à Paperless :**

Paperless-ngx exécute les migrations de base de données Django et initialise les workers Celery au premier démarrage. Les valeurs par défaut de la sonde de santé tiennent compte de ce délai de démarrage.

### Routage de la sonde de santé {#health-probe-routing}

`Paperless GKE` expose **deux ensembles parallèles** de variables de sonde qui configurent les sondes Kubernetes via différents chemins de routage :

| Ensemble de variables | Transmis à | Configure |
|---|---|---|
| `startup_probe`, `liveness_probe` | Sous-module `Paperless Common` | La spécification de sonde Kubernetes du conteneur d'application (`initialDelaySeconds`, `path`, `failureThreshold`, etc.) |
| `startup_probe_config`, `health_check_config` | `App GKE` directement | La configuration de sonde standard App GKE utilisée pour les vérifications de santé de l'équilibreur de charge et les sondes d'infrastructure GKE |

Ce sont des chemins parallèles, pas des alias. La modification de `startup_probe` n'affecte pas `startup_probe_config`, et vice versa.

**Sonde de démarrage** (`startup_probe` → `Paperless Common`) :

| Champ | Valeur par défaut Paperless | Notes |
|---|---|---|
| `type` | `"HTTP"` | Sonde HTTP GET contre le chemin racine. |
| `path` | `"/"` | La page de connexion Paperless-ngx renvoie HTTP 200 lorsque l'application est prête. |
| `initial_delay_seconds` | `60` | Permet 60 secondes avant la première tentative de sonde, en tenant compte du temps de migration de la base de données au premier démarrage. |
| `timeout_seconds` | `10` | Délai d'expiration de la sonde par tentative. |
| `period_seconds` | `10` | Intervalle de la sonde. |
| `failure_threshold` | `30` | Jusqu'à 300 secondes (30 × 10s) de délai de démarrage avant le redémarrage du pod. |

**Sonde de vivacité** (`liveness_probe` → `Paperless Common`) :

| Champ | Valeur par défaut Paperless | Notes |
|---|---|---|
| `type` | `"HTTP"` | Sonde HTTP GET. |
| `path` | `"/"` | Le chemin racine renvoie HTTP 200 lorsque l'application est saine. |
| `initial_delay_seconds` | `60` | Donne à Paperless-ngx le temps de terminer le démarrage avant le début des vérifications de vivacité. |
| `period_seconds` | `30` | Moins fréquent que la sonde de démarrage — approprié pour un service stable en cours d'exécution. |
| `failure_threshold` | `3` | Trois échecs consécutifs déclenchent un redémarrage du pod. |

**Sondes standard App GKE** (`startup_probe_config`, `health_check_config` → `App GKE`) :

| Variable | Valeur par défaut Paperless | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, type = "TCP", timeout_seconds = 240, period_seconds = 240, failure_threshold = 1 }` | Sonde TCP sur `container_port` (8000). Permet jusqu'à 240 secondes pour le démarrage. |
| `health_check_config` | `{ enabled = true, type = "HTTP", path = "/" }` | HTTP GET contre `/`. Le chemin racine de Paperless-ngx est le bon point de terminaison de santé. |

**`uptime_check_config` :** Par défaut à `{ enabled = false, path = "/" }` — les vérifications de disponibilité sont désactivées par défaut. Activer explicitement pour la surveillance de production.

---

## Groupe 14 : Politiques de fiabilité {#group-14-reliability-policies}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-9--reliability).

**Valeurs par défaut spécifiques à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `enable_pod_disruption_budget` | `false` | `true` | Le PDB est désactivé par défaut dans Paperless GKE. Activer pour les déploiements de production où la continuité du traitement des documents pendant la maintenance des nœuds est importante. |
| `pdb_min_available` | `1` | `1` | Nombre minimal de pods qui doivent rester disponibles pendant les interruptions. |

Variables disponibles : `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Groupe 15 : Paramètres d'application Paperless-ngx {#group-15-paperless-ngx-application-settings}

Ces variables sont spécifiques à Paperless-ngx et sont transmises directement à `Paperless Common`. Elles contrôlent le comportement d'exécution de l'application et ne sont pas présentes dans `App_GKE`.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `time_zone` | `"UTC"` | Chaîne de fuseau horaire IANA (par exemple `"Europe/London"`, `"America/New_York"`) | Fuseau horaire utilisé pour les horodatages des documents, l'exécution des tâches planifiées et l'analyse des dates dans les titres des documents. **Important pour la reconnaissance des dates de documents :** Paperless-ngx utilise le fuseau horaire configuré lors de l'analyse des dates à partir des noms de fichiers et des métadonnées des documents. Définissez-le pour qu'il corresponde au fuseau horaire des documents que vous numérisez afin d'éviter les erreurs de décalage d'un jour sur les règles de classement basées sur la date. |
| `ocr_language` | `"eng"` | Code linguistique Tesseract ISO 639-2/T. Combinez plusieurs avec `+` (par exemple `"fra+eng"`, `"deu+eng"`) | Pack linguistique OCR principal chargé par Tesseract. La définition de la langue correcte améliore considérablement la précision de l'OCR. Pour les archives multilingues, combinez les codes — chaque langue supplémentaire augmente l'utilisation de la mémoire et le temps de traitement OCR. Codes disponibles : `eng` (anglais), `deu` (allemand), `fra` (français), `spa` (espagnol), `ita` (italien), `nld` (néerlandais), `por` (portugais), et bien d'autres. |
| `admin_user` | `"admin"` | Chaîne | Nom d'utilisateur du compte superutilisateur initial de Paperless-ngx, créé au premier démarrage. Utilisé pour se connecter à l'interface utilisateur web et à l'API REST. Changez pour un nom d'utilisateur non par défaut afin de réduire l'exposition aux attaques par devinette de mots de passe. |
| `admin_email` | `"admin@example.com"` | Adresse e-mail valide | Adresse e-mail associée au compte administrateur initial. Utilisée pour la récupération de mot de passe et les notifications système. Définissez une adresse valide que vous contrôlez avant le premier déploiement. |

### Validation des paramètres du groupe 15 {#validating-group-15-settings}

**Console Google Cloud :**
- **Secret Manager :** Accédez à **Sécurité → Secret Manager** et confirmez que `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY` existent. Utilisez **Accéder à la version du secret** pour récupérer le mot de passe administrateur pour la première connexion.
- **Charges de travail GKE :** Accédez à **Kubernetes Engine → Charges de travail** et confirmez que le déploiement Paperless-ngx est en cours d'exécution. Cliquez sur le déploiement pour afficher la configuration des variables d'environnement du pod.

**gcloud CLI / kubectl :**
```bash
# Retrieve the admin password from Secret Manager
# (secret name pattern: secret-<resource-prefix>-paperless-admin-password)
gcloud secrets versions access latest \
  --secret="secret-RESOURCE_PREFIX-paperless-admin-password" \
  --project=PROJECT_ID

# Confirm the OCR language environment variable is set in the running pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep PAPERLESS_OCR_LANGUAGE

# Confirm the timezone environment variable
kubectl exec -n NAMESPACE POD_NAME -- env | grep PAPERLESS_TIME_ZONE

# Check Paperless-ngx startup logs for migration output
kubectl logs -n NAMESPACE POD_NAME --since=10m | grep -i "migration\|celery\|ready"
```

---

## Groupe 16 : Redis (Celery Broker) {#group-16-redis-celery-broker}

Ces variables configurent l'intégration de Redis de Paperless-ngx. Le support de l'infrastructure Redis sous-jacente est fourni par `App_GKE` (voir [App_GKE](./App_GKE.md#group-15--redis-cache)). Redis n'est **pas facultatif** pour Paperless-ngx — c'est le courtier de messages Celery qui pilote tous les traitements de documents en arrière-plan, les tâches OCR et le pipeline de consommation.

> **Note :** Dans `Paperless GKE`, les variables Redis sont dans le **groupe 21**.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Active Redis comme courtier Celery et backend de résultats de Paperless-ngx. **Doit rester `true` pour que Paperless-ngx fonctionne.** Lorsque `true` et `redis_host` est vide, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis. La désactivation de Redis entraîne l'arrêt de tous les traitements OCR en arrière-plan, de la classification des documents et du pipeline de consommation. Les documents déposés dans le répertoire de consommation ne seront pas traités. |
| `redis_host` | `""` *(par défaut l'IP du serveur NFS)* | Nom d'hôte ou adresse IP | Le nom d'hôte ou l'adresse IP du serveur Redis. Laisser vide pour utiliser l'adresse IP du serveur NFS découverte automatiquement (qui co-héberge un processus Redis dans la configuration par défaut de la plateforme). Surcharger avec une IP ou un nom d'hôte explicite lors de l'utilisation d'une instance Redis dédiée telle que Google Cloud Memorystore. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Chaîne de numéro de port | Le port TCP sur lequel le serveur Redis écoute. Le port par défaut `6379` est le port Redis standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification pour le serveur Redis. Laisser vide si l'instance Redis ne nécessite pas d'authentification. Pour Google Cloud Memorystore avec AUTH activé, définissez-le sur la chaîne AUTH de l'instance. |

### Validation des paramètres Redis {#validating-redis-settings}

**Console Google Cloud :**
- **Instance Memorystore (si utilisée) :** Accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et son état AUTH.
- **Environnement de pod GKE :** Accédez à **Kubernetes Engine → Charges de travail**, sélectionnez le déploiement Paperless-ngx et vérifiez les variables d'environnement du pod pour `PAPERLESS_REDIS`.

**gcloud CLI / kubectl :**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm the Redis connection string is set in the Paperless-ngx pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep PAPERLESS_REDIS

# Test Redis connectivity from inside the Paperless-ngx pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379

# Check Celery worker status in logs
kubectl logs -n NAMESPACE POD_NAME | grep -i "celery\|broker\|ready"
```

---

## Groupe 17 : Configuration du backend GKE {#group-17-gke-backend-configuration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-6--gke-backend-config).

**Valeurs par défaut spécifiques à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Notes |
|---|---|---|
| `session_affinity` | `"ClientIP"` | Garantit que les sessions de téléchargement de documents sont acheminées vers le même réplica de pod. Sans affinité de session, les téléchargements en plusieurs parties et les sessions d'administration peuvent rencontrer des échecs lorsqu'ils sont acheminés vers différents réplicas. |
| `service_type` | `"LoadBalancer"` | Expose Paperless-ngx via un équilibreur de charge Google Cloud. |
| `termination_grace_period_seconds` | `60` | Permet aux tâches OCR en cours de se terminer avant la terminaison du pod. Envisagez d'augmenter à 120+ secondes pour les déploiements traitant de gros documents. |

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `gke_cluster_selection_mode`, `network_name`, `prereq_gke_subnet_cidr`.

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#group-7--statefulset--pvc).

La définition de `stateful_pvc_enabled = true` sélectionne automatiquement `workload_type = "StatefulSet"`. Lors de l'utilisation d'un StatefulSet pour Paperless-ngx, le PVC fournit un volume persistant par pod en plus du montage multimédia GCS FUSE partagé. Cela peut être utilisé pour stocker la base de données de consommation SQLite de Paperless-ngx ou les fichiers de travail OCR temporaires.

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir sur `true` pour activer StatefulSet avec PVC par pod. Sélectionne automatiquement `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `"10Gi"` | Taille initiale du PVC. Étendre au besoin — GKE Autopilot prend en charge l'extension du PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin du conteneur où le PVC par pod est monté. Distinct du montage multimédia GCS FUSE à `/usr/src/paperless/media`. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | StorageClass pour le PVC. `standard-rwo` provisionne un disque persistant Compute Engine (ReadWriteOnce). |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des identités DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `"OrderedReady"` ou `"Parallel"`. |
| `stateful_update_strategy` | `null` | `"RollingUpdate"` ou `"OnDelete"`. |
| `stateful_fs_group` | `0` | GID pour le fsGroup au niveau du pod dans le contexte de sécurité. |

---

## Sorties du module {#module-outputs}

`Paperless GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `service_cluster_ip` | ClusterIP intra-cluster du service Kubernetes |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID de déploiement |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données de l'application |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés (inclut le bucket média auto-provisionné) |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — relancez l'apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | *(obligatoire)* | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `enable_redis` | `true` | **Critique** | Redis est le broker Celery. Le désactiver arrête tout traitement en arrière-plan. Les documents déposés dans le répertoire de consommation sont mis en file d'attente silencieusement mais jamais traités. L'interface web Paperless-ngx reste accessible mais n'affiche aucun nouveau document ingéré. |
| `redis_host` | `""` | **Élevé** | Se résout automatiquement à l'IP NFS. Si NFS est désactivé et qu'aucun hôte explicite n'est donné, Celery ne peut pas se connecter à son broker et le pipeline de consommation échoue au démarrage. |
| `enable_nfs` | `true` | **Élevé** | Requis lorsque `redis_host` est vide. La désactivation de NFS sans fournir d'hôte Redis explicite entraîne l'échec du démarrage de Celery. |
| `container_port` | `8000` | **Critique** | Gunicorn de Paperless-ngx écoute sur 8000. Changer cela sans faire correspondre le port lié du conteneur entraîne l'échec immédiat de toutes les sondes de santé. |
| `memory_limit` | `"2Gi"` | **Élevé** | Tesseract OCR charge les modèles linguistiques et les miniatures de documents en mémoire. Un sous-provisionnement (inférieur à `1Gi`) provoque des OOM kills lors du traitement des documents, en particulier pour les PDF multipages ou l'OCR multilingue. |
| `cpu_limit` | `"2000m"` | **Moyen** | L'OCR est gourmand en CPU. Réduire en dessous de 1 vCPU ralentit considérablement l'OCR ; à `500m`, les documents volumineux peuvent expirer avant la fin de l'OCR. |
| `timeout_seconds` | `300` | **Moyen** | L'OCR sur de grands PDF peut prendre plusieurs minutes. Réduire en dessous de 120 secondes entraîne l'arrêt des requêtes OCR lentes par gunicorn. |
| `ocr_language` | `"eng"` | **Moyen** | L'utilisation d'un pack linguistique incorrect produit une sortie OCR incohérente. La recherche en texte intégral et le balisage automatique basés sur le contenu du document ne fonctionneront pas correctement pour les documents non-anglais, sauf si le pack linguistique correct est spécifié. |
| `time_zone` | `"UTC"` | **Faible** | Un fuseau horaire incorrect entraîne un décalage de plusieurs heures pour les dates de documents analysées à partir des noms de fichiers et des métadonnées. Les règles de classement basées sur la date et les tâches planifiées s'exécutent à des moments inattendus. |
| `admin_email` | `"admin@example.com"` | **Moyen** | Le compte administrateur initial est créé avec cet e-mail. Définissez une adresse réelle pour permettre la récupération du mot de passe. |
| `db_name` | `"paperless"` | **Critique** | Immuable après le déploiement — modifier cela recrée la base de données et détruit toutes les métadonnées de documents, les balises, les correspondants et les règles de classement. |
| `db_user` | `"paperless"` | **Critique** | Immuable après le déploiement — modifier cela recrée l'utilisateur, invalide les identifiants et rompt la connexion de Paperless-ngx à la base de données. |
| `stateful_pvc_size` | `"10Gi"` | **Moyen** | Si vous utilisez StatefulSet avec PVC pour le stockage local, 10 Gi peuvent se remplir rapidement avec des fichiers de travail OCR temporaires. Surveillez l'utilisation du disque et augmentez si nécessaire. |
| `backup_retention_days` | `7` | **Moyen** | Insuffisant pour les archives de documents sensibles à la conformité. Augmentez à 30-90 jours pour les déploiements de gestion de documents légaux ou réglementaires. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers bruts sont traités comme des octets et empêchent la planification de tous les pods. |
| `enable_pod_disruption_budget` | `false` | **Moyen** | PDB est désactivé par défaut. Sans PDB, la maintenance des nœuds peut terminer tous les pods simultanément, interrompant le traitement OCR actif et entraînant la remise en file d'attente ou la perte de documents du pipeline. |

## Guides associés {#related-guides}

- [Lab pratique : Paperless-ngx sur GKE Autopilot](../labs/Paperless_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune Paperless-ngx](Paperless_Common.md) — la configuration partagée par les deux cibles de déploiement.
