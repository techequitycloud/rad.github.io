---
title: "Matomo sur Google Cloud Run"
description: "Référence de configuration pour déployer Matomo sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Matomo_CloudRun.md @ 3055034 sha256:2dea23384be1 -->

# Matomo sur Google Cloud Run {#matomo-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Matomo_CloudRun.png" alt="Matomo sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Matomo est la principale plateforme open source d'analyse web — une alternative auto-hébergée et respectueuse de la vie privée à Google Analytics, utilisée par plus d'un million de sites web. Ce module déploie Matomo sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Matomo et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Matomo s'exécute sous forme de conteneur PHP/Apache (l'image officielle `matomo:5-apache`) sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Matomo ne prend en charge que MySQL/MariaDB |
| Fichiers partagés | Filestore (NFS) | Rend persistante la racine documentaire de Matomo `/var/www/html` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket dédié `matomo-data` provisionné automatiquement |
| Cache | Redis | Activé par défaut ; se rabat sur l'adresse IP de l'hôte NFS lorsqu'aucun hôte Redis n'est fourni |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Matomo exige MySQL/MariaDB ; PostgreSQL n'est pas pris en charge.
- **L'image officielle précompilée est déployée directement.** `container_image_source = "prebuilt"` signifie qu'il n'y a pas d'étape Cloud Build — l'image `matomo:<application_version>` est mise en miroir dans Artifact Registry (pour éviter les limites de débit de Docker Hub) et déployée telle quelle.
- **La connexion à la base de données passe par TCP sur le VPC, et non par un socket.** `enable_cloudsql_volume = false` par défaut : le socle injecte l'adresse IP privée de l'instance Cloud SQL dans `MATOMO_DATABASE_HOST`, et le client PHP de Matomo se connecte directement via le réseau privé. Il n'y a pas de sidecar de socket Auth Proxy.
- **Les variables d'environnement `MATOMO_DATABASE_*` préremplissent l'installateur.** L'hôte, le nom d'utilisateur, le nom de la base de données et le mot de passe sont injectés par le socle ; `MATOMO_DATABASE_ADAPTER=mysql` et `MATOMO_DATABASE_TABLES_PREFIX=matomo_` sont définis par `Matomo_Common`.
- **NFS rend persistante la racine documentaire.** `nfs_mount_path` vaut par défaut `/var/www/html`, où Matomo conserve `config.ini.php`, les plugins installés et les ressources générées. Le point d'entrée de l'image remplit un volume vide à partir de `/usr/src/matomo` au premier démarrage.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données MySQL et l'utilisateur de Matomo.
- **Mise à l'échelle jusqu'à zéro par défaut.** `min_instance_count = 0` et `max_instance_count = 1` ; les démarrages à froid prennent de 10 à 30 secondes. Définissez `min_instance_count = 1` pour une production toujours active.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager. Matomo n'a aucun autre secret applicatif.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Matomo {#a-cloud-run--the-matomo-service}

Matomo s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Matomo stocke toutes les données d'analyse (visites, rapports, utilisateurs, configuration des sites) dans une instance gérée Cloud SQL for MySQL 8.0. Le service se connecte via l'**adresse IP privée** de l'instance à travers le VPC (pas d'adresse IP publique, pas de socket de proxy) : le socle injecte l'adresse IP privée dans `MATOMO_DATABASE_HOST`. Lors du premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

La racine documentaire de Matomo `/var/www/html` — configuration (`config.ini.php`), plugins installés et ressources générées — est écrite sur un partage **Filestore (NFS)** monté dans le service, afin de survivre aux redémarrages et aux remontées depuis zéro. Un bucket **Cloud Storage** dédié (`matomo-data`) est également provisionné automatiquement. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis sert de cache d'objets à Matomo, ce qui réduit la charge de la base de données et améliore les temps de chargement des pages. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans le service à l'exécution sous la forme `MATOMO_DATABASE_PASSWORD` ; il n'apparaît jamais en clair dans la configuration. Matomo ne nécessite aucun autre secret applicatif.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité. L'extrait de suivi que vous intégrez dans vos sites web pointe vers cette URL (ou vers votre domaine personnalisé).

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Matomo {#3-matomo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (image `mysql:8.0-debian`) se connecte à Cloud SQL — en privilégiant le socket Unix de l'Auth Proxy lorsqu'il est monté, et sinon via une connexion TCP sur l'adresse IP privée — puis crée de manière idempotente la base de données Matomo, crée l'utilisateur de l'application et lui accorde tous les privilèges. Il vérifie également que l'utilisateur de l'application peut se connecter, ce qui permet à la fois de détecter tôt les problèmes d'identifiants et de préchauffer le cache d'authentification `caching_sha2_password` de MySQL 8, afin que les connexions TCP ultérieures du client PHP empruntent le chemin d'authentification rapide. Le job s'exécute à chaque apply et peut être relancé sans risque.
- **L'installateur web termine la configuration.** Le job `db-init` ne crée que la base de données *vide* ; la première visite de l'URL du service lance l'installateur web de Matomo, dont l'écran de base de données est prérempli à partir des variables d'environnement `MATOMO_DATABASE_*` injectées. C'est là que vous créez le compte superutilisateur et enregistrez votre premier site web suivi.
- **Persistance de la racine documentaire.** Au premier démarrage, le point d'entrée de l'image officielle copie l'application Matomo depuis `/usr/src/matomo` vers le volume NFS (vide) à `/var/www/html`. Tout l'état ultérieur — `config.ini.php`, plugins, ressources générées — y persiste à travers les redémarrages et les mises à niveau de version.
- **La connexion à la base de données se fait en TCP simple.** Avec `enable_cloudsql_volume = false`, le client MySQL PHP de Matomo se connecte à l'adresse IP privée de Cloud SQL via le VPC. Les variables d'environnement `MATOMO_DATABASE_ADAPTER=mysql` et `MATOMO_DATABASE_TABLES_PREFIX=matomo_` sont définies par `Matomo_Common`.
- **Archivage des rapports.** Par défaut, Matomo traite les rapports lors de l'affichage des pages (archivage déclenché par le navigateur), ce qui convient à un trafic faible à moyen et à la mise à l'échelle jusqu'à zéro par défaut du module. Pour les sites à fort trafic, planifiez `console core:archive` via l'entrée `cron_jobs` afin que le traitement des rapports s'exécute en tant que job Cloud Run plutôt qu'au sein des requêtes des visiteurs.
- **Chemin de santé.** Le démarrage utilise une sonde TCP (écoute du port) avec un seuil généreux de 20 échecs pour couvrir la copie depuis `/usr/src/matomo` au premier démarrage ; la sonde de vivacité cible `/` en HTTP, qui renvoie 200 — ou 302 vers l'installateur sur un déploiement neuf — dès qu'Apache et PHP sont opérationnels.
- **Les variables de réglage PHP sont des arguments de build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` ne s'appliquent que lorsque `container_image_source = "custom"` (ce sont des arguments de build Docker) ; avec l'image précompilée par défaut, elles n'ont aucun effet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Matomo ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `matomo` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Matomo` | Nom convivial affiché dans la console. |
| `application_version` | `5-apache` | Tag de l'image Matomo — utilisez un tag de variante Apache ; incrémentez-le pour déployer une nouvelle révision. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | `512M` / `64M` / `64M` | Arguments de build de réglage PHP — effectifs uniquement avec `container_image_source = "custom"`. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle de Matomo ; `custom` effectue un build via Cloud Build. |
| `container_image` | `""` | Laissez vide pour utiliser `matomo:<application_version>`. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU minimum pour Matomo. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 GiB recommandés pour la génération des rapports. |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro ; définissez `1` pour une production toujours active. |
| `max_instance_count` | `1` | Conservez 1, sauf s'il est confirmé que le NFS partagé et l'affinité de session fonctionnent sans risque avec plusieurs instances. |
| `container_port` | `80` | Matomo s'exécute sur Apache, qui écoute sur le port 80. |
| `enable_cloudsql_volume` | `false` | Matomo se connecte en TCP via l'adresse IP privée (`MATOMO_DATABASE_HOST`) — pas de socket de proxy. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_image_mirroring` | `true` | Met l'image en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Remarque : IAP placé devant Matomo bloque aussi le point de terminaison public de suivi. |
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service. Les traceurs des sites web publics nécessitent `all` (ou un équilibreur de charge en frontal). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Le trafic vers les adresses IP privées (y compris Cloud SQL) passe par le VPC. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement simples supplémentaires. `MATOMO_DATABASE_ADAPTER` et `MATOMO_DATABASE_TABLES_PREFIX` sont injectées automatiquement ; l'ensemble `MATOMO_DATABASE_HOST/USERNAME/DBNAME/PASSWORD` provient du socle. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupes 8 à 10 — CI/CD, SQL personnalisé, domaine et Cloud Armor {#groups-810--cicd-custom-sql-domain--cloud-armor}

Comportement standard d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`, `enable_cloud_deploy`, `enable_binary_authorization`, `enable_custom_sql_scripts`, `application_domains`, `enable_cdn`, `enable_cloud_armor`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour la racine documentaire de Matomo. Requiert gen2. |
| `nfs_mount_path` | `/var/www/html` | Racine documentaire de Matomo — la configuration, les plugins et les ressources y persistent. |
| `create_cloud_storage` / `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires ; le bucket `matomo-data` est toujours provisionné automatiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Matomo exige MySQL — ne passez pas à PostgreSQL. |
| `db_name` | `matomo` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `matomo` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |
| `enable_auto_password_rotation` | `false` | Rotation automatique du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Jobs récurrents — l'emplacement naturel d'un `console core:archive` planifié sur les sites à fort trafic. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai initial de 30 s, période de 15 s, 20 échecs | Seuil généreux pour la copie de la racine documentaire au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 300 s, période de 60 s, 3 échecs | Matomo renvoie 200/302 sur `/` dès que PHP et Apache sont opérationnels. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring — désactivé par défaut ; activez-le pour la production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis comme backend de cache d'objets de Matomo. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'adresse IP de l'hôte NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `matomo-data`). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Matomo ne prend en charge que MySQL/MariaDB ; tout autre moteur fait échouer l'installateur. |
| `db_name` / `db_user` | défini une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données d'analyse. |
| `enable_nfs` | `true` | Critical | Sans racine documentaire persistante, `config.ini.php` et les plugins sont perdus à chaque redémarrage — Matomo revient à l'installateur. |
| `nfs_mount_path` | `/var/www/html` | Critical | Un montage à tout autre emplacement laisse la racine documentaire sur un disque éphémère. |
| `container_port` | `80` | Critical | Apache écoute sur le port 80 ; une incohérence fait échouer toutes les sondes de santé. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `execution_environment` | `gen2` | High | Les montages NFS exigent gen2 ; gen1 ne peut pas monter Filestore. |
| `enable_cloudsql_volume` | `false` | High | Matomo est câblé pour TCP via `MATOMO_DATABASE_HOST` (adresse IP privée) ; passer au socket sans recâbler la variable d'environnement de l'hôte laisse l'installateur pointer vers un hôte injoignable. |
| `application_version` | Tag de variante Apache (par ex. `5-apache`) | High | Les variantes fpm/alpine n'ont pas d'Apache et ne servent pas HTTP sur le port 80. |
| `max_instance_count` | `1` | High | Plusieurs instances partageant la même racine documentaire NFS ne sont pas validées pour la sûreté des sessions et de la configuration de Matomo. |
| `memory_limit` | `2Gi` | High | Une mémoire insuffisante fait échouer la génération des rapports PHP et le traitement des archives. |
| `enable_redis` | `true` | Medium | Sans cache d'objets, toutes les lectures de cache sollicitent MySQL, ce qui augmente la charge. |
| `min_instance_count` | `0` (dev) / `1` (prod) | Medium | `0` ajoute un démarrage à froid de 10 à 30 s pour la première page vue suivie après une période d'inactivité. |
| `cron_jobs` (core:archive) | défini pour un fort trafic | Medium | L'archivage déclenché par le navigateur ralentit les requêtes des visiteurs sur les sites très fréquentés. |
| `enable_iap` | `false` pour les traceurs publics | Medium | IAP placé devant le service bloque le point de terminaison de suivi appelé par vos sites web. |
| `uptime_check_config.enabled` | `true` pour la prod | Low | Aucun signal de disponibilité externe ; les pannes ne remontent que par les signalements des utilisateurs. |
| `php_memory_limit` etc. | valeurs par défaut | Low | Simples arguments de build — silencieusement inertes avec l'image précompilée par défaut. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Matomo, partagée avec la variante GKE, est décrite dans **[Matomo_Common](Matomo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Matomo sur Cloud Run](../labs/Matomo_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Matomo sur GKE Autopilot](Matomo_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Matomo Common — Configuration applicative partagée](Matomo_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
