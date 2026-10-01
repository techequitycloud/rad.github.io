---
title: "Elasticsearch sur GKE Autopilot"
description: "Référence de configuration pour déployer Elasticsearch sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Elasticsearch_GKE.md @ 3055034 sha256:1d9c2cdb26af -->

# Elasticsearch sur GKE Autopilot {#elasticsearch-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Elasticsearch_GKE.png" alt="Elasticsearch sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Elasticsearch est un moteur open source distribué de recherche et d'analyse fondé sur
Apache Lucene. Ce module déploie un **cluster Elasticsearch à nœud unique** sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Elasticsearch et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Elasticsearch s'exécute comme une charge de travail StatefulSet. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod StatefulSet Elasticsearch, 2 vCPU / 4 GiB par défaut |
| Stockage persistant | Persistent Disk (SSD) | PVC de 30 GiB sur `/usr/share/elasticsearch/data`, conservé lors des redémarrages de pod |
| Secrets | Secret Manager | Secrets facultatifs injectés comme variables d'environnement |
| Entrée | Cloud Load Balancing | Service LoadBalancer sur le port 9200 pour l'accès inter-espaces de noms |
| Registre d'images | Artifact Registry | Image Elasticsearch mise en miroir depuis le registre d'Elastic |

**Ni Cloud SQL, ni Redis, ni buckets GCS** — Elasticsearch est entièrement autonome ;
toutes les données résident dans son PVC.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Un StatefulSet avec PVC est le type de charge de travail requis.** Définir
  `stateful_pvc_enabled =
  true` (qui sélectionne automatiquement StatefulSet) attribue à chaque pod un volume
  SSD dédié qui survit aux redémarrages, aux mises à jour progressives et aux évictions
  de nœuds. Perdre le PVC signifie perdre toutes les données indexées.
- **Le mode à nœud unique** (`discovery.type = single-node`) est imposé au moment du
  plan — `max_instance_count` est fixé à `1`. L'augmenter sans modifier le type de
  découverte crée des clusters isolés à nœud unique, et non un cluster distribué.
- **Le heap JVM doit représenter au plus la moitié de `memory_limit`.** Elasticsearch a
  besoin de l'autre moitié pour le cache de pages de l'OS et la surcharge de la JVM. Ne
  pas respecter ce ratio provoque des arrêts OOM sous la charge de recherche. Une
  précondition au moment du plan impose cette règle.
- **`cluster_name` est immuable après la première indexation.** Le modifier après
  l'indexation de documents conduit Elasticsearch à considérer les données existantes du
  PVC comme étrangères et à les rejeter. Choisissez un nom significatif avant le premier
  déploiement.
- **Le délai de grâce de terminaison est de 120 secondes** afin de permettre à
  Elasticsearch de vider proprement sur disque les écritures de segments en mémoire
  avant que le pod ne soit supprimé de force.
- **Ce module est la dépendance requise de `RAGFlow_GKE`.** Après le déploiement, la
  sortie `elasticsearch_endpoint` (`http://<external-ip>:9200`) est transmise à la
  variable `elasticsearch_hosts` de RAGFlow.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Elasticsearch {#a-gke-autopilot--the-elasticsearch-workload}

Elasticsearch s'exécute comme un StatefulSet Kubernetes sur GKE Autopilot. Autopilot
facture le CPU et la mémoire réellement demandés par le pod. Un PodDisruptionBudget
maintient le pod disponible pendant les mises à niveau de nœuds.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet
  Elasticsearch pour voir l'état du pod, les événements et le rattachement du PVC.
  Kubernetes Engine → Services & Ingress affiche l'IP externe du LoadBalancer sur le
  port 9200.
- **CLI :**
  ```bash
  kubectl get statefulsets,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" <pod-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # confirm PVC is Bound
  ```

Consultez [App_GKE](App_GKE.md) pour la mise à l'échelle Autopilot, le PDB et le cycle
de vie du StatefulSet.

### B. Persistent Disk — stockage des index {#b-persistent-disk--index-storage}

Tous les index et fichiers de shards Elasticsearch résident sur un
PersistentVolumeClaim adossé à un **Persistent Disk (SSD)**. Le PVC est provisionné par
la StorageClass `standard-rwo` (ou `premium-rwo`) et monté sur
`/usr/share/elasticsearch/data`.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims pour voir la taille
  et l'état de liaison. Compute Engine → Disks affiche le disque sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Check disk usage inside the pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /usr/share/elasticsearch/data
  ```

Surveillez les seuils de remplissage du disque — Elasticsearch passe les index en
lecture seule à 95 % de capacité par défaut. Dimensionnez le PVC avec une marge de
50–100 % au-dessus du volume de données attendu.

### C. Point de terminaison du service Elasticsearch {#c-elasticsearch-service-endpoint}

L'API HTTP d'Elasticsearch est exposée sur le port 9200 via un Service Kubernetes de
type LoadBalancer. Cette IP externe constitue la sortie `elasticsearch_endpoint` et est
transmise directement à RAGFlow et aux autres consommateurs.

- **Console :** Kubernetes Engine → Services & Ingress → sélectionnez le service pour
  voir l'IP externe et le mappage de ports.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  # Verify the cluster is up and healthy:
  curl http://<elasticsearch-endpoint>/_cluster/health?pretty
  curl http://<elasticsearch-endpoint>/_cat/indices?v
  # List all indexes:
  curl http://<elasticsearch-endpoint>/_cat/indices?h=index,docs.count,store.size
  ```

### D. Secret Manager {#d-secret-manager}

Les secrets facultatifs (tels que des identifiants personnalisés ou des clés d'API) sont
stockés dans Secret Manager et injectés comme variables d'environnement au démarrage du
pod.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Artifact Registry — image de conteneur {#e-artifact-registry--container-image}

L'image officielle `docker.elastic.co/elasticsearch/elasticsearch:<version>` est mise en
miroir dans Artifact Registry avant chaque déploiement (lorsque
`enable_image_mirroring =
true`). Cela évite les limites de débit du registre d'Elastic et conserve les images à
l'intérieur de votre périmètre VPC.

- **Console :** Artifact Registry → sélectionnez le dépôt pour voir les tags, les
  condensés (digests) et les résultats de l'analyse des vulnérabilités.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le Service LoadBalancer expose Elasticsearch sur le port 9200. Une IP externe statique
peut être réservée. Cloud Armor peut être ajouté sur le backend de l'Ingress pour une
protection WAF (même si, pour Elasticsearch, les restrictions au niveau réseau — règles
de pare-feu et `enable_network_segmentation`
— sont généralement préférables aux règles WAF destinées aux navigateurs).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, les IP statiques et les
détails de Cloud Armor.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr du pod (journaux Elasticsearch) sont envoyés vers Cloud Logging.
Les métriques GKE sont envoyées vers Cloud Monitoring. Des tests de disponibilité
facultatifs peuvent sonder `/_cluster/health`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Elasticsearch {#3-elasticsearch-application-behaviour}

- **Fonctionnement à nœud unique.** Le module déploie Elasticsearch avec
  `discovery.type = single-node`, ce qui désactive la coordination de cluster. C'est le
  mode correct et pris en charge pour un déploiement à un seul pod. N'augmentez pas
  `max_instance_count` au-delà de `1` sans remplacer également `discovery.type` —
  exécuter plusieurs clusters à nœud unique en parallèle aboutit à une isolation des
  données, et non à leur distribution.
- **Stockage persistant des index.** Toutes les données résident dans le PVC sur
  `/usr/share/elasticsearch/data`. Le chemin est imposé — modifier
  `stateful_pvc_mount_path` sans mettre à jour le paramètre `path.data` fait atterrir
  les écritures dans la couche éphémère du conteneur, où elles sont perdues sans
  avertissement au prochain redémarrage du pod.
- **Dimensionnement du heap JVM.** `ES_JAVA_OPTS` est automatiquement défini sur
  `-Xms<heap> -Xmx<heap>` à partir de la variable `es_java_heap`. Le heap
  d'Elasticsearch ne doit pas dépasser la moitié de `memory_limit` — le reste est
  consommé par le cache de segments hors heap de Lucene, le metaspace de la JVM et la
  mémoire native. Une précondition au moment du plan impose cette règle.
- **mmap désactivé.** GKE Autopilot n'autorise pas les `initContainers` privilégiés à
  augmenter `vm.max_map_count`. Le module définit donc `node.store.allow_mmap = false`,
  ce qui empêche l'utilisation de fichiers mappés en mémoire via mmap et entraîne une
  légère pénalité en lecture séquentielle par rapport au mode mmap. Il s'agit d'une
  contrainte connue de GKE Autopilot.
- **Les sondes de santé sont codées en dur en TCP, sans condition.** `elasticsearch.tf`
  définit à la fois la sonde de démarrage et la sonde de vivacité sur `type = "TCP"`,
  quelle que soit la valeur de `enable_xpack_security` — une simple vérification
  d'ouverture du port 9200, et non une requête HTTP vers `/_cluster/health`. La sonde de
  démarrage autorise jusqu'à 60 tentatives avec une période de 10s (≈10 minutes au
  total, en plus d'un délai initial de 30s) pour tenir compte du provisionnement d'un
  nœud à froid, du téléchargement de l'image et du temps de démarrage de la
  JVM/récupération des shards ; la sonde de vivacité utilise un délai initial de 60s,
  une période de 30s et un seuil de 3 tentatives. C'est délibéré : une sonde HTTP
  renverrait `401 Unauthorized` dès que la sécurité X-Pack est activée, et échouerait
  avant la fin des vérifications d'amorçage propres à Elasticsearch (réputées réussies
  dès que le port 9200 est ouvert). **Les variables `startup_probe_config` et
  `health_check_config` n'ont aucun effet sur ce module** — `App_GKE` (`modules.tf`)
  privilégie toujours la sonde codée en dur par l'application plutôt que la valeur
  transmise par ces variables ; il n'y a donc rien à configurer ni à remplacer pour un
  opérateur, y compris lorsque `enable_xpack_security = true`.
- **La sécurité X-Pack est désactivée par défaut.** Avec `enable_xpack_security = false`,
  le point de terminaison HTTP accepte les requêtes non authentifiées. Tout appelant
  capable d'atteindre le port 9200 peut lire, écrire ou supprimer tous les index. C'est
  acceptable pour un cluster accessible uniquement au sein du VPC ; activez-la pour les
  déploiements publics ou multi-locataires.
- **L'authentification X-Pack est entièrement automatisée lorsqu'elle est activée.**
  Définir `enable_xpack_security = true` déclenche `elasticsearch_auth.tf`, qui génère un
  mot de passe aléatoire, le stocke dans Secret Manager sous
  `secret-<prefix>-<application_name>-elastic-password` et l'injecte dans le conteneur
  en tant que `ELASTIC_PASSWORD` — l'image officielle initialise le superutilisateur
  `elastic` avec cette valeur au premier démarrage sur un répertoire de données vide.
  Aucune configuration n'est requise de la part de l'opérateur. Le nom d'utilisateur
  (toujours `elastic`) et l'ID du secret sont exposés via les sorties
  `elasticsearch_username` et `elasticsearch_password_secret_id` (voir
  [Sorties](#5-outputs)) — récupérez le mot de passe avec
  `gcloud secrets versions access latest --secret=<elasticsearch_password_secret_id>`.
  Les modules consommateurs tels que RAGFlow ou Zammad peuvent référencer ce même ID de
  secret de manière déterministe pour s'authentifier auprès de ce cluster.
- **Le nom du cluster est intégré à l'identité du nœud.** Modifier `cluster_name` après
  la création du premier index conduit Elasticsearch à considérer les données
  existantes du PVC comme étrangères et à ne pas démarrer. Un renommage exige de
  détruire le PVC et de réindexer tous les documents.
- **Aucun job d'initialisation n'est requis.** Elasticsearch s'initialise lui-même au
  premier démarrage. Il n'y a aucune étape de création de base de données ou
  d'utilisateur.
- **Délai de grâce de terminaison.** Kubernetes attend 120 secondes après l'envoi de
  SIGTERM avant d'arrêter le pod de force. Cela permet à Elasticsearch de vider les
  entrées du translog et de fermer proprement les shards, évitant une récupération
  potentiellement lente depuis le translog au démarrage suivant.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Elasticsearch ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
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
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `elasticsearch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Elasticsearch` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `8.13.4` | Tag de version de l'image Elasticsearch ; incrémentez-le pour déployer une nouvelle version. |
| `cluster_name` | `ragflow` | Définit `cluster.name` dans Elasticsearch. **Immuable après la première indexation** — un renommage exige la destruction complète du PVC et une réindexation. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner l'espace de noms et l'IAM sans déployer la charge de travail. |
| `container_image_source` | `prebuilt` | Toujours `prebuilt` — Elasticsearch utilise l'image officielle d'Elastic. |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour utiliser l'image Elasticsearch officielle. |
| `enable_image_mirroring` | `true` | Met l'image en miroir depuis le registre d'Elastic vers Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Conservez `1` pour le mode à nœud unique. |
| `max_instance_count` | `1` | **Fixé à `1`** — imposé au moment du plan. L'augmenter sans remplacer `discovery.type` crée des clusters isolés. |
| `container_port` | `9200` | Port de l'API HTTP d'Elasticsearch. |
| `cpu_limit` | `2000m` | CPU par pod. 2 vCPU constituent la base recommandée ; passez à `4000m` pour une indexation intensive. |
| `memory_limit` | `4Gi` | Mémoire par pod. **Doit être au moins égale à 2× `es_java_heap`.** |
| `es_java_heap` | `512m` | Heap JVM (`-Xms` et `-Xmx`). **Doit être ≤ la moitié de `memory_limit`** — imposé au moment du plan. |
| `enable_xpack_security` | `false` | Active la sécurité X-Pack (authentification). Avec `false`, le port 9200 n'est pas authentifié. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `timeout_seconds` | `300` | Délai d'expiration du backend de l'équilibreur de charge (0–3600 secondes). |
| `termination_grace_period_seconds` | `120` | Secondes pendant lesquelles Kubernetes attend, après SIGTERM, le vidage des segments avant l'arrêt forcé. |
| `deployment_timeout` | `1800` | Secondes pendant lesquelles Terraform attend la fin du déploiement du StatefulSet. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires fusionnées dans le conteneur **après** les paramètres Elasticsearch injectés automatiquement ; elles peuvent remplacer toute valeur définie automatiquement (par ex. `discovery.type`, `ES_JAVA_OPTS`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Nom du cluster GKE ; laissez vide pour la détection automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; généré automatiquement s'il est vide. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `service_type` | `LoadBalancer` | `LoadBalancer` est requis pour l'accès inter-espaces de noms depuis RAGFlow. N'utilisez `ClusterIP` que si les deux charges de travail partagent le même espace de noms. |
| `session_affinity` | `None` | Affinité de session. `None` est la valeur correcte pour Elasticsearch (HTTP sans état). |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes pour restreindre le trafic entrant/sortant. |
| `termination_grace_period_seconds` | `120` | Figure également dans le groupe 4 ; à définir une seule fois ici. |
| `deployment_timeout` | `1800` | Figure également dans le groupe 4 ; à définir une seule fois ici. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods GKE pour les règles de pare-feu. |

### Groupe 7 — StatefulSet et persistance {#group-7--statefulset--persistence}

La persistance des données est critique — toutes les données d'index Elasticsearch
résident dans le PVC.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Définissez `true` pour tous les déploiements** — sélectionne automatiquement StatefulSet. Sans PVC, tous les index sont perdus à chaque redémarrage du pod. |
| `stateful_pvc_size` | `30Gi` | Taille du PVC. Prévoyez une marge de 50–100 % ; Elasticsearch passe en lecture seule à 95 % d'utilisation du disque. |
| `stateful_pvc_mount_path` | `/usr/share/elasticsearch/data` | **Ne pas modifier** — doit correspondre au paramètre `path.data` d'Elasticsearch. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass. Utilisez `premium-rwo` pour une indexation vectorielle kNN à haut débit. La StorageClass ne peut pas être modifiée après la création du PVC. |
| `stateful_headless_service` | `null` | Définissez `true` pour créer un Service headless offrant des entrées DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | **Sans effet pour ce module.** `elasticsearch.tf` et `main.tf` codent en dur `stateful_fs_group = 1000` (UID/GID d'Elasticsearch) sans condition lors de l'appel à `App_GKE` ; la valeur de cette variable n'est jamais lue. Déclarée uniquement pour la compatibilité avec l'interface d'`App_GKE` — aucune action de l'opérateur n'est nécessaire. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | `""` | Chaînes de quota CPU (par ex. `"4000m"`). |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — Kubernetes lit les entiers nus comme des octets, ce qui bloque toute planification de pods. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Pour un cluster à nœud unique, `"1"` empêche toute interruption volontaire — passez à 2 réplicas ou plus avant de réduire cette valeur. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/_cluster/health`, 18 tentatives | **Sans effet pour ce module.** Le module déploie toujours une sonde de démarrage `TCP` codée en dur (délai initial de 30s, seuil de 60 tentatives), quelle que soit la valeur de cette variable — aucune action de l'opérateur n'est nécessaire, y compris lorsque `enable_xpack_security = true`. Voir [Comportement de l'application](#3-elasticsearch-application-behaviour). |
| `health_check_config` | HTTP `/_cluster/health`, 3 tentatives | **Sans effet pour ce module.** Le module déploie toujours une sonde de vivacité `TCP` codée en dur (délai initial de 60s, seuil de 3 tentatives), quelle que soit la valeur de cette variable — aucune action de l'opérateur n'est nécessaire. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/_cluster/health`. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs Kubernetes exécutés avant le démarrage du pod Elasticsearch. Non requis pour Elasticsearch — il s'initialise lui-même. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par ex. tâches de gestion du cycle de vie des index). |
| `additional_services` | `[]` | Services GKE annexes (sidecar) ou auxiliaires déployés aux côtés d'Elasticsearch. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

NFS n'est pas requis pour Elasticsearch — toutes les données résident dans le PVC du
StatefulSet. Les variables NFS sont présentes pour la compatibilité avec l'interface du
socle, mais sont désactivées par défaut (`enable_nfs = false`). Consultez
[App_GKE](App_GKE.md) pour plus de détails.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

Les buckets Cloud Storage ne sont pas requis pour Elasticsearch
(`create_cloud_storage =
false` par défaut). Les variables Artifact Registry contrôlent la règle de conservation
des images pour l'image Elasticsearch mise en miroir :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Âge au-delà duquel les images peuvent être supprimées. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options de chiffrement CMEK. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes (UTC). Pour Elasticsearch, privilégiez les instantanés (Snapshots) natifs d'Elasticsearch vers GCS plutôt que les sauvegardes au niveau de l'OS. |
| `backup_retention_days` | `7` | Durée de conservation en jours ; augmentez-la pour la production ou la conformité. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour un nom d'hôte personnalisé + un certificat géré. Ne prend effet que lorsque `application_domains` n'est pas vide. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags réseau des pods GKE pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

IAP n'est **pas recommandé** pour Elasticsearch — utilisez plutôt des contrôles au
niveau réseau (`enable_network_segmentation`, règles de pare-feu). Les variables IAP
sont présentes par souci d'exhaustivité.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Elasticsearch. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé. |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Non applicable à Elasticsearch. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `elasticsearch_endpoint` | Sortie principale pour RAGFlow. `http://<service_external_ip>:9200`. Transmettez-la à la variable `elasticsearch_hosts` de `RAGFlow_GKE`. Renvoie `null` tant que l'IP externe n'est pas attribuée. |
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer. |
| `api_url` | URL du service. |
| `statefulset_name` | Nom de la ressource StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (liste vide — aucun bucket n'est provisionné). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration exécutés avant la charge de travail. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster est disponible et que toutes les ressources de la charge de travail sont déployées. `false` lors du premier apply d'un nouveau cluster — le pipeline CI/CD doit relancer l'apply pour terminer le déploiement. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |
| `elasticsearch_username` | Nom d'utilisateur du superutilisateur Elasticsearch. Toujours `"elastic"`. N'a de sens que lorsque `enable_xpack_security = true`. |
| `elasticsearch_password_secret_id` | ID du secret Secret Manager contenant le mot de passe généré automatiquement du superutilisateur `elastic`. Chaîne vide lorsque `enable_xpack_security = false`. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critique | Sans PVC, tous les index sont stockés dans le système de fichiers éphémère du pod et définitivement perdus à chaque redémarrage, mise à jour progressive ou éviction de nœud. |
| `stateful_pvc_mount_path` | `/usr/share/elasticsearch/data` | Critique | Doit correspondre à `path.data`. Une incohérence écrit les index sans avertissement dans la couche éphémère — les données sont perdues à chaque redémarrage. |
| `cluster_name` | défini une seule fois | Critique | Immuable après la première indexation. Un renommage conduit Elasticsearch à rejeter toutes les données du PVC comme étrangères ; une réindexation complète est requise. |
| `es_java_heap` vs `memory_limit` | heap ≤ `memory_limit / 2` | Critique | Un heap dépassant la moitié de la mémoire du conteneur entre en concurrence avec le cache de pages de Lucene ; des arrêts OOM surviennent sous la charge de recherche. Une précondition au moment du plan l'impose. |
| `stateful_fs_group` | n/a — codé en dur | n/a | Le module transmet toujours `stateful_fs_group = 1000` (UID/GID d'Elasticsearch) à `App_GKE`, quelle que soit cette variable. Ce n'est pas une préoccupation pour l'opérateur ; elle figure ici uniquement parce que la variable existe dans l'interface. |
| `max_instance_count` | `1` | Critique | L'augmenter sans remplacer `discovery.type` crée des clusters isolés à nœud unique. Imposé au moment du plan. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers nus sont des octets et bloquent immédiatement toute planification. |
| `enable_xpack_security` | `true` en production | Élevé | Avec `false`, tout appelant capable d'atteindre le port 9200 peut lire, écrire ou supprimer tous les index sans identifiants. |
| `stateful_pvc_size` | dimensionné avec une marge de 50–100 % | Élevé | Un PVC sous-dimensionné déclenche la protection du seuil « flood-stage » à 95 % de remplissage ; l'index passe en lecture seule. |
| `stateful_pvc_storage_class` | `standard-rwo` (ou `premium-rwo` en production) | Moyen | `standard-rwo` convient aux charges de recherche classiques ; l'indexation vectorielle kNN à haut débit tire parti de `premium-rwo`. La StorageClass ne peut pas être modifiée après la création du PVC. |
| `memory_limit` | ≥ `2 × es_java_heap` | Critique | Une marge mémoire insuffisante déclenche des arrêts OOM pendant la recherche/l'indexation. |
| `startup_probe_config` / `health_check_config` | n/a — codé en dur en TCP | n/a | Le module déploie toujours des sondes TCP codées en dur, quelle que soit la valeur de ces variables ; une incohérence HTTP/X-Pack ne peut donc pas se produire et il n'y a rien à remplacer. Elles figurent ici uniquement parce que les variables existent dans l'interface. |
| `enable_image_mirroring` | `true` | Faible | Désactiver la mise en miroir télécharge directement depuis le registre d'Elastic ; les limites de débit peuvent provoquer des échecs de déploiement intermittents. |
| `application_version` | `8.13.4` (ou version verrouillée) | Moyen | Les mises à niveau de version majeure (7.x → 8.x) peuvent nécessiter des vérifications de compatibilité des index ; ne mettez pas à niveau sans consulter le guide de migration d'Elasticsearch. |
| `pdb_min_available` vs `min_instance_count` | marge | Moyen | `pdb_min_available = "1"` avec un cluster à un seul pod empêche toute interruption volontaire (par ex. mises à niveau de nœuds) de se dérouler. Passez à 2 pods ou plus, ou acceptez la contrainte. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Elasticsearch sur GKE Autopilot](../labs/Elasticsearch_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- Déployé aux côtés de [MongoDB sur GKE Autopilot](MongoDB_GKE.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) et [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) dans la solution **Shared Data Services**.
