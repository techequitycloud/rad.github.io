---
title: "VictoriaMetrics sur GKE Autopilot"
description: "Référence de configuration pour déployer VictoriaMetrics sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/VictoriaMetrics_GKE.md @ 3055034 sha256:946a0da155bf -->

# VictoriaMetrics sur GKE Autopilot {#victoriametrics-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/VictoriaMetrics_GKE.png" alt="VictoriaMetrics sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

VictoriaMetrics est une base de données de séries temporelles rapide, économique
et compatible avec Prometheus — le backend auto-hébergé de stockage de métriques
de référence à associer au module Grafana de ce catalogue. Elle accepte
l'ingestion via Prometheus `remote_write`, le protocole de ligne InfluxDB,
Graphite et OpenTSDB en HTTP simple, et répond aux requêtes compatibles PromQL.
Ce module déploie VictoriaMetrics sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Il n'existe **aucune variante Cloud Run** de ce module — voir le §1 ci-dessous
pour en connaître la raison.

Ce guide se concentre sur les services cloud utilisés par VictoriaMetrics et sur
la manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

VictoriaMetrics s'exécute sur Autopilot sous forme de charge de travail de base de
données de séries temporelles à nœud unique et avec état. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod VictoriaMetrics, 1 vCPU / 1 GiB par défaut |
| Stockage persistant | Persistent Disk via un PVC de StatefulSet | Requis — monté sur `/victoria-metrics-data` ; classe de stockage `standard` (HDD `pd-standard`) par défaut |
| Secrets | aucun | VictoriaMetrics n'a aucune authentification intégrée — aucun secret Secret Manager n'est créé |
| Entrée | Cloud Load Balancing | `ClusterIP` par défaut (interne uniquement, à dessein — voir ci-dessous) ; `LoadBalancer` ou domaine personnalisé lorsque la collecte ou l'interrogation depuis l'extérieur est réellement nécessaire |

**Pourquoi uniquement GKE :** VictoriaMetrics stocke ses données de séries
temporelles sous forme de fichiers locaux sur disque mappés en mémoire (mmap)
(confirmé par la FAQ officielle : *"VictoriaMetrics stores data
in block storage..."*). Cela est incompatible avec le système de fichiers
éphémère propre à chaque révision de Cloud Run, ainsi qu'avec la sémantique de
verrouillage de fichiers et de mmap de GCS FUSE — la même catégorie de contrainte
déjà documentée pour ClickHouse, Elasticsearch et MongoDB dans ce catalogue.
`VictoriaMetrics_GKE` exige donc un véritable PersistentVolumeClaim de type bloc
(`stateful_pvc_enabled = true` par défaut) et n'a pas d'équivalent Cloud Run.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données SQL, aucun Redis.** VictoriaMetrics gère sa propre
  TSDB intégrée. Aucune instance Cloud SQL n'est créée ; `enable_redis` est codé
  en dur à `false`.
- **Une seule instance par défaut, et ce n'est pas un réglage « à augmenter plus
  tard ».** `max_instance_count = 1` — VictoriaMetrics en mode nœud unique n'a
  aucun clustering ni aucune réplication intégrés. Deux pods écrivant sur le même
  PVC corrompraient les données.
- **Le PVC du StatefulSet est requis, pas facultatif.** Contrairement à certaines
  applications avec état de ce catalogue pour lesquelles un repli GCS FUSE existe,
  VictoriaMetrics n'a aucun repli — ses fichiers de données mappés en mémoire ne
  sont pas compatibles avec FUSE, même en mode dégradé.
  `stateful_pvc_enabled = true` est la valeur par défaut et doit le rester.
- **`ClusterIP` par défaut — c'est correct, pas un bug.** VictoriaMetrics est
  conçu pour être alimenté et interrogé *en interne* par des clients compatibles
  Prometheus (un émetteur `remote_write`, `vmagent` ou Grafana) s'exécutant dans
  le même cluster, et non exposé comme une application web publique. C'est le
  même schéma, confirmé comme correct, que celui déjà documenté pour Qdrant et
  PhpMyAdmin dans ce catalogue — ne le « corrigez » pas en `LoadBalancer` en
  supposant qu'il s'agit du bug de copier-coller ClusterIP touchant l'ensemble du
  parc constaté ailleurs ; ce n'est vraiment pas le cas ici.
- **Classe de stockage HDD par défaut.** `stateful_pvc_storage_class = "standard"`
  (`pd-standard`), et non la classe `standard-rwo` sur SSD que de nombreux autres
  modules avec état utilisent par défaut — VictoriaMetrics est documenté comme
  tolérant aux stockages à latence élevée et à faible IOPS, ce qui évite de puiser
  dans le quota serré `SSD_TOTAL_GB`.
- **Configuration par flags CLI, pas par variables d'environnement.**
  VictoriaMetrics n'a aucune configuration par variables d'environnement.
  L'`ENTRYPOINT` de l'image personnalisée fixe directement `-storageDataPath`,
  `-httpListenAddr` et `-retentionPeriod` — voir le §4.
- **Un unique point de terminaison `/health`** sert à la fois la sonde de
  démarrage et la sonde de vivacité — il n'y a pas de distinction séparée entre
  disponibilité et activité.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail VictoriaMetrics {#a-gke-autopilot--the-victoriametrics-workload}

Le pod VictoriaMetrics s'exécute sur Autopilot, qui facture le CPU et la mémoire
que le pod demande réellement. `max_instance_count = 1` maintient un seul pod en
fonctionnement — la mise à l'échelle horizontale n'est volontairement pas prise
en charge pour ce déploiement à nœud unique.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge
  de travail VictoriaMetrics pour voir les pods, les événements et l'utilisation
  des ressources. Kubernetes Engine → Services & Ingress affiche la ClusterIP (ou
  l'IP externe si `LoadBalancer` est utilisé).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot et du type de charge
de travail (StatefulSet).

### B. Stockage persistant — PVC du StatefulSet (le seul backend pris en charge) {#b-persistent-storage--statefulset-pvc-the-only-supported-backend}

VictoriaMetrics conserve ses fichiers de données de séries temporelles dans
`/victoria-metrics-data`. Contrairement à plusieurs autres applications avec état
de ce catalogue, il n'existe aucun repli GCS FUSE — un véritable
PersistentVolumeClaim de type bloc est requis. La classe de stockage est
`standard` (HDD `pd-standard`) par défaut.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims.
  Compute Engine → Disks pour voir le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  # PVC status
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"

  # Confirm the mount and inspect on-disk data files inside the pod
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /victoria-metrics-data
  ```

Consultez [App_GKE](App_GKE.md) pour les mécanismes des PVC de StatefulSet et les
options de classe de stockage en général.

### C. Aucun secret Secret Manager {#c-no-secret-manager-secrets}

VictoriaMetrics n'a aucune authentification intégrée ; `VictoriaMetrics_Common`
ne génère et ne stocke donc aucun secret. L'accès est entièrement contrôlé au
niveau réseau — par la valeur par défaut `ClusterIP`, ou par IAP / Cloud Armor si
le service est délibérément rendu accessible de l'extérieur. Il n'y a rien à
récupérer dans Secret Manager pour ce module.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail n'est exposée qu'à l'intérieur du cluster via un
service `ClusterIP` — le mode d'accès prévu est Grafana, `vmagent` ou un émetteur
Prometheus `remote_write` s'exécutant dans le même cluster. Passez `service_type`
à `LoadBalancer` uniquement si vous avez réellement besoin de collecter ou
d'interroger les données depuis l'extérieur du cluster (et ajoutez d'abord vos
propres contrôles d'accès — VictoriaMetrics lui-même n'en applique aucun).

- **Console :** Kubernetes Engine → Services & Ingress ; VPC network → IP addresses (lorsqu'une IP statique est réservée).
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques GKE sont envoyées vers Cloud Monitoring. Des tests de disponibilité
(sur `/health`) et des règles d'alerte facultatifs sont disponibles, mais ils
n'ont de sens qu'une fois le service accessible depuis l'endroit d'où part le
test.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application VictoriaMetrics {#3-victoriametrics-application-behaviour}

- **Aucun amorçage de base de données, aucun job d'initialisation.**
  VictoriaMetrics gère sa propre TSDB intégrée. C'est un binaire autonome sans
  notion de schéma ni de migration — aucun job d'initialisation n'est injecté
  par défaut, et aucune n'est nécessaire. La charge de travail commence à servir
  dès que son répertoire de données est monté.
- **Point de terminaison de santé.** Un unique point de terminaison `/health` non
  authentifié (qui renvoie `OK`) sert à la fois les sondes de démarrage et
  d'activité — il n'y a pas de séparation entre disponibilité et activité,
  contrairement aux applications dont la séquence de démarrage est plus lourde.
- **Comment les métriques ENTRENT.** VictoriaMetrics accepte plusieurs protocoles
  d'ingestion en HTTP simple sur le port `8428` :
  - Prometheus `remote_write` → `POST /api/v1/write`
  - Protocole de ligne InfluxDB → `/write`
  - Protocole Graphite plaintext / pickle
  - OpenTSDB `/api/put` et telnet put
  - Son propre agent piloté par une configuration de collecte, `vmagent`, peut
    également être déployé en sidecar (via `additional_services`) pour récupérer
    les métriques depuis des points de terminaison Prometheus `/metrics`, à
    l'image de ce que ferait un serveur Prometheus autonome.
- **Comment l'INTERROGER.** VictoriaMetrics expose une API de requête compatible
  PromQL (`/api/v1/query`, `/api/v1/query_range`, `/api/v1/series`, ...) — la même
  surface que l'API HTTP de Prometheus elle-même. Pointez Grafana vers elle en
  utilisant le type de source de données **Prometheus**, avec l'URL définie sur le
  nom DNS interne du service VictoriaMetrics (ou son URL externe, s'il est exposé),
  sans plugin requis.
- **La rétention est intégrée à l'image, et non configurable à l'exécution.**
  `-retentionPeriod=12` (12 mois) est compilé dans l'`ENTRYPOINT` de l'image
  personnalisée (voir le §4). Elle n'est pas exposée sous forme de variable
  Terraform — la modifier nécessite d'éditer
  `VictoriaMetrics_Common/scripts/Dockerfile` et de forcer un nouveau build.
- **Aucun clustering.** Ce module déploie VictoriaMetrics en mode **nœud
  unique**. VictoriaMetrics dispose également d'une édition « cluster »
  (`vminsert`/`vmstorage`/
  `vmselect`) pour la mise à l'échelle horizontale, mais il s'agit d'une topologie
  de déploiement entièrement différente, qui n'est pas celle que provisionne ce
  module.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à VictoriaMetrics ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `victoriametrics` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `VictoriaMetrics` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de l'image VictoriaMetrics. `latest` est associé à une version épinglée et éprouvée (`v1.148.0`) comme argument de build du Dockerfile, car l'image amont n'a pas de tag `latest` flottant qui lui soit propre. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. Environ 1 GB de RAM pour 1M de séries temporelles actives est la recommandation de dimensionnement amont ; maintenez l'utilisation propre de VictoriaMetrics sous environ 50 % de la mémoire disponible pour laisser de la marge au cache de pages du système d'exploitation. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez 1 — un StatefulSet avec `replicas=0` n'a rien pour servir les requêtes. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. **Doit rester à 1** — aucun clustering ni aucune réplication en mode nœud unique. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources (désactive le HPA sur le CPU et la mémoire). |
| `enable_image_mirroring` | `true` | Dupliquer l'image VictoriaMetrics dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `timeout_seconds` | `300` | Délai d'expiration des requêtes en secondes (0–3600). |
| `termination_grace_period_seconds` | `60` | Nombre de secondes pendant lesquelles Kubernetes attend, après SIGTERM, que VictoriaMetrics écrive sur disque les écritures en cours. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires. **VictoriaMetrics ne lit pas les variables d'environnement pour sa configuration** — uniquement des flags CLI intégrés à l'image (§4 ci-dessus) ; les valeurs définies ici n'ont aucun effet sur le binaire en cours d'exécution, sauf s'il lit justement cette variable exacte, ce qui n'est pas le cas par défaut. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. Non renseignée par défaut — VictoriaMetrics n'a aucune authentification intégrée. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Période de rappel de rotation de Secret Manager (30 jours par défaut). Non applicable, sauf si vous ajoutez vos propres secrets. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster cible. Découvert automatiquement s'il est vide. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de sélection du cluster : `explicit`, `round-robin` ou `primary`. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement s'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (la valeur par défaut). |
| `service_type` | `ClusterIP` | Mode d'exposition du Service. `ClusterIP` est correct et voulu ici — voir le §1. |
| `session_affinity` | `None` | `None` ou `ClientIP`. |
| `enable_network_segmentation` | `false` | Créer des ressources NetworkPolicy Kubernetes pour la micro-segmentation. |
| `configure_service_mesh` | `false` | Activer l'injection Istio pour l'espace de noms de l'application. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Requis** — les fichiers de données sur disque local de VictoriaMetrics, mappés en mémoire, ne sont pas compatibles avec GCS FUSE, même comme repli. Doit rester à `true`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. Dimensionnez-le pour contenir toute la fenêtre de rétention (12 mois par défaut) plus le surcoût des fusions — environ 20 % d'espace libre recommandé. |
| `stateful_pvc_mount_path` | `/victoria-metrics-data` | Chemin du PVC dans le conteneur. Doit correspondre au flag `-storageDataPath` intégré à l'image. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` par défaut — VictoriaMetrics est documenté comme tolérant aux faibles IOPS, ce qui évite le quota serré `SSD_TOTAL_GB`. |
| `stateful_headless_service` | `null` | Créer un Service headless pour des identités réseau stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` garantit des redémarrages séquentiels sûrs. |
| `stateful_update_strategy` | `null` | `RollingUpdate` pour des mises à jour sans interruption de service. |
| `stateful_fs_group` | `3000` | GID fsGroup défini dans le contexte de sécurité du pod. VictoriaMetrics s'exécute avec l'UID 1000/GID 2000 ; `3000` garantit que le PVC est accessible en écriture par le groupe. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. Avec `max_instance_count = 1`, le pod unique ne peut pas être évincé tout en respectant `pdb_min_available = 1` — tenez-en compte dans la planification des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Sans intérêt avec un seul réplica. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/health`, délai de 15s | Sonde HTTP. |
| `liveness_probe` | `/health`, délai de 30s | Sonde HTTP. Même point de terminaison que pour le démarrage — VictoriaMetrics ne distingue pas disponibilité et activité. |
| `uptime_check_config` | `disabled` | Test de disponibilité Cloud Monitoring facultatif sur `/health`. Utile uniquement si le service est accessible depuis l'endroit d'où part le test. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | VictoriaMetrics ne nécessite aucun job d'initialisation par défaut — il est autonome, sans notion de schéma ni de migration. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour la maintenance périodique, par exemple un export scripté d'instantané `vmbackup`. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de VictoriaMetrics — par exemple un sidecar `vmagent` de collecte et de transfert. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | VictoriaMetrics utilise un PVC de type bloc pour le stockage — activez NFS uniquement pour des jobs personnalisés nécessitant un système de fichiers partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods GKE ; `nfsserver` est requis lorsque NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS définis dans `storage_buckets`. VictoriaMetrics lui-même ne déclare **aucun bucket par défaut** — son intégration GCS/S3 sert uniquement aux sauvegardes, jamais de stockage servant les requêtes en direct. |
| `storage_buckets` / `gcs_volumes` | `[]` | Buckets supplémentaires / montages GCS FUSE, sans rapport avec le stockage principal. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images de conteneur récentes à conserver dans Artifact Registry (pour l'image issue du build personnalisé). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). Aucun mécanisme de sauvegarde par défaut n'est câblé pour VictoriaMetrics au-delà du point d'accroche générique de planification du socle — utilisez `cron_jobs` avec `vmbackup` pour des sauvegardes par instantané tenant compte de l'application. |
| `backup_retention_days` | `7` | Durée de rétention. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner la Kubernetes Gateway API avec des certificats SSL. N'a de sens que lorsque le service est délibérément rendu accessible de l'extérieur — `service_type` reste `ClusterIP` par défaut. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Réserver une IP externe stable. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google via Kubernetes Gateway. Nécessite `enable_custom_domain`. Recommandé plutôt qu'un simple `LoadBalancer` si VictoriaMetrics est un jour exposé hors du cluster, puisqu'il n'a aucune authentification propre. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress GKE. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN via GCPBackendPolicy. Sans intérêt pour une API de métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Aucune base de données SQL, aucun Redis, aucun secret {#5-no-sql-database-no-redis-no-secrets}

Trois éléments que ce module ne provisionne délibérément **pas**, contrairement à
la plupart des modules applicatifs de ce catalogue :

- **Aucune instance Cloud SQL.** `database_type = "NONE"` est fixé par
  `VictoriaMetrics_Common`. VictoriaMetrics est lui-même une base de données.
- **Aucun Redis.** `enable_redis` est codé en dur à `false` dans `main.tf`, ce qui
  remplace la valeur par défaut `true` d'`App_GKE`.
- **Aucun secret Secret Manager.** La sortie `secret_ids` de
  `VictoriaMetrics_Common` vaut toujours `{}`. Il n'y a ni clé d'API, ni mot de
  passe administrateur, ni identifiant d'aucune sorte à récupérer — le contrôle
  d'accès se fait entièrement au niveau réseau (`service_type`, IAP, Cloud Armor).

---

## 6. Sorties {#6-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre l'API HTTP de VictoriaMetrics — DNS interne `*.svc.cluster.local` par défaut. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés — vide par défaut (VictoriaMetrics n'en déclare aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (par défaut, requis) | Critique | Sans PVC, il n'existe aucun mode de stockage pris en charge pour ce module — les fichiers de données de VictoriaMetrics, mappés en mémoire, ne sont pas compatibles avec GCS FUSE, même comme repli. Ne le désactivez pas. |
| `stateful_pvc_mount_path` | `/victoria-metrics-data` (par défaut) | Critique | Doit correspondre au flag `-storageDataPath` intégré à l'image personnalisée. En cas de discordance, le PVC est monté à un endroit où le binaire n'écrit jamais, et toutes les données résident dans la couche éphémère du pod — perdues à chaque redémarrage. |
| `service_type` | `ClusterIP` (par défaut) — **ne le « corrigez » pas en `LoadBalancer`** | Critique (en cas de modification imprudente) | C'est la valeur par défaut confirmée comme correcte pour cette application, et non le bug de copier-coller ClusterIP touchant l'ensemble du parc documenté ailleurs dans ce catalogue. VictoriaMetrics n'a aucune authentification intégrée — l'exposer via `LoadBalancer` sans IAP ni Cloud Armor rend toutes les métriques ingérées lisibles, modifiables et supprimables par quiconque peut atteindre l'IP. |
| `application_name` | défini une seule fois | Critique | Immuable après le premier déploiement ; le modifier recrée l'espace de noms et le PVC, ce qui fait perdre tout l'historique des métriques ingérées. |
| `max_instance_count` | `1` (fixe) | Critique | VictoriaMetrics en mode nœud unique n'a ni clustering ni réplication — un second réplica écrivant sur le même PVC corrompt les fichiers de données. Il n'existe aucun moyen pris en charge de mettre ce module à l'échelle horizontalement ; utilisez l'édition cluster distincte de VictoriaMetrics (que ce module ne déploie pas) si vous en avez besoin. |
| `-retentionPeriod` (intégré à l'image) | `12` mois (par défaut) | Élevé | Ce n'est pas une variable Terraform — modifier la rétention nécessite d'éditer `VictoriaMetrics_Common/scripts/Dockerfile` et de forcer un nouveau build de l'image. Les données plus anciennes que la fenêtre de rétention sont supprimées par VictoriaMetrics lui-même selon son propre calendrier ; il n'y a ni suppression réversible ni corbeille. |
| `environment_variables` | sans effet sur la configuration de VictoriaMetrics | Moyen | VictoriaMetrics ne lit aucune variable d'environnement pour sa propre configuration — uniquement des flags CLI intégrés à l'image. Ne vous attendez pas à ce qu'une variable d'environnement de type `VICTORIA_METRICS_*` modifie le comportement ; ce ne sera pas le cas, sauf si le binaire amont lit justement ce nom exact (ce qui n'est pas le cas par défaut). |
| `stateful_pvc_size` | généreuse (20 Gi+, à dimensionner selon rétention × débit d'ingestion) | Élevé | Un PVC sous-dimensionné se remplit à mesure que les données de la fenêtre de rétention s'accumulent ; un disque plein interrompt l'ingestion et les fusions. La capacité d'un PVC ne peut pas être réduite après sa création, et l'augmenter nécessite un redimensionnement tenant compte du StatefulSet. |
| `stateful_pvc_storage_class` | `standard` (HDD, par défaut) | Moyen | Ne peut pas être modifiée après la création du PVC sans migration des données. Le HDD est la valeur par défaut raisonnable (VictoriaMetrics tolère les faibles IOPS) — passer à `standard-rwo`/SSD n'a d'intérêt que pour une très forte concurrence de requêtes et puise dans le quota serré `SSD_TOTAL_GB`. |
| `application_version` | épingler un tag précis en production | Moyen | `latest` est associé à une version épinglée fixe (`v1.148.0`) au moment du build dans ce module — contrairement à d'autres applications, « latest » ne dérive donc pas silencieusement ici lors d'un nouveau build. Épinglez tout de même explicitement si vous avez besoin d'une reproductibilité stricte entre environnements. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro ne laisse rien pour servir les requêtes ni accepter l'ingestion ; aucun comportement de rechargement au démarrage à froid n'est fiable pour un backend de métriques dont d'autres systèmes dépendent en permanence. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification. |
| `enable_iap` / `enable_cloud_armor` | à activer si `service_type` est un jour modifié par rapport à `ClusterIP` | Élevé | VictoriaMetrics n'applique aucun contrôle d'accès propre — tout ce qui peut atteindre le port peut lire et écrire toutes les données de métriques. |
| `pdb_min_available` vs `min_instance_count` | tenir compte de l'interaction | Moyen | `1`/`1` (les valeurs par défaut) signifie que le pod unique ne peut pas être évincé volontairement tout en respectant le PDB — cela peut bloquer les mises à niveau des nœuds jusqu'à ce que Kubernetes se rabatte sur d'autres stratégies d'éviction. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
VictoriaMetrics est décrite dans **[VictoriaMetrics_Common](VictoriaMetrics_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : VictoriaMetrics sur GKE Autopilot](../labs/VictoriaMetrics_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [VictoriaMetrics Common — Configuration applicative partagée](VictoriaMetrics_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observability & On-call**.
