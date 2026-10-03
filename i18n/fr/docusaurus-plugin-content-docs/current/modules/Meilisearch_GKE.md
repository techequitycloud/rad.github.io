---
title: "Meilisearch sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Meilisearch sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Meilisearch_GKE.md @ 15fd4c7 sha256:0681b37dc01a -->

# Meilisearch sur GKE Autopilot {#meilisearch-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Meilisearch_GKE.png" alt="Meilisearch sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Meilisearch est un moteur de recherche rapide et open source — un binaire Rust
unique qui offre une recherche instantanée, tolérante aux fautes de frappe et
à facettes derrière une API REST simple. Il est largement utilisé comme
alternative auto-hébergeable à Algolia. Ce module déploie Meilisearch sur **GKE
Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Meilisearch et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Meilisearch s'exécute comme une charge de travail Rust à binaire unique,
idéalement en tant que StatefulSet avec un PVC Persistent Disk. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Rust, 1 vCPU / 1 Gio par défaut, réplica unique (écriture unique) |
| Stockage persistant | PVC Persistent Disk ou Cloud Storage (GCS FUSE) | `MEILI_DB_PATH` est fixé à `/meili_data` ; le PVC StatefulSet (activé par défaut) s'y monte (`stateful_pvc_mount_path` par défaut), et GCS FUSE est utilisé uniquement lorsque le PVC est désactivé |
| Base de données | Aucune | Meilisearch est autonome — pas de Cloud SQL, pas de base de données externe |
| Cache et file d'attente | Aucun | Meilisearch n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager → Secret K8s natif | `MEILI_MASTER_KEY` généré automatiquement (le credential d'administration de recherche) |
| Ingress | Cloud Load Balancing (facultatif) | Service LoadBalancer par défaut ; Gateway externe facultative + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Meilisearch persiste tout — index,
  documents, paramètres, tâches — dans le répertoire `/meili_data`. Il n'y a pas
  d'instance Cloud SQL ni de Redis à opérer.
- **La clé principale est obligatoire.** Meilisearch s'exécute en mode
  production (`MEILI_ENV = production`), qui refuse de démarrer sans une
  `MEILI_MASTER_KEY` d'au moins 16 octets. Le module génère une clé de 32
  caractères, la stocke dans Secret Manager et l'injecte en tant que **Secret
  Kubernetes natif** (`explicit_secret_values`).
- **PVC StatefulSet par défaut.** `stateful_pvc_enabled = true` fournit un PVC
  Persistent Disk (`stateful_pvc_size = "20Gi"` par défaut) — requis en pratique,
  car le magasin LMDB de Meilisearch écrit à des offsets arbitraires que GCS
  FUSE ne prend pas en charge. Son chemin de montage est par défaut
  `/meili_data`, le `MEILI_DB_PATH` fixe — conservez
  `stateful_pvc_mount_path = "/meili_data"` explicitement pour que le PVC sauvegarde
  effectivement le répertoire de données de Meilisearch. Sans le PVC, le bucket
  de stockage est monté via GCS FUSE à `/meili_data`. La
  configuration du PVC ignore le montage FUSE pour éviter un double montage.
- **LoadBalancer par défaut.** `service_type = "LoadBalancer"` expose l'API de
  recherche en externe. Définissez `service_type = "ClusterIP"` pour la maintenir à
  l'intérieur du cluster, ou utilisez la Gateway (`enable_custom_domain`,
  également activée par défaut) pour un domaine personnalisé avec un certificat
  géré.
- **Réplica unique.** `max_instance_count = 1`. Meilisearch est à écriture
  unique ; plusieurs pods partageant un PVC (RWO) ou un bucket corrompent
  l'index. Mettez à l'échelle verticalement.
- **L'image est épinglée à `v1.11`.** La valeur par défaut
  `application_version = "latest"` correspond à la build `getmeili/meilisearch:v1.11` ;
  épinglez une version spécifique en production.
- **Santé à `/health`.** Les sondes de démarrage et de vivacité
  ciblent toutes deux `/health`, qui renvoie
  `{"status":"available"}` une fois le moteur prêt.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Meilisearch {#a-gke-autopilot--the-meilisearch-workload}

Meilisearch s'exécute en tant que StatefulSet (ou Deployment) à réplica unique
sur Autopilot, qui facture le CPU/la mémoire réellement demandés par le pod.
Comme Meilisearch est à écriture unique, la charge de travail est épinglée à un
seul réplica.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Meilisearch pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche le Service.
- **CLI :**
  ```bash
  kubectl get pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC capacity and binding
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Stockage persistant — PVC ou Cloud Storage {#b-persistent-storage--pvc-or-cloud-storage}

Les données Meilisearch se trouvent à `/meili_data` (`MEILI_DB_PATH`, fixe). Avec
`stateful_pvc_enabled = true` (la valeur par défaut), il s'agit d'un PVC Persistent Disk
(`standard-rwo` par défaut) monté à `stateful_pvc_mount_path`, qui est par défaut
`/meili_data` — ne le modifiez pas. Avec le PVC désactivé, il s'agit du bucket
Cloud Storage `storage` monté via GCS FUSE, qui utilise
automatiquement `/meili_data`. Dans tous les cas, ce volume est la source de
vérité pour tous les index et documents — il n'y a pas de base de données
séparée.

- **Console :** Kubernetes Engine → Storage (PVCs) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT"     # when GCS FUSE is used
  ```

Voir [App_GKE](App_GKE.md) pour les PVC StatefulSet, les options CMEK et les
montages GCS FUSE.

### C. Secret Manager — la clé principale {#c-secret-manager--the-master-key}

Un seul secret cryptographique est généré automatiquement et stocké dans
Secret Manager : `MEILI_MASTER_KEY`, le credential d'administration de recherche.
Sur GKE, il est matérialisé en tant que **Secret Kubernetes natif** et injecté
comme variable d'environnement. La clé principale peut créer/supprimer des
index et émettre des clés API à portée limitée, il faut donc la traiter comme
un credential racine et émettre des clés à portée limitée (`POST /keys`)
aux applications.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secret -n "$NAMESPACE"       # the synced native K8s Secret
  ```

L'ID du secret de la clé principale se trouve dans les [Sorties](#5-outputs)
(`meilisearch_api_key_secret_id`). Voir [App_GKE](App_GKE.md) pour le modèle
d'injection et de rotation des secrets.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée en tant que service LoadBalancer,
accessible en externe. Définissez `service_type = "ClusterIP"` pour la restreindre à
l'intérieur du cluster. Un domaine personnalisé avec un certificat géré par
Google peut être activé via l'API Gateway (`enable_custom_domain`, activée par
défaut), et une IP statique est réservée par défaut (`reserve_static_ip = true`)
afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get gateway,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers
Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte
facultatifs sont disponibles pour `/health`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Meilisearch {#3-meilisearch-application-behaviour}

- **Pas de job d'initialisation.** Meilisearch gère son propre stockage et n'a
  pas besoin de bootstrap de base de données, donc aucun job
  `db-init` ne s'exécute. La première requête qui crée un index
  initialise paresseusement le répertoire `/meili_data`.
- **Le mode production nécessite la clé principale.** Avec
  `MEILI_ENV = production`, Meilisearch ne démarrera pas à moins que
  `MEILI_MASTER_KEY` ne fasse au moins 16 octets. Le mode production
  désactive également le mini-tableau de bord web intégré — interagissez via
  l'API REST.
- **Tout est un appel API.** Depuis l'intérieur du cluster (ou via un
  port-forward), créez un index, ajoutez des documents et recherchez avec la
  clé principale comme jeton Bearer :
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
- **Clés API à portée limitée.** Ne transmettez pas la clé principale aux
  navigateurs ou aux applications. Émettez des clés à portée limitée et
  expirables avec `POST /keys` (en utilisant la clé principale) limitées
  à des index et des actions spécifiques (par exemple, recherche uniquement), et
  distribuez-les.
- **Le chemin du PVC doit correspondre à `MEILI_DB_PATH`.**
  `stateful_pvc_mount_path` est par défaut `/meili_data`, le
  `MEILI_DB_PATH` fixe. Ne le modifiez pas, sinon les écritures
  atterrissent sur un volume que Meilisearch ne lit jamais.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health`, qui renvoie `{"status":"available"}` lorsque le
  moteur est prêt :
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- \
    wget -qO- http://localhost:7700/health
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Meilisearch sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `meilisearch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Meilisearch ; `latest` correspond à la build `v1.11` épinglée. Épinglez une version en production. |
| `enable_api_key` | `true` | Génère le `MEILI_MASTER_KEY` dans Secret Manager et l'injecte en tant que Secret K8s natif. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; Meilisearch conserve les structures d'index chaudes en mémoire — augmentez pour les grands index. |
| `min_instance_count` | `1` | GKE maintient au moins un réplica chaud. |
| `max_instance_count` | `1` | **Maintenez à 1.** Meilisearch est à écriture unique ; plusieurs pods corrompent l'index. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_vertical_pod_autoscaling` | `false` | Activez VPA pour dimensionner correctement le CPU/la mémoire. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Meilisearch dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `MEILI_*` supplémentaires. Les valeurs de base sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Carte des variables d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster ; vide auto-découvre. |
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Mode d'affinité de session. |
| `termination_grace_period_seconds` | `60` | Secondes après SIGTERM avant SIGKILL — permet à Meilisearch de vider les écritures en attente. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Définissez `true` pour un PVC Persistent Disk (recommandé). Sélectionne automatiquement StatefulSet. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; ne peut pas être diminuée après la création. |
| `stateful_pvc_mount_path` | `/meili_data` | Chemin du système de fichiers à l'intérieur du conteneur Meilisearch où le PVC par pod est monté. Doit correspondre à MEILI_DB_PATH (/meili_data) ; Meilisearch y stocke son index entier et le monter ailleurs laisse l'index sur un stockage éphémère. |
| `stateful_pvc_storage_class` | `standard-rwo` | `standard-rwo` (PD équilibré) ou `premium-rwo` (IOPS plus élevés). |
| `stateful_fs_group` | `3000` | GID fsGroup pour l'accès en écriture au PVC. |
| `stateful_headless_service` / `stateful_pod_management_policy` / `stateful_update_strategy` | `null` | Valeurs par défaut de la fondation pour les identités stables, les redémarrages ordonnés, les mises à jour progressives. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des suffixes binaires** (`4Gi`, `8192Mi`) ; les entiers nus sont des octets et bloquent la planification. |
| `quota_cpu_requests` / `quota_cpu_limits` / `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Limites de ressources de l'espace de noms. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s de délai | Sonde de démarrage ; renvoie `{"status":"available"}` lorsqu'elle est prête. |
| `liveness_probe` | HTTP `/health` 30s de délai | Sonde de vivacité (même endpoint). |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage structurée au niveau App_GKE. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité structurée au niveau App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif contre `/health`. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Meilisearch ne nécessite pas de job d'initialisation par défaut ; fournissez des jobs uniquement pour le chargement de données personnalisées. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, des instantanés de dump). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec Meilisearch. |

### Groupe 12 — CI/CD et Binary Authorization {#group-12--cicd--binary-authorization}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Meilisearch utilise GCS ou un PVC pour le stockage ; NFS est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `<prefix>-storage` est toujours créé (utilisé à `/meili_data` lorsqu'il n'y a pas de PVC). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires (le bucket de stockage est ajouté automatiquement lorsque le PVC n'est pas utilisé). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde/dump lors du déploiement (`backup_format` par défaut à `tar`). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la Gateway pour les noms d'hôtes personnalisés + certificat géré. Ne prend effet que lorsque `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` / `static_ip_name` | `true` / `""` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** IAP exige une authentification d'identité Google pour
> **toutes** les requêtes entrantes, y compris les appels des applications
> interrogeant l'API de recherche. Activez-le pour un endpoint sécurisé et
> destiné aux humains ; émettez des clés API à portée limitée pour l'accès
> programmatique.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Meilisearch (nécessite `enable_custom_domain`). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL pour atteindre l'API REST Meilisearch. |
| `meilisearch_api_key_secret_id` | ID du secret Secret Manager pour la clé principale. Vide lorsque `enable_api_key = false`. |
| `statefulset_name` | Nom du StatefulSet (lorsque le type de charge de travail est StatefulSet). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de l'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — une charge
> de travail `Deployment` avec un PVC activé, IAP sans identités
> autorisées ou client OAuth, des quotas de mémoire sans suffixes binaires, un
> `backup_retention_days` hors de portée. Une configuration invalide fait
> échouer la **planification** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'application ou de
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_api_key` | `true` | Critique | Le désactiver supprime la clé principale ; en mode production, Meilisearch refuse de démarrer, et s'il s'exécutait, toute personne atteignant le Service pourrait lire ou supprimer chaque index. |
| `max_instance_count` | `1` | Critique | Plus d'un pod partageant le PVC RWO ou le bucket GCS corrompt l'index. |
| `stateful_pvc_mount_path` | laisser à `/meili_data` | Critique | Doit correspondre au `MEILI_DB_PATH` fixe ; monté ailleurs, le PVC ne reçoit jamais les données de l'index et apparaît vide. |
| `stateful_pvc_size` | taille du jeu de données | Critique | Ne peut pas être diminué après la création ; trop petit, le PVC se remplit, arrêtant les écritures. |
| `workload_type` vs `stateful_pvc_enabled` | laisser `stateful_pvc_enabled` le gérer | Critique | `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` est rejeté au moment de la planification ; le PVC a besoin d'un StatefulSet. |
| `MEILI_MASTER_KEY` (auto-généré) | Rotation uniquement avec les mises à jour client | Élevé | La rotation de la clé sans mise à jour des clients interrompt toutes les recherches authentifiées et les appels d'administration. |
| `stateful_pvc_enabled` | `true` pour la production | Élevé | GCS FUSE a une latence plus élevée qu'un PVC PD ; un index occupé fonctionne nettement mieux sur un PVC. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `memory_limit` | `1Gi`+ | Élevé | Trop peu de mémoire pour un grand index provoque des OOM kills sous charge de requête. |
| `enable_iap` | pour un endpoint privé, destiné aux humains | Moyen | IAP exige une identité Google pour chaque requête ; il bloque également les appels d'applications/services non authentifiés — utilisez des clés API à portée limitée pour ceux-ci. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'expulser le pod unique pendant la maintenance, provoquant une panne de recherche. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer d'une suppression accidentelle d'index découverte tardivement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Meilisearch est décrite dans **[Meilisearch_Common](Meilisearch_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Meilisearch sur GKE Autopilot](../labs/Meilisearch_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Meilisearch Common — Configuration d'application partagée](Meilisearch_Common.md) — la configuration d'application Meilisearch sur laquelle ce module s'appuie.
