---
title: "AnythingLLM sur GKE Autopilot"
description: "Référence de configuration pour déployer AnythingLLM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/AnythingLLM_GKE.md @ 3055034 sha256:8269156a9926 -->

# AnythingLLM sur GKE Autopilot {#anythingllm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AnythingLLM_GKE.png" alt="AnythingLLM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

AnythingLLM est un espace de travail d'IA privé et une plateforme de génération augmentée
par récupération (RAG) qui permet aux équipes de dialoguer avec leurs documents, de se
connecter à n'importe quel fournisseur de LLM (OpenAI, Anthropic, Ollama, etc.) et de
créer des assistants de connaissances reposant sur l'IA — sans envoyer de données à des
services tiers. Ce module déploie AnythingLLM sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise AnythingLLM et sur la façon de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

AnythingLLM s'exécute sous la forme d'une charge de travail d'IA Node.js. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — AnythingLLM utilise l'ORM Prisma et ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Bucket de documents `anythingllm-docs` provisionné automatiquement ; buckets supplémentaires en option |
| Volumes persistants | PVC Kubernetes (StatefulSet) | Facultatif — PVC de 20 GiB par pod sur `/app/server/storage` lorsque `stateful_pvc_enabled = true` |
| Fichiers partagés | Filestore (NFS) | Activé par défaut (`enable_nfs = true`) — `STORAGE_DIR` pointe vers le montage NFS afin que l'index vectoriel LanceDB survive aux redémarrages de pods et aux redéploiements |
| Secrets | Secret Manager | Quatre secrets applicatifs générés automatiquement (`JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT`) plus le mot de passe de base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |
| Cache | Redis | Désactivé par défaut ; facultatif pour les charges de travail de session ou de cache |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** L'ORM Prisma d'AnythingLLM nécessite PostgreSQL. Ne
  définissez pas `database_type` sur une variante MySQL ou SQL Server.
- **Quatre secrets applicatifs sont générés automatiquement.** `JWT_SECRET`, `AUTH_TOKEN`,
  `SIG_KEY` et `SIG_SALT` sont créés dans Secret Manager lors du premier déploiement ;
  vous ne les définissez jamais en clair.
- **`min_instance_count = 1` est recommandé** pour maintenir AnythingLLM actif et éviter
  les démarrages à froid lors des conversations sur les documents et des opérations
  d'embedding.
- **Le stockage doit être persistant.** Tous les documents de l'espace de travail, les
  index vectoriels et les données de conversation sont écrits sous `STORAGE_DIR`.
  AnythingLLM y conserve son index vectoriel LanceDB qui, sans NFS, réside sur le disque
  éphémère du pod — la base de connaissances est alors effacée silencieusement à chaque
  redémarrage de pod ou redéploiement. `enable_nfs = true` par défaut fait pointer
  `STORAGE_DIR` vers le montage NFS afin que les vecteurs survivent ;
  `stateful_pvc_enabled = true` (désactivé par défaut) offre une autre voie de
  persistance, limitée à un seul pod, sur `/app/server/storage`.
- **Redis est désactivé par défaut.** Il n'est pas nécessaire aux fonctionnalités de
  base d'AnythingLLM. Activez-le uniquement si votre déploiement nécessite une couche de
  cache partagée.
- **`stateful_pvc_enabled = true` sélectionne automatiquement `StatefulSet`** et monte un
  PVC de 20 GiB sur `/app/server/storage` avec `fsGroup = 1000`, pour correspondre à
  l'utilisateur du conteneur AnythingLLM.
- **La variable d'environnement `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` est définie
  automatiquement** à partir du bucket GCS `anythingllm-docs` provisionné.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail AnythingLLM {#a-gke-autopilot--the-anythingllm-workload}

Les pods AnythingLLM sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas. Les opérations
d'embedding et d'inférence d'IA nécessitent au moins 2 vCPU et 4 GiB de RAM.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  AnythingLLM pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, du scaling et du type de charge
de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AnythingLLM stocke toutes les métadonnées de l'espace de travail, les comptes
utilisateur et l'historique des conversations dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent de façon privée via le sidecar **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est donc exposée. Lors du premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application.

La chaîne de connexion Prisma `DATABASE_URL` est assemblée par le script de point
d'entrée d'AnythingLLM à partir des variables d'environnement `DB_*` injectées par le
socle au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous indiqués dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Storage — bucket de documents {#c-cloud-storage--document-bucket}

`AnythingLLM_Common` provisionne automatiquement un bucket **Cloud Storage** dédié
(`anythingllm-docs`) pour le stockage des documents et des vecteurs. Le compte de
service de la charge de travail y reçoit automatiquement l'accès et le nom du bucket est
injecté sous `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Des buckets supplémentaires peuvent être
déclarés dans `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<docs-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Volumes persistants (PVC de StatefulSet) {#d-persistent-volumes-statefulset-pvcs}

Pour les déploiements à un seul pod ou nécessitant la persistance des données, activer
`stateful_pvc_enabled = true` crée un **PersistentVolumeClaim Kubernetes** par pod, monté
sur `/app/server/storage` (le répertoire de stockage d'AnythingLLM). Le contexte de
sécurité `fsGroup = 1000` garantit que l'utilisateur du conteneur peut écrire sur le
volume.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Confirm the volume is mounted correctly:
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls /app/server/storage
  ```

### E. Filestore (NFS) — stockage persistant par défaut {#e-filestore-nfs--default-persistent-storage}

`enable_nfs = true` par défaut. L'index vectoriel LanceDB d'AnythingLLM réside sous
`STORAGE_DIR`, qui correspond par défaut au disque éphémère du pod — sans NFS, la base de
connaissances est effacée silencieusement à chaque redémarrage de pod ou redéploiement
(les métadonnées des documents persistent dans Postgres, mais les vecteurs disparaissent).
Lorsque NFS est activé, `STORAGE_DIR` pointe vers `nfs_mount_path` afin que les vecteurs
survivent, et les déploiements multi-pods partagent la même vue des documents et des
vecteurs. `stateful_pvc_enabled = true` (désactivé par défaut) constitue une alternative
de persistance limitée à un seul pod sur `/app/server/storage`.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour les détails du provisionnement NFS.

### F. Secret Manager {#f-secret-manager}

Quatre secrets applicatifs d'AnythingLLM sont générés automatiquement et stockés dans
Secret Manager — `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY` et `SIG_SALT` — ainsi que le mot
de passe de base de données. Aucun d'eux n'apparaît en clair où que ce soit dans le
déploiement.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de base de données figure dans les
[sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et
la rotation.

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe. Un
domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de
l'IP statique.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
et Cloud SQL vers Cloud Monitoring. Un test de disponibilité ciblant `/api/ping` est
activé par défaut.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application AnythingLLM {#3-anythingllm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) utilise l'image `postgres:15-alpine` pour créer la base de
  données et l'utilisateur d'AnythingLLM avant le démarrage de la charge de travail. Il
  est idempotent et peut être réexécuté sans risque.
- **Migrations Prisma au démarrage.** Le script de point d'entrée construit la chaîne de
  connexion `DATABASE_URL` à partir des variables d'environnement `DB_*` injectées par la
  plateforme et exécute les migrations Prisma ; les mises à niveau de version appliquent
  donc automatiquement les modifications de schéma.
- **Chargement des modèles d'IA.** AnythingLLM charge les modèles d'embedding en mémoire
  au premier démarrage. La sonde de démarrage utilise un délai initial de 60 secondes et
  30 périodes d'échec (×10 secondes = 5 minutes au total) pour en tenir compte.
- **Chemin de santé.** Les sondes de readiness et de liveness ciblent toutes deux
  `/api/ping`, qui ne renvoie HTTP 200 qu'une fois l'application entièrement initialisée.
  Ce point de terminaison fonctionne tout aussi bien sur GKE, où le trafic des sondes
  atteint directement le conteneur sans aucune redirection.
- **Configuration du fournisseur de LLM.** Utilisez `environment_variables` pour les
  paramètres de fournisseur non sensibles (`LLM_PROVIDER`, `EMBEDDING_ENGINE`,
  `VECTOR_DB`) et `secret_environment_variables` pour associer des noms de variables
  d'environnement à des secrets Secret Manager pour les clés API (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, etc.).
- **Cohérence du moteur d'embedding.** Modifier `EMBEDDING_ENGINE` après l'ingestion de
  documents rend les index vectoriels existants incompatibles. Tous les documents doivent
  être réingérés après toute modification du moteur d'embedding.
- **Variables d'environnement fixes.** `SERVER_PORT=3001`, `UID=1000` et `GID=1000` sont
  définies automatiquement par `AnythingLLM_Common`. Ne les remplacez pas.
  `AnythingLLM_Common` définit également `STORAGE_DIR=/app/server/storage` comme sa
  propre valeur par défaut, mais `AnythingLLM_GKE` la remplace par le chemin de montage
  NFS (`nfs_mount_path`, par défaut `/mnt/nfs`) dès que `enable_nfs = true` — la valeur
  par défaut de la plateforme — de sorte qu'un déploiement s'exécute en réalité avec
  `STORAGE_DIR=/mnt/nfs`, sauf si `enable_nfs` est explicitement désactivé (voir la
  section E).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à AnythingLLM ou importants pour celui-ci sont
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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `anythingllm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `AnythingLLM` | Nom convivial affiché dans la console. |
| `application_description` | `AnythingLLM Private AI Workspace on GKE` | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image ; épinglez-le sur un tag de version publiée en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="4Gi" }` | Limites de CPU/mémoire. Minimum de 2 vCPU / 4 GiB pour les charges de travail d'IA. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `3001` | Port HTTP natif d'AnythingLLM. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `timeout_seconds` | `300` | Délai d'expiration du backend de l'équilibreur de charge. Augmentez-le pour l'ingestion de longs documents. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets, p. ex. `LLM_PROVIDER`, `EMBEDDING_ENGINE`, `VECTOR_DB`. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager pour les clés API. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Mode d'affinité de session. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags de nœuds/pods pour les règles de pare-feu VPC. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour activer un PVC par pod et sélectionner automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. Minimum de 20 GiB recommandé pour les données du magasin de vecteurs. |
| `stateful_pvc_mount_path` | `/app/server/storage` | Chemin de montage — le répertoire de stockage d'AnythingLLM. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_fs_group` | `1000` | GID `fsGroup` au niveau du pod ; correspond à l'utilisateur du conteneur AnythingLLM. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`8Gi`, `16Gi`)** — les entiers bruts sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | `/api/ping`, délai initial de 60 s, 30 échecs | Fenêtre de démarrage étendue pour le chargement des modèles d'IA. |
| `health_check_config` / `liveness_probe` | `/api/ping`, délai initial de 30 s | Sonde de liveness sur le point de terminaison de santé d'AnythingLLM. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (p. ex. tâches de maintenance). |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires aux côtés d'AnythingLLM. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Filestore (NFS) est monté par défaut — indispensable pour que l'index vectoriel LanceDB d'AnythingLLM (sous `STORAGE_DIR`) survive aux redémarrages de pods et aux redéploiements au lieu de résider sur un disque éphémère. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données supplémentaire. Le bucket `anythingllm-docs` est toujours créé. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis pour les fonctionnalités de base d'AnythingLLM. À activer pour des charges de travail de cache facultatives. |
| `redis_host` | `null` | Point de terminaison Redis. **Obligatoire** lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé pour AnythingLLM — ne pas modifier. |
| `application_database_name` | `anythingllmdb` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `anythingllmuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL. |
| `postgres_extensions` | `[]` | Extensions à installer (p. ex. `['uuid-ossp', 'vector']`). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` | options de restauration | Restaurer depuis une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant AnythingLLM. **Recommandé en production.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à AnythingLLM. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `anythingllm-docs`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | AnythingLLM nécessite PostgreSQL ; tout autre moteur casse l'ORM Prisma et fait planter le démarrage. |
| Persistance de `STORAGE_DIR` | `stateful_pvc_enabled=true` ou NFS | Critical | Sans volume persistant, tous les documents de l'espace de travail, les index vectoriels et les données de conversation sont perdus lors de l'éviction d'un pod. |
| `secret_environment_variables` (clés API) | Utiliser des références Secret Manager | Critical | Les clés API des fournisseurs placées en clair dans `environment_variables` sont visibles dans les spécifications des pods Kubernetes. Utilisez `secret_environment_variables` pour tous les secrets. |
| `application_database_name` / `_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires (`8Gi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification. |
| `enable_cloudsql_volume` | `true` | Critical | Le désactiver fait échouer toutes les connexions à la base au démarrage. |
| `container_resources.memory_limit` | `4Gi` | High | Le pipeline d'embedding d'AnythingLLM nécessite 3 à 4 GiB de RAM ; les arrêts pour OOM corrompent l'ingestion en cours. |
| `min_instance_count` | `1` | High | Le scale-to-zero entraîne des démarrages à froid de 30 à 60 s ; les opérations d'IA en cours lors de la réduction d'échelle sont perdues. |
| `timeout_seconds` | `300` (à augmenter pour les charges lourdes) | High | L'ingestion de longs documents ou des complétions LLM lentes dépassent le délai d'expiration du backend et renvoient une erreur 504. |
| `EMBEDDING_ENGINE` | à définir une seule fois | High | Changer de moteur d'embedding après l'ingestion rend les vecteurs existants incompatibles ; tous les documents doivent être réingérés. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | High | Sans IAP, l'accès n'est contrôlé que par l'écran de connexion de l'application. |
| `enable_redis` | `false` (ou définir `redis_host`) | Medium | Si `enable_redis = true` et que `redis_host` ne peut pas être résolu, le conteneur ne démarre pas. |
| `enable_nfs` | `true` (par défaut) | Medium | Activé par défaut afin que l'index vectoriel LanceDB survive aux redémarrages de pods ; le désactiver laisse également les pods multi-réplicas sur un stockage éphémère isolé, ce qui casse l'accès aux documents entre pods. |
| `application_version` | épingler sur un tag de version publiée | Medium | `latest` expose en production à des mises à niveau qui cassent le schéma. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à AnythingLLM, partagée
avec la variante Cloud Run, est décrite dans
**[AnythingLLM_Common](AnythingLLM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AnythingLLM sur GKE Autopilot](../labs/AnythingLLM_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [AnythingLLM sur Google Cloud Run](AnythingLLM_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [AnythingLLM Common — Configuration applicative partagée](AnythingLLM_Common.md) — la configuration partagée par les deux cibles de déploiement.
