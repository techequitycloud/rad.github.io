---
title: "RAGFlow sur Google Cloud Run"
description: "Référence de configuration pour déployer RAGFlow sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/RAGFlow_CloudRun.md @ 3055034 sha256:e179307300c8 -->

# RAGFlow sur Google Cloud Run {#ragflow-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/RAGFlow_CloudRun.png" alt="RAGFlow sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

RAGFlow est une plateforme open source d'intelligence documentaire et de génération
augmentée par récupération (RAG, Retrieval-Augmented Generation). Elle ingère des PDF,
des documents Word, des pages HTML et d'autres formats, les découpe et les vectorise,
stocke les vecteurs dans Elasticsearch, expose une API REST de questions-réponses et
fournit une interface web pour la gestion des bases de connaissances et la recherche
d'entreprise. Ce module déploie RAGFlow sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise RAGFlow et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

> **Prérequis de déploiement :** `RAGFlow_CloudRun` exige que `Elasticsearch_GKE` soit
> déployé au préalable. La variable `elasticsearch_hosts` **doit être définie** lorsque
> `deploy_application = true` — le plan est rejeté si elle est vide.

---

## 1. Vue d'ensemble {#1-overview}

RAGFlow s'exécute comme un service Python/Nginx conteneurisé sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service RAGFlow construit sur mesure, 2 vCPU / 4 GiB par défaut, démarrage à froid (`min_instance_count = 0`) par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — RAGFlow ne prend pas en charge PostgreSQL |
| Recherche vectorielle | Elasticsearch (Elasticsearch_GKE) | Dépendance externe — doit être déployée au préalable ; `elasticsearch_hosts` est obligatoire |
| File de tâches | Redis (Memorystore) | Obligatoire pour les workers de traitement des documents |
| Stockage objet | Cloud Storage | Un bucket `ragflow-documents` dédié |
| Secrets | Secret Manager | Mot de passe de base de données généré automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS avec Cloud Armor + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Sélectionner PostgreSQL ou `NONE` empêche le démarrage.
- **`elasticsearch_hosts` est obligatoire.** RAGFlow ne peut ni indexer ni rechercher
  de documents sans point de terminaison Elasticsearch joignable. Cette vérification
  n'est ignorée que lorsque `deploy_application = false`.
- **Redis est obligatoire pour le traitement des documents.** Avec `enable_redis = true`
  (valeur par défaut), `REDIS_HOST` et `REDIS_PORT` sont injectés automatiquement. Si
  `redis_host` est laissé vide, App_CloudRun se rabat sur l'IP du serveur NFS (la VM
  NFS héberge aussi Redis) — même comportement que la variante GKE. Sans Redis
  joignable, les fichiers téléversés restent indéfiniment non traités.
- **Démarrage à froid par défaut.** `min_instance_count = 0` et `cpu_always_allocated = false`
  (facturation à la requête) — le service passe à zéro instance en cas d'inactivité et
  ne facture le CPU que pendant le traitement d'une requête. **Compromis :** l'exécuteur
  de tâches documentaires en arrière-plan s'arrête en cas d'inactivité, de sorte que
  l'ingestion et l'analyse des documents nouvellement téléversés ne s'exécutent pas en
  arrière-plan ; les requêtes et le chat fonctionnent toujours à la demande. Définissez
  `cpu_always_allocated = true` et `min_instance_count >= 1` pour rétablir l'ingestion
  continue en arrière-plan (et éviter le démarrage à froid de 2 à 3 minutes pendant le
  chargement des modèles d'embedding).
- **L'environnement d'exécution Gen2 est obligatoire pour NFS.** `execution_environment = "gen2"`
  est la valeur par défaut ; passer à `gen1` avec `enable_nfs = true` échoue au moment
  du plan.
- **Une image personnalisée est toujours construite.** Cloud Build étend
  `infiniflow/ragflow` à l'aide du Dockerfile de `RAGFlow_Common/scripts/`, avec
  `APP_VERSION` défini à partir de `application_version`.
- **`service_conf.yaml` est généré au démarrage.** Le point d'entrée personnalisé écrit
  `/ragflow/conf/service_conf.yaml` à partir des variables d'environnement injectées
  avant de lancer les processus RAGFlow. Un pont `socat` adapte le socket Unix du
  Cloud SQL Auth Proxy au port TCP qu'attend le client MySQL de RAGFlow.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service RAGFlow {#a-cloud-run--the-ragflow-service}

RAGFlow s'exécute comme un service Cloud Run v2. Par défaut, il passe à zéro instance
en cas d'inactivité (`min_instance_count = 0`, `cpu_always_allocated = false`) ;
modifiez ces deux valeurs pour garder une instance active et éviter les délais de
démarrage à froid pendant le chargement des modèles d'embedding. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

RAGFlow stocke toutes les métadonnées de l'application (comptes utilisateur, bases de
connaissances, état des tâches) dans une instance gérée Cloud SQL for MySQL 8.0. Le
service s'y connecte de manière privée via le sidecar **Cloud SQL Auth Proxy**, par
un socket Unix. Un pont `socat` dans le conteneur fait correspondre ce socket à
`127.0.0.1:3306` pour le client MySQL TCP de RAGFlow. Au premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Elasticsearch — recherche vectorielle {#c-elasticsearch--vector-search}

RAGFlow exige une instance Elasticsearch externe pour l'indexation des documents et
la recherche vectorielle. Déployez `Elasticsearch_GKE` séparément et transmettez son
output `elasticsearch_endpoint` comme `elasticsearch_hosts`. Les variables
d'environnement `ELASTICSEARCH_HOSTS` et `ELASTICSEARCH_USERNAME` sont injectées
automatiquement. Un Elasticsearch inline n'est pas pris en charge sur Cloud Run.

- **Console :** Kubernetes Engine → Workloads → espace de noms Elasticsearch.
- **CLI :**
  ```bash
  # Confirm RAGFlow can reach Elasticsearch (from Cloud Shell or a VPC-connected host):
  curl -s "$ELASTICSEARCH_HOSTS/_cluster/health" | grep status
  ```

### D. Redis — file de tâches {#d-redis--task-queue}

Redis est la colonne vertébrale du pipeline de traitement des documents de RAGFlow.
Les workers interrogent Redis pour récupérer les tâches ; sans lui, les fichiers
téléversés ne sont jamais analysés, découpés ni vectorisés. L'instance Memorystore
Redis est accessible via le VPC grâce au paramètre de sortie VPC
`PRIVATE_RANGES_ONLY` (valeur par défaut).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Cloud Storage {#e-cloud-storage}

Un bucket **Cloud Storage** dédié (`ragflow-documents`) est provisionné pour
l'ingestion et le stockage des documents. Des buckets supplémentaires et des
montages de volumes GCS Fuse peuvent être ajoutés via `storage_buckets` et
`gcs_volumes`. Le compte de service de la charge de travail y reçoit automatiquement
l'accès.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<documents-bucket>/     # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### F. Secret Manager {#f-secret-manager}

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

### G. Réseau et entrée {#g-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec le WAF Cloud Armor, un domaine personnalisé et Cloud CDN peut être
ajouté. La sortie VPC est définie par défaut sur `PRIVATE_RANGES_ONLY`, de sorte que
le trafic Redis et MySQL transite par le VPC privé tandis que la sortie publique
reste sans restriction.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL, vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application RAGFlow {#3-ragflow-application-behaviour}

- **Initialisation de la base de données au premier déploiement.** Un Cloud Run Job
  d'initialisation (`mysql:8.0-debian`) crée la base de données RAGFlow (`rag_flow`)
  et l'utilisateur (`ragflow`) avant le démarrage du service. Il est idempotent et
  peut être relancé sans risque.
- **`service_conf.yaml` généré au démarrage.** Le point d'entrée personnalisé génère
  `/ragflow/conf/service_conf.yaml` à partir des variables d'environnement injectées —
  notamment l'hôte, l'utilisateur et la base de données MySQL, le point de terminaison
  Elasticsearch, l'hôte et le port Redis, ainsi que des identifiants facultatifs —
  avant de lancer les processus RAGFlow. Un pont `socat` adapte le socket Unix du
  Cloud SQL Auth Proxy à `127.0.0.1:3306` pour le client MySQL de RAGFlow.
- **Pipeline de traitement des documents.** Les documents téléversés sont mis en file
  d'attente dans Redis et traités de manière asynchrone par les workers documentaires
  de RAGFlow : OCR, découpage, vectorisation et indexation dans Elasticsearch. Sans
  Redis ni Elasticsearch joignables, les fichiers semblent téléversés mais ne sont
  jamais traités.
- **Chargement des modèles d'embedding au démarrage.** RAGFlow télécharge et charge
  les modèles d'embedding lors du premier démarrage. La sonde de démarrage cible
  `/v1/system/version` avec un délai initial de 120 secondes et 30 tentatives en cas
  d'échec. Définissez `min_instance_count >= 1` avec
  `cpu_always_allocated = true` pour éviter les démarrages à froid et maintenir le
  traitement des documents en arrière-plan en continu.
- **Points de terminaison de santé.** Les sondes de démarrage et de vivacité utilisent
  `/v1/system/version`. Le test de disponibilité (s'il est activé) cible
  `/v1/health`. Ces points de terminaison ne renvoient HTTP 200 que lorsque
  l'application est entièrement initialisée.

  Inspecter les exécutions de jobs :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à RAGFlow ou notables pour
lui sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `elasticsearch_hosts` | _(obligatoire)_ | Point de terminaison HTTP d'Elasticsearch (p. ex. `http://10.0.0.5:9200`). À définir sur l'output `elasticsearch_endpoint` de `Elasticsearch_GKE`. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ragflow` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `RAGFlow` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `v0.13.0` | Tag de version de l'image RAGFlow, transmis comme `APP_VERSION` à Cloud Build ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 4 vCPU ou plus recommandés pour le traitement des documents en production. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 8 à 16 GiB recommandés en production. |
| `cpu_always_allocated` | `false` | Valeur par défaut privilégiant le coût, avec démarrage à froid. `true` rétablit le traitement continu des documents en arrière-plan entre les requêtes. |
| `min_instance_count` | `0` | Passe à zéro instance en cas d'inactivité. Définissez ≥ 1 (avec `cpu_always_allocated = true`) pour garder l'exécuteur de tâches en arrière-plan et les modèles d'embedding actifs. |
| `max_instance_count` | `1` | Nombre maximal d'instances ; augmentez-le avec prudence (nécessite NFS pour le stockage partagé). |
| `container_port` | `80` | Le frontend Nginx de RAGFlow écoute sur le port 80. |
| `execution_environment` | `gen2` | **Doit rester `gen2`** — obligatoire pour les montages NFS. |
| `timeout_seconds` | `600` | Augmentez-le pour les requêtes de traitement de documents volumineux (max. 3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service (`all`, `internal`, `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine le trafic privé RFC-1918 (Redis, MySQL) via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne surchargez pas `MYSQL_*`, `ELASTICSEARCH_*` ni `REDIS_*` — ces variables sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, CDN et domaine personnalisé {#group-10--cloud-armor-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle WAF Cloud Armor via un équilibreur de charge HTTPS global. |
| `admin_ip_ranges` | `[]` | CIDR bénéficiant d'un accès privilégié. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. Le bucket `ragflow-documents` est toujours créé. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Configurations de buckets GCS supplémentaires. |
| `enable_nfs` | `true` | Volume Filestore partagé. Obligatoire pour les déploiements multi-instances et lorsque `redis_host` est vide (l'IP du serveur NFS sert alors d'hôte Redis de repli). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse montés dans le conteneur RAGFlow. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `db_name` | `rag_flow` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `ragflow` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivée | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le Cloud Run Job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Run Jobs planifiés récurrents. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/v1/system/version`, délai de 120s, 30 tentatives | Laisse amplement le temps de charger les modèles d'embedding au premier démarrage. |
| `liveness_probe` | HTTP `/v1/system/version`, délai de 120s | Sonde de vivacité une fois le démarrage réussi. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 15 — Elasticsearch et Redis {#group-15--elasticsearch--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour la file de tâches de traitement des documents. Transmise de manière inconditionnelle à App_CloudRun — Redis est câblé que `redis_host` soit défini ou laissé vide. |
| `redis_host` | `""` | Point de terminaison Redis. S'il est laissé vide, App_CloudRun injecte `REDIS_HOST = <NFS server IP>` comme repli (comportement identique à la variante GKE, puisque la VM NFS héberge aussi Redis). Définissez-le explicitement pour pointer vers une autre instance Redis (p. ex. Memorystore). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch. Laissez vide lorsque `xpack.security.enabled = false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (exige `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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
| `elasticsearch_hosts` | obligatoire — à définir depuis `Elasticsearch_GKE` | Critique | RAGFlow ne peut ni indexer ni rechercher ; toutes les opérations d'ingestion et de récupération échouent. Le plan est rejeté si la valeur est vide et que `deploy_application = true`. |
| `enable_redis` | `true` | Critique | Sans Redis, la file de traitement des documents ne s'exécute jamais ; les fichiers téléversés restent indéfiniment non traités. |
| `database_type` | `MYSQL_8_0` | Critique | RAGFlow exige MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | RAGFlow se connecte via un socket Unix relié en TCP par socat ; désactiver le sidecar du proxy provoque un échec de connexion à la base de données au démarrage. |
| `db_name` / `db_user` | à définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données ou l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `redis_host` | laisser vide pour utiliser le repli Redis du serveur NFS, ou définir une IP Memorystore explicite | Élevé | Lorsque `redis_host = ""` et `enable_redis = true`, App_CloudRun injecte `REDIS_HOST = <NFS server IP>` (exige `enable_nfs = true`, la valeur par défaut) — comme la variante GKE. Si NFS est désactivé et que `redis_host` est laissé vide, aucun hôte Redis n'est injecté et les workers documentaires asynchrones ne s'exécutent jamais, sans aucun message. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` pour une ingestion continue | Élevé | Les valeurs par défaut sont `0` / `false` (démarrage à froid) : le traitement des documents en arrière-plan s'arrête en cas d'inactivité et les démarrages à froid prennent 2 à 3 minutes. Définissez les deux pour une ingestion permanente. |
| `memory_limit` | `4Gi` (≥ `8Gi` en production) | Élevé | Les modèles d'embedding et le serveur applicatif exigent beaucoup de RAM ; une valeur trop faible provoque des arrêts pour manque de mémoire (OOM). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Élevé | Memorystore Redis utilise une IP VPC privée ; un mauvais routage de sortie casse la file de tâches. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS exigent gen2 ; passer à gen1 avec `enable_nfs = true` échoue au moment du plan. |
| `elasticsearch_username` | `""` ou l'utilisateur correct | Élevé | Si la sécurité Elasticsearch est activée, laisser ce champ vide provoque des erreurs HTTP 401 et casse toute l'indexation. |
| `enable_nfs` | `true` | Élevé | Les déploiements multi-instances sans stockage partagé présentent des vues incohérentes des documents d'une instance à l'autre. |
| `ingress_settings` / `enable_iap` | à restreindre en production | Élevé | Une entrée publique sans IAP expose RAGFlow à des appelants non authentifiés. |
| `max_instance_count` | `1` (à augmenter uniquement avec NFS) | Moyen | Dépasser 1 sans NFS provoque un accès aux documents en « split-brain » entre les instances. |
| `timeout_seconds` | `600` | Moyen | Le téléversement de documents volumineux peut prendre plusieurs minutes ; une valeur trop courte provoque des erreurs 504 avant la fin du traitement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `application_version` | `v0.13.0` | Moyen | L'incrémenter déclenche une reconstruction de l'image et le déploiement d'une nouvelle révision ; vérifiez la compatibilité du schéma MySQL lors des changements de version majeure. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à RAGFlow, partagée avec la variante GKE, est décrite dans
**[RAGFlow_Common](RAGFlow_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : RAGFlow sur Cloud Run](../labs/RAGFlow_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [RAGFlow sur GKE Autopilot](RAGFlow_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [RAGFlow Common — Configuration applicative partagée](RAGFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
