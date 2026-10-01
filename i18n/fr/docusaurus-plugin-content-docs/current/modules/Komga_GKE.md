---
title: "Komga sur GKE Autopilot"
description: "Référence de configuration pour déployer Komga sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Komga_GKE.md @ 3055034 sha256:902fee9d56c4 -->

# Komga sur GKE Autopilot {#komga-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_GKE.png" alt="Komga sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga est un serveur multimédia libre, gratuit et auto-hébergé pour les collections
de bandes dessinées, de mangas et de livres numériques (Kotlin/Java, Spring Boot).
Il offre une interface web de lecture épurée, des flux OPDS, des collections, des
listes de lecture et une recherche en texte intégral dans votre bibliothèque. Ce
module déploie Komga sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Komga et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Komga s'exécute comme un unique pod JVM, de préférence sous forme de StatefulSet avec
un PVC en mode bloc. Le déploiement assemble un ensemble minimal de services Google
Cloud — il n'y a pas de base de données externe :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod JVM (Spring Boot), 1 vCPU / 1 GiB par défaut ; réplique unique |
| Base de données | Aucune | Komga utilise une base de données SQLite intégrée sous `/config` — aucune instance Cloud SQL n'est créée |
| Stockage objet / stockage en mode bloc | Cloud Storage (GCS FUSE) ou PVC | `stateful_pvc_enabled = true` (par défaut) monte un véritable PVC en mode bloc sur `/config` ; désactivez-le pour utiliser à la place un bucket adossé à GCS FUSE |
| Secrets | Secret Manager | Aucun généré — Komga n'a aucun secret de service injectable |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Komga stocke l'index de sa bibliothèque, les
  utilisateurs, la progression de lecture et les paramètres dans une base de données
  SQLite intégrée — confirmé par l'issue amont #1327 (demande de fonctionnalité
  ouverte et non implémentée pour la prise en charge d'une base externe).
  `database_type = "NONE"`, `enable_redis` forcé à `false`.
- **Image précompilée officielle.** `container_image_source = "prebuilt"` déploie
  directement `gotson/komga` — sans étape Cloud Build. `enable_image_mirroring = true`
  la duplique dans Artifact Registry (copie tenant compte du digest) pour éviter les
  limites de débit de Docker Hub.
- **Le PVC en mode bloc est la disposition recommandée.** `stateful_pvc_enabled = true`
  par défaut exécute Komga comme un StatefulSet avec un PVC par pod monté sur
  `/config` — l'absence de véritable verrouillage de fichiers dans gcsfuse corrompt
  les fichiers WAL SQLite, si bien qu'un véritable volume en mode bloc est préférable
  à GCS FUSE pour un usage en production.
- **Instance unique uniquement.** `min_instance_count = 1` et
  `max_instance_count = 1` — Komga sert une seule bibliothèque SQLite partagée depuis
  un seul volume ; ne dépassez pas 1.
- **S'exécute en tant que root.** Le conteneur de Komga n'a pas de directive `USER`
  (confirmé par des tests locaux du conteneur), si bien qu'aucun contournement par
  options de montage uid/gid pour gcsfuse ou le PVC n'est nécessaire.
- **Aucun secret généré.** Le compte administrateur est créé de manière interactive
  via l'assistant de configuration initiale de Komga sur `/` — il n'y a ni clé
  maîtresse ni secret JWT à initialiser à l'avance.
- **Le point de terminaison de santé est `/actuator/health`.** Des tests locaux du
  conteneur ont confirmé qu'il renvoie `200 {"status":"UP"}` sans authentification.
  Le chemin versionné `/api/v1/actuator/health` exige une authentification (401) —
  n'y pointez pas les sondes.
- **Le dimensionnement du heap JVM est facultatif.** `jvm_heap_max` (vide par
  défaut) définit `-Xmx` via `JAVA_TOOL_OPTIONS`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Komga {#a-gke-autopilot--the-komga-workload}

Le pod de Komga est ordonnancé sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par le pod. Avec `stateful_pvc_enabled = true` (par défaut),
la charge de travail est un StatefulSet doté d'une identité de pod stable et de son
propre PVC.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Komga pour voir le pod, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Stockage — l'état persistant de Komga {#b-storage--komgas-persistent-state}

Par défaut, un véritable **PersistentVolumeClaim** en mode bloc est monté sur
`/config` ; il contient la base de données SQLite intégrée, l'index de recherche
Lucene, le cache des vignettes et les journaux. Si `stateful_pvc_enabled = false`,
un bucket Cloud Storage est monté à la place sur le même chemin via le pilote CSI
GCS FUSE (usage léger uniquement — voir les réserves dans
[Komga_Common](Komga_Common.md)).

- **Console :** Kubernetes Engine → Storage (PVC) ; Cloud Storage → Buckets (en mode
  GCS FUSE).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT"     # if using the GCS bucket
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les détails sur les
StorageClass.

### C. Secret Manager {#c-secret-manager}

Komga n'a aucun secret de service généré — le compte administrateur est créé via
l'assistant de configuration web. Secret Manager ne contient que les entrées que
vous ajoutez vous-même via `secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Komga {#3-komga-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a pas
  de job `db-init` — Komga exécute ses propres migrations de schéma Flyway sur la
  base SQLite intégrée au premier démarrage (confirmé par les journaux locaux du
  conteneur : `org.flywaydb.core.FlywayExecutor`,
  `Successfully validated 90 migrations`).
- **Assistant de configuration initiale.** Ouvrez l'URL du service et terminez
  l'assistant de configuration sur `/` pour créer l'utilisateur administrateur
  initial — il n'y a aucun identifiant pré-créé et aucun moyen par API ou CLI d'en
  créer un de manière non interactive.
- **Ajoutez une bibliothèque après la première connexion.** Une fois connecté,
  ajoutez une « bibliothèque » pointant vers un chemin multimédia monté et lancez
  une analyse. C'est une étape manuelle de l'opérateur ; aucun job d'initialisation
  ne la prépare.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/actuator/health` (sans authentification, `200 {"status":"UP"}` une fois prêt).
  N'utilisez **pas** `/api/v1/actuator/health` — des tests locaux ont confirmé qu'il
  renvoie `401
  Unauthorized` même lorsque l'application est entièrement saine.
- **Bibliothèque partagée unique, instance unique.** La base SQLite de Komga est un
  fichier unique sur un seul volume monté — exécuter plus d'une réplique expose à sa
  corruption par des écritures concurrentes. Conservez `max_instance_count = 1`.
- **PVC en mode bloc plutôt que GCS FUSE.** Lorsque `stateful_pvc_enabled = true`,
  `enable_gcs_storage_volume` est automatiquement défini à `false` dans
  `Komga_Common` pour éviter un double montage sur `/config`. Si le quota SSD du
  projet est limité, remplacez par `stateful_pvc_storage_class = "standard"` (HDD) —
  le profil d'accès SQLite de Komga n'a pas besoin des IOPS d'un SSD.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Komga ou notables pour Komga sont
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `komga` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image, transmis tel quel comme tag de `gotson/komga`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `gotson/komga` — sans étape de build. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; à augmenter pour de très grandes bibliothèques. |
| `min_instance_count` | `1` | Conservez `1` pour éviter les démarrages à froid pendant la reconstruction de l'index Lucene au démarrage. |
| `max_instance_count` | `1` | **Ne pas augmenter** — Komga sert une seule bibliothèque SQLite partagée. |
| `jvm_heap_max` | `""` | `-Xmx` facultatif de la JVM via `JAVA_TOOL_OPTIONS` (par ex. `"512m"`, `"1g"`). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Komga n'a pas de Cloud SQL — conservez `false`. |
| `enable_image_mirroring` | `true` | Duplique l'image Komga dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes — définissez `LoadBalancer` pour un accès externe direct. |
| `workload_type` | `null` (auto → `StatefulSet`) | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucun routage persistant requis — réplique unique. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant SIGKILL (laisse Komga vider ses écritures). |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Active un PVC en mode bloc par pod — recommandé pour Komga (gcsfuse corrompt sa base SQLite en mode WAL). Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Taille de stockage du PVC par pod — à dimensionner pour contenir la configuration, les métadonnées de la bibliothèque et la base SQLite. |
| `stateful_pvc_mount_path` | `/config` | Chemin de montage du PVC dans le conteneur — le `KOMGA_CONFIGDIR` de Komga. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass des PVC. Remplacez par `standard` (HDD) si le quota SSD est limité. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` (sûr pour Komga) ou `Parallel`. |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `3000` | `fsGroup` au niveau du pod. Komga s'exécute en tant que root, donc ce n'est pas strictement nécessaire, mais la valeur est conservée par cohérence. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans le namespace. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Nécessite un suffixe binaire (par ex. `4Gi`, `8192Mi`) lorsqu'il est activé — des entiers nus sont interprétés en octets et bloquent l'ordonnancement des pods. |
| `quota_cpu_requests` / `quota_cpu_limits` / `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | `""` | Dimensions de quota supplémentaires. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/actuator/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/actuator/health` | Sonde d'infrastructure au niveau d'App_GKE. |
| `health_check_config` | HTTP `/actuator/health` | Sonde de vivacité au niveau d'App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga n'a besoin d'aucun job d'initialisation par défaut. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés, par ex. pour des tâches de maintenance de la bibliothèque. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Komga. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` provisionné automatiquement (utilisé lorsque `stateful_pvc_enabled = false`). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires via le pilote CSI — par ex. un bucket de bibliothèque de BD/livres distinct, principalement en lecture. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours après lequel les images peuvent être supprimées. |

### Groupe 15 — Redis {#group-15--redis}

Sans objet — `enable_redis` est forcé à `false` dans `Komga_GKE`. Toutes les
variables Redis sont déclarées pour la cohérence des conventions.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Sans objet — `database_type` est fixé à `NONE`. Toutes les variables liées à la base
de données sont déclarées pour la cohérence des conventions et transmises au socle
sans effet.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à porter à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Sans objet — Komga n'a pas de base de données SQL. Déclaré uniquement pour la
cohérence des conventions.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google en amont de l'authentification propre de Komga. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour joindre Komga. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. La plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critical | Plusieurs pods écrivant simultanément dans le même fichier SQLite exposent à une corruption de la base. |
| Chemin de la sonde de santé | `/actuator/health` | Critical | `/api/v1/actuator/health` exige une authentification (401) — l'utiliser comme chemin de sonde signifie que le pod ne devient jamais Ready alors que Komga est entièrement sain. |
| `stateful_pvc_enabled` ou `enable_gcs_storage_volume` | Laissez `Komga_Common` basculer automatiquement | Critical | Activer les deux monte deux volumes sur le même chemin `/config` — un conflit de double montage. |
| `stateful_pvc_storage_class` | `standard-rwo`, remplacé par `standard` en cas de pression sur le SSD | Medium | Les PVC adossés à des SSD consomment le quota serré `SSD_TOTAL_GB` ; une campagne de mise à l'échelle à zéro peut l'épuiser. |
| Assistant de configuration initiale | À terminer rapidement après le déploiement | High | Un assistant de configuration non réclamé laisse l'instance sans compte administrateur ; la première personne qui atteint l'URL peut se l'approprier. |
| `min_instance_count` | `1` | Medium | Le redémarrage du pod unique entraîne une latence de démarrage à froid, y compris une reconstruction de l'index Lucene. |
| `memory_limit` | `1Gi`, à augmenter pour les grandes bibliothèques | Medium | Une mémoire sous-dimensionnée peut provoquer un arrêt OOM lors de l'analyse d'une grande bibliothèque. |
| `container_image_source` | `prebuilt` | Medium | Passer à `custom` sans Dockerfile fait échouer le build — Komga n'a besoin d'aucun build personnalisé. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent tout ordonnancement de pod dans le namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer le pod pendant la maintenance sans aucune protection. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Komga, partagée
avec la variante Cloud Run, est décrite dans
**[Komga_Common](Komga_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Komga sur GKE Autopilot](../labs/Komga_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Komga sur Google Cloud Run](Komga_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Komga Common — Configuration applicative partagée](Komga_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Kavita sur GKE Autopilot](Kavita_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md) et [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Digital Library**.
