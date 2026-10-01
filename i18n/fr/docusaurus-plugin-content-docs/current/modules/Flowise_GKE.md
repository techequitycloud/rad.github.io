---
title: "Flowise sur GKE Autopilot"
description: "Référence de configuration pour déployer Flowise sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Flowise_GKE.md @ 3055034 sha256:9c4daefbb3d2 -->

# Flowise sur GKE Autopilot {#flowise-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flowise_GKE.png" alt="Flowise sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flowise est un outil open source de création visuelle de workflows d'IA qui permet aux
non-développeurs d'assembler des pipelines d'IA LangChain et LlamaIndex au moyen d'une
interface glisser-déposer. Ce module déploie Flowise sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Flowise et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Flowise s'exécute comme une charge de travail de conteneur Node.js. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 1 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Flowise ne prend pas en charge MySQL dans ce déploiement |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux fichiers téléversés est toujours provisionné ; il stocke les fichiers téléversés dans Flowise |
| Secrets | Secret Manager | Mot de passe administrateur Flowise généré automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe ;
  sélectionner MySQL ou `NONE` empêche le démarrage.
- **Le stockage de fichiers sur GCS est toujours activé.** `STORAGE_TYPE=gcs` et
  `APIKEY_STORAGE_TYPE=db` sont injectés automatiquement ; les clés d'API sont
  stockées dans la base de données, pas dans des fichiers.
- **L'affinité de session est `ClientIP`.** Les requêtes d'un navigateur sont
  épinglées à un pod afin que la session de l'interface Flowise reste cohérente.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans
  Secret Manager ; vous ne le définissez jamais en clair.
- **Les variables `DATABASE_*` sont mises en correspondance par le script de point
  d'entrée** (`flowise-entrypoint.sh`) à partir des variables `DB_*` standard de la
  plateforme au démarrage du conteneur — ne les définissez pas directement comme
  variables d'environnement.
- **Redis est désactivé par défaut.** Il n'est pas nécessaire aux fonctionnalités de
  base de Flowise, mais les déploiements à plusieurs réplicas qui partagent l'état
  d'exécution des flows en tirent profit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Flowise {#a-gke-autopilot--the-flowise-workload}

Les pods Flowise sont planifiés sur Autopilot, qui facture le CPU et la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Flowise pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Flowise stocke toutes les données de l'application (définitions de flows,
identifiants, exécutions) dans une instance gérée Cloud SQL for PostgreSQL 15. Les
pods y accèdent de façon privée via le sidecar **Cloud SQL Auth Proxy** sur un socket
Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié aux fichiers téléversés est toujours provisionné par
Flowise_Common. Son nom est injecté automatiquement dans le conteneur sous
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Flowise écrit tous les fichiers téléversés par les
utilisateurs (documents, images) dans ce bucket. Des buckets supplémentaires peuvent
être configurés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe administrateur Flowise est stocké en tant que secret Secret Manager et
injecté dans les pods à l'exécution ; il n'apparaît jamais en clair dans la
configuration. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Flowise {#3-flowise-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`db-init`) utilisant l'image `postgres:15-alpine` crée la base de
  données et l'utilisateur Flowise et accorde les privilèges avant le démarrage de
  l'application. Il est idempotent et peut être relancé sans risque.
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux le
  point de terminaison de santé dédié de Flowise, `/api/v1/ping`, qui renvoie HTTP 200
  lorsque l'application est prête. La sonde de démarrage accorde jusqu'à 5 minutes de
  budget de démarrage (30 échecs × intervalle de 10 secondes) pour laisser le temps à
  l'initialisation de la base de données au premier lancement.
- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  configurable via `flowise_username` (par défaut `admin`). Le mot de passe
  administrateur est généré automatiquement et stocké dans Secret Manager ;
  récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<resource_prefix>-flowise-password --project "$PROJECT"
  ```
- **Remappage des variables de base de données.** `flowise-entrypoint.sh` met
  systématiquement en correspondance `DB_HOST`, `DB_USER`, `DB_NAME` et `DB_PASSWORD`
  (injectées par la plateforme) avec `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME`
  et `DATABASE_PASSWORD` au démarrage du conteneur. Ne définissez pas directement les
  variables `DATABASE_*`.
- **Stockage de fichiers GCS.** `STORAGE_TYPE=gcs` et `GCLOUD_PROJECT` sont toujours
  injectés. Flowise écrit les fichiers téléversés dans le bucket GCS provisionné
  automatiquement. Remplacer `STORAGE_TYPE` entraîne l'écriture des fichiers
  téléversés dans le stockage éphémère du pod, perdu à chaque redémarrage.
- **Considérations multi-réplicas.** Flowise conserve en mémoire l'état d'exécution
  des flows. Exécuter plus d'un réplica sans Redis fait échouer les exécutions de flows
  lorsque les requêtes sont réparties vers un autre pod. Conservez
  `max_instance_count = 1` sauf si Redis est configuré.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Flowise ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `flowise` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Flowise` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Flowise ; mettez-le à jour pour déployer une nouvelle version. |
| `flowise_username` | `admin` | Nom d'utilisateur administrateur Flowise injecté sous `FLOWISE_USERNAME`. Modifiez-le avant toute exposition publique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | URI d'image de remplacement (utilisée uniquement lorsque `container_image_source = "prebuilt"`). |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Limites de CPU et de mémoire par pod. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid lors de l'exécution des workflows d'IA. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Augmentez-le uniquement avec Redis activé. |
| `container_port` | `3000` | Flowise écoute sur le port 3000. |
| `timeout_seconds` | `300` | Délai d'attente maximal de réponse du pod backend. Augmentez-le pour les workflows d'IA de longue durée (max. 3600). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne remplacez pas les variables gérées par la plateforme (`DATABASE_*`, `FLOWISE_*`, `STORAGE_TYPE`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par ex. `{ OPENAI_API_KEY = "flowise-openai-key" }`). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE. Laissez vide pour la découverte automatique. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour l'interface Flowise. |
| `workload_type` | `null` | `Deployment` par défaut pour Flowise (sans état). |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Pertinent uniquement lorsque `workload_type = "StatefulSet"`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans la spécification du StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | chemin `/api/v1/ping`, délai de 30 s, 30 échecs | Budget de démarrage de 5 minutes pour l'initialisation de la base de données au premier lancement. |
| `health_check_config` | chemin `/api/v1/ping`, délai de 15 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring depuis des emplacements mondiaux. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur des métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires déployés aux côtés de Flowise. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne un volume NFS Filestore. Utile pour les fichiers téléversés des workflows Flowise lorsque NFS est préféré à GCS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets supplémentaires de `storage_buckets`. Le bucket des fichiers téléversés de Flowise est toujours créé par Flowise_Common. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis (facultatif) {#group-15--redis-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis. Non requis pour les fonctionnalités de base ; nécessaire pour les déploiements à plusieurs réplicas. |
| `redis_host` | `""` | Point de terminaison Redis. Obligatoire lorsque `enable_redis = true` (ou, avec `enable_nfs = true`, l'IP de l'hôte NFS est utilisée). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Moteur Cloud SQL. Flowise nécessite PostgreSQL. |
| `application_database_name` | `flowisedb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `flowiseuser` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL. |
| `postgres_extensions` | `[]` | Liste des extensions PostgreSQL à installer. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir (par ex. `["flowise.example.com"]`). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Flowise. Recommandé en production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

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
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Flowise. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy). |
| `database_port` | Port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `db_import_job` | Nom du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Flowise nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Sans le sidecar Auth Proxy, la connexion à la base de données est refusée. |
| `application_database_name` / `_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `flowise_username` | remplacer `admin` | Élevé | Le nom d'utilisateur par défaut est connu de tous ; associé à un mot de passe deviné, il donne un accès complet à tous les flows d'IA. |
| `FLOWISE_SECRETKEY_OVERWRITE` | ne pas le définir après le premier déploiement | Élevé | Le modifier ou le supprimer après le premier déploiement brouille définitivement toutes les clés d'API de LLM et tous les identifiants de vector stores stockés. |
| `container_resources.memory_limit` | `1Gi` | Élevé | En dessous de 512Mi, le processus Node.js est tué pour manque de mémoire (OOM) au démarrage. La production avec de grands graphes de flows nécessite 2Gi. |
| `max_instance_count` | `1` (sans Redis) | Élevé | Plusieurs réplicas sans magasin Redis partagé font échouer les exécutions de flows lorsque les requêtes sont routées vers un autre pod. |
| `enable_iap` | activer pour un usage administrateur | Élevé | Sinon, l'interface Flowise est accessible publiquement sans authentification. |
| `STORAGE_TYPE` | `gcs` (par défaut) | Élevé | Toute autre valeur écrit les fichiers téléversés dans le stockage éphémère du pod, perdu à chaque redémarrage du pod. |
| `min_instance_count` | `1` | Moyen | `0` expose à une latence de démarrage à froid qui dépasse les délais d'attente des clients LLM en aval. |
| `enable_redis` | activer avec >1 réplica | Moyen | Nécessaire pour partager l'état des sessions et des files d'attente entre plusieurs réplicas. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les obligations de conservation liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | garder de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Flowise partagée avec
la variante Cloud Run est décrite dans **[Flowise_Common](Flowise_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Flowise sur GKE Autopilot](../labs/Flowise_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Flowise sur Google Cloud Run](Flowise_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flowise Common — Configuration applicative partagée](Flowise_Common.md) — la configuration partagée par les deux cibles de déploiement.
