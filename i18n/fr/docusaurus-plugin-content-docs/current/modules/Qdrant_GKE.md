---
title: "Qdrant sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Qdrant sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Qdrant_GKE.md @ 15fd4c7 sha256:c5a0fc5b4ded -->

# Qdrant sur GKE Autopilot {#qdrant-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Qdrant_GKE.png" alt="Qdrant sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Qdrant est une base de données vectorielle et un moteur de recherche de
similarité haute performance conçus pour les charges de travail d'IA — pipelines
RAG, systèmes de recommandation, recherche sémantique et stockage d'embeddings.
Ce module déploie Qdrant sur **GKE Autopilot** sur la base de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Qdrant et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Qdrant s'exécute en tant que charge de travail de base de données vectorielle
avec état sur Autopilot. Le déploiement relie un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Qdrant, 1 vCPU / 1 GiB par défaut, autoscaling horizontal |
| Stockage persistant (par défaut) | Persistent Disk via StatefulSet PVC | Disque RWO à faible latence à `/qdrant/storage` ; `standard-rwo` (Balanced PD) ou `premium-rwo` |
| Stockage persistant (non recommandé) | Cloud Storage via GCS FUSE | Utilisé uniquement si `stateful_pvc_enabled = false` ; la vérification de démarrage de Qdrant rejette le stockage basé sur FUSE ; `/qdrant/storage` monté à partir du bucket `<prefix>-storage` |
| Secrets | Secret Manager | Clé API optionnelle (`QDRANT__SERVICE__API_KEY`) |
| Ingress | Cloud Load Balancing | `ClusterIP` par défaut ; `LoadBalancer` ou domaine personnalisé lorsque l'accès externe est nécessaire |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL, pas de Redis.** Qdrant gère son propre stockage
  embarqué. Aucune instance Cloud SQL n'est créée.
- **Instance unique par défaut.** `max_instance_count = 1` est fortement
  recommandé. Qdrant est un magasin à écrivain unique — plusieurs pods sur le
  même chemin de stockage corrompent les collections.
- **StatefulSet avec un PVC de bloc par défaut.** `stateful_pvc_enabled = true` est
  la valeur par défaut et doit rester activée : la propre vérification de
  démarrage de Qdrant rejette le stockage basé sur FUSE (elle avertit d'une
  corruption de données), et les E/S WAL et HNSW nécessitent une sémantique
  POSIX réelle et une faible latence.
- **`ClusterIP` par défaut.** Qdrant ne doit pas être exposé
  publiquement sans protection par clé API. Ne changez `service_type` en `LoadBalancer`
  que si nécessaire.
- **Deux points de terminaison de santé distincts.** Le démarrage utilise
  `/readyz` ; la vivacité utilise `/livez`. Ne pointez jamais la sonde de
  vivacité vers `/readyz` — Qdrant se marque temporairement comme non prêt
  lors du chargement de grandes collections, ce qui provoquerait des redémarrages
  intempestifs des pods.
- **gRPC est désactivé par défaut.** Activez via `QDRANT__SERVICE__GRPC_PORT=6334`
  dans `environment_variables` et configurez manuellement un deuxième port de service.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Qdrant {#a-gke-autopilot--the-qdrant-workload}

Le pod Qdrant s'exécute sur Autopilot, qui facture le CPU/la mémoire réellement
demandés par le pod. L'autoscaling horizontal des pods est configuré, bien que
la valeur par défaut `max_instance_count = 1` maintienne un seul pod en cours
d'exécution pour éviter les conflits d'écriture.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Qdrant pour les pods, les événements et l'utilisation des
  ressources. Kubernetes Engine → Services et Ingress affiche l'IP de cluster
  (ou l'IP externe si `LoadBalancer` est utilisé).
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # Or for StatefulSet:
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Stockage persistant — StatefulSet PVC ou GCS FUSE {#b-persistent-storage--statefulset-pvc-or-gcs-fuse}

Qdrant persiste son WAL, ses données de collection, ses fichiers d'index HNSW et
ses métadonnées à `/qdrant/storage`. Deux backends de stockage sont pris en charge :

**StatefulSet PVC (par défaut) :** Un volume Persistent Disk est
lié au pod via un PersistentVolumeClaim. La classe de stockage est
`standard-rwo` (Balanced PD) par défaut, ou `premium-rwo` pour des IOPS plus
élevées.

**GCS FUSE (uniquement si `stateful_pvc_enabled = false` ; non recommandé) :** Un bucket
Cloud Storage nommé `<prefix>-storage` est monté à `/qdrant/storage` via le
pilote CSI GCS FUSE. La propre vérification du système de fichiers au démarrage
de Qdrant rejette le stockage basé sur FUSE comme risque de corruption de
données.

- **Console (PVC) :** Kubernetes Engine → Stockage → PersistentVolumeClaims.
  Compute Engine → Disques pour voir le Persistent Disk sous-jacent.
- **Console (GCS FUSE) :** Cloud Storage → Buckets — trouvez le bucket
  `*-storage`.
- **CLI :**
  ```bash
  # PVC status
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"

  # GCS bucket (when GCS FUSE is used)
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/

  # Confirm mount inside the pod
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls /qdrant/storage
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### C. Secret Manager — Clé API Qdrant {#c-secret-manager--qdrant-api-key}

Lorsque `enable_api_key = true`, une clé API alphanumérique de 32 caractères est
générée et stockée dans Secret Manager. Elle est injectée en tant que
`QDRANT__SERVICE__API_KEY` au moment de l'exécution, exigeant que tous les appelants REST et
gRPC passent `api-key: <key>` dans les en-têtes de requête.

- **Console :** Sécurité → Secret Manager — recherchez un secret nommé
  `<resource-prefix>-api-key`.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
  ```

L'ID du secret de la clé API est signalé dans les [Sorties](#5-outputs) comme
`qdrant_api_key_secret_id`. Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de
Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail n'est exposée qu'à l'intérieur du cluster via
un service `ClusterIP`. Changez `service_type` en `LoadBalancer` pour un
accès externe, ou activez un domaine personnalisé avec `enable_custom_domain = true` pour un
ingress HTTPS via l'API Kubernetes Gateway.

- **Console :** Kubernetes Engine → Services et Ingress ; Réseau VPC → Adresses
  IP (lorsqu'une IP statique est réservée).
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers
Cloud Monitoring. Des vérifications de disponibilité optionnelles (contre
`/readyz`) et des politiques d'alerte sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Qdrant {#3-qdrant-application-behaviour}

- **Pas de bootstrap de base de données.** Qdrant gère son propre moteur de
  stockage embarqué. Aucun job d'initialisation n'est injecté par défaut. La
  charge de travail démarre immédiatement après que le pod soit prêt.
- **Chargement de la collection au démarrage.** Qdrant charge toutes les
  collections du disque en mémoire pendant le démarrage. Pour les instances avec
  de grandes collections, le démarrage peut prendre des dizaines de secondes à
  plusieurs minutes. La sonde de démarrage (`/readyz`) attend que cela se
  termine avant que le trafic ne soit envoyé au pod.
- **Points de terminaison de vivacité et de disponibilité séparés.** `/readyz`
  renvoie 503 pendant le chargement des collections ; `/livez` renvoie
  toujours 200 tant que le processus est actif. La sonde de vivacité utilise
  `/livez` pour éviter les redémarrages intempestifs des pods pendant le
  chargement des collections. Ne changez pas la sonde de vivacité en
  `/readyz`.
- **Prise en charge gRPC (facultatif).** Qdrant prend en charge gRPC sur le port
  6334. Il n'est pas activé par défaut car le service ClusterIP/LoadBalancer par
  défaut n'expose que le port 6333. Pour activer gRPC, ajoutez
  `environment_variables = { QDRANT__SERVICE__GRPC_PORT = "6334" }` et
  configurez manuellement un deuxième port de service.
- **Tâches de snapshot et de maintenance.** Utilisez `cron_jobs` pour
  planifier des snapshots périodiques de collections Qdrant via l'API REST ou
  pour des routines de maintenance personnalisées.
- **Période de grâce de terminaison.** `termination_grace_period_seconds = 60` par
  défaut donne à Qdrant le temps de vider les écritures WAL en cours avant que
  le pod ne soit terminé de force.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Qdrant sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `qdrant` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Qdrant Vector Database` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Qdrant ; épingler à un tag semver pour la production (par exemple `v1.9.0`). |
| `enable_api_key` | `false` | Générer une clé API aléatoire dans Secret Manager ; requise pour tout déploiement accessible en dehors de l'espace de noms. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. Augmenter à `2000m`–`4000m` pour les builds d'index de production et les requêtes concurrentes. |
| `memory_limit` | `1Gi` | Mémoire par pod. Qdrant charge les index HNSW en RAM — taille basée sur les dimensions de la collection et le nombre de vecteurs. |
| `min_instance_count` | `1` | Réplicas minimum. Garder ≥ 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | Réplicas maximum. Garder à 1 — Qdrant est un magasin à écrivain unique. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources (désactive le HPA CPU/Mémoire). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Qdrant dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `timeout_seconds` | `300` | Délai d'expiration de la requête en secondes (0–3600). Augmenter pour les upserts par lots importants ou les opérations de snapshot. |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM que Qdrant vide les écritures WAL. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Utilisez les clés `QDRANT__…` pour remplacer la configuration de Qdrant. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation de Secret Manager (30 jours par défaut). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Découvert automatiquement si vide. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection de cluster : `explicit`, `round-robin` ou `primary`. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement si vide. |
| `workload_type` | `null` | `Deployment` ou `StatefulSet`. Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `ClusterIP` | Comment le service est exposé. `ClusterIP` (recommandé), `LoadBalancer` ou `NodePort`. |
| `session_affinity` | `None` | `None` ou `ClientIP`. Qdrant ne nécessite pas d'affinité de session. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy pour la micro-segmentation. |
| `configure_service_mesh` | `false` | Activer l'injection Istio pour l'espace de noms de l'application. |

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Activer le PVC pour StatefulSet (par défaut ; le laisser activé — Qdrant rejette le stockage basé sur FUSE). Sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. Taille pour contenir toutes les collections, les index HNSW et le WAL avec une marge. |
| `stateful_pvc_mount_path` | `/qdrant/storage` | Chemin du conteneur pour le PVC. Doit correspondre à `QDRANT__STORAGE__STORAGE_PATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (Balanced PD) ou `premium-rwo` pour des IOPS plus élevées. Ne peut pas être modifié après la création du PVC. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` assure des redémarrages séquentiels sûrs. |
| `stateful_update_strategy` | `null` | `RollingUpdate` pour des mises à jour sans interruption. |
| `stateful_fs_group` | `3000` | GID fsGroup défini dans le contexte de sécurité du pod pour l'accès en écriture au PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods sur plusieurs zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/readyz`, délai de 15s | Sonde HTTP — Qdrant signale qu'il est prêt une fois toutes les collections chargées. |
| `liveness_probe` | `/livez`, délai de 30s | Sonde HTTP — point de terminaison de vivacité dédié non affecté par l'état de chargement de la collection. |
| `uptime_check_config` | `disabled` | Vérification de disponibilité Cloud Monitoring optionnelle contre `/readyz`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Qdrant ne nécessite pas de job d'initialisation par défaut ; ne fournissez que des tâches de chargement de données ou de migration personnalisées. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les snapshots de collection périodiques ou les tâches de maintenance. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Qdrant. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Qdrant utilise GCS ou un PVC pour le stockage — n'activez NFS que pour les jobs d'initialisation personnalisés qui nécessitent un système de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod GKE ; `nfsserver` est requis lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket de stockage GCS (utilisé lorsque le PVC n'est pas activé). |
| `storage_buckets` / `gcs_volumes` | `[]` | Buckets supplémentaires / montages GCS FUSE. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneurs récentes à conserver dans Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner l'API Kubernetes Gateway avec des certificats SSL (une Gateway avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | Réserver une IP externe stable. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Kubernetes Gateway. Nécessite `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque l'IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend GKE Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN via GCPBackendPolicy. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre l'API REST Qdrant. |
| `qdrant_api_key_secret_id` | ID du secret Secret Manager pour la clé API Qdrant. Vide lorsque `enable_api_key = false`. |
| `statefulset_name` | Nom du StatefulSet (lorsque le type de charge de travail est StatefulSet). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_api_key` | `true` (tout déploiement externe) | Critique | Sans clé API, tout appelant pouvant atteindre le service peut lire, modifier ou supprimer toutes les collections. |
| `stateful_pvc_enabled` | `true` (par défaut) | Critique | Sans PVC, les données résident dans le système de fichiers éphémère du pod ; tout redémarrage efface toutes les collections de manière permanente. |
| `stateful_pvc_mount_path` | `/qdrant/storage` (par défaut) | Critique | Doit correspondre à `QDRANT__STORAGE__STORAGE_PATH`. Une non-concordance stocke les données dans la couche éphémère et les perd au redémarrage. |
| `application_name` | défini une fois | Critique | Immuable après le premier déploiement ; la modification recrée l'espace de noms et le stockage, entraînant la perte de toutes les collections. |
| `max_instance_count` | `1` | Élevé | Plusieurs pods Qdrant partageant un seul PVC (RWO) ou un bucket GCS corrompent les collections. Scalez verticalement, pas horizontalement. |
| Chemin `liveness_probe` | `/livez` (par défaut) | Élevé | Pointer la vivacité vers `/readyz` provoque des redémarrages intempestifs des pods chaque fois qu'une grande collection est chargée depuis le disque. |
| `memory_limit` | ≥ `4Gi` pour la production | Élevé | La valeur par défaut `1Gi` ne prend en charge que les petites collections de test ; les OOM kills terminent toutes les requêtes en cours et déclenchent un rechargement complet de l'index. |
| `stateful_pvc_size` | généreux (20 Gi+) | Élevé | Un PVC sous-dimensionné se remplit à mesure que les collections augmentent ; un disque plein fait planter Qdrant. La capacité du PVC ne peut pas être diminuée après la création. |
| `stateful_pvc_storage_class` | `standard-rwo` ou `premium-rwo` | Moyen | Ne peut pas être modifié après la création du PVC sans migration de données ; choisissez en fonction des exigences d'IOPS à l'avance. |
| `application_version` | épingler à semver pour la production | Moyen | L'utilisation de `latest` peut entraîner une mise à niveau involontaire du format de stockage qui rend les collections existantes illisibles. |
| `min_instance_count` | `1` | Moyen | Le scale-to-zero provoque un rechargement à froid de toutes les collections depuis le disque lors de la prochaine requête ; à éviter pour les charges de travail sensibles à la latence. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `enable_iap` / `enable_cloud_armor` | activer pour les déploiements exposés | Élevé | Sans contrôles d'accès, l'API REST Qdrant est accessible par tout appelant à l'intérieur du réseau. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Moyen | `1`/`1` peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Qdrant
partagée avec la variante Cloud Run est décrite dans
**[Qdrant_Common](Qdrant_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Qdrant sur GKE Autopilot](../labs/Qdrant_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Qdrant Common — Configuration d'application partagée](Qdrant_Common.md) — la configuration partagée par les deux cibles de déploiement.
