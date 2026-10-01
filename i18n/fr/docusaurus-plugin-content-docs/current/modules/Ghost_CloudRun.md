---
title: "Ghost sur Google Cloud Run"
description: "Référence de configuration pour déployer Ghost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ghost_CloudRun.md @ 3055034 sha256:232ad30f3d81 -->

# Ghost sur Google Cloud Run {#ghost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_CloudRun.png" alt="Ghost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghost est une plateforme de publication open source moderne qui alimente plus de 2M de publications, avec adhésions, abonnements et newsletters intégrés. Ce module déploie Ghost sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Ghost et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Ghost s'exécute sous la forme d'un conteneur Node.js sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 MiB par défaut, facturation à la requête avec mise à l'échelle jusqu'à zéro |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Ghost 6.x ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Contenus téléversés et thèmes partagés entre toutes les instances (gen2 requis) |
| Stockage objet | Cloud Storage | Un bucket de contenu dédié (`ghost-content`) provisionné automatiquement |
| Cache | Redis | Activé par défaut ; se rabat sur l'IP de l'hôte NFS lorsqu'aucun hôte Redis n'est indiqué |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Ghost 6.x nécessite MySQL ; PostgreSQL n'est pas pris en charge et ne démarrera pas.
- **`database__client = "mysql"` est injecté automatiquement.** Sans cela, Ghost se rabat silencieusement sur SQLite — le module s'en charge, vous n'avez donc jamais à le définir manuellement.
- **Redis est activé par défaut.** Ghost utilise Redis pour la mise en cache des pages afin de réduire la charge sur la base de données et d'améliorer les temps de réponse.
- **Détection dynamique de l'URL.** Le point d'entrée personnalisé interroge l'API Cloud Run au démarrage pour découvrir l'URL du service et l'exporter en tant que `url` pour Ghost. Une variable d'environnement `url` explicite est prioritaire.
- **Un bucket GCS `ghost-content` est provisionné automatiquement** par `Ghost_Common` et n'a pas besoin d'être ajouté à `storage_buckets`.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données MySQL et l'utilisateur de Ghost.
- **Les sondes de santé ciblent `/`** avec un délai initial de 90 secondes, pour permettre à Ghost d'exécuter les migrations de base de données et de compiler les thèmes au premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Ghost {#a-cloud-run--the-ghost-service}

Ghost s'exécute en tant que service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Ghost stocke toutes les données de l'application (articles, membres, paramètres) dans une instance gérée Cloud SQL for MySQL 8.0. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Au premier déploiement, un Job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les contenus téléversés (images, thèmes, fichiers) sont écrits sur un partage **Filestore (NFS)** monté dans le service, de sorte que toutes les instances partagent les mêmes fichiers. Un bucket **Cloud Storage** dédié (`ghost-content`) est également provisionné automatiquement pour le contenu. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<content-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis sert de support à la mise en cache des pages de Ghost. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans le service à l'exécution ; il n'apparaît jamais en clair dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ghost {#3-ghost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` se connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente la base de données Ghost (avec le jeu de caractères `utf8mb4` et la collation `utf8mb4_0900_ai_ci`), crée l'utilisateur de l'application et lui accorde tous les privilèges. Le job s'exécute à chaque apply et peut être relancé sans risque.
- **Premier démarrage lent.** Ghost exécute les migrations de base de données et compile les thèmes au premier démarrage. La sonde de démarrage accorde un délai initial de 90 secondes — ne le réduisez pas en dessous de 60 secondes, sinon l'instance sera arrêtée avant que Ghost ait fini de s'initialiser.
- **Détection dynamique de l'URL.** Au démarrage, le point d'entrée personnalisé interroge l'API de métadonnées Cloud Run pour découvrir l'URL du service et la définit comme `url` et `admin__url` de Ghost. Une variable d'environnement `url` explicite est toujours prioritaire. Cela garantit que Ghost génère des liens absolus corrects dans les e-mails d'adhésion et la navigation de l'administration.
- **Connexion à la base de données.** Le point d'entrée associe automatiquement `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD` et `DB_PORT` aux paramètres `database__connection__*` de Ghost. Lorsque `DB_HOST` commence par `/`, il est traité comme un chemin de socket Unix (le socket du Cloud SQL Auth Proxy).
- **SMTP pour les e-mails.** Ghost nécessite SMTP pour les inscriptions des membres, les réinitialisations de mot de passe et l'envoi des newsletters. Les `environment_variables` sont pré-remplies (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`) — configurez-les avant d'inviter des membres.
- **Connexion administrateur.** Le panneau d'administration de Ghost se trouve à `<url>/ghost`. Au premier démarrage, Ghost crée un utilisateur administrateur de manière interactive.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui renvoie HTTP 200 lorsque Ghost est entièrement initialisé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Ghost ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `ghost` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Ghost Publishing` | Nom convivial affiché dans la console. |
| `description` | `Ghost - Professional publishing platform` | Description du service. |
| `application_version` | `6.14.0` | Tag de version de l'image Ghost ; incrémentez-le pour déclencher une nouvelle révision. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; dimensionné pour un usage léger à typique — passez à `2000m` en production avec un traitement d'images intensif ou des adhésions. |
| `memory_limit` | `512Mi` | Mémoire par instance (le minimum de Ghost) ; passez à `1Gi` ou plus en production avec des fonctionnalités d'adhésion actives. |
| `min_instance_count` | `0` | Nombre minimal d'instances ; `0` active la mise à l'échelle jusqu'à zéro — définissez `1` pour éviter les démarrages à froid avec délais de migration. **Bogue connu :** le local `ghost_module` de `main.tf` code actuellement en dur `min_instance_count = 0`, ce qui écrase silencieusement cette variable quelle que soit la valeur configurée (signalé par un `TODO` dans `main.tf`) — consultez l'entrée correspondante des pièges de configuration ci-dessous. |
| `max_instance_count` | `1` | Nombre maximal d'instances ; plafonne la montée en charge simultanée. **Bogue connu :** le local `ghost_module` de `main.tf` code actuellement en dur `max_instance_count = 5`, ce qui écrase silencieusement cette variable quelle que soit la valeur configurée. |
| `container_port` | `2368` | Port HTTP natif de Ghost. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build (par défaut) ; `prebuilt` déploie une image existante. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. Obligatoire pour Ghost. |
| `execution_environment` | `gen2` | Cloud Run gen2 requis pour les montages NFS. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (all / internal / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{SMTP_HOST="", SMTP_PORT="587", SMTP_USER="", SMTP_PASSWORD="", SMTP_SSL="false", EMAIL_FROM="ghost@example.com"}` | Paramètres SMTP pré-remplis pour l'envoi d'e-mails par Ghost (utilisez le port 587 STARTTLS ou 465 SSL — Google Cloud bloque le port sortant 25). `database__client=mysql` est injecté automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Délai d'attente de réplication après la création d'un secret. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. Ghost doit connaître son URL publique — assurez-vous que le domaine correspond. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend du LB. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le contenu Ghost. Nécessite gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets / montages GCS Fuse supplémentaires. Le bucket `ghost-content` est toujours provisionné automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Ghost nécessite MySQL 8.0 — ne le modifiez pas. |
| `db_name` | `ghost` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `ghost` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires pour les détails de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 90s, 10 échecs | Sonde de démarrage HTTP sur le chemin racine de Ghost. Délai généreux pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60s | Sonde de vivacité ciblant le chemin racine de Ghost. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour la mise en cache des pages de Ghost. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP de l'hôte NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

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
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `ghost-content`). |
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
| `database_type` | `MYSQL_8_0` | Critical | Ghost nécessite MySQL 8.0 ; tout autre moteur empêche le démarrage. |
| `db_name` / `db_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; un renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critical | Sans stockage partagé, le contenu téléversé est perdu entre les instances et les redémarrages. |
| `container_port` | `2368` | Critical | Port natif de Ghost ; une incohérence fait échouer toutes les sondes de santé. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `startup_probe` initial_delay_seconds | `90` | High | Une valeur inférieure à 60 conduit Cloud Run à arrêter Ghost avant la fin de l'exécution des migrations. |
| `enable_redis` | `true` | High | Sans Redis, Ghost sert toutes les pages sans cache, ce qui augmente la charge sur la base de données. |
| `redis_host` | `""` (NFS) ou explicite | High | Aucun point de terminaison valide si Redis est activé alors que NFS est désactivé et qu'aucun hôte n'est défini. |
| `memory_limit` | `512Mi` ou plus | High | Une mémoire insuffisante provoque un OOM de Node.js lors de l'envoi des newsletters ou de la compilation des thèmes ; dépassez la valeur par défaut de `512Mi` pour un usage actif des adhésions et newsletters. |
| Paramètres SMTP de `environment_variables` | un vrai serveur SMTP | High | Sans envoi d'e-mails, pas d'inscriptions de membres, pas de réinitialisations de mot de passe, pas de newsletters. |
| `container_image_source` | `custom` | High | L'image Ghost amont ne dispose pas du point d'entrée personnalisé qui mappe les identifiants de la base de données et détecte l'URL du service. |
| `execution_environment` | `gen2` | High | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `min_instance_count` / `max_instance_count` | `0` (par défaut) ou `1` | Medium | **Bogue connu :** le local `ghost_module` de `main.tf` code en dur `min_instance_count = 0` et `max_instance_count = 5`, ce qui écrase silencieusement ces variables — les définir dans `tfvars` et refaire un apply n'a actuellement aucun effet sur les limites de mise à l'échelle du service déployé tant que cette valeur codée en dur n'a pas été retirée du code source du module. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'administration | Medium | Sinon, le panneau d'administration de Ghost (`/ghost`) est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Ghost, partagée avec la variante GKE, est décrite dans **[Ghost_Common](Ghost_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ghost sur Cloud Run](../labs/Ghost_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Ghost sur GKE Autopilot](Ghost_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ghost Common — Configuration applicative partagée](Ghost_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Creator & Media Publishing**.
