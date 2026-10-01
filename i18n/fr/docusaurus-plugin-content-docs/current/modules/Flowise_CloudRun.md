---
title: "Flowise sur Google Cloud Run"
description: "Référence de configuration pour déployer Flowise sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Flowise_CloudRun.md @ 3055034 sha256:668fe58fdc7d -->

# Flowise sur Google Cloud Run {#flowise-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flowise_CloudRun.png" alt="Flowise sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flowise est un outil open source de création visuelle de workflows d'IA qui permet aux
non-développeurs d'assembler des pipelines d'IA LangChain et LlamaIndex au moyen d'une
interface glisser-déposer. Ce module déploie Flowise sur **Cloud Run v2** au-dessus du
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Flowise et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Flowise s'exécute dans un conteneur Node.js sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Flowise ne prend pas en charge MySQL dans ce déploiement |
| Stockage objet | Cloud Storage | Un bucket de téléversement dédié toujours provisionné ; il stocke les fichiers téléversés dans Flowise |
| Secrets | Secret Manager | Mot de passe administrateur Flowise généré automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Choisir MySQL ou `NONE` empêche le démarrage.
- **Le stockage de fichiers adossé à GCS est toujours activé.** `STORAGE_TYPE=gcs` et
  `APIKEY_STORAGE_TYPE=db` sont injectés automatiquement ; les clés d'API sont stockées
  dans la base de données, et non dans des fichiers.
- **Les variables `DATABASE_*` sont renseignées par le script de point d'entrée**
  (`flowise-entrypoint.sh`) à partir des variables `DB_*` standard de la plateforme au
  démarrage du conteneur — ne les définissez pas directement comme variables
  d'environnement.
- **`min_instance_count = 0` par défaut.** Des démarrages à froid de 10–20s peuvent
  dépasser les délais d'expiration des clients LLM en aval pour les requêtes entrantes
  — définissez `1` pour un usage en production sensible à la latence.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret
  Manager ; vous ne le définissez jamais en clair.
- **Redis est désactivé par défaut.** Il n'est pas requis pour les fonctionnalités de
  base de Flowise, mais les déploiements multi-instances qui partagent l'état
  d'exécution des flux en tirent profit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Flowise {#a-cloud-run--the-flowise-service}

Flowise s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge de requêtes, entre les nombres minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Flowise stocke toutes les données applicatives (définitions de flux, identifiants,
exécutions) dans une instance Cloud SQL for PostgreSQL 15 gérée. Le service s'y
connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix (sans IP
publique). Lors du premier déploiement, un Job d'initialisation crée la base de
données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags
  et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de téléversement **Cloud Storage** dédié est toujours provisionné par
Flowise_Common. Son nom est injecté automatiquement dans le service en tant que
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Flowise écrit tous les fichiers téléversés par les
utilisateurs (documents, images) dans ce bucket. Des buckets supplémentaires peuvent
être configurés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur de Flowise est stocké dans Secret Manager et injecté
dans le service à l'exécution ; la valeur en clair n'apparaît jamais dans la
configuration. Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL alimentent Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Flowise {#3-flowise-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) utilisant l'image `postgres:15-alpine` crée la base de
  données et l'utilisateur Flowise et accorde les privilèges avant le démarrage du
  service. Il est idempotent et peut être relancé sans risque.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux le
  point de terminaison de santé dédié de Flowise, `/api/v1/ping`, qui renvoie HTTP 200
  lorsque l'application est prête. La sonde de démarrage accorde jusqu'à 5 minutes de
  budget de démarrage (30 échecs × intervalle de 10 secondes) pour laisser le temps à
  l'initialisation de la base de données au premier démarrage.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  configurable via `flowise_username` (par défaut `admin`). Le mot de passe
  administrateur est généré automatiquement et stocké dans Secret Manager ;
  récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<resource_prefix>-flowise-password --project "$PROJECT"
  ```
- **Remappage des variables de base de données.** `flowise-entrypoint.sh` mappe
  inconditionnellement `DB_HOST`, `DB_USER`, `DB_NAME` et `DB_PASSWORD` (injectés par
  la plateforme) vers `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME` et
  `DATABASE_PASSWORD` au démarrage du conteneur. Ne définissez pas directement les
  variables `DATABASE_*`.
- **Stockage de fichiers GCS.** `STORAGE_TYPE=gcs` et `GCLOUD_PROJECT` sont toujours
  injectés. Flowise écrit les fichiers téléversés dans le bucket GCS provisionné
  automatiquement. Remplacer `STORAGE_TYPE` entraîne l'écriture des téléversements sur
  le stockage éphémère de Cloud Run, perdu à chaque nouvelle révision.
- **Considérations multi-instances.** Flowise conserve l'état d'exécution des flux en
  mémoire. Exécuter plus d'une instance sans Redis fait échouer les exécutions de flux
  lorsque les requêtes sont réparties vers une autre instance. Conservez
  `max_instance_count = 1` sauf si Redis est configuré.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Flowise ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

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
| `application_name` | `flowise` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Flowise` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Flowise. |
| `flowise_username` | `admin` | Nom d'utilisateur administrateur de Flowise injecté en tant que `FLOWISE_USERNAME`. Modifiez-le avant toute exposition publique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | URI d'image de remplacement (utilisée uniquement lorsque `container_image_source = "prebuilt"`). |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmentez-la vers 2 GiB pour de grands graphes de flux. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Définissez ≥ 1 pour éviter la latence des démarrages à froid pour les charges de travail d'IA. |
| `max_instance_count` | `1` | Nombre maximal d'instances. N'augmentez cette valeur qu'avec Redis activé. |
| `container_port` | `3000` | Flowise écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages de volumes NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. Augmentez-la pour les exécutions de workflows d'IA de longue durée (max. 3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. Utilisez `internal` ou `internal-and-cloud-load-balancing` pour restreindre l'accès. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Recommandé en production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne remplacez pas les variables gérées par la plateforme (`DATABASE_*`, `FLOWISE_*`, `STORAGE_TYPE`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager (par ex. `{ OPENAI_API_KEY = "flowise-openai-key" }`). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Cadence des notifications de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `application_domains` | `[]` | Noms d'hôte personnalisés avec SSL géré par Google. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. Nécessite `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets définis dans `storage_buckets`. Le bucket de téléversement de Flowise est toujours créé par Flowise_Common. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | `false` | Provisionne un volume NFS Filestore. Nécessite `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Moteur Cloud SQL. Flowise nécessite PostgreSQL. |
| `application_database_name` | `flowisedb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `flowiseuser` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires pour les détails de connexion, en plus des variables `DB_*` standard. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[{ name="db-init", … }]` | Laissez la valeur par défaut pour utiliser le job de configuration PostgreSQL intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés aux côtés de Flowise. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/api/v1/ping`, délai de 30–60s | Sonde de démarrage ; accorde un budget de 5 minutes pour l'initialisation de la base de données. |
| `liveness_probe` / `health_check_config` | HTTP `/api/v1/ping` | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis (facultatif) {#group-21--redis-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis. Non requis pour les fonctionnalités de base ; nécessaire pour les déploiements multi-instances. |
| `redis_host` | `null` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données (sensible). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Flowise nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critical | Sans le sidecar Auth Proxy, la connexion à la base de données est refusée. |
| `application_database_name` / `_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `flowise_username` | à modifier par rapport à `admin` | High | Le nom d'utilisateur par défaut est connu publiquement ; combiné à un mot de passe deviné, il donne un accès complet à tous les flux d'IA. |
| `FLOWISE_SECRETKEY_OVERWRITE` | à laisser non défini après le premier déploiement | High | Le modifier ou le supprimer après le premier déploiement brouille définitivement toutes les clés d'API LLM et tous les identifiants de vector store stockés. |
| `memory_limit` | `1Gi` | High | En dessous de 512Mi, le processus Node.js est arrêté pour manque de mémoire (OOM) au démarrage. La production avec de grands graphes de flux nécessite 2Gi. |
| `max_instance_count` | `1` (sans Redis) | High | Plusieurs instances sans magasin Redis partagé font échouer les exécutions de flux lorsque les requêtes sont routées vers une autre instance. |
| `STORAGE_TYPE` | `gcs` (par défaut) | High | Le remplacer par toute autre valeur écrit les téléversements sur un stockage éphémère, perdu à chaque nouvelle révision. |
| `ingress_settings` | à restreindre pour un usage d'administration | High | La valeur par défaut `all` autorise le trafic de toute source ; définissez `internal-and-cloud-load-balancing` pour restreindre l'accès. |
| `enable_iap` | à activer pour un usage d'administration | High | Sinon, l'interface Flowise est accessible publiquement sans authentification. |
| `min_instance_count` | `1` | Medium | `0` provoque des démarrages à froid de 10–20 s qui dépassent fréquemment les délais d'expiration des clients LLM en aval. |
| `enable_redis` | à activer avec >1 instance | Medium | Requis pour partager l'état de session/de file d'attente entre plusieurs instances. |
| `startup_probe.failure_threshold` | `30` (par défaut) | Medium | Le réduire en dessous de 10 conduit Cloud Run à redémarrer le conteneur avant que Flowise ait terminé l'initialisation de sa base de données au premier démarrage. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Flowise,
partagée avec la variante GKE, est décrite dans **[Flowise_Common](Flowise_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Flowise sur Cloud Run](../labs/Flowise_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Flowise sur GKE Autopilot](Flowise_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flowise Common — Configuration applicative partagée](Flowise_Common.md) — la configuration partagée par les deux cibles de déploiement.
