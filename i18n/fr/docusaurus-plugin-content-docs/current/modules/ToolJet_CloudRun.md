---
title: "ToolJet sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de ToolJet sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ToolJet_CloudRun.md @ 15fd4c7 sha256:74eee69b5a9f -->

# ToolJet sur Google Cloud Run {#tooljet-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_CloudRun.png" alt="ToolJet sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet est une plateforme open source low-code pour la création et le
déploiement d'outils internes — tableaux de bord, panneaux d'administration,
applications CRUD et workflows — avec un constructeur par glisser-déposer sur
vos propres bases de données et API. Ce module déploie ToolJet sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ToolJet et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à chaque application
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ToolJet s'exécute comme un conteneur NestJS + React unique sur Cloud Run v2 —
l'API backend et le client compilé sont servis à partir du même processus
(`SERVE_CLIENT = "true"`) sur le port 80. Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut ; `min_instance_count = 1` maintient le worker intégré actif |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — **deux** bases de données sur une instance (métadonnées + ToolJet Database) |
| ToolJet Database | PostgREST (sidecar intégré) | Sert la deuxième base de données (`<service_name>_tjdb`) aux requêtes d'application ; signé avec `PGRST_JWT_SECRET` |
| Cache et file d'attente | Redis | Activé par défaut ; prend en charge les files d'attente BullMQ de ToolJet ; la VM NFS co-héberge Redis lorsque `redis_host` est vide |
| Secrets | Secret Manager | Auto-généré `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Deux bases de données sont créées.** Le job `db-init` du premier déploiement
  crée la base de données de métadonnées et la deuxième "ToolJet Database"
  (`<service_name>_tjdb`), et accorde à la rôle d'application partagé l'attribut
  **`CREATEROLE`** (ToolJet crée un rôle par espace de travail pour l'accès
  PostgREST).
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée du
  conteneur exécute `npm run db:migrate:prod` (TypeORM) **avant** de lancer le serveur —
  `start:prod` de ToolJet ne migre pas seul.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont générés
  automatiquement** et stockés dans Secret Manager. Ces clés ne doivent jamais
  être renouvelées après le premier démarrage — le renouvellement de
  `LOCKBOX_MASTER_KEY` rend toutes les informations d'identification de source de données
  stockées indéchiffrables, et le renouvellement de `SECRET_KEY_BASE` invalide toutes
  les sessions.
- **Redis est activé par défaut** (`enable_redis = true`) et, avec un `redis_host` vide, la
  fondation injecte l'IP de la VM du serveur NFS comme `REDIS_HOST`
  (`enable_nfs = true` provisionne cette VM).
- **Toujours actif, min=1.** ToolJet exécute un worker d'arrière-plan intégré,
  donc `cpu_always_allocated = true` et `min_instance_count = 1` maintiennent une instance active.
- **L'inscription est désactivée par défaut.** `DISABLE_SIGNUPS = "true"` est activé ; la
  première exécution est un **assistant de configuration** qui crée
  l'utilisateur administrateur initial et l'espace de travail.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que l'interface utilisateur du
  constructeur et tous les webhooks d'application soient accessibles ;
  l'activation d'IAP restreint l'accès aux identités Google.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service ToolJet {#a-cloud-run--the-tooljet-service}

ToolJet s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimum et
maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 — deux bases de données {#b-cloud-sql-for-postgresql-15--two-databases}

ToolJet stocke toutes les données d'application — applications, configurations
de sources de données, utilisateurs, espaces de travail, sessions — dans une
instance gérée de Cloud SQL pour PostgreSQL 15, et utilise une **deuxième base
de données** (`<service_name>_tjdb`) sur la même instance pour la fonctionnalité intégrée
ToolJet Database. Le service se connecte en privé via le **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, un job d'initialisation crée les deux bases de données, le rôle
partagé `CREATEROLE`, l'extension `pgcrypto` et un schéma `postgrest`
appartenant à l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<service_name>_tjdb --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
le renouvellement du mot de passe.

### C. Redis (file d'attente et cache) {#c-redis-queue--cache}

Redis est **activé par défaut** et prend en charge les files d'attente BullMQ
de ToolJet (jobs d'arrière-plan, notifications et éditeur multi-utilisateur).
Lorsque `redis_host` est laissé vide et `enable_nfs = true`, l'IP privée de la VM du
serveur NFS est injectée comme `REDIS_HOST` ; définissez `redis_host`
explicitement pour pointer vers une instance Memorystore à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the injected host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY_BASE` (signe les sessions), `LOCKBOX_MASTER_KEY` (chiffre
toutes les informations d'identification de source de données stockées) et
`PGRST_JWT_SECRET` (signe les JWT PostgREST internes). Le mot de passe de la base de
données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
renouvellement.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC
contrôlent la connectivité. `TOOLJET_HOST` (qui pilote les liens générés et les
URI de redirection OAuth) utilise par défaut l'URL de service calculée et peut
être remplacé via `environment_variables` pour un domaine personnalisé.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Storage et NFS {#f-cloud-storage--nfs}

ToolJet stocke les applications, les configurations de sources de données et les
téléchargements dans PostgreSQL, donc **aucun bucket de données n'est
provisionné**. NFS est activé par défaut uniquement parce que sa VM co-héberge
Redis lorsque `redis_host` est vide ; le conteneur ToolJet lui-même est sans état.

- **Console :** Cloud Storage → Buckets ; Compute Engine → Instances de VM
  (serveur NFS).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application ToolJet {#3-tooljet-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base
  de données de métadonnées et la ToolJet Database, le rôle partagé
  `CREATEROLE`, accorde `cloudsqlsuperuser`, pré-crée `pgcrypto` et
  réinitialise le schéma `postgrest` comme appartenant à l'application. Le
  job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent avant le démarrage du serveur.** `cloud-entrypoint.sh`
  exécute `npm run db:migrate:prod` (TypeORM `migration:run`) en premier. `start:prod`
  de ToolJet est littéralement `node dist/src/main` et ne **migre pas** — sans
  l'étape explicite, la base de données de métadonnées reste vide et chaque
  action basée sur la base de données échoue (`relation "user_sessions" does not exist`). Le budget de la
  sonde de démarrage (30 × 15 s) absorbe cela au premier démarrage.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont immuables
  après le premier démarrage.** La modification de `LOCKBOX_MASTER_KEY` corrompt
  définitivement toutes les informations d'identification de source de données
  stockées ; la modification de `SECRET_KEY_BASE` invalide toutes les sessions. Ne
  les touchez que pendant une fenêtre de maintenance planifiée.
- **La première exécution est un assistant de configuration.** Avec
  `DISABLE_SIGNUPS = "true"`, ouvrez l'URL du service et complétez l'assistant : il crée le
  premier utilisateur administrateur et l'espace de travail, puis vous amène
  dans le constructeur d'applications. Il n'y a pas d'informations
  d'identification d'administrateur pré-remplies dans Secret Manager.
- **La fonctionnalité ToolJet Database.** Les applications peuvent interroger
  une base de données no-code intégrée (`<service_name>_tjdb`) exposée via un
  conteneur sidecar **PostgREST** (`postgrest/postgrest`) dans la même instance Cloud
  Run. Il reconfigure un schéma `postgrest` à chaque démarrage en tant
  qu'utilisateur de l'application — c'est pourquoi `db-init` réinitialise
  ce schéma pour qu'il appartienne à l'application.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de
  disponibilité ciblent `/` — un point de terminaison public non
  authentifié. Prévoyez plusieurs minutes au premier démarrage pour l'étape de
  migration.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
ToolJet sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tooljet` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `ToolJet` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `tooljet/tooljet-ce` ; épingler à une version spécifique en production. |
| `db_name` | `tooljet` | Nom de la base de données de métadonnées. Immuable après le premier déploiement. |
| `db_user` | `tooljet` | Utilisateur de la base de données d'application (partagé par les deux bases de données). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | ToolJet est livré comme une version personnalisée légère sur `tooljet/tooljet-ce`. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `container_resources` | `null` | Objet `{ cpu_limit, memory_limit, cpu_request, mem_request }` structuré ; lorsqu'il est défini, il remplace `cpu_limit`/`memory_limit`. |
| `min_instance_count` | `1` | Maintient le worker intégré actif ; ne pas définir `0` sauf si le worker est externalisé. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `cpu_always_allocated` | `true` | Requis — le worker d'arrière-plan de ToolJet s'exécute sans requête entrante. |
| `container_port` | `80` | ToolJet sert l'API + le client sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image ToolJet dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour l'interface utilisateur du constructeur et les points de terminaison d'application. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ou `PG_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement, pour les valeurs connues au moment de la planification. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; ToolJet lui-même est sans état et ne l'utilise pas. |
| `enable_nfs` | `true` | Activé par défaut ; sa VM co-héberge Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (les deux bases de données + rôle `CREATEROLE`). |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run planifiés. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60 s de délai, 30 × 15 s | Sonde de démarrage. Large budget pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, période de 30 s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | _(défini)_ | Sondes structurées alternatives. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Prend en charge les files d'attente BullMQ de ToolJet. Transmis inchangé. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`), ou définir un point de terminaison Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et audit logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de métadonnées. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour ToolJet). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de l'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> réplica en lecture sans son primaire, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, une `database_type` qui ne
> correspond pas à une extension activée, une `redis_port`/`backup_retention_days` hors
> de portée. Une configuration invalide fait échouer le **plan** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt définitivement toutes les informations d'identification de source de données stockées — elles ne peuvent pas être déchiffrées et doivent toutes être ressaisies. |
| `SECRET_KEY_BASE` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Critique | Le renouveler invalide toutes les sessions actives, forçant une reconnexion immédiate pour tout le monde. |
| `PGRST_JWT_SECRET` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler interrompt la couche de requête de la ToolJet Database jusqu'à ce que chaque instance redémarre et que PostgREST soit reconfiguré. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_file` valide fait échouer le job d'importation. |
| Rôle d'application `CREATEROLE` (défini par `db-init`) | Laisser tel quel | Élevé | Sans cela, la création d'espace de travail ToolJet échoue `permission denied to create role`. |
| Migrations de schéma (point d'entrée) | Laisser tel quel | Élevé | Ignorer `db:migrate:prod` laisse la base de données de métadonnées vide — l'application démarre et répond à la sonde de santé `/` mais chaque action basée sur la base de données échoue. |
| `min_instance_count` | `1` | Élevé | Définir `0` permet au worker d'arrière-plan intégré d'être limité à zéro entre les requêtes, bloquant les jobs en file d'attente. |
| `cpu_always_allocated` | `true` | Élevé | La facturation basée sur les requêtes limite le worker d'arrière-plan entre les requêtes. |
| `memory_limit` | `4Gi` | Élevé | Le serveur ToolJet et son worker peuvent manquer de mémoire en dessous de ~2 GiB sous charge. |
| `ingress_settings` | `all` | Élevé | `internal` bloque l'interface utilisateur du constructeur et tous les rappels d'application externes. |
| `enable_redis` | `true` | Moyen | Avec Redis désactivé, BullMQ se replie et les fonctionnalités d'arrière-plan se dégradent. |
| `redis_host` | `""` (NFS) ou explicite | Moyen | Redis activé mais NFS désactivé et aucun hôte défini laisse `REDIS_HOST` vide. |
| `DISABLE_SIGNUPS` (auto-injecté `"true"`) | Garder activé après le premier administrateur | Élevé | L'ouverture de l'inscription permet à toute personne ayant l'URL de créer un compte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur du constructeur est accessible publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à ToolJet partagée avec la variante GKE est décrite
dans **[ToolJet_Common](ToolJet_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ToolJet sur Cloud Run](../labs/ToolJet_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ToolJet sur GKE Autopilot](ToolJet_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [ToolJet Common — Configuration d'application partagée](ToolJet_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md), [Hasura sur Google Cloud Run](Hasura_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) dans la solution **Outils internes low-code**.
