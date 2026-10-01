---
title: "Nextcloud sur GKE Autopilot"
description: "Référence de configuration pour déployer Nextcloud sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Nextcloud_GKE.md @ 3055034 sha256:5a348653e79e -->

# Nextcloud sur GKE Autopilot {#nextcloud-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Nextcloud_GKE.png" alt="Nextcloud sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Nextcloud est la principale plateforme auto-hébergée de synchronisation de fichiers et
de collaboration, utilisée par 400 millions d'utilisateurs dans plus de 100 000
organisations — dont des administrations et des établissements de santé à la recherche
d'une alternative à Google Drive et OneDrive conforme au RGPD. Ce module déploie
Nextcloud sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Nextcloud et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Nextcloud s'exécute en tant que charge de travail PHP/Apache. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Nextcloud ne prend pas en charge PostgreSQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoires `config/` et `data/` partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket `nc-data` provisionné par déploiement |
| Cache et verrouillage | Redis | Activé par défaut ; évite les conflits de verrouillage de fichiers entre réplicas |
| Secrets | Secret Manager | Mot de passe administrateur généré automatiquement ; secrets de configuration post-installation |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; choisir
  PostgreSQL ou `NONE` empêche le démarrage.
- **NFS est activé par défaut.** Tous les réplicas doivent partager `config.php` et
  le répertoire des données utilisateur. Sans NFS, chaque redémarrage de pod supprime
  les fichiers.
- **Redis est activé par défaut.** Sans cache et backend de verrouillage partagés, les
  écritures concurrentes entre réplicas provoquent des erreurs « File is locked ».
- **Les limites PHP sont intégrées à l'image du conteneur** au moment du build.
  Modifier `php_memory_limit`, `upload_max_filesize` ou `post_max_size` nécessite une
  nouvelle exécution de Cloud Build.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret
  Manager ; vous ne le définissez jamais en clair.
- **Le premier démarrage est volontairement lent.** Nextcloud exécute
  `occ maintenance:install` de manière synchrone avant le démarrage d'Apache. La sonde
  de démarrage accorde jusqu'à 10 minutes pour que la première installation se termine.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Nextcloud {#a-gke-autopilot--the-nextcloud-workload}

Les pods Nextcloud sont planifiés sur Autopilot, qui facture le CPU et la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods (Horizontal Pod
Autoscaling) dimensionne le déploiement entre les nombres minimal et maximal de
réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Nextcloud pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Run an occ command inside a running pod:
  POD=$(kubectl get pods -n "$NAMESPACE" -o name | grep nextcloud | head -1)
  kubectl exec -n "$NAMESPACE" -it "$POD" -- php occ status
  kubectl exec -n "$NAMESPACE" -it "$POD" -- php occ db:add-missing-indices
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Nextcloud stocke toutes les données applicatives (métadonnées des fichiers,
utilisateurs, partages, agenda et contacts) dans une instance gérée Cloud SQL for
MySQL 8.0. Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth
Proxy**, sur un socket Unix à `127.0.0.1:3306`, de sorte qu'aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de données
et l'utilisateur de l'application avec la collation `utf8mb4`.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les données des fichiers utilisateur de Nextcloud sont écrites sur un partage
**Filestore (NFS)** monté dans chaque pod. `entrypoint.sh` définit
`NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data` afin que tous les réplicas partagent
les mêmes fichiers utilisateur. `config.php` n'est **pas** stocké sur NFS — il est
reconstruit localement sur chaque pod à partir des secrets de Secret Manager (voir §3
« Secrets de configuration post-installation » ci-dessous). Un bucket **Cloud
Storage** `nc-data` est également provisionné par déploiement, et le compte de service
de la charge de travail y reçoit automatiquement l'accès.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<nc-data-bucket>/
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis et verrouillage de fichiers {#d-redis-cache-and-file-locking}

Redis sert de support au cache distribué de Nextcloud (`memcache.distributed`) et au
verrouillage de fichiers (`filelocking.enabled`). Avec plus d'un réplica, il est
obligatoire — sans lui, les écritures concurrentes produisent des erreurs HTTP 503
« File is locked ». Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est
activé, l'IP du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur de Nextcloud et quatre secrets de configuration
post-installation (ID d'instance, sel de mot de passe, secret applicatif et,
facultativement, le mot de passe d'authentification Redis) sont stockés dans Secret
Manager et injectés dans les pods à l'exécution. Les trois secrets de configuration
commencent avec la valeur provisoire `"UNSET"` ; le hook post-installation du
conteneur écrit les vraies valeurs une fois `occ maintenance:install` terminé.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~nextcloud"
  gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements. Les
domaines personnalisés sont également ajoutés automatiquement à la liste
`NEXTCLOUD_TRUSTED_DOMAINS` de Nextcloud.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Nextcloud {#3-nextcloud-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur Nextcloud avec le jeu de
  caractères `utf8mb4` et accorde les privilèges avant le démarrage de l'application.
  Il est idempotent et peut être réexécuté sans risque.
- **`occ maintenance:install` au premier démarrage.** Lors du tout premier démarrage,
  Nextcloud exécute sa routine d'installation de manière synchrone avant qu'Apache ne
  commence à servir. Cela peut prendre plusieurs minutes sur une instance Cloud SQL
  froide. La sonde de démarrage accorde jusqu'à 10 minutes (60 s de délai initial +
  20 échecs × 15 s de période) pour que cela se termine.
- **Secrets de configuration post-installation.** Une fois `occ maintenance:install`
  terminé, un hook du conteneur écrit les vraies valeurs de `instanceid`,
  `passwordsalt` et `secret` dans Secret Manager. Les démarrages de pods suivants les
  relisent pour reconstruire `config.php` sans avoir besoin de NFS.
- **Mise à niveau PHP au démarrage.** `NEXTCLOUD_UPDATE=1` est défini par défaut ;
  Nextcloud exécute donc `occ upgrade` automatiquement à chaque démarrage du conteneur.
  C'est voulu pour les montées de version mineures. Définissez `NEXTCLOUD_UPDATE=0`
  dans `environment_variables` et gérez les mises à niveau manuellement lors d'un
  changement de version majeure.
- **Domaines de confiance.** Nextcloud applique une liste blanche de domaines de
  confiance. Le module alimente `NEXTCLOUD_TRUSTED_DOMAINS` avec le nom DNS interne au
  cluster et les éventuels `application_domains`. Les requêtes provenant de noms
  d'hôte non listés reçoivent une erreur « Access through untrusted domain ».
- **NFS uniquement pour les données utilisateur.** NFS ne sert de support qu'au
  répertoire partagé des données utilisateur
  (`NEXTCLOUD_DATA_DIR=/mnt/nfs/nextcloud-data`). `config.php` n'est ni stocké sur NFS
  ni partagé via un lien symbolique — chaque réplica le reconstruit localement à
  partir des valeurs Secret Manager décrites ci-dessus, ce qui permet à tous les
  réplicas de converger vers la même configuration sans dépendre de NFS pour l'état
  de la configuration.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/status.php`,
  qui renvoie un HTTP 200 avec un objet JSON d'état quel que soit l'état de
  configuration de Nextcloud — ce qui en fait le point de terminaison de santé de
  référence.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  configurable ; le mot de passe est récupéré depuis Secret Manager (voir §2.E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Nextcloud ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nextcloud` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Nextcloud` | Nom convivial affiché dans la console. |
| `application_description` | `Nextcloud self-hosted collaboration and file sharing platform on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `30` | Tag de version de l'image Nextcloud ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Objet de ressources structuré ; remplace `cpu_limit`/`memory_limit` lorsqu'il est défini. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour les clients WebDAV qui maintiennent des connexions persistantes. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. Exige Redis + NFS lorsqu'il est > 1. |
| `container_port` | `80` | Nextcloud/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ SMTP_HOST = "", SMTP_PORT = "25", SMTP_USER = "", SMTP_PASSWORD = "", SMTP_SSL = "false", EMAIL_FROM = "ghost@example.com" }` | Paramètres non secrets supplémentaires injectés dans le pod (la valeur par défaut amorce des espaces réservés SMTP vides). Les variables principales de Nextcloud sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Cluster GKE cible. Découvert automatiquement s'il est vide. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement s'il est vide. |
| `workload_type` | `null` | Résolu automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant ; recommandé pour les opérations sur fichiers avec état. |
| `network_tags` | `['nfsserver']` | Le tag `nfsserver` est requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `30` | Délai de grâce avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC par pod ; sélectionne automatiquement StatefulSet lorsqu'il vaut `true`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin du PVC par pod dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour le provisionnement des PVC. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des entrées DNS de pods stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID défini comme `fsGroup` au niveau du pod pour la propriété des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones ; recommandé pour `min_instance_count > 1`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ path="/status.php", initial_delay_seconds=60, failure_threshold=20 }` | Accorde jusqu'à ~5 minutes pour l'`occ maintenance:install` du premier démarrage. |
| `liveness_probe` | `{ path="/status.php", initial_delay_seconds=120, failure_threshold=3 }` | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les tâches planifiées récurrentes. |
| `additional_services` | `[]` | Services GKE sidecar ou compagnons supplémentaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour la configuration et les données de Nextcloud. **Requis pour plusieurs réplicas.** |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom de la VM GCE NFS existante. Découvert automatiquement s'il est vide. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base de la VM NFS créée à la volée lorsqu'il n'en existe aucune. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets configurés (le bucket `nc-data` provient de `Nextcloud_Common`). |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket `nc-data` provisionné automatiquement. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour le cache distribué et le verrouillage de fichiers. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS ; définissez-le explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne la modifiez pas. |
| `application_database_name` | `gkeappdb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeappuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `db_name` | `nextcloud` | Alias pratique transmis à `Nextcloud_Common` en tant que `db_name`. |
| `db_user` | `nextcloud` | Alias pratique transmis à `Nextcloud_Common` en tant que `db_user`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restauration depuis une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte personnalisés ; également ajoutés à `NEXTCLOUD_TRUSTED_DOMAINS`. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Nextcloud. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (exige `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

### Groupe 23 — Paramètres de l'application Nextcloud {#group-23--nextcloud-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nextcloud_admin_user` | `admin` | Nom d'utilisateur de l'administrateur initial. Changez la valeur par défaut pour les déploiements exposés publiquement. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP — intégrée à l'image du conteneur au moment du build. À augmenter pour les opérations sur de gros fichiers. |
| `upload_max_filesize` | `512M` | Taille maximale des fichiers téléversés — intégrée à l'image. À augmenter pour le téléversement de vidéos ou d'archives. |
| `post_max_size` | `512M` | Limite du corps POST de PHP — doit être ≥ `upload_max_filesize`. |

### E-mail / SMTP {#email--smtp}

Il n'existe pas de variables SMTP dédiées — l'e-mail sortant se configure via la map
`environment_variables` (groupe 5), dont la valeur par défaut amorce les espaces
réservés `SMTP_HOST` (vide = e-mail désactivé ; les réinitialisations de mot de passe
et les notifications de partage ne fonctionneront pas), `SMTP_PORT` (`25`),
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` (`false`) et `EMAIL_FROM`. Renseignez-les avec
les valeurs de votre relais de messagerie pour activer l'e-mail.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Nextcloud (ajoute `/login` à l'URL de base). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Nextcloud exige MySQL ; les autres moteurs font échouer le job d'initialisation et le démarrage. |
| `enable_nfs` | `true` | Critical | Sans stockage partagé, tous les fichiers utilisateur et `config.php` sont perdus au redémarrage des pods. |
| `enable_cloudsql_volume` | `true` | Critical | Nextcloud se connecte via un socket Unix ; supprimer le sidecar casse toutes les connexions à la base de données au démarrage. |
| `application_database_name` / `_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `application_domains` | inclure tous les noms d'hôte d'accès | Critical | Nextcloud bloque les requêtes provenant de domaines non listés avec « Access through untrusted domain ». |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification. |
| `enable_redis` | `true` | High | Avec plus d'un réplica, les verrous de fichiers deviennent obsolètes et les écritures concurrentes renvoient HTTP 503. |
| `redis_host` | `""` ou IP explicite | High | Aucun point de terminaison Redis valide lorsque NFS est désactivé et qu'aucun hôte n'est défini. |
| `upload_max_filesize` / `post_max_size` | à augmenter pour les gros fichiers | High | Intégrées à l'image ; les fichiers dépassant la limite échouent silencieusement. `post_max_size` doit être ≥ `upload_max_filesize`. |
| `memory_limit` | `4Gi` | High | Une mémoire insuffisante provoque des OOM PHP lors de gros téléversements ou de la génération de miniatures. |
| `NEXTCLOUD_UPDATE` | `1` (par défaut) ou `0` | High | Laisser `1` lors d'une mise à niveau de version majeure peut corrompre la base de données. Définissez `0` et exécutez `occ upgrade` manuellement d'une version majeure à l'autre. |
| `min_instance_count` | `1` | High | `0` provoque des déconnexions liées aux démarrages à froid pour les clients de synchronisation WebDAV. |
| `max_instance_count > 1` | exige Redis + NFS | High | Plusieurs réplicas sans Redis provoquent des erreurs de verrouillage de fichiers et une possible corruption des données. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `nextcloud_admin_user` | à changer par rapport à `admin` | Medium | La valeur par défaut `admin` est une cible courante d'attaques par force brute sur les déploiements publics. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Medium | Sans ces options, le panneau d'administration de Nextcloud est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |
| `php_memory_limit` | `512M` (à augmenter pour un usage intensif) | Medium | Intégrée à l'image ; sa modification exige un nouveau build. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Nextcloud, partagée
avec la variante Cloud Run, est décrite dans
**[Nextcloud_Common](Nextcloud_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Nextcloud sur GKE Autopilot](../labs/Nextcloud_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Nextcloud Common — Configuration applicative partagée](Nextcloud_Common.md) — la configuration partagée par les deux cibles de déploiement.
