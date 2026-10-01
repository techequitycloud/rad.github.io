---
title: "Wiki.js sur GKE Autopilot"
description: "Référence de configuration pour déployer Wiki.js sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Wikijs_GKE.md @ 944fee5 sha256:fd8d0f231151 -->

# Wiki.js sur GKE Autopilot {#wikijs-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_GKE.png" alt="Wiki.js sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wiki.js est une puissante plateforme wiki open source conçue pour les équipes qui ont besoin d'une gestion
des connaissances moderne et rapide, avec un contrôle de version adossé à Git et une expérience de rédaction
épurée. Ce module déploie Wiki.js sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Wiki.js et sur la manière de les explorer et de les exploiter
depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Wiki.js s'exécute sous la forme d'une charge de travail web Node.js. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Wiki.js utilise PostgreSQL avec l'extension `pg_trgm` pour la recherche plein texte |
| Fichiers partagés | Filestore (NFS) | Ressources téléversées partagées entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket dédié `wikijs-storage`, montable via GCS Fuse dans `/wiki-storage` |
| Cache (facultatif) | Redis | Désactivé par défaut ; activez-le pour la mise en cache des sessions dans les déploiements à plusieurs réplicas |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé ; utiliser MySQL ou `NONE`
  empêche le démarrage. L'extension `pg_trgm` est installée automatiquement et est requise
  pour la recherche plein texte de Wiki.js.
- **NFS est activé par défaut.** Avec plus d'un réplica, un volume NFS partagé est
  nécessaire pour que tous les pods voient les mêmes fichiers téléversés.
- **Port 3000.** Wiki.js écoute sur le port 3000, et non sur les ports habituels 80 ou 8080.
- **L'affinité de session est `ClientIP`.** Wiki.js conserve un contexte de session en mémoire ;
  le routage persistant maintient les requêtes d'un même utilisateur sur le même pod.
- **La base de données est amorcée lors du premier déploiement** par un job `db-init` qui crée
  l'utilisateur, la base de données et le schéma PostgreSQL. La sonde de démarrage utilise `/healthz` avec un
  délai initial de 60 secondes pour laisser le temps à cette opération.
- **Le chemin de stockage des ressources compte.** `HA_STORAGE_PATH=/wiki-storage` indique à Wiki.js où
  écrire les fichiers téléversés. Le volume NFS ou GCS Fuse doit être monté au même chemin.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Wiki.js {#a-gke-autopilot--the-wikijs-workload}

Les pods Wiki.js sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal
et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Wiki.js pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Wiki.js stocke toutes les données de l'application (pages, utilisateurs, navigation, index de recherche) dans une
instance gérée Cloud SQL for PostgreSQL 15. L'extension `pg_trgm` est installée
lors du provisionnement et alimente la recherche plein texte native de Wiki.js. Les pods accèdent à la
base de données de façon privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix,
si bien qu'aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la
base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les ressources téléversées sont écrites sur un partage **Filestore (NFS)** monté dans chaque pod, afin que
tous les réplicas voient les mêmes fichiers. Un bucket **Cloud Storage** dédié (`wikijs-storage`)
est également provisionné pour le stockage persistant des ressources ; il peut être monté dans `/wiki-storage`
via le pilote CSI GCS Fuse.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de stockage.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis est désactivé par défaut. Lorsqu'il est activé, il assure la mise en cache des sessions entre
les réplicas. Définissez `enable_redis = true` et renseignez `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké sous la forme d'un secret Secret Manager et injecté dans les pods à
l'exécution ; il n'apparaît jamais en clair dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut
être réservée pour que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Wiki.js {#3-wikijs-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Un job d'initialisation (`db-init`) utilise
  l'image `postgres:15-alpine` pour se connecter via le Cloud SQL Auth Proxy, créer de manière idempotente
  la base de données et l'utilisateur `wikijs`, et accorder les droits nécessaires. L'extension
  PostgreSQL `pg_trgm` est ensuite installée par le socle dans le cadre de la
  configuration `enable_postgres_extensions = true` / `postgres_extensions = ["pg_trgm"]`
  fournie par `Wikijs_Common`. Le job peut être relancé sans risque.
- **Migration du schéma au premier démarrage.** Wiki.js se connecte à PostgreSQL au démarrage et
  exécute sa propre migration interne du schéma. C'est pourquoi la sonde de démarrage comporte un
  délai initial de 60 secondes — laissez au schéma de la base de données le temps d'être entièrement initialisé
  avant le début des contrôles de santé.
- **Chemin de stockage des ressources.** Wiki.js écrit les fichiers téléversés dans le chemin défini par
  `HA_STORAGE_PATH` (par défaut `/wiki-storage`). Le chemin de montage NFS et cette variable
  doivent désigner le même emplacement physique. Avec `enable_nfs = true`, montez le partage
  NFS dans `/wiki-storage` ou modifiez `nfs_mount_path` et `HA_STORAGE_PATH` ensemble.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité utilisent toutes deux `/healthz`, qui
  ne renvoie HTTP 200 qu'une fois Wiki.js en cours d'exécution et connecté à PostgreSQL. Ne le
  remplacez pas par `/` — le chemin de l'interface est lent à s'afficher et peut renvoyer des erreurs pendant
  le démarrage.
- **Affinité de session.** `session_affinity = "ClientIP"` est la valeur par défaut. Wiki.js
  conserve un contexte de session en mémoire ; le routage persistant maintient une session de navigateur sur le
  même pod.
- **Redis est facultatif.** Wiki.js n'a pas besoin de Redis pour son fonctionnement de base. Activez-le
  lorsque vous souhaitez une mise en cache des sessions au niveau applicatif dans les déploiements à plusieurs réplicas.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Wiki.js ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wikijs` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Wiki.js` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.5.311` | Tag de version de l'image Wiki.js ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build ; `prebuilt` utilise l'URI d'une image existante. |
| `container_image` | `requarks/wiki:2` | Image amont de Docker Hub utilisée comme base Cloud Build. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Demandes/limites de ressources par pod. |
| `container_port` | `3000` | Port du serveur Node.js de Wiki.js — ne le modifiez pas. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (conservez ≥ 1 pour éviter les démarrages à froid). |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_image_mirroring` | `true` | Met en miroir `requarks/wiki:2` depuis Docker Hub dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ DB_TYPE="postgres", DB_PORT="5432", DB_USER="wikijs", DB_NAME="wikijs", DB_SSL="false", HA_STORAGE_PATH="/wiki-storage" }` | Prérenseignée avec les paramètres de connexion à la base de données de Wiki.js. Valeurs essentielles — ne les supprimez pas. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. `DB_PASS` est câblée automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant pour le contexte de session en mémoire. |
| `workload_type` | `null` | Se résout automatiquement en Deployment ; définissez `StatefulSet` pour un stockage par pod. |
| `network_tags` | `["nfsserver"]` | Nécessaire à la connectivité NFS — ne le supprimez pas. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans un StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage dans chaque pod. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, délai initial de 60 s | Sonde de démarrage — délai généreux pour la migration de la base de données au premier démarrage. |
| `health_check_config` | HTTP `/healthz`, délai initial de 60 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` de `Wikijs_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, exports ou sauvegardes planifiés). |
| `additional_services` | `[]` | Deployments sidecar ou auxiliaires aux côtés de Wiki.js. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les ressources de Wiki.js (à conserver activé en cas de réplicas multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur — doit concorder avec `HA_STORAGE_PATH`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de stockage. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires, en plus du bucket `wikijs-storage`. |
| `gcs_volumes` | `[]` | Monte le bucket `wikijs-storage` via GCS Fuse dans `/wiki-storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour la mise en cache des sessions (facultatif pour Wiki.js). |
| `redis_host` | `""` | Point de terminaison Redis. Obligatoire lorsque `enable_redis = true`, **sauf** si `enable_nfs = true`, auquel cas l'IP du serveur NFS est utilisée comme hôte Redis par défaut. `enable_nfs` vaut `true` par défaut pour ce module : `redis_host` n'est donc pas réellement obligatoire dans la configuration par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé — ne le modifiez pas. Wiki.js nécessite PostgreSQL. |
| `application_database_name` | `wikijs` | Nom de la base de données. Immuable après le premier déploiement ; doit correspondre à `DB_NAME`. |
| `application_database_user` | `wikijs` | Utilisateur applicatif. Immuable après le premier déploiement ; doit correspondre à `DB_USER`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |
| `enable_postgres_extensions` | `true` | Installe les extensions — nécessaire pour `pg_trgm`. |
| `postgres_extensions` | `["pg_trgm"]` | Nécessaire à la recherche plein texte. Ne le supprimez pas. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Wiki.js. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Wiki.js. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Wiki.js nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `application_database_name` / `DB_NAME` | `wikijs` pour les deux | Critical | En cas d'incohérence, `db-init` crée une autre base de données que celle à laquelle Wiki.js se connecte — boucle de plantage. Immuable après le premier déploiement. |
| `enable_postgres_extensions` / `postgres_extensions` | `true` / `["pg_trgm"]` | Critical | Supprimer `pg_trgm` désactive toute la recherche plein texte avec une erreur de fonction introuvable. |
| `quota_memory_requests` / `_limits` | unités binaires (`Gi`, `Mi`) | Critical | Les entiers bruts sont des octets — toute planification de pod est bloquée. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| `enable_cloudsql_volume` | `true` | Critical | Le désactiver supprime le sidecar Auth Proxy — toutes les connexions PostgreSQL échouent. |
| `application_database_user` / `DB_USER` | `wikijs` pour les deux | High | En cas d'incohérence, les droits sont accordés à un utilisateur alors que Wiki.js s'authentifie avec un autre — échec d'authentification. |
| `enable_nfs` | `true` | High | Sans stockage partagé, les fichiers téléversés écrits par un pod sont invisibles pour les autres et perdus au redémarrage. |
| `nfs_mount_path` + `HA_STORAGE_PATH` | `/wiki-storage` pour les deux | High | Si le chemin de montage NFS et `HA_STORAGE_PATH` ne concordent pas, Wiki.js écrit sur le disque éphémère du pod. |
| `container_resources.memory_limit` | `2Gi` | High | En dessous de `1Gi`, Wiki.js est arrêté pour manque de mémoire (OOM) au démarrage ou sous charge. |
| `startup_probe_config.initial_delay_seconds` | `60` | High | Trop bas — Wiki.js est arrêté avant la fin de la migration du schéma au premier démarrage. |
| `min_instance_count` | `1` | High | La mise à zéro provoque des démarrages à froid de 15 à 30 s et des reconnexions à la base de données en cours de requête. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les déploiements à plusieurs réplicas perdent le contexte de session en mémoire. |
| `application_version` | `2.5.311` | High | Les schémas de Wiki.js 2.x et 3.x sont incompatibles. Testez les mises à niveau en préproduction. |
| `network_tags` | `["nfsserver"]` | High | Supprimer le tag casse la règle de pare-feu NFS — le montage échoue. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les wikis internes | Medium | Sinon, la page de connexion de Wiki.js est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | prévoir une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `enable_redis` | `false`, sauf besoin | Low | Wiki.js n'a pas besoin de Redis pour son fonctionnement de base. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Wiki.js partagée avec la variante Cloud Run est décrite dans
**[Wikijs_Common](Wikijs_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wiki.js sur GKE Autopilot](../labs/Wikijs_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Wiki.js sur Google Cloud Run](Wikijs_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wikijs Common — Configuration applicative partagée](Wikijs_Common.md) — la configuration partagée par les deux cibles de déploiement.
