---
title: "Node-RED sur GKE Autopilot"
description: "Référence de configuration pour déployer Node-RED sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/NodeRED_GKE.md @ 3055034 sha256:7166ea4a9153 -->

# Node-RED sur GKE Autopilot {#node-red-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_GKE.png" alt="Node-RED sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED est un outil open source de programmation par flux qui permet de relier
des appareils IoT, des API et des services en ligne au moyen d'un éditeur visuel
dans le navigateur. Ce module déploie Node-RED sur **GKE Autopilot** en s'appuyant
sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Node-RED et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Node-RED s'exécute sous forme de conteneur Node.js qui écoute sur le port 1880. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 500m CPU / 512 MiB par défaut, mise à l'échelle automatique horizontale |
| Stockage persistant des flux | Filestore (NFS) | Flux, identifiants et nœuds installés dans `/data`, partagés entre tous les réplicas |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux données de l'application |
| Stockage du contexte | Redis (facultatif) | Désactivé par défaut ; permet de conserver le contexte entre les redémarrages et de le partager entre les instances |
| Secret des identifiants | Secret Manager | `NODE_RED_CREDENTIAL_SECRET`, généré automatiquement, chiffre les identifiants des flux |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Aucune base de données n'est requise.** Node-RED stocke tout son état dans son
  répertoire `/data` ; `database_type` vaut `"NONE"` par défaut.
- **NFS est activé par défaut.** Le répertoire `/data` est monté depuis un partage
  Filestore afin que les flux, les identifiants et les nœuds installés survivent aux
  redémarrages et aux replanifications des pods.
- **`max_instance_count = 1` par défaut.** Node-RED n'est pas conçu pour une mise à
  l'échelle horizontale active-active — chaque instance possède son propre contexte
  en mémoire. N'augmentez cette valeur qu'en cas de stockage de contexte externe
  adossé à Redis.
- **L'affinité de session vaut `ClientIP`.** L'interface de l'éditeur utilise des
  connexions WebSocket persistantes ; sans affinité, les sessions du navigateur se
  déconnectent à chaque requête acheminée vers un autre pod.
- **`NODE_RED_CREDENTIAL_SECRET` est généré automatiquement.** Il chiffre tous les
  identifiants de flux stockés et est conservé dans Secret Manager. Sa rotation rend
  les identifiants existants illisibles — manipulez-le avec précaution.
- **Les sondes de santé utilisent HTTP GET `/`**, qui renvoie l'interface de
  l'éditeur une fois Node-RED entièrement démarré (un délai initial de 30 secondes
  suffit).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Node-RED {#a-gke-autopilot--the-node-red-workload}

Les pods Node-RED sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Node-RED pour consulter les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Filestore (NFS) — stockage persistant des flux {#b-filestore-nfs--persistent-flow-storage}

Node-RED stocke toutes ses données persistantes — flux (`flows.json`),
identifiants chiffrés (`flows_cred.json`), nœuds de palette installés et fichier de
paramètres — dans son répertoire `/data`. Un partage NFS de Cloud Filestore est
monté sur `/data` afin que les données survivent aux redémarrages des pods, aux
replanifications et aux redéploiements. Tous les réplicas partagent les mêmes
données.

- **Console :** Filestore → Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /data
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, la sauvegarde et les
options CMEK.

### C. Cloud Storage {#c-cloud-storage}

Un bucket GCS dédié est provisionné pour les données applicatives de Node-RED
(exports de flux, archives de sauvegarde). L'accès est accordé automatiquement au
compte de service de la charge de travail.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK.

### D. Secret Manager — chiffrement des identifiants des flux {#d-secret-manager--flow-credential-encryption}

`NODE_RED_CREDENTIAL_SECRET` est généré automatiquement lors du déploiement et
stocké sous forme de secret Secret Manager. Node-RED utilise cette clé pour
chiffrer tous les identifiants stockés dans les flux. Ce module ne génère aucun
autre secret propre à l'application.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI et la
rotation.

### E. Redis (stockage facultatif du contexte) {#e-redis-optional-context-storage}

Lorsque `enable_redis = true`, Node-RED est configuré pour stocker le contexte des
flux à l'extérieur, dans Redis, ce qui permet aux données de contexte de persister
entre les redémarrages des pods et d'être partagées entre plusieurs instances.
Redis est désactivé par défaut.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

Lorsque `enable_redis = true` et que `redis_host` est vide, l'IP du serveur NFS est
utilisée comme hôte Redis. Si NFS est également désactivé, `redis_host` doit être
défini explicitement.

### F. Réseau et entrée {#f-networking--ingress}

La charge de travail est exposée via une IP Cloud Load Balancing externe.
`enable_custom_domain` vaut `true` par défaut, ce qui provisionne un Ingress
Kubernetes avec un certificat géré par Google pour les noms d'hôte de
`application_domains` ; une IP statique est réservée par défaut afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Node-RED {#3-node-red-application-behaviour}

- **Ni base de données, ni tâche d'initialisation.** Node-RED stocke tout son état
  dans son répertoire `/data`. Aucune instance Cloud SQL n'est provisionnée et
  aucune tâche d'initialisation de schéma n'est requise. Le premier démarrage crée
  automatiquement les fichiers de flux par défaut si `/data` est vide.
- **Chiffrement des identifiants des flux.** `NODE_RED_CREDENTIAL_SECRET` est
  injecté à l'exécution depuis Secret Manager. Cette clé chiffre le fichier
  `flows_cred.json` sur le partage NFS. Modifier la clé ou effectuer sa rotation
  après le déploiement des flux rend illisibles tous les identifiants stockés (clés
  d'API, mots de passe, jetons).
- **Mode sans échec.** `NODE_RED_ENABLE_SAFE_MODE` est toujours défini sur
  `"false"`, ce qui garantit que les flux s'exécutent au démarrage. Surchargez-le
  avec `"true"` via `environment_variables` pour démarrer Node-RED avec les flux
  désactivés à des fins de débogage.
- **Sessions WebSocket de l'éditeur.** L'éditeur Node-RED communique via des
  connexions WebSocket persistantes. L'affinité de session (`ClientIP`) est requise
  pour que les sessions de l'éditeur restent acheminées vers le même pod ; sans
  elle, les opérations de déploiement échouent en raison de déconnexions WebSocket.
- **Sonde de santé.** Les sondes de démarrage et d'activité envoient toutes deux un
  HTTP GET à `/`, qui renvoie l'interface de l'éditeur une fois Node-RED prêt. Un
  délai initial de 30 secondes suffit pour un démarrage standard.
- **Tâches planifiées et CronJobs.** Node-RED ne dispose d'aucune commande
  planifiée intégrée. Utilisez `cron_jobs` pour provisionner des CronJobs
  Kubernetes pour les opérations de maintenance périodiques, comme les exports de
  flux ou les vidages de cache :
  ```bash
  kubectl get cronjobs -n "$NAMESPACE"
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  ```
- **Accès à l'éditeur.** Rendez-vous à l'URL indiquée par la sortie `service_url`
  et connectez-vous. Pour les déploiements de production, activez IAP
  (`enable_iap = true`) pour contrôler l'accès par une authentification d'identité
  Google.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Node-RED ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nodered` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Node-RED` | Nom convivial affiché dans la console et les tableaux de bord. |
| `application_description` | `Node-RED - Flow-based programming for IoT and event automation` | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag d'image pour `nodered/node-red`. Épinglez une version précise (par ex. `4.0.9`) pour des déploiements reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Utilisez `"prebuilt"` pour l'image officielle Docker Hub ; `"custom"` pour construire l'image via Cloud Build. |
| `container_image` | `nodered/node-red:latest` | URI complet de l'image lorsque `container_image_source = "prebuilt"`. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire. Node-RED est léger ; accepte aussi, en option, `cpu_request`, `mem_request`, `ephemeral_storage_limit`, `ephemeral_storage_request`. |
| `container_port` | `1880` | Port HTTP natif de Node-RED. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (doit être ≥ 1 pour GKE). |
| `max_instance_count` | `1` | Nombre maximal de réplicas. Conservez `1`, sauf en cas de stockage de contexte externe adossé à Redis. |
| `enable_image_mirroring` | `true` | Copier l'image depuis Docker Hub vers Artifact Registry pour éviter les limites de débit. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `timeout_seconds` | `300` | Temps d'attente maximal du backend de l'équilibreur de charge (secondes). |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NODE_RED_CREDENTIAL_SECRET` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les connexions WebSocket de l'éditeur Node-RED. |
| `namespace_name` | `""` | Généré automatiquement à partir de `application_name` et `tenant_id` s'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` ; sinon en `Deployment`. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité du pare-feu NFS — ne pas supprimer lorsque `enable_nfs = true`. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles de PVC par pod. La valeur `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage — définissez `/data` pour adosser le répertoire de données de Node-RED à un PVC dédié. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Utilisez obligatoirement des unités binaires (`4Gi`, `8192Mi`)** — les entiers sans unité sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/`, délai de 30s | Sonde HTTP sur le chemin de l'éditeur Node-RED. |
| `health_check_config` | HTTP `/`, délai de 30s | Sonde d'activité — redémarre le conteneur si l'éditeur ne répond pas. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. Désactivé par défaut ; activez-le pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED ne nécessite aucune tâche d'initialisation. Fournissez des tâches personnalisées pour les imports de flux ou les installations de palette. |
| `cron_jobs` | `[]` | CronJobs Kubernetes pour les opérations de maintenance périodiques. |
| `additional_services` | `[]` | Deployments Kubernetes complémentaires déployés aux côtés de Node-RED. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le répertoire `/data` de Node-RED. Fortement recommandé. |
| `nfs_mount_path` | `/data` | Doit correspondre au répertoire de données de Node-RED. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Nom d'une VM NFS existante ou nom de base d'une VM créée à la volée. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS de `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. `NodeRED_Common` ajoute automatiquement un bucket `nodered-storage`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Stockage du contexte dans Redis {#group-15--redis-context-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage du contexte de Node-RED. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` (sauf si `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Secret des identifiants et base de données {#group-16--credential-secret--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du `NODE_RED_CREDENTIAL_SECRET` généré automatiquement (16–64). |
| `database_type` | `NONE` | Node-RED ne nécessite aucune base de données. Ne pas modifier. |
| `enable_auto_password_rotation` | `false` | Rotation automatique du secret des identifiants. La rotation de la clé rend illisibles les identifiants de flux existants. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes NFS automatiques (UTC). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Rétention ; augmentez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité du pare-feu NFS. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant Node-RED. Fortement recommandé en production — l'éditeur donne accès à l'édition complète des flux. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'Ingress. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

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
| `service_url` | URL permettant d'accéder à Node-RED. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors du premier apply d'un nouveau cluster créé à la volée — un second apply est nécessaire. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Sans NFS, tous les flux, identifiants et nœuds installés sont perdus à chaque redémarrage ou replanification de pod. |
| `NODE_RED_CREDENTIAL_SECRET` (issu de `database_password_length`) | généré automatiquement | Critical | Chiffre tous les identifiants des flux. Effectuer la rotation de la clé ou la modifier après le déploiement des flux rend les identifiants existants définitivement illisibles. |
| `enable_auto_password_rotation` | `false` | Critical | La rotation automatique modifie la clé de chiffrement ; tous les identifiants de flux stockés deviennent inaccessibles. Ne l'activez qu'avec une procédure de rechiffrement en place. |
| `application_name` | défini une seule fois | Critical | Immuable après le premier déploiement ; le renommer recrée toutes les ressources GCP et Kubernetes et déconnecte le partage NFS. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer la tâche de restauration. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers sans unité sont des octets et bloquent toute planification des pods. |
| `max_instance_count` | `1` | High | Node-RED n'est pas conçu pour une mise à l'échelle active-active. Plusieurs instances sans contexte partagé produisent des états contradictoires. |
| `session_affinity` | `ClientIP` | High | Sans affinité, la connexion WebSocket de l'éditeur est coupée et les opérations de déploiement échouent. |
| `nfs_mount_path` | `/data` | High | Doit correspondre au répertoire de données natif de Node-RED. Le modifier sans mettre à jour le fichier de paramètres redirige les écritures vers un stockage éphémère. |
| `execution_environment` (Cloud Run uniquement) | `gen2` | High | Les montages NFS nécessitent gen2. |
| `database_type` | `NONE` | High | La définir sur `MYSQL` ou `POSTGRES` provisionne une instance Cloud SQL et un sidecar proxy que Node-RED n'utilise pas. |
| `enable_redis` sans `redis_host` | définir `redis_host` explicitement | High | Avec NFS désactivé et sans hôte Redis, la chaîne de connexion Redis est vide et le stockage du contexte échoue. |
| `enable_iap` | `true` en production | High | L'éditeur Node-RED donne accès à l'édition complète des flux et à la gestion des identifiants ; il ne doit pas rester accessible publiquement. |
| `min_instance_count` | `1` | Medium | GKE ne prend pas en charge une véritable mise à l'échelle à zéro sans KEDA. Le HPA rejette `min > max`. |
| `enable_pod_disruption_budget` | `true` | Medium | Désactiver le PDB permet à GKE d'évincer le pod pendant la maintenance des nœuds, ce qui provoque une panne complète et une perte de données potentielle si une écriture NFS était en cours. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Node-RED, partagée avec la variante Cloud Run, est décrite dans
**[NodeRED_Common](NodeRED_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NodeRED sur GKE Autopilot](../labs/NodeRED_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Node-RED sur Google Cloud Run](NodeRED_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [NodeRED Common — Configuration applicative partagée](NodeRED_Common.md) — la configuration partagée par les deux cibles de déploiement.
