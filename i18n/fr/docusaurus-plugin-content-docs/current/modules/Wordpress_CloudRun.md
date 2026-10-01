---
title: "WordPress sur Google Cloud Run"
description: "Référence de configuration pour déployer WordPress sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wordpress_CloudRun.md @ 3055034 sha256:dd54b1801c9e -->

# WordPress sur Google Cloud Run {#wordpress-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wordpress_CloudRun.png" alt="WordPress sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WordPress est le système de gestion de contenu le plus populaire au monde, utilisé par plus de 43 % de tous les sites web. Ce module déploie WordPress sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise WordPress et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WordPress s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — WordPress ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Répertoire `wp-content` (fichiers téléversés, extensions, thèmes) partagé entre toutes les instances |
| Stockage objet | Cloud Storage | Un bucket média `wp-uploads` dédié |
| Cache | Redis | Cache d'objets facultatif ; activé par défaut pour réduire la charge sur la base de données |
| Secrets | Secret Manager | Mot de passe de la base de données et huit clés et sels d'authentification WordPress générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Choisir PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est indispensable à un site fonctionnel.** WordPress stocke les médias téléversés, les extensions installées et les thèmes actifs sous `wp-content/`. Sans volume NFS partagé, chaque révision Cloud Run efface l'ensemble des extensions, thèmes et fichiers téléversés — ce qui rend WordPress sur Cloud Run inutilisable pour tout site réel.
- **La sonde de démarrage est TCP, pas HTTP.** WordPress peut ne pas encore répondre aux requêtes HTTP pendant l'initialisation de la base de données au premier démarrage ; une sonde TCP vérifie seulement que le port d'Apache est ouvert.
- **`WP_HOME` et `WP_SITEURL` sont définis automatiquement** à partir de l'URL prévue du service Cloud Run (`CLOUDRUN_SERVICE_URL`), afin que WordPress génère des liens absolus corrects et évite les boucles de redirection.
- **Les migrations de base de données s'exécutent à chaque démarrage d'instance** via le job `db-init` ; les mises à niveau de version appliquent automatiquement les changements de schéma.
- Les **clés et sels d'authentification** WordPress sont générés automatiquement et stockés dans Secret Manager ; vous ne les saisissez jamais en clair.
- **Cloud Run gen2 est obligatoire** pour les montages de volumes NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service WordPress {#a-cloud-run--the-wordpress-service}

WordPress s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WordPress stocke toutes les données du site (articles, utilisateurs, paramètres, commentaires) dans une instance gérée Cloud SQL for MySQL 8.0. Le service s'y connecte de façon privée via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'adresse IP publique). Au premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `wp-content` de WordPress est placé sur un partage **Filestore (NFS)** monté dans le service, afin que toutes les instances partagent les mêmes extensions, thèmes et médias téléversés. Un bucket **Cloud Storage** dédié (`wp-uploads`) est également provisionné pour les ressources média.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis sert de cache d'objets à WordPress via l'extension **WP Redis**, en conservant en mémoire les résultats des requêtes coûteuses vers la base de données. Lorsque `redis_host` est laissé vide et que NFS est activé, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis (le modèle de déploiement partagé par défaut).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données WordPress ainsi que les huit clés et sels d'authentification WordPress sont stockés dans Secret Manager et injectés dans le service à l'exécution ; les valeurs en clair n'apparaissent jamais dans l'état Terraform.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application WordPress {#3-wordpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation utilisant l'image `mysql:8.0-debian` crée la base de données et l'utilisateur WordPress avant le démarrage du service. Il s'exécute à chaque `tofu apply` car il est idempotent — il ignore sans risque les étapes déjà effectuées.
- **Clés et sels d'authentification.** Huit secrets de sécurité WordPress de 64 caractères (auth key, secure auth key, logged-in key, nonce key et les sels correspondants) sont générés automatiquement au premier déploiement et stockés dans Secret Manager. La rotation de ces secrets invalide immédiatement toutes les sessions de navigateur actives — tous les utilisateurs connectés seront déconnectés.
- **Résolution automatique de l'URL du site.** `CLOUDRUN_SERVICE_URL` est toujours injectée par le socle avec l'URL Cloud Run correcte. `wp-config-docker.php` la lit pour définir `WP_HOME` et `WP_SITEURL`, afin que WordPress génère des liens absolus corrects et évite les boucles de redirection derrière Cloud Run.
- **Configuration PHP figée au build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont appliqués à l'image du conteneur au moment du build Cloud Build. Les modifier déclenche un nouveau build d'image et une nouvelle révision.
- **Conception des sondes de santé.** La sonde de démarrage TCP confirme qu'Apache écoute avant le début des vérifications HTTP ; le `failure_threshold` élevé (20 × 15 s = 300 s) laisse le temps au job `db-init` et à la phase d'initialisation de WordPress. La sonde de vivacité interroge `/wp-admin/install.php` — qui renvoie HTTP 200 que WordPress vienne d'être installé ou soit déjà configuré — avec un délai initial de 300 secondes.
- **Tâches planifiées WordPress.** Cloud Run est invoqué à la demande, de sorte que le pseudo-cron `wp-cron` peut ne pas se déclencher à l'heure prévue en l'absence de trafic. Pour une exécution planifiée fiable, désactivez `wp-cron` via `environment_variables` et configurez une entrée `cron_jobs` :

  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à WordPress ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `wordpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Wordpress` | Nom convivial affiché dans la console. Remarque : ce module utilise `display_name` (et non `application_display_name`). |
| `description` | `Wordpress CMS on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image WordPress. Utilisez une version figée (par ex. `6.7.1`) en production. |
| `php_memory_limit` | `512M` | `memory_limit` PHP figé au build. Augmentez-le pour les charges de travail riches en extensions. |
| `upload_max_filesize` | `64M` | Taille maximale d'un fichier téléversé. Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale de l'ensemble des données POST. Doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 GiB recommandés pour WordPress avec des extensions. |
| `min_instance_count` | `0` | Nombre minimal d'instances (mise à zéro par défaut). Définissez `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Augmentez-le seulement après avoir vérifié que toutes les extensions gèrent correctement l'accès concurrent et que NFS est activé. |
| `container_port` | `80` | WordPress/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. Obligatoire. |
| `execution_environment` | `gen2` | Cloud Run gen2 est obligatoire pour les montages NFS. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. Envisagez `internal-and-cloud-load-balancing` lorsque vous utilisez Cloud Armor. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode de routage du trafic sortant via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG` et les variables Redis sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. Huit secrets d'authentification WordPress sont injectés automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Délai de réplication / fréquence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_uri` (URI GCS complet ou ID de fichier Drive). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. Fortement recommandé pour les sites WordPress publics. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le `wp-content` de WordPress (à laisser activé). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. Le script de démarrage crée un lien symbolique de `wp-content` vers ce chemin. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket média / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. WordPress exige MySQL. |
| `db_name` | `wp` | Nom de la base de données. **Immuable après le premier déploiement.** Remarque : ce module utilise `db_name` (et non `application_database_name`). |
| `db_user` | `wp` | Utilisateur de l'application. **Immuable après le premier déploiement.** Remarque : ce module utilise `db_user` (et non `application_database_user`). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires pour les informations de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Run Jobs récurrents. À utiliser pour remplacer `wp-cron` afin d'exécuter les tâches planifiées de façon fiable. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai 30s, seuil 20 | Sonde de démarrage TCP — évite les échecs HTTP pendant l'initialisation de la base de données. Ne réduisez pas `failure_threshold` en dessous de 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, délai 300s | Le délai initial de 300 secondes laisse le temps à la configuration de la base de données au premier démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le cache d'objets WordPress. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS ; définissez-la explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
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
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | WordPress exige MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, chaque nouvelle révision Cloud Run efface l'ensemble des extensions, thèmes et médias téléversés — WordPress est inutilisable pour tout site réel. |
| `db_name` / `db_user` | défini une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données WordPress. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent Cloud Run gen2 ; passer en gen1 provoque une erreur de montage de volume et l'échec du démarrage du service. |
| `container_image_source` | `custom` | Élevé | L'image WordPress personnalisée met en place le lien symbolique NFS et le socket Cloud SQL. Utiliser `prebuilt` avec l'image WordPress standard rompt la connectivité au socket Cloud SQL. |
| `nfs_mount_path` | `/mnt/nfs` (ne pas modifier après le déploiement) | Élevé | Le script de démarrage crée un lien symbolique de `wp-content` vers ce chemin ; le modifier après le déploiement casse le lien symbolique. |
| `startup_probe` | TCP (par défaut) | Élevé | Une sonde HTTP peut échouer pendant l'initialisation de la base de données au premier démarrage. Ne réduisez pas `failure_threshold` en dessous de 10. |
| `memory_limit` | `2Gi` | Élevé | WordPress avec des extensions populaires (WooCommerce, Elementor) nécessite au moins 2 GiB ; une mémoire insuffisante provoque des erreurs fatales PHP. |
| `enable_redis` | `true` | Moyen | Plusieurs instances avec des caches en mémoire isolés provoquent des requêtes redondantes vers la base de données. |
| `redis_host` | `""` (IP NFS) ou explicite | Élevé | Aucun point de terminaison Redis valide si Redis est activé, NFS désactivé et aucun hôte défini. |
| `enable_cloud_armor` | à activer pour les sites publics | Élevé | Les pages de connexion WordPress (`/wp-login.php`, `xmlrpc.php`) sont des cibles privilégiées des attaques par force brute. |
| `php_memory_limit` | `512M` | Moyen | Doit rester dans les limites de `memory_limit` ; le définir au-delà de la limite du conteneur provoque un arrêt OOM au lieu d'une erreur PHP. |
| `min_instance_count` | `1` | Moyen | `0` entraîne des délais de démarrage à froid et peut provoquer des erreurs visibles pour le premier visiteur après une période d'inactivité. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les sites e-commerce ou riches en contenu. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'accès d'administration | Moyen | Sinon, le panneau d'administration WordPress est accessible publiquement. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à WordPress, partagée
avec la variante GKE, est décrite dans **[Wordpress_Common](Wordpress_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WordPress sur Cloud Run](../labs/Wordpress_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WordPress sur GKE Autopilot](Wordpress_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [WordPress Common — Configuration applicative partagée](Wordpress_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Business Website & Blog**.
