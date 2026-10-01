---
title: "Directus sur GKE Autopilot"
description: "Référence de configuration pour déployer Directus sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Directus_GKE.md @ 3055034 sha256:f58b978c793e -->

# Directus sur GKE Autopilot {#directus-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_GKE.png" alt="Directus sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Directus est une plateforme open source de CMS headless et de Backend-as-a-Service (BaaS) qui enveloppe n'importe quelle base de données SQL avec des API REST et GraphQL générées automatiquement et une application d'administration sans code. Ce module déploie Directus sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Directus et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée (ingress), autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Directus s'exécute comme une charge de travail Node.js. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Directus code en dur `DB_CLIENT = "pg"` |
| Fichiers partagés | Filestore (NFS) | Ressources et médias téléversés partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléversements ; GCS est le pilote de stockage Directus par défaut |
| Cache | Redis | Activé par défaut ; utilise par défaut l'IP de l'hôte NFS lorsqu'aucun hôte explicite n'est défini |
| Secrets | Secret Manager | KEY, SECRET, ADMIN_PASSWORD et URL de connexion REDIS générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Directus code en dur `DB_CLIENT = "pg"`. Passer à MySQL ou à `NONE` empêche le démarrage.
- **GCS est le pilote de stockage de fichiers par défaut.** `Directus_Common` injecte automatiquement `STORAGE_GCS_DRIVER`, `STORAGE_GCS_BUCKET` et `STORAGE_LOCATIONS = "gcs"`, de sorte que tous les téléversements vont dans le bucket Cloud Storage dédié.
- **La migration automatique et l'amorçage s'exécutent à chaque démarrage.** `AUTO_MIGRATE = "true"` applique au démarrage toute migration de schéma de base de données en attente. `BOOTSTRAP = "true"` crée l'utilisateur administrateur et les collections système au premier démarrage — les deux sont idempotents.
- **La mise à l'échelle à zéro est le comportement par défaut** (`min_instance_count = 0`). Directus utilise des sessions stockées dans Redis, de sorte que les démarrages à froid sont acceptables pour les déploiements dont la latence n'est pas critique. Définissez `min_instance_count = 1` pour éliminer les démarrages à froid en production.
- **Les KEY et SECRET de Directus** sont générés automatiquement et stockés dans Secret Manager. Les faire tourner après le premier déploiement invalide toutes les sessions et tous les JWT actifs.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Directus {#a-gke-autopilot--the-directus-workload}

Les pods Directus sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Directus pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  # Manually verify the Directus health endpoint from within the cluster:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- curl -sf http://localhost:8055/server/ping
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle et le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Directus stocke toutes les données applicatives dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** par un socket Unix. Lors du premier déploiement, un job `db-init` crée la base de données applicative et l'utilisateur, accorde les privilèges et installe les extensions `uuid-ossp` et `postgis`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous exposés dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les ressources téléversées sont écrites sur un partage **Filestore (NFS)** monté dans chaque pod, afin que tous les réplicas voient les mêmes fichiers. Un bucket **Cloud Storage** dédié aux téléversements est également provisionné ; Directus est configuré pour utiliser GCS comme pilote de stockage principal via `STORAGE_GCS_DRIVER = "gcs"`.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket de téléversements.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis sert de support à la mise en cache des réponses de l'API Directus et à l'état de limitation du débit. Lorsqu'aucun hôte Redis explicite n'est configuré et que NFS est activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis par défaut. L'URL de connexion Redis complète (y compris un éventuel mot de passe d'authentification) est stockée sous forme de secret Secret Manager et injectée comme variable d'environnement `REDIS`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  # From a host with network access:
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm REDIS is injected into the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Quatre secrets sont générés et stockés automatiquement : `KEY` (chiffrement des données), `SECRET` (signature des JWT), `ADMIN_PASSWORD` (compte administrateur initial) et `REDIS` (URL de connexion Redis lorsque Redis est activé). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password:
  gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"
  # Retrieve the DB password secret name from Outputs, then:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Le nom `database_password_secret` figure dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud Monitoring. Des tests de disponibilité (uptime checks) et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Directus {#3-directus-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` s'exécute à chaque apply (`execute_on_apply = true`). Il crée l'utilisateur de base de données Directus avec le mot de passe généré, crée la base de données `directus`, installe les extensions `uuid-ossp` et `postgis` (un échec de PostGIS n'est pas bloquant) et accorde l'ensemble des privilèges. Le job est idempotent.
- **Amorçage au premier démarrage.** `BOOTSTRAP = "true"` crée l'utilisateur administrateur initial et les collections système Directus au premier démarrage. L'e-mail de l'administrateur est par défaut `admin@example.com` — **remplacez-le via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement.**
- **Migrations à chaque démarrage.** `AUTO_MIGRATE = "true"` fait exécuter à Directus `database migrate:latest` à chaque démarrage de pod, de sorte que la mise à niveau de `application_version` applique automatiquement les changements de schéma.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent `/server/ping`, le point de terminaison de vivacité public et non authentifié de Directus (qui renvoie `pong`/200 dès que le serveur écoute) — `/server/health` exige une authentification administrateur et renverrait un 403 à une sonde non authentifiée. La sonde de démarrage accorde jusqu'à 300 secondes (`failure_threshold = 10`, `period_seconds = 30`) pour absorber la configuration de la base de données au premier démarrage.
- **Rotation de KEY et SECRET.** Faire tourner le secret `KEY` invalide immédiatement toutes les sessions utilisateur actives. Faire tourner `SECRET` invalide tous les JWT émis. Ne faites jamais tourner l'un ou l'autre sans fenêtre de maintenance planifiée ni notification des clients.
- **Connexion administrateur.** Récupérez le mot de passe administrateur généré dans Secret Manager (voir §2.E). L'e-mail administrateur par défaut est `admin@example.com`, sauf s'il a été remplacé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Directus ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Ne pas modifier après le premier déploiement. |
| `support_users` | `[]` | E-mails bénéficiant de l'accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `directus` | Nom de base des ressources. Ne pas modifier après le premier déploiement — il est intégré aux identifiants des secrets Secret Manager. |
| `application_display_name` | `Directus CMS` | Nom convivial affiché dans la console. |
| `application_version` | `11.1.0` | Tag de version de l'image Directus ; incrémentez-le pour déployer une nouvelle version. Épinglez un tag précis — évitez `latest` en production. |
| `description` | `Directus - Open Source Headless CMS and Backend-as-a-Service` | Annotation de description de la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (Cloud SQL, stockage, secrets) sans déployer la charge de travail. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour une génération d'API réactive. |
| `memory_limit` | `2Gi` | Mémoire par pod ; 2 GiB au minimum — augmentez-la pour les schémas volumineux ou les transformations d'images. |
| `min_instance_count` | `0` | Nombre minimal de réplicas. Définissez `1` pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8055` | Port d'écoute par défaut de Directus. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Remplacez `ADMIN_EMAIL` ici avant le premier déploiement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `workload_type` | `Deployment` | `Deployment` (sans état) ou `StatefulSet`. Pour la plupart des déploiements Directus, conservez la valeur par défaut et utilisez `enable_nfs = true` pour les ressources partagées. |
| `session_affinity` | `ClientIP` | Routage persistant (sticky). |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Activer les modèles de PVC par pod dans la spécification du StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC de pod. Ne peut pas être réduite après le provisionnement. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes pour les PVC. |
| `stateful_headless_service` | `true` | Créer un Service headless pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `OrderedReady` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | `RollingUpdate` ou `OnDelete`. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartir les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/server/ping`, HTTP, failure_threshold=10 | Sonde de démarrage Kubernetes. Accorde jusqu'à 300 s pour les migrations du premier démarrage. |
| `liveness_probe` | `/server/ping`, HTTP | Sonde de vivacité Kubernetes ; le pod est redémarré après 3 échecs consécutifs. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré fourni par `Directus_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par ex. purge du cache, synchronisation des données). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de Directus. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir [App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les ressources téléversées (à garder activé en multi-réplica). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets supplémentaires de `storage_buckets`. Le bucket de téléversements de `Directus_Common` est toujours provisionné. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires en plus du bucket de téléversements provisionné automatiquement. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la mise en cache et la limitation du débit. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP de l'hôte NFS ; définissez-le explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). L'URL de connexion complète est stockée dans Secret Manager. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Directus exige PostgreSQL. Ne pas modifier. |
| `db_name` | `directus` | Nom de la base de données PostgreSQL. Ne pas modifier après le premier déploiement. |
| `db_user` | `directus` | Utilisateur applicatif. Ne pas modifier après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` | `true` | Installer `uuid-ossp` (et éventuellement `postgis`) via `db-init`. |
| `postgres_extensions` | `["uuid-ossp"]` | Extensions à installer. Ajoutez `"postgis"` pour la prise en charge géospatiale. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définissez `enable_backup_import = false` immédiatement après une restauration réussie. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Directus. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Activer Cloud CDN via la Gateway API. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). Utilisez d'abord `vpc_sc_dry_run = true`. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP pour les services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Directus. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Directus exige PostgreSQL ; passer à MySQL ou à `NONE` empêche le démarrage et rend orpheline la base de données existante. |
| `application_name` | définie une seule fois | Critique | Intégré aux identifiants des secrets Secret Manager (KEY, SECRET, ADMIN_PASSWORD). Le modifier recrée tous les secrets — toutes les sessions et tous les JWT actifs sont immédiatement invalidés. |
| `tenant_id` | défini une seule fois | Critique | Le modifier après le premier déploiement rend orpheline l'instance Cloud SQL et génère une nouvelle base de données vide ainsi que de nouveaux KEY/SECRET, invalidant toutes les sessions. |
| Secrets `KEY` / `SECRET` | générés automatiquement, ne jamais les faire tourner à la légère | Critique | Faire tourner KEY déconnecte tous les utilisateurs. Faire tourner SECRET invalide tous les jetons d'API. Ne les faites tourner que pendant une fenêtre de maintenance planifiée. |
| Variable d'env. `ADMIN_EMAIL` | une adresse e-mail réelle | Élevé | La valeur par défaut `admin@example.com` crée le compte administrateur avec une adresse facile à deviner. Remplacez-la via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires (`4Gi`) | Critique | Des entiers nus (par ex. `"4"`) sont interprétés comme des octets — cela bloque définitivement la planification de tous les pods. |
| `enable_nfs` | `true` | Élevé | Sans NFS partagé, les ressources téléversées écrites par un pod sont invisibles pour les autres et perdues au redémarrage (sauf usage exclusif de GCS Fuse). |
| `enable_redis` | `true` en multi-réplica | Élevé | Sans Redis, chaque pod dispose d'un cache isolé ; la limitation du débit se fait par pod et la mise en cache de Directus ne fonctionne plus entre réplicas. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison Redis valide si Redis est activé, NFS désactivé et aucun hôte défini. |
| `startup_probe.failure_threshold` | `10` ou plus au premier déploiement | Élevé | Trop bas : les migrations Directus peuvent prendre 1 à 3 minutes sur une base de données neuve ; le pod est tué avant la fin des migrations, ce qui provoque une boucle de redémarrage. |
| `enable_backup_import` | `false` après restauration | Élevé | Le laisser à `true` relance l'import à chaque apply, écrasant les données en production par la sauvegarde obsolète. |
| `memory_limit` | `2Gi` | Élevé | Une mémoire insuffisante provoque des arrêts OOM lors du chargement du schéma ou des transformations d'images. |
| `min_instance_count` | `1` en production | Moyen | `0` en production provoque des démarrages à froid de 20 à 40 s sur la première requête API après une période d'inactivité. |
| `enable_pod_disruption_budget` + `pdb_min_available` | prévoir une marge | Moyen | `pdb_min_available = "1"` avec `min_instance_count = 1` bloque définitivement le drainage des nœuds. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Moyen | Sinon, l'interface d'administration est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | commencer par `vpc_sc_dry_run = true` | Critique | Activer l'application sans inclure le compte de service dans le niveau d'accès bloque simultanément Cloud SQL, Secret Manager et Artifact Registry. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Directus, partagée avec la variante Cloud Run, est décrite dans **[Directus_Common](Directus_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Directus sur GKE Autopilot](../labs/Directus_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Directus sur Cloud Run](Directus_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Directus Common — Configuration applicative partagée](Directus_Common.md) — la configuration partagée par les deux cibles de déploiement.
