---
title: "Twenty CRM sur Google Cloud Run"
description: "Référence de configuration pour déployer Twenty CRM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Twenty_CloudRun.md @ 3055034 sha256:31b8775a5841 -->

# Twenty CRM sur Google Cloud Run {#twenty-crm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Twenty_CloudRun.png" alt="Twenty CRM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Twenty est un CRM open source qui compte plus de 25 000 étoiles sur GitHub, conçu
comme une alternative moderne et adaptée aux développeurs à Salesforce et HubSpot.
Ce module déploie Twenty sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Twenty et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Twenty s'exécute sous forme de conteneur Node.js sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Twenty ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Facultatif ; un bucket dédié lorsque `enable_gcs_storage = true` |
| Tâches d'arrière-plan | Redis (facultatif) | bull-mq lorsqu'il est activé ; pg-boss (adossé à PostgreSQL) par défaut, sans infrastructure supplémentaire |
| Secrets | Secret Manager | Secret applicatif généré automatiquement (`APP_SECRET` / `ENCRYPTION_KEY`) et mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Choisir MySQL ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Twenty v0.4+ impose Redis pour le stockage des
  sessions et du cache — sans connexion Redis valide, Twenty ne démarre pas. Lorsque
  `redis_host` est laissé vide, l'IP de la VM NFS de la plateforme est utilisée
  (nécessite `enable_nfs = true` ou un `redis_host` explicite).
- **pg-boss est la file de tâches lorsque Redis est désactivé.** Il ne nécessite
  aucune infrastructure supplémentaire et utilise directement la base PostgreSQL.
- **Les pièces jointes sont stockées par défaut sur un stockage local éphémère.**
  Activez `enable_gcs_storage` pour un stockage d'objets persistant sur GCS.
- **Trois jobs d'initialisation s'exécutent avant le démarrage du serveur.**
  `db-init` crée la base de données et l'utilisateur ; `twenty-migrate` exécute les
  migrations de schéma TypeORM ; `twenty-verify` est une tâche de garde qui fait
  échouer l'apply si le schéma `core` ne contient aucune table, signalant
  bruyamment une migration concurrente ou échouée au lieu de livrer un service en
  bonne santé pointant vers une base vide. Les migrations de base de données sont
  désactivées dans le conteneur principal (`DISABLE_DB_MIGRATIONS=true`) afin de
  garder des démarrages à froid rapides après le premier démarrage.
- **`SERVER_URL` et `FRONT_BASE_URL` doivent être définis manuellement.** Sans eux,
  les liens d'API, le CORS et les invitations par e-mail ne fonctionnent pas.
- Le **APP_SECRET / ENCRYPTION_KEY** est généré automatiquement et stocké dans
  Secret Manager ; vous ne le définissez jamais en clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Twenty {#a-cloud-run--the-twenty-service}

Twenty s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge des requêtes, entre le nombre minimal et le nombre
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

Twenty stocke toutes les données applicatives (contacts, pipelines, objets
personnalisés) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y
connecte de manière privée via le **Cloud SQL Auth Proxy**, par un socket Unix
(pas d'IP publique). Au premier déploiement, trois Jobs d'initialisation
s'exécutent à la suite : `db-init` crée la base de données et l'utilisateur,
`twenty-migrate` exécute les migrations de schéma à l'aide du point d'entrée propre
à Twenty, et `twenty-verify` protège contre un schéma vide en faisant échouer
l'apply si les migrations n'ont créé aucune table.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe figurent dans les [Sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la
rotation des mots de passe.

### C. Cloud Storage (stockage de fichiers facultatif) {#c-cloud-storage-optional-file-storage}

Lorsque `enable_gcs_storage = true`, un bucket **Cloud Storage** dédié est
provisionné et Twenty est configuré pour utiliser l'API compatible S3 de GCS
(`STORAGE_TYPE=s3`). Sans cela, les pièces jointes sont stockées dans le système de
fichiers éphémère du conteneur et sont perdues lors du déploiement d'une nouvelle
révision.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Remarque : lorsque `enable_gcs_storage = true`, vous devez fournir des clés HMAC
GCS via `secret_environment_variables` (`STORAGE_S3_ACCESS_KEY_ID` et
`STORAGE_S3_SECRET_ACCESS_KEY`). Générez-les dans la console sous Cloud Storage →
Settings → Interoperability.

### D. Redis (tâches d'arrière-plan) {#d-redis-background-jobs}

Redis assure le stockage des sessions et du cache de Twenty à partir de la v0.4 et,
lorsqu'il est activé, fait passer le traitement d'arrière-plan à **bull-mq**. Sans
Redis, Twenty utilise **pg-boss** (une file de tâches adossée à PostgreSQL) sans
infrastructure supplémentaire. Lorsque `redis_host` est vide et que
`enable_nfs = true`, l'IP de la VM NFS est utilisée comme hôte Redis.

Lorsque `enable_redis = true`, un service Cloud Run worker dédié doit être déployé
via `additional_services` pour consommer la file bull-mq.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret applicatif de Twenty (`APP_SECRET` / `ENCRYPTION_KEY`) et le mot de passe
de la base de données sont stockés dans Secret Manager et injectés dans le service
à l'exécution ; aucune valeur en clair n'apparaît dans la configuration.

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

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Twenty {#3-twenty-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Trois Jobs
  d'initialisation s'exécutent l'un après l'autre avant le démarrage du service :
  1. `db-init` — se connecte à Cloud SQL via le socket Unix de l'Auth Proxy, crée
     la base de données PostgreSQL et l'utilisateur, accorde les privilèges et
     installe l'extension `uuid-ossp`. Il est idempotent et peut être réexécuté
     sans risque.
  2. `twenty-migrate` — exécute le point d'entrée propre à Twenty
     (`twenty-entrypoint.sh`) avec `DISABLE_DB_MIGRATIONS=false`, ce qui lance les
     migrations de schéma TypeORM et enregistre les tâches cron d'arrière-plan.
     `max_retries = 3`, car l'instance Cloud SQL d'un nouveau tenant peut être encore
     en cours de stabilisation lorsque cette tâche démarre.
  3. `twenty-verify` — une tâche de garde (`depends_on_jobs = ["twenty-migrate"]`)
     qui vérifie que le schéma `core` contient bien des tables et **fait échouer
     l'apply** si ce n'est pas le cas. Elle existe parce qu'un échec de job
     d'initialisation NE fait PAS échouer à lui seul l'apply du module — sans cette
     garde, un `twenty-migrate` concurrent ou échoué pourrait livrer en silence un
     service apparemment sain pointant vers une base de données VIDE (chaque requête
     backend échoue alors avec `relation "core.keyValuePair" does not exist"`, et
     l'interface affiche « Unable to Reach Back-end »).
  Inspectez-les après le déploiement :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Migrations désactivées au démarrage normal.** Le conteneur principal s'exécute
  avec `DISABLE_DB_MIGRATIONS=true`, de sorte que les migrations ne s'exécutent que
  via la tâche `twenty-migrate`. Cela réduit le temps de démarrage à froid de
  plusieurs minutes à quelques secondes lors des démarrages suivants.
- **Tâches d'arrière-plan.** Lorsque Redis est désactivé (mode pg-boss), les tâches
  d'arrière-plan — envoi d'e-mails, livraison de webhooks, synchronisation des
  données — sont traitées par le service principal. Lorsque Redis est activé (mode
  bull-mq), un service worker distinct doit être déployé via `additional_services`,
  pointant vers la même image avec la commande worker.
  Inspectez les tâches :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Chemin de santé.** La sonde de démarrage interroge `/healthz` avec un délai
  initial de 120 secondes et jusqu'à 40 échecs (~10 minutes) afin de laisser le
  temps aux migrations du premier démarrage. La sonde de vivacité interroge
  `/healthz` avec un délai initial de 30 secondes.
- **`SERVER_URL` est obligatoire.** Sans lui, Twenty génère des liens d'API
  incorrects, des erreurs CORS se produisent sur tous les appels d'API et les
  invitations par e-mail échouent. Définissez-le via `environment_variables` :
  ```bash
  environment_variables = {
    SERVER_URL     = "https://crm.example.com"
    FRONT_BASE_URL = "https://crm.example.com"
  }
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Twenty ou notables pour lui sont
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `twenty` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Twenty CRM` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Twenty. **Épinglez une version précise en production** (p. ex. `0.50.0`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. 2 vCPU recommandés en production. |
| `memory_limit` | `2Gi` | Mémoire par instance. Passez à `4Gi` pour les jeux de données volumineux. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Gardez ≥ 1 pour éviter les démarrages à froid sur les charges de travail de webhooks/tâches. |
| `max_instance_count` | `3` | Nombre maximal d'instances. |
| `cpu_always_allocated` | `false` | Facturation à la requête par défaut : ce service n'exécute que le serveur de Twenty (`node dist/main`) — aucun processus worker n'est déployé et l'enregistrement des cron est désactivé, il n'y a donc aucun travail d'arrière-plan en processus à brider. Définissez `true` uniquement si un worker Twenty ou une autre tâche d'arrière-plan est déployé dans ce conteneur. |
| `container_port` | `3000` | Twenty écoute sur le port 3000. Ne le modifiez pas, sauf si vous utilisez une image personnalisée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `execution_environment` | `gen2` | Gen2 requis pour le réseau VPC. |
| `container_image_source` | `custom` | `custom` (Cloud Build) ou `prebuilt` (URI d'image existante). |
| `enable_image_mirroring` | `true` | Copie miroir de l'image Twenty dans Artifact Registry. |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green entre les révisions. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Utile pour un accès interne au CRM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service (all / internal / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en clair. **Définissez ici `SERVER_URL` et `FRONT_BASE_URL`.** |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. À utiliser pour `STORAGE_S3_ACCESS_KEY_ID` et `STORAGE_S3_SECRET_ACCESS_KEY` lorsque le stockage GCS est activé. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage du service. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. Doivent correspondre à `SERVER_URL`. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend du LB. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisionne un bucket GCS pour un stockage de fichiers persistant via l'API compatible S3. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `enable_nfs` | `false` | Volume NFS (Filestore). Non requis pour Twenty ; activez-le uniquement si l'IP NFS sert d'hôte Redis. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. Options : `POSTGRES_15`, `POSTGRES_14`, `POSTGRES_13`. |
| `db_name` | `twenty` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `twenty` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms facultatifs de variables d'environnement supplémentaires sous lesquels les informations de connexion sont injectées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `db-init`, `twenty-migrate` et `twenty-verify`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents supplémentaires déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires. Requis pour un worker bull-mq dédié lorsque `enable_redis = true`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/healthz`, délai de 120 s, 40 échecs | Interroge `/healthz` ; laisse jusqu'à ~10 minutes pour les migrations du premier démarrage. |
| `liveness_probe` / `health_check_config` | HTTP `/healthz`, délai de 30 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/healthz` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis. Requis pour Twenty v0.4+ ; le désactiver impose pg-boss. |
| `redis_host` | `""` | Point de terminaison Redis. S'il est vide, l'IP de la VM NFS est utilisée (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite un `organization_id` explicite). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison / port de la base. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SERVER_URL` / `FRONT_BASE_URL` (dans `environment_variables`) | URL publique du déploiement | Critique | Les liens d'API sont incorrects, des erreurs CORS bloquent toutes les requêtes, les invitations par e-mail échouent. À définir avant la première utilisation. |
| `database_type` | `POSTGRES_15` | Critique | Twenty exige PostgreSQL ; MySQL ou `NONE` font échouer les migrations de schéma et le démarrage. |
| `db_name` / `db_user` | défini une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit les données. |
| `enable_cloudsql_volume` | `true` | Critique | Twenty se connecte via le socket Unix de l'Auth Proxy ; le désactiver supprime le socket et coupe toutes les connexions à la base. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import ; le réactiver sur un déploiement en service écrase les données. |
| `APP_SECRET` / `ENCRYPTION_KEY` (générés automatiquement) | ne pas faire de rotation manuelle | Critique | La rotation du secret invalide toutes les sessions JWT actives et déconnecte immédiatement tous les utilisateurs. |
| `enable_redis` | `true` (requis en v0.4+) | Élevé | Sans Redis, Twenty v0.4+ ne démarre pas ; le stockage des sessions et du cache est imposé sur Redis. |
| `redis_host` | hôte explicite ou `enable_nfs = true` | Élevé | Lorsque `enable_redis = true` et que `redis_host` est vide sans VM NFS, l'URL Redis est vide et Twenty ne parvient pas à se connecter. |
| `additional_services` (worker) | configuré lors de l'utilisation de Redis | Élevé | Lorsque `enable_redis = true`, bull-mq est actif mais aucun worker ne traite la file ; les tâches d'arrière-plan (e-mail, webhooks) ne s'exécutent jamais. |
| `enable_gcs_storage` | `true` en production | Élevé | Sans stockage GCS, les pièces jointes sont stockées dans le stockage éphémère du conteneur et perdues lors du déploiement d'une nouvelle révision. |
| `STORAGE_S3_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | via `secret_environment_variables` | Élevé | Lorsque le stockage GCS est activé, les clés HMAC ne sont pas générées automatiquement ; toutes les opérations sur les fichiers échouent sans elles. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 1 GiB, le processus Node.js est tué pour OOM sous charge. |
| `application_version` | version épinglée (p. ex. `0.50.0`) | Élevé | `latest` se résout en une image différente à chaque exécution de Cloud Build, ce qui rend les retours arrière imprévisibles. |
| `container_port` | `3000` | Élevé | Le serveur de Twenty écoute sur le port 3000 ; toute autre valeur fait échouer définitivement les contrôles de santé. |
| `startup_probe` | HTTP `/healthz`, délai généreux | Élevé | Une fenêtre trop courte entraîne l'arrêt du service pendant les migrations du premier démarrage (qui prennent 8–10 minutes sur un schéma neuf). |
| `min_instance_count` | `1` | Moyen | `0` ajoute une latence de démarrage à froid et risque de manquer des webhooks entrants pendant la montée en charge de l'instance. |
| `cpu_always_allocated` | `false` sauf si un worker est déployé | Moyen | Définir `true` sans worker/cron s'exécutant dans ce conteneur revient à payer du CPU inactif sans rien à brider ; nécessaire uniquement si un travail d'arrière-plan est ajouté à ce service. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les déploiements non publics | Moyen | Sinon, l'interface du CRM est accessible publiquement. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Moyen | Lorsque Memorystore Redis est utilisé, son IP privée peut nécessiter `ALL_TRAFFIC` pour le routage. |
| `organization_id` | défini explicitement pour VPC-SC | Moyen | Sans lui, le périmètre VPC-SC n'est pas activé — `enable_vpc_sc = true` n'a aucun effet. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et copie miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Twenty, partagée avec la variante GKE, est décrite dans
**[Twenty_Common](Twenty_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Twenty sur Cloud Run](../labs/Twenty_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Twenty CRM sur GKE Autopilot](Twenty_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Twenty Common — Configuration applicative partagée](Twenty_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **CRM & Sales Operations**.
