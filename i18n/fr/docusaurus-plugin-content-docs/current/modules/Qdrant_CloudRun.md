---
title: "Qdrant sur Google Cloud Run"
description: "Référence de configuration pour déployer Qdrant sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Qdrant_CloudRun.md @ 3055034 sha256:fd402a9126e1 -->

# Qdrant sur Google Cloud Run {#qdrant-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Qdrant_CloudRun.png" alt="Qdrant sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Qdrant est une base de données vectorielle et un moteur de recherche par similarité
hautes performances, conçus pour les charges de travail d'IA — pipelines RAG,
systèmes de recommandation, recherche sémantique et stockage d'embeddings. Ce module
déploie Qdrant sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Qdrant et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Qdrant s'exécute comme un service Cloud Run v2 (Gen2) avec un bucket Cloud Storage
monté via GCS FUSE pour le stockage persistant des collections. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Qdrant, 1 vCPU / 1 GiB par défaut, `min_instance_count = 1` |
| Stockage persistant | Cloud Storage via GCS FUSE | Bucket `<prefix>-storage` monté sur `/qdrant/storage` via le CSI GCS FUSE Gen2 |
| Secrets | Secret Manager | Clé d'API facultative (`QDRANT__SERVICE__API_KEY`) |
| Entrée | URL Cloud Run / Cloud Load Balancing | `internal` par défaut (VPC uniquement) ; équilibreur de charge HTTPS facultatif avec Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL, pas de Redis.** Qdrant gère son propre stockage
  intégré. Aucune instance Cloud SQL ni aucune dépendance Redis n'est créée.
- **Instance unique par défaut.** `max_instance_count = 1` est fortement
  recommandé. Qdrant est un stockage à rédacteur unique — plusieurs instances
  écrivant sur le même montage GCS FUSE corrompent les collections.
- **Entrée interne par défaut.** `ingress_settings = "internal"` limite l'accès
  au VPC. Passer à `"all"` (Internet public) exige
  `enable_api_key = true` — une validation au moment du plan bloque la combinaison
  d'une entrée publique sans clé d'API.
- **L'environnement d'exécution Gen2 est obligatoire** pour les montages GCS FUSE.
  Le module utilise par défaut `execution_environment = "gen2"`.
- **Deux points de terminaison de santé distincts.** Le démarrage utilise
  `/readyz` ; la vivacité utilise `/livez`. Ne faites jamais pointer la sonde de
  vivacité vers `/readyz` — Qdrant se déclare temporairement non prêt pendant le
  chargement de grandes collections, ce qui provoque des redémarrages intempestifs
  du conteneur.
- **gRPC exige le protocole `h2c`.** Cloud Run n'expose pas le port 6334.
  Utilisez `container_protocol = "h2c"` et un client gRPC sur le port principal si
  vous avez besoin de gRPC.
- **Redis est déclaré mais inerte.** `enable_redis` vaut par défaut `true` au
  niveau de la variable (valeur par défaut du socle `App_CloudRun`), mais le
  `main.tf` de `Qdrant_CloudRun` code en dur `enable_redis = false` dans l'appel à
  `App_CloudRun`, quelle que soit la valeur de la variable — `redis_host`,
  `redis_port` et `redis_auth` n'ont aucun effet. Qdrant n'a aucune dépendance de
  cache.
- **Le build du conteneur est fixé par `Qdrant_Common`.** `container_image`,
  `container_image_source`, `container_build_config` et `container_resources`
  ne sont déclarés que par alignement sur les conventions du socle —
  `Qdrant_Common` définit en interne l'image réelle (`qdrant/qdrant`), la source de
  build (`custom`, via un Dockerfile wrapper minimal) et le profil de ressources, et
  ignore ces quatre variables.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Qdrant {#a-cloud-run--the-qdrant-service}

Qdrant s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable. Le service évolue entre le nombre minimal et le nombre maximal
d'instances en fonction de la concurrence des requêtes.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le stockage persistant de Qdrant {#b-cloud-storage--qdrant-persistent-storage}

Qdrant conserve son WAL, les données des collections, les fichiers d'index HNSW et
les métadonnées dans `/qdrant/storage` à l'intérieur du conteneur. Ce chemin est
adossé à un bucket Cloud Storage (`<prefix>-storage`) monté via GCS FUSE. Le bucket
est provisionné automatiquement par le module.

- **Console :** Cloud Storage → Buckets — repérez le bucket `*-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/
  gcloud storage ls gs://<storage-bucket>/collections/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur GCS Fuse et les
options CMEK.

### C. Secret Manager — la clé d'API Qdrant {#c-secret-manager--qdrant-api-key}

Lorsque `enable_api_key = true`, une clé d'API alphanumérique de 32 caractères est
générée et stockée dans Secret Manager. Elle est injectée sous la forme
`QDRANT__SERVICE__API_KEY` à l'exécution, ce qui oblige tous les appelants REST et
gRPC à transmettre `api-key: <key>` dans les en-têtes de requête.

- **Console :** Security → Secret Manager — recherchez un secret nommé
  `<resource-prefix>-api-key`.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le service n'est joignable que depuis le VPC (`ingress_settings =
"internal"`). Un équilibreur de charge HTTPS externe avec domaine personnalisé,
Cloud CDN et Cloud Armor peut être ajouté lorsque le service doit être joignable
depuis l'extérieur du VPC.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud
Run, vers Cloud Monitoring. Des tests de disponibilité (sur `/readyz`) et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" \
    --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Qdrant {#3-qdrant-application-behaviour}

- **Aucun amorçage de base de données.** Qdrant gère son propre moteur de stockage
  intégré. Aucun job d'initialisation n'est injecté par défaut. Le service démarre
  dès que le conteneur est prêt.
- **Chargement des collections au démarrage.** Qdrant charge toutes les
  collections depuis GCS FUSE en mémoire au démarrage. Pour les instances
  comportant de grandes collections, le démarrage peut prendre plusieurs dizaines
  de secondes. La sonde de démarrage (`/readyz`) attend la fin de ce chargement
  avant que du trafic soit envoyé à l'instance.
- **Points de terminaison de vivacité et de disponibilité distincts.** `/readyz`
  renvoie 503 pendant le chargement des collections ; `/livez` renvoie toujours 200
  tant que le processus est actif. La sonde de vivacité utilise `/livez` pour éviter
  des redémarrages intempestifs du conteneur pendant le chargement des collections.
  Ne remplacez pas la sonde de vivacité par `/readyz`.
- **Contrainte de rédacteur unique.** Plusieurs instances Cloud Run ne peuvent pas
  partager sans risque le même chemin de stockage GCS FUSE. Conservez
  `max_instance_count = 1`. Faites évoluer verticalement (davantage de CPU et de
  mémoire) pour un débit plus élevé.
- **gRPC sur HTTP/2.** Cloud Run n'expose pas de second port pour gRPC.
  Utilisez `container_protocol = "h2c"` avec un client gRPC qui se connecte en
  HTTP/2 sur le port 6333 si vous avez besoin de gRPC.
- **Tâches planifiées.** Utilisez `cron_jobs` pour planifier des snapshots
  périodiques des collections Qdrant via l'API REST ou des routines de maintenance
  personnalisées, exécutés sous forme de Cloud Run Jobs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Qdrant ou notables pour
lui sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `qdrant` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Qdrant Vector Database` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service Cloud Run affichée dans l'interface de la plateforme. |
| `application_description` | _(défini)_ | Champ de description alternatif aligné sur le socle ; alimente la même description du service Cloud Run. |
| `application_version` | `latest` | Tag de version de l'image Qdrant ; épinglez un tag semver en production (p. ex. `v1.9.0`). |
| `enable_api_key` | `false` | Génère une clé d'API aléatoire dans Secret Manager ; obligatoire avant de définir `ingress_settings = "all"`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Augmentez à `2000m`–`4000m` pour les constructions d'index et les requêtes concurrentes en production. |
| `memory_limit` | `1Gi` | Mémoire par instance. Qdrant charge les index HNSW en RAM — dimensionnez selon les dimensions des collections et le nombre de vecteurs. |
| `min_instance_count` | `1` | Nombre minimal d'instances. Conservez ≥ 1 pour éviter les démarrages à froid pendant le chargement des index HNSW. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Conservez 1 — Qdrant est un stockage à rédacteur unique. |
| `container_port` | `6333` | Port de l'API REST de Qdrant. |
| `execution_environment` | `gen2` | Gen2 est obligatoire pour les montages GCS FUSE. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 s). Augmentez-la pour les upserts par lots volumineux ou les opérations de snapshot. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Qdrant dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `container_protocol` | `http1` | Utilisez `h2c` pour activer HTTP/2 pour les clients gRPC se connectant sur le port 6333. |
| `traffic_split` | `[]` | Répartition du trafic entre révisions pour les déploiements canary ou blue-green. |
| `max_revisions_to_retain` | `7` | Nombre maximal de révisions Cloud Run conservées. Non référencée — aucun effet sur le déploiement dans ce module applicatif. |
| `enable_cloudsql_volume` | `false` | Injecte un sidecar Cloud SQL Auth Proxy. Non applicable — Qdrant n'a pas de base de données SQL ; laissez `false`. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Non applicable — Qdrant n'a pas de base de données Cloud SQL. |
| `service_annotations` / `service_labels` | `{}` | Annotations / libellés personnalisés du service Cloud Run. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / _(défini)_ / _(défini)_ | Déclarés uniquement par alignement sur les conventions du socle. `Qdrant_Common` fixe l'image réelle, la source de build et le profil de ressources ; ces quatre variables n'ont aucun effet. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` (VPC uniquement, recommandé), `all` (exige `enable_api_key = true`) ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode de routage du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Utilisez des clés `QDRANT__…` pour surcharger la configuration de Qdrant. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation Secret Manager (30 jours par défaut). |
| `prereq_subnet_cidr_override` | `""` | Surcharge du CIDR du sous-réseau principal du VPC inline. À définir uniquement lors d'un nouvel apply sur un déploiement existant, pour éviter le remplacement de ressources. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Nom du fichier de sauvegarde à importer ; utilisé uniquement lorsque `enable_backup_import = true`. Listé sur la plateforme sous le Groupe 13 (Jobs). |
| `additional_services` | `[]` | Services Cloud Run complémentaires déployés aux côtés de Qdrant (p. ex. un worker ou un proxy sidecar). Non utilisé par défaut. |
| `additional_containers` | `[]` | Conteneurs sidecar dans le même pod, partageant le même service Cloud Run et localhost. Non utilisé par défaut — Qdrant n'a aucun processus compagnon. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (non référencée —
la définir n'a aucun effet sur ce module applicatif).

### Groupe 9 — NFS et SQL personnalisé {#group-9--nfs--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Qdrant utilise GCS pour le stockage — n'activez NFS que pour des jobs d'initialisation personnalisés ayant besoin d'un système de fichiers partagé. Exige Gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante à utiliser. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM GCE NFS inline. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Cloud Run pour le montage NFS. À surcharger pour un second partage NFS. |
| `enable_custom_sql_scripts` | `false` | Non applicable — Qdrant n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | `""` / `""` / `false` | Non applicable — acceptées uniquement pour la compatibilité avec le socle. |

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur HTTPS (SSL géré par Google). |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur HTTPS. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneur récentes conservées dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag d'Artifact Registry. |
| `image_retention_days` | `30` | Nombre de jours après lesquels les images deviennent supprimables. Définissez `0` pour désactiver. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de stockage GCS. |
| `storage_buckets` / `gcs_volumes` | `[]` | Buckets / montages GCS FUSE supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) | **Inerte.** `main.tf` code en dur `enable_redis = false` dans l'appel à `App_CloudRun`, quelle que soit cette valeur — Qdrant n'a aucune dépendance de cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | **Inertes** — jamais transmises, puisque Redis est désactivé en dur. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — Qdrant n'a pas de base de données SQL. `database_type` est
transmise à `App_CloudRun`, mais sa valeur par défaut (`NONE`) est la seule prise
en charge ; la modifier ne donnerait pas à Qdrant une connexion de base de données
fonctionnelle, car `Qdrant_Common` ne transmet jamais d'identifiants de base de
données au conteneur. Les variables suivantes ne sont acceptées que pour la
compatibilité avec le socle et n'ont aucun effet : `sql_instance_name`,
`sql_instance_base_name`, `database_password_length`, `application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`enable_postgres_extensions`, `postgres_extensions`, `enable_mysql_plugins`,
`mysql_plugins`, `enable_auto_password_rotation`, `rotation_propagation_delay_sec`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Qdrant ne nécessite aucun job d'initialisation par défaut ; ne fournissez que des tâches personnalisées de chargement de données ou de migration. |
| `cron_jobs` | `[]` | Cloud Run Jobs récurrents pour des snapshots périodiques des collections ou de la maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/readyz`, délai de 15s | Sonde HTTP — Qdrant se déclare prêt une fois toutes les collections chargées. |
| `liveness_probe` | `/livez`, délai de 30s | Sonde HTTP — point de terminaison de vivacité dédié, indépendant de l'état de chargement des collections. |
| `startup_probe_config` | `enabled=true, path=/readyz` | Interface alternative de sonde de démarrage au niveau du socle. |
| `health_check_config` | `enabled=true, path=/livez` | Interface alternative de sonde de vivacité au niveau du socle. |
| `uptime_check_config` | désactivé, `/readyz` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 15 — Réseau avancé {#group-15--advanced-networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` | Nom du réseau VPC à utiliser. Laissez vide pour découvrir automatiquement un réseau unique géré par Services_GCP ; obligatoire uniquement lorsque le projet en contient plusieurs. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (exige `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

### Groupe 0 — Métadonnées du module (avancé/interne) {#group-0--module-metadata-advancedinternal}

Au-delà des métadonnées exposées par la plateforme (`module_description`,
`module_documentation`, `module_dependency`, `module_services`, `credit_cost`,
`require_credit_purchases`, `enable_purge`, `public_access`, `shared_users`,
`technical_support_users`, `resource_creator_identity`,
`impersonation_service_account`, `require_services_gcp_module`), trois variables
contrôlent le provisionnement interne à la plateforme et ne sont normalement pas
définies à la main : `requires_services` (indique à la plateforme quelles
ressources `Services_GCP` provisionner automatiquement pour ce module — par défaut,
la voie gratuite NFS/Redis sur VM Compute, et non Memorystore/Filestore gérés),
`job_execution_wait_timeout` (`900`s — durée pendant laquelle le déploiement
attend un job d'initialisation avant d'abandonner) et `module_writable_secret_ids`
(`{}` — autorisations d'écriture Secret Manager pour les hooks post-installation ;
non utilisée par Qdrant).

---

## 5. Sorties {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `qdrant_url` | URL VPC interne de l'API REST de Qdrant (port 6333). Joignable uniquement depuis le même VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / interruption / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_api_key` | `true` (tout déploiement externe) | Critique | Sans clé d'API, tout appelant capable de joindre le service peut lire, modifier ou supprimer toutes les collections. |
| `ingress_settings` | `internal` (valeur par défaut) | Critique | Définir `"all"` sans `enable_api_key = true` est bloqué au moment du plan ; le faire exposerait Qdrant à l'Internet public. |
| `application_name` | à définir une seule fois | Critique | Immuable après le premier déploiement ; le modifier recrée le stockage et fait perdre toutes les collections. |
| `max_instance_count` | `1` | Élevé | Plusieurs instances écrivant sur le même chemin GCS FUSE corrompent les collections — Qdrant est un stockage à rédacteur unique. |
| Chemin de `liveness_probe` | `/livez` (valeur par défaut) | Élevé | Faire pointer la vivacité vers `/readyz` provoque des redémarrages intempestifs du conteneur à chaque chargement d'une grande collection depuis GCS. |
| `memory_limit` | ≥ `4Gi` en production | Élevé | La valeur par défaut `1Gi` ne prend en charge que de petites collections de test ; les arrêts pour manque de mémoire (OOM) interrompent toutes les requêtes en cours et déclenchent un rechargement complet des index depuis GCS. |
| `execution_environment` | `gen2` (valeur par défaut) | Élevé | GCS FUSE exige Gen2 ; les déploiements Gen1 avec `enable_nfs = true` échouent au moment du plan. |
| `application_version` | épingler une version semver en production | Moyen | Utiliser `latest` peut provoquer une mise à niveau involontaire du format de stockage qui rend les collections existantes illisibles. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro entraîne un rechargement à froid de toutes les collections depuis GCS à la requête suivante ; à éviter pour les charges de travail sensibles à la latence. |
| `timeout_seconds` | `300` | Moyen | Les grandes recherches ANN, les upserts par lots ou les opérations de snapshot peuvent dépasser la valeur par défaut — augmentez-la à `600` ou plus pour les charges lourdes. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les déploiements exposés | Élevé | Sans contrôles d'accès, l'API REST de Qdrant est joignable par tout appelant du réseau autorisé. |
| `secret_propagation_delay` | `30` | Moyen | Dans les grands projets, la réplication Secret Manager peut dépasser 30 s ; augmentez à `60` pour éviter de lire un secret de clé d'API vide. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | laisser les valeurs par défaut | Faible | Inertes — `main.tf` désactive Redis en dur, quelles que soient ces valeurs. Les définir n'a aucun effet et ne signale pas une mauvaise configuration. |
| `database_type` / `sql_instance_name` et les autres variables de base de données du Groupe 12 | laisser les valeurs par défaut | Faible | Inertes pour Qdrant — `Qdrant_Common` ne transmet jamais d'identifiants de base de données au conteneur ; les modifier ne crée donc aucune connexion de base de données utilisable. |
| `container_image` / `container_image_source` / `container_build_config` / `container_resources` | laisser les valeurs par défaut | Faible | Inertes — `Qdrant_Common` fixe l'image réelle, la source de build et le profil de ressources. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Qdrant, partagée avec la variante GKE, est décrite dans
**[Qdrant_Common](Qdrant_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Qdrant sur Cloud Run](../labs/Qdrant_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Qdrant sur GKE Autopilot](Qdrant_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Qdrant Common — Configuration applicative partagée](Qdrant_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), de [MongoDB sur GKE Autopilot](MongoDB_GKE.md) et de [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) dans la solution **Shared Data Services**.
