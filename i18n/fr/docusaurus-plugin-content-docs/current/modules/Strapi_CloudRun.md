---
title: "Strapi sur Google Cloud Run"
description: "Référence de configuration pour déployer Strapi sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Strapi_CloudRun.md @ 3055034 sha256:930abae733a5 -->

# Strapi sur Google Cloud Run {#strapi-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Strapi_CloudRun.png" alt="Strapi sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Strapi est le principal CMS headless open source — il fournit une API de contenu
entièrement personnalisable (REST et GraphQL) avec un panneau d'administration riche,
utilisée par des entreprises et des développeurs du monde entier pour la gestion de
contenu et les architectures API-first. Ce module déploie Strapi sur **Cloud Run v2**
en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Strapi et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Strapi s'exécute sous forme de conteneur Node.js sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Strapi requiert PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Médias téléversés partagés entre toutes les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléversements (suffixe `strapi-uploads`) |
| Cache (facultatif) | Redis / Memorystore | Facultatif ; désactivé par défaut |
| Secrets | Secret Manager | Cinq secrets cryptographiques générés automatiquement, plus le mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** La couche de données de Strapi est câblée sur
  PostgreSQL ; MySQL et `NONE` empêchent le démarrage.
- **Une image de conteneur personnalisée est construite via Cloud Build.**
  `container_image_source` vaut `"custom"` par défaut — le module construit une image
  Node.js 20 en deux étapes, prête pour la production, à chaque incrément de version.
- **Cinq secrets cryptographiques sont générés automatiquement.** `JWT_SECRET`,
  `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`, `TRANSFER_TOKEN_SALT` et `APP_KEYS` sont
  générés et stockés dans Secret Manager lors du premier déploiement et ne doivent
  jamais changer ensuite.
- **NFS est activé par défaut.** Strapi stocke les médias téléversés sous `/uploads`.
  Sans volume NFS partagé (gen2 requis), les médias sont perdus d'une instance à
  l'autre.
- **Redis est désactivé par défaut.** Activez-le uniquement lorsque vous utilisez des
  plugins qui requièrent explicitement un cache ou un magasin de sessions partagé ;
  une fois activé, `redis_host` doit être défini.
- **Le port du conteneur est 8080 sur Cloud Run.** Le module Cloud Run remplace le
  port par défaut 1337 de Strapi Common pour respecter le port standard de Cloud Run.
- **Les variables du bucket de médias GCS sont injectées automatiquement.**
  `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont définies automatiquement ; aucune
  configuration manuelle n'est nécessaire.
- **La mise à l'échelle à zéro est la valeur par défaut.** `min_instance_count = 0`
  permet au service de descendre à zéro instance en cas d'inactivité, mais ajoute une
  latence de démarrage à froid de 15–30 secondes à la première requête.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Strapi {#a-cloud-run--the-strapi-service}

Strapi s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements progressifs sûrs.

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

Strapi stocke toutes les données applicatives (types de contenu, contenu,
utilisateurs, jetons d'API) dans une instance gérée Cloud SQL for PostgreSQL 15. Le
service se connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket
Unix (sans IP publique). Lors du premier déploiement, un job Cloud Run
d'initialisation crée la base de données et l'utilisateur de l'application.

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

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléversés sont écrits sur un partage **Filestore (NFS)** monté dans le
service afin que toutes les instances partagent les mêmes fichiers (environnement
d'exécution gen2 requis). Un bucket **Cloud Storage** dédié (suffixe
`strapi-uploads`) est également provisionné et configuré comme fournisseur de
téléversement GCS de Strapi.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Cinq secrets cryptographiques de Strapi sont générés lors du premier déploiement et
stockés dans Secret Manager : `JWT_SECRET`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`,
`TRANSFER_TOKEN_SALT` et `APP_KEYS` (quatre clés jointes par des virgules). Le mot de
passe de la base de données y est également stocké. Tous les secrets sont injectés
dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Cache Redis (facultatif) {#e-redis-cache-optional}

Lorsque `enable_redis = true`, Redis sert de magasin de sessions et de cache des
réponses de l'API REST via les plugins `strapi-plugin-redis` et
`strapi-plugin-rest-cache`. Lorsque `redis_host` est laissé à null et que NFS est
activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis à
l'exécution.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Strapi {#3-strapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job Cloud Run
  `db-init` s'exécute à chaque apply avec `postgres:15-alpine`. Il crée de manière
  idempotente la base de données et l'utilisateur Strapi, accorde les privilèges
  nécessaires (dont `CREATEDB`) et signale au Cloud SQL Auth Proxy de s'arrêter
  proprement. Il peut être relancé sans risque.
- **Fournisseur de médias GCS.** `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectées
  automatiquement dans le conteneur. Le fichier `config/plugins.js` de Strapi détecte
  ces variables et bascule vers le fournisseur de téléversement GCS pour tous les
  éléments de la médiathèque.
- **Envoi d'e-mails (facultatif).** Si `SMTP_HOST` est défini dans
  `environment_variables`, `config/plugins.js` active automatiquement le fournisseur
  d'e-mails `nodemailer` pour les notifications de Strapi. Définissez `SMTP_PASSWORD`
  via `secret_environment_variables`.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/_health` en HTTP — le point de terminaison de santé dédié de Strapi, qui ne
  renvoie 200 que lorsque l'application et la connexion à la base de données sont
  prêtes. La sonde de démarrage (`startup_probe` — la valeur réellement appliquée ;
  `startup_probe_config` est une variable distincte et inerte) laisse jusqu'à
  ~90 secondes (60 s de délai initial + 3 × une période de 10 secondes) pour
  l'initialisation au premier démarrage.
- **Les secrets cryptographiques sont immuables après le premier déploiement.** Les
  cinq secrets générés automatiquement signent les sessions actives et les jetons
  d'API. Régénérer l'un d'entre eux invalide immédiatement toutes les sessions et tous
  les jetons actifs.
- **Connexion administrateur.** Il n'existe pas d'utilisateur administrateur par
  défaut ; l'assistant de première exécution de Strapi crée l'administrateur initial
  lors de la première visite du panneau d'administration dans le navigateur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Strapi ou notables pour lui sont
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
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `strapi` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Strapi CMS` | Nom lisible affiché dans la console. |
| `application_description` | `Strapi CMS on Cloud Run` | Description du service. |
| `application_version` | `5.0.0` | Tag de l'image ; incrémentez-le pour déclencher une nouvelle exécution Cloud Build et une nouvelle révision. Ne sélectionne **pas** la version du paquet Strapi — `@strapi/strapi` est figé dans `Strapi_Common/scripts/package.json` (actuellement `4.24.2`) et cette variable n'a aucun effet dessus. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` déclenche Cloud Build ; `"prebuilt"` déploie une URI d'image existante. |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour utiliser l'image construite par le module. |
| `container_build_config` | `{ enabled = true }` | Chemin du Dockerfile, contexte de build et arguments de build pour Cloud Build. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry avant le déploiement. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; Strapi a besoin de marge pour Node.js et le panneau d'administration. |
| `min_instance_count` | `0` | Nombre minimal d'instances (0 = mise à l'échelle à zéro). Définissez `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal d'instances ; augmentez-le après avoir validé l'état partagé sur NFS. |
| `container_port` | `8080` | Port vers lequel le service Cloud Run achemine le trafic (valeur par défaut de Cloud Run). |
| `execution_environment` | `gen2` | gen2 est requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les traitements de médias longs. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements canary/blue-green. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions Cloud Run à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (all / internal / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `GCS_BUCKET_NAME` et `GCS_BASE_URL` sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager pour des secrets supplémentaires. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Pub/Sub. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_file` (et non `backup_uri`). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance créée en mode intégré (inline). |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Équilibreur de charge, CDN et Cloud Armor {#group-10--load-balancer-cdn--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Strapi (gen2 requis). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL est obligatoire — ne remplacez pas par MySQL ou `NONE`. |
| `application_database_name` | `strapidb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `strapiuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement alias supplémentaires pour les informations de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[{ name="db-init", execute_on_apply=true }]` | Le job intégré `db-init` s'exécute à chaque apply. Fournissez une liste non vide pour le remplacer. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run déployés conjointement (par ex. workers d'arrière-plan). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, délai initial de 60 s, 3 tentatives | La sonde réellement appliquée. `startup_probe_config` est également déclarée mais est supplantée par cette valeur et n'a aucun effet. |
| `liveness_probe` | HTTP `/_health`, délai initial de 30 s, 3 tentatives | La sonde réellement appliquée. `health_check_config` est également déclarée mais est supplantée par cette valeur et n'a aucun effet. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis pour le cache et les sessions (désactivé par défaut). |
| `redis_host` | `null` | Point de terminaison Redis. Laissez null pour se rabattre sur l'IP du serveur NFS (requiert `enable_nfs = true`) ; si NFS est également désactivé, la valeur de repli n'est pas résolue et la connexion échoue. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
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
| `database_host` / `database_port` | Point de terminaison / port de la base de données (sensible). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEYS` / `JWT_SECRET` / `ADMIN_JWT_SECRET` / `API_TOKEN_SALT` (générés automatiquement) | générés une fois, jamais modifiés | Critique | Leur rotation après le premier déploiement invalide immédiatement toutes les sessions et tous les jetons d'API actifs ; tous les utilisateurs sont déconnectés et toutes les intégrations clientes cessent de fonctionner. |
| `database_type` | `POSTGRES_15` | Critique | Strapi requiert PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les téléversements sont perdus entre instances ou redémarrages. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; le modifier renomme toutes les ressources GCP, ce qui entraîne une recréation complète et une perte de données. |
| `application_database_name` / `application_database_user` | définis une fois | Critique | Immuables après le premier déploiement ; les renommer conduit Strapi à se connecter à une base de données vide. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_file` valide fait échouer le job d'import. |
| `execution_environment` | `gen2` | Élevé | gen1 ne prend pas en charge les montages NFS ; NFS échouera silencieusement. |
| `enable_redis` | `false` | Élevé | À activer uniquement lorsque des plugins le requièrent. Un `redis_host` non défini se rabat sur l'IP du serveur NFS (ne fonctionne que lorsque `enable_nfs = true`) ; si NFS est également désactivé, la valeur de repli n'est pas résolue et provoque une erreur de connexion au démarrage. |
| `memory_limit` | `2Gi` | Élevé | Le runtime Node.js de Strapi et le panneau d'administration requièrent suffisamment de mémoire ; des valeurs inférieures à `512Mi` provoquent des arrêts OOM. |
| `min_instance_count` | `0` ou `1` | Moyen | `0` permet la mise à l'échelle à zéro ; la première requête après une période d'inactivité subira un démarrage à froid de 15–30 secondes. |
| `enable_iap` | à activer pour l'administration | Moyen | Sinon, le panneau d'administration de Strapi est accessible publiquement. |
| `enable_cloud_armor` / `enable_cdn` | à envisager en production | Moyen | Le CDN met le contenu en cache au plus près des utilisateurs ; Cloud Armor fournit une protection WAF et DDoS. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `secret_propagation_delay` | `30` | Faible | Un délai trop court peut provoquer des échecs de démarrage au premier déploiement si les secrets ne sont pas encore propagés. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Strapi partagée avec la variante GKE est décrite dans
**[Strapi_Common](Strapi_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Strapi sur Cloud Run](../labs/Strapi_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Strapi sur GKE Autopilot](Strapi_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Strapi Common — Configuration applicative partagée](Strapi_Common.md) — la configuration partagée par les deux cibles de déploiement.
