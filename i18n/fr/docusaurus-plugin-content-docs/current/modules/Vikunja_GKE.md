---
title: "Vikunja sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Vikunja sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Vikunja_GKE.md @ 15fd4c7 sha256:51799e6c04cd -->

# Vikunja sur GKE Autopilot {#vikunja-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vikunja_GKE.png" alt="Vikunja sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vikunja est une application open-source auto-hébergée de gestion de tâches et de
projets — listes, tableaux kanban, diagrammes de Gantt, calendriers, rappels et
partage d'équipe via une API REST et une interface utilisateur web. Ce module
déploie Vikunja sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Vikunja et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Vikunja s'exécute comme une charge de travail web Go. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go, 1 vCPU / 512 MiB par défaut, réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Vikunja ne prend pas en charge MySQL dans ce module |
| Build de conteneur | Cloud Build + Artifact Registry | Encapsule l'image amont `scratch` avec un busybox greffé |
| Secrets | Secret Manager | `VIKUNJA_SERVICE_JWTSECRET` auto-généré ; mot de passe de la base de données |
| Pièces jointes | PVC de bloc (StatefulSet) | PVC par pod à `/data`, où `VIKUNJA_FILES_BASEPATH` pointe |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur interrompt le
  démarrage.
- **Le pod se connecte à Cloud SQL via la boucle de rappel du proxy avec `sslmode=disable`.**
  Sur GKE, le sidecar Cloud SQL Auth Proxy écoute sur `127.0.0.1` (texte brut),
  donc le point d'entrée désactive SSL. Le même point d'entrée nécessite SSL sur
  l'IP privée sur Cloud Run — il se ramifie selon que l'hôte résolu est en
  boucle de rappel.
- **L'image est basée sur `scratch` et reçoit une greffe busybox.** L'image
  amont `vikunja/vikunja` n'a pas de shell, donc la build personnalisée copie un
  busybox statique pour exécuter le point d'entrée. `container_image_source` est par défaut
  `"custom"`.
- **`VIKUNJA_SERVICE_JWTSECRET` est généré automatiquement** et stocké dans Secret
  Manager. Le faire pivoter après le premier démarrage invalide toutes les
  sessions utilisateur actives.
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`)
  avec `session_affinity = None`. Vikunja n'a pas de coordination multi-réplicas intégrée.
- **Un PodDisruptionBudget maintient le pod en service** pendant les mises à
  niveau de nœuds (`enable_pod_disruption_budget = true`).
- **Les pièces jointes résident sur un PVC de bloc.** Les tâches, projets et
  utilisateurs sont dans PostgreSQL ; les pièces jointes sont écrites dans
  `/data` (`VIKUNJA_FILES_BASEPATH` suit `stateful_pvc_mount_path`),
  que `stateful_pvc_enabled = true` (par défaut) sauvegarde avec un PVC par pod, de sorte que la
  charge de travail se résout en un StatefulSet. `stateful_fs_group = 1000` rend le volume
  accessible en écriture par l'utilisateur de Vikunja. NFS est désactivé par
  défaut.
- **Un domaine personnalisé + une IP statique sont activés par défaut**
  (`enable_custom_domain = true`, `reserve_static_ip = true`) afin que l'adresse externe survive aux
  redéploiements.
- **Quelques variables de la Fondation sont déclarées mais inertes.** `db_host_env_var_name`,
  `db_name_env_var_name`, `db_password_env_var_name`, `db_port_env_var_name`,
  `db_user_env_var_name`, `redis_auth`, `extra_service_ports`, `sql_instance_name`,
  `sql_instance_base_name`, `network_name`, `gke_cluster_selection_mode`,
  `prereq_gke_subnet_cidr`, `binauthz_evaluation_mode`, `explicit_secret_values`, et
  `scripts_dir` sont reflétées dans `variables.tf` uniquement pour satisfaire
  les vérifications de convention — le `main.tf` de ce module ne les
  transmet pas, donc les définir n'a aucun effet.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Vikunja {#a-gke-autopilot--the-vikunja-workload}

Les pods Vikunja sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Vikunja pour voir les pods et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (`Deployment` vs `StatefulSet`).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Vikunja stocke toutes les données d'application (tâches, projets, tableaux,
utilisateurs, équipes) dans une instance gérée de Cloud SQL pour PostgreSQL 15.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** en
boucle de rappel (`127.0.0.1`, `sslmode=disable`) ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de
données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_GKE](App_GKE.md).

### C. Cloud Build et Artifact Registry {#c-cloud-build--artifact-registry}

Étant donné que l'image Vikunja amont est basée sur `scratch`, le module
construit une image wrapper via Cloud Build (en greffant un busybox statique et
le point d'entrée) et la pousse vers Artifact Registry. App_GKE force
`imagePullPolicy=Always` pour l'image personnalisée afin qu'un rebuild-redeploy tire
toujours de nouvelles couches.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `VIKUNJA_SERVICE_JWTSECRET` (utilisé pour signer les JWT de session utilisateur).
Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation du Secret Store CSI.

### E. Pièces jointes {#e-file-attachments}

Vikunja écrit les pièces jointes dans `VIKUNJA_FILES_BASEPATH`, que le module définit sur
`stateful_pvc_mount_path` (`/data`) — le PVC de bloc par pod — afin que
l'application et le volume ne puissent pas être en désaccord. Sans cela, les
pièces jointes reviendraient au `/app/vikunja/files` éphémère de Vikunja : la tâche
les listerait toujours après un redémarrage tandis que le téléchargement
échouerait. Le module ne déclare pas de bucket GCS dédié (`storage_buckets = []`).

- **Console :** Kubernetes Engine → Stockage → le PVC Vikunja.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK (`manage_storage_kms_iam`,
`enable_artifact_registry_cmek`) et les montages GCS Fuse (`gcs_volumes`).

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique est réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des stratégies d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Vikunja {#3-vikunja-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données et le rôle de l'application, et accorde les privilèges. Le job peut
  être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Vikunja applique ses propres migrations
  de schéma automatiquement au premier démarrage de l'application — le job
  `db-init` ne provisionne qu'une base de données vide, alors prévoyez du
  temps supplémentaire pour que le premier pod devienne Ready.
- **`VIKUNJA_SERVICE_JWTSECRET` est immuable après le premier démarrage.** Il est généré une
  fois et écrit dans Secret Manager. Le modifier invalide toutes les sessions
  utilisateur actives. Ne le faites pivoter que pendant une fenêtre de
  maintenance planifiée.
- **Le premier compte enregistré devient le propriétaire.** Vikunja n'est pas
  livré avec un administrateur pré-initialisé. Ouvrez l'URL externe et
  enregistrez-vous — le premier compte est propriétaire de l'instance. Ensuite,
  définissez `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"` dans `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/health` — un point de terminaison public, non authentifié, qui
  renvoie 200 une fois que le serveur a lié son port.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (les balises `{{UIMeta group=N}}` dans `variables.tf`).
Seuls les paramètres spécifiques ou notables pour Vikunja sont listés dans
chaque tableau ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

Métadonnées de plateforme standard (`module_description`, `module_documentation`,
`module_dependency`, `requires_services`, `module_services`, `credit_cost`,
`require_credit_purchases`, `enable_purge`, `public_access`,
`require_services_gcp_module`, `shared_users`, `technical_support_users`,
`resource_creator_identity`, `impersonation_service_account`,
`job_execution_wait_timeout`) plus deux variables déclarées mais **non référencées** par
ce module — `explicit_secret_values` et `scripts_dir`. `credit_cost` est par
défaut `75`, le même que la variante Cloud Run.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vikunja` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Vikunja` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Vikunja task manager on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Vikunja ; `latest` construit une version récente épinglée (`2.3.0`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit le wrapper greffé busybox via Cloud Build. |
| `container_image` | `""` | Remplace l'URI de l'image ; laisser vide pour le chemin AR auto-dérivé. |
| `container_build_config` | `{ enabled = true }` | Dockerfile/contexte pour la build personnalisée. |
| `enable_image_mirroring` | `true` | Met en miroir l'image wrapper dans Artifact Registry. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Réplica unique — Vikunja n'a pas de coordination multi-réplicas. |
| `container_port` | `3456` | Port sur lequel le serveur Go de Vikunja écoute. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites et requêtes CPU/mémoire. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (boucle de rappel `127.0.0.1`). |
| `workload_type` | `null` → `StatefulSet` | Se résout en un StatefulSet car le PVC des pièces jointes est activé. |

Également dans ce groupe, suivant le comportement standard d'App_GKE : `enable_vertical_pod_autoscaling`
(`false`), `container_protocol` (`http1`), `timeout_seconds` (`300`),
`cloudsql_volume_mount_path` (`/cloudsql`), `service_annotations` / `service_labels`
(`{}`).

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger l'authentification Google Identity avant d'atteindre Vikunja. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Identités autorisées à accéder via IAP. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Identifiants OAuth 2.0. Requis ensemble lorsque `enable_iap = true`. |
| `iap_support_email` | `""` | E-mail de support sur l'écran de consentement IAP. |

### Groupe 6 — Cluster GKE, réseau et variables d'environnement {#group-6--gke-cluster-networking--environment-variables}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `VIKUNJA_*` supplémentaires. Ne pas définir `VIKUNJA_DATABASE_*` ou `VIKUNJA_SERVICE_JWTSECRET` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager. |
| `gke_cluster_name` | `""` | Cluster cible ; laisser vide pour découvrir automatiquement le cluster `Services_GCP`. |
| `namespace_name` | `""` | Espace de noms Kubernetes ; laisser vide pour générer automatiquement. |
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `session_affinity` | `None` | Routage persistant (`ClientIP`) ou `None`. |
| `network_tags` | `[]` | Tags réseau de nœud/pod pour le ciblage des règles de pare-feu. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

`gke_cluster_selection_mode` et `prereq_gke_subnet_cidr` sont déclarées pour la parité de
convention et ne sont **pas référencées**. `extra_service_ports` est déclarée mais
**non transmise** par ce module, donc la définir n'a aucun effet. Également dans
ce groupe, suivant le comportement standard d'App_GKE : `secret_rotation_period` (`2592000s`),
`secret_propagation_delay` (`30`), `enable_multi_cluster_service` (`false`),
`configure_service_mesh` (`false`), `termination_grace_period_seconds` (`30`),
`deployment_timeout` (`600`), et `prereq_subnet_cidr_override` (`""`, défini
uniquement pour épingler le CIDR du sous-réseau VPC inline sur un déploiement
existant).

### Groupe 7 — Sauvegardes et configuration de StatefulSet {#group-7--backups--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |

`stateful_pvc_enabled`, `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group` —
modèles de PVC StatefulSet. Activé par défaut pour Vikunja : le PVC (`/data`, `fs_group 1000`)
contient les pièces jointes. Garder `stateful_pvc_enabled = true`.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`,
`quota_memory_requests`, `quota_memory_limits` — ResourceQuota de l'espace de noms. Les
valeurs de mémoire nécessitent des suffixes d'unité binaire (par exemple
`"4Gi"`).

### Groupe 9 — Scripts SQL personnalisés et politiques de fiabilité {#group-9--custom-sql-scripts--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les perturbations volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | `false` | Distribuer les pods entre les zones. |

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécution facultative de scripts SQL post-provisionnement
sur la base de données.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai de 30s, fenêtre d'échec de 30 × 10s | Sonde de démarrage ; large fenêtre de réessai pour les migrations au premier démarrage. |
| `health_check_config` | HTTP `/health`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/health` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique facultatives. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Sidecar ou services auxiliaires déployés avec Vikunja. |

### Groupe 12 — CI/CD, GitHub et Binary Authorization {#group-12--cicd-github--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `github_app_installation_id`, `cicd_trigger_config`,
`enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.
`binauthz_evaluation_mode` est déclarée pour la parité de convention et n'est **pas
référencée**.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non nécessaire — les pièces jointes sont sur le PVC de bloc. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | VM NFS existante à réutiliser, ou nom de base pour une VM inline. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS supplémentaires. |
| `storage_buckets` | `[]` | Vikunja ne déclare aucun bucket par défaut. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |
| `delete_untagged_images` | `true` | Supprimer automatiquement les images non taguées. |
| `image_retention_days` | `30` | Jours après lesquels les images sont éligibles à la suppression. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Vikunja n'utilise pas Redis ; fourni pour la parité de convention de la Fondation. |
| `redis_host` / `redis_port` | `""` / `6379` | Détails de connexion Redis, significatifs uniquement si `enable_redis = true`. |

`redis_auth` est déclarée mais **non transmise** par ce module, donc la
définir n'a aucun effet.

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Moteur Cloud SQL ; fixé à PostgreSQL 15 par `Vikunja_Common` quelle que soit cette valeur. |
| `application_database_name` | `vikunja` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `vikunja` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installation facultative d'extensions PostgreSQL. |

`enable_mysql_plugins` / `mysql_plugins` ne sont pas applicables à Vikunja (PostgreSQL
uniquement). `sql_instance_name`, `sql_instance_base_name`, et l'ensemble
`db_*_env_var_name` (`db_host_env_var_name`, `db_name_env_var_name`, `db_password_env_var_name`,
`db_port_env_var_name`, `db_user_env_var_name`) sont déclarés pour la parité de
convention et ne sont **pas référencés/transmis** par ce module.

### Groupe 17 — Importation / Restauration de sauvegarde {#group-17--backup-import--restore}

`enable_backup_import`, `backup_source`, `backup_file`, `backup_format` —
restaure la base de données de l'application à partir d'un fichier de sauvegarde
lors du déploiement.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `static_ip_name` | `""` | Nom de l'IP statique ; laisser vide pour générer automatiquement. |

`network_name` est déclarée pour la parité de convention et n'est **pas
référencée** (le réseau est auto-découvert).

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
attache un WAF Cloud Armor et Cloud CDN au backend Ingress GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`,
`enable_audit_logging` — applique un périmètre VPC-SC et des journaux d'audit Cloud
détaillés.

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Vikunja. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, une
> incompatibilité `StatefulSet`/`Deployment`, des valeurs de quota de
> mémoire sans suffixes binaires, un `container_port`/`backup_retention_days` hors
> plage. Une configuration invalide échoue la **planification** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la plupart
> des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `VIKUNJA_SERVICE_JWTSECRET` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate pour tout le monde. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans source/fichier de sauvegarde valide échoue le job d'importation. |
| `stateful_pvc_enabled` | `true` | Élevé | Sans le PVC, les pièces jointes résident sur le disque éphémère du pod et sont perdues à chaque redémarrage du pod. |
| `container_image_source` | `custom` | Élevé | `prebuilt` déploie l'image `scratch` brute sans mappage shell/point d'entrée — le conteneur ne peut pas mapper `DB_*` et échoue. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment de la planification. |
| `min_instance_count` | `1` | Moyen | La propre validation de la variable autorise `0`–`1000` et il n'y a pas de garde au moment de la planification rejetant `0` — la logique de déploiement d'App_GKE convertit silencieusement `min_instance_count=0` en un `min_replicas` de `1` au moment de l'application (`local.min_instance_count > 0 ? local.min_instance_count : 1`), de sorte que le nombre de réplicas déployés diverge silencieusement de ce qui a été configuré plutôt que d'échouer avec une erreur. |
| `VIKUNJA_SERVICE_ENABLEREGISTRATION` (variable d'environnement) | `"false"` après le premier administrateur | Élevé | Laisser l'inscription ouverte permet à toute personne ayant l'URL de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser le pod pendant la maintenance sans protection de disponibilité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `db_*_env_var_name`, `redis_auth`, `extra_service_ports`, `sql_instance_name`/`sql_instance_base_name`, `network_name`, `gke_cluster_selection_mode`, `prereq_gke_subnet_cidr`, `binauthz_evaluation_mode` | Laisser par défaut | Faible | Déclarées pour la parité de convention de la Fondation mais non transmises/référencées par ce module — les définir n'a aucun effet sur le déploiement. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Vikunja
partagée avec la variante Cloud Run est décrite dans
**[Vikunja_Common](Vikunja_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Vikunja sur GKE Autopilot](../labs/Vikunja_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vikunja Common — Configuration d'application partagée](Vikunja_Common.md) — la configuration partagée par les deux cibles de déploiement.
