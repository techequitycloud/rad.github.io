---
title: "LangFlow sur Google Cloud Run"
description: "Référence de configuration pour déployer LangFlow sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LangFlow_CloudRun.md @ 3055034 sha256:f2205fcf42af -->

# LangFlow sur Google Cloud Run {#langflow-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LangFlow_CloudRun.png" alt="LangFlow sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LangFlow est un outil visuel open source et low-code de création d'agents et de
workflows d'IA, basé sur LangChain — vous assemblez des chaînes de modèles de
langage, des pipelines RAG et des agents en glissant et en reliant des composants
sur un canevas, puis vous les exposez sous forme d'API. Ce module déploie LangFlow
sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LangFlow et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LangFlow s'exécute dans un conteneur Python unique (FastAPI + React) sur Cloud Run
v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python sur le port **7860**, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — LangFlow conserve l'ensemble des flux, composants et identifiants dans Postgres |
| Stockage d'objets | Cloud Storage | Un bucket `data` est provisionné par défaut (`storage_buckets`) mais n'est pas monté (`gcs_volumes = []`) — LangFlow conserve tout l'état applicatif dans PostgreSQL |
| Cache et file d'attente | Redis (facultatif) | Non requis par LangFlow ; câblé uniquement par souci de compatibilité future |
| Secrets | Secret Manager | `LANGFLOW_SECRET_KEY` et `LANGFLOW_SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  couche applicative partagée (`database_type = "POSTGRES_15"`) ; choisir un autre
  moteur empêche le démarrage.
- **`LANGFLOW_SECRET_KEY` est généré automatiquement** et stocké dans Secret
  Manager. Il chiffre chaque identifiant stocké intégré dans un flux. Il ne doit
  jamais faire l'objet d'une rotation après le premier démarrage — sa rotation casse
  définitivement tous les identifiants stockés, qu'il faut alors ressaisir dans
  chaque flux.
- **Le compte administrateur est provisionné à partir d'un mot de passe généré.**
  `LANGFLOW_AUTO_LOGIN = "false"` active l'authentification ; LangFlow crée
  l'administrateur initial (`admin` par défaut) à l'aide du secret
  `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez-le dans Secret Manager pour vous
  connecter.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent plusieurs secondes de latence — plus les migrations
  Alembic du premier démarrage sur une instance neuve. Définissez
  `min_instance_count = 1` pour garder le canevas actif lors de l'édition
  interactive.
- **`max_instance_count = 1` par défaut.** LangFlow conserve un état de session et
  de flux en mémoire de processus ; exécutez une seule instance, sauf si vous avez
  externalisé l'état et en comprenez les implications.
- **Entrée publique par défaut.** `ingress_settings = "all"` expose l'URL
  `run.app`. Activer IAP place la connexion Google devant l'ensemble du service, y
  compris son API.
- **Pas de NFS, et le bucket GCS par défaut n'est pas monté.** Tout l'état
  applicatif réside dans PostgreSQL ; NFS est désactivé par défaut, et le bucket
  `data` provisionné automatiquement n'est pas monté dans le conteneur
  (`gcs_volumes = []`) — il n'existe que pour que vous le branchiez si un composant
  personnalisé a besoin de stockage d'objets.
- **`LANGFLOW_DATABASE_URL` est composé à l'exécution** par le point d'entrée du
  conteneur à partir des variables `DB_*` injectées (DSN TCP, `sslmode=require` sur
  Cloud Run) — vous n'avez pas à le définir vous-même.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service LangFlow {#a-cloud-run--the-langflow-service}

LangFlow s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~langflow"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

LangFlow stocke toutes les données applicatives (flux, composants, identifiants,
historique d'exécution, utilisateurs) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de façon privée via l'**IP privée** de
l'instance (le point d'entrée compose un DSN TCP avec `sslmode=require`) ; le socket
Unix du Cloud SQL Auth Proxy est également monté. Au premier déploiement, un job
d'initialisation crée la base de données applicative, le rôle et les droits.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~langflow"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis (facultatif — non utilisé par LangFlow) {#c-redis-optional--not-used-by-langflow}

Redis est **désactivé par défaut** et LangFlow n'en a pas besoin ; les entrées
`enable_redis` sont câblées uniquement par souci de compatibilité future. Laissez
`enable_redis = false`, sauf si une fonctionnalité future le requiert.

- **CLI (uniquement s'il est activé) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`LANGFLOW_SECRET_KEY` (chiffre tous les identifiants stockés) et
`LANGFLOW_SUPERUSER_PASSWORD` (le mot de passe de connexion de l'administrateur
initial). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~langflow"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LangFlow {#3-langflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) exécute le script générique `db-init.sh` du socle à
  l'aide de `postgres:15-alpine`. Il attend PostgreSQL, puis crée de manière
  idempotente le rôle applicatif et la base de données, définit le propriétaire et
  accorde les privilèges sur la base. Il peut être relancé sans risque.
- **Migrations de schéma au démarrage.** LangFlow exécute ses **migrations Alembic à
  chaque démarrage du conteneur** ; les tables sont donc créées et mises à niveau par
  l'application elle-même — le job `db-init` ne gère que le rôle, la base et les
  droits. Prévoyez un délai supplémentaire au premier démarrage.
- **`LANGFLOW_SECRET_KEY` est immuable après le premier démarrage.** Il est généré
  une seule fois et écrit dans Secret Manager. Le modifier casse définitivement
  chaque identifiant stocké intégré dans un flux ; ceux-ci ne peuvent plus être
  déchiffrés. Ne procédez à une rotation que pendant une fenêtre de maintenance
  planifiée, avec un plan de ressaisie des identifiants.
- **Compte administrateur initial.** Avec `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow
  crée le superutilisateur (`admin` par défaut, défini via `langflow_username`) à
  l'aide du secret `LANGFLOW_SUPERUSER_PASSWORD`. Récupérez le mot de passe et
  connectez-vous :
  ```bash
  gcloud secrets versions access latest \
    --secret=<langflow-password-secret> --project "$PROJECT"
  ```
- **L'URL de la base de données est composée à l'exécution.** Le point d'entrée
  construit `LANGFLOW_DATABASE_URL` à partir des variables `DB_*` injectées, via TCP
  (`DB_IP`, `sslmode=require` sur Cloud Run) — ne la définissez pas manuellement, sauf
  si vous voulez remplacer l'intégralité du DSN.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent **`/health`**,
  le point de terminaison public de vivacité de LangFlow, qui renvoie `200` dès que le
  serveur est opérationnel. La sonde de démarrage par défaut accorde un délai initial
  de 60 secondes plus une fenêtre d'échec de 60 × 10 s (600 s) pour couvrir le
  chargement des composants et les migrations Alembic du premier démarrage.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à LangFlow ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `langflow` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `LangFlow` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image LangFlow ; épingle l'image de base `1.10.2` lorsque la valeur est `latest`. Épinglez explicitement en production. |
| `langflow_username` | `admin` | Nom d'utilisateur du superutilisateur initial (administrateur) ; le mot de passe est généré automatiquement dans Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | LangFlow est construit à partir de l'image encapsulée via Cloud Build. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; gardez ≥ 1 GiB pour l'environnement d'exécution Python. |
| `min_instance_count` | `0` | `0` active la mise à zéro ; définissez `1` pour garder le canevas actif. |
| `max_instance_count` | `1` | Gardez `1` — LangFlow conserve un état en mémoire de processus. |
| `container_port` | `7860` | LangFlow écoute sur le port 7860. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS/GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Montage du socket du Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image du conteneur dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` expose l'URL publique `run.app`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant l'ensemble du service. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés par-dessus les valeurs par défaut de LangFlow. Ne définissez pas ici `LANGFLOW_SECRET_KEY`, `LANGFLOW_SUPERUSER_PASSWORD` ni `LANGFLOW_DATABASE_URL`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple, clés d'API de fournisseurs de LLM). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques Cloud SQL (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et initialisation {#group-9--custom-sql-scripts--initialization}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; complétez la liste pour des composants personnalisés. |
| `enable_nfs` | `false` | NFS est désactivé par défaut ; LangFlow conserve son état dans PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (lorsque NFS est activé). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — LangFlow requiert PostgreSQL 15. |
| `application_database_name` | `langflowdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `langflowuser` | Utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions Postgres facultatives. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[{ name = "db-init", image = "postgres:15-alpine", script_path = "scripts/db-init.sh", execute_on_apply = true }]` | Job intégré qui crée le rôle applicatif, la base de données et les droits au premier déploiement. Remplacez-le par une liste non vide pour exécuter d'autres jobs. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés (aucun n'est requis par LangFlow). |
| `additional_services` | `[]` | Services sidecar/auxiliaires déployés aux côtés de LangFlow. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 60 s, fenêtre d'échec de 60 × 10 s | Sonde de démarrage. La fenêtre généreuse de 600 s au-delà du délai de 60 s tient compte du premier démarrage de LangFlow (chargement de tous les composants + création des projets de démarrage avant que uvicorn n'écoute — 2 à 4 minutes) ainsi que des migrations Alembic du premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30 s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health`, activée | Sonde structurée au niveau d'App_CloudRun (parallèle à `startup_probe`, qui est transmise à LangFlow_Common). |
| `health_check_config` | HTTP `/health`, activée | Sonde de vivacité structurée au niveau d'App_CloudRun (parallèle à `liveness_probe`). |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring ; activez-la pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis (facultatif) {#group-21--redis-cache-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par LangFlow ; câblé uniquement par souci de compatibilité future. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Paramètres de connexion Redis (uniquement s'il est activé). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

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
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage, et plus encore. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LANGFLOW_SECRET_KEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Sa rotation casse définitivement chaque identifiant stocké intégré dans un flux — ceux-ci ne peuvent plus être déchiffrés et doivent être ressaisis. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base et l'utilisateur et détruit tous les flux et identifiants. |
| `database_type` | `POSTGRES_15` | Critique | LangFlow requiert PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans source de sauvegarde valide fait échouer le job d'importation. |
| `LANGFLOW_SUPERUSER_PASSWORD` (généré automatiquement) | Le récupérer dans Secret Manager | Élevé | C'est l'identifiant de connexion de l'administrateur ; le perdre signifie qu'il est impossible de se connecter tant qu'il n'est pas réinitialisé. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1 GiB exposent l'environnement d'exécution Python à des arrêts OOM sous charge. |
| `max_instance_count` | `1` | Élevé | LangFlow conserve un état de session et de flux en mémoire de processus ; dépasser 1 répartit l'état entre les instances et provoque un comportement incohérent. |
| `enable_iap` | uniquement lorsque l'authentification de l'API n'est pas nécessaire depuis l'extérieur | Élevé | IAP place la connexion Google devant l'ensemble du service, y compris son API programmatique. |
| `container_port` | `7860` | Élevé | LangFlow écoute sur 7860 ; un port différent fait échouer toutes les sondes de santé. |
| `min_instance_count` | `1` pour un usage interactif | Moyen | La mise à zéro (`0`) ajoute la latence du démarrage à froid plus la durée des migrations du premier démarrage sur une instance neuve. |
| `enable_cloudsql_volume` | `true` | Moyen | Le désactiver supprime le montage du socket ; le point d'entrée ne s'appuie alors plus que sur le chemin TCP via l'IP privée. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface et l'API sont joignables publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et construction des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à LangFlow partagée avec la variante GKE est décrite dans
**[LangFlow_Common](LangFlow_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LangFlow sur Cloud Run](../labs/LangFlow_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LangFlow sur GKE Autopilot](LangFlow_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [LangFlow Common — Configuration applicative partagée](LangFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
