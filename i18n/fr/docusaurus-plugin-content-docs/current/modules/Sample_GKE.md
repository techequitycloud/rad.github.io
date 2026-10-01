---
title: "Application Sample sur GKE Autopilot"
description: "Référence de configuration pour déployer l'application Sample sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Sample_GKE.md @ 3055034 sha256:78a123cf99f9 -->

# Application Sample sur GKE Autopilot {#sample-application-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Sample_GKE.png" alt="Application Sample sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Le module Sample est une implémentation de référence qui montre comment les modules
applicatifs sont construits sur cette plateforme. Il déploie une application web Flask
minimale (Python 3.11, PostgreSQL 15, Redis facultatif, NFS facultatif) sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par l'application Sample et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

L'application Sample s'exécute sous forme de charge de travail web Python/Gunicorn. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Flask/Gunicorn, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire ; la tâche `db-init` crée le schéma au premier déploiement |
| Fichiers partagés | Filestore (NFS) | Activé par défaut ; volume partagé monté sur `/mnt/nfs` |
| Stockage d'objets | Cloud Storage | Un unique bucket `data` provisionné par défaut |
| Cache et sessions | Redis | Facultatif (`enable_redis = false` par défaut) ; lorsqu'il est activé, un sidecar interne `redis:alpine` est déployé |
| Secrets | Secret Manager | `SECRET_KEY` Flask généré automatiquement et stocké au moment du déploiement |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé + Gateway API en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est imposé.** Le moteur de base de données est fixé à `POSTGRES_15` par
  `Sample_Common` et ne peut pas être remplacé par MySQL ni par `NONE` dans ce module.
- **Une tâche `db-init` s'exécute à chaque premier déploiement** pour créer la base de
  données PostgreSQL, l'utilisateur et le schéma. Elle est idempotente et peut être
  relancée sans risque.
- **Redis est désactivé par défaut.** Lorsque `enable_redis = true` et que `redis_host`
  est vide, le module déploie automatiquement un sidecar interne `redis:alpine` et définit
  `REDIS_HOST=127.0.0.1`.
- **Le `SECRET_KEY` Flask est généré automatiquement** et stocké dans Secret Manager ; il
  n'est jamais défini en clair.
- **`min_instance_count` est forcé à `1` en interne.** Même si vous le définissez à `0`,
  le module maintient au moins un pod en cours d'exécution pour éviter les délais de
  démarrage à froid sur GKE.
- **Les sondes de santé ciblent par défaut TCP/la racine, et non `/healthz`.**
  `startup_probe_config` correspond par défaut à une simple vérification TCP (seul
  `enabled = true` est défini ; le type et le chemin reprennent les valeurs par défaut
  TCP/`/` du socle) et `health_check_config` (vivacité) correspond par défaut à
  `HTTP GET /` — la même route de compteur de visiteurs que la page racine. L'application
  Flask expose également un point de terminaison léger `/healthz` (HTTP GET, renvoie
  `{"status": "healthy"}`, sans requête à la base de données) ; définissez le `path` de la
  sonde à `/healthz` pour l'utiliser.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Sample {#a-gke-autopilot--the-sample-workload}

Les pods de l'application Flask sont planifiés sur Autopilot, qui facture le CPU et la
mémoire réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Sample
  pour les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress
  affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

L'application Sample stocke son compteur de visiteurs dans une instance gérée Cloud SQL
for PostgreSQL 15. Les pods s'y connectent de manière privée via le sidecar **Cloud SQL
Auth Proxy** sur un socket Unix ; aucune adresse IP publique n'est donc exposée. Au
premier déploiement, une Job d'initialisation crée la base de données de l'application,
l'utilisateur et accorde les privilèges.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Lorsque `enable_nfs = true` (valeur par défaut), un partage **Filestore (NFS)** est monté
dans chaque pod sur `/mnt/nfs` afin que tous les réplicas voient les mêmes fichiers. Un
bucket **Cloud Storage** dédié est également provisionné ; le compte de service de la
charge de travail y reçoit automatiquement l'accès.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Lorsque `enable_redis = true`, un service interne `redis:alpine` est déployé aux côtés de
l'application. L'application Flask l'utilise pour stocker les sessions côté serveur via
`Flask-Session`. Les variables d'environnement `ENABLE_REDIS`, `REDIS_HOST` et
`REDIS_PORT` sont injectées automatiquement.

- **Console :** Kubernetes Engine → Workloads — le Deployment Redis apparaît à côté de la
  charge de travail principale de l'application, dans le même espace de noms.
- **CLI :**
  ```bash
  kubectl get deployments -n "$NAMESPACE"
  # Confirm Redis env vars are injected in the app container:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  # Test Redis connectivity from within the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli -h 127.0.0.1 ping
  ```

### E. Secret Manager {#e-secret-manager}

Le `SECRET_KEY` Flask est généré automatiquement au premier déploiement et stocké sous
forme de secret Secret Manager. Le mot de passe de la base de données est lui aussi géré
dans Secret Manager par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP Cloud Load Balancing
externe, au moyen d'un Service Kubernetes `LoadBalancer`. Un domaine personnalisé avec
Gateway API et une adresse IP statique peuvent être activés.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN
et les adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Sample {#3-sample-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une Job d'initialisation
  exécute `db-init.sh` (avec l'image `postgres:15-alpine`), qui crée de manière idempotente
  l'utilisateur de base de données PostgreSQL et la base de données, et accorde les
  privilèges avant le démarrage de l'application.
- **Sondes de santé.** Par défaut, `startup_probe_config` correspond à une simple
  vérification TCP et `health_check_config` (vivacité) correspond à `GET /` — la même route
  qui incrémente le compteur de visiteurs ; la sonde de vivacité par défaut effectue donc
  une écriture en base de données à chaque vérification. L'application Flask sert aussi un
  point de terminaison léger `GET /healthz` (renvoie `{"status": "healthy"}`, sans requête
  à la base de données) ; faites pointer `health_check_config.path` (et
  `startup_probe_config.path` avec `type = "HTTP"`) vers celui-ci pour éviter la charge
  supplémentaire.
- **Compteur de visiteurs.** La route racine (`GET /`) incrémente un compteur persistant
  stocké dans la table PostgreSQL `visitors`. Elle démontre à la fois la connectivité à la
  base de données et (lorsque Redis est activé) le suivi par session.
- **Diagnostic de la base de données.** `GET /db` exécute `SELECT version()` et renvoie la
  chaîne de version de PostgreSQL — pratique pour vérifier rapidement la connectivité de
  bout en bout à la base de données.
- **Gestion des sessions Redis.** Lorsque `enable_redis = true` et qu'un hôte Redis est
  joignable, l'application Flask utilise `Flask-Session` avec un backend Redis. Lorsque
  Redis est désactivé ou que `REDIS_HOST` est vide, les sessions se rabattent sur des
  cookies signés.
- **`SECRET_KEY` Flask.** La clé générée automatiquement est récupérée dans Secret Manager
  et injectée en tant que variable d'environnement `SECRET_KEY` au démarrage du pod. Elle
  sert à signer les sessions et à la protection CSRF.
- **Inspecter les pods en cours d'exécution :**
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name>
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'DB_|SECRET|REDIS'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Sample_GKE ou notables pour lui sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `sample` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Sample Application` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image de conteneur ; incrémentez-le pour déclencher un nouveau build et un nouveau déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `"custom"` construit l'image Flask via Cloud Build ; `"prebuilt"` déploie une image existante. |
| `container_image` | `""` | URI d'image de remplacement. Laissez vide pour utiliser le chemin Artifact Registry dérivé automatiquement. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire par pod. |
| `min_instance_count` | `0` (forcé à `1` en interne) | Nombre minimal de réplicas. Le module maintient toujours au moins 1 pod actif. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8080` | Flask/Gunicorn écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets fusionnés avec les valeurs par défaut du module. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `Deployment` | `"Deployment"` (sans état) ou `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Routage persistant — recommandé lorsque le stockage des sessions dans Redis est utilisé. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster géré par Services_GCP. |
| `namespace_name` | `""` | Laissez vide pour le générer automatiquement à partir du nom de l'application et de l'identifiant du locataire. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Provisionne des PVC par pod (pertinent uniquement lorsque `workload_type = "StatefulSet"`). |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur pour le montage du PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_headless_service` | `true` | Crée un Service headless pour un DNS de pod stable. |
| `stateful_pod_management_policy` | `OrderedReady` | Ordre de création et de suppression des pods. |
| `stateful_update_strategy` | `RollingUpdate` | Stratégie de mise à jour Rolling ou OnDelete. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ enabled = true }` → TCP, chemin `/`, délai/période de 240s | Sonde qui conditionne l'arrivée du trafic sur le pod au démarrage ; seul `enabled` est défini, donc le type, le chemin et les délais reprennent les valeurs par défaut TCP du socle. |
| `health_check_config` | `{ enabled = true }` → HTTP `GET /`, période de 10s | Sonde de vivacité continue ; cible par défaut la route racine (compteur de visiteurs) — définissez `path = "/healthz"` pour une vérification sans base de données. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée de `Sample_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrentes. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires supplémentaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé monté sur `nfs_mount_path`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS existante ; laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM NFS créée en ligne lorsqu'aucune n'existe. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Ne conserve que les N images de conteneur les plus récentes. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Supprime les images plus anciennes que ce nombre de jours. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Déploie un sidecar Redis interne et active le stockage des sessions. |
| `redis_host` | `""` | Laissez vide pour utiliser le sidecar déployé automatiquement sur `127.0.0.1` ; définissez-le explicitement pour une instance externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` (résolu en `POSTGRES_15` par `Sample_Common`) | Imposé — ne le modifiez pas. |
| `application_database_name` | `sampledb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `sampleuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` | `false` | Installe des extensions PostgreSQL après le provisionnement. |
| `postgres_extensions` | `[]` | Liste des extensions PostgreSQL à installer (par exemple `uuid-ossp`). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, adresse IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provisionne une entrée Gateway API pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod GKE pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant l'application. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'entrée. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services d'étape Cloud Deploy. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à l'application Sample. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et (facultative) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` / `POSTGRES_15` | Critical | PostgreSQL 15 est imposé par `Sample_Common` ; passer à MySQL ou à `NONE` casse la tâche `db-init` et le démarrage. |
| `application_database_name` / `_user` | défini une seule fois | Critical | Immuable après le premier déploiement ; un renommage recrée la base de données / l'utilisateur et détruit les données. |
| `application_name` | défini une seule fois | Critical | Intégré aux noms des ressources et aux identifiants des secrets Secret Manager. Le modifier après le déploiement rend orphelins les secrets existants et reconstruit toutes les ressources nommées. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont des octets et bloquent toute planification des pods. |
| `container_port` | `8080` | Critical | Une incohérence fait échouer la sonde de démarrage — le pod n'atteint jamais l'état Ready. |
| Chemin de `startup_probe_config` / `health_check_config` | `/healthz` pour une vérification sans base de données | Medium | Les valeurs par défaut (démarrage TCP `/`, vivacité HTTP `GET /`) sollicitent la route du compteur de visiteurs, ce qui ajoute une écriture en base de données à chaque vérification de vivacité. |
| `enable_cloudsql_volume` | `true` | Critical | `false` avec une base de données PostgreSQL : toutes les connexions à la base de données échouent au démarrage. La tâche `db-init` échoue également. |
| `enable_nfs` | `true` avec `network_tags = ["nfsserver"]` | High | Retirer `nfsserver` des tags réseau casse la règle de pare-feu NFS et empêche les montages. |
| `enable_redis` | `false` (par défaut) | High | `true` sans `redis_host` joignable (ou avec NFS désactivé) : l'application Flask journalise un avertissement et se rabat sur les cookies ; pas de plantage franc, mais le stockage des sessions se dégrade silencieusement. |
| `max_instance_count` | `1` en développement ; à augmenter en gardant une marge sur le pool de connexions à la base de données | High | Dépasser la limite de connexions de Cloud SQL : tous les pods voient leurs requêtes à la base de données échouer simultanément. |
| `container_resources.memory_limit` | `512Mi` ou plus | High | Moins de `~128Mi` entraîne l'arrêt de Flask pour dépassement de mémoire (OOM) au démarrage, lors du chargement des bibliothèques clientes. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sinon, l'application est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme aux exigences réglementaires. |
| `pdb_min_available` vs `min_instance_count` | garder une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `enable_vpc_sc` avec `vpc_sc_dry_run = false` | tester d'abord en mode simulation (dry-run) | Critical | Si un compte de service ou une adresse IP manque dans le niveau d'accès, tous les appels à l'API GKE échouent simultanément. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative partagée (secret Flask,
initialisation de la base de données, comportement des sondes et sidecar Redis) est
décrite dans **[Sample_Common](Sample_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Sample sur GKE Autopilot](../labs/Sample_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Application Sample sur Google Cloud Run](Sample_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Sample Common — Configuration applicative partagée](Sample_Common.md) — la configuration partagée par les deux cibles de déploiement.
