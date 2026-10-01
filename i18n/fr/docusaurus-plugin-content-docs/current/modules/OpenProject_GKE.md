---
title: "OpenProject sur GKE Autopilot"
description: "Référence de configuration pour déployer OpenProject sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenProject_GKE.md @ 3055034 sha256:cf8b82ec05de -->

# OpenProject sur GKE Autopilot {#openproject-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_GKE.png" alt="OpenProject sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject est une suite open source, sous licence GPLv3, de gestion de projet et de
collaboration d'équipe — lots de travaux, diagrammes de Gantt, tableaux agiles, wikis,
suivi du temps et budgets. Ce module déploie OpenProject sur **GKE Autopilot** au-dessus
de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise OpenProject et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenProject s'exécute comme une charge de travail web Ruby on Rails (Puma). Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — OpenProject ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage des pièces jointes | Cloud Filestore (NFS) | Stockage durable des pièces jointes des lots de travaux, monté sur `/opt/openproject/storage` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |
| Jobs en arrière-plan | good_job (dans le processus, sur PostgreSQL) | Pas de Redis — la file d'attente des jobs réside dans PostgreSQL |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la couche
  applicative partagée ; sélectionner un autre moteur empêche le démarrage.
- **Sidecar Cloud SQL Auth Proxy.** `enable_cloudsql_volume = true` sur GKE. Le proxy
  écoute sur `127.0.0.1` et la branche loopback du point d'entrée compose `DATABASE_URL`
  sans SSL (le proxy termine le TLS).
- **Pas de Redis.** Les jobs en arrière-plan s'exécutent via `good_job` avec la file
  d'attente dans PostgreSQL (`GOOD_JOB_EXECUTION_MODE = async`) ; `enable_redis` est
  transmis à `false`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il ne
  doit jamais faire l'objet d'une rotation après le premier démarrage — sa rotation rend
  illisibles toutes les sessions existantes et toutes les colonnes chiffrées de la base de
  données.
- **Les migrations s'exécutent dans un job `db-migrate`, pas au démarrage.** La charge de
  travail s'exécute en mode web uniquement (`./docker/prod/web`) ; un job dédié exécuté au
  moment de l'apply lance d'abord `rake db:migrate db:seed`, de sorte que les pods
  démarrent rapidement sur un schéma déjà migré.
- **Les deux sondes de santé sont en TCP.** Le Host Authorization de Rails 8 renvoie `400`
  à toute sonde HTTP dont l'en-tête `Host` est l'adresse IP du pod ; une sonde TCP (Puma à
  l'écoute sur le port) est donc utilisée à la fois pour le démarrage et pour la vivacité.
  GKE prend en charge une sonde de vivacité TCP, qui reste donc activée (contrairement à
  Cloud Run).
- **L'affinité de session est `ClientIP`** et au moins 1 réplica est maintenue (GKE ne
  propose pas de réduction à zéro) ; un PodDisruptionBudget maintient les pods en service
  pendant les mises à niveau des nœuds.
- **Les déploiements progressifs adossés au NFS utilisent la stratégie `Recreate`** afin
  d'éviter que deux pods n'écrivent sur le même volume de pièces jointes pendant une mise à
  jour.
- **La première connexion se fait avec `admin` / `admin`.** OpenProject impose un
  changement de mot de passe à la première connexion — faites-le immédiatement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail OpenProject {#a-gke-autopilot--the-openproject-workload}

Les pods OpenProject sont planifiés sur Autopilot, qui facture le CPU et la mémoire que
les pods demandent réellement. Le Horizontal Pod Autoscaling dimensionne le déploiement
entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  OpenProject pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, le
dimensionnement et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OpenProject stocke toutes les données de l'application (projets, lots de travaux, wikis,
utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de
manière privée via le sidecar **Cloud SQL Auth Proxy** sur l'interface loopback
`127.0.0.1` ; aucune adresse IP publique n'est exposée. Lors du premier déploiement, le
job `db-init` crée la base de données et l'utilisateur, et le job `db-migrate` exécute
`rake db:migrate db:seed`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous indiqués dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Filestore (stockage NFS des pièces jointes) {#c-cloud-filestore-nfs-attachment-storage}

Les pièces jointes des lots de travaux sont stockées sur un partage NFS **Cloud
Filestore** monté sur `/opt/openproject/storage` (`enable_nfs = true` par défaut). Les
pièces jointes restent ainsi durables et partagées entre les pods.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`SECRET_KEY_BASE` (signature des sessions/cookies Rails et dérivation de la clé des
colonnes chiffrées). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI
et la rotation.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré
par Google peut être activé, et une adresse IP statique peut être réservée afin que
l'adresse survive aux redéploiements. OpenProject construit les URL absolues à partir de
`OPENPROJECT_HOST__NAME` et de `OPENPROJECT_HTTPS`, où `OPENPROJECT_HTTPS` n'est **pas**
imposé en dur sur GKE — `main.tf` définit `https_enabled = var.enable_custom_domain`, si
bien qu'il ne vaut `true` qu'une fois un domaine personnalisé et un certificat géré
configurés. Sans domaine personnalisé, l'adresse IP brute du LoadBalancer n'est accessible
qu'en HTTP simple ; forcer le HTTPS dans cet état redirigerait de force chaque requête vers
une adresse `https://` qui ne répond jamais (une panne totale et silencieuse). C'est
l'inverse d'`OpenProject_CloudRun`, qui transmet toujours `https_enabled = true` car une
URL Cloud Run `*.run.app` est toujours en HTTPS.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur les adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques de GKE et
de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application OpenProject {#3-openproject-application-behaviour}

- **Configuration de la base de données en deux phases au premier déploiement.** Le job
  `db-init` (`postgres:15-alpine`) crée le rôle et la base de données ; le job
  `db-migrate` exécute ensuite l'image de l'application avec `rake db:migrate db:seed`. Le
  job de migration supprime les éventuelles tables partielles laissées par une tentative
  précédente interrompue (`DROP OWNED BY CURRENT_USER CASCADE`) avant de migrer, et crée
  l'extension `pg_trgm` nécessaire aux index trigrammes d'OpenProject.
- **Les migrations ne s'exécutent pas au démarrage.** La charge de travail s'exécute en
  mode web uniquement (`./docker/prod/web`), ce qui ignore le seeder tout-en-un. Rails (en
  production) refuse de démarrer Puma tant que des migrations sont en attente ; si
  `db-migrate` échoue, l'apply échoue donc de manière visible sur la protection contre les
  migrations en attente — aucune mise en production silencieuse avec une base de données
  vide.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une seule
  fois et stocké dans Secret Manager. Le modifier rend illisibles les sessions existantes et
  toutes les colonnes chiffrées. N'effectuez de rotation que pendant une fenêtre de
  maintenance planifiée.
- **Les jobs en arrière-plan s'exécutent dans le processus.** `good_job` exécute son worker
  et son cron dans chaque pod (`GOOD_JOB_EXECUTION_MODE = async`) avec la file d'attente
  sur PostgreSQL — sans Redis.
- **Le Host Authorization filtre les sondes de santé.** Rails 8 renvoie
  `400 Invalid host_name` à toute requête dont l'en-tête `Host` n'est pas
  `OPENPROJECT_HOST__NAME`, y compris les sondes de santé HTTP du kubelet (qui utilisent
  l'adresse IP du pod). Les sondes de démarrage et de vivacité sont donc toutes deux en
  TCP ; la sonde de disponibilité interroge `/health_checks/default`.
- **La première connexion se fait avec `admin` / `admin`.** Ce compte est créé par
  `rake db:seed`. OpenProject impose un changement de mot de passe à la première connexion.
- **Inspectez l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à OpenProject ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

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
| `application_name` | `openproject` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `OpenProject` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image OpenProject (`OPENPROJECT_VERSION`). `latest` est épinglé sur la version majeure stable `16` ; épinglez explicitement une version en production. |

### Groupe 4 — Exécution et dimensionnement {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (GKE ne propose pas de réduction à zéro). |
| `max_instance_count` | `5` | Nombre maximal de réplicas (limite supérieure du HPA). |
| `container_port` | `8080` | Port d'écoute par défaut de Puma ; le module exécute `./docker/prod/web` (Puma directement), en contournant le proxy Apache de l'image tout-en-un sur le port 80. |
| `container_resources` | `2000m` / `4Gi` | Limites et demandes de CPU/mémoire. Rails a besoin de marge pour les migrations et les workers. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (connexion en loopback). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_image_mirroring` | `true` | Met en miroir l'image OpenProject dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (remplacements `OPENPROJECT_*`). Ne définissez pas `SECRET_KEY_BASE` ni `DATABASE_URL` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (Deployment) | `Deployment` (par défaut) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions de l'interface. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC. Non requis — les pièces jointes utilisent le NFS. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |
| `enable_resource_quota` | `false` | Impose un ResourceQuota à l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(définies)_ | Quota de mémoire de l'espace de noms — doit utiliser des unités binaires (`4Gi`, `8192Mi`). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, délai de 30s, fenêtre de 30 × 15s | TCP car le Host Authorization de Rails renvoie `400` aux sondes HTTP ; vérifie que Puma écoute. |
| `liveness_probe` | **TCP**, délai de 90s | TCP afin qu'un Puma sain reste actif (GKE prend en charge la vivacité TCP). |
| `startup_probe_config` | _(définie)_ | Sonde d'infrastructure au niveau d'App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` + `db-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés d'OpenProject. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Cloud Filestore pour un stockage durable des pièces jointes. |
| `nfs_mount_path` | `/opt/openproject/storage` | Chemin des pièces jointes d'OpenProject dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; complétez la liste si vous en avez besoin d'autres. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours après lesquels les images deviennent éligibles à la suppression. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `openproject` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, adresse IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré (une Gateway avec une adresse IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

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
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à OpenProject. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `db-migrate`) et d'import (facultatif). |
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

> Risque : **Critical** (critique : perte de données / panne / sécurité) — **High** (élevé :
> service dégradé) — **Medium** (moyen : coût ou dégradation partielle) — **Low** (faible :
> mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une réplique en lecture sans son instance principale, IAP sans identités autorisées, une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, un `quota_memory_*` en entier sans unité, un `backup_retention_days` hors limites. Une configuration non valide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation rend illisibles toutes les sessions existantes et toutes les colonnes chiffrées de la base de données. |
| `application_database_name` / `application_database_user` | Définis une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critical | Le désactiver place les pièces jointes sur le stockage éphémère du pod — elles sont perdues lorsqu'un pod est replanifié. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `startup_probe.type` / `liveness_probe.type` | `TCP` | High | Une sonde HTTP se heurte au Host Authorization de Rails (`400 Invalid host_name`, Host = adresse IP du pod) et ne réussit jamais — un pod sain ne devient jamais Ready, ou un pod sain en TCP redémarre en boucle. |
| `enable_cloudsql_volume` | `true` sur GKE | High | Le sidecar Auth Proxy fournit la connexion PostgreSQL en loopback ; sa désactivation est bloquée par une protection de validation au moment du plan. |
| `memory_limit` (via `container_resources`) | `4Gi` | High | Les migrations et les workers dans le processus subissent des arrêts OOM en dessous d'environ 2 GiB. |
| `min_instance_count` | `1` | High | GKE exige min ≥ 1 ; la protection de validation rejette les valeurs non valides. |
| `session_affinity` | `ClientIP` | Medium | Sans persistance, les sessions de l'interface peuvent être acheminées vers des pods différents d'une requête à l'autre. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers sans unité sont des octets et bloquent toute planification des pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance — avec la stratégie NFS `Recreate`, le service tombe. |
| `application_version` | Épingler une version majeure (`16`) | Medium | `latest` n'a pas de tag d'image sur Docker Hub ; le module l'épingle sur `16`. Épinglez explicitement une version pour maîtriser les mises à niveau. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme. |

---

Pour le comportement de la fondation mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à OpenProject partagée avec
la variante Cloud Run est décrite dans
**[OpenProject_Common](OpenProject_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenProject sur GKE Autopilot](../labs/OpenProject_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenProject Common — Configuration applicative partagée](OpenProject_Common.md) — la configuration partagée par les deux cibles de déploiement.
