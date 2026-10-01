---
title: "MongoDB sur GKE Autopilot"
description: "Référence de configuration pour déployer MongoDB sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/MongoDB_GKE.md @ 3055034 sha256:88bdfc8b6bf9 -->

# MongoDB sur GKE Autopilot {#mongodb-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MongoDB_GKE.png" alt="MongoDB sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

MongoDB est la base de données documentaire NoSQL la plus populaire au monde, utilisée par des organisations de toutes tailles pour la gestion de contenu, les pipelines de données IoT, les backends mobiles et les feature stores d'IA/ML lorsque les schémas relationnels sont trop rigides. Ce module déploie MongoDB sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par MongoDB et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

MongoDB s'exécute sous forme de StatefulSet sur GKE Autopilot. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot (StatefulSet) | 1 vCPU / 2 GiB par défaut, mode nœud unique |
| Stockage persistant | Persistent Disk (PVC SSD) | StorageClass `standard-rwo`, 20 GiB par défaut, monté sur `/data/db` |
| Secrets | Secret Manager | Mot de passe root MongoDB généré automatiquement |
| Images de conteneur | Artifact Registry | Image officielle `mongo` mise en miroir dans le registre du projet |
| Réseau | VPC / Service GKE | `ClusterIP` par défaut pour un accès interne au cluster ; passez à `LoadBalancer` uniquement si un accès externe au protocole filaire brut est nécessaire |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** MongoDB est son propre moteur de base de données ; Cloud SQL n'est pas provisionné et `enable_cloudsql_volume` est codé en dur à `false`.
- **Un PVC adossé à un SSD est indispensable.** Sans PVC de StatefulSet, toutes les données sont perdues à chaque redémarrage du pod. `stateful_pvc_enabled = true` sélectionne automatiquement un StatefulSet.
- **Mode nœud unique uniquement.** `min_instance_count` et `max_instance_count` sont tous deux fixés à 1. Les replica sets MongoDB nécessitent une configuration supplémentaire de clé d'authentification et de `rs.initiate()` qui sort du cadre de ce module.
- **Le mot de passe root est généré automatiquement.** `MONGO_INITDB_ROOT_PASSWORD` est généré et stocké dans Secret Manager lors du premier déploiement ; vous ne le définissez jamais en clair.
- **Sondes TCP sur le port 27017.** MongoDB parle son propre protocole filaire binaire, et non HTTP — les sondes HTTP échouent systématiquement.
- **fsGroup 999 est codé en dur.** L'image officielle MongoDB exécute `mongod` avec l'UID/GID 999 ; Kubernetes attribue automatiquement le point de montage du PVC à ce GID.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet MongoDB {#a-gke-autopilot--the-mongodb-statefulset}

MongoDB s'exécute sous forme de StatefulSet à pod unique sur Autopilot, qui provisionne les nœuds à la demande et facture le CPU et la mémoire réellement demandés par le pod. Autopilot doit provisionner un nœud, attacher le PVC et récupérer l'image avant le démarrage de `mongod` — la sonde de démarrage accorde jusqu'à ~8 minutes pour couvrir ces étapes.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet MongoDB pour consulter l'état du pod, les événements et l'utilisation des ressources. Kubernetes Engine → Services & Ingress affiche la ClusterIP ou l'adresse IP externe du LoadBalancer.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<statefulset-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" <pod-name>   # events and probe status
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle et le type de charge de travail StatefulSet.

### B. Persistent Disk — PVC SSD {#b-persistent-disk--ssd-pvc}

Les données MongoDB résident sur un **PVC Persistent Disk SSD** (StorageClass `standard-rwo`) monté sur `/data/db` dans le conteneur. Le PVC est provisionné automatiquement par GKE à la création du StatefulSet et persiste indépendamment des redémarrages de pods, des mises à jour progressives et des évictions de nœuds.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims pour voir le PVC et son volume associé. Compute Engine → Disks pour voir le Persistent Disk sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>   # capacity, access mode, status
  # Check disk usage inside the running pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data/db
  ```

La taille du PVC est définie au moment du déploiement par `stateful_pvc_size` (valeur par défaut `20Gi`). **La taille du PVC ne peut pas être réduite après sa création.** Provisionnez au moins 2 à 3 fois le volume de données initial attendu pour éviter le plantage `No space left on device`.

### C. Secret Manager — mot de passe root {#c-secret-manager--root-password}

Le mot de passe root MongoDB (`MONGO_INITDB_ROOT_PASSWORD`) est généré automatiquement lors du premier déploiement et stocké sous forme de secret Secret Manager. Il est injecté dans le pod via le pilote Secret Store CSI et n'apparaît jamais en clair.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mongo-root-password"
  gcloud secrets versions access latest \
    --secret=<secret-name> --project "$PROJECT"
  ```

Pour récupérer le mot de passe root en vue d'une connexion `mongosh` :
```bash
ROOT_PASS=$(gcloud secrets versions access latest \
  --secret=<resource-prefix>-mongo-root-password --project "$PROJECT")
kubectl exec -n "$NAMESPACE" <pod-name> -- \
  mongosh --username admin --password "$ROOT_PASS" --authenticationDatabase admin
```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Artifact Registry — image de conteneur {#d-artifact-registry--container-image}

L'image officielle `mongo` est mise en miroir dans l'Artifact Registry du projet avant le déploiement, de sorte que les pods ne la récupèrent jamais directement depuis Docker Hub. L'URI de l'image en miroir figure dans la sortie `container_image`.

- **Console :** Artifact Registry → sélectionnez le dépôt.
- **CLI :**
  ```bash
  gcloud artifacts docker images list \
    <region>-docker.pkg.dev/$PROJECT/<registry-repo> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, le Service Kubernetes de MongoDB est de type **ClusterIP** — MongoDB est un backend de base de données destiné à être consommé par d'autres charges de travail du cluster (par exemple RocketChat), et ClusterIP fournit déjà un accès inter-espaces de noms au sein du cluster via le DNS ; aucun LoadBalancer n'est donc nécessaire. Passez à `LoadBalancer` uniquement si un accès externe au protocole filaire brut de MongoDB (port 27017) est réellement nécessaire.

- **Console :** Kubernetes Engine → Services & Ingress ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Get the LoadBalancer external IP:
  kubectl get svc -n "$NAMESPACE" <service-name> \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```

La sortie `mongodb_endpoint` fournit l'URI de connexion prête à l'emploi (`mongodb://<ip>:27017` pour LoadBalancer ou l'URI DNS interne au cluster pour ClusterIP).

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, les adresses IP statiques et les détails sur Cloud CDN.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (y compris les journaux de démarrage et de requêtes de `mongod`) sont envoyées vers Cloud Logging. Les métriques GKE et Persistent Disk sont envoyées vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application MongoDB {#3-mongodb-application-behaviour}

- **Mode autonome uniquement.** Ce module déploie une seule instance `mongod`. Les replica sets MongoDB (change streams, transactions, réplication de l'oplog) nécessitent des fichiers de clé d'authentification et une configuration `rs.initiate()` qui sortent du cadre de ce module. `max_instance_count` est imposé à 1.
- **Initialisation au premier démarrage.** Au tout premier démarrage avec un PVC vierge, MongoDB crée l'utilisateur root (`MONGO_INITDB_ROOT_USERNAME`, par défaut `admin`) et la base de données initiale (`MONGO_INITDB_DATABASE`, par défaut `admin`). Ces valeurs sont **immuables une fois le PVC écrit** — les modifier après le premier déploiement n'a aucun effet (le script d'initialisation ne s'exécute qu'une fois par répertoire de données).
- **Dimensionnement du cache WiredTiger.** Le moteur de stockage WiredTiger de MongoDB dimensionne par défaut son cache à environ `(memory_limit − 1 GiB) × 0.5`. Avec la limite par défaut de `2Gi`, le cache fait ~500 MiB, ce qui suffit pour le développement. Portez `memory_limit` à `4Gi`–`8Gi` pour les charges de travail documentaires de production.
- **Tolérance de la sonde de démarrage.** GKE Autopilot doit provisionner un nœud, attacher le PVC et récupérer l'image avant le démarrage de `mongod`. La sonde de démarrage accorde jusqu'à ~8 minutes (`failure_threshold = 45`, vérification toutes les 10 secondes). Lors des redémarrages ultérieurs du pod sur un nœud déjà prêt, le démarrage est beaucoup plus rapide.
- **Vidage du journal à l'arrêt.** `termination_grace_period_seconds` est fixé à 60 secondes (par défaut) afin que Kubernetes attende que `mongod` vide le journal d'écriture anticipée avant de tuer le processus de force — ce qui évite la corruption du journal.
- **Chaîne de connexion.** Le format correct pour se connecter avec l'identifiant root est :
  ```
  mongodb://<username>:<password>@<host>:<port>/<db>?authSource=admin
  ```
  Le paramètre `authSource=admin` est obligatoire pour se connecter à des bases de données autres que admin avec le compte root.
- **Sondes de santé.** Les sondes de démarrage et de vivacité utilisent toutes deux `type = "TCP"` sur le port 27017. MongoDB parle son propre protocole filaire binaire — les sondes HTTP échouent systématiquement avec une erreur de protocole.
- **Aucune tâche planifiée.** MongoDB ne nécessite aucun job cron côté plateforme. Les tâches applicatives (construction d'index, index TTL) sont gérées depuis l'application ou via `mongosh`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à MongoDB ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `application_name` | `mongodb` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `MongoDB` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `7.0` | Tag de version de l'image MongoDB ; incrémentez-le pour déployer une nouvelle version. Les mises à niveau majeures modifient le format sur disque — testez sur un réplica avant de mettre à niveau la production. |
| `mongo_root_username` | `admin` | Nom d'utilisateur root (`MONGO_INITDB_ROOT_USERNAME`). **Immuable après la première écriture du PVC.** |
| `mongo_initdb_database` | `admin` | Base de données initiale créée au premier démarrage. **Immuable après la première écriture du PVC.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. Passez à `2000m` pour les charges de travail riches en agrégations. |
| `memory_limit` | `2Gi` | Mémoire par pod. Cache WiredTiger ≈ `(limit − 1 GiB) × 0.5` ; passez à `4Gi`–`8Gi` en production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Doit valoir 1 en mode nœud unique. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. **Imposé à 1** — les replica sets ne sont pas pris en charge par ce module. |
| `container_port` | `27017` | Port du protocole filaire MongoDB. Définit à la fois le port du Service et le port d'écoute de `mongod`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image `mongo` dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MONGO_INITDB_ROOT_USERNAME` et `MONGO_INITDB_DATABASE` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager injectées sous forme de variables d'environnement. Fournissez ici `MONGO_INITDB_ROOT_PASSWORD` pour utiliser un mot de passe personnalisé au lieu de celui généré automatiquement. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création du secret du mot de passe root avant le démarrage du pod. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | `ClusterIP` limite l'accès à l'intérieur du cluster (suffisant pour les consommateurs internes au cluster via le DNS) ; `LoadBalancer` expose le port 27017 avec une adresse IP externe. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucune persistance de session n'est nécessaire pour les connexions au protocole filaire MongoDB. |
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laissez vide pour le générer automatiquement. |
| `termination_grace_period_seconds` | `60` | Délai de grâce permettant à `mongod` de vider le journal avant SIGKILL. |
| `deployment_timeout` | `600` | Nombre de secondes pendant lesquelles Terraform attend le déploiement du StatefulSet (couvre le provisionnement du nœud et l'attachement du PVC). |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes pour restreindre le trafic entrant/sortant. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour activer un StatefulSet adossé à un PVC. **Obligatoire pour la durabilité des données.** |
| `stateful_pvc_size` | `20Gi` | Taille du stockage. Ne peut pas être réduite après la création ; provisionnez 2 à 3 fois le volume de données attendu. |
| `stateful_pvc_mount_path` | `/data/db` | Doit correspondre au `--dbpath` de MongoDB. Ne le modifiez pas. |
| `stateful_pvc_storage_class` | `standard-rwo` | Valeur SSD par défaut de GKE Autopilot. Utilisez `premium-rwo` pour les charges de travail à haut débit. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | GID fsGroup (remarque : `999` est **codé en dur** dans le module pour MongoDB — cette variable n'a aucun effet). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant une interruption (pour MongoDB à nœud unique, `1` est la seule valeur raisonnable). |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, 20s delay, failure_threshold 18 | Entrée de sonde TCP au niveau du socle sur le port 27017. La véritable sonde de démarrage du conteneur est codée en dur dans le module avec `failure_threshold = 45` (~8 minutes) pour couvrir le provisionnement du nœud GKE Autopilot, l'attachement du PVC et la récupération de l'image — voir la [section 3](#3-mongodb-application-behaviour). |
| `health_check_config` | TCP, 30s delay, failure_threshold 3 | Sonde de vivacité TCP sur le port 27017. |
| `uptime_check_config` | désactivé | Test de disponibilité — désactivé par défaut, car MongoDB est un service interne. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques Cloud Monitoring. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs Kubernetes exécutés avant le démarrage du pod MongoDB. Non requis pour MongoDB — aucun job d'amorçage de la base de données n'est nécessaire. |
| `cron_jobs` | `[]` | CronJobs planifiés. MongoDB n'a aucune tâche planifiée obligatoire côté plateforme. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir [App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas nécessaire pour MongoDB — utilisez plutôt le PVC du StatefulSet. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | MongoDB ne nécessite pas de bucket GCS. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK pour le stockage et le registre. |
| `max_images_to_retain` | `7` | Nombre d'images récentes à conserver dans Artifact Registry. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique `mongodump` (UTC). **Vérifiez que le job de sauvegarde est actif** — une sauvegarde manquée combinée à la suppression du PVC entraîne une perte de données définitive. |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 30–90 pour la production ou la conformité. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'entrée HTTPS Gateway (nom d'hôte `<ip>.nip.io` sans configuration lorsque `application_domains` est vide) — inhabituel pour un service de base de données non HTTP ; le trafic `mongodb://` réel est servi par le Service LoadBalancer L4, et non par cette entrée HTTP(S). |
| `application_domains` | `[]` | Noms de domaine personnalisés. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

IAP n'est pas recommandé pour MongoDB (une base de données, et non une application web). Restreignez plutôt l'accès via `service_type = "ClusterIP"` ou une NetworkPolicy Kubernetes.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Non recommandé pour MongoDB. Utilisez une NetworkPolicy ou ClusterIP. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsque le type de service est LoadBalancer). |
| `mongodb_endpoint` | URI de connexion MongoDB prête à l'emploi (`mongodb://...`). Les déploiements ClusterIP renvoient l'URI DNS interne au cluster ; les déploiements LoadBalancer renvoient l'URI externe. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut pour MongoDB). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation exécutés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Sans PVC, toutes les données MongoDB sont perdues à chaque redémarrage de pod, mise à jour progressive ou éviction de nœud. |
| `stateful_pvc_mount_path` | `/data/db` (par défaut) | Critical | Doit correspondre au `--dbpath` de MongoDB. Un montage ailleurs fait écrire `mongod` dans la couche éphémère — toutes les données sont perdues au redémarrage. |
| `MONGO_INITDB_ROOT_PASSWORD` | généré automatiquement (par défaut) | Critical | MongoDB démarre sans authentification si la variable d'environnement est absente. Tout appelant à l'intérieur du cluster obtient un accès administrateur sans restriction. Ne la supprimez ni ne la videz jamais. |
| `mongo_root_username` / `mongo_initdb_database` | à définir une seule fois | Critical | Intégrés au répertoire de données lors de la première initialisation. Les modifier après la création du PVC provoque un échec du démarrage. |
| `quota_memory_requests` / `quota_memory_limits` | unités binaires (`4Gi`) | Critical | Les entiers nus sont interprétés comme des octets par Kubernetes, ce qui bloque toute planification de pods. |
| `stateful_pvc_size` | `20Gi` au minimum, à dimensionner selon la charge | High | Un disque plein fait planter `mongod` avec `No space left on device`. Provisionnez 2 à 3 fois le volume de données attendu. La taille ne peut pas être réduite après la création. |
| `memory_limit` | `4Gi` en production | High | Le cache WiredTiger représente ~50 % de `(limit − 1 GiB)`. Un cache insuffisant provoque des E/S disque excessives et une forte dégradation des requêtes. |
| `workload_type` | `null` (StatefulSet automatique avec PVC) | High | Définir explicitement `Deployment` avec `stateful_pvc_enabled = true` échoue au moment du plan. MongoDB autonome nécessite un StatefulSet pour une association stable du PVC. |
| `application_version` | tester d'abord les mises à niveau majeures | High | Les mises à niveau de version majeure de MongoDB modifient le format de stockage sur disque. Le retour à une version antérieure n'est pas pris en charge. Testez toujours sur un réplica du PVC de production. |
| `backup_schedule` | actif et testé | High | MongoDB n'a pas de sauvegarde automatique intégrée en dehors du job `mongodump` de ce module. Une sauvegarde manquée combinée à la suppression du volume persistant lors de la destruction entraîne une perte de données définitive. |
| `service_type` | `ClusterIP` pour les services de la couche base de données (déjà la valeur par défaut) | High | `LoadBalancer` expose le port 27017 avec une adresse IP publique. Conservez la valeur par défaut `ClusterIP` sauf si un accès externe est explicitement requis, et utilisez des règles de pare-feu ou une NetworkPolicy si vous la changez. |
| `termination_grace_period_seconds` | `60` (par défaut) | High | Un délai de grâce trop court risque de corrompre le journal à l'arrêt si les écritures en cours n'ont pas été vidées. |
| `cpu_limit` | `2000m` en production | Medium | Les pipelines d'agrégation et la construction d'index sont gourmands en CPU. En dessous de `500m`, les requêtes complexes se dégradent fortement. |
| `replica set` | autonome uniquement | High | Ce module est à nœud unique. Les change streams, les transactions et la réplication de l'oplog nécessitent un replica set — utilisez un déploiement basé sur Helm pour les topologies multinœuds. |
| `enable_iap` | `false` (par défaut) | Low | IAP ne s'applique pas aux services de base de données. Utilisez plutôt une NetworkPolicy ou ClusterIP pour le contrôle d'accès. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. MongoDB_GKE n'a pas de module Common distinct ; toute la configuration propre à MongoDB est autonome au sein du module.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : MongoDB sur GKE Autopilot](../labs/MongoDB_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- Déployé aux côtés d'[Elasticsearch sur GKE Autopilot](Elasticsearch_GKE.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) dans la solution **Shared Data Services**.
