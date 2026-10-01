---
title: "OpenProject sur Google Cloud Run"
description: "Référence de configuration pour déployer OpenProject sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenProject_CloudRun.md @ 3055034 sha256:2e6cb986b5da -->

# OpenProject sur Google Cloud Run {#openproject-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_CloudRun.png" alt="OpenProject sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject est une suite open source, sous licence GPLv3, de gestion de projet et de
collaboration d'équipe — lots de travaux, diagrammes de Gantt, tableaux agiles, wikis,
suivi du temps et budgets. Ce module déploie OpenProject sur **Cloud Run v2** au-dessus du
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise OpenProject et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
ingress et équilibrage de charge, dimensionnement et concurrence, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenProject s'exécute comme un conteneur Ruby on Rails (Puma) sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Rails/Puma, 2 vCPU / 4 GiB par défaut, CPU toujours alloué |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — OpenProject ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage des pièces jointes | Cloud Filestore (NFS) | Stockage durable des pièces jointes des lots de travaux, monté sur `/opt/openproject/storage` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` généré automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |
| Jobs en arrière-plan | good_job (dans le processus, sur PostgreSQL) | Pas de Redis — la file d'attente des jobs réside dans PostgreSQL |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la couche
  applicative partagée ; sélectionner un autre moteur empêche le démarrage.
- **Connexion TCP à la base de données par adresse IP privée.** `enable_cloudsql_volume = false`
  sur Cloud Run. OpenProject (Rails) lit une unique `DATABASE_URL` sous forme d'URL, et
  l'analyseur `URI` de Ruby ne peut pas contenir le répertoire du socket Unix de Cloud SQL
  (ses deux-points cassent l'analyse de l'URL) ; le point d'entrée se connecte donc via
  l'adresse IP privée de l'instance avec `sslmode=require`.
- **Pas de Redis.** Les jobs en arrière-plan s'exécutent via `good_job` avec la file
  d'attente dans PostgreSQL (`GOOD_JOB_EXECUTION_MODE = async`) ; `enable_redis` est
  transmis à `false`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il ne
  doit jamais faire l'objet d'une rotation après le premier démarrage — sa rotation rend
  illisibles toutes les sessions existantes et toutes les colonnes chiffrées de la base de
  données.
- **Le CPU est toujours alloué** (`cpu_always_allocated = true`, `min_instance_count = 1`)
  car le worker `good_job` dans le processus et le planificateur cron doivent continuer à
  tourner sans requête entrante. Cela empêche par conception la réduction à zéro ; voir le
  tableau des pièges pour le retour en arrière privilégiant les coûts.
- **Les migrations s'exécutent dans un job `db-migrate`, pas au démarrage.** Le service
  s'exécute en mode web uniquement (`./docker/prod/web`) ; un job dédié exécuté au moment
  de l'apply lance d'abord `rake db:migrate db:seed`, de sorte que le conteneur web démarre
  rapidement sur un schéma déjà migré.
- **Les sondes de santé sont en TCP / désactivées.** Le Host Authorization de Rails 8
  renvoie `400` à toute sonde HTTP dont l'en-tête `Host` est l'adresse IP du pod ; la sonde
  de démarrage est donc en TCP et la sonde de vivacité est désactivée.
- **La première connexion se fait avec `admin` / `admin`.** OpenProject impose un
  changement de mot de passe à la première connexion — faites-le immédiatement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service
et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenProject {#a-cloud-run--the-openproject-service}

OpenProject s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la
charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le dimensionnement, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OpenProject stocke toutes les données de l'application (projets, lots de travaux, wikis,
utilisateurs, métadonnées des pièces jointes) dans une instance gérée Cloud SQL for
PostgreSQL 15. Sur Cloud Run, le service se connecte via l'**adresse IP privée de
l'instance avec `sslmode=require`** (et non via le socket de l'Auth Proxy — l'analyseur de
DSN sous forme d'URL de Ruby ne peut pas contenir le répertoire du socket). Lors du premier
déploiement, le job `db-init` crée la base de données et l'utilisateur, et le job
`db-migrate` exécute `rake db:migrate db:seed` pour construire le schéma et créer le compte
administrateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (stockage NFS des pièces jointes) {#c-cloud-filestore-nfs-attachment-storage}

Les pièces jointes des lots de travaux sont stockées sur un partage NFS **Cloud
Filestore** monté sur `/opt/openproject/storage` (`enable_nfs = true` par défaut). Sans
lui, les pièces jointes atterrissent sur le disque éphémère du conteneur et sont perdues à
chaque révision/redéploiement.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Pour utiliser à la place un stockage d'objets compatible GCS, définissez les variables
d'environnement `OPENPROJECT_FOG_*`. Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de serveur NFS.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`SECRET_KEY_BASE` (signature des sessions/cookies Rails et dérivation de la clé des
colonnes chiffrées). Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les
paramètres d'ingress et l'egress VPC contrôlent la connectivité. OpenProject construit les
URL absolues à partir de `OPENPROJECT_HOST__NAME` (défini par le point d'entrée) et de
`OPENPROJECT_HTTPS = true`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques de Cloud Run et
de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenProject {#3-openproject-application-behaviour}

- **Configuration de la base de données en deux phases au premier déploiement.** Le job
  `db-init` (`postgres:15-alpine`) crée le rôle et la base de données ; le job
  `db-migrate` exécute ensuite l'image de l'application avec `rake db:migrate db:seed`. Le
  job de migration supprime les éventuelles tables partielles laissées par une tentative
  précédente interrompue (`DROP OWNED BY CURRENT_USER CASCADE`) avant de migrer, et crée
  l'extension `pg_trgm` nécessaire aux index trigrammes d'OpenProject. Les deux jobs
  s'exécutent au moment de l'apply.
- **Les migrations ne s'exécutent pas au démarrage.** Le service s'exécute en mode web
  uniquement (`./docker/prod/web`), ce qui ignore le seeder tout-en-un. Rails (en
  production) refuse de démarrer Puma tant que des migrations sont en attente ; si
  `db-migrate` échoue, la création du service échoue donc de manière visible — aucune mise
  en production silencieuse avec une base de données vide.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une seule
  fois et stocké dans Secret Manager. Le modifier rend illisibles les sessions existantes et
  toutes les colonnes chiffrées. N'effectuez de rotation que pendant une fenêtre de
  maintenance planifiée, avec un plan complet de rechiffrement des données.
- **Les jobs en arrière-plan s'exécutent dans le processus.** `good_job` exécute son worker
  et son cron dans le conteneur web (`GOOD_JOB_EXECUTION_MODE = async`) avec la file
  d'attente sur PostgreSQL — sans Redis. C'est pourquoi le CPU est toujours alloué par
  défaut.
- **Le Host Authorization filtre les sondes de santé.** Rails 8 renvoie
  `400 Invalid host_name` à toute requête dont l'en-tête `Host` n'est pas
  `OPENPROJECT_HOST__NAME`, y compris les sondes de santé HTTP (qui utilisent l'adresse IP
  du pod). La sonde de démarrage est donc en TCP et la sonde de vivacité est désactivée ;
  la sonde de disponibilité (readiness) interroge `/health_checks/default`, où la plateforme définit
  correctement le `Host`.
- **La première connexion se fait avec `admin` / `admin`.** Ce compte est créé par
  `rake db:seed`. OpenProject impose un changement de mot de passe à la première connexion.
- **Inspectez l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à OpenProject ou notables pour lui sont listés ;
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
| `application_name` | `openproject` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `OpenProject` | Nom lisible affiché dans la console. |
| `description` | _(définie)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image OpenProject (`OPENPROJECT_VERSION`). `latest` est épinglé sur la version majeure stable `16` ; OpenProject ne publie que des tags de version majeure numériques. |
| `db_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openproject` | Utilisateur de la base de données de l'application. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Rails a besoin de marge pour les migrations et les workers. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué afin que le worker `good_job` dans le processus et le cron s'exécutent sans requêtes entrantes. |
| `min_instance_count` | `1` | Maintient une instance active pour les jobs en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `8080` | Port d'écoute par défaut de Puma ; le module exécute `./docker/prod/web` (Puma directement), en contournant le proxy Apache de l'image tout-en-un sur le port 80. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Désactivé sur Cloud Run** — OpenProject se connecte en TCP via l'adresse IP privée. |
| `enable_image_mirroring` | `true` | Met en miroir l'image OpenProject dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour l'accès par navigateur et par API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple des remplacements `OPENPROJECT_*`). Ne définissez pas `SECRET_KEY_BASE` ni `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS provisionnés par défaut ; ajoutez-en d'autres selon vos besoins. |
| `enable_nfs` | `true` | Cloud Filestore pour un stockage durable des pièces jointes. |
| `nfs_mount_path` | `/opt/openproject/storage` | Chemin des pièces jointes d'OpenProject dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openproject` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` + `db-migrate`. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs facultatifs (par exemple un point de terminaison cron externe si vous passez au démarrage à froid). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, délai de 30s, fenêtre de 30 × 15s | TCP car le Host Authorization de Rails renvoie `400` aux sondes HTTP ; vérifie que Puma écoute. |
| `liveness_probe` | **désactivée** | Cloud Run ne propose pas de sonde de vivacité TCP ; une sonde HTTP ferait redémarrer en boucle un conteneur sain. |
| `startup_probe_config` | HTTP `/`, activée, délai de 60s, failure_threshold 30 | Sonde structurée au niveau d'App_CloudRun (parallèle à `startup_probe`, qui est celle qui conditionne réellement le conteneur). |
| `health_check_config` | HTTP `/`, activée, délai de 60s, failure_threshold 3 | Sonde de vivacité structurée au niveau d'App_CloudRun (parallèle à `liveness_probe`, qui est désactivée sur le conteneur). |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring ; à activer pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
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
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `db-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (> service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (> mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `backup_retention_days` hors limites. Une configuration non valide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation rend illisibles toutes les sessions existantes et toutes les colonnes chiffrées de la base de données. |
| `db_name` / `db_user` | Définis une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Le désactiver place les pièces jointes sur un disque éphémère — elles sont perdues à chaque révision/redéploiement. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_cloudsql_volume` | `false` sur Cloud Run | Élevé | Activer le socket rend le DSN sous forme d'URL de Rails impossible à analyser (les deux-points du socket cassent l'URL) ; l'application ne parvient pas à se connecter. |
| `startup_probe.type` | `TCP` | Élevé | Une sonde de démarrage HTTP se heurte au Host Authorization de Rails (`400 Invalid host_name`) et ne réussit jamais — la révision ne devient jamais Ready alors que Puma est sain. |
| `liveness_probe.enabled` | `false` | Élevé | Une sonde de vivacité HTTP reçoit `400` du Host Authorization et fait redémarrer en boucle un conteneur sain. |
| `memory_limit` | `4Gi` | Élevé | Les migrations et les workers dans le processus subissent des arrêts OOM en dessous d'environ 2 GiB. |
| `cpu_always_allocated` | `true` | Moyen | Définir `false` réduit le worker/cron `good_job` à environ 0 entre les requêtes — les e-mails et notifications en arrière-plan sont bloqués. Ne revenez en arrière qu'avec un point de terminaison cron externe Cloud Scheduler. |
| `application_version` | Épingler une version majeure (`16`) | Moyen | `latest` n'a pas de tag d'image sur Docker Hub ; le module l'épingle sur `16`. Épinglez explicitement une version pour maîtriser les mises à niveau. |
| `min_instance_count` | `1` | Moyen | Ne définissez `0` qu'en association avec `cpu_always_allocated = false` et un cron externe — sinon les jobs en arrière-plan s'arrêtent entre les requêtes. |
| `enable_iap` | selon les besoins | Moyen | IAP bloque tout accès non authentifié, y compris à l'API ; ne l'activez que si c'est l'effet recherché. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention conforme. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, dimensionnement et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
OpenProject partagée avec la variante GKE est décrite dans
**[OpenProject_Common](OpenProject_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenProject sur Cloud Run](../labs/OpenProject_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OpenProject sur GKE Autopilot](OpenProject_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenProject Common — Configuration applicative partagée](OpenProject_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Documenso sur Google Cloud Run](Documenso_CloudRun.md) et [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
