---
title: "Wiki.js sur Google Cloud Run"
description: "Référence de configuration pour déployer Wiki.js sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wikijs_CloudRun.md @ 3055034 sha256:d8a1c0f3863c -->

# Wiki.js sur Google Cloud Run {#wikijs-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_CloudRun.png" alt="Wiki.js sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wiki.js est une puissante plateforme de wiki open source conçue pour les équipes qui
ont besoin d'une gestion des connaissances moderne et rapide, avec un contrôle de
version adossé à Git et une expérience de rédaction épurée. Ce module déploie
Wiki.js sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Wiki.js et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wiki.js s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Wiki.js utilise PostgreSQL avec l'extension `pg_trgm` pour la recherche en texte intégral |
| Fichiers partagés | Filestore (NFS) | Ressources téléversées partagées entre toutes les instances (montées dans le service) |
| Stockage objet | Cloud Storage | Un bucket `wikijs-storage` dédié, montable via GCS Fuse sur `/wiki-storage` |
| Cache (facultatif) | Redis | Désactivé par défaut ; à activer pour la mise en cache des sessions |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Choisir MySQL ou `NONE` empêche le démarrage.
  L'extension `pg_trgm` est installée automatiquement et est requise pour la
  recherche en texte intégral de Wiki.js.
- **Port 3000.** Wiki.js écoute sur le port 3000 (défini par `Wikijs_Common`), et
  non sur le port conventionnel 80 ou 8080.
- **L'environnement d'exécution Gen2 est requis** pour les montages NFS. Cloud Run
  gen2 est la valeur par défaut.
- **Mise à zéro par défaut.** `min_instance_count = 0` est la valeur par défaut —
  définissez `1` pour les wikis qui ne peuvent pas tolérer des démarrages à froid de
  15 à 30 s.
- **Le chemin de stockage des ressources est important.** `HA_STORAGE_PATH=/wiki-storage`
  indique à Wiki.js où écrire les fichiers téléversés. Le volume NFS ou GCS Fuse doit
  être monté sur ce même chemin.
- **La base de données est amorcée au premier déploiement** par une tâche `db-init`
  qui crée l'utilisateur, la base de données et le schéma PostgreSQL. La sonde de
  démarrage utilise `/healthz` avec un délai initial de 60 secondes pour le permettre.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Wiki.js {#a-cloud-run--the-wikijs-service}

Wiki.js s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Wiki.js stocke toutes les données de l'application (pages, utilisateurs, navigation,
index de recherche) dans une instance gérée Cloud SQL for PostgreSQL 15. L'extension
`pg_trgm` est installée lors du provisionnement et alimente la recherche en texte
intégral native de Wiki.js. Le service se connecte de manière privée via le **Cloud
SQL Auth Proxy** sur un socket Unix (sans IP publique). Au premier déploiement, un
job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les ressources téléversées sont écrites sur un partage **Filestore (NFS)** monté
dans le service, de sorte que toutes les instances partagent les mêmes fichiers. Un
bucket **Cloud Storage** dédié (`wikijs-storage`) est également provisionné pour le
stockage persistant des ressources ; il peut être monté sur `/wiki-storage` via GCS
Fuse.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis est désactivé par défaut. Lorsqu'il est activé, il assure la mise en cache des
sessions. Définissez `enable_redis = true` et fournissez `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans
le service à l'exécution ; il n'apparaît jamais en clair dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Wiki.js {#3-wikijs-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) utilise l'image `postgres:15-alpine` pour se connecter
  via le Cloud SQL Auth Proxy, créer de manière idempotente la base de données et
  l'utilisateur `wikijs`, et accorder les droits requis. L'extension PostgreSQL
  `pg_trgm` est installée dans le cadre de la configuration de `Wikijs_Common`. La
  tâche peut être réexécutée sans risque.
- **Migration du schéma au premier démarrage.** Wiki.js se connecte à PostgreSQL au
  démarrage et exécute sa propre migration interne du schéma. La sonde de démarrage
  comporte un délai initial de 60 secondes pour le permettre au premier lancement.
- **Chemin de stockage des ressources.** Wiki.js écrit les fichiers téléversés dans le
  chemin défini par `HA_STORAGE_PATH` (par défaut `/wiki-storage`). Pour conserver
  les ressources d'une révision à l'autre, configurez `gcs_volumes` pour monter le
  bucket `wikijs-storage` sur `/wiki-storage`. Le chemin de montage NFS et cette
  variable doivent pointer vers le même emplacement.
- **Point de terminaison de santé.** Les sondes de démarrage et d'activité utilisent
  toutes deux `/healthz`, qui ne renvoie HTTP 200 qu'une fois Wiki.js en cours
  d'exécution et connecté à PostgreSQL. Ne le remplacez pas par `/` — le chemin de
  l'interface est lent et peut renvoyer des erreurs pendant le démarrage.
- **Redis est facultatif.** Wiki.js n'a pas besoin de Redis pour son fonctionnement
  de base. Activez-le lorsque vous souhaitez une mise en cache des sessions au niveau
  de l'application.

  Inspectez les tâches et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Wiki.js ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wikijs` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Wiki.js` | Nom convivial affiché dans la console. |
| `application_version` | `2.5.311` | Étiquette de version de l'image Wiki.js ; incrémentez-la pour déclencher une nouvelle révision. |
| `db_name` | `wikijs` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement ; doit correspondre à `DB_NAME`. |
| `db_user` | `wikijs` | Utilisateur PostgreSQL. Immuable après le premier déploiement ; doit correspondre à `DB_USER`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum `1Gi` pour Node.js. |
| `min_instance_count` | `0` | Nombre minimal d'instances — définissez `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | `300` | À augmenter pour les exports de pages volumineux ou le traitement des ressources. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_image_mirroring` | `true` | Duplique `requarks/wiki:2` depuis Docker Hub dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ DB_TYPE="postgres", DB_PORT="5432", DB_USER="wikijs", DB_NAME="wikijs", DB_SSL="false", HA_STORAGE_PATH="/wiki-storage" }` | Prérempli avec les paramètres de connexion à la base de données de Wiki.js. Valeurs essentielles — ne pas les supprimer. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. `DB_PASS` est branché automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Délai de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base d'une instance créée en mode intégré (inline). |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les ressources de Wiki.js. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur — doit être aligné sur `HA_STORAGE_PATH`. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de stockage / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Wiki.js nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée de `Wikijs_Common`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, 60 s initial delay | Sonde de démarrage — délai généreux pour la migration de la base de données au premier lancement. |
| `liveness_probe` | HTTP `/healthz`, 60 s initial delay | Sonde de vivacité. |
| `uptime_check_config` | disabled, path `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour la mise en cache des sessions (facultatif pour Wiki.js). |
| `redis_host` | `""` | Point de terminaison Redis. Obligatoire lorsque `enable_redis = true`, **sauf** si `enable_nfs = true` ou si un serveur NFS est détectable par ailleurs, auquel cas l'IP du serveur NFS est utilisée comme hôte Redis par défaut. `enable_nfs` vaut `true` par défaut pour ce module ; `redis_host` n'est donc pas réellement obligatoire dans la configuration par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Wiki.js nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `db_name` / `DB_NAME` | tous deux `wikijs` | Critique | Non-concordance : `db-init` crée une base de données différente de celle à laquelle Wiki.js se connecte — boucle de plantage. Immuable après le premier déploiement. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation supprime le sidecar Auth Proxy — toutes les connexions PostgreSQL échouent. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `db_user` / `DB_USER` | tous deux `wikijs` | Élevé | Non-concordance : les droits sont accordés à un utilisateur mais Wiki.js s'authentifie avec un autre — échec d'authentification. |
| `enable_nfs` | `true` | Élevé | Sans stockage partagé, les fichiers téléversés écrits par une instance sont invisibles pour les autres. |
| `nfs_mount_path` + `HA_STORAGE_PATH` | tous deux `/wiki-storage` | Élevé | Si le chemin de montage et `HA_STORAGE_PATH` divergent, Wiki.js écrit sur un disque éphémère. |
| `memory_limit` | `2Gi` | Élevé | En dessous de `1Gi`, Wiki.js est arrêté par manque de mémoire (OOM) au démarrage ou sous charge. |
| `startup_probe.initial_delay_seconds` | `60` | Élevé | Trop faible — Wiki.js est arrêté avant la fin de la migration du schéma au premier lancement. |
| `min_instance_count` | `1` | Élevé | La mise à zéro provoque des démarrages à froid de 15 à 30 s avec des requêtes en cours qui échouent. |
| `gcs_volumes` | montage sur `/wiki-storage` | Élevé | Le bucket `wikijs-storage` est provisionné mais pas monté automatiquement ; sans `gcs_volumes`, les fichiers téléversés vont sur un disque éphémère. |
| `application_version` | `2.5.311` | Élevé | Wiki.js 2.x et 3.x ont des schémas incompatibles. Testez les mises à niveau en préproduction. |
| `enable_iap` / `ingress_settings` | restreindre pour les wikis internes | Élevé | La valeur par défaut (`all`) expose la page de connexion de Wiki.js à l'internet public. |
| `enable_redis` | `false` sauf si nécessaire | Faible | Wiki.js n'a pas besoin de Redis pour son fonctionnement de base. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Wiki.js, partagée avec la variante GKE, est décrite dans
**[Wikijs_Common](Wikijs_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wiki.js sur Cloud Run](../labs/Wikijs_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Wiki.js sur GKE Autopilot](Wikijs_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wikijs Common — Configuration applicative partagée](Wikijs_Common.md) — la configuration partagée par les deux cibles de déploiement.
