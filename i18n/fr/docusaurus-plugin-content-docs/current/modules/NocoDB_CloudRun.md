---
title: "NocoDB sur Google Cloud Run"
description: "Référence de configuration pour déployer NocoDB sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/NocoDB_CloudRun.md @ 3055034 sha256:5d3ca96677ac -->

# NocoDB sur Google Cloud Run {#nocodb-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NocoDB_CloudRun.png" alt="NocoDB sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

NocoDB est une alternative open source à Airtable qui transforme n'importe quelle
base de données en tableur intelligent, avec une interface sans code, des API REST
et GraphQL et des automatisations intégrées. Ce module déploie NocoDB sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par NocoDB et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

NocoDB s'exécute sous forme de conteneur Node.js sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | `database_type` n'a aucun effet sur Cloud Run — Postgres 15 est toujours provisionné |
| Stockage d'objets | Cloud Storage | Provisionné, mais non relié au stockage des pièces jointes de NocoDB (voir ci-dessous) |
| Cache (facultatif) | Redis | Désactivé par défaut ; requis lorsque plusieurs instances s'exécutent |
| Secrets | Secret Manager | Secret JWT généré automatiquement (`NC_AUTH_JWT_SECRET`) et mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 uniquement, sur Cloud Run.** La variable `database_type` est
  définie mais jamais transmise à `NocoDB_Common` (qui code en dur `POSTGRES_15`) ;
  la définir n'a donc aucun effet ici — Postgres 15 est provisionné quelle que soit
  la valeur. MySQL 8.0 est pris en charge sur `NocoDB_GKE`, où la surcharge
  équivalente est reliée.
- **NocoDB se connecte en TCP via l'IP privée, et non via le socket de l'Auth
  Proxy.** Le sidecar Cloud SQL Auth Proxy est **désactivé** par défaut
  (`enable_cloudsql_volume = false`), car le constructeur d'URL interne de NocoDB
  rejette les chemins de socket Unix. L'IP privée est utilisée directement.
- **NFS est désactivé par défaut.** NocoDB ne dépend d'aucun système de fichiers
  partagé, mais il ne dispose pas non plus d'un backend de pièces jointes Cloud
  Storage fonctionnel prêt à l'emploi (voir §2C) — les pièces jointes utilisent le
  disque local/éphémère du conteneur, sauf configuration manuelle.
- **Redis est désactivé par défaut.** Une instance unique fonctionne sans Redis ;
  activez-le avant de dépasser une instance.
- **`cpu_always_allocated = false` par défaut.** Facturation à la requête : la
  logique d'automatisation en arrière-plan et de nouvelle tentative des webhooks de
  NocoDB ne se poursuit que tant qu'une instance traite une requête. Définissez
  `true` (avec `min_instance_count ≥ 1`) pour un traitement en arrière-plan
  ininterrompu.
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager.
  N'effectuez pas sa rotation après le premier déploiement — toutes les sessions et
  tous les jetons d'API existants seraient immédiatement invalidés.
- **NocoDB gère lui-même ses migrations de base de données au premier démarrage.**
  Aucun job d'initialisation externe n'est requis.
- **Les sondes de santé ciblent `/api/v1/health`**, le point de terminaison de
  santé dédié exposé par NocoDB.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service NocoDB {#a-cloud-run--the-nocodb-service}

NocoDB s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NocoDB stocke toutes les données applicatives (tables, vues, automatisations,
données des lignes) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service
se connecte via une connexion TCP sur IP privée (pas d'IP publique, pas de socket
Auth Proxy). Au premier déploiement, un job d'initialisation crée la base de
données et l'utilisateur de l'application ; NocoDB exécute ensuite ses propres
migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — provisionné, non relié aux pièces jointes {#c-cloud-storage--provisioned-not-wired-to-attachments}

La variable `storage_buckets` provisionne un bucket GCS (par défaut `name_suffix =
"data"`) et une valeur `GCS_BUCKET_NAME` est injectée dans le service sous forme de
variable d'environnement. Cependant, le script de point d'entrée de
`NocoDB_Common` ne lit jamais `GCS_BUCKET_NAME` (ni aucune autre variable S3/GCS),
et la valeur injectée ne correspond au nom d'aucun bucket réellement créé par le
socle. NocoDB ne stocke donc **pas** automatiquement les pièces jointes dans Cloud
Storage — les fichiers téléversés sont écrits sur le disque local/éphémère du
conteneur et sont perdus lors d'un redémarrage ou d'un démarrage à froid. Pour
conserver les pièces jointes dans GCS, configurez manuellement les paramètres de
stockage compatible S3 propres à NocoDB (via son interface d'administration ou
`environment_variables`) en les faisant pointer vers un bucket auquel le compte de
service Cloud Run peut accéder.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket provisionné.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/      # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse, CMEK et les options de
buckets supplémentaires.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis soutient la couche de cache de NocoDB et, dans les déploiements à plusieurs
instances, maintient la cohérence de l'état du cache et des sessions. Redis est
désactivé par défaut ; un `redis_host` doit être fourni lorsqu'il est activé.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret JWT de NocoDB (`NC_AUTH_JWT_SECRET`) et le mot de passe de la base de
données sont stockés dans Secret Manager et injectés dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être
ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec en option des tests de
disponibilité sur `/api/v1/health` et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application NocoDB {#3-nocodb-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) crée la base de données et l'utilisateur NocoDB
  avant le démarrage du service. Il est idempotent.
- **Migrations autogérées.** NocoDB exécute ses propres migrations de schéma de
  base de données au démarrage — il est inutile de configurer des jobs de
  migration externes.
- **Secret JWT.** `NC_AUTH_JWT_SECRET` est généré automatiquement et stocké dans
  Secret Manager. N'effectuez pas sa rotation après le premier déploiement ; toutes
  les sessions et tous les jetons d'API existants sont immédiatement invalidés si le
  secret change.
- **Les téléversements GCS ne sont pas automatiques.** Une variable
  d'environnement `GCS_BUCKET_NAME` est injectée, mais le script de point d'entrée
  ne la lit jamais et sa valeur ne correspond à aucun bucket créé par le socle. Les
  pièces jointes utilisent le disque local/éphémère du conteneur, sauf si
  l'opérateur configure manuellement les paramètres de stockage compatible S3
  propres à NocoDB.
- **Variables d'environnement NC_DB_*.** Le Dockerfile personnalisé de
  `NocoDB_Common` associe les variables de connexion standard `DB_*` (injectées par
  le socle) aux noms `NC_DB_*` attendus par NocoDB. Lorsque
  `container_image_source = "prebuilt"`, cette correspondance n'est pas appliquée —
  configurez manuellement les variables `NC_DB_*` via `environment_variables`.
- **URL publique.** L'URL du service Cloud Run est injectée sous la forme
  `NC_PUBLIC_URL` afin que NocoDB génère des URL absolues correctes dans les liens
  de partage, les notifications par e-mail et les rappels de webhooks. Contrôlée par
  `service_url_env_var_name` (par défaut `"NC_PUBLIC_URL"`).
- **Chemin de santé.** Les sondes de disponibilité (readiness) et de vivacité ciblent
  `/api/v1/health`, qui renvoie HTTP 200 lorsque NocoDB est prêt à accepter des
  requêtes.
- **Sessions multi-instances.** Avec plus d'une instance et sans Redis, NocoDB ne
  peut pas partager l'état des sessions ni du cache ; les utilisateurs peuvent être
  déconnectés lorsque les requêtes sont acheminées vers une autre instance.
  Activez Redis et définissez `redis_host` avant de dépasser une instance.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à NocoDB ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nocodb` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `NocoDB` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image NocoDB ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 1 GiB minimum pour éviter un OOM au démarrage. |
| `min_instance_count` | `0` | Nombre minimal d'instances ; `0` active la mise à l'échelle à zéro. Conservez ≥ 1 si les webhooks ne doivent pas être perdus. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `container_port` | `8080` | NocoDB écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 recommandé pour un démarrage plus rapide et un réseau amélioré. |
| `enable_cloudsql_volume` | `false` | **Désactivé** — NocoDB se connecte en TCP via l'IP privée, et non via le socket de l'Auth Proxy. |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut. Définissez `true` pour que les tâches d'automatisation en arrière-plan continuent entre les requêtes. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build avec la correspondance NC_DB_* ; `prebuilt` déploie une image existante. |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green entre les révisions. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google. Recommandé pour les espaces de travail internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant à travers le VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Délai d'attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS définis dans `storage_buckets`. Non relié aux pièces jointes de NocoDB — voir §2C. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `enable_nfs` | `false` | NFS n'est pas requis pour NocoDB. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Non transmis sur Cloud Run — `NocoDB_Common` code en dur `POSTGRES_15` quelle que soit cette valeur ; utilisez `NocoDB_GKE` pour `MYSQL_8_0`. |
| `application_database_name` | `nocodb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `nocodb` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` | `NC_DB_HOST` | Nom de variable d'environnement supplémentaire pour l'hôte de la base de données. |
| `db_port_env_var_name` | `NC_DB_PORT` | Nom de variable d'environnement supplémentaire pour le port de la base de données. |
| `db_name_env_var_name` | `NC_DB_NAME` | Nom de variable d'environnement supplémentaire pour le nom de la base de données. |
| `db_user_env_var_name` | `NC_DB_USER` | Nom de variable d'environnement supplémentaire pour l'utilisateur de la base de données. |
| `db_password_env_var_name` | `NC_DB_PASSWORD` | Nom de variable d'environnement supplémentaire pour le mot de passe de la base de données. |
| `service_url_env_var_name` | `NC_PUBLIC_URL` | Nom de la variable d'environnement sous lequel l'URL publique du service est injectée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/api/v1/health` | Sonde de démarrage HTTP, délai initial de 30 s. |
| `liveness_probe` / `health_check_config` | `/api/v1/health` | Sonde de vivacité HTTP. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/api/v1/health`. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis. Requis lorsque plus d'une instance s'exécute. |
| `redis_host` | `null` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison (IP privée) / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` | généré automatiquement (immuable) | Critique | Sa rotation après le premier déploiement invalide immédiatement toutes les sessions et tous les jetons d'API. |
| `application_database_name` / `_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `enable_cloudsql_volume` | `false` (par défaut) | Critique | Définir `true` n'aide pas NocoDB — son constructeur d'URL rejette les chemins de socket et toutes les connexions à la base de données échouent. |
| `memory_limit` | `1Gi` | Élevé | Le processus Node.js de NocoDB est tué pour OOM en dessous de 512 Mi ; les charges de travail de production comportant de nombreuses automatisations nécessitent 2 Gi. |
| `enable_redis` | `true` lorsque >1 instance | Élevé | Plusieurs instances sans Redis provoquent l'invalidation des sessions lorsque les requêtes sont acheminées vers des instances différentes. |
| `redis_host` | explicite lorsque Redis est activé | Élevé | Un hôte manquant fait échouer toutes les connexions Redis au démarrage. |
| `NC_PUBLIC_URL` / `service_url_env_var_name` | `NC_PUBLIC_URL` (par défaut) | Élevé | NocoDB l'utilise pour construire les liens de partage, les URL de webhooks et les notifications par e-mail ; une valeur incorrecte casse toutes les références sortantes. |
| `cpu_always_allocated` | `false` (par défaut) ; `true` pour une automatisation intensive | Moyen | Avec la facturation à la requête par défaut, les tâches d'automatisation en arrière-plan et de nouvelle tentative des webhooks de NocoDB sont suspendues entre les requêtes. |
| `min_instance_count` | `1` | Moyen | `0` provoque des démarrages à froid pendant lesquels les rappels de webhooks expirent et sont perdus. |
| `max_instance_count` | maintenir bas sans Redis | Moyen | Dépasser `1` sans Redis provoque l'invalidation des sessions. |
| `enable_iap` / `enable_cloud_armor` | activer pour un usage interne | Moyen | Sinon, NocoDB est publiquement accessible à son URL `run.app`. |
| `application_version` | épingler un tag précis | Moyen | `latest` déclenche des mises à niveau non maîtrisées à chaque reconstruction du conteneur. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à NocoDB, partagée avec la variante GKE, est décrite dans
**[NocoDB_Common](NocoDB_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NocoDB sur Cloud Run](../labs/NocoDB_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [NocoDB sur GKE Autopilot](NocoDB_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [NocoDB Common — Configuration applicative partagée](NocoDB_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md), [Azimutt sur Google Cloud Run](Azimutt_CloudRun.md) dans la solution **Self-service BI**.
