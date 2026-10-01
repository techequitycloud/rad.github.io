---
title: "Vikunja sur GKE Autopilot"
description: "Référence de configuration pour déployer Vikunja sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Vikunja_GKE.md @ 3055034 sha256:c91aca2743e1 -->

# Vikunja sur GKE Autopilot {#vikunja-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vikunja_GKE.png" alt="Vikunja sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vikunja est une application open source et auto-hébergée de gestion de tâches et de projets —
listes, tableaux kanban, diagrammes de Gantt, calendriers, rappels et partage en équipe, via une
API REST et une interface web. Ce module déploie Vikunja sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Vikunja et sur la manière de les explorer et
de les exploiter depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Vikunja s'exécute en tant que charge de travail web Go. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Fonction | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go, 1 vCPU / 512 MiB par défaut, réplica unique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Vikunja ne prend pas en charge MySQL dans ce module |
| Build du conteneur | Cloud Build + Artifact Registry | Enveloppe l'image amont `scratch` avec un busybox greffé |
| Secrets | Secret Manager | `VIKUNJA_SERVICE_JWTSECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Le pod se connecte à Cloud SQL via la boucle locale du proxy avec `sslmode=disable`.**
  Sur GKE, le sidecar Cloud SQL Auth Proxy écoute sur `127.0.0.1` (en clair) ; le
  point d'entrée désactive donc SSL. Le même point d'entrée exige SSL via l'IP privée sur
  Cloud Run — il choisit selon que l'hôte résolu est la boucle locale.
- **L'image est basée sur `scratch` et reçoit une greffe busybox.** L'image amont
  `vikunja/vikunja` ne contient pas de shell ; le build personnalisé y copie donc un busybox
  statique pour exécuter le point d'entrée. `container_image_source` vaut `"custom"` par défaut.
- **`VIKUNJA_SERVICE_JWTSECRET` est généré automatiquement** et stocké dans Secret
  Manager. Le renouveler après le premier démarrage invalide toutes les sessions utilisateur actives.
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`)
  avec `session_affinity = None`. Vikunja n'a aucune coordination multi-réplica intégrée.
- **Un PodDisruptionBudget maintient le pod en service** pendant les mises à niveau des nœuds
  (`enable_pod_disruption_budget = true`).
- **NFS est désactivé par défaut.** Vikunja stocke ses données dans PostgreSQL ; n'activez NFS que
  si vous avez besoin de pièces jointes durables dans `/app/vikunja/files`.
- **Un domaine personnalisé + une IP statique sont activés par défaut** (`enable_custom_domain = true`,
  `reserve_static_ip = true`) afin que l'adresse externe survive aux redéploiements.
- **Quelques variables de la fondation sont déclarées mais inopérantes.** `db_host_env_var_name`,
  `db_name_env_var_name`, `db_password_env_var_name`, `db_port_env_var_name`,
  `db_user_env_var_name`, `redis_auth`, `extra_service_ports`, `sql_instance_name`,
  `sql_instance_base_name`, `network_name`, `gke_cluster_selection_mode`,
  `prereq_gke_subnet_cidr`, `binauthz_evaluation_mode`, `explicit_secret_values` et
  `scripts_dir` sont reproduites dans `variables.tf` uniquement pour satisfaire les contrôles de convention —
  le `main.tf` de ce module ne les transmet pas ; les définir n'a donc aucun effet.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Vikunja {#a-gke-autopilot--the-vikunja-workload}

Les pods Vikunja sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Vikunja pour voir
  les pods et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type
de charge de travail (`Deployment` ou `StatefulSet`).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Vikunja stocke toutes les données de l'application (tâches, projets, tableaux, utilisateurs, équipes) dans une
instance gérée Cloud SQL for PostgreSQL 15. Les pods l'atteignent de manière privée via le
sidecar **Cloud SQL Auth Proxy** par la boucle locale (`127.0.0.1`, `sslmode=disable`) ; aucune
IP publique n'est exposée. Lors du premier déploiement, un Job d'initialisation crée la base de données
et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et le renouvellement
du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Build et Artifact Registry {#c-cloud-build--artifact-registry}

Comme l'image amont de Vikunja est basée sur `scratch`, le module construit une image
d'enveloppe via Cloud Build (en y greffant un busybox statique et le point d'entrée) et la pousse
vers Artifact Registry. App_GKE impose `imagePullPolicy=Always` pour l'image
personnalisée, de sorte qu'un rebuild suivi d'un redéploiement récupère toujours des couches à jour.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`VIKUNJA_SERVICE_JWTSECRET` (utilisé pour signer les JWT de session des utilisateurs). Le mot de passe de la base de données
est géré séparément par la fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et le renouvellement.

### E. Cloud Storage et pièces jointes (facultatif) {#e-cloud-storage--file-attachments-optional}

Vikunja stocke les pièces jointes sur le système de fichiers du pod dans `/app/vikunja/files`.
Activez NFS (`enable_nfs = true`) et montez-le sur ce chemin pour des pièces jointes
durables ; le module ne déclare aucun bucket GCS dédié par défaut
(`storage_buckets = []`). Les applications GKE adossées à NFS sont déployées avec la stratégie `Recreate`
pour éviter que deux pods se disputent le même volume.

- **Console :** Filestore / Compute Engine (VM NFS) lorsque `enable_nfs = true`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK (`manage_storage_kms_iam`,
`enable_artifact_registry_cmek`) et les montages GCS Fuse (`gcs_volumes`).

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique
est réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Vikunja {#3-vikunja-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `create-db-and-user.sh`
  avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données et le rôle de l'application, puis accorde les privilèges. Le
  job peut être relancé sans risque.
- **Migrations du schéma au démarrage.** Vikunja applique automatiquement ses propres migrations de schéma
  au premier démarrage de l'application — le job `db-init` ne provisionne
  qu'une base de données vide ; prévoyez donc un délai supplémentaire pour que le premier pod passe à l'état Ready.
- **`VIKUNJA_SERVICE_JWTSECRET` est immuable après le premier démarrage.** Il est généré une seule fois
  et écrit dans Secret Manager. Le modifier invalide toutes les sessions utilisateur actives.
  Ne le renouvelez que pendant une fenêtre de maintenance planifiée.
- **Le premier compte enregistré devient le propriétaire.** Vikunja ne fournit aucun administrateur pré-créé.
  Ouvrez l'URL externe et inscrivez-vous — le premier compte possède l'instance. Définissez ensuite
  `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"` dans `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` — un point de terminaison public
  et non authentifié qui renvoie 200 dès que le serveur s'est lié à son port.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement (les
tags `{{UIMeta group=N}}` dans `variables.tf`). Seuls les paramètres propres à Vikunja ou notables
pour lui sont listés dans chaque tableau ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

Métadonnées standard de la plateforme (`module_description`, `module_documentation`,
`module_dependency`, `requires_services`, `module_services`, `credit_cost`,
`require_credit_purchases`, `enable_purge`, `public_access`,
`require_services_gcp_module`, `shared_users`, `technical_support_users`,
`resource_creator_identity`, `impersonation_service_account`,
`job_execution_wait_timeout`), plus deux variables déclarées mais **non référencées** par
ce module — `explicit_secret_values` et `scripts_dir`. `credit_cost` vaut par défaut
`75`, comme pour la variante Cloud Run.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vikunja` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Vikunja` | Nom lisible affiché dans la Console. |
| `application_description` | `Vikunja task manager on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Vikunja ; `latest` construit une version récente épinglée (`2.3.0`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'enveloppe avec greffe busybox via Cloud Build. |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour le chemin AR dérivé automatiquement. |
| `container_build_config` | `{ enabled = true }` | Dockerfile/contexte du build personnalisé. |
| `enable_image_mirroring` | `true` | Duplique l'image d'enveloppe dans Artifact Registry. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Réplica unique — Vikunja n'a aucune coordination multi-réplica. |
| `container_port` | `3456` | Port sur lequel écoute le serveur Go de Vikunja. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites et demandes de CPU/mémoire. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (boucle locale `127.0.0.1`). |
| `workload_type` | `Deployment` | Deployment sans état (StatefulSet inutile — l'état réside dans PostgreSQL). |

Également dans ce groupe, avec le comportement standard d'App_GKE : `enable_vertical_pod_autoscaling`
(`false`), `container_protocol` (`http1`), `timeout_seconds` (`300`),
`cloudsql_volume_mount_path` (`/cloudsql`), `service_annotations` / `service_labels`
(`{}`).

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une authentification par identité Google avant d'atteindre Vikunja. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Identités autorisées à accéder via IAP. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Identifiants OAuth 2.0. Requis ensemble lorsque `enable_iap = true`. |
| `iap_support_email` | `""` | Adresse e-mail de support affichée sur l'écran de consentement IAP. |

### Groupe 6 — Cluster GKE, réseau et variables d'environnement {#group-6--gke-cluster-networking--environment-variables}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `VIKUNJA_*` supplémentaires. Ne définissez pas `VIKUNJA_DATABASE_*` ni `VIKUNJA_SERVICE_JWTSECRET` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `gke_cluster_name` | `""` | Cluster cible ; laissez vide pour découvrir automatiquement le cluster `Services_GCP`. |
| `namespace_name` | `""` | Namespace Kubernetes ; laissez vide pour le générer automatiquement. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `None` | Routage persistant (`ClientIP`) ou `None`. |
| `network_tags` | `[]` | Tags réseau des nœuds/pods pour le ciblage des règles de pare-feu. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

`gke_cluster_selection_mode` et `prereq_gke_subnet_cidr` sont déclarées par souci de
cohérence avec la convention et ne sont **pas référencées**. `extra_service_ports` est déclarée mais
**n'est pas transmise** par ce module ; la définir n'a donc aucun effet. Également dans ce groupe,
avec le comportement standard d'App_GKE : `secret_rotation_period` (`2592000s`),
`secret_propagation_delay` (`30`), `enable_multi_cluster_service` (`false`),
`configure_service_mesh` (`false`), `termination_grace_period_seconds` (`30`),
`deployment_timeout` (`600`) et `prereq_subnet_cidr_override` (`""`, à définir uniquement pour
figer le CIDR du sous-réseau VPC intégré sur un déploiement existant).

### Groupe 7 — Sauvegardes et configuration StatefulSet {#group-7--backups--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes Cloud SQL automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |

`stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group` —
modèles de PVC StatefulSet. Non recommandés pour Vikunja ; l'état réside dans PostgreSQL.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`,
`quota_memory_requests`, `quota_memory_limits` — ResourceQuota du namespace. Les valeurs
de mémoire exigent des suffixes d'unités binaires (p. ex. `"4Gi"`).

### Groupe 9 — Scripts SQL personnalisés et règles de fiabilité {#group-9--custom-sql-scripts--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Répartit les pods entre les zones. |

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécution facultative de scripts SQL sur la base de données
après le provisionnement.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai de 30s, fenêtre d'échec de 30 × 10s | Sonde de démarrage ; large fenêtre de nouvelles tentatives pour les migrations du premier démarrage. |
| `health_check_config` | HTTP `/health`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/health` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Vikunja. |

### Groupe 12 — CI/CD, GitHub et Binary Authorization {#group-12--cicd-github--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `github_app_installation_id`, `cicd_trigger_config`,
`enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.
`binauthz_evaluation_mode` est déclarée par souci de cohérence avec la convention et n'est **pas
référencée**.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | À activer pour des pièces jointes durables dans `/app/vikunja/files`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume du montage. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | VM NFS existante à réutiliser, ou nom de base d'une VM intégrée. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires. |
| `storage_buckets` | `[]` | Vikunja ne déclare aucun bucket par défaut. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours après lequel les images peuvent être supprimées. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Vikunja n'utilise pas Redis ; fournie par souci de cohérence avec la convention de la fondation. |
| `redis_host` / `redis_port` | `""` / `6379` | Détails de connexion Redis, pertinents uniquement si `enable_redis = true`. |

`redis_auth` est déclarée mais **n'est pas transmise** par ce module ; la définir n'a donc aucun
effet.

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Moteur Cloud SQL ; fixé à PostgreSQL 15 par `Vikunja_Common` quelle que soit cette valeur. |
| `application_database_name` | `vikunja` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `vikunja` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Renouvellement du mot de passe de la base de données sans interruption. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après le renouvellement avant de redémarrer les pods. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installation facultative d'extensions PostgreSQL. |

`enable_mysql_plugins` / `mysql_plugins` ne s'appliquent pas à Vikunja (PostgreSQL
uniquement). `sql_instance_name`, `sql_instance_base_name` et l'ensemble `db_*_env_var_name`
(`db_host_env_var_name`, `db_name_env_var_name`, `db_password_env_var_name`,
`db_port_env_var_name`, `db_user_env_var_name`) sont déclarés par souci de cohérence avec la convention
et ne sont **ni référencés ni transmis** par ce module.

### Groupe 17 — Import / restauration de sauvegarde {#group-17--backup-import--restore}

`enable_backup_import`, `backup_source`, `backup_file`, `backup_format` — restaurent
la base de données de l'application depuis un fichier de sauvegarde lors du déploiement.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `static_ip_name` | `""` | Nom de l'IP statique ; laissez vide pour le générer automatiquement. |

`network_name` est déclarée par souci de cohérence avec la convention et n'est **pas référencée** (le
réseau est découvert automatiquement).

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
associent un WAF Cloud Armor et Cloud CDN au backend de l'Ingress GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`,
`enable_audit_logging` — appliquent un périmètre VPC-SC et des Cloud Audit Logs détaillés.

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Vikunja. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
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

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, une incohérence `StatefulSet`/`Deployment`, des valeurs de quota mémoire sans suffixes binaires, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `VIKUNJA_SERVICE_JWTSECRET` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critical | Le renouveler invalide toutes les sessions utilisateur actives et force chacun à se reconnecter immédiatement. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans source/fichier de sauvegarde valide fait échouer le job d'import. |
| `enable_nfs` (pour les pièces jointes) | `true` si les pièces jointes comptent | High | Sans NFS, les pièces jointes résident sur le disque éphémère du pod et sont perdues à chaque redémarrage du pod. |
| `container_image_source` | `custom` | High | `prebuilt` déploie l'image `scratch` brute sans shell ni mappage du point d'entrée — le conteneur ne peut pas mapper `DB_*` et échoue. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `min_instance_count` | `1` | Medium | La validation propre à la variable autorise `0`–`1000` et aucune garde au moment du plan ne rejette `0` — la logique de Deployment d'App_GKE convertit silencieusement `min_instance_count=0` en `min_replicas` de `1` lors de l'application (`local.min_instance_count > 0 ? local.min_instance_count : 1`) ; le nombre de réplicas déployé s'écarte donc silencieusement de la configuration au lieu d'échouer avec une erreur. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (variable d'environnement) | `"false"` après le premier administrateur | High | Laisser l'inscription ouverte permet à toute personne disposant de l'URL de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés en octets et bloquent toute planification de pods dans le namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer le pod pendant la maintenance sans aucune garantie de disponibilité. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |
| `db_*_env_var_name`, `redis_auth`, `extra_service_ports`, `sql_instance_name`/`sql_instance_base_name`, `network_name`, `gke_cluster_selection_mode`, `prereq_gke_subnet_cidr`, `binauthz_evaluation_mode` | Laisser la valeur par défaut | Low | Déclarées par souci de cohérence avec la convention de la fondation, mais ni transmises ni référencées par ce module — les définir n'a aucun effet sur le déploiement. |

---

Pour le comportement de la fondation mentionné tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Vikunja partagée
avec la variante Cloud Run est décrite dans
**[Vikunja_Common](Vikunja_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Vikunja sur GKE Autopilot](../labs/Vikunja_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vikunja Common — Configuration applicative partagée](Vikunja_Common.md) — la configuration partagée par les deux cibles de déploiement.
