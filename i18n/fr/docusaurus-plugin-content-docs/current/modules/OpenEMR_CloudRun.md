---
title: "OpenEMR sur Google Cloud Run"
description: "Référence de configuration pour déployer OpenEMR sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenEMR_CloudRun.md @ 3055034 sha256:9f0f0902b41a -->

# OpenEMR sur Google Cloud Run {#openemr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_CloudRun.png" alt="OpenEMR sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenEMR est le système open source de dossiers médicaux électroniques (DME) et de gestion de cabinet
le plus largement adopté au monde, utilisé par plus de 100 000 professionnels de santé dans plus de 100
pays. Ce module déploie OpenEMR sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise OpenEMR et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — consultez le
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenEMR s'exécute sous forme de conteneur Apache/PHP 8.3 FPM sur Cloud Run v2. Le déploiement associe
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache/PHP, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — OpenEMR ne prend pas en charge PostgreSQL |
| Documents des patients | Filestore (NFS) | Répertoire `sites/` contenant les documents des patients, le cache de session et l'état de l'application, partagé entre toutes les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket de données à usage général |
| Magasin de sessions | Redis | Activé par défaut ; se replie sur l'IP du serveur NFS lorsqu'aucun hôte Redis n'est indiqué |
| Secrets | Secret Manager | Mot de passe administrateur (`OE_PASS`) et mot de passe de la base de données (`MYSQL_PASS`) générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Sélectionner PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est obligatoire et nécessite `gen2`.** Le répertoire `sites/` d'OpenEMR — qui contient
  `sqlconf.php`, les documents des patients, les caches Twig/Smarty et les fichiers téléversés — doit se trouver
  sur un volume NFS partagé, monté via l'environnement d'exécution gen2 de Cloud Run.
- **La sonde de démarrage est TCP, pas HTTP.** Le trafic de santé de Cloud Run arrive en HTTP
  simple. La pile Apache/PHP d'OpenEMR peut ne pas encore servir le HTTP pendant la phase
  d'installation au premier démarrage, si bien qu'une sonde HTTP expirerait. Une sonde TCP vérifie seulement que
  le port est ouvert et laisse l'installateur se terminer.
- **L'installation au premier démarrage est automatisée et lente.** Lors du premier déploiement, deux jobs
  d'initialisation s'exécutent — `nfs-init` (préparation des répertoires NFS et restauration facultative d'une sauvegarde) et `db-init`
  (création de l'utilisateur et de la base de données MySQL) — après quoi le conteneur lui-même exécute
  `auto_configure.php` pour installer le schéma de la base de données. Cela peut prendre de 5 à 20 minutes.
- Le **mot de passe administrateur** d'OpenEMR est généré automatiquement et stocké dans Secret
  Manager ; vous ne le définissez jamais en clair.
- **`min_instance_count` vaut 1 par défaut.** La mise à l'échelle à zéro n'est pas recommandée pour
  les systèmes de DME cliniques — les démarrages à froid ajoutent une latence que les cliniciens peuvent interpréter comme une
  panne du système.
- **`max_instance_count` vaut 1 par défaut.** N'augmentez cette valeur qu'après avoir vérifié que le partage des sessions
  via Redis est opérationnel ; plusieurs instances sans Redis entraînent la perte des sessions PHP.
- **`cpu_always_allocated` vaut `true` par défaut.** La configuration au premier démarrage d'OpenEMR (vidage du cache
  Twig, vérification en base de la mise en page de la page de connexion et passe récursive de durcissement des permissions de fichiers)
  est un travail en arrière-plan qui n'est lié à aucune requête entrante particulière. Avec la facturation
  à la requête (`false`), Cloud Run réduit le CPU quasiment à zéro entre les requêtes, si bien que cette
  configuration ponctuelle peut prendre de nombreuses minutes, voire ne jamais se terminer — confirmé en conditions réelles :
  la même séquence de démarrage est passée d'un état bloqué à une page de connexion entièrement affichée en moins de
  15s une fois cette option définie à `true`. Ne la repassez à `false` qu'après avoir vérifié que l'instance
  a dépassé le premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenEMR {#a-cloud-run--the-openemr-service}

OpenEMR s'exécute sous forme de service Cloud Run v2. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements progressifs. Le service nécessite
l'**environnement d'exécution gen2** pour la prise en charge des volumes NFS.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les
  métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

OpenEMR stocke toutes les données cliniques dans une instance Cloud SQL for MySQL 8.0 gérée. Le
service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix
(sans IP publique). Lors du premier déploiement, le job Cloud Run `db-init` crée la base de données
applicative et l'utilisateur ; la tâche `nfs-init` prépare le répertoire NFS `sites/`.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `sites/` d'OpenEMR est écrit sur un partage **Filestore (NFS)** monté dans
le service sur `/var/www/localhost/htdocs/openemr/sites`. Ce répertoire contient
`sqlconf.php` (qui signale la fin de l'installation), les documents téléversés pour les patients
et les caches de templates Twig/Smarty. Toutes les instances doivent partager le même montage NFS. Un
bucket **Cloud Storage** à usage général est également provisionné.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  # Inspect the nfs-init job execution logs:
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Magasin de sessions Redis {#d-redis-session-store}

Redis sert de magasin de sessions PHP à OpenEMR. Lorsque `redis_host` est laissé vide et que NFS est
activé, l'instance Redis colocalisée sur le serveur NFS est utilisée automatiquement. Dans les
déploiements à plusieurs instances, un magasin de sessions partagé est nécessaire pour éviter la perte des sessions.

- **Console :** Memorystore → Redis (si vous utilisez une instance Memorystore gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur d'OpenEMR (`OE_PASS`) et le mot de passe de la base de données MySQL (`MYSQL_PASS`)
sont stockés dans Secret Manager et injectés dans le service à l'exécution. Ils n'apparaissent jamais en clair
dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password to log in for the first time:
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```

L'ID du secret du mot de passe administrateur est exposé par la sortie `admin_password_secret_id`. Consultez
[App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus.
Les paramètres d'entrée et la sortie VPC contrôlent le trafic à destination et en provenance du service.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées vers Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenEMR {#3-openemr-application-behaviour}

- **Deux jobs d'initialisation s'exécutent à chaque déploiement.**

  | Tâche | Rôle | Image |
  |---|---|---|
  | `nfs-init` | Prépare l'arborescence du répertoire NFS `sites/`, attribue la propriété à l'UID 1000 (Apache) et restaure éventuellement une sauvegarde lorsque `backup_uri` est défini | `google-cloud-cli:alpine` |
  | `db-init` | Crée la base de données MySQL et l'utilisateur applicatif | `mysql:8.0-debian` |

  Inspectez les tâches et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```

- **L'installation du schéma au premier démarrage prend de 5 à 20 minutes.** Une fois les jobs d'initialisation terminés,
  le conteneur du service exécute `auto_configure.php` pour installer le schéma de la base de données
  OpenEMR et créer le compte administrateur. Pendant cette phase, un serveur web PHP intégré temporaire
  renvoie HTTP 200 sur le chemin de la sonde de démarrage, ce qui empêche l'instance d'être
  arrêtée pendant que l'installateur s'exécute.

- **La sonde de démarrage est TCP.** La sonde de démarrage Cloud Run est par défaut une sonde TCP sur le port 80 afin
  d'éviter de faux échecs pendant la phase d'installation au premier démarrage, lorsque Apache/PHP ne
  sert peut-être pas encore de réponses HTTP.

- **Mises à niveau tenant compte de la version.** Lors des déploiements suivants, le script de démarrage compare
  la version de l'image à la version stockée sur NFS et exécute automatiquement les scripts de mise à niveau
  appropriés (`fsupgrade-N.sh`).

- **Connexion administrateur.** Le nom d'utilisateur initial de l'administrateur est `admin`. Le mot de passe est
  généré automatiquement et stocké dans Secret Manager — récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```
  Si le compte administrateur est verrouillé après des tentatives de connexion échouées, utilisez l'utilitaire
  `/root/unlock_admin.sh <new_password>` depuis l'intérieur du conteneur en cours d'exécution.

- **Considérations HIPAA.** OpenEMR stocke des informations de santé protégées (PHI). Pour
  les déploiements soumis à HIPAA, activez `enable_iap` ou `enable_cloud_armor` pour restreindre
  l'accès, définissez `enable_audit_logging = true` et portez `backup_retention_days` à au
  moins 90.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à OpenEMR ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `openemr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenEMR` | Nom convivial affiché dans la console. |
| `description` | _(définie)_ | Description du service. |
| `application_version` | `7.0.4` | Tag de version de l'image OpenEMR ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure sans déployer le conteneur. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés pour des charges de travail cliniques concurrentes. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés. En dessous de 2 GiB, des arrêts OOM se produisent sous charge clinique. |
| `cpu_always_allocated` | `true` | Alloue le CPU en permanence (facturation à l'instance), et pas seulement pendant les requêtes. La configuration en arrière-plan au premier démarrage d'OpenEMR (vidage du cache Twig, vérification de la mise en page en base, passe de durcissement des permissions) nécessite un CPU continu ; avec la facturation à la requête (`false`), le CPU est réduit quasiment à zéro et la configuration peut rester bloquée pendant de nombreuses minutes, voire ne jamais se terminer. |
| `min_instance_count` | `1` | Nombre minimal d'instances. Conservez ≥ 1 pour éviter les délais de démarrage à froid pour les utilisateurs cliniques. |
| `max_instance_count` | `1` | N'augmentez cette valeur qu'après avoir vérifié que le partage des sessions via Redis est opérationnel. |
| `container_port` | `80` | OpenEMR/Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | **Doit rester `gen2`** pour la prise en charge des volumes NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. À augmenter pour la génération de rapports ou le téléversement de fichiers volumineux. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service. Utilisez `internal-and-cloud-load-balancing` pour les déploiements HIPAA placés derrière un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Manière dont le trafic sortant est routé via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. Recommandé pour un accès réservé au personnel clinique. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales `MYSQL_*` et `OE_*` sont définies automatiquement. Ajouts courants : `PHP_MEMORY_LIMIT`, `SMTP_HOST`, `SMTP_PORT`. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom d'un secret Secret Manager. À utiliser pour les valeurs sensibles comme les identifiants SMTP. |
| `secret_propagation_delay` / `secret_rotation_period` | _(définies)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). **Ne pas désactiver pour les déploiements soumis à HIPAA.** |
| `backup_retention_days` | `7` | Rétention ; à porter à 30–90 pour la production/la conformité. |
| `enable_backup_import` | `false` | Restaure une sauvegarde lors du déploiement. |
| `backup_source` | `gcs` | Source de l'import : `gcs` ou `gdrive`. |
| `backup_uri` | `""` | URI GCS (`gs://bucket/path`) ou ID de fichier Google Drive. Lorsqu'il est défini, il est injecté dans `nfs-init` sous la forme `BACKUP_FILEID`. |
| `backup_format` | `sql` | Format du fichier de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz` ou `zip`. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(définies)_ | Instance NFS existante / nom de base pour une instance inline. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Doit rester `true`.** OpenEMR a besoin de NFS pour le répertoire `sites/`. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Chemin de montage. Doit correspondre au répertoire sites d'OpenEMR. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(définies)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. OpenEMR nécessite MySQL. |
| `db_name` | `openemr` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `openemr` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les informations de connexion sont injectées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la séquence intégrée `nfs-init` / `db-init`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents appelés selon une planification. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP** sur le port 80, 12 échecs × 10s | Sonde de démarrage TCP. Évite les échecs de sonde HTTP pendant la phase d'installation au premier démarrage. |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 10 échecs × 30s | La page de connexion ne renvoie HTTP 200 que lorsque toute la pile est opérationnelle. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring. Activez-le explicitement une fois le service joignable. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Magasin de sessions Redis {#group-21--redis-session-store}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le stockage des sessions PHP. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS ; définissez-le explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC. Nécessite que `organization_id` soit défini explicitement. Recommandé pour les environnements HIPAA. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés (DATA_READ, DATA_WRITE). Recommandé pour la conformité HIPAA. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `admin_password_secret_id` | ID du secret Secret Manager contenant le mot de passe administrateur d'OpenEMR (`OE_PASS`). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données (`MYSQL_PASS`). |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `nfs_server_ip` | IP interne du serveur NFS (sensible). |
| `nfs_instance_tags` | Tags réseau de l'instance NFS. |
| `nfs_mount_path` | Chemin de montage NFS dans le conteneur. |
| `nfs_share_path` | Chemin du partage NFS sur le serveur. |
| `nfs_setup_job` | Nom de la tâche de configuration NFS. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | OpenEMR ne peut pas fonctionner sans NFS. Le répertoire `sites/`, `sqlconf.php` et les documents des patients résident tous sur NFS. Le désactiver provoque un échec immédiat au démarrage. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Critical | Doit correspondre au chemin du répertoire sites d'OpenEMR. En cas de non-correspondance, `nfs-init` prépare le mauvais emplacement et le conteneur ne trouve jamais de `sqlconf.php` configuré. |
| `execution_environment` | `gen2` | Critical | `gen1` ne prend pas en charge les montages NFS ; le service ne démarre pas. |
| `database_type` | `MYSQL_8_0` | Critical | OpenEMR nécessite MySQL ; PostgreSQL ou `NONE` casse l'installateur et tous les appels PHP à la base de données. |
| `db_name` / `db_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données des patients. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import et peut corrompre le répertoire sites sur NFS. |
| `backup_schedule` | `0 2 * * *` | Critical | Désactiver les sauvegardes d'un DME contenant des PHI constitue une violation de la conformité HIPAA. |
| `startup_probe` | TCP (par défaut) | High | Une sonde HTTP échoue pendant la phase d'installation au premier démarrage, lorsque Apache n'a pas encore complètement démarré, ce qui conduit Cloud Run à redémarrer le conteneur avant la fin de la configuration. |
| `enable_redis` | `true` | High | Plusieurs instances avec des magasins de sessions PHP isolés entraînent des pertes de session et des échecs de connexion pour les utilisateurs cliniques. |
| `redis_host` | `""` (NFS) ou explicite | High | Un hôte Redis injoignable provoque des échecs de session PHP et empêche toute connexion. |
| `memory_limit` | ≥ `4Gi` | High | La génération de PDF et les rapports de facturation d'OpenEMR sont gourmands en mémoire. En dessous de 2 GiB, des arrêts OOM se produisent en cours de requête. |
| `min_instance_count` | `1` | High | La mise à l'échelle à zéro ajoute une latence de démarrage à froid et expose à des accès cliniques manqués. |
| `cpu_always_allocated` | `true` | High | La configuration au premier démarrage d'OpenEMR (vidage du cache Twig, vérification de la mise en page en base, passe de durcissement des permissions) est un travail en arrière-plan, non lié à une requête. Avec la facturation à la requête (`false`), le CPU est réduit quasiment à zéro entre les requêtes, si bien que le premier démarrage peut prendre de nombreuses minutes, voire ne jamais se terminer — confirmé en conditions réelles : un démarrage identique est passé d'un état bloqué à une page de connexion affichée en &lt;15s une fois l'option définie à `true`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Les environnements soumis à HIPAA doivent conserver au moins 90 jours. |
| `enable_iap` / `enable_cloud_armor` | à activer dans le secteur de la santé | Medium | Sans ces contrôles, l'interface d'administration d'OpenEMR et les dossiers des patients sont joignables publiquement. |
| `enable_audit_logging` | `true` pour HIPAA | Medium | HIPAA exige la journalisation des accès aux PHI. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**.
La configuration applicative propre à OpenEMR partagée avec la variante GKE est décrite dans
**[OpenEMR_Common](OpenEMR_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenEMR sur Cloud Run](../labs/OpenEMR_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OpenEMR sur GKE Autopilot](OpenEMR_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenEMR Common — Configuration applicative partagée](OpenEMR_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) et [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md) dans la solution **Clinic & Practice Management**.
