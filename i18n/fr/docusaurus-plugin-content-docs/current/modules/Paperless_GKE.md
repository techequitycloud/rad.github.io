---
title: "Module Paperless-ngx GKE — Guide de configuration"
description: "Référence de configuration pour déployer Paperless sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Paperless_GKE.md @ 3055034 sha256:e8b4ccf861fc -->

# Module Paperless-ngx GKE — Guide de configuration {#paperless-ngx-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Paperless_GKE.png" alt="Module Paperless-ngx GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Paperless_GKE`. `Paperless_GKE` est un **module wrapper** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration applicative partagée [`Paperless_Common`](./Paperless_Common) pour déployer [Paperless-ngx](https://docs.paperless-ngx.com/) — un système open source de gestion documentaire avec OCR, recherche plein texte et étiquetage automatisé — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Paperless GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable se comporte de manière identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et valeurs par défaut **propres à Paperless-ngx** sont décrites en détail ici.

> **Remarque :** les variables signalées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`. Consultez les sections correspondantes du [guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Domaine de configuration | Section de App GKE.md | Remarques propres à Paperless |
|---|---|---|
| Projet et identité | §2 IAM & Access Control | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Paperless ; voir [Groupe 2 : identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Paperless pour `container_port`, `cpu_limit`, `memory_limit` et `timeout_seconds` ; voir [Groupe 3 : exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Variables d'environnement et secrets | §3 Core Service Configuration | Deux secrets générés automatiquement par `Paperless Common` ; voir [Groupe 5 : variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et règles réseau | §3.D Networking & Network Policies | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Initialization Jobs & CronJobs | Un job `db-init` par défaut (fourni par `Paperless Common`) crée la base de données et l'utilisateur ; les migrations Django s'exécutent ensuite automatiquement au démarrage ; voir [Groupe 8 : jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Additional Services | `additional_services` permet d'ajouter Gotenberg ou Tika ; voir [Groupe 8 : jobs et tâches planifiées](#group-8-jobs--scheduled-tasks). |
| Stockage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` vaut `true` par défaut ; obligatoire lorsqu'aucun `redis_host` explicite n'est fourni ; voir [Groupe 9 : stockage et système de fichiers — NFS](#group-9-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Bucket GCS `paperless-media` provisionné automatiquement ; GCS FUSE monté automatiquement sur `/usr/src/paperless/media` ; voir [Groupe 10 : stockage et système de fichiers — GCS](#group-10-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Database (Cloud SQL) | **PostgreSQL 15 obligatoire** ; voir [Groupe 11 : configuration de la base de données](#group-11-database-configuration). |
| Planification et conservation des sauvegardes | §3.B Database (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Initialization Jobs & CronJobs | Identique. |
| Observabilité et contrôles d'état | §3.A Compute (GKE Autopilot) | Système de sondes à deux chemins ; voir [Groupe 13 : observabilité et santé](#group-13-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identique. |
| Binary Authorization | §4.C Binary Authorization | Identique. |
| VPC Service Controls | §4.D VPC Service Controls | Identique. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Toujours activé — aucune configuration requise. |
| Trafic et entrée | §5 Traffic & Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Static IP Reservation | Identique. |
| Déclencheurs Cloud Build | §6.A Cloud Build Triggers | Identique. |
| Pipeline Cloud Deploy | §6.B Cloud Deploy Pipeline | Identique. |
| Mise en miroir des images | §6.C Image Mirroring | `enable_image_mirroring` vaut `true` par défaut ; les images Paperless-ngx sont hébergées sur GHCR. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | `enable_pod_disruption_budget` vaut `false` par défaut ; voir [Groupe 14 : règles de fiabilité](#group-14-reliability-policies). |
| Contraintes de répartition topologique | §7.B Topology Spread Constraints | Identique. |
| Quotas de ressources | §7.C Resource Quotas | Identique. |
| Rotation automatique des mots de passe | §7.D Auto Password Rotation | Voir [Groupe 11 : configuration de la base de données](#group-11-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` vaut `true` par défaut — Redis est **obligatoire**, et non facultatif ; voir [Groupe 15 : Redis (broker Celery)](#group-15-redis-celery-broker). |
| Import de sauvegarde | §8.B Backup Import | Voir [Groupe 6 : sauvegarde et maintenance](#group-6-backup--maintenance). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Services multicluster | §8.D Multi-Cluster Services (MCS) | Identique. |

---

## Relation entre Paperless GKE et App GKE {#how-paperless-gke-relates-to-app-gke}

`Paperless GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Paperless Common` qui fournit les valeurs par défaut et la configuration applicative propres à Paperless-ngx. Les principaux effets sont les suivants :

1. **PostgreSQL 15 est obligatoire.** Paperless-ngx ne prend en charge que PostgreSQL. Le type de base de données est fixé à `"POSTGRES_15"`.
2. **Deux secrets sont générés automatiquement par `Paperless Common`.** `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY` sont créés dans Secret Manager et injectés automatiquement dans le conteneur. Vous n'avez pas besoin de les créer ni de les gérer manuellement.
3. **Un bucket GCS `paperless-media` est provisionné automatiquement.** `Paperless Common` fournit une définition de bucket `paperless-media`. Par défaut, le pilote GCS FUSE CSI monte ce bucket sur `/usr/src/paperless/media` dans le conteneur. Vous n'avez pas besoin de définir ce bucket dans `storage_buckets`.
4. **Redis est obligatoire.** Paperless-ngx utilise Redis comme broker de messages Celery pour tout le traitement documentaire en arrière-plan, l'OCR, les jobs du pipeline d'ingestion et la planification des tâches asynchrones. Contrairement à d'autres modules où Redis est un cache facultatif, retirer Redis de Paperless-ngx arrête complètement le traitement des documents en arrière-plan.
5. **Un job `db-init` par défaut est fourni par `Paperless Common`.** Lorsque `initialization_jobs` est vide, un job Kubernetes `db-init` (image `postgres:15-alpine`, script `db-init.sh`) crée la base de données PostgreSQL et l'utilisateur applicatif avant le démarrage de la charge de travail. Les migrations du schéma Django s'exécutent ensuite automatiquement au démarrage du conteneur via le script d'entrypoint.
6. **Les ressources par défaut sont dimensionnées pour les charges de travail OCR.** Les valeurs par défaut de `cpu_limit` (2 vCPU) et `memory_limit` (2 Gi) reflètent les besoins de l'OCR Tesseract. L'OCR de PDF de plusieurs pages est gourmand en CPU — envisagez d'augmenter `cpu_limit` pour une ingestion à fort volume.
7. **La mise en miroir des images est activée par défaut.** Les images Paperless-ngx sont hébergées sur GitHub Container Registry (GHCR). Le module copie par défaut l'image dans Artifact Registry pour éviter les limites de débit de GHCR.
8. **`timeout_seconds` vaut 300 secondes par défaut** (identique à la valeur par défaut du socle `App_GKE` — ce n'est pas une surcharge). Le traitement OCR de documents volumineux peut être lent ; cette valeur généreuse évite que Kubernetes n'interrompe prématurément les requêtes d'ingestion lentes.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#2-iam--access-control).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(obligatoire)* | ID du projet GCP. |
| `region` | `"us-central1"` | Région GCP de déploiement des ressources. Utilisée en repli lorsque la découverte réseau ne peut pas déterminer la région à partir des sous-réseaux VPC existants. Sert aussi d'emplacement pour le bucket `paperless-media`. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot) pour leurs descriptions.

**Valeurs par défaut propres à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"paperless"` | `"gkeapp"` | Sert de nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `display_name` | `"Paperless-ngx - Document Management System"` | `"App GKE Application"` | Affiché dans l'interface de la plateforme et les tableaux de bord. Modifiable librement. |
| `description` | `"Paperless-ngx - open-source document management system with OCR, full-text search, and automated tagging"` | `"App GKE Custom Application…"` | Libellé descriptif. Modifiable librement. |
| `application_version` | `"latest"` | `"1.0.0"` | Tag de version de l'image Paperless-ngx. Fixez une version précise (par ex. `"2.13.5"`) pour les déploiements de production afin de garantir des builds reproductibles. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 3](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut et comportement propres à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `8000` | `8080` | Le gunicorn de Paperless-ngx écoute sur le port 8000. Ne le modifiez pas, sauf si votre Dockerfile personnalisé se lie à un autre port. |
| `cpu_limit` | `"2000m"` | `"1000m"` | L'OCR Tesseract est gourmand en CPU, en particulier pour les PDF de plusieurs pages. 2 vCPU est le minimum recommandé en production. Passez à 4000m pour des pipelines d'ingestion documentaire à fort volume. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | Paperless-ngx charge en mémoire les miniatures des documents, les modèles de langue Tesseract et les modèles de classification ML. 2 Gi est le minimum ; passez à 4 Gi pour les déploiements qui traitent de gros documents ou plusieurs langues simultanément. |
| `min_instance_count` | `1` | `1` | Au moins un pod toujours en cours d'exécution. La mise à l'échelle à zéro est déconseillée — garder un pod actif assure que le processus worker Celery écoute en permanence le répertoire d'ingestion. |
| `max_instance_count` | `3` | `3` | Nombre maximal de réplicas de pod. À augmenter pour une ingestion documentaire à fort volume. |
| `timeout_seconds` | `300` | `300` | Non surchargée — la valeur par défaut d'App_GKE est déjà de 300 s, ce qui couvre largement l'OCR de PDF volumineux de plusieurs pages. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy est obligatoire. Paperless-ngx se connecte à PostgreSQL via le socket Unix de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | `true` | Non surchargée — App_GKE effectue déjà la mise en miroir par défaut. Reste importante pour Paperless-ngx : les images hébergées sur GHCR profitent de la copie Artifact Registry pour éviter les limites de débit et satisfaire aux exigences de Binary Authorization. |

Les autres variables d'exécution (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `container_resources`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE Groupe 3](./App_GKE.md#a-compute-gke-autopilot).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#4-advanced-security), [App_GKE](./App_GKE.md#5-traffic--ingress) et [App_GKE](./App_GKE.md#d-networking--network-policies).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. Recommandé pour les déploiements de gestion documentaire dont l'accès doit être limité à votre organisation. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés via IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google autorisés via IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration d'IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration d'IAP. |
| `enable_custom_domain` | `true` | Configure l'Ingress/Gateway pour le routage d'un domaine personnalisé avec des certificats SSL gérés. Activé par défaut — une Gateway avec une IP statique est provisionnée automatiquement. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par ex. `["paperless.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; généré automatiquement s'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. Le tag `nfsserver` est nécessaire à la connectivité NFS. |
| `enable_cloud_armor` | `false` | Active une règle de sécurité Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées par Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la règle de sécurité Cloud Armor à associer. |
| `enable_vpc_sc` | `false` | Active l'application d'un périmètre VPC Service Controls. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#3-core-service-configuration).

**Secrets générés automatiquement propres à Paperless :**

`Paperless Common` crée et gère automatiquement deux secrets applicatifs dans Secret Manager :

| Secret | Description |
|---|---|
| `PAPERLESS_ADMIN_PASSWORD` | Mot de passe du compte superutilisateur initial. Généré automatiquement au déploiement. Récupérez-le dans Secret Manager pour la première connexion. |
| `PAPERLESS_SECRET_KEY` | Clé secrète de l'application Django. Sert à signer les sessions et à la protection CSRF. Générée automatiquement au déploiement ; aucune rotation automatique — la régénérer invalide toutes les sessions utilisateur actives. |

Les deux secrets sont injectés dans le conteneur au démarrage du pod via le Secrets Store CSI Driver. Leur valeur en clair n'est jamais écrite dans l'état Terraform.

**Les paramètres applicatifs propres à Paperless-ngx** (`time_zone`, `ocr_language`, `admin_user`, `admin_email`) sont documentés dans [Groupe 15 : paramètres de l'application Paperless-ngx](#group-15-paperless-ngx-application-settings).

Les variables de secrets standard (`environment_variables`, `secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent comme décrit dans [App_GKE](./App_GKE.md#3-core-service-configuration).

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut propres à Paperless :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez selon votre objectif de point de reprise (RPO) et vos heures d'activité. |
| `backup_retention_days` | `7` | Conservation de 7 jours. Passez à 30–90 jours pour les déploiements de production qui gèrent des documents juridiques ou réglementaires. |

**Import de sauvegarde** — Paperless GKE permet d'importer une sauvegarde de base de données existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Si `true`, exécute un job d'import ponctuel pendant le déploiement pour restaurer la sauvegarde indiquée par `backup_uri`. |
| `backup_source` | `"gcs"` | Système source du fichier de sauvegarde. `"gcs"` importe depuis un URI Cloud Storage ; `"gdrive"` importe depuis un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (par ex. `"gs://my-bucket/backups/paperless.sql"`) ou ID de fichier Google Drive. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

> **Remarque :** un import de sauvegarde ne restaure que la base de données PostgreSQL. Les fichiers de documents stockés dans le bucket média GCS doivent être migrés séparément — copiez-les dans le bucket `paperless-media` une fois la restauration de la base terminée.

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#6-cicd--delivery).

Variables disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

---

## Groupe 8 : Jobs et tâches planifiées {#group-8-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs).

**Job `db-init` par défaut :** lorsque `initialization_jobs` est vide (valeur par défaut), `Paperless Common` fournit un job Kubernetes `db-init` (image `postgres:15-alpine`, script `scripts/db-init.sh`, `execute_on_apply = true`) qui crée la base de données PostgreSQL et l'utilisateur applicatif. Les migrations du schéma Django s'exécutent ensuite automatiquement via l'entrypoint du conteneur au premier démarrage. Fournir une liste `initialization_jobs` non vide remplace le job par défaut.

**Gotenberg et Tika comme services supplémentaires :** Paperless-ngx prend en charge une intégration facultative avec [Gotenberg](https://gotenberg.dev/) (conversion avancée de documents) et [Apache Tika](https://tika.apache.org/) (extraction de contenu des fichiers Office). Ils ne sont pas provisionnés par défaut. Pour les ajouter, définissez-les dans `additional_services` :

| Service | Image | Port | Rôle |
|---|---|---|---|
| Gotenberg | `gotenberg/gotenberg:7` | `3000` | Convertir les documents Office, le HTML et les URL en PDF avant l'OCR |
| Tika | `apache/tika:latest` | `9998` | Extraire le contenu texte des fichiers `.docx`, `.xlsx`, `.pptx` et d'autres formats Office |

Une fois ajoutés, configurez Paperless-ngx pour les utiliser en définissant `PAPERLESS_TIKA_ENABLED=true`, `PAPERLESS_TIKA_ENDPOINT` et `PAPERLESS_TIKA_GOTENBERG_ENDPOINT` dans `environment_variables`.

**CronJobs :**

La variable `cron_jobs` est disponible pour des tâches telles que la reclassification périodique des documents ou la reconstruction des index. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs) pour la documentation complète du schéma.

> **Remarque :** contrairement aux jobs de type Cloud Run, les CronJobs GKE utilisent les champs `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds` et `suspend`. Les champs de type Cloud Run (`parallelism`, `paused`, `max_retries`, `task_count`) ne sont pas disponibles.

---

## Groupe 9 : Stockage et système de fichiers — NFS {#group-9-storage--filesystem--nfs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Valeurs par défaut propres à Paperless :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_nfs` | `true` | Le stockage NFS est activé par défaut. Lorsque `enable_redis = true` et qu'aucun `redis_host` externe n'est fourni, le module utilise l'IP du serveur NFS comme hôte Redis. Si vous désactivez NFS, vous devez fournir un `redis_host` explicite. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin de montage du volume NFS dans le conteneur. Il est distinct du chemin de stockage des documents (`/usr/src/paperless/media`), monté via GCS FUSE. |

---

## Groupe 10 : Stockage et système de fichiers — GCS {#group-10-storage--filesystem--gcs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Bucket provisionné automatiquement propre à Paperless :**

`Paperless Common` provisionne automatiquement un bucket GCS `paperless-media` et, par défaut, le monte via le pilote GCS FUSE CSI sur `/usr/src/paperless/media` dans le conteneur. C'est le chemin où Paperless-ngx stocke :

- les fichiers de documents d'origine (avant le traitement OCR) ;
- les fichiers de documents traités (après OCR et classification) ;
- les miniatures affichées dans l'interface web ;
- le répertoire d'ingestion temporaire pour les nouveaux documents.

| Bucket | `name_suffix` | Chemin de montage | Rôle |
|---|---|---|---|
| Provisionné automatiquement | `paperless-media` | `/usr/src/paperless/media` | Stockage persistant des documents via GCS FUSE |

Vous n'avez pas besoin de définir ce bucket dans `storage_buckets`. Surchargez `gcs_volumes` pour personnaliser les options de montage ou ajouter d'autres montages de volume.

**Options de montage GCS FUSE par défaut :**

La configuration `gcs_volumes` par défaut monte le bucket média avec `implicit-dirs`, `stat-cache-ttl=60s` et `type-cache-ttl=60s`. Ces réglages conviennent au schéma d'écriture séquentiel de Paperless-ngx (les documents sont écrits une fois puis lus). Pour une ingestion à haut débit, envisagez de réduire les TTL de cache ou d'utiliser `metadata-cache-ttl=0` pour garantir une cohérence immédiate.

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` se comportent comme décrit dans [App_GKE Groupe 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

---

## Groupe 11 : Configuration de la base de données {#group-11-database-configuration}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut et restrictions propres à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `db_name` | `"paperless"` | `"gkeappdb"` | Nom de la base de données PostgreSQL créée pour Paperless-ngx. **Immuable après le déploiement** — modifier cette valeur recrée la base de données et détruit toutes les métadonnées des documents. |
| `db_user` | `"paperless"` | `"gkeappuser"` | Utilisateur PostgreSQL de Paperless-ngx. **Immuable après le déploiement.** |
| `database_password_length` | `32` | `32` | Longueur du mot de passe de base de données généré automatiquement. Plage valide : 16–64 caractères. |

> **Important :** Paperless-ngx nécessite PostgreSQL. Ne remplacez pas `database_type` par une variante MySQL ou SQL Server — l'ORM Django de Paperless-ngx ne prend en charge que PostgreSQL.

**Découverte de l'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou créer une instance intégrée. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement y est ajouté. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job automatisé de rotation du mot de passe de la base de données. Si `true`, le mot de passe est renouvelé selon la période définie par `secret_rotation_period` et les pods GKE sont redémarrés pour prendre en compte le nouvel identifiant. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant de redémarrer les pods, le temps que la réplication de Secret Manager se termine. |

---

## Groupe 12 : Scripts SQL personnalisés {#group-12-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs).

Variables disponibles : `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut propres à Paperless :**

Paperless-ngx exécute les migrations de base de données Django et initialise les workers Celery au premier démarrage. Les valeurs par défaut des sondes de santé tiennent compte de ce délai de démarrage.

### Routage des sondes de santé {#health-probe-routing}

`Paperless GKE` expose **deux ensembles parallèles** de variables de sonde qui configurent les sondes Kubernetes par des chemins de routage différents :

| Ensemble de variables | Transmis à | Configure |
|---|---|---|
| `startup_probe`, `liveness_probe` | Sous-module `Paperless Common` | La spécification des sondes Kubernetes du conteneur applicatif (`initialDelaySeconds`, `path`, `failureThreshold`, etc.) |
| `startup_probe_config`, `health_check_config` | `App GKE` directement | La configuration de sondes standard d'App GKE, utilisée pour les contrôles d'état de l'équilibreur de charge et les sondes de l'infrastructure GKE |

Il s'agit de chemins parallèles, et non d'alias. Modifier `startup_probe` n'a aucun effet sur `startup_probe_config`, et inversement.

**Sonde de démarrage** (`startup_probe` → `Paperless Common`) :

| Champ | Valeur par défaut Paperless | Remarques |
|---|---|---|
| `type` | `"HTTP"` | Sonde HTTP GET sur le chemin racine. |
| `path` | `"/"` | La page de connexion de Paperless-ngx renvoie HTTP 200 lorsque l'application est prête. |
| `initial_delay_seconds` | `60` | Laisse 60 secondes avant la première tentative, pour couvrir la durée des migrations de base de données au premier démarrage. |
| `timeout_seconds` | `10` | Délai d'expiration de chaque tentative. |
| `period_seconds` | `10` | Intervalle entre les sondes. |
| `failure_threshold` | `30` | Jusqu'à 300 secondes (30 × 10 s) de marge de démarrage avant le redémarrage du pod. |

**Sonde de vivacité** (`liveness_probe` → `Paperless Common`) :

| Champ | Valeur par défaut Paperless | Remarques |
|---|---|---|
| `type` | `"HTTP"` | Sonde HTTP GET. |
| `path` | `"/"` | Le chemin racine renvoie HTTP 200 lorsque l'application est en bonne santé. |
| `initial_delay_seconds` | `60` | Laisse à Paperless-ngx le temps de terminer son démarrage avant le début des contrôles de vivacité. |
| `period_seconds` | `30` | Moins fréquente que la sonde de démarrage — adaptée à un service stable en fonctionnement. |
| `failure_threshold` | `3` | Trois échecs consécutifs déclenchent le redémarrage du pod. |

**Sondes standard d'App GKE** (`startup_probe_config`, `health_check_config` → `App GKE`) :

| Variable | Valeur par défaut Paperless | Remarques |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, type = "TCP", timeout_seconds = 240, period_seconds = 240, failure_threshold = 1 }` | Sonde TCP sur `container_port` (8000). Accorde jusqu'à 240 secondes pour le démarrage. |
| `health_check_config` | `{ enabled = true, type = "HTTP", path = "/" }` | HTTP GET sur `/`. Le chemin racine de Paperless-ngx est le bon point de contrôle de santé. |

**`uptime_check_config` :** vaut `{ enabled = false, path = "/" }` par défaut — les tests de disponibilité sont désactivés par défaut. Activez-les explicitement pour la surveillance de production.

---

## Groupe 14 : Règles de fiabilité {#group-14-reliability-policies}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#7-reliability--scheduling).

**Valeurs par défaut propres à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `enable_pod_disruption_budget` | `false` | `true` | Le PDB est désactivé par défaut dans Paperless GKE. Activez-le pour les déploiements de production où la continuité du traitement documentaire pendant la maintenance des nœuds est importante. |
| `pdb_min_available` | `1` | `1` | Nombre minimal de pods devant rester disponibles pendant les interruptions. |

Variables disponibles : `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Groupe 15 : Paramètres de l'application Paperless-ngx {#group-15-paperless-ngx-application-settings}

Ces variables sont propres à Paperless-ngx et sont transmises directement à `Paperless Common`. Elles contrôlent le comportement de l'application à l'exécution et n'existent pas dans `App_GKE`.

| Variable | Valeur par défaut | Options / format | Description et implications |
|---|---|---|---|
| `time_zone` | `"UTC"` | Chaîne de fuseau horaire IANA (par ex. `"Europe/London"`, `"America/New_York"`) | Fuseau horaire utilisé pour les horodatages des documents, l'exécution des tâches planifiées et l'analyse des dates dans les titres des documents. **Important pour la reconnaissance des dates :** Paperless-ngx utilise le fuseau horaire configuré pour analyser les dates présentes dans les noms de fichiers et les métadonnées des documents. Choisissez le fuseau horaire des documents que vous numérisez pour éviter les décalages d'un jour dans les règles de classement basées sur la date. |
| `ocr_language` | `"eng"` | Code de langue Tesseract ISO 639-2/T. Combinez-en plusieurs avec `+` (par ex. `"fra+eng"`, `"deu+eng"`) | Pack de langue OCR principal chargé par Tesseract. Choisir la bonne langue améliore nettement la précision de l'OCR. Pour des archives multilingues, combinez les codes — chaque langue supplémentaire augmente la consommation mémoire et la durée du traitement OCR. Codes disponibles : `eng` (anglais), `deu` (allemand), `fra` (français), `spa` (espagnol), `ita` (italien), `nld` (néerlandais), `por` (portugais), et bien d'autres. |
| `admin_user` | `"admin"` | Chaîne | Nom d'utilisateur du compte superutilisateur Paperless-ngx initial, créé au premier démarrage. Sert à se connecter à l'interface web et à l'API REST. Choisissez un nom différent de la valeur par défaut pour limiter l'exposition aux attaques par devinette d'identifiants. |
| `admin_email` | `"admin@example.com"` | Adresse e-mail valide | Adresse e-mail associée au compte administrateur initial. Sert à la récupération du mot de passe et aux notifications système. Indiquez une adresse valide que vous contrôlez avant le premier déploiement. |

### Valider les paramètres du groupe 15 {#validating-group-15-settings}

**Console Google Cloud :**
- **Secret Manager :** accédez à **Security → Secret Manager** et vérifiez que `PAPERLESS_ADMIN_PASSWORD` et `PAPERLESS_SECRET_KEY` existent. Utilisez **Access Secret Version** pour récupérer le mot de passe administrateur pour la première connexion.
- **Charges de travail GKE :** accédez à **Kubernetes Engine → Workloads** et vérifiez que le déploiement Paperless-ngx est en cours d'exécution. Cliquez sur le déploiement pour afficher la configuration des variables d'environnement du pod.

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

## Groupe 16 : Redis (broker Celery) {#group-16-redis-celery-broker}

Ces variables configurent l'intégration Redis de Paperless-ngx. La prise en charge de l'infrastructure Redis sous-jacente est fournie par `App_GKE` (voir [App_GKE](./App_GKE.md#a-redis--memorystore)). Redis n'est **pas facultatif** pour Paperless-ngx — c'est le broker de messages Celery qui pilote tout le traitement documentaire en arrière-plan, les tâches OCR et le pipeline d'ingestion.

> **Remarque :** dans `Paperless GKE`, les variables Redis se trouvent dans le **groupe 21**.

| Variable | Valeur par défaut | Options / format | Description et implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Active Redis comme broker Celery et backend de résultats de Paperless-ngx. **Doit rester à `true` pour que Paperless-ngx fonctionne.** Si `true` et que `redis_host` est vide, le module utilise par défaut l'IP du serveur NFS comme hôte Redis. Désactiver Redis arrête tout le traitement OCR en arrière-plan, la classification des documents et le pipeline d'ingestion. Les documents déposés dans le répertoire d'ingestion ne seront pas traités. |
| `redis_host` | `""` *(par défaut, l'IP du serveur NFS)* | Nom d'hôte ou adresse IP | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS découverte automatiquement (qui héberge aussi un processus Redis dans la configuration par défaut de la plateforme). Indiquez une IP ou un nom d'hôte explicite lorsque vous utilisez une instance Redis dédiée, comme Google Cloud Memorystore. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Numéro de port sous forme de chaîne | Port TCP sur lequel écoute le serveur Redis. La valeur par défaut `6379` est le port Redis standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification du serveur Redis. Laissez vide si l'instance Redis n'exige pas d'authentification. Pour Google Cloud Memorystore avec AUTH activé, indiquez la chaîne AUTH de l'instance. |

### Valider les paramètres Redis {#validating-redis-settings}

**Console Google Cloud :**
- **Instance Memorystore (le cas échéant) :** accédez à **Memorystore → Redis** pour vérifier que l'instance existe, ainsi que son adresse IP, son port et son état AUTH.
- **Environnement du pod GKE :** accédez à **Kubernetes Engine → Workloads**, sélectionnez le déploiement Paperless-ngx et vérifiez la variable d'environnement `PAPERLESS_REDIS` du pod.

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

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut propres à Paperless :**

| Variable | Valeur par défaut Paperless GKE | Remarques |
|---|---|---|
| `session_affinity` | `"ClientIP"` | Garantit que les sessions de téléversement de documents sont routées vers le même réplica de pod. Sans affinité de session, les téléversements en plusieurs parties et les sessions d'administration peuvent échouer lorsqu'ils sont routés vers des réplicas différents. |
| `service_type` | `"LoadBalancer"` | Expose Paperless-ngx via un équilibreur de charge Google Cloud. |
| `termination_grace_period_seconds` | `60` | Laisse les tâches OCR en cours se terminer avant l'arrêt du pod. Envisagez de passer à 120 secondes ou plus pour les déploiements qui traitent de gros documents. |

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `enable_multi_cluster_service`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `gke_cluster_selection_mode`, `network_name`, `prereq_gke_subnet_cidr`.

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

Définir `stateful_pvc_enabled = true` sélectionne automatiquement `workload_type = "StatefulSet"`. Avec un StatefulSet pour Paperless-ngx, le PVC fournit un volume persistant par pod en plus du montage média GCS FUSE partagé. Il peut servir à stocker la base de données SQLite d'ingestion de Paperless-ngx ou les fichiers de travail temporaires de l'OCR.

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir à `true` pour activer un StatefulSet avec un PVC par pod. Sélectionne automatiquement `workload_type = "StatefulSet"`. |
| `stateful_pvc_size` | `"10Gi"` | Taille initiale du PVC. Agrandissez-la au besoin — GKE Autopilot prend en charge l'extension des PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin du conteneur où le PVC par pod est monté. Distinct du montage média GCS FUSE sur `/usr/src/paperless/media`. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | StorageClass du PVC. `standard-rwo` provisionne un disque persistant Compute Engine (ReadWriteOnce). |
| `stateful_headless_service` | `null` | Crée un service headless pour des identités DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `"OrderedReady"` ou `"Parallel"`. |
| `stateful_update_strategy` | `null` | `"RollingUpdate"` ou `"OnDelete"`. |
| `stateful_fs_group` | `0` | GID du fsGroup au niveau du pod dans le contexte de sécurité. |

---

## Sorties du module {#module-outputs}

`Paperless GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `service_cluster_ip` | ClusterIP interne au cluster du service Kubernetes |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID de déploiement |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données applicative |
| `database_user` | Nom de l'utilisateur de la base de données applicative |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés (y compris le bucket média provisionné automatiquement) |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est joignable et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — relancez l'apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | *(obligatoire)* | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `enable_redis` | `true` | **Critique** | Redis est le broker Celery. Le désactiver arrête tout traitement en arrière-plan. Les documents déposés dans le répertoire d'ingestion sont mis en file d'attente sans avertissement mais jamais traités. L'interface web de Paperless-ngx reste accessible mais n'affiche aucun nouveau document ingéré. |
| `redis_host` | `""` | **Élevé** | Se résout automatiquement en IP NFS. Si NFS est désactivé et qu'aucun hôte explicite n'est fourni, Celery ne peut pas se connecter à son broker et le pipeline d'ingestion échoue au démarrage. |
| `enable_nfs` | `true` | **Élevé** | Obligatoire lorsque `redis_host` est vide. Désactiver NFS sans fournir d'hôte Redis explicite fait échouer le démarrage de Celery. |
| `container_port` | `8000` | **Critique** | Le gunicorn de Paperless-ngx écoute sur 8000. Modifier cette valeur sans changer le port lié par le conteneur fait échouer immédiatement toutes les sondes de santé. |
| `memory_limit` | `"2Gi"` | **Élevé** | L'OCR Tesseract charge en mémoire les modèles de langue et les miniatures des documents. Un sous-dimensionnement (en dessous de `1Gi`) provoque des arrêts OOM pendant le traitement, en particulier pour les PDF de plusieurs pages ou l'OCR multilingue. |
| `cpu_limit` | `"2000m"` | **Moyen** | L'OCR est gourmand en CPU. Descendre sous 1 vCPU ralentit fortement l'OCR ; à `500m`, les gros documents peuvent expirer avant la fin de l'OCR. |
| `timeout_seconds` | `300` | **Moyen** | L'OCR de gros PDF peut prendre plusieurs minutes. Descendre sous 120 secondes amène gunicorn à interrompre les requêtes OCR lentes. |
| `ocr_language` | `"eng"` | **Moyen** | Un mauvais pack de langue produit un résultat OCR inexploitable. La recherche plein texte et l'étiquetage automatique fondés sur le contenu ne fonctionneront pas correctement pour les documents non anglais si le bon pack de langue n'est pas indiqué. |
| `time_zone` | `"UTC"` | **Faible** | Un fuseau horaire incorrect décale de plusieurs heures les dates extraites des noms de fichiers et des métadonnées. Les règles de classement basées sur la date et les tâches planifiées s'exécutent à des moments inattendus. |
| `admin_email` | `"admin@example.com"` | **Moyen** | Le compte administrateur initial est créé avec cette adresse. Indiquez une adresse réelle pour permettre la récupération du mot de passe. |
| `db_name` | `"paperless"` | **Critique** | Immuable après le déploiement — modifier cette valeur recrée la base de données et détruit toutes les métadonnées des documents, les étiquettes, les correspondants et les règles de classement. |
| `db_user` | `"paperless"` | **Critique** | Immuable après le déploiement — modifier cette valeur recrée l'utilisateur, invalide les identifiants et rompt la connexion de Paperless-ngx à la base de données. |
| `stateful_pvc_size` | `"10Gi"` | **Moyen** | Si vous utilisez un StatefulSet avec PVC pour le stockage local, 10 Gi peut se remplir rapidement de fichiers de travail OCR temporaires. Surveillez l'utilisation du disque et agrandissez-le au besoin. |
| `backup_retention_days` | `7` | **Moyen** | Insuffisant pour des archives documentaires soumises à des exigences de conformité. Passez à 30–90 jours pour les déploiements de gestion de documents juridiques ou réglementaires. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (propre à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'elles sont définies. Des entiers nus sont interprétés comme des octets et empêchent la planification de tous les pods. |
| `enable_pod_disruption_budget` | `false` | **Moyen** | Le PDB est désactivé par défaut. Sans PDB, la maintenance des nœuds peut arrêter tous les pods simultanément, interrompant le traitement OCR en cours et provoquant la remise en file ou la perte de documents dans le pipeline. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Paperless-ngx sur GKE Autopilot](../labs/Paperless_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Paperless-ngx Common](Paperless_Common.md) — la configuration partagée par les deux cibles de déploiement.
