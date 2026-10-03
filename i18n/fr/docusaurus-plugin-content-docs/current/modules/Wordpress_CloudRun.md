---
title: "WordPress sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de WordPress sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wordpress_CloudRun.md @ 15fd4c7 sha256:335e187b55f7 -->

# WordPress sur Google Cloud Run {#wordpress-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wordpress_CloudRun.png" alt="WordPress sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WordPress est le système de gestion de contenu le plus populaire au monde, alimentant plus de 43 % de tous les sites web à l'échelle mondiale. Ce module déploie WordPress sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par WordPress et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WordPress s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — WordPress ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Répertoire `wp-content` (téléchargements, plugins, thèmes) partagé entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket média `wp-uploads` dédié |
| Cache | Redis | Cache d'objets optionnel ; activé par défaut pour réduire la charge de la base de données |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et huit clés et sels d'authentification WordPress |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sélection de PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est requis pour un site fonctionnel.** WordPress stocke les médias téléchargés, les plugins installés et les thèmes actifs sous `wp-content/`. Sans volume NFS partagé, chaque révision Cloud Run efface tous les plugins, thèmes et téléchargements — rendant WordPress sur Cloud Run non fonctionnel pour tout site réel.
- **La sonde de démarrage est TCP, pas HTTP.** WordPress peut ne pas encore répondre aux requêtes HTTP pendant l'initialisation de la base de données au premier démarrage ; une sonde TCP vérifie uniquement que le port d'Apache est ouvert.
- **`WP_HOME` et `WP_SITEURL` sont définis automatiquement** à partir de l'URL de service Cloud Run prédite (`CLOUDRUN_SERVICE_URL`), de sorte que WordPress génère des liens absolus corrects et évite les boucles de redirection.
- **Les migrations de base de données s'exécutent à chaque démarrage d'instance** via le job `db-init` ; les mises à niveau de version appliquent automatiquement les modifications de schéma.
- Les **clés et sels d'authentification** WordPress sont auto-générés et stockés dans Secret Manager ; vous ne les définissez jamais en texte clair.
- **Cloud Run gen2 est requis** pour les montages de volume NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service WordPress {#a-cloud-run--the-wordpress-service}

WordPress s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WordPress stocke toutes les données du site (articles, utilisateurs, paramètres, commentaires) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `wp-content` de WordPress est mappé sur un partage **Filestore (NFS)** monté dans le service afin que toutes les instances partagent les mêmes plugins, thèmes et médias téléchargés. Un bucket **Cloud Storage** dédié (`wp-uploads`) est également provisionné pour les ressources multimédias.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache d'objets Redis {#d-redis-object-cache}

Redis prend en charge le cache d'objets de WordPress via le plugin **WP Redis**, stockant les résultats des requêtes de base de données coûteuses en mémoire. Lorsque `redis_host` est laissé vide et que NFS est activé, l'adresse IP du serveur NFS est utilisée comme point de terminaison Redis (le modèle de déploiement partagé par défaut).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données WordPress et les huit clés et sels d'authentification WordPress sont stockés dans Secret Manager et injectés dans le service au moment de l'exécution ; les valeurs en texte clair n'apparaissent jamais dans l'état Terraform.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # List all secrets belonging to this deployment:
  gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application WordPress {#3-wordpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation utilisant l'image `mysql:8.0-debian` crée la base de données et l'utilisateur WordPress avant le démarrage du service. Il s'exécute à chaque `tofu apply` car il est idempotent — il ignore en toute sécurité les étapes déjà terminées.
- **Clés et sels d'authentification.** Huit secrets de sécurité WordPress de 64 caractères (clé d'authentification, clé d'authentification sécurisée, clé de connexion, clé nonce et leurs sels correspondants) sont générés automatiquement lors du premier déploiement et stockés dans Secret Manager. La rotation de ces secrets invalide immédiatement toutes les sessions de navigateur actives — chaque utilisateur connecté sera déconnecté.
- **Résolution automatique de l'URL du site.** `CLOUDRUN_SERVICE_URL` est toujours injecté par la fondation avec l'URL Cloud Run correcte. `wp-config-docker.php` lit ceci pour définir `WP_HOME` et `WP_SITEURL` afin que WordPress génère des liens absolus corrects et évite les boucles de redirection derrière Cloud Run.
- **Configuration PHP intégrée au moment de la build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` sont appliqués à l'image du conteneur au moment de la build Cloud Build. Les modifier déclenche une nouvelle build d'image et une nouvelle révision.
- **Conception de la sonde de santé.** La sonde de démarrage TCP confirme qu'Apache écoute avant que les vérifications HTTP ne commencent ; le `failure_threshold` élevé (20 × 15 s = 300 s) tient compte du job `db-init` et de la phase d'initialisation de WordPress. La sonde de vivacité interroge `/wp-admin/install.php` — qui renvoie HTTP 200 que WordPress soit fraîchement installé ou déjà configuré — avec un délai initial de 300 secondes.
- **Tâches planifiées WordPress.** Cloud Run est invoqué à la demande, donc le pseudo-cron `wp-cron` peut ne pas se déclencher à l'heure si il n'y a pas de trafic. Pour une exécution planifiée fiable, désactivez `wp-cron` via `environment_variables` et configurez une entrée `cron_jobs` :

  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour WordPress sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wordpress` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Wordpress` | Nom convivial affiché dans la console. Remarque : ce module utilise `display_name` (pas `application_display_name`). |
| `description` | `Wordpress CMS on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de version de l'image WordPress. Utilisez une version épinglée (par exemple `6.7.1`) en production. |
| `php_memory_limit` | `512M` | `memory_limit` PHP intégré au moment de la build. Augmentez pour les charges de travail de plugins lourdes. |
| `upload_max_filesize` | `64M` | Taille maximale d'un seul téléchargement de fichier. Doit être ≤ `post_max_size`. |
| `post_max_size` | `64M` | Taille maximale de toutes les données POST. Doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 GiB recommandés pour WordPress avec des plugins. |
| `min_instance_count` | `0` | Instances minimales (mise à l'échelle à zéro par défaut). Définissez sur `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Instances maximales. N'augmentez qu'après avoir vérifié que tous les plugins gèrent correctement l'accès concurrent et que NFS est activé. |
| `container_port` | `80` | WordPress/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. Requis. |
| `execution_environment` | `gen2` | Cloud Run gen2 est requis pour les montages NFS. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Considérez `internal-and-cloud-load-balancing` lors de l'utilisation de Cloud Armor. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `WORDPRESS_TABLE_PREFIX`, `WORDPRESS_DEBUG` et les variables Redis sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Huit secrets d'authentification WordPress sont injectés automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Remarque : ce module utilise `backup_uri` (URI GCS complet ou ID de fichier Drive). |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. Fortement recommandé pour les sites WordPress publics. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour WordPress `wp-content` (garder activé). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage à l'intérieur du conteneur. Le script de démarrage crée un lien symbolique `wp-content` ici. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket média / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. WordPress nécessite MySQL. |
| `db_name` | `wp` | Nom de la base de données. **Immuable après le premier déploiement.** Remarque : ce module utilise `db_name` (pas `application_database_name`). |
| `db_user` | `wp` | Utilisateur de l'application. **Immuable après le premier déploiement.** Remarque : ce module utilise `db_user` (pas `application_database_user`). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires pour les détails de connexion. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents. Utilisez-les pour remplacer `wp-cron` pour une exécution fiable des tâches planifiées. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, seuil 20 | Sonde de démarrage TCP — évite les échecs HTTP pendant l'initialisation de la base de données. Ne réduisez pas `failure_threshold` en dessous de 10. |
| `liveness_probe` | HTTP `/wp-admin/install.php`, délai de 300s | Le délai initial de 300 secondes permet la configuration de la base de données au premier démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le cache d'objets WordPress. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS ; définissez explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données (sensible). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | WordPress nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, chaque nouvelle révision Cloud Run efface tous les plugins, thèmes et téléchargements de médias — WordPress est non fonctionnel pour tout site réel. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données WordPress. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent Cloud Run gen2 ; le passage à gen1 provoque une erreur de montage de volume et un échec de démarrage du service. |
| `container_image_source` | `custom` | Élevé | L'image WordPress personnalisée connecte le lien symbolique NFS et le socket Cloud SQL. L'utilisation de `prebuilt` avec l'image WordPress vanille rompt la connectivité du socket Cloud SQL. |
| `nfs_mount_path` | `/mnt/nfs` (ne pas modifier après le déploiement) | Élevé | Le script de démarrage crée un lien symbolique `wp-content` vers ce chemin ; le modifier après le déploiement rompt le lien symbolique. |
| `startup_probe` | TCP (par défaut) | Élevé | Une sonde HTTP peut échouer lors de l'initialisation de la base de données au premier démarrage. Ne réduisez pas `failure_threshold` en dessous de 10. |
| `memory_limit` | `2Gi` | Élevé | WordPress avec des plugins populaires (WooCommerce, Elementor) nécessite au moins 2 GiB ; une mémoire insuffisante provoque des erreurs fatales PHP. |
| `enable_redis` | `true` | Moyen | Plusieurs instances avec des caches en mémoire isolés provoquent des requêtes de base de données redondantes. |
| `redis_host` | `""` (IP NFS) ou explicite | Élevé | Pas de point de terminaison Redis valide si Redis est activé, NFS est désactivé et aucun hôte n'est défini. |
| `enable_cloud_armor` | activer pour les sites publics | Élevé | Les pages de connexion WordPress (`/wp-login.php`, `xmlrpc.php`) sont des cibles privilégiées pour les attaques par force brute. |
| `php_memory_limit` | `512M` | Moyen | Doit être dans `memory_limit` ; le définir plus haut que la limite du conteneur provoque une terminaison OOM au lieu d'une erreur PHP. |
| `min_instance_count` | `1` | Moyen | `0` provoque des retards de démarrage à froid et peut entraîner des erreurs visibles pour le premier visiteur après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour les sites de commerce électronique ou à fort contenu. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'accès administrateur | Moyen | Le panneau d'administration WordPress est autrement accessible publiquement. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à WordPress partagée
avec la variante GKE est décrite dans **[Wordpress_Common](Wordpress_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WordPress sur Cloud Run](../labs/Wordpress_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WordPress sur GKE Autopilot](Wordpress_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [WordPress Common — Configuration d'application partagée](Wordpress_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Site Web d'entreprise et blog**.
