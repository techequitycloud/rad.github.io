---
title: "Qdrant sur GKE Autopilot"
description: "Référence de configuration pour déployer Qdrant sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Qdrant_GKE.md @ 3055034 sha256:1fe4c37dd59b -->

# Qdrant sur GKE Autopilot {#qdrant-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Qdrant_GKE.png" alt="Qdrant sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Qdrant est une base de données vectorielle et un moteur de recherche par similarité
hautes performances, conçus pour les charges de travail d'IA — pipelines RAG,
systèmes de recommandation, recherche sémantique et stockage d'embeddings. Ce module
déploie Qdrant sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Qdrant et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Qdrant s'exécute comme une charge de travail de base de données vectorielle avec
état sur Autopilot. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Qdrant, 1 vCPU / 1 GiB par défaut, mise à l'échelle horizontale automatique |
| Stockage persistant (recommandé) | Persistent Disk via un PVC de StatefulSet | Disque RWO à faible latence sur `/qdrant/storage` ; `standard-rwo` (Balanced PD) ou `premium-rwo` |
| Stockage persistant (alternative) | Cloud Storage via GCS FUSE | Valeur par défaut lorsque le PVC n'est pas activé ; `/qdrant/storage` monté depuis le bucket `<prefix>-storage` |
| Secrets | Secret Manager | Clé d'API facultative (`QDRANT__SERVICE__API_KEY`) |
| Entrée | Cloud Load Balancing | `ClusterIP` par défaut ; `LoadBalancer` ou domaine personnalisé lorsqu'un accès externe est nécessaire |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL, pas de Redis.** Qdrant gère son propre stockage
  intégré. Aucune instance Cloud SQL n'est créée.
- **Instance unique par défaut.** `max_instance_count = 1` est fortement
  recommandé. Qdrant est un stockage à rédacteur unique — plusieurs pods sur le
  même chemin de stockage corrompent les collections.
- **PVC de StatefulSet fortement recommandé en production.** GCS FUSE est la
  valeur par défaut lorsque `stateful_pvc_enabled` n'est pas défini, mais les E/S du
  WAL et de HNSW sont sensibles à la latence ; un PVC offre une latence nettement
  plus faible. Définissez `stateful_pvc_enabled = true` pour tout déploiement de
  production.
- **`ClusterIP` par défaut.** Qdrant ne doit pas être exposé publiquement sans
  protection par clé d'API. Ne passez `service_type` à `LoadBalancer` qu'en cas de
  besoin.
- **Deux points de terminaison de santé distincts.** Le démarrage utilise
  `/readyz` ; la vivacité utilise `/livez`. Ne faites jamais pointer la sonde de
  vivacité vers `/readyz` — Qdrant se déclare temporairement non prêt pendant le
  chargement de grandes collections, ce qui provoquerait des redémarrages
  intempestifs des pods.
- **gRPC est désactivé par défaut.** Activez-le via `QDRANT__SERVICE__GRPC_PORT=6334`
  dans `environment_variables` et configurez manuellement un second port de Service.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Qdrant {#a-gke-autopilot--the-qdrant-workload}

Le pod Qdrant s'exécute sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par le pod. L'autoscaling horizontal des pods est configuré, mais la
valeur par défaut `max_instance_count = 1` maintient un seul pod en cours
d'exécution afin d'éviter les conflits d'écriture.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Qdrant pour consulter les pods, les événements et l'utilisation des ressources.
  Kubernetes Engine → Services & Ingress affiche le ClusterIP (ou l'IP externe si
  `LoadBalancer` est utilisé).
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # Or for StatefulSet:
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle
et le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Stockage persistant — PVC de StatefulSet ou GCS FUSE {#b-persistent-storage--statefulset-pvc-or-gcs-fuse}

Qdrant conserve son WAL, les données des collections, les fichiers d'index HNSW et
les métadonnées dans `/qdrant/storage`. Deux backends de stockage sont pris en
charge :

**PVC de StatefulSet (recommandé en production) :** un volume Persistent Disk est
lié au pod via une PersistentVolumeClaim. La classe de stockage est
`standard-rwo` (Balanced PD) par défaut, ou `premium-rwo` pour davantage d'IOPS.

**GCS FUSE (valeur par défaut lorsque le PVC n'est pas activé) :** un bucket
Cloud Storage nommé `<prefix>-storage` est provisionné et monté sur
`/qdrant/storage` via le pilote CSI GCS FUSE.

- **Console (PVC) :** Kubernetes Engine → Storage → PersistentVolumeClaims.
  Compute Engine → Disks pour voir le Persistent Disk sous-jacent.
- **Console (GCS FUSE) :** Cloud Storage → Buckets — repérez le bucket `*-storage`.
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

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les
options CMEK.

### C. Secret Manager — la clé d'API Qdrant {#c-secret-manager--qdrant-api-key}

Lorsque `enable_api_key = true`, une clé d'API alphanumérique de 32 caractères est
générée et stockée dans Secret Manager. Elle est injectée sous la forme
`QDRANT__SERVICE__API_KEY` à l'exécution, ce qui oblige tous les appelants REST et
gRPC à transmettre `api-key: <key>` dans les en-têtes de requête.

- **Console :** Security → Secret Manager — recherchez un secret nommé
  `<resource-prefix>-api-key`.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
  ```

L'ID du secret de la clé d'API est indiqué dans les [sorties](#5-outputs) sous
`qdrant_api_key_secret_id`. Consultez [App_GKE](App_GKE.md) pour l'intégration
Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail n'est exposée qu'à l'intérieur du cluster via un
service `ClusterIP`. Passez `service_type` à `LoadBalancer` pour un accès externe,
ou activez un domaine personnalisé avec `enable_custom_domain = true` pour une
entrée HTTPS via la Kubernetes Gateway API.

- **Console :** Kubernetes Engine → Services & Ingress ; VPC network → IP
  addresses (lorsqu'une IP statique est réservée).
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl get ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
GKE, vers Cloud Monitoring. Des tests de disponibilité (sur `/readyz`) et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Qdrant {#3-qdrant-application-behaviour}

- **Aucun amorçage de base de données.** Qdrant gère son propre moteur de stockage
  intégré. Aucun job d'initialisation n'est injecté par défaut. La charge de travail
  démarre dès que le pod est prêt.
- **Chargement des collections au démarrage.** Qdrant charge toutes les
  collections depuis le disque en mémoire au démarrage. Pour les instances
  comportant de grandes collections, le démarrage peut prendre de plusieurs
  dizaines de secondes à plusieurs minutes. La sonde de démarrage (`/readyz`)
  attend la fin de ce chargement avant que du trafic soit envoyé au pod.
- **Points de terminaison de vivacité et de disponibilité distincts.** `/readyz`
  renvoie 503 pendant le chargement des collections ; `/livez` renvoie toujours 200
  tant que le processus est actif. La sonde de vivacité utilise `/livez` pour éviter
  des redémarrages intempestifs des pods pendant le chargement des collections. Ne
  remplacez pas la sonde de vivacité par `/readyz`.
- **Prise en charge de gRPC (facultative).** Qdrant prend en charge gRPC sur le
  port 6334. Il n'est pas activé par défaut, car le Service ClusterIP/LoadBalancer
  par défaut n'expose que le port 6333. Pour activer gRPC, ajoutez
  `environment_variables = { QDRANT__SERVICE__GRPC_PORT = "6334" }` et
  configurez manuellement un second port de Service.
- **Tâches de snapshot et de maintenance.** Utilisez `cron_jobs` pour planifier des
  snapshots périodiques des collections Qdrant via l'API REST ou des routines de
  maintenance personnalisées.
- **Délai de grâce à l'arrêt.** `termination_grace_period_seconds = 60` par
  défaut laisse à Qdrant le temps de vider les écritures WAL en cours avant que le
  pod ne soit arrêté de force.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Qdrant ou notables pour
lui sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `qdrant` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Qdrant Vector Database` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Qdrant ; épinglez un tag semver en production (p. ex. `v1.9.0`). |
| `enable_api_key` | `false` | Génère une clé d'API aléatoire dans Secret Manager ; obligatoire pour tout déploiement joignable hors de l'espace de noms. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. Augmentez à `2000m`–`4000m` pour les constructions d'index et les requêtes concurrentes en production. |
| `memory_limit` | `1Gi` | Mémoire par pod. Qdrant charge les index HNSW en RAM — dimensionnez selon les dimensions des collections et le nombre de vecteurs. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid pendant le chargement des index. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Conservez 1 — Qdrant est un stockage à rédacteur unique. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources (désactive le HPA CPU/mémoire). |
| `enable_image_mirroring` | `true` | Met en miroir l'image Qdrant dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `timeout_seconds` | `300` | Délai d'expiration des requêtes en secondes (0–3600). Augmentez-le pour les upserts par lots volumineux ou les opérations de snapshot. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes pendant lesquelles Kubernetes attend, après SIGTERM, que Qdrant vide ses écritures WAL. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Utilisez des clés `QDRANT__…` pour surcharger la configuration de Qdrant. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation Secret Manager (30 jours par défaut). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Découvert automatiquement s'il est vide. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection du cluster : `explicit`, `round-robin` ou `primary`. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement s'il est vide. |
| `workload_type` | `null` | `Deployment` ou `StatefulSet`. Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `ClusterIP` | Mode d'exposition du Service. `ClusterIP` (recommandé), `LoadBalancer` ou `NodePort`. |
| `session_affinity` | `None` | `None` ou `ClientIP`. Qdrant ne nécessite pas d'affinité de session. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes pour la micro-segmentation. |
| `configure_service_mesh` | `false` | Active l'injection Istio pour l'espace de noms de l'application. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active le PVC du StatefulSet. Fortement recommandé en production. Définir `true` sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. Dimensionnez-le pour contenir toutes les collections, les index HNSW et le WAL, avec de la marge. |
| `stateful_pvc_mount_path` | `/qdrant/storage` | Chemin du PVC dans le conteneur. Doit correspondre à `QDRANT__STORAGE__STORAGE_PATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (Balanced PD) ou `premium-rwo` pour davantage d'IOPS. Ne peut pas être modifiée après la création du PVC. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` garantit des redémarrages séquentiels sûrs. |
| `stateful_update_strategy` | `null` | `RollingUpdate` pour des mises à jour sans interruption. |
| `stateful_fs_group` | `3000` | GID fsGroup défini dans le contexte de sécurité du pod pour l'accès en écriture au PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Utilisez obligatoirement des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/readyz`, délai de 15s | Sonde HTTP — Qdrant se déclare prêt une fois toutes les collections chargées. |
| `liveness_probe` | `/livez`, délai de 30s | Sonde HTTP — point de terminaison de vivacité dédié, indépendant de l'état de chargement des collections. |
| `uptime_check_config` | `disabled` | Test de disponibilité Cloud Monitoring facultatif sur `/readyz`. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Qdrant ne nécessite aucun job d'initialisation par défaut ; ne fournissez que des tâches personnalisées de chargement de données ou de migration. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour des snapshots périodiques des collections ou des tâches de maintenance. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Qdrant. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Qdrant utilise GCS ou un PVC pour le stockage — n'activez NFS que pour des jobs d'initialisation personnalisés ayant besoin d'un système de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods GKE ; `nfsserver` est obligatoire lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de stockage GCS (utilisé lorsque le PVC n'est pas activé). |
| `storage_buckets` / `gcs_volumes` | `[]` | Buckets / montages GCS FUSE supplémentaires. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneur récentes conservées dans Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la Kubernetes Gateway API avec des certificats SSL (une Gateway avec IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Réserve une IP externe stable. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google via la Kubernetes Gateway. Exige `enable_custom_domain`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress GKE. |
| `admin_ip_ranges` | `[]` | CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN via GCPBackendPolicy. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (exige `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour joindre l'API REST de Qdrant. |
| `qdrant_api_key_secret_id` | ID du secret Secret Manager de la clé d'API Qdrant. Vide lorsque `enable_api_key = false`. |
| `statefulset_name` | Nom du StatefulSet (lorsque le type de charge de travail est StatefulSet). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / interruption / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_api_key` | `true` (tout déploiement externe) | Critical | Sans clé d'API, tout appelant capable de joindre le service peut lire, modifier ou supprimer toutes les collections. |
| `stateful_pvc_enabled` | `true` en production | Critical | Sans PVC, les données résident dans le système de fichiers éphémère du pod ; tout redémarrage efface définitivement toutes les collections. |
| `stateful_pvc_mount_path` | `/qdrant/storage` (valeur par défaut) | Critical | Doit correspondre à `QDRANT__STORAGE__STORAGE_PATH`. Une incohérence stocke les données dans la couche éphémère et les perd au redémarrage. |
| `application_name` | à définir une seule fois | Critical | Immuable après le premier déploiement ; le modifier recrée l'espace de noms et le stockage, et fait perdre toutes les collections. |
| `max_instance_count` | `1` | High | Plusieurs pods Qdrant partageant un même PVC (RWO) ou bucket GCS corrompent les collections. Faites évoluer verticalement, pas horizontalement. |
| Chemin de `liveness_probe` | `/livez` (valeur par défaut) | High | Faire pointer la vivacité vers `/readyz` provoque des redémarrages intempestifs des pods à chaque chargement d'une grande collection depuis le disque. |
| `memory_limit` | ≥ `4Gi` en production | High | La valeur par défaut `1Gi` ne prend en charge que de petites collections de test ; les arrêts pour manque de mémoire (OOM) interrompent toutes les requêtes en cours et déclenchent un rechargement complet des index. |
| `stateful_pvc_size` | généreux (20 Gi+) | High | Un PVC sous-dimensionné se remplit à mesure que les collections grossissent ; un disque plein fait planter Qdrant. La capacité d'un PVC ne peut pas être réduite après sa création. |
| `stateful_pvc_storage_class` | `standard-rwo` ou `premium-rwo` | Medium | Ne peut pas être modifiée après la création du PVC sans migration des données ; choisissez-la d'emblée en fonction des besoins en IOPS. |
| `application_version` | épingler une version semver en production | Medium | Utiliser `latest` peut provoquer une mise à niveau involontaire du format de stockage qui rend les collections existantes illisibles. |
| `min_instance_count` | `1` | Medium | La mise à l'échelle à zéro entraîne un rechargement à froid de toutes les collections depuis le disque à la requête suivante ; à éviter pour les charges de travail sensibles à la latence. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers bruts sont des octets et bloquent toute planification. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les déploiements exposés | High | Sans contrôles d'accès, l'API REST de Qdrant est joignable par tout appelant à l'intérieur du réseau. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | prévoir de la marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Qdrant, partagée
avec la variante Cloud Run, est décrite dans **[Qdrant_Common](Qdrant_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Qdrant sur GKE Autopilot](../labs/Qdrant_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Qdrant Common — Configuration applicative partagée](Qdrant_Common.md) — la configuration partagée par les deux cibles de déploiement.
