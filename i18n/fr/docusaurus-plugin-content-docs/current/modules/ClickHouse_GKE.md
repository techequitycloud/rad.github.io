---
title: "ClickHouse sur GKE Autopilot"
description: "Référence de configuration pour déployer ClickHouse sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ClickHouse_GKE.md @ 3055034 sha256:3f1f4bf09a8e -->

# ClickHouse sur GKE Autopilot {#clickhouse-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ClickHouse_GKE.png" alt="ClickHouse sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ClickHouse est une base de données OLAP open source (Apache-2.0) orientée colonnes, conçue pour
l'analytique en temps réel sur de grands flux d'événements. Ce module déploie un **serveur
ClickHouse à nœud unique** sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

ClickHouse_GKE existe avant tout comme **magasin d'événements obligatoire de Plausible
Analytics** (`Plausible_GKE`) : la base de données PostgreSQL de Plausible ne contient que les comptes et
la configuration des sites — chaque page vue/événement est écrit dans cette instance
ClickHouse et interrogé depuis celle-ci. Le module fonctionne également comme base de données OLAP
généraliste à nœud unique.

Ce guide se concentre sur les services cloud utilisés par ClickHouse et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ClickHouse s'exécute sous la forme d'une charge de travail StatefulSet. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod StatefulSet ClickHouse, 2 vCPU / 4 GiB par défaut |
| Stockage persistant | Persistent Disk | PVC de 30 GiB (`standard-rwo`) sur `/var/lib/clickhouse`, survit aux redémarrages de pod |
| Secrets | Secret Manager | Mot de passe de l'utilisateur ClickHouse généré automatiquement, injecté en tant que `CLICKHOUSE_PASSWORD` |
| Entrée | Cloud Load Balancing | Service LoadBalancer sur le port 8123 (interface HTTP de ClickHouse) pour l'accès inter-espaces de noms |
| Registre d'images | Artifact Registry | `clickhouse/clickhouse-server` répliqué depuis Docker Hub |

**Pas de Cloud SQL, pas de Redis, pas de buckets GCS** — le wrapper impose en dur
`database_type = "NONE"`, `enable_cloudsql_volume = false` et `enable_redis = false`
dans l'appel au socle. Toutes les données résident dans le PVC.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **La version est explicitement épinglée — `latest` est refusé.** `application_version`
  vaut par défaut le tag éprouvé **`24.12-alpine`** et une validation au moment du plan refuse
  `"latest"`, car Plausible CE épingle la version de ClickHouse — des versions non testées l'ont
  cassé en amont (plausible/analytics#3855). Le socle résout le tag déployé
  à partir de cette variable (un remappage au niveau de la configuration est ignoré) ; un épinglage explicite est donc le
  seul contrôle fiable.
- **L'amorçage n'a lieu qu'une fois.** L'image officielle crée `CLICKHOUSE_DB`
  (`plausible_events_db`) et `CLICKHOUSE_USER` (`plausible`) **uniquement au premier démarrage
  sur un répertoire de données vide**, avec `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` afin que cet utilisateur puisse
  gérer les utilisateurs et les bases de données en SQL. Les migrations de Plausible créent le schéma des événements.
- **L'authentification par mot de passe est toujours activée.** Un mot de passe de 28 caractères (sans caractères spéciaux — il
  transite dans des URL et des en-têtes basic-auth) est généré par Terraform, stocké dans Secret
  Manager sous `secret-<tenant_resource_prefix>-clickhouse-clickhouse-password`, et
  injecté en tant que `CLICKHOUSE_PASSWORD`. Comme le service est un LoadBalancer par défaut, une
  instance non authentifiée serait un magasin analytique ouvert.
- **Le nœud unique est imposé au moment du plan** — `max_instance_count` doit valoir `1`.
  ClickHouse multi-nœuds nécessite une configuration Keeper/réplication que ce module ne
  fournit pas.
- **Le Service écoute sur 8123**, et non sur le port 80 par défaut d'App_GKE — le wrapper transmet
  `service_port = container_port` afin que les consommateurs (le `CLICKHOUSE_DATABASE_URL` de Plausible)
  construisent leur chaîne de connexion sur le port standard de l'interface HTTP de ClickHouse.
- **Les sondes sont TCP, figées dans la configuration du module.** Démarrage : délai initial de 30 s,
  période de 10 s, seuil d'échec de 60 — jusqu'à environ 10 minutes, car Autopilot doit
  provisionner un nœud, attacher le PVC et tirer l'image avant même que le conteneur
  ne démarre. Vivacité : 60 s / 30 s / 3. TCP est robuste quelle que soit la variante d'image et ne peut pas être
  bloqué par des changements d'authentification.
- **fsGroup 101.** L'image `clickhouse/clickhouse-server` s'exécute avec l'UID/GID 101 ; le
  module définit le fsGroup du pod à `101` afin que Kubernetes change le propriétaire du PVC à l'attachement et que le
  serveur puisse créer `/var/lib/clickhouse`.
- **Le délai de grâce à l'arrêt est de 120 secondes** afin que ClickHouse puisse écrire sur disque les parts
  de données en mémoire (segments) avant que le pod ne soit supprimé de force ; `deployment_timeout`
  vaut 1800 s.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ClickHouse {#a-gke-autopilot--the-clickhouse-workload}

ClickHouse s'exécute en tant que StatefulSet Kubernetes sur GKE Autopilot. Autopilot facture le
CPU et la mémoire que le pod demande réellement. Un PodDisruptionBudget maintient le pod disponible
pendant les mises à niveau des nœuds.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet ClickHouse pour voir
  l'état du pod, les événements et l'attachement du PVC. Kubernetes Engine → Services & Ingress
  affiche l'IP externe du LoadBalancer sur le port 8123.
- **CLI :**
  ```bash
  gcloud container clusters list --project "$PROJECT"
  kubectl get statefulset,pvc,svc -A | grep clickhouse     # name-agnostic discovery
  kubectl get statefulsets,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # confirm the PVC is Bound
  ```

Consultez [App_GKE](App_GKE.md) pour la mise à l'échelle d'Autopilot, le PDB et le cycle de vie du StatefulSet.

### B. Persistent Disk — stockage des événements {#b-persistent-disk--event-storage}

Toutes les parts de données ClickHouse résident sur un PersistentVolumeClaim adossé à Persistent Disk,
provisionné par la StorageClass `standard-rwo` et monté sur `/var/lib/clickhouse`
(le répertoire de données du serveur).

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims pour la taille et
  l'état de liaison. Compute Engine → Disks affiche le disque sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Check disk usage inside the pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /var/lib/clickhouse
  ```

Dimensionnez le PVC en fonction du volume d'événements — les charges de travail Plausible se compressent extrêmement bien dans
ClickHouse, mais prévoyez de la marge pour les fusions (les fusions de parts en arrière-plan nécessitent temporairement
de l'espace supplémentaire).

### C. Point de terminaison du service ClickHouse et authentification {#c-clickhouse-service-endpoint--authentication}

L'interface HTTP de ClickHouse est exposée sur le port 8123 via un Service Kubernetes
LoadBalancer. L'adresse externe est l'output `clickhouse_endpoint` ; l'adresse
DNS interne au cluster est `clickhouse_internal_endpoint` (à privilégier lorsque Plausible
s'exécute dans le même cluster). Le mot de passe de l'utilisateur amorcé réside dans Secret Manager.

- **Console :** Kubernetes Engine → Services & Ingress pour l'IP externe ; Security →
  Secret Manager pour le secret du mot de passe.
- **CLI :**
  ```bash
  CH_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  CH_SECRET=$(gcloud secrets list --project "$PROJECT" \
    --filter="name~clickhouse-password" --format="value(name)" --limit=1)
  CH_PASS=$(gcloud secrets versions access latest --secret="$CH_SECRET" --project "$PROJECT")

  # Unauthenticated health ping (expect "Ok."):
  curl -s "http://$CH_IP:8123/ping"

  # Authenticated query over HTTP:
  echo "SELECT version()" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-
  echo "SHOW DATABASES" | curl -s "http://$CH_IP:8123/" --user "plausible:$CH_PASS" --data-binary @-

  # Native client inside the pod:
  kubectl exec -n "$NAMESPACE" -it <pod-name> -- \
    clickhouse-client --user plausible --password "$CH_PASS" --query "SELECT 1"
  ```

### D. Secret Manager {#d-secret-manager}

Le mot de passe de l'utilisateur ClickHouse est généré par Terraform (`random_password`, 28
caractères, sans caractères spéciaux) et stocké comme secret applicatif rattaché au service —
`secret-<tenant_resource_prefix>-clickhouse-clickhouse-password` — puis injecté dans
le conteneur en tant que variable d'environnement secrète `CLICKHOUSE_PASSWORD`. Les modules consommateurs
(Plausible) référencent le même secret via l'output `clickhouse_password_secret_id`
et le socle accorde `secretAccessor` au compte de service de leur charge de travail.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~clickhouse-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le mécanisme d'injection des secrets et la rotation.

### E. Artifact Registry — image de conteneur {#e-artifact-registry--container-image}

L'image officielle `clickhouse/clickhouse-server:<version>` est répliquée dans Artifact
Registry avant le déploiement (lorsque `enable_image_mirroring = true`), ce qui évite les limites de débit de Docker Hub
et conserve les images à l'intérieur de votre périmètre VPC.

- **Console :** Artifact Registry → sélectionnez le dépôt pour voir les tags et les digests.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le Service LoadBalancer expose ClickHouse sur le port 8123 afin que Plausible (et les services Cloud Run)
puissent l'atteindre depuis d'autres espaces de noms. L'authentification par mot de passe protège le point de terminaison, mais pour
une défense en profondeur, privilégiez `service_type = "ClusterIP"` lorsque tout partage le
cluster, ou restreignez l'accessibilité avec `enable_network_segmentation` /
`admin_ip_ranges` / des règles de pare-feu.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, les IP statiques et les détails sur Cloud Armor.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (le journal du serveur ClickHouse) sont envoyées à Cloud Logging ; les métriques GKE sont envoyées
à Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ClickHouse {#3-clickhouse-application-behaviour}

- **Amorçage au premier démarrage uniquement.** L'image ne lit `CLICKHOUSE_DB`, `CLICKHOUSE_USER`
  et `CLICKHOUSE_PASSWORD` que lorsque `/var/lib/clickhouse` est vide. Dès que des données existent
  dans le PVC, modifier ces variables n'a aucun effet sur le serveur en cours d'exécution — gérez plutôt
  les utilisateurs et les bases de données en SQL (`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` accorde
  la gestion des accès à l'utilisateur amorcé). La validation au moment du plan refuse des
  `clickhouse_db` / `clickhouse_user` vides.
- **Plausible crée le schéma.** Aucun job d'initialisation ne s'exécute ; le module livre la
  base de données vide et les migrations de Plausible créent les tables d'événements au premier
  démarrage de Plausible. Les outputs `clickhouse_database` / `clickhouse_username` /
  `clickhouse_password_secret_id` sont exactement ce que consomme `Plausible_GKE`.
- **L'épinglage de version est une garantie de bon fonctionnement.** `application_version` vaut par défaut
  `24.12-alpine` et `"latest"` est refusé au moment du plan — le socle résout le
  tag déployé à partir de cette variable (un remappage au niveau de la configuration est ignoré) ; l'épinglage
  explicite est donc le seul contrôle fiable. Plausible CE ne prend en charge que les versions de ClickHouse
  sur lesquelles il est testé ; un tag plus récent arbitraire a déjà cassé Plausible en amont
  (plausible/analytics#3855). Traitez une montée de version comme un changement à valider avec
  votre version de Plausible, et non comme une mise à jour de routine.
- **Nœud unique uniquement.** `max_instance_count = 1` est imposé par une précondition au moment du
  plan. Passer un StatefulSet ClickHouse simple à 2 réplicas ou plus ne crée pas
  de cluster — les réplicas nécessiteraient ClickHouse Keeper et des moteurs de table `Replicated*`,
  que ce module ne configure pas.
- **Sondes TCP par conception.** `/ping` répond HTTP 200 sans authentification, mais les sondes TCP sont
  robustes quelle que soit la variante d'image et ne peuvent pas être bloquées par des changements de configuration d'authentification. La
  contrepartie : une sonde réussie prouve seulement que le port écoute — vérifiez explicitement l'authentification et
  le comportement des requêtes après le déploiement (voir les commandes d'exploration ci-dessus). Les
  variables `startup_probe_config` / `health_check_config` existent par souci de cohérence avec la
  convention ; les sondes de conteneur réellement utilisées sont les sondes TCP assemblées dans
  `clickhouse.tf`.
- **Un démarrage à froid lent est normal.** Sur un cluster Autopilot neuf, le premier déploiement peut
  prendre jusqu'à environ 10 minutes avant l'état Ready : provisionnement du nœud, attachement du PVC, tirage de l'image, puis
  initialisation de ClickHouse. La sonde de démarrage (seuil 60 × 10 s) et
  `deployment_timeout = 1800` sont dimensionnés pour cela — ne les raccourcissez pas parce qu'un redéploiement
  à chaud a été rapide.
- **L'arrêt progressif compte.** ClickHouse met en tampon les insertions dans des parts en mémoire et
  les fusionne sur disque en arrière-plan ; `termination_grace_period_seconds = 120` lui laisse
  le temps de les écrire proprement. Un arrêt forcé expose à une récupération lente au démarrage suivant.
- **UID/GID 101.** Le processus serveur s'exécute en tant que `clickhouse` (101:101). Le
  `stateful_fs_group = 101` du module rend le PVC accessible en écriture au groupe lors de l'attachement ; sans cela, le
  serveur ne peut pas créer son répertoire de données et plante immédiatement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à ClickHouse ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `clickhouse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `ClickHouse` | Nom convivial affiché dans la console. |
| `application_version` | `24.12-alpine` | Tag de l'image. **`latest` est refusé au moment du plan** — le socle résout le tag déployé à partir de cette variable (un remappage au niveau de la configuration est ignoré) ; un épinglage explicite testé avec Plausible est donc le seul contrôle fiable. |
| `clickhouse_db` | `plausible_events_db` | Base de données amorcée au premier démarrage (`CLICKHOUSE_DB`). Non vide, imposé au moment du plan. |
| `clickhouse_user` | `plausible` | Utilisateur amorcé au premier démarrage (`CLICKHOUSE_USER`) ; mot de passe généré automatiquement dans Secret Manager. Non vide, imposé au moment du plan. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Toujours `prebuilt` — image officielle `clickhouse/clickhouse-server`, sans build. |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour l'image officielle. |
| `enable_image_mirroring` | `true` | Réplique l'image dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Gardez `1` pour le mode nœud unique. |
| `max_instance_count` | `1` | **Doit valoir `1`** — imposé au moment du plan ; le multi-nœuds nécessite une configuration Keeper/réplication que ce module ne fournit pas. |
| `container_port` | `8123` | Port de l'interface HTTP de ClickHouse — également transmis comme port du Service (et non le port 80 par défaut d'App_GKE). |
| `cpu_limit` | `2000m` | CPU par pod. |
| `memory_limit` | `4Gi` | Mémoire par pod. ClickHouse recommande 4Gi comme plancher pratique ; un Plausible à faible trafic fonctionne correctement avec 2Gi. |
| `timeout_seconds` | `300` | Délai d'expiration du backend de l'équilibreur de charge. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires fusionnées dans le conteneur ; les valeurs de l'utilisateur remplacent celles intégrées au module (`CLICKHOUSE_DB`, `CLICKHOUSE_USER`, `CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT`). |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager (le module injecte déjà `CLICKHOUSE_PASSWORD`). |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création du secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; généré automatiquement s'il est vide. |
| `workload_type` | `null` | Laissez non défini — `null` est résolu automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` (par défaut) ; un Deployment est refusé avec un PVC. |
| `service_type` | `LoadBalancer` | Nécessaire pour l'accès inter-espaces de noms/inter-plateformes depuis Plausible. Utilisez `ClusterIP` lorsque tous les consommateurs partagent le cluster. |
| `termination_grace_period_seconds` | `120` | Délai de grâce après SIGTERM pour l'écriture des segments. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend le déploiement du StatefulSet. |

### Groupe 7 — StatefulSet et persistance {#group-7--statefulset--persistence}

La persistance des données est critique — toutes les données d'événements ClickHouse résident dans le PVC.

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Vaut `true` par défaut** — sans PVC, ClickHouse est déployé comme Deployment sur disque éphémère et tout le magasin d'événements est effacé à chaque replanification du pod. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `30Gi` | Taille du PVC. Prévoyez de la marge pour les fusions en arrière-plan. |
| `stateful_pvc_mount_path` | `/var/lib/clickhouse` | **Ne pas modifier** — le répertoire de données du serveur. |
| `stateful_pvc_storage_class` | `standard-rwo` | Valeur par défaut de GKE Autopilot ; `premium-rwo` pour des charges de requêtes plus lourdes. Non modifiable après la création du PVC. |
| `stateful_fs_group` | `101` | UID/GID de l'image `clickhouse/clickhouse-server`. `main.tf` transmet cette variable, et la configuration assemblée du module dans `clickhouse.tf` impose également `101` ; les deux concordent donc. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU et la mémoire de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont interprétés comme des octets et bloquent toute planification de pod. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Pour ClickHouse à nœud unique, `"1"` empêche toute interruption volontaire. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | _(déclarées)_ | Reflets de la convention — le conteneur utilise les sondes **TCP** figées du module (démarrage 30 s/10 s/60 ; vivacité 60 s/30 s/3). |
| `uptime_check_config` | désactivé, chemin `/_cluster/health` | Test de disponibilité Cloud Monitoring facultatif ; le chemin configuré n'est pas un véritable point de terminaison ClickHouse (utilisez `/ping` si vous l'activez). |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Non nécessaire — ClickHouse s'amorce lui-même ; Plausible crée le schéma. |
| `cron_jobs` / `additional_services` | `[]` | CronJobs / services sidecar facultatifs. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupes 13-16 — NFS, Cloud Storage, Redis, base de données {#groups-13-16--nfs-cloud-storage-redis-database}

Non utilisés par ClickHouse. `enable_nfs = false` et `create_cloud_storage = false` par
défaut ; `main.tf` **impose en dur** `enable_redis = false`, `database_type = "NONE"`
et `enable_cloudsql_volume = false` quelles que soient les variables déclarées (qui existent
par souci de parité avec l'interface du socle). Les réglages de conservation d'Artifact Registry
(`max_images_to_retain = 7`, `delete_untagged_images = true`,
`image_retention_days = 30`) s'appliquent à l'image répliquée.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron (UTC). Pour ClickHouse, préférez les instructions natives `BACKUP ... TO S3/GCS` aux sauvegardes au niveau du système d'exploitation. |
| `backup_retention_days` | `7` | Durée de conservation en jours. |
| `enable_backup_import` | `false` | Non applicable à ClickHouse. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour le routage par nom d'hôte personnalisé. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods GKE pour les règles de pare-feu. |

**Quota d'IP statiques :** sur les projets plafonnés en quota d'IP statiques externes globales, lorsque
le seul consommateur est interne au cluster (Plausible dans le même cluster GKE), définissez
`service_type = "ClusterIP"`, `reserve_static_ip = false` et
`enable_custom_domain = false` — cela évite de consommer une IP externe statique globale pour
une base de données que rien n'appelle depuis l'extérieur du cluster.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

IAP n'est **pas recommandé** pour ClickHouse — les consommateurs sont des services, pas des navigateurs. Utilisez
plutôt des contrôles au niveau du réseau. Lorsque `enable_iap = true`, `iap_oauth_client_id`
et `iap_oauth_client_secret` sont tous deux obligatoires (vérification au moment du plan).

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

`enable_cloud_armor = false`, `admin_ip_ranges = []`,
`cloud_armor_policy_name = "default-waf-policy"`, `enable_cdn = false` (non applicable).

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc = false`, `vpc_cidr_ranges = []`, `vpc_sc_dry_run = true`,
`organization_id = ""`, `enable_audit_logging = false`.

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `clickhouse_endpoint` | Point de terminaison HTTP externe : `http://<external-ip>:8123`. À transmettre à Plausible en tant que `clickhouse_url`. Renvoie `null` tant que l'IP externe n'est pas attribuée. |
| `clickhouse_internal_endpoint` | Point de terminaison interne au cluster : `http://<svc>.<ns>.svc.cluster.local:8123` — **à privilégier** lorsque `Plausible_GKE` s'exécute dans le même cluster. |
| `clickhouse_database` | Base de données amorcée par l'image au premier démarrage. |
| `clickhouse_username` | Nom d'utilisateur ClickHouse amorcé au premier démarrage. |
| `clickhouse_password_secret_id` | ID du secret Secret Manager contenant le mot de passe de l'utilisateur. Les modules consommateurs le transmettent comme `clickhouse_password_secret` de `Plausible_GKE`. |
| `service_name` / `namespace` | Nom / espace de noms du Service Kubernetes. |
| `service_cluster_ip` / `service_external_ip` / `api_url` | IP interne au cluster, IP du LoadBalancer et URL. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `statefulset_name` | Nom de la ressource StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — aucun n'est provisionné). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que toutes les ressources de la charge de travail sont déployées ; `false` lors du premier apply d'un nouveau cluster en ligne — relancez l'apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Risque | Piège | Conséquence | Prévention |
|---|---|---|---|
| Critical | Définir `application_version` sur une version de ClickHouse non testée | Plausible CE épingle la version de ClickHouse ; un tag plus récent arbitraire l'a cassé en amont (plausible/analytics#3855) — les migrations ou les requêtes échouent et l'ingestion analytique s'arrête. `"latest"` est désormais refusé au moment du plan. | Conservez l'épinglage par défaut `24.12-alpine`. Ne définissez une version explicite que si elle a été validée avec votre version de Plausible ; traitez une montée de version comme un changement testé. |
| Critical | Supprimer le PVC, ou définir `stateful_pvc_enabled = false` | Tous les événements analytiques jamais enregistrés sont détruits (ou, sans PVC, perdus silencieusement à chaque redémarrage de pod/éviction de nœud). La base PostgreSQL de Plausible conserve les comptes, mais l'historique des événements est irrécupérable. | Conservez la valeur par défaut `stateful_pvc_enabled = true` (StatefulSet) — le piège du disque éphémère est fermé par défaut. Ne supprimez jamais le PVC en dehors d'un démantèlement intentionnel ; sauvegardez d'abord avec la commande native `BACKUP` de ClickHouse. |
| Critical | Définir `max_instance_count > 1` | Des réplicas simples ne forment PAS un cluster — chaque pod aurait un répertoire de données isolé ; les écritures et les lectures divergent. Bloqué au moment du plan : le multi-nœuds nécessite une configuration Keeper/réplication que ce module ne fournit pas. | Laissez `min = max = 1`. Pour une véritable haute disponibilité, utilisez un déploiement ClickHouse configuré avec Keeper en dehors de ce module. |
| High | Exposer le port 8123 sur un LoadBalancer public sans contrôles réseau | L'authentification par mot de passe est toujours activée, mais l'interface HTTP reste accessible depuis Internet — force brute, reconnaissance via `/ping` et toute future erreur de configuration de l'authentification deviennent exploitables de l'extérieur. | Privilégiez `service_type = "ClusterIP"` (utilisez `clickhouse_internal_endpoint`) lorsque les consommateurs partagent le cluster ; sinon, restreignez avec `enable_network_segmentation`, des règles de pare-feu et `admin_ip_ranges`. |
| High | Considérer la sonde TCP comme une preuve de bonne santé | La sonde TCP réussit dès que le port écoute — une erreur de configuration de l'authentification ou un répertoire de données vide/étranger affiche quand même un pod « sain » alors que toutes les requêtes de Plausible échouent. | Après le déploiement, vérifiez explicitement : `curl http://$CH_IP:8123/ping`, puis un `SELECT version()` authentifié avec le mot de passe de Secret Manager. |
| High | Modifier `clickhouse_db`/`clickhouse_user` (ou s'attendre à ce qu'un nouveau mot de passe s'applique) après le premier démarrage | L'image n'amorce les identifiants qu'au premier démarrage sur un répertoire de données **vide** — les modifications postérieures à l'amorçage n'ont silencieusement aucun effet ; les consommateurs s'authentifient alors avec des valeurs que le serveur n'a jamais apprises. | Définissez-les une fois avant le premier déploiement (la vérification au moment du plan refuse les valeurs vides). Après l'amorçage, gérez les utilisateurs et les bases de données en SQL (`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1`). |
| Medium | Déclarer le premier déploiement en échec avant qu'Autopilot n'ait terminé | Un cluster Autopilot neuf nécessite le provisionnement du nœud + l'attachement du PVC + le tirage de l'image — jusqu'à environ 10 minutes avant l'état Ready. Une intervention manuelle en cours de déploiement (suppression de pods, nouvel apply) bloque le StatefulSet. | Attendez la fin de la fenêtre de la sonde de démarrage (60 × 10 s + 30 s de délai ; `deployment_timeout = 1800`). Surveillez `kubectl get pods -w` et les événements au lieu de redémarrer. |
| Medium | Sous-dimensionner `memory_limit` en dessous d'environ 2Gi | Les fusions et la mémoire des requêtes de ClickHouse dépassent les petites limites ; le pod est tué pour OOM lors de l'ingestion ou des requêtes du tableau de bord. | Conservez la valeur par défaut de 4Gi (le plancher pratique de ClickHouse) ; 2Gi uniquement pour des sites Plausible réellement peu fréquentés. |
| Medium | `quota_memory_requests` / `quota_memory_limits` sans suffixes binaires | Les entiers bruts sont interprétés comme des octets par Kubernetes et bloquent TOUTE planification de pod dans l'espace de noms. | Utilisez toujours des valeurs de la forme `"4Gi"` / `"8192Mi"` (validation au moment du plan dans App_GKE). |
| Low | Désactiver `enable_image_mirroring` | Les images sont tirées directement depuis Docker Hub ; les limites de débit peuvent faire échouer les déploiements par intermittence, ainsi que les nouveaux tirages dus à `imagePullPolicy`. | Laissez la réplication activée ; les réglages de conservation (`max_images_to_retain`, `image_retention_days`) maîtrisent la croissance du dépôt. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et réplication d'images — consultez **[App_GKE](App_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ClickHouse sur GKE Autopilot](../labs/ClickHouse_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- Déployé aux côtés de [Kestra sur GKE Autopilot](Kestra_GKE.md), [Apache Superset sur GKE Autopilot](Superset_GKE.md) et [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Analytics Warehouse**.
