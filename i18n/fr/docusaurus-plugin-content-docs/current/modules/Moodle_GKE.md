---
title: "Moodle sur GKE Autopilot"
description: "Référence de configuration pour déployer Moodle sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Moodle_GKE.md @ 3055034 sha256:a8c8af0d69fe -->

# Moodle sur GKE Autopilot {#moodle-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Moodle_GKE.png" alt="Moodle sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Moodle est le système de gestion de l'apprentissage (LMS) open source le plus
populaire au monde, utilisé par des universités, des écoles, des entreprises et des
organismes de formation en ligne partout dans le monde.
Ce module déploie Moodle sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Moodle et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Moodle s'exécute comme une charge de travail web PHP 8.3/Apache adossée à PostgreSQL.
Le déploiement associe un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP 8.3/Apache, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Moodle ne prend pas en charge MySQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoire Moodle `moodledata` partagé entre tous les réplicas ; obligatoire |
| Stockage d'objets | Cloud Storage | Un bucket de données et tout bucket supplémentaire défini par l'utilisateur |
| Cache et sessions | Redis | Activé par défaut ; se replie sur l'adresse IP de l'hôte NFS lorsqu'aucun hôte Redis n'est indiqué |
| Secrets | Secret Manager | Mot de passe cron généré automatiquement, mot de passe SMTP et mot de passe de la base de données |
| Planificateur | Cloud Scheduler | Tâche cron provisionnée automatiquement (toutes les minutes) sur `/admin/cron.php` |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître dès le départ :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe et `MOODLE_DB_TYPE =
  "pgsql"` est codé en dur ; sélectionner MySQL ou `NONE` empêche le démarrage.
- **NFS est obligatoire.** Le répertoire Moodle `moodledata` doit être un système de
  fichiers partagé, accessible en écriture depuis tous les réplicas. `enable_nfs` vaut
  `true` par défaut.
- **Redis est activé par défaut.** Avec plus d'un réplica, un cache partagé est requis
  pour garder les sessions PHP et l'état applicatif de Moodle cohérents entre les pods.
- **L'affinité de session est `ClientIP`.** Moodle s'appuie sur les sessions PHP ; les
  requêtes d'un navigateur sont donc rattachées à un seul pod.
- **Le domaine personnalisé est activé par défaut** (`enable_custom_domain = true`) afin
  que le `wwwroot` de Moodle se résolve vers une adresse stable plutôt que vers
  l'adresse IP transitoire d'un pod.
- **Une tâche Cloud Scheduler est provisionnée automatiquement.** Elle appelle
  `/admin/cron.php` toutes les minutes à l'aide d'un mot de passe cron sécurisé, généré
  automatiquement et stocké dans Secret Manager.
- Le **mot de passe cron** et le **mot de passe SMTP** sont générés automatiquement et
  stockés dans Secret Manager ; vous ne les saisissez jamais en clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Moodle {#a-gke-autopilot--the-moodle-workload}

Les pods Moodle sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement
entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Moodle pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Moodle stocke toutes les données applicatives (cours, utilisateurs, notes, journaux
d'activité) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods s'y
connectent en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, si bien
qu'aucune adresse IP publique n'est exposée. Lors du premier déploiement, une tâche
d'initialisation crée la base de données et l'utilisateur de l'application, et active
l'extension `pg_trgm` pour la recherche en texte intégral de Moodle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Outputs](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `moodledata` de Moodle est écrit sur un partage **Filestore (NFS)** monté
dans chaque pod, afin que tous les réplicas voient les mêmes fichiers téléversés,
supports de cours et devoirs des utilisateurs. Un bucket de données **Cloud Storage**
dédié est également provisionné ; le compte de service de la charge de travail y reçoit
automatiquement l'accès.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  # Confirm the NFS share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la gestion des sessions PHP et le cache applicatif de Moodle.
Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP de
l'hôte NFS sert de point de terminaison Redis — ce qui convient au développement. En
production avec plusieurs réplicas, définissez `redis_host` sur l'adresse IP d'une
instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping           # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe cron et le mot de passe SMTP de Moodle sont générés automatiquement par
`Moodle_Common` et stockés sous forme de secrets Secret Manager. Le mot de passe de la
base de données est généré et géré par le socle. Les trois sont injectés dans les pods
à l'exécution ; aucune valeur en clair n'apparaît dans les fichiers de configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Outputs](#5-outputs). Après le déploiement, mettez à jour le secret du mot de passe
SMTP avec votre véritable identifiant SMTP :
```bash
echo -n "your-smtp-password" | \
  gcloud secrets versions add <smtp-password-secret> --data-file=- --project "$PROJECT"
```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Cloud Scheduler {#f-cloud-scheduler}

Une tâche Cloud Scheduler est provisionnée automatiquement à chaque déploiement pour
piloter la file de tâches interne de Moodle. Elle s'exécute toutes les minutes et
s'authentifie à l'aide du `MOODLE_CRON_PASSWORD` généré automatiquement.

- **Console :** Cloud Scheduler → Jobs.
- **CLI :**
  ```bash
  gcloud scheduler jobs list --project "$PROJECT"
  gcloud scheduler jobs describe <job-name> --location "$REGION" --project "$PROJECT"
  # Manually trigger a cron run:
  gcloud scheduler jobs run <job-name> --location "$REGION" --project "$PROJECT"
  ```

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être activé,
et une adresse IP statique peut être réservée afin que l'adresse survive aux
redéploiements. `enable_custom_domain` vaut `true` par défaut afin que le `wwwroot` de
Moodle puisse toujours être résolu vers une adresse stable.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
adresses IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Moodle {#3-moodle-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Deux tâches
  d'initialisation s'exécutent avant le démarrage de l'application. La tâche `db-init`
  crée la base de données et l'utilisateur Moodle, active l'extension `pg_trgm` et
  accorde les privilèges (idempotente, peut être relancée sans risque). La tâche
  `nfs-init` crée les sous-répertoires Moodle requis (`filedir`, `temp`, `cache`,
  `localcache`) sur le partage NFS et en attribue la propriété à `www-data`.
- **Planification cron automatique.** Une tâche Cloud Scheduler s'exécute toutes les
  minutes en ciblant `/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`. Elle pilote
  toutes les tâches planifiées de Moodle : sauvegardes de cours, notifications par
  e-mail, traitement des badges et achèvements d'activités. La tâche est toujours créée
  et ne peut pas être désactivée.
- **Chemin de santé.** Les sondes de disponibilité et de vivacité utilisent
  `/health.php`, qui renvoie HTTP 200 lorsque PHP est opérationnel. La sonde de
  démarrage accorde jusqu'à 10 minutes pour la création du schéma et l'enregistrement
  des plugins au premier démarrage.
- **E-mail sortant SMTP.** Les paramètres SMTP sont injectés sous forme de variables
  d'environnement. Remplacez les valeurs par défaut via `environment_variables` (voir le
  Groupe 5). Le mot de passe SMTP est généré automatiquement et stocké dans Secret
  Manager ; mettez à jour le secret avec votre véritable identifiant après le
  déploiement.
- **Résolution de `wwwroot`.** Le `config.php` de Moodle résout `wwwroot` à partir de
  la variable d'environnement `APP_URL`, avec `GKE_SERVICE_URL` en repli. Les domaines
  personnalisés requièrent `enable_custom_domain = true` (la valeur par défaut) pour
  produire une URL stable.
- **Connexion administrateur.** Le nom d'utilisateur et l'adresse e-mail de
  l'administrateur initial sont configurables via `environment_variables`. Le mot de
  passe administrateur est défini lors de la première installation de Moodle via
  `admin/cli/install_database.php`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Moodle ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `moodle` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Moodle LMS` | Nom convivial affiché dans la console. |
| `application_description` | `Moodle Learning Management System on GKE Autopilot` | Annotation de description de la charge de travail. |
| `description` | `Moodle LMS - Online learning and course management platform` | Transmis à `Moodle_Common` comme entrée `description` ; distinct de `application_description` ci-dessus. |
| `application_version` | `4.5.1` | Tag de version de l'image de conteneur ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU recommandés pour Moodle. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (évite les erreurs OOM de PHP lors des importations). |
| `min_instance_count` | `0` | Nombre minimal de réplicas. Définissez `1` en production pour que les tâches planifiées continuent de s'exécuter. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8080` | Moodle/Apache écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Remplacez ici les valeurs SMTP injectées automatiquement (par ex. `MOODLE_SMTP_HOST`, `MOODLE_ADMIN_EMAIL`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions PHP de Moodle. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC pour un stockage persistant par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage par PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health.php`, 20 échecs × 30 s | Jusqu'à 10 minutes pour que Moodle termine sa configuration au premier démarrage. |
| `liveness_probe` | HTTP `/health.php`, délai initial de 120 s | Contrôle de santé périodique après le démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `db-init` et `nfs-init`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes complémentaires (le cron Moodle Cloud Scheduler est toujours créé séparément). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le `moodledata` de Moodle (à laisser activé — requis pour tous les déploiements). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur ; injecté sous la forme `MOODLE_DATA_DIR`. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes pour le montage NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour les thèmes ou les plugins. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour les sessions PHP et le cache applicatif de Moodle. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP de l'hôte NFS (développement uniquement) ; définissez l'adresse IP d'une instance Cloud Memorystore pour la production. |
| `redis_port` | `6379` | Port Redis (type chaîne). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixé à PostgreSQL — ne le modifiez pas. |
| `application_database_name` | `gkeapp` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `db_name` | `moodle` | Alias du nom de base de données propre à Moodle ; gardez-le cohérent avec `application_database_name`. |
| `db_user` | `moodle` | Alias de l'utilisateur propre à Moodle ; gardez-le cohérent avec `application_database_user`. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Utilisez-les pour exécuter des extensions PostgreSQL supplémentaires
ou injecter des données initiales. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + certificat géré (requis pour un `wwwroot` Moodle correct). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Moodle. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL pour accéder à Moodle. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `nfs_server_ip` | Adresse IP privée du serveur NFS Filestore (sensible). |
| `nfs_mount_path` | Chemin du conteneur où le partage NFS est monté. |
| `nfs_share_path` | Chemin d'exportation sur le serveur NFS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` / `nfs_setup_job` | Noms des tâches de configuration et des tâches (facultatives) d'importation et NFS. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` | Critical | Moodle requiert PostgreSQL ; `MOODLE_DB_TYPE = "pgsql"` est codé en dur — tout autre moteur empêche le démarrage. |
| `enable_nfs` | `true` | Critical | Sans stockage NFS partagé, `moodledata` n'est pas partagé entre les réplicas et les fichiers téléversés sont perdus au redémarrage d'un pod. |
| `application_database_name` / `db_name` | définis une seule fois, cohérents | Critical | Immuables après le premier déploiement ; un renommage recrée la base de données et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers nus sont des octets et bloquent toute planification des pods. |
| `enable_redis` | `true` | High | Avec plus d'un réplica, des caches isolés par pod entraînent des incohérences de sessions PHP. |
| `redis_host` | `""` (NFS) ou explicite | High | Aucun point de terminaison valide si Redis est activé alors que NFS est désactivé et qu'aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | High | Une mémoire insuffisante provoque des erreurs OOM de PHP lors des importations de cours ou des téléversements de fichiers volumineux. |
| `session_affinity` | `ClientIP` | High | Sans persistance de session, les connexions à Moodle sur plusieurs réplicas perdent l'état de session. |
| `min_instance_count` | `1` pour la production | High | `0` peut laisser la tâche cron Cloud Scheduler sans pod destinataire pendant les périodes de réduction à zéro. |
| `enable_custom_domain` | `true` (par défaut) | High | Sans URL stable, le `wwwroot` de Moodle se résout vers l'adresse IP transitoire d'un pod, ce qui casse les liens absolus et les chemins de fichiers. |
| `nfs_mount_path` | `/mnt/nfs` | High | Doit correspondre à `MOODLE_DATA_DIR` ; le modifier après le premier déploiement déplace la racine des données et casse l'installation. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'accès administrateur | Medium | Sinon, l'interface d'administration est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration partagée propre à Moodle est décrite dans
**[Moodle_Common](Moodle_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Moodle sur GKE Autopilot](../labs/Moodle_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Moodle sur Google Cloud Run](Moodle_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Moodle Common — Configuration applicative partagée](Moodle_Common.md) — la configuration partagée par les deux cibles de déploiement.
