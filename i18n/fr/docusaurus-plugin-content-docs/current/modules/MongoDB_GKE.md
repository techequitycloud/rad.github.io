---
title: "MongoDB sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de MongoDB sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/MongoDB_GKE.md @ 15fd4c7 sha256:1454d8c4c484 -->

# MongoDB sur GKE Autopilot {#mongodb-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MongoDB_GKE.png" alt="MongoDB sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

MongoDB est la base de données de documents NoSQL la plus populaire au monde,
utilisée par des organisations de toutes tailles pour la gestion de contenu, les
pipelines de données IoT, les backends mobiles et les magasins de fonctionnalités
AI/ML où les schémas relationnels sont trop rigides. Ce module déploie MongoDB
sur **GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que MongoDB utilise et sur la
manière de les explorer et de les exploiter à partir de la Google Cloud Console
et de la ligne de commande. Pour les mécanismes communs à chaque application GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

MongoDB s'exécute en tant que StatefulSet sur GKE Autopilot. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot (StatefulSet) | 1 vCPU / 2 GiB par défaut, mode nœud unique |
| Stockage persistant | Persistent Disk (SSD PVC) | `standard-rwo` StorageClass, 20 GiB par défaut, monté à `/data/db` |
| Secrets | Secret Manager | Mot de passe root MongoDB auto-généré |
| Images de conteneurs | Artifact Registry | Image officielle `mongo` mise en miroir dans le registre du projet |
| Réseau | VPC / GKE Service | `ClusterIP` par défaut pour l'accès interne au cluster ; passer à `LoadBalancer` uniquement si un accès externe au protocole filaire brut est requis |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** MongoDB est son propre moteur de base de données ; Cloud
  SQL n'est pas provisionné et `enable_cloudsql_volume` est codé en dur à `false`.
- **Le PVC SSD est essentiel.** Sans PVC StatefulSet, toutes les données sont
  perdues à chaque redémarrage du pod. `stateful_pvc_enabled = true` sélectionne
  automatiquement un StatefulSet.
- **Mode nœud unique uniquement.** `min_instance_count` et `max_instance_count` sont
  tous deux fixés à 1. Les réplicas sets MongoDB nécessitent une clé
  d'authentification supplémentaire et une configuration `rs.initiate()` qui
  dépassent le cadre de ce module.
- **Le mot de passe root est auto-généré.** `MONGO_INITDB_ROOT_PASSWORD` est généré
  et stocké dans Secret Manager lors du premier déploiement ; vous ne le
  définissez jamais en texte clair.
- **Sondes TCP sur le port 27017.** MongoDB utilise son propre protocole filaire
  binaire, pas HTTP — les sondes HTTP échouent toujours.
- **fsGroup 999 est codé en dur.** L'image officielle de MongoDB exécute `mongod`
  en tant que UID/GID 999 ; Kubernetes chown le montage du PVC à ce GID
  automatiquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet MongoDB {#a-gke-autopilot--the-mongodb-statefulset}

MongoDB s'exécute en tant que StatefulSet à pod unique sur Autopilot, qui
provisionne des nœuds à la demande et facture le CPU et la mémoire que le pod
demande réellement. Autopilot doit provisionner un nœud, attacher le PVC et
extraire l'image avant que `mongod` ne démarre — la sonde de démarrage
permet jusqu'à environ 8 minutes pour cela.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet
  MongoDB pour l'état du pod, les événements et l'utilisation des ressources.
  Kubernetes Engine → Services & Ingress affiche l'IP ClusterIP ou
  LoadBalancer externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<statefulset-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>   # events and probe status
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail StatefulSet sont gérés.

### B. Persistent Disk — PVC SSD {#b-persistent-disk--ssd-pvc}

Les données MongoDB résident sur un **Persistent Disk SSD PVC** (`standard-rwo`
StorageClass) monté à `/data/db` à l'intérieur du conteneur. Le PVC est
provisionné automatiquement par GKE lors de la création du StatefulSet et
persiste indépendamment des redémarrages de pod, des mises à jour continues et
des évictions de nœuds.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims pour voir
  le PVC et son volume lié. Compute Engine → Disks pour voir le Persistent Disk
  sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>   # capacity, access mode, status
  # Check disk usage inside the running pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data/db
  ```

La taille du PVC est définie au moment du déploiement par `stateful_pvc_size` (par défaut
`20Gi`). **La taille du PVC ne peut pas être diminuée après la
création.** Provisionnez au moins 2 à 3 fois le volume de données initial
prévu pour éviter le crash `No space left on device`.

### C. Secret Manager — mot de passe root {#c-secret-manager--root-password}

Le mot de passe root MongoDB (`MONGO_INITDB_ROOT_PASSWORD`) est auto-généré lors du
premier déploiement et stocké en tant que secret Secret Manager. Il est injecté
dans le pod via le pilote CSI du Secret Store et n'apparaît jamais en texte
clair.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mongo-root-password"
  gcloud secrets versions access latest \
    --secret=<secret-name> --project "$PROJECT"
  ```

Pour récupérer le mot de passe root pour une connexion `mongosh` :
```bash
ROOT_PASS=$(gcloud secrets versions access latest \
  --secret=<resource-prefix>-mongo-root-password --project "$PROJECT")
kubectl exec -n "$NAMESPACE" <pod-name> -- \
  mongosh --username admin --password "$ROOT_PASS" --authenticationDatabase admin
```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### D. Artifact Registry — image de conteneur {#d-artifact-registry--container-image}

L'image officielle `mongo` est mise en miroir dans l'Artifact Registry du
projet avant le déploiement afin que les pods ne tirent jamais directement de
Docker Hub. L'URI de l'image mise en miroir est signalé dans la sortie `container_image`.

- **Console :** Artifact Registry → sélectionnez le dépôt.
- **CLI :**
  ```bash
  gcloud artifacts docker images list \
    <region>-docker.pkg.dev/$PROJECT/<registry-repo> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, le service Kubernetes MongoDB est **ClusterIP** — MongoDB est un
backend de base de données destiné à être consommé par d'autres charges de
travail au sein du cluster (par exemple RocketChat), et ClusterIP fournit déjà
un accès inter-espaces de noms au sein du cluster via DNS, donc aucun
LoadBalancer n'est nécessaire. Passez à `LoadBalancer` uniquement si un
accès externe au protocole filaire MongoDB brut (port 27017) est réellement
requis.

- **Console :** Kubernetes Engine → Services & Ingress ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Get the LoadBalancer external IP:
  kubectl get svc -n "$NAMESPACE" <service-name> \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```

La sortie `mongodb_endpoint` fournit l'URI de connexion prête à l'emploi
(`mongodb://<ip>:27017` pour LoadBalancer ou l'URI DNS intra-cluster pour ClusterIP).

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, les IP statiques et
les détails de Cloud CDN.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr du pod (y compris les journaux de démarrage et de
requête `mongod`) sont envoyées à Cloud Logging. Les métriques GKE et
Persistent Disk sont envoyées à Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application MongoDB {#3-mongodb-application-behaviour}

- **Mode autonome uniquement.** Ce module déploie une seule instance `mongod`.
  Les réplicas sets MongoDB (flux de changements, transactions, réplication
  oplog) nécessitent des fichiers de clé d'authentification et une
  configuration `rs.initiate()` qui dépassent le cadre de ce module. `max_instance_count`
  est forcé à 1.
- **Initialisation au premier démarrage.** Lors du tout premier démarrage avec
  un PVC neuf, MongoDB crée l'utilisateur root (`MONGO_INITDB_ROOT_USERNAME`, par défaut
  `admin`) et la base de données initiale (`MONGO_INITDB_DATABASE`, par défaut
  `admin`). Ces valeurs sont **immuables après l'écriture du PVC**
  — les modifier après le premier déploiement n'a aucun effet (le script
  d'initialisation ne s'exécute qu'une seule fois par répertoire de données).
- **Dimensionnement du cache WiredTiger.** Le moteur de stockage WiredTiger de
  MongoDB définit par défaut son cache à environ `(memory_limit − 1 GiB) × 0.5`. Avec la
  limite par défaut `2Gi`, le cache est d'environ 500 Mo, ce qui est
  suffisant pour le développement. Mettez à l'échelle le `memory_limit` à
  `4Gi`–`8Gi` pour les charges de travail de documents en production.
- **Tolérance de la sonde de démarrage.** GKE Autopilot doit provisionner un
  nœud, attacher le PVC et extraire l'image avant que `mongod` ne démarre.
  La sonde de démarrage permet jusqu'à environ 8 minutes (`failure_threshold = 45`,
  vérification toutes les 10 secondes). Lors des redémarrages de pod
  ultérieurs sur un nœud chaud, le démarrage est beaucoup plus rapide.
- **Vidage du journal à l'arrêt.** `termination_grace_period_seconds` est défini à 60 secondes
  (par défaut) afin que Kubernetes attende que `mongod` vide le journal
  d'écriture anticipée avant de tuer de force le processus — évitant ainsi la
  corruption du journal.
- **Chaîne de connexion.** Le format correct pour se connecter avec les
  informations d'identification root est :
  ```
  mongodb://<username>:<password>@<host>:<port>/<db>?authSource=admin
  ```
  Le paramètre `authSource=admin` est requis lors de la connexion à des bases de
  données non-administratives avec le compte root.
- **Sondes de santé.** Les sondes de démarrage et de vivacité utilisent toutes
  deux `type = "TCP"` sur le port 27017. MongoDB utilise son propre protocole
  filaire binaire — les sondes HTTP échouent toujours avec une erreur de
  protocole.
- **Pas de tâches planifiées.** MongoDB ne nécessite pas de tâches cron côté
  plateforme. Les tâches au niveau de l'application (création d'index, index
  TTL) sont gérées depuis l'application ou via `mongosh`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
MongoDB sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
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
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mongodb` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `MongoDB` | Nom convivial affiché dans la Console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `7.0` | Tag de version de l'image MongoDB ; incrémenter pour déployer une nouvelle version. Les mises à niveau majeures modifient le format sur disque — tester sur un réplica avant de mettre à niveau la production. |
| `mongo_root_username` | `admin` | Nom d'utilisateur root (`MONGO_INITDB_ROOT_USERNAME`). **Immuable après la première écriture du PVC.** |
| `mongo_initdb_database` | `admin` | Base de données initiale créée au premier démarrage. **Immuable après la première écriture du PVC.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. Mettre à l'échelle à `2000m` pour les charges de travail intensives en agrégation. |
| `memory_limit` | `2Gi` | Mémoire par pod. Cache WiredTiger ≈ `(limit − 1 GiB) × 0.5` ; mettre à l'échelle à `4Gi`–`8Gi` pour la production. |
| `min_instance_count` | `1` | Réplicas minimum. Doit être 1 pour le mode nœud unique. |
| `max_instance_count` | `1` | Réplicas maximum. **Forcé à 1** — les réplicas sets ne sont pas pris en charge par ce module. |
| `container_port` | `27017` | Port du protocole filaire MongoDB. Définit à la fois le port du Service et le port d'écoute de `mongod`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image `mongo` dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MONGO_INITDB_ROOT_USERNAME` et `MONGO_INITDB_DATABASE` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées en tant que variables d'environnement. Fournir `MONGO_INITDB_ROOT_PASSWORD` ici pour utiliser un mot de passe personnalisé au lieu de celui auto-généré. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret du mot de passe root avant le démarrage du pod. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | `ClusterIP` restreint l'accès à l'intérieur du cluster (suffisant pour les consommateurs intra-cluster via DNS) ; `LoadBalancer` expose le port 27017 avec une IP externe. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucune persistance de session requise pour les connexions du protocole filaire MongoDB. |
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laisser vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour la génération automatique. |
| `termination_grace_period_seconds` | `60` | Période de grâce pour `mongod` pour vider le journal avant SIGKILL. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement du StatefulSet (couvre le provisionnement du nœud + l'attachement du PVC). |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy pour restreindre l'entrée/sortie. |

### Groupe 7 — StatefulSet et PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définir `true` pour activer le StatefulSet basé sur PVC. **Requis pour la durabilité des données.** |
| `stateful_pvc_size` | `20Gi` | Taille de stockage. Ne peut pas être diminuée après la création ; provisionner 2 à 3 fois le volume de données prévu. |
| `stateful_pvc_mount_path` | `/data/db` | Doit correspondre à `--dbpath` de MongoDB. Ne pas modifier. |
| `stateful_pvc_storage_class` | `standard-rwo` | Valeur par défaut SSD de GKE Autopilot. Utiliser `premium-rwo` pour les charges de travail à haut débit. |
| `stateful_headless_service` | `null` | Créer un service sans tête pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup (note : `999` est **codé en dur** dans le module pour MongoDB — cette variable n'a aucun effet). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Limiter les comptes CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doit utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont lus comme des octets et bloquent la planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant une interruption (pour MongoDB à nœud unique, `1` est la seule valeur sensée). |
| `enable_topology_spread` | `false` | Répartir les pods sur les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, 20s de délai, failure_threshold 18 | Entrée de sonde TCP de niveau fondation sur le port 27017. La sonde de démarrage réelle du conteneur est codée en dur dans le module à `failure_threshold = 45` (~8 minutes) pour couvrir le provisionnement du nœud GKE Autopilot + l'attachement du PVC + le tirage d'image — voir [Section 3](#3-mongodb-application-behaviour). |
| `health_check_config` | TCP, 30s de délai, failure_threshold 3 | Sonde de vivacité TCP sur le port 27017. |
| `uptime_check_config` | désactivé | Test de disponibilité — désactivé par défaut car MongoDB est un service interne. |
| `alert_policies` | `[]` | Politiques d'alerte de métriques Cloud Monitoring facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs Kubernetes exécutés avant le démarrage du pod MongoDB. Non requis pour MongoDB — aucun job d'amorçage de base de données n'est nécessaire. |
| `cron_jobs` | `[]` | CronJobs planifiés. MongoDB n'a pas de tâches planifiées côté plateforme requises. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour MongoDB — utiliser le PVC StatefulSet à la place. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | MongoDB ne nécessite pas de bucket GCS. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK pour le stockage et le registre. |
| `max_images_to_retain` | `7` | Images récentes à conserver dans Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée `mongodump` (UTC). **Vérifier que le job de sauvegarde est actif** — une sauvegarde manquée combinée à la suppression du PVC entraîne une perte de données permanente. |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'ingress HTTPS de la passerelle (nom d'hôte `<ip>.nip.io` sans configuration lorsque `application_domains` est vide) — inhabituel pour un service de base de données non-HTTP ; le trafic `mongodb://` réel est servi par le service LoadBalancer L4, pas par cet ingress HTTP(S). |
| `application_domains` | `[]` | Noms de domaine personnalisés. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

IAP n'est pas recommandé pour MongoDB (une base de données, pas une application
web). Restreindre l'accès à la place via `service_type = "ClusterIP"` ou Kubernetes NetworkPolicy.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Non recommandé pour MongoDB. Utiliser NetworkPolicy ou ClusterIP. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
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
| `service_external_ip` | IP LoadBalancer externe (lorsque le type de service est LoadBalancer). |
| `mongodb_endpoint` | URI de connexion MongoDB prêt à l'emploi (`mongodb://...`). Les déploiements ClusterIP renvoient l'URI DNS intra-cluster ; les déploiements LoadBalancer renvoient l'URI externe. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut pour MongoDB). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation exécutés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de l'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC, toutes les données MongoDB sont perdues à chaque redémarrage de pod, mise à jour continue ou éviction de nœud. |
| `stateful_pvc_mount_path` | `/data/db` (par défaut) | Critique | Doit correspondre à `--dbpath` de MongoDB. Monter ailleurs entraîne l'écriture de `mongod` dans la couche éphémère — toutes les données sont perdues au redémarrage. |
| `MONGO_INITDB_ROOT_PASSWORD` | auto-généré (par défaut) | Critique | MongoDB démarre sans authentification si la variable d'environnement est absente. Tout appelant à l'intérieur du cluster obtient un accès administrateur illimité. Ne jamais le supprimer ou l'effacer. |
| `mongo_root_username` / `mongo_initdb_database` | défini une fois | Critique | Intégré au répertoire de données lors de la première initialisation. Modifier après l'existence du PVC entraîne un échec de démarrage. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires (`4Gi`) | Critique | Les entiers bruts sont lus comme des octets par Kubernetes, bloquant toute planification de pod. |
| `stateful_pvc_size` | `20Gi` min, taille pour la charge de travail | Élevé | Un disque plein provoque le crash de `mongod` avec `No space left on device`. Provisionner 2 à 3 fois le volume de données prévu. La taille ne peut pas être diminuée après la création. |
| `memory_limit` | `4Gi` pour la production | Élevé | Le cache WiredTiger représente ~50 % de `(limit − 1 GiB)`. Un cache insuffisant entraîne une E/S disque excessive et une grave dégradation des requêtes. |
| `workload_type` | `null` (StatefulSet automatique avec PVC) | Élevé | Définir explicitement `Deployment` avec `stateful_pvc_enabled = true` échoue au moment de la planification. MongoDB autonome nécessite StatefulSet pour une liaison PVC stable. |
| `application_version` | tester d'abord les mises à niveau majeures | Élevé | Les mises à niveau de version majeure de MongoDB modifient le format de stockage sur disque. La rétrogradation n'est pas prise en charge. Toujours tester sur un réplica du PVC de production. |
| `backup_schedule` | actif et testé | Élevé | MongoDB n'a pas de sauvegarde automatique intégrée en dehors du job `mongodump` de ce module. Une sauvegarde manquée combinée à la suppression du volume persistant lors de la destruction entraîne une perte de données permanente. |
| `service_type` | `ClusterIP` pour les services de niveau DB (déjà la valeur par défaut) | Élevé | `LoadBalancer` expose le port 27017 avec une IP publique. Laisser la valeur par défaut `ClusterIP` en place sauf si un accès externe est explicitement requis, et utiliser des règles de pare-feu ou NetworkPolicy si vous le modifiez. |
| `termination_grace_period_seconds` | `60` (par défaut) | Élevé | Une période de grâce trop courte risque la corruption du journal à l'arrêt si les écritures en cours n'ont pas été vidées. |
| `cpu_limit` | `2000m` pour la production | Moyen | Les pipelines d'agrégation et les constructions d'index sont gourmands en CPU. En dessous de `500m`, les requêtes complexes se dégradent considérablement. |
| `replica set` | autonome uniquement | Élevé | Ce module est à nœud unique. Les flux de changements, les transactions et la réplication oplog nécessitent un réplica set — utiliser un déploiement basé sur Helm pour les topologies multi-nœuds. |
| `enable_iap` | `false` (par défaut) | Faible | IAP n'est pas applicable aux services de base de données. Utiliser NetworkPolicy ou ClusterIP pour le contrôle d'accès à la place. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. MongoDB_GKE n'a pas de module commun séparé ; toute
la configuration spécifique à MongoDB est autonome dans le module.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : MongoDB sur GKE Autopilot](../labs/MongoDB_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- Déployé aux côtés de [Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) dans la solution **Shared Data Services**.
