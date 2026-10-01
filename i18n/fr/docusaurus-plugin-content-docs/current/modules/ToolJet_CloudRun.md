---
title: "ToolJet sur Google Cloud Run"
description: "Référence de configuration pour déployer ToolJet sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ToolJet_CloudRun.md @ 3055034 sha256:367fdbf1d8f9 -->

# ToolJet sur Google Cloud Run {#tooljet-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_CloudRun.png" alt="ToolJet sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet est une plateforme low-code open source permettant de créer et de déployer
des outils internes — tableaux de bord, panneaux d'administration, applications CRUD
et workflows — à l'aide d'un éditeur glisser-déposer branché sur vos propres bases de
données et API. Ce module déploie ToolJet sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ToolJet et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ToolJet s'exécute sous forme d'un unique conteneur NestJS + React sur Cloud Run v2 —
l'API backend et le client compilé sont servis par le même processus
(`SERVE_CLIENT = "true"`) sur le port 80. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut ; `min_instance_count = 1` maintient le worker intégré au processus actif |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — **deux** bases de données sur une même instance (métadonnées + ToolJet Database) |
| ToolJet Database | PostgREST dans le conteneur | Sert la seconde base (`tooljet_db`) aux requêtes des applications ; signé avec `PGRST_JWT_SECRET` |
| Cache et file d'attente | Redis | Activé par défaut ; sert de support aux files BullMQ de ToolJet ; la VM NFS héberge aussi Redis lorsque `redis_host` est vide |
| Secrets | Secret Manager | `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Deux bases de données sont créées.** La tâche `db-init` du premier déploiement
  crée la base de métadonnées (`tooljet`) et la seconde « ToolJet Database »
  (`tooljet_db`), et accorde au rôle applicatif partagé l'attribut **`CREATEROLE`**
  (ToolJet crée un rôle par espace de travail pour l'accès PostgREST).
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée du
  conteneur exécute `npm run db:migrate:prod` (TypeORM) **avant** de lancer le
  serveur — le `start:prod` de ToolJet n'effectue aucune migration de lui-même.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont générés
  automatiquement** et stockés dans Secret Manager. Ces clés ne doivent jamais faire
  l'objet d'une rotation après le premier démarrage — la rotation de
  `LOCKBOX_MASTER_KEY` rend indéchiffrables tous les identifiants de sources de
  données stockés, et celle de `SECRET_KEY_BASE` invalide toutes les sessions.
- **Redis est activé par défaut** (`enable_redis = true`) et, lorsque `redis_host`
  est vide, le socle injecte l'IP de la VM du serveur NFS comme `REDIS_HOST`
  (`enable_nfs = true` provisionne cette VM).
- **Toujours actif, min=1.** ToolJet exécute un worker d'arrière-plan intégré au
  processus ; `cpu_always_allocated = true` et `min_instance_count = 1` maintiennent
  donc une instance active.
- **L'inscription est désactivée par défaut.** `DISABLE_SIGNUPS = "true"` est activé
  d'office ; le premier lancement est un **assistant de configuration** qui crée
  l'utilisateur administrateur initial et l'espace de travail.
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que l'interface de
  l'éditeur et les webhooks des applications soient accessibles ; activer IAP
  restreint l'accès aux identités Google.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service ToolJet {#a-cloud-run--the-tooljet-service}

ToolJet s'exécute en tant que service Cloud Run v2 dont la mise à l'échelle
automatique suit la charge des requêtes entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 — deux bases de données {#b-cloud-sql-for-postgresql-15--two-databases}

ToolJet stocke toutes les données applicatives — applications, configurations des
sources de données, utilisateurs, espaces de travail, sessions — dans une instance
managée Cloud SQL for PostgreSQL 15, et utilise une **seconde base de données**
(`tooljet_db`) sur la même instance pour la fonctionnalité intégrée ToolJet Database.
Le service se connecte de manière privée via le **Cloud SQL Auth Proxy** sur un
socket Unix ; aucune IP publique n'est exposée. Au premier déploiement, un job
d'initialisation crée les deux bases de données, le rôle partagé `CREATEROLE`,
l'extension `pgcrypto` et un schéma `postgrest` appartenant à l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet_db --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Redis (file d'attente et cache) {#c-redis-queue--cache}

Redis est **activé par défaut** et sert de support aux files BullMQ de ToolJet
(tâches d'arrière-plan, notifications et éditeur multijoueur). Lorsque `redis_host`
est laissé vide et que `enable_nfs = true`, l'IP privée de la VM du serveur NFS est
injectée comme `REDIS_HOST` ; définissez explicitement `redis_host` pour pointer vers
une instance Memorystore à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance managée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the injected host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `SECRET_KEY_BASE` (signe les sessions), `LOCKBOX_MASTER_KEY` (chiffre tous
les identifiants de sources de données stockés) et `PGRST_JWT_SECRET` (signe les JWT
PostgREST internes). Le mot de passe de la base de données est géré séparément par
le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité. `TOOLJET_HOST`
(qui détermine les liens générés et les URI de redirection OAuth) prend par défaut
l'URL calculée du service et peut être remplacé via `environment_variables` pour un
domaine personnalisé.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Storage et NFS {#f-cloud-storage--nfs}

ToolJet stocke les applications, les configurations des sources de données et les
fichiers téléversés dans PostgreSQL ; **aucun bucket de données n'est donc
provisionné**. NFS est activé par défaut uniquement parce que sa VM héberge aussi
Redis lorsque `redis_host` est vide ; le conteneur ToolJet lui-même est sans état.

- **Console :** Cloud Storage → Buckets ; Compute Engine → Instances de VM (serveur
  NFS).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

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

## 3. Comportement de l'application ToolJet {#3-tooljet-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente la base de métadonnées
  et la ToolJet Database, le rôle partagé `CREATEROLE`, accorde `cloudsqlsuperuser`,
  pré-crée `pgcrypto` et réinitialise le schéma `postgrest` pour qu'il appartienne à
  l'application. La tâche peut être réexécutée sans risque.
- **Les migrations s'exécutent avant le démarrage du serveur.** `cloud-entrypoint.sh`
  exécute d'abord `npm run db:migrate:prod` (TypeORM `migration:run`). Le
  `start:prod` de ToolJet se résume littéralement à `node dist/src/main` et
  n'effectue **aucune** migration — sans cette étape explicite, la base de
  métadonnées reste vide et toute action reposant sur la base échoue
  (`relation "user_sessions" does not exist`). Le budget de la sonde de démarrage
  (30 × 15 s) absorbe cette étape au premier démarrage.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont immuables
  après le premier démarrage.** Modifier `LOCKBOX_MASTER_KEY` corrompt
  définitivement tous les identifiants de sources de données stockés ; modifier
  `SECRET_KEY_BASE` invalide toutes les sessions. N'y touchez que pendant une
  fenêtre de maintenance planifiée.
- **Le premier lancement est un assistant de configuration.** Avec
  `DISABLE_SIGNUPS = "true"`, ouvrez l'URL du service et terminez l'assistant : il
  crée le premier utilisateur administrateur et l'espace de travail, puis vous mène
  à l'éditeur d'applications. Aucun identifiant administrateur pré-créé n'existe
  dans Secret Manager.
- **La fonctionnalité ToolJet Database.** Les applications peuvent interroger une
  base de données no-code intégrée (`tooljet_db`) exposée par un processus PostgREST
  dans le conteneur. Celui-ci reconfigure un schéma `postgrest` à chaque démarrage en
  tant qu'utilisateur de l'application — c'est pourquoi `db-init` réinitialise ce
  schéma pour qu'il appartienne à l'application.
- **Chemin de santé.** Les sondes de démarrage, d'activité et de disponibilité
  ciblent `/` — un point de terminaison public et non authentifié. Prévoyez
  plusieurs minutes au premier démarrage pour l'étape de migration.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à ToolJet ou notables pour lui sont
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
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tooljet` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `ToolJet` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `tooljet/tooljet-ce` ; épinglez une version précise en production. |
| `db_name` | `tooljet` | Nom de la base de métadonnées. Immuable après le premier déploiement. |
| `db_user` | `tooljet` | Utilisateur de base de données de l'application (partagé par les deux bases). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | ToolJet est livré sous forme d'un build personnalisé léger basé sur `tooljet/tooljet-ce`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `container_resources` | `null` | Objet structuré `{ cpu_limit, memory_limit, cpu_request, mem_request }` ; lorsqu'il est défini, il remplace `cpu_limit`/`memory_limit`. |
| `min_instance_count` | `1` | Maintient le worker intégré au processus actif ; ne définissez pas `0` sauf si le worker est externalisé. |
| `max_instance_count` | `5` | Limite supérieure de la mise à l'échelle automatique. |
| `cpu_always_allocated` | `true` | Obligatoire — le worker d'arrière-plan de ToolJet s'exécute sans requête entrante. |
| `container_port` | `80` | ToolJet sert l'API + le client sur le port 80. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image ToolJet dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour l'interface de l'éditeur et les points de terminaison des applications. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ni `PG_*` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement, pour les valeurs connues au moment du plan. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention des images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; ToolJet lui-même est sans état et ne l'utilise pas. |
| `enable_nfs` | `true` | Activé par défaut ; sa VM héberge aussi Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée (les deux bases de données + le rôle `CREATEROLE`). |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs planifiés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60 s, 30 × 15 s | Sonde de démarrage. Budget large pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, période de 30 s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | _(définies)_ | Sondes structurées alternatives. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Sert de support aux files BullMQ de ToolJet. Transmis tel quel. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`), ou définissez un point de terminaison Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de métadonnées. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour ToolJet). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation corrompt définitivement tous les identifiants de sources de données stockés — ils ne peuvent plus être déchiffrés et doivent tous être ressaisis. |
| `SECRET_KEY_BASE` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions actives et oblige tout le monde à se reconnecter immédiatement. |
| `PGRST_JWT_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation casse la couche de requêtes de la ToolJet Database jusqu'à ce que chaque instance redémarre et que PostgREST soit reconfiguré. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_file` valide fait échouer la tâche d'import. |
| Rôle applicatif `CREATEROLE` (défini par `db-init`) | Laisser tel que provisionné | Élevé | Sans lui, la création d'espaces de travail ToolJet échoue avec `permission denied to create role`. |
| Migrations de schéma (point d'entrée) | Laisser tel que provisionné | Élevé | Ignorer `db:migrate:prod` laisse la base de métadonnées vide — l'application démarre et répond à la sonde de santé `/`, mais toute action reposant sur la base échoue. |
| `min_instance_count` | `1` | Élevé | La valeur `0` permet au worker d'arrière-plan intégré au processus d'être réduit à zéro entre les requêtes, ce qui bloque les tâches en file d'attente. |
| `cpu_always_allocated` | `true` | Élevé | La facturation à la requête limite le worker d'arrière-plan entre les requêtes. |
| `memory_limit` | `4Gi` | Élevé | ToolJet + PostgREST + le worker sous charge peuvent subir un arrêt OOM en dessous d'environ 2 GiB. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` bloque l'interface de l'éditeur et tous les rappels externes des applications. |
| `enable_redis` | `true` | Moyen | Sans Redis, BullMQ passe en mode de repli et les fonctionnalités d'arrière-plan se dégradent. |
| `redis_host` | `""` (NFS) ou explicite | Moyen | Redis activé mais NFS désactivé et aucun hôte défini laisse `REDIS_HOST` vide. |
| `DISABLE_SIGNUPS` (injecté automatiquement à `"true"`) | Laisser activé après le premier administrateur | Élevé | Ouvrir l'inscription permet à quiconque dispose de l'URL de créer un compte. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface de l'éditeur est accessible publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à ToolJet partagée avec la variante GKE est décrite dans
**[ToolJet_Common](ToolJet_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ToolJet sur Cloud Run](../labs/ToolJet_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [ToolJet sur GKE Autopilot](ToolJet_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [ToolJet Common — Configuration applicative partagée](ToolJet_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md), [Hasura sur Google Cloud Run](Hasura_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **Low-code Internal Tools**.
