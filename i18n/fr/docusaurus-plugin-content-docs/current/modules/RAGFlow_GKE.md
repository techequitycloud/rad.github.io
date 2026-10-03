---
title: "RAGFlow sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de RAGFlow sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/RAGFlow_GKE.md @ 15fd4c7 sha256:931d09f13913 -->

# RAGFlow sur GKE Autopilot {#ragflow-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/RAGFlow_GKE.png" alt="RAGFlow sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

RAGFlow est une plateforme open source d'intelligence documentaire et de génération
augmentée par récupération (RAG). Elle ingère des documents PDF, Word, des pages HTML
et d'autres formats, les découpe et les intègre, stocke les vecteurs dans Elasticsearch,
expose une API REST pour la réponse aux questions et fournit une interface web pour la
gestion des bases de connaissances et la recherche en entreprise. Ce module déploie
RAGFlow sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par RAGFlow et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

> **Prérequis de déploiement :** `RAGFlow_GKE` nécessite que `Elasticsearch_GKE` soit déployé
> en premier. La variable `elasticsearch_hosts` est **obligatoire** — le plan est rejeté si elle
> est vide lorsque `deploy_application = true`.

---

## 1. Vue d'ensemble {#1-overview}

RAGFlow s'exécute comme une charge de travail web conteneurisée Python/Nginx. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods RAGFlow personnalisés, 4 vCPU / 8 GiB par défaut, auto-mis à l'échelle horizontalement |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — RAGFlow ne prend pas en charge PostgreSQL |
| Recherche vectorielle | Elasticsearch (Elasticsearch_GKE) | Dépendance externe — doit être déployé en premier ; `elasticsearch_hosts` est obligatoire |
| File d'attente de tâches | Redis (Memorystore) | Obligatoire pour les workers de traitement de documents |
| Fichiers partagés | Filestore (NFS) | Activé par défaut pour le stockage partagé de traitement de documents |
| Stockage d'objets | MinIO (dans l'espace de noms) | RAGFlow stocke chaque document téléchargé dans un stockage compatible S3, un bucket par base de connaissances. `enable_inline_minio = true` (par défaut) exécute un service MinIO supplémentaire à réplica unique sur un PVC `standard` de 20 Gi ; définissez `minio_host` pour utiliser un point de terminaison S3 externe à la place. Un bucket Cloud Storage `documents` est également provisionné |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixe ; la sélection
  de PostgreSQL ou `NONE` empêche le démarrage.
- **`elasticsearch_hosts` est requis.** RAGFlow ne peut pas indexer ou rechercher des documents
  sans un point de terminaison Elasticsearch accessible. Déployez `Elasticsearch_GKE` en premier.
- **Le stockage de documents est un MinIO dans l'espace de noms par défaut.** RAGFlow
  conserve les documents téléchargés dans un stockage compatible S3, créant un bucket
  par base de connaissances, donc `enable_inline_minio = true` déploie un service MinIO à réplica
  unique avec un volume persistant (`minio_storage_size` 20 Gi, `minio_storage_class` `standard`).
  Ses identifiants sont un mot de passe généré dans Secret Manager. Sans stockage
  d'objets, chaque analyse de document échoue tandis que le pod reste Prêt.
- **Redis est requis pour le traitement des documents.** Avec `enable_redis = true` (par défaut),
  `REDIS_HOST` et `REDIS_PORT` sont injectés automatiquement. Sans Redis, les
  fichiers téléchargés restent non traités indéfiniment.
- **La mise à l'échelle à zéro est désactivée.** `min_instance_count` est plafonné à 1.
  RAGFlow charge les modèles d'intégration au démarrage (2-3 minutes) ; la mise à
  l'échelle à zéro entraînerait l'expiration des requêtes.
- **Une image personnalisée est toujours construite.** Cloud Build étend `infiniflow/ragflow`
  en utilisant le Dockerfile dans `RAGFlow_Common/scripts/`, avec `APP_VERSION` défini à partir de
  `application_version`.
- **`service_conf.yaml` est généré au démarrage.** Le point d'entrée personnalisé écrit
  `/ragflow/conf/service_conf.yaml` à partir des variables d'environnement injectées avant de démarrer
  les processus RAGFlow.
- **L'affinité de session est `ClientIP`.** Cela garantit que les sessions de
  téléchargement et les requêtes de traitement de documents en plusieurs étapes
  atteignent toujours le même pod.
- **`enable_custom_domain` est par défaut `true`.** Cela achemine le service via
  l'équilibreur de charge de l'API Gateway, qui — combiné avec le `reserve_static_ip = true` par
  défaut — provisionne un certificat géré et HTTPS prêt à l'emploi via un nom
  d'hôte `<ip>.nip.io` même lorsque `application_domains` est laissé vide. Définissez
  `application_domains` pour servir un véritable nom d'hôte à la place.
- **Le mot de passe de la base de données** est généré automatiquement et stocké dans
  Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail RAGFlow {#a-gke-autopilot--the-ragflow-workload}

Les pods RAGFlow sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail RAGFlow pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

RAGFlow stocke toutes les métadonnées de l'application (comptes utilisateurs, bases
de connaissances, état des tâches) dans une instance gérée Cloud SQL pour MySQL 8.0.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket
Unix, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, un
job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Elasticsearch — recherche vectorielle {#c-elasticsearch--vector-search}

RAGFlow nécessite une instance Elasticsearch externe pour l'indexation de documents
et la recherche vectorielle. Elle n'est pas incluse dans ce module — déployez
`Elasticsearch_GKE` séparément et transmettez sa sortie `elasticsearch_endpoint` comme
`elasticsearch_hosts`. Les variables d'environnement `ELASTICSEARCH_HOSTS` et `ELASTICSEARCH_USERNAME`
sont injectées automatiquement.

- **Console :** Kubernetes Engine → Charges de travail → espace de noms Elasticsearch.
- **CLI :**
  ```bash
  # Confirm RAGFlow can reach Elasticsearch:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s "$ELASTICSEARCH_HOSTS/_cluster/health" | grep status
  # Check connectivity from within the cluster:
  kubectl run -it --rm curl --image=curlimages/curl --restart=Never -- \
    curl -s "http://<elasticsearch-ip>:9200/_cluster/health"
  ```

### D. Redis — file d'attente de tâches {#d-redis--task-queue}

Redis est l'épine dorsale du pipeline de traitement de documents de RAGFlow. Les
workers interrogent Redis pour les tâches ; sans lui, les fichiers téléchargés ne
sont jamais analysés, découpés ou intégrés.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Filestore (NFS) et Cloud Storage {#e-filestore-nfs-and-cloud-storage}

Par défaut, RAGFlow monte un partage **Filestore (NFS)** dans chaque pod pour le
stockage partagé de traitement de documents. Un bucket **Cloud Storage** dédié
(`ragflow-documents`) est également provisionné pour l'ingestion de documents ; le compte
de service de la charge de travail se voit accorder l'accès automatiquement. Des
volumes GCS Fuse supplémentaires peuvent être montés via `gcs_volumes`.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<documents-bucket>/     # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Voir [App_GKE](App_GKE.md) pour les options de provisionnement NFS, GCS Fuse et CMEK.

### F. Secret Manager {#f-secret-manager}

Le mot de passe de la base de données est stocké en tant que secret Secret Manager
et injecté dans les pods au moment de l'exécution ; le texte en clair n'apparaît
jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### G. Réseau et ingress {#g-networking--ingress}

`enable_custom_domain` est par défaut `true`, ce qui achemine la charge de travail via
l'équilibreur de charge de l'API Gateway avec un certificat géré par Google —
servant automatiquement HTTPS sur un nom d'hôte `<ip>.nip.io` lorsque `application_domains`
est vide. Définissez `application_domains` pour servir un véritable nom d'hôte personnalisé
à la place. Une IP statique est réservée par défaut afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques
GKE et Cloud SQL sont envoyées à Cloud Monitoring. Des vérifications de disponibilité
et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application RAGFlow {#3-ragflow-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`mysql:8.0-debian`) crée la base de données RAGFlow (`rag_flow`)
  et l'utilisateur (`ragflow`) et accorde les privilèges avant le démarrage de
  l'application. Il est idempotent et peut être réexécuté en toute sécurité.
- **`service_conf.yaml` généré au démarrage.** Le point d'entrée personnalisé génère
  `/ragflow/conf/service_conf.yaml` à partir des variables d'environnement injectées — y compris
  l'hôte/utilisateur/base de données MySQL, le point de terminaison Elasticsearch,
  l'hôte/port Redis et les identifiants optionnels — avant de démarrer les processus
  RAGFlow (Nginx, serveur RAGFlow, workers de tâches).
- **Pipeline de traitement de documents.** Les documents téléchargés sont mis en
  file d'attente dans Redis et traités de manière asynchrone par les workers de
  documents de RAGFlow : OCR, découpage, intégration et indexation dans Elasticsearch.
  Sans un Redis et un Elasticsearch accessibles, les fichiers apparaissent téléchargés
  mais ne sont jamais traités.
- **Chargement du modèle d'intégration au démarrage.** RAGFlow télécharge et charge
  les modèles d'intégration lors du premier démarrage. La sonde de démarrage cible
  `/v1/health` avec un délai initial de 120 secondes et 60 tentatives de
  récupération pour laisser suffisamment de temps. La vivacité passe à `/v1/health`
  une fois le démarrage réussi.
- **Points de terminaison de santé.** Les sondes de disponibilité et de vivacité
  utilisent `/v1/health` et `/v1/system/version`. Celles-ci renvoient HTTP 200
  uniquement lorsque l'application est entièrement initialisée et que tous les
  services sont accessibles.
- **Affinité de session.** `session_affinity = "ClientIP"` achemine les requêtes d'un navigateur
  vers le même pod, garantissant que les sessions de téléchargement et les workflows
  de documents en cours restent cohérents.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour RAGFlow sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec son
comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |
| `elasticsearch_hosts` | _(obligatoire)_ | Point de terminaison HTTP Elasticsearch (par exemple `http://10.0.0.5:9200`). Défini sur la sortie `elasticsearch_endpoint` de `Elasticsearch_GKE`. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ragflow` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `RAGFlow` | Nom convivial affiché dans la console. |
| `application_description` / `description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `v0.13.0` | Balise de version d'image RAGFlow passée comme `APP_VERSION` à Cloud Build ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `4000m` | CPU par pod ; 4 vCPU recommandés pour les charges de travail d'analyse de documents. |
| `memory_limit` | `8Gi` | Mémoire par pod ; 8 GiB recommandés (les modèles d'intégration sont volumineux). |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Plafonné à 1 — la mise à l'échelle à zéro n'est pas prise en charge. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `80` | Le frontend Nginx de RAGFlow écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |
| `termination_grace_period_seconds` | `60` | Augmenter pour les jobs de traitement de documents en cours. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement — généreux pour s'adapter au chargement du modèle. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas écraser `MYSQL_*`, `ELASTICSEARCH_*` ou `REDIS_*` — ceux-ci sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant — requis pour des sessions de téléchargement et un traitement de documents cohérents. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `["nfsserver"]` | Balises de nœud/pod ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

Ces paramètres s'appliquent uniquement lorsque `workload_type = "StatefulSet"` ou `stateful_pvc_enabled = true`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Provisionner un PVC pour le stockage de modèles locaux. Recommandé pour la production. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC ; provisionner au moins 50 GiB pour les charges de travail de documents en production. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |
| `stateful_fs_group` | `0` | GID fsGroup pour la propriété du PVC ; à définir si le processus du conteneur nécessite un GID spécifique. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`8Gi`, `16384Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Augmenter `min_instance_count` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | `/v1/health`, délai de 120s, 60 tentatives | Sonde HTTP permettant un temps suffisant pour le chargement du modèle d'intégration. |
| `liveness_probe` / `health_check_config` | `/v1/health` | Sonde de vivacité HTTP une fois le démarrage réussi. |
| `uptime_check_config` | `{ enabled=false, path="/v1/health" }` | Vérification de disponibilité Cloud Monitoring optionnelle ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Tâches planifiées récurrentes déployées en tant que CronJobs Kubernetes. |
| `additional_services` | `[]` | Déploiements Kubernetes compagnons supplémentaires (par exemple, Elasticsearch intégré pour le développement). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le stockage de traitement de documents (garder activé pour les réplicas multiples). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS GCE existante ; auto-découvert lorsqu'il est vide. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de documents GCS. |
| `storage_buckets` | `[{ name_suffix="data" }]` | Buckets GCS supplémentaires au-delà de `ragflow-documents`. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse montés dans le conteneur RAGFlow. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options de chiffrement CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 15 — Elasticsearch et Redis {#group-15--elasticsearch--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour la file d'attente de tâches de traitement de documents. |
| `redis_host` | `""` | Hôte Redis. Lorsqu'il est vide et que NFS est activé, l'IP du serveur NFS est utilisée. Définir explicitement pour Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |
| `elasticsearch_username` | `""` | Nom d'utilisateur Elasticsearch. Laisser vide lorsque `xpack.security.enabled = false`. |
| `enable_inline_elasticsearch` | `false` | Déployer un sidecar Elasticsearch à nœud unique. **Développement uniquement** — les données sont perdues au redémarrage du pod. |
| `elasticsearch_version` | `8.13.0` | Balise d'image Elasticsearch pour l'instance intégrée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. |
| `db_name` | `rag_flow` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `ragflow` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `network_tags` | `["nfsserver"]` | Balises réseau GCP appliquées aux pods. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant RAGFlow. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre RAGFlow. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnels). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors de la première application d'un nouveau cluster intégré — le pipeline CI/CD doit réexécuter l'application pour terminer le déploiement. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `elasticsearch_hosts` | requis — défini à partir de `Elasticsearch_GKE` | Critique | RAGFlow ne peut pas indexer ou rechercher ; toutes les opérations d'ingestion et de récupération échouent. Le plan est rejeté lorsqu'il est vide et `deploy_application = true`. |
| `enable_redis` | `true` | Critique | Sans Redis, la file d'attente de tâches de traitement de documents ne s'exécute jamais ; les fichiers téléchargés restent non traités indéfiniment. |
| `database_type` | `MYSQL_8_0` | Critique | RAGFlow nécessite MySQL ; PostgreSQL/`NONE` empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | RAGFlow se connecte via un socket Unix ; la désactivation du sidecar proxy entraîne un échec de connexion à la base de données au démarrage. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `redis_host` | IP Memorystore explicite ou `""` (repli NFS) | Élevé | Un hôte Redis inaccessible ou erroné interrompt silencieusement tous les workers de documents asynchrones. |
| `min_instance_count` | `1` | Élevé | `0` provoque une mise à l'échelle à zéro ; les démarrages à froid prennent 2-3 minutes et les requêtes expirent. |
| `memory_limit` | `8Gi` | Élevé | Les modèles d'intégration plus le serveur d'application nécessitent généralement 4-8 GiB ; trop peu entraîne des arrêts OOM pendant le traitement des documents. |
| `stateful_pvc_enabled` | `true` pour la production | Élevé | Sans PVC, les redémarrages de pods perdent tout état de traitement en cours. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions de téléchargement multi-réplicas peuvent se répartir sur plusieurs pods. |
| `elasticsearch_username` | `""` ou utilisateur correct | Élevé | Si la sécurité Elasticsearch est activée, laisser ce champ vide provoque une erreur HTTP 401 et interrompt toute indexation. |
| `enable_nfs` | `true` | Élevé | Les déploiements multi-réplicas sans stockage partagé voient des vues de documents incohérentes entre les pods. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | L'interface web de RAGFlow est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |
| `application_version` | `v0.13.0` | Moyen | L'incrémentation déclenche une reconstruction d'image et un redémarrage progressif ; vérifier la compatibilité du schéma MySQL pour les sauts de version majeurs. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à RAGFlow
partagée avec la variante Cloud Run est décrite dans **[RAGFlow_Common](RAGFlow_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : RAGFlow sur GKE Autopilot](../labs/RAGFlow_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [RAGFlow sur Google Cloud Run](RAGFlow_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [RAGFlow Common — Configuration d'application partagée](RAGFlow_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md) dans la solution **Enterprise RAG & Document Intelligence**.
