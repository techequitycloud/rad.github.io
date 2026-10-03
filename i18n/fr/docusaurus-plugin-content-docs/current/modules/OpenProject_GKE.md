---
title: "OpenProject sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'OpenProject sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenProject_GKE.md @ 15fd4c7 sha256:731fb0f7d33d -->

# OpenProject sur GKE Autopilot {#openproject-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_GKE.png" alt="OpenProject sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject est une suite open source, sous licence GPLv3, de gestion de projet et
de collaboration d'équipe — paquets de travail, diagrammes de Gantt, tableaux
agiles, wikis, suivi du temps et budgets. Ce module déploie OpenProject sur
**GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services Google Cloud qu'OpenProject utilise et
sur la manière de les explorer et de les opérer depuis la console Google Cloud
et la ligne de commande. Pour les mécanismes communs à chaque application GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenProject fonctionne comme une charge de travail web Ruby on Rails (Puma). Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — OpenProject ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage des pièces jointes | Cloud Filestore (NFS) | Stockage durable des pièces jointes des paquets de travail, monté à `/opt/openproject/storage` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |
| Jobs en arrière-plan | good_job (en-processus, sur PostgreSQL) | Pas de Redis — la file d'attente des jobs se trouve dans PostgreSQL |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  empêche le démarrage.
- **Sidecar Cloud SQL Auth Proxy.** `enable_cloudsql_volume = true` sur GKE. Le proxy écoute sur
  `127.0.0.1` et la branche de bouclage du point d'entrée compose `DATABASE_URL`
  sans SSL (le proxy termine TLS).
- **Pas de Redis.** Les jobs en arrière-plan s'exécutent via `good_job` avec la
  file d'attente dans PostgreSQL (`GOOD_JOB_EXECUTION_MODE = async`) ; `enable_redis` est transféré
  comme `false`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il
  ne doit jamais être renouvelé après le premier démarrage — le renouveler rend
  chaque session existante et toutes les colonnes de base de données chiffrées
  illlisibles.
- **Les migrations s'exécutent dans un job `db-migrate`, pas au démarrage.** La
  charge de travail s'exécute en mode web uniquement (`./docker/prod/web`) ; un job
  dédié au moment de l'apply exécute `rake db:migrate db:seed` en premier, de sorte que les
  pods démarrent rapidement avec un schéma migré.
- **Les deux sondes de santé sont TCP.** Rails 8 Host Authorization `400`
  toute sonde HTTP dont l'en-tête `Host` est l'IP du pod, de sorte qu'une
  sonde TCP (écoute de port Puma) est utilisée pour le démarrage et la vivacité.
  GKE prend en charge une sonde de vivacité TCP, elle reste donc activée
  (contrairement à Cloud Run).
- **L'affinité de session est `ClientIP`** et un minimum de 1 réplica est
  maintenu (GKE n'a pas de scale-to-zero) ; un PodDisruptionBudget maintient
  les pods en service pendant les mises à niveau des nœuds.
- **Les déploiements basés sur NFS utilisent la stratégie `Recreate`** pour
  éviter que deux pods n'écrivent le même volume de pièces jointes pendant une
  mise à jour.
- **La première connexion est `admin` / `admin`.** OpenProject force un
  changement de mot de passe lors de la première connexion — faites-le
  immédiatement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenProject {#a-gke-autopilot--the-openproject-workload}

Les pods OpenProject sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail OpenProject pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OpenProject stocke toutes les données de l'application (projets, paquets de
travail, wikis, utilisateurs) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth
Proxy** sur la boucle de retour `127.0.0.1` ; aucune IP publique n'est exposée.
Lors du premier déploiement, le job `db-init` crée la base de données et
l'utilisateur, et le job `db-migrate` exécute `rake db:migrate db:seed`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et le renouvellement du mot de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Filestore (stockage NFS des pièces jointes) {#c-cloud-filestore-nfs-attachment-storage}

Les pièces jointes des paquets de travail sont stockées sur un partage NFS
**Cloud Filestore** monté à `/opt/openproject/storage` (`enable_nfs = true` par défaut) ; le module
pointe OpenProject vers celui-ci en définissant `OPENPROJECT_ATTACHMENTS__STORAGE__PATH` à `nfs_mount_path`
chaque fois que NFS est activé. Cela permet de conserver les pièces jointes
durables et partagées entre les pods.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (signature de session/cookie Rails et dérivation de clé
de colonne chiffrée). Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que
l'adresse survive aux redéploiements. OpenProject construit des URL absolues à
partir de `OPENPROJECT_HOST__NAME` et `OPENPROJECT_HTTPS`, où `OPENPROJECT_HTTPS` n'est **pas** codé en dur
sur GKE — `main.tf` définit `https_enabled = var.enable_custom_domain`, donc il n'est `true` qu'une
fois qu'un domaine personnalisé + certificat géré est configuré. Sans domaine
personnalisé, l'IP brute du LoadBalancer est uniquement HTTP ; forcer HTTPS
dans cet état redirigerait chaque requête vers une adresse `https://` qui ne
répond jamais (une panne silencieuse et totale). C'est l'opposé de `OpenProject_CloudRun`,
qui passe toujours `https_enabled = true` car une URL Cloud Run `*.run.app` est toujours
HTTPS.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenProject {#3-openproject-application-behaviour}

- **Configuration de la base de données en deux phases lors du premier
  déploiement.** Le job `db-init` (`postgres:15-alpine`) crée le rôle et la base de
  données ; le job `db-migrate` exécute ensuite l'image de l'application avec
  `rake db:migrate db:seed`. Le job de migration supprime toutes les tables partielles d'une
  tentative précédente interrompue (`DROP OWNED BY CURRENT_USER CASCADE`) avant la migration, et crée
  l'extension `pg_trgm` nécessaire aux index trigrammes d'OpenProject.
- **Les migrations ne s'exécutent pas au démarrage.** La charge de travail
  s'exécute en mode web uniquement (`./docker/prod/web`), ce qui ignore le seeder
  tout-en-un. Rails (production) refuse de démarrer Puma tant que des
  migrations sont en attente, donc si `db-migrate` échoue, l'apply échoue
  bruyamment sur le garde de migration en attente — il n'y a pas de
  déploiement silencieux de base de données vide.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une
  seule fois et stocké dans Secret Manager. Le modifier rend les sessions
  existantes et toutes les colonnes chiffrées illisibles. Ne le renouvelez que
  pendant une fenêtre de maintenance planifiée.
- **Les jobs en arrière-plan s'exécutent en-processus.** `good_job` exécute
  son worker et son cron à l'intérieur de chaque pod (`GOOD_JOB_EXECUTION_MODE = async`) avec la
  file d'attente sur PostgreSQL — pas de Redis.
- **Host Authorization protège les sondes de santé.** Rails 8 renvoie `400 Invalid host_name`
  à toute requête dont l'en-tête `Host` n'est pas `OPENPROJECT_HOST__NAME`, y compris
  les sondes de santé HTTP du kubelet (qui utilisent l'IP du pod). Les sondes
  de démarrage et de vivacité sont donc TCP ; la sonde de disponibilité
  atteint `/health_checks/default`.
- **La première connexion est `admin` / `admin`.** Amorcée par `rake db:seed`.
  OpenProject force un changement de mot de passe lors de la première connexion.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
OpenProject sont listés ; toutes les autres entrées sont héritées de
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
| `application_name` | `openproject` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenProject` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image OpenProject (`OPENPROJECT_VERSION`). `latest` est épinglé à la version majeure stable `16` ; épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (GKE n'a pas de scale-to-zero). |
| `max_instance_count` | `5` | Nombre maximal de réplicas (limite supérieure HPA). |
| `container_port` | `8080` | Port de liaison par défaut de Puma ; le module exécute `./docker/prod/web` (Puma directement), contournant le proxy Apache de l'image tout-en-un sur le port 80. |
| `container_resources` | `2000m` / `4Gi` | Limites et requêtes CPU/mémoire. Rails a besoin de marge pour les migrations et les workers. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (connexion en boucle). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image OpenProject dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (remplacements `OPENPROJECT_*`). Ne définissez pas `SECRET_KEY_BASE` ou `DATABASE_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (Déploiement) | `Deployment` (par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions d'interface utilisateur. |
| `network_tags` | `["nfsserver"]` | Tags réseau de nœud/pod ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Activer les modèles PVC. Non requis — les pièces jointes utilisent NFS. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du conteneur pour le PVC. |
| `stateful_pvc_storage_class` | `standard-rwo` | Kubernetes StorageClass pour les PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |
| `enable_resource_quota` | `false` | Appliquer un ResourceQuota d'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(défini)_ | Quota de mémoire de l'espace de noms — doit utiliser des unités binaires (`4Gi`, `8192Mi`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, délai de 30s, fenêtre de 30 × 15s | TCP car Rails Host Authorization `400` les sondes HTTP ; vérifie que Puma écoute. |
| `liveness_probe` | **TCP**, délai de 90s | TCP pour qu'un Puma sain reste en vie (GKE prend en charge la vivacité TCP). |
| `startup_probe_config` | _(défini)_ | Sonde d'infrastructure de niveau App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs intégrés `db-init` + `db-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés avec OpenProject. |

### Groupe 12 — Intégration CI/CD et GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Cloud Filestore pour le stockage durable des pièces jointes. |
| `nfs_mount_path` | `/opt/openproject/storage` | Chemin des pièces jointes OpenProject à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste si vous en avez besoin de plus. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `openproject` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
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
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre OpenProject. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `db-migrate`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un réplica
> en lecture sans son primaire, IAP sans identités autorisées, une charge de
> travail `Deployment` avec `stateful_pvc_enabled = true`, un entier nu `quota_memory_*`, une valeur
> hors plage `backup_retention_days`. Une configuration invalide échoue à la
> **planification** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler rend chaque session existante et toutes les colonnes de base de données chiffrées illisibles. |
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Le désactiver place les pièces jointes sur un stockage de pod éphémère — elles sont perdues lorsqu'un pod est replanifié. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `startup_probe.type` / `liveness_probe.type` | `TCP` | Élevé | Une sonde HTTP atteint Rails Host Authorization (`400 Invalid host_name`, Host = IP du pod) et ne passe jamais — un pod sain ne devient jamais prêt, ou un pod sain TCP redémarre en boucle. |
| `enable_cloudsql_volume` | `true` sur GKE | Élevé | Le sidecar Auth Proxy fournit la connexion PostgreSQL en boucle ; le désactiver est bloqué par un garde de validation au moment de la planification. |
| `memory_limit` (via `container_resources`) | `4Gi` | Élevé | Les migrations et les workers en-processus OOM en dessous de ~2 GiB. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; le garde de validation rejette les valeurs invalides. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions d'interface utilisateur peuvent être acheminées vers différents pods entre les requêtes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'expulser tous les pods simultanément pendant la maintenance — avec NFS `Recreate`, cela interrompt le service. |
| `application_version` | Épingler une version majeure (`16`) | Moyen | `latest` n'a pas de tag d'image sur Docker Hub ; le module l'épingle à `16`. Épinglez explicitement pour contrôler les mises à niveau. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
OpenProject partagée avec la variante Cloud Run est décrite dans
**[OpenProject_Common](OpenProject_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenProject sur GKE Autopilot](../labs/OpenProject_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenProject Common — Configuration d'application partagée](OpenProject_Common.md) — la configuration partagée par les deux cibles de déploiement.
