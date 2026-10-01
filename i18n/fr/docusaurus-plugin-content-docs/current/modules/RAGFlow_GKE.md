---
title: "RAGFlow sur GKE Autopilot"
description: "Référence de configuration pour déployer RAGFlow sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/RAGFlow_GKE.md @ 3055034 sha256:03eaf32bdd9b -->

# RAGFlow sur GKE Autopilot {#ragflow-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/RAGFlow_GKE.png" alt="RAGFlow sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

RAGFlow est une plateforme open source d'intelligence documentaire et de génération
augmentée par récupération (Retrieval-Augmented Generation, RAG). Elle ingère des PDF,
des documents Word, des pages HTML et d'autres formats, les découpe en fragments et les
vectorise, stocke les vecteurs dans Elasticsearch, expose une API REST de
questions-réponses et fournit une interface web de gestion des bases de connaissances et
de recherche d'entreprise. Ce module déploie RAGFlow sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par RAGFlow et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

> **Prérequis de déploiement :** `RAGFlow_GKE` nécessite que `Elasticsearch_GKE` soit
> déployé en premier. La variable `elasticsearch_hosts` est **obligatoire** — le plan est
> rejeté si elle est vide lorsque `deploy_application = true`.

---

## 1. Vue d'ensemble {#1-overview}

RAGFlow s'exécute comme une charge de travail web Python/Nginx conteneurisée. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods RAGFlow construits sur mesure, 4 vCPU / 8 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — RAGFlow ne prend pas en charge PostgreSQL |
| Recherche vectorielle | Elasticsearch (Elasticsearch_GKE) | Dépendance externe — doit être déployée en premier ; `elasticsearch_hosts` est obligatoire |
| File de tâches | Redis (Memorystore) | Requis pour les workers de traitement des documents |
| Fichiers partagés | Filestore (NFS) | Activé par défaut pour le stockage partagé du traitement des documents |
| Stockage d'objets | Cloud Storage | Un bucket `ragflow-documents` dédié |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est imposé ; choisir
  PostgreSQL ou `NONE` empêche le démarrage.
- **`elasticsearch_hosts` est requis.** RAGFlow ne peut ni indexer ni rechercher des
  documents sans point de terminaison Elasticsearch joignable. Déployez d'abord
  `Elasticsearch_GKE`.
- **Redis est requis pour le traitement des documents.** Avec `enable_redis = true` (la
  valeur par défaut), `REDIS_HOST` et `REDIS_PORT` sont injectés automatiquement. Sans
  Redis, les fichiers téléversés restent indéfiniment non traités.
- **La mise à l'échelle à zéro est désactivée.** `min_instance_count` est plafonné à 1.
  RAGFlow charge les modèles d'embedding au démarrage (2 à 3 minutes) ; une mise à
  l'échelle à zéro provoquerait l'expiration des requêtes.
- **Une image personnalisée est toujours construite.** Cloud Build étend
  `infiniflow/ragflow` à l'aide du Dockerfile de `RAGFlow_Common/scripts/`, avec
  `APP_VERSION` défini à partir de `application_version`.
- **`service_conf.yaml` est généré au démarrage.** Le point d'entrée personnalisé écrit
  `/ragflow/conf/service_conf.yaml` à partir des variables d'environnement injectées
  avant de lancer les processus RAGFlow.
- **L'affinité de session est `ClientIP`.** Cela garantit que les sessions de
  téléversement et les requêtes de traitement de documents en plusieurs étapes
  atteignent toujours le même pod.
- **`enable_custom_domain` vaut `true` par défaut.** Le service passe ainsi par
  l'équilibreur de charge Gateway API, qui — combiné à la valeur par défaut
  `reserve_static_ip = true` — provisionne un certificat géré et HTTPS dès
  l'installation via un nom d'hôte `<ip>.nip.io`, même lorsque `application_domains`
  est laissé vide. Renseignez `application_domains` pour servir un vrai nom d'hôte.
- **Le mot de passe de la base de données** est généré automatiquement et stocké dans
  Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail RAGFlow {#a-gke-autopilot--the-ragflow-workload}

Les pods RAGFlow sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  RAGFlow pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

RAGFlow stocke toutes les métadonnées de l'application (comptes utilisateur, bases de
connaissances, état des tâches) dans une instance gérée Cloud SQL for MySQL 8.0. Les
pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un socket
Unix, si bien qu'aucune IP publique n'est exposée. Lors du premier déploiement, un Job
d'initialisation crée la base de données et l'utilisateur de l'application.

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
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe,
consultez [App_GKE](App_GKE.md).

### C. Elasticsearch — recherche vectorielle {#c-elasticsearch--vector-search}

RAGFlow nécessite une instance Elasticsearch externe pour l'indexation des documents et
la recherche vectorielle. Elle n'est pas incluse dans ce module — déployez
`Elasticsearch_GKE` séparément et transmettez sa sortie `elasticsearch_endpoint` comme
`elasticsearch_hosts`. Les variables d'environnement `ELASTICSEARCH_HOSTS` et
`ELASTICSEARCH_USERNAME` sont injectées automatiquement.

- **Console :** Kubernetes Engine → Workloads → espace de noms Elasticsearch.
- **CLI :**
  ```bash
  # Confirm RAGFlow can reach Elasticsearch:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s "$ELASTICSEARCH_HOSTS/_cluster/health" | grep status
  # Check connectivity from within the cluster:
  kubectl run -it --rm curl --image=curlimages/curl --restart=Never -- \
    curl -s "http://<elasticsearch-ip>:9200/_cluster/health"
  ```

### D. Redis — file de tâches {#d-redis--task-queue}

Redis est la colonne vertébrale du pipeline de traitement des documents de RAGFlow. Les
workers interrogent Redis pour obtenir des tâches ; sans lui, les fichiers téléversés ne
sont jamais analysés, découpés ni vectorisés.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Filestore (NFS) et Cloud Storage {#e-filestore-nfs-and-cloud-storage}

Par défaut, RAGFlow monte un partage **Filestore (NFS)** dans chaque pod pour le
stockage partagé du traitement des documents. Un bucket **Cloud Storage** dédié
(`ragflow-documents`) est également provisionné pour l'ingestion des documents ; le
compte de service de la charge de travail y reçoit automatiquement l'accès. Des volumes
GCS Fuse supplémentaires peuvent être montés via `gcs_volumes`.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<documents-bucket>/     # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### F. Secret Manager {#f-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager et
injecté dans les pods à l'exécution ; il n'apparaît jamais en clair dans la
configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### G. Réseau et entrée {#g-networking--ingress}

`enable_custom_domain` vaut `true` par défaut, ce qui fait passer la charge de travail
par l'équilibreur de charge Gateway API avec un certificat géré par Google — servant
automatiquement HTTPS sur un nom d'hôte `<ip>.nip.io` lorsque `application_domains` est
vide. Renseignez `application_domains` pour servir un vrai nom d'hôte personnalisé. Une
IP statique est réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
et Cloud SQL vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application RAGFlow {#3-ragflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation (`mysql:8.0-debian`) crée la base de données RAGFlow (`rag_flow`) et
  l'utilisateur (`ragflow`), puis accorde les privilèges avant le démarrage de
  l'application. Il est idempotent et peut être relancé sans risque.
- **`service_conf.yaml` généré au démarrage.** Le point d'entrée personnalisé génère
  `/ragflow/conf/service_conf.yaml` à partir des variables d'environnement injectées —
  notamment l'hôte, l'utilisateur et la base MySQL, le point de terminaison
  Elasticsearch, l'hôte et le port Redis, ainsi que des identifiants facultatifs — avant
  de lancer les processus RAGFlow (Nginx, serveur RAGFlow, workers de tâches).
- **Pipeline de traitement des documents.** Les documents téléversés sont mis en file
  d'attente dans Redis et traités de façon asynchrone par les workers de documents de
  RAGFlow : OCR, découpage, vectorisation et indexation dans Elasticsearch. Sans Redis
  ni Elasticsearch joignables, les fichiers semblent téléversés mais ne sont jamais
  traités.
- **Chargement des modèles d'embedding au démarrage.** RAGFlow télécharge et charge les
  modèles d'embedding lors du premier démarrage. La sonde de démarrage cible
  `/v1/health` avec un délai initial de 120 secondes et 60 tentatives en cas d'échec
  afin de laisser largement le temps nécessaire. La sonde de vivacité passe à
  `/v1/health` une fois le démarrage réussi.
- **Points de terminaison de santé.** Les sondes de disponibilité (readiness) et de vivacité
  utilisent `/v1/health` et `/v1/system/version`. Ils ne renvoient HTTP 200 que lorsque
  l'application est entièrement initialisée et que tous les services sont joignables.
- **Affinité de session.** `session_affinity = "ClientIP"` achemine les requêtes d'un
  navigateur vers le même pod, ce qui garantit la cohérence des sessions de
  téléversement et des workflows de documents en cours.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à RAGFlow ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs
par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `elasticsearch_hosts` | _(obligatoire)_ | Point de terminaison HTTP Elasticsearch (par ex. `http://10.0.0.5:9200`). À définir avec la sortie `elasticsearch_endpoint` de `Elasticsearch_GKE`. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ragflow` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `RAGFlow` | Nom convivial affiché dans la console. |
| `application_description` / `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `v0.13.0` | Tag de version de l'image RAGFlow transmis à Cloud Build sous `APP_VERSION` ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `4000m` | CPU par pod ; 4 vCPU recommandés pour les charges d'analyse de documents. |
| `memory_limit` | `8Gi` | Mémoire par pod ; 8 GiB recommandés (les modèles d'embedding sont volumineux). |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Plafonné à 1 — la mise à l'échelle à zéro n'est pas prise en charge. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `80` | Le frontal Nginx de RAGFlow écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `termination_grace_period_seconds` | `60` | À augmenter pour les jobs de traitement de documents en cours. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement progressif — valeur généreuse pour tenir compte du chargement des modèles. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne remplacez pas `MYSQL_*`, `ELASTICSEARCH_*` ni `REDIS_*` — ils sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant — requis pour la cohérence des sessions de téléversement et du traitement des documents. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `["nfsserver"]` | Tags de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

Ces paramètres ne s'appliquent que lorsque `workload_type = "StatefulSet"` ou `stateful_pvc_enabled = true`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Provisionne un PVC pour le stockage local des modèles. Recommandé en production. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC ; prévoyez au moins 50 GiB pour les charges documentaires de production. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_fs_group` | `0` | GID fsGroup propriétaire du PVC ; à définir si le processus du conteneur nécessite un GID précis. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Utilisez obligatoirement des unités binaires (`8Gi`, `16384Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/v1/health`, délai de 120s, 60 tentatives | Sonde HTTP laissant largement le temps de charger les modèles d'embedding. |
| `liveness_probe` / `health_check_config` | `/v1/health` | Sonde de vivacité HTTP une fois le démarrage réussi. |
| `uptime_check_config` | `{ enabled=false, path="/v1/health" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées récurrentes déployées comme CronJobs Kubernetes. |
| `additional_services` | `[]` | Deployments Kubernetes complémentaires supplémentaires (par ex. Elasticsearch intégré pour le développement). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le stockage du traitement des documents (à garder activé en multi-réplicas). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante ; découverte automatiquement si vide. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket GCS des documents. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires en plus de `ragflow-documents`. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse montés dans le conteneur RAGFlow. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options de chiffrement CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 15 — Elasticsearch et Redis {#group-15--elasticsearch--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour la file de tâches du traitement des documents. |
| `redis_host` | `""` | Hôte Redis. S'il est vide et que NFS est activé, l'IP du serveur NFS est utilisée. À définir explicitement pour Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch. Laissez vide lorsque `xpack.security.enabled = false`. |
| `enable_inline_elasticsearch` | `false` | Déploie un sidecar Elasticsearch à nœud unique. **Développement uniquement** — les données sont perdues au redémarrage du pod. |
| `elasticsearch_version` | `8.13.0` | Tag d'image Elasticsearch pour l'instance intégrée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Imposé — ne pas modifier. |
| `db_name` | `rag_flow` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `ragflow` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau GCP appliqués aux pods. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant RAGFlow. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL d'accès à RAGFlow. |
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
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster ou la charge de travail est prêt. `false` lors du premier apply d'un nouveau cluster intégré — le pipeline CI/CD doit relancer l'apply pour terminer le déploiement. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `elasticsearch_hosts` | obligatoire — à définir depuis `Elasticsearch_GKE` | Critique | RAGFlow ne peut ni indexer ni rechercher ; toutes les opérations d'ingestion et de récupération échouent. Le plan est rejeté s'il est vide et que `deploy_application = true`. |
| `enable_redis` | `true` | Critique | Sans Redis, la file de tâches du traitement des documents ne s'exécute jamais ; les fichiers téléversés restent indéfiniment non traités. |
| `database_type` | `MYSQL_8_0` | Critique | RAGFlow exige MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | RAGFlow se connecte via un socket Unix ; désactiver le sidecar proxy provoque un échec de connexion à la base de données au démarrage. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données ou l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `redis_host` | IP Memorystore explicite ou `""` (repli sur NFS) | Élevé | Un hôte Redis injoignable ou erroné interrompt silencieusement tous les workers de documents asynchrones. |
| `min_instance_count` | `1` | Élevé | `0` entraîne une mise à l'échelle à zéro ; les démarrages à froid prennent 2 à 3 minutes et les requêtes expirent. |
| `memory_limit` | `8Gi` | Élevé | Les modèles d'embedding et le serveur d'application nécessitent généralement 4 à 8 GiB ; une valeur trop faible provoque des arrêts OOM pendant le traitement des documents. |
| `stateful_pvc_enabled` | `true` en production | Élevé | Sans PVC, les redémarrages de pods font perdre tout l'état du traitement en cours. |
| `session_affinity` | `ClientIP` | Élevé | Sans routage persistant, les sessions de téléversement en multi-réplicas peuvent être réparties entre plusieurs pods. |
| `elasticsearch_username` | `""` ou utilisateur correct | Élevé | Si la sécurité d'Elasticsearch est activée, laisser ce champ vide provoque des erreurs HTTP 401 et interrompt toute l'indexation. |
| `enable_nfs` | `true` | Élevé | Les déploiements multi-réplicas sans stockage partagé présentent des vues incohérentes des documents d'un pod à l'autre. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sinon, l'interface web de RAGFlow est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de conservation liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `application_version` | `v0.13.0` | Moyen | L'incrémenter déclenche une reconstruction de l'image et un redémarrage progressif ; vérifiez la compatibilité du schéma MySQL lors des sauts de version majeure. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à RAGFlow partagée avec
la variante Cloud Run est décrite dans **[RAGFlow_Common](RAGFlow_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : RAGFlow sur GKE Autopilot](../labs/RAGFlow_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [RAGFlow sur Google Cloud Run](RAGFlow_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [RAGFlow Common — Configuration applicative partagée](RAGFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md) dans la solution **Enterprise RAG & Document Intelligence**.
