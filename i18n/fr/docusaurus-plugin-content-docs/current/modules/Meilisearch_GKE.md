---
title: "Meilisearch sur GKE Autopilot"
description: "Référence de configuration pour déployer Meilisearch sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Meilisearch_GKE.md @ 3055034 sha256:0fd6c190461f -->

# Meilisearch sur GKE Autopilot {#meilisearch-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Meilisearch_GKE.png" alt="Meilisearch sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Meilisearch est un moteur de recherche open source rapide — un binaire Rust unique qui
offre une recherche instantanée, tolérante aux fautes de frappe et à facettes, derrière une
API REST simple. Il est largement utilisé comme alternative auto-hébergeable à Algolia. Ce module
déploie Meilisearch sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Meilisearch et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à
l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Meilisearch s'exécute sous forme de charge de travail Rust à binaire unique, idéalement en
StatefulSet avec un PVC Persistent Disk. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Rust, 1 vCPU / 1 GiB par défaut, réplica unique (écrivain unique) |
| Stockage persistant | PVC Persistent Disk ou Cloud Storage (GCS FUSE) | `MEILI_DB_PATH` est fixé à `/meili_data`, et GCS FUSE s'y monte automatiquement ; le `stateful_pvc_mount_path` du PVC du StatefulSet utilise par défaut un autre chemin (`/meilisearch/storage`) — surchargez-le à `/meili_data` pour aligner les deux |
| Base de données | Aucune | Meilisearch est autonome — pas de Cloud SQL, pas de base de données externe |
| Cache et file d'attente | Aucun | Meilisearch ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager → Secret K8s natif | `MEILI_MASTER_KEY` générée automatiquement (l'identifiant administrateur de la recherche) |
| Entrée | Cloud Load Balancing (facultatif) | Service LoadBalancer par défaut ; Gateway externe + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Meilisearch persiste tout — index, documents,
  paramètres, tâches — dans le répertoire `/meili_data`. Il n'y a ni instance Cloud SQL
  ni Redis à exploiter.
- **La clé maître est obligatoire.** Meilisearch s'exécute en mode production
  (`MEILI_ENV = production`), qui refuse de démarrer sans une
  `MEILI_MASTER_KEY` d'au moins 16 octets. Le module génère une clé de 32 caractères, la stocke dans
  Secret Manager et l'injecte sous forme de **Secret Kubernetes natif** (`explicit_secret_values`).
- **PVC de StatefulSet recommandé.** Définissez `stateful_pvc_enabled = true` pour un
  PVC Persistent Disk (`stateful_pvc_size = "20Gi"` par défaut) — l'option de stockage à plus
  faible latence, adaptée à la production. Son chemin de montage par défaut est `/meilisearch/storage`,
  qui ne correspond **pas** au `MEILI_DB_PATH` fixe (`/meili_data`) — définissez
  `stateful_pvc_mount_path = "/meili_data"` explicitement afin que le PVC serve réellement de support
  au répertoire de données de Meilisearch. Sans PVC, le bucket de stockage est monté via
  GCS FUSE sur `/meili_data`. L'activation du PVC désactive le montage FUSE pour éviter un
  double montage.
- **LoadBalancer par défaut.** `service_type = "LoadBalancer"` expose l'API de recherche
  à l'extérieur. Définissez `service_type = "ClusterIP"` pour la garder à l'intérieur du cluster,
  ou utilisez la Gateway (`enable_custom_domain`, également activée par défaut) pour un
  domaine personnalisé avec un certificat géré.
- **Réplica unique.** `max_instance_count = 1`. Meilisearch est à écrivain unique ;
  plusieurs pods partageant un même PVC (RWO) ou bucket corrompent l'index. Mettez à l'échelle verticalement.
- **L'image est figée sur `v1.11`.** La valeur par défaut `application_version = "latest"` correspond
  au build `getmeili/meilisearch:v1.11` ; figez une version précise en production.
- **Santé sur `/health`.** Les sondes de démarrage et de vivacité ciblent toutes deux `/health`, qui
  renvoie `{"status":"available"}` une fois le moteur prêt.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Meilisearch {#a-gke-autopilot--the-meilisearch-workload}

Meilisearch s'exécute sous forme de StatefulSet (ou de Deployment) à réplica unique sur Autopilot,
qui facture le CPU et la mémoire réellement demandés par le pod. Comme Meilisearch est à
écrivain unique, la charge de travail est limitée à un seul réplica.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Meilisearch pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche le
  Service.
- **CLI :**
  ```bash
  kubectl get pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC capacity and binding
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Deployment ou StatefulSet).

### B. Stockage persistant — PVC ou Cloud Storage {#b-persistent-storage--pvc-or-cloud-storage}

Les données de Meilisearch résident dans `/meili_data` (`MEILI_DB_PATH`, fixe). Avec
`stateful_pvc_enabled = true`, il s'agit d'un PVC Persistent Disk (`standard-rwo` par
défaut) — mais uniquement si `stateful_pvc_mount_path` est défini à `/meili_data` ; sa
valeur par défaut (`/meilisearch/storage`) ne correspond pas, surchargez-la donc explicitement.
Sinon, il s'agit du bucket Cloud Storage `storage` monté via GCS FUSE, qui utilise
automatiquement `/meili_data`. Dans les deux cas, ce volume est la source de
vérité de tous les index et documents — il n'y a pas de base de données distincte.

- **Console :** Kubernetes Engine → Storage (PVC) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT"     # when GCS FUSE is used
  ```

Consultez [App_GKE](App_GKE.md) pour les PVC de StatefulSet, les options CMEK et les montages GCS FUSE.

### C. Secret Manager — la clé maître {#c-secret-manager--the-master-key}

Un unique secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `MEILI_MASTER_KEY`, l'identifiant administrateur de la recherche. Sur GKE, il est matérialisé
sous forme de **Secret Kubernetes natif** et injecté comme variable d'environnement. La
clé maître peut créer/supprimer des index et émettre des clés d'API à portée limitée ; traitez-la donc
comme un identifiant racine et délivrez des clés à portée limitée (`POST /keys`) aux applications.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"       # the synced native K8s Secret
  ```

L'ID du secret de la clé maître figure dans les [sorties](#5-outputs) (`meilisearch_api_key_secret_id`).
Consultez [App_GKE](App_GKE.md) pour le modèle d'injection des secrets et leur rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée sous forme de Service LoadBalancer, accessible depuis l'extérieur.
Définissez `service_type = "ClusterIP"` pour la limiter à l'intérieur du cluster. Un
domaine personnalisé avec un certificat géré par Google peut être activé via l'API Gateway
(`enable_custom_domain`, activé par défaut), et une IP statique est réservée par défaut
(`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get gateway,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails des adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE à Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles sur `/health`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Meilisearch {#3-meilisearch-application-behaviour}

- **Aucun job d'initialisation.** Meilisearch gère son propre stockage et ne nécessite aucun
  amorçage de base de données ; aucun job `db-init` ne s'exécute donc. La première requête qui crée un
  index initialise à la demande le répertoire `/meili_data`.
- **Le mode production exige la clé maître.** Avec `MEILI_ENV = production`,
  Meilisearch ne démarre pas tant que `MEILI_MASTER_KEY` ne fait pas au moins 16 octets.
  Le mode production désactive aussi le mini-tableau de bord web intégré — interagissez via
  l'API REST.
- **Tout passe par un appel d'API.** Depuis l'intérieur du cluster (ou via un port-forward),
  créez un index, ajoutez des documents et effectuez des recherches avec la clé maître comme jeton Bearer :
  ```bash
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 7700:7700 &
  KEY=$(gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT")

  # Add documents (creates the index on first write):
  curl -X POST "http://localhost:7700/indexes/movies/documents" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    --data '[{"id":1,"title":"Interstellar"},{"id":2,"title":"Inception"}]'

  # Search (note the deliberate typo — Meilisearch is typo-tolerant):
  curl "http://localhost:7700/indexes/movies/search" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    --data '{"q":"interstellr"}'
  ```
- **Clés d'API à portée limitée.** Ne livrez pas la clé maître aux navigateurs ni aux applications. Émettez des
  clés à portée limitée et à expiration avec `POST /keys` (en utilisant la clé maître), restreintes à des index
  et actions précis (par exemple recherche uniquement), et distribuez celles-ci.
- **Le chemin du PVC doit correspondre à `MEILI_DB_PATH`.** `stateful_pvc_mount_path` vaut par défaut
  `/meilisearch/storage`, qui ne correspond **pas** au `MEILI_DB_PATH` fixe
  (`/meili_data`). Définissez `stateful_pvc_mount_path = "/meili_data"` explicitement lorsque
  vous activez le PVC, sinon les écritures aboutissent sur un volume que Meilisearch ne lit jamais.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health`, qui renvoie
  `{"status":"available"}` lorsque le moteur est prêt :
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- \
    wget -qO- http://localhost:7700/health
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Meilisearch ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails disposant d'un accès au projet et recevant les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `meilisearch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Étiquette de l'image Meilisearch ; `latest` correspond au build figé `v1.11`. Figez une version en production. |
| `enable_api_key` | `true` | Génère la `MEILI_MASTER_KEY` dans Secret Manager et l'injecte sous forme de Secret K8s natif. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; Meilisearch conserve en mémoire les structures d'index actives — augmentez-la pour les index volumineux. |
| `min_instance_count` | `1` | GKE maintient au moins un réplica actif. |
| `max_instance_count` | `1` | **Laisser à 1.** Meilisearch est à écrivain unique ; plusieurs pods corrompent l'index. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |
| `enable_vertical_pod_autoscaling` | `false` | Active le VPA pour ajuster le CPU et la mémoire. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Meilisearch dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `MEILI_*` supplémentaires. Les valeurs principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster ; vide pour une découverte automatique. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Mode d'affinité de session. |
| `termination_grace_period_seconds` | `60` | Secondes entre SIGTERM et SIGKILL — permet à Meilisearch de vider les écritures en attente. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir `true` pour un PVC Persistent Disk (recommandé). Sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; ne peut pas être réduite après la création. |
| `stateful_pvc_mount_path` | `/meilisearch/storage` | Chemin de montage dans le conteneur. La valeur par défaut ne correspond **pas** au `MEILI_DB_PATH` fixe (`/meili_data`) — définissez-la explicitement à `/meili_data` lorsque vous utilisez le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (PD équilibré) ou `premium-rwo` (IOPS plus élevées). |
| `stateful_fs_group` | `3000` | GID fsGroup pour l'accès en écriture au PVC. |
| `stateful_headless_service` / `stateful_pod_management_policy` / `stateful_update_strategy` | `null` | Valeurs par défaut du socle pour les identités stables, les redémarrages ordonnés et les mises à jour progressives. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des suffixes binaires** (`4Gi`, `8192Mi`) ; des entiers nus sont des octets et bloquent la planification. |
| `quota_cpu_requests` / `quota_cpu_limits` / `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Plafonds de ressources de l'espace de noms. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 15s | Sonde de démarrage ; renvoie `{"status":"available"}` lorsque le moteur est prêt. |
| `liveness_probe` | HTTP `/health`, délai de 30s | Sonde de vivacité (même point de terminaison). |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage structurée au niveau d'App_GKE. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité structurée au niveau d'App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/health`. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Meilisearch ne nécessite aucun job d'initialisation par défaut ; ne fournissez des jobs que pour un chargement de données personnalisé. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, snapshots de dumps). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Meilisearch. |

### Groupe 12 — CI/CD et Binary Authorization {#group-12--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Meilisearch utilise GCS ou un PVC pour le stockage ; NFS est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `<prefix>-storage` est toujours créé (utilisé sur `/meili_data` en l'absence de PVC). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires (le bucket de stockage est ajouté automatiquement lorsque le PVC n'est pas utilisé). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restauration depuis une sauvegarde/un dump au déploiement (`backup_format` vaut `tar` par défaut). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la Gateway pour les noms d'hôte personnalisés + certificat géré. Ne prend effet que lorsque `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` / `static_ip_name` | `true` / `""` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** IAP exige une authentification par identité Google pour **toutes** les
> requêtes entrantes, y compris les appels d'applications interrogeant l'API de recherche. Activez-le pour
> un point de terminaison verrouillé destiné à des humains ; émettez des clés d'API à portée limitée pour l'accès programmatique.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Meilisearch (nécessite `enable_custom_domain`). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR disposant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
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
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL permettant d'accéder à l'API REST de Meilisearch. |
| `meilisearch_api_key_secret_id` | ID du secret Secret Manager de la clé maître. Vide lorsque `enable_api_key = false`. |
| `statefulset_name` | Nom du StatefulSet (lorsque le type de charge de travail est StatefulSet). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une charge de travail `Deployment` avec un PVC activé, IAP sans identités autorisées ni client OAuth, des quotas de mémoire sans suffixes binaires, un `backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_api_key` | `true` | Critique | Le désactiver supprime la clé maître ; en mode production, Meilisearch refuse de démarrer, et s'il s'exécutait, quiconque atteint le Service pourrait lire ou supprimer tous les index. |
| `max_instance_count` | `1` | Critique | Plus d'un pod partageant le PVC RWO ou le bucket GCS corrompt l'index. |
| `stateful_pvc_mount_path` | défini à `/meili_data` | Critique | Vaut par défaut `/meilisearch/storage`, qui ne correspond pas au `MEILI_DB_PATH` fixe ; laissé à sa valeur par défaut, le PVC ne reçoit jamais les données d'index, qui semblent vides. |
| `stateful_pvc_size` | dimensionné selon le jeu de données | Critique | Ne peut pas être réduit après la création ; trop petit, le PVC se remplit et bloque les écritures. |
| `workload_type` vs `stateful_pvc_enabled` | laisser `stateful_pvc_enabled` le déterminer | Critique | `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` est rejeté au moment du plan ; le PVC nécessite un StatefulSet. |
| `MEILI_MASTER_KEY` (générée automatiquement) | Rotation uniquement avec la mise à jour des clients | Élevé | Effectuer la rotation de la clé sans mettre à jour les clients casse tous les appels de recherche et d'administration authentifiés. |
| `stateful_pvc_enabled` | `true` en production | Élevé | GCS FUSE a une latence plus élevée qu'un PVC PD ; un index très sollicité est nettement plus performant sur un PVC. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `memory_limit` | `1Gi`+ | Élevé | Une mémoire insuffisante pour un index volumineux provoque des arrêts OOM sous charge de requêtes. |
| `enable_iap` | pour un point de terminaison privé destiné à des humains | Moyen | IAP exige une identité Google pour chaque requête ; il bloque aussi les appels non authentifiés d'applications ou de services — utilisez des clés d'API à portée limitée pour ceux-ci. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer l'unique pod pendant la maintenance, provoquant une interruption de la recherche. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour récupérer d'une suppression accidentelle d'index découverte tardivement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Meilisearch est décrite dans
**[Meilisearch_Common](Meilisearch_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Meilisearch sur GKE Autopilot](../labs/Meilisearch_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Meilisearch Common — Configuration applicative partagée](Meilisearch_Common.md) — la configuration applicative Meilisearch sur laquelle s'appuie ce module.
