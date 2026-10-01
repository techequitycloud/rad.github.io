---
title: "Grafana sur GKE Autopilot"
description: "Référence de configuration pour déployer Grafana sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Grafana_GKE.md @ 3055034 sha256:e9afb0c8c617 -->

# Grafana sur GKE Autopilot {#grafana-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grafana_GKE.png" alt="Grafana sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana est la principale plateforme open source d'observabilité et d'analyse au
monde, utilisée par 10M+ utilisateurs dans des organisations telles que la NASA, le
CERN et Goldman Sachs. Elle fournit des tableaux de bord, des alertes et des
visualisations unifiés pour les métriques, les journaux et les traces issus de plus
de 100 sources de données. Ce module déploie Grafana sur **GKE Autopilot** au-dessus
du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Grafana et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Grafana s'exécute sous la forme d'une charge de travail web Go. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Grafana nécessite une base de données relationnelle ; SQLite n'est pas sûr pour les déploiements multi-pods |
| Stockage objet | Cloud Storage | Un bucket `grafana-data` provisionné automatiquement |
| Stockage partagé facultatif | Filestore (NFS) | Désactivé par défaut ; activez-le pour partager des tableaux de bord ou des plugins entre les réplicas |
| Cache facultatif | Redis | Désactivé par défaut ; peut être activé pour le stockage des sessions |
| Secrets | Secret Manager | Mot de passe de la base de données géré par le socle ; identifiants administrateur injectés via une variable d'environnement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Grafana conserve les tableaux de bord, les
  utilisateurs, les alertes et l'état des plugins dans une base de données
  relationnelle. SQLite utilise un verrouillage de fichier qui ne résiste pas aux
  écritures concurrentes de plusieurs pods ; le module impose PostgreSQL.
- **`GF_DATABASE_TYPE=postgres` est injecté automatiquement.** Sans lui, Grafana
  revient à SQLite même lorsque toutes les autres variables `GF_DATABASE_*` sont
  présentes.
- **Aucun job d'initialisation de la base de données n'est nécessaire.** Grafana
  migre automatiquement son schéma au premier démarrage ; aucun Job Kubernetes
  `db-init` n'est donc requis.
- **`stateful_fs_group = 472`.** Grafana s'exécute avec l'UID/GID 472 ; ce paramètre
  garantit que le conteneur peut écrire dans les montages PVC du StatefulSet sans
  erreur de permission.
- **NFS est désactivé par défaut.** Activez-le lorsque plusieurs réplicas doivent
  partager des plugins Grafana ou des tableaux de bord personnalisés sur un système de
  fichiers partagé.
- **Redis est désactivé par défaut.** Grafana n'a pas besoin de Redis pour ses
  fonctions de base ; ne l'activez que lorsqu'une cohérence du stockage des sessions
  entre de nombreux réplicas est nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Grafana {#a-gke-autopilot--the-grafana-workload}

Les pods Grafana sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Grafana pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Grafana stocke toutes les données de l'application (tableaux de bord, utilisateurs,
organisations, règles d'alerte, état des plugins) dans une instance gérée Cloud SQL
for PostgreSQL 15. Les pods s'y connectent de manière privée via le sidecar **Cloud
SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est donc exposée. Grafana
migre automatiquement son schéma au démarrage — aucun job d'initialisation
distinct n'est requis.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié `grafana-data` est provisionné automatiquement par
Grafana_Common. Le compte de service de la charge de travail y reçoit un accès. Des
buckets GCS supplémentaires peuvent être déclarés via `storage_buckets`, et des
volumes GCS Fuse peuvent être montés dans les pods via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<grafana-data-bucket>/    # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour GCS Fuse, les options CMEK et les règles de
cycle de vie.

### D. Filestore (NFS) — facultatif {#d-filestore-nfs--optional}

Lorsque `enable_nfs = true`, un partage NFS **Filestore** est provisionné et monté
dans les pods. C'est utile lorsque plusieurs réplicas doivent partager des plugins
Grafana ou des modèles de tableaux de bord personnalisés sur un système de fichiers
partagé. NFS est désactivé par défaut car l'état persistant de Grafana réside dans
PostgreSQL, et non sur le système de fichiers local.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké sous forme de secret Secret Manager
et injecté dans les pods à l'exécution. Le mot de passe administrateur de Grafana
n'est pas généré automatiquement par ce module — il doit être injecté via
`secret_environment_variables` (voir §3 ci-dessous).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

La charge de travail est exposée via une IP externe Cloud Load Balancing.
`enable_custom_domain` vaut `true` par défaut et provisionne une Ingress Kubernetes
avec un certificat géré par Google pour les noms d'hôte de `application_domains` ;
une IP statique est réservée par défaut afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Grafana expose `/api/health`
comme point de terminaison de santé, ciblé à la fois par les sondes de démarrage et de
vivacité, et éventuellement par un test de disponibilité Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Grafana {#3-grafana-application-behaviour}

- **Migration du schéma au démarrage.** Grafana se connecte à PostgreSQL et applique
  les éventuelles migrations de schéma en attente au premier démarrage. Aucun job
  d'initialisation de la base de données distinct n'est nécessaire. La sonde de
  démarrage accorde une tolérance totale d'environ 150 secondes pour les migrations du
  premier démarrage (`initial_delay_seconds=30`, `failure_threshold=12`, `period_seconds=10`).
- **Identifiant administrateur.** Grafana est livré avec les identifiants par défaut
  `admin`/`admin`. Le module ne génère PAS et n'effectue PAS de rotation du mot de
  passe administrateur. Vous devez injecter un mot de passe robuste via
  `secret_environment_variables` :
  ```bash
  # Create a secret for the admin password:
  gcloud secrets create grafana-admin-password \
    --replication-policy="automatic" --project "$PROJECT"
  printf 'yourStrongPassword' | gcloud secrets versions add grafana-admin-password \
    --data-file=- --project "$PROJECT"
  # Then set in your deployment config:
  # secret_environment_variables = { GF_SECURITY_ADMIN_PASSWORD = "grafana-admin-password" }
  ```
  Récupérez le mot de passe actuel :
  ```bash
  gcloud secrets versions access latest --secret=grafana-admin-password --project "$PROJECT"
  ```
- **`GF_DATABASE_TYPE` est injecté automatiquement.** Le module impose
  `GF_DATABASE_TYPE=postgres` dans l'environnement. Ne le remplacez pas dans
  `environment_variables`.
- **PVC du StatefulSet.** Lorsque `stateful_pvc_enabled = true`, chaque pod obtient un
  PVC dédié monté sur `/var/lib/grafana`. `stateful_fs_group = 472` garantit que
  Grafana (UID/GID 472) peut écrire dans ce chemin. Inspectez l'état des PVC :
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  ```
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité ciblent
  toutes deux `/api/health`, qui renvoie HTTP 200 lorsque Grafana et sa connexion à la
  base de données sont opérationnels.
- **Aucune tâche planifiée requise.** Contrairement aux applications pilotées par des
  campagnes, Grafana n'a aucun CronJob obligatoire. Des tâches cron facultatives (par
  ex. export d'instantanés, nettoyage) peuvent être ajoutées via `cron_jobs`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Grafana ou notables pour lui sont
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
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grafana` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Grafana Dashboards` | Nom convivial affiché dans la console. |
| `application_description` | `Grafana observability platform on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `11.4.0` | Tag de version de l'image Grafana ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="2Gi" }` | Limites de CPU/mémoire et requêtes facultatives pour le conteneur Grafana. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid lors de l'évaluation des alertes. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `3000` | Grafana écoute sur le port 3000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les requêtes de ressources. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Grafana dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GF_*` non secrets supplémentaires. `GF_DATABASE_TYPE=postgres` est injecté automatiquement — ne le remplacez pas. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour injecter `GF_SECURITY_ADMIN_PASSWORD`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `None` | Round-robin par défaut — Grafana est sans état avec PostgreSQL. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS si NFS est activé. |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC pour la persistance locale des données. La valeur `true` sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/var/lib/grafana` | Répertoire de données par défaut de Grafana — montez les PVC ici. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_fs_group` | `472` | `fsGroup` au niveau du pod — doit valoir `472` pour que Grafana (UID/GID 472) puisse écrire dans les montages PVC. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des entrées DNS de pods stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — des entiers seuls sont interprétés en octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones pour la haute disponibilité. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/health`, délai de 15 s, 12 échecs | Sonde HTTP sur le point de terminaison de santé de Grafana. |
| `health_check_config` | `/api/health`, délai de 30 s, 3 échecs | Sonde de vivacité Kubernetes. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif ciblant `/api/health`. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide — Grafana migre automatiquement son schéma au démarrage. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés facultatifs (par ex. export d'instantanés). |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Grafana. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume Filestore partagé — à activer lorsque plusieurs réplicas doivent partager des plugins ou des modèles de tableaux de bord. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS déclarés dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner (le bucket `grafana-data` est toujours créé par Grafana_Common). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage des sessions. Désactivé par défaut — non requis pour les fonctions de base de Grafana. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS lorsque NFS est activé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas ; PostgreSQL est obligatoire. |
| `application_database_name` | `grafana` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `grafana` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Active l'installation d'extensions PostgreSQL. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (par ex. `['pg_trgm']`). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Grafana. Vivement recommandé pour les déploiements internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Grafana. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `grafana-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et (facultative) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `GF_SECURITY_ADMIN_PASSWORD` (via `secret_environment_variables`) | secret robuste | Critical | Grafana est livré avec les identifiants par défaut `admin`/`admin`. Ne pas définir de mot de passe robuste expose l'interface d'administration. |
| `GF_AUTH_ANONYMOUS_ENABLED` (via `environment_variables`) | `false` (par défaut) | Critical | La valeur `"true"` expose tous les tableaux de bord sans authentification. |
| `database_type` | `POSTGRES_15` | Critical | PostgreSQL est obligatoire ; le remplacer par SQLite entraîne une perte de données à chaque redémarrage de pod. |
| `application_database_name` / `_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Des entiers seuls sont interprétés en octets et bloquent toute planification. |
| `GF_SERVER_ROOT_URL` (via `environment_variables`) | URL publique | High | Sans elle, les redirections OAuth, les liens des e-mails et les iframes pointent vers la mauvaise origine. |
| `enable_iap` | `true` pour un usage interne | High | Sans IAP, la page de connexion de Grafana est accessible publiquement depuis Internet. |
| `stateful_fs_group` | `472` | High | Toute autre valeur empêche Grafana d'écrire dans les montages PVC, ce qui provoque des échecs au démarrage. |
| `memory_limit` (dans `container_resources`) | `2Gi` | High | En dessous de 512Mi, Grafana subit un OOM au démarrage avec des ensembles de tableaux de bord volumineux. |
| `min_instance_count` | `1` | High | La mise à l'échelle à zéro crée des interruptions dans l'évaluation des alertes pendant les démarrages à froid. |
| `max_instance_count` | `1`–`3` | Medium | Plusieurs réplicas partagent PostgreSQL mais pas l'état des alertes en mémoire — des alertes peuvent être déclenchées en double. |
| `pdb_min_available` vs `min_instance_count` | prévoir une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `enable_redis` | `false` (par défaut) | Low | L'activer sans `redis_host` valide provoque une erreur de validation au moment du plan. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Grafana partagée avec
la variante Cloud Run est décrite dans **[Grafana_Common](Grafana_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Grafana sur GKE Autopilot](../labs/Grafana_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Grafana sur Google Cloud Run](Grafana_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grafana Common — Configuration applicative partagée](Grafana_Common.md) — la configuration partagée par les deux cibles de déploiement.
