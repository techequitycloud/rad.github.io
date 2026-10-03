---
title: "Nextcloud sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Nextcloud sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Nextcloud_CloudRun.md @ 15fd4c7 sha256:839a7d561633 -->

# Nextcloud sur Google Cloud Run {#nextcloud-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Nextcloud_CloudRun.png" alt="Nextcloud sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Nextcloud est la principale plateforme auto-hébergée de synchronisation de fichiers et de collaboration,
à laquelle font confiance 400 millions d'utilisateurs dans plus de 100 000 organisations,
y compris des gouvernements et des prestataires de soins de santé à la recherche d'une
alternative conforme au RGPD à Google Drive et OneDrive. Ce module déploie Nextcloud sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Nextcloud et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité de service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Nextcloud s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Nextcloud ne prend pas en charge PostgreSQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoires `config/` et `data/` partagés entre toutes les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `nc-data` provisionné par déploiement |
| Cache et verrouillage | Redis | Activé par défaut ; empêche les conflits de verrouillage de fichiers entre les instances |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré ; secrets de configuration post-installation |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sélection de PostgreSQL ou `NONE` interrompt le démarrage.
- **NFS est activé par défaut et nécessite l'environnement d'exécution gen2.** Toutes les
  instances doivent partager `config.php` et le répertoire de données utilisateur. Sans NFS,
  chaque démarrage à froid supprime les fichiers.
- **Redis est activé par défaut.** Sans un cache partagé et un backend de verrouillage,
  les écritures concurrentes entre les instances provoquent des erreurs HTTP 503 "File is locked".
- **Les limites PHP sont intégrées à l'image du conteneur** au moment de la build. La
  modification de `php_memory_limit`, `upload_max_filesize` ou `post_max_size`
  nécessite une nouvelle exécution de Cloud Build.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret Manager ;
  vous ne le définissez jamais en texte clair.
- **Le premier démarrage est intentionnellement lent.** Nextcloud exécute `occ maintenance:install`
  de manière synchrone avant le démarrage d'Apache. La sonde de démarrage autorise jusqu'à
  10 minutes pour que la première installation se termine.
- **`scale-to-zero` est la valeur par défaut** (`min_instance_count = 0`). Pour les
  déploiements de production avec des clients de synchronisation WebDAV, définissez `min_instance_count = 1`
  pour éviter les déconnexions à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Nextcloud {#a-cloud-run--the-nextcloud-service}

Nextcloud s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction
de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Nextcloud stocke toutes les données d'application (métadonnées de fichiers, utilisateurs, partages,
calendrier et contacts) dans une instance gérée Cloud SQL pour MySQL 8.0. Le service se
connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique).
Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur
de l'application avec le jeu de caractères et le classement `utf8mb4`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les données de fichiers utilisateur de Nextcloud sont écrites dans un partage **Filestore (NFS)**
monté sur chaque instance. `entrypoint.sh` définit `NEXTCLOUD_DATA_DIR=<nfs_mount_path>/nextcloud-data` (`/mnt/nfs/nextcloud-data`
par défaut ; le wrapper passe le même `nfs_mount_path` au point d'entrée que `NFS_MOUNT_PATH`,
donc le montage et le répertoire de données ne peuvent pas être en désaccord) afin que toutes les
instances partagent les mêmes fichiers utilisateur. `config.php` n'est **pas** stocké sur NFS
— il est reconstruit localement sur chaque instance à partir des secrets de Secret Manager
(voir §3 "Secrets de configuration post-installation" ci-dessous). Un bucket `nc-data`
**Cloud Storage** est également provisionné par déploiement.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<nc-data-bucket>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis et verrouillage de fichiers {#d-redis-cache-and-file-locking}

Redis prend en charge le cache distribué de Nextcloud (`memcache.distributed`) et le verrouillage de fichiers
(`filelocking.enabled`). Avec plus d'une instance, c'est obligatoire — sans cela, les écritures
concurrentes produisent des erreurs HTTP 503 "File is locked". Lorsqu'aucun hôte Redis externe
n'est configuré et que NFS est activé, l'IP du serveur NFS est utilisée comme point de terminaison
Redis par défaut.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Nextcloud et quatre secrets de configuration post-installation
(ID d'instance, sel de mot de passe, secret d'application et, éventuellement, le mot de passe
d'authentification Redis) sont stockés dans Secret Manager et injectés dans le service au moment
de l'exécution. Les trois secrets de configuration commencent comme des valeurs d'espace réservé
`"UNSET"` ; le hook post-installation du conteneur écrit les vraies valeurs après que
`occ maintenance:install` soit terminé.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ;
les paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité. Les domaines
personnalisés sont également ajoutés automatiquement à la liste `NEXTCLOUD_TRUSTED_DOMAINS` de Nextcloud.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL
sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques
d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Nextcloud {#3-nextcloud-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  crée la base de données et l'utilisateur Nextcloud avec le jeu de caractères `utf8mb4`
  avant le démarrage du service. Il est idempotent.
- **`occ maintenance:install` au premier démarrage.** Lors du tout premier démarrage, Nextcloud
  exécute sa routine d'installation de manière synchrone avant qu'Apache ne commence à servir.
  Cela peut prendre plusieurs minutes sur une instance Cloud SQL froide. La sonde de démarrage
  autorise jusqu'à 10 minutes (60 s de délai initial + 40 échecs × 15 s de période) pour que
  cela se termine.
- **Secrets de configuration post-installation.** Une fois que `occ maintenance:install` est terminé,
  un hook dans le conteneur écrit les vraies valeurs `instanceid`, `passwordsalt` et `secret`
  dans Secret Manager. Les démarrages ultérieurs les relisent pour reconstruire `config.php`
  sans nécessiter NFS.
- **Mise à niveau PHP au démarrage.** `NEXTCLOUD_UPDATE=1` est défini par défaut, donc Nextcloud
  exécute `occ upgrade` automatiquement à chaque démarrage de conteneur. Définissez `NEXTCLOUD_UPDATE=0`
  dans `environment_variables` et gérez les mises à niveau manuellement lors du passage à des versions majeures.
- **Domaines de confiance.** Nextcloud applique une liste blanche de domaines de confiance.
  Le module initialise `NEXTCLOUD_TRUSTED_DOMAINS` à partir de `application_domains`. L'URL du service
  Cloud Run est résolue au démarrage par `entrypoint.sh` à partir de `CLOUDRUN_SERVICE_URL`
  et également ajoutée. Les requêtes provenant d'hôtes non listés reçoivent une erreur
  "Accès via un domaine non fiable".
- **`OVERWRITEPROTOCOL=https`.** Nextcloud est informé qu'il se trouve derrière un proxy HTTPS
  afin qu'il génère des liens de partage absolus et des URL WebDAV corrects.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/status.php`,
  qui renvoie un HTTP 200 avec un objet d'état JSON quel que soit l'état de configuration
  de Nextcloud — ce qui en fait le point de terminaison de santé canonique.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est configurable ;
  le mot de passe est récupéré de Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.
Seuls les paramètres spécifiques ou notables pour Nextcloud sont listés ; toutes les autres
entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `nextcloud` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Nextcloud` | Nom convivial affiché dans la console. |
| `description` | `Nextcloud self-hosted collaboration and file sharing platform` | Description du service Cloud Run. |
| `application_version` | `31` | Tag de version de l'image Nextcloud. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés. |
| `min_instance_count` | `0` | Instances minimales ; définissez sur `1` pour éviter les démarrages à froid pour les clients WebDAV. |
| `max_instance_count` | `1` | Instances maximales. Nécessite Redis + NFS lorsque > 1. |
| `container_port` | `80` | Nextcloud/Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Nextcloud dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Nextcloud de base sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS ; également ajoutés à `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket `nc-data`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires à provisionner. |
| `enable_nfs` | `true` | Volume Filestore partagé pour la configuration et les données Nextcloud. **Nécessite gen2.** |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. Les données utilisateur vont à `<nfs_mount_path>/nextcloud-data`. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `db_name` | `nextcloud` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `nextcloud` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=40 }` | Permet jusqu'à ~10 minutes pour le premier démarrage `occ maintenance:install`. |
| `liveness_probe` | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3 }` | Redémarre l'instance après 3 échecs consécutifs. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de la disponibilité de Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le cache distribué et le verrouillage de fichiers. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS ; définir explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Nextcloud {#group-23--nextcloud-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nextcloud_admin_user` | `admin` | Nom d'utilisateur de l'administrateur initial. Modifier par rapport à la valeur par défaut pour les déploiements publics. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP — intégrée à l'image du conteneur au moment de la build. |
| `upload_max_filesize` | `512M` | Taille maximale de fichier à télécharger — intégrée à l'image. |
| `post_max_size` | `512M` | Limite de corps de requête POST PHP — doit être ≥ `upload_max_filesize`. |

### Groupe 24 — E-mail / SMTP {#group-24--email--smtp}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP. Laisser vide pour désactiver l'e-mail. |
| `smtp_secure` | `""` | Chiffrement : `ssl`, `tls`, ou vide pour aucun. |
| `smtp_port` | `""` | Port SMTP ; utilise la valeur par défaut du mode si vide. |
| `smtp_authtype` | `LOGIN` | Mécanisme d'authentification : `LOGIN`, `PLAIN`, ou `NONE`. |
| `smtp_name` | `""` | Nom d'utilisateur de connexion SMTP. |
| `mail_from_address` | `""` | Partie locale de l'adresse d'expéditeur (avant le `@`). |
| `mail_domain` | `""` | Partie domaine de l'adresse d'expéditeur (après le `@`). |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence si erroné |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Nextcloud nécessite MySQL ; d'autres moteurs interrompent le job d'initialisation et le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, tous les fichiers utilisateur et `config.php` sont perdus à chaque démarrage à froid. |
| `enable_cloudsql_volume` | `true` | Critique | Nextcloud se connecte via un socket Unix ; la suppression du sidecar interrompt toutes les connexions à la base de données. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `application_domains` | inclure tous les noms d'hôtes d'accès | Critique | Nextcloud bloque les requêtes provenant de domaines non listés avec "Accès via un domaine non fiable". |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue au job d'importation. |
| `execution_environment` | `gen2` | Critique | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter NFS et le service ne démarre pas. |
| `enable_redis` | `true` | Élevé | Avec > 1 instance, les verrous de fichiers deviennent obsolètes et les écritures concurrentes renvoient HTTP 503. |
| `redis_host` | `""` ou IP explicite | Élevé | Pas de point de terminaison Redis valide lorsque NFS est désactivé et qu'aucun hôte n'est défini. |
| `upload_max_filesize` / `post_max_size` | augmenter pour les fichiers volumineux | Élevé | Intégré à l'image ; les fichiers dépassant la limite échouent silencieusement. `post_max_size` doit être ≥ `upload_max_filesize`. |
| `memory_limit` | `4Gi` | Élevé | Trop peu de mémoire provoque des OOM PHP lors de téléchargements volumineux ou de la génération de vignettes. |
| `NEXTCLOUD_UPDATE` | `1` (par défaut) ou `0` | Élevé | Laisser `1` lors d'une mise à niveau de version majeure peut corrompre la base de données. Définir sur `0` et exécuter `occ upgrade` manuellement. |
| `min_instance_count` | `1` pour l'utilisation de WebDAV | Moyen | La mise à l'échelle à zéro provoque des déconnexions à froid pour les clients de synchronisation de bureau. |
| `max_instance_count > 1` | nécessite Redis + NFS | Élevé | Plusieurs instances sans Redis provoquent des erreurs de verrouillage de fichiers et une éventuelle corruption des données. |
| `php_memory_limit` | `512M` (augmenter pour une utilisation intensive) | Moyen | Intégré à l'image ; nécessite une reconstruction pour être modifié. |
| `nextcloud_admin_user` | changer de `admin` | Moyen | Le `admin` par défaut est une cible courante de force brute sur les déploiements publics. |
| `enable_iap` / `enable_cloud_armor` | activer pour l'administration | Moyen | Sans cela, le panneau d'administration de Nextcloud est publiquement accessible. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle
et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**.
La configuration d'application spécifique à Nextcloud partagée avec la variante GKE est décrite
dans **[Nextcloud_Common](Nextcloud_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Nextcloud sur Cloud Run](../labs/Nextcloud_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Nextcloud sur GKE Autopilot](Nextcloud_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Nextcloud Common — Configuration d'application partagée](Nextcloud_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) dans la solution **Small Business Suite**.
