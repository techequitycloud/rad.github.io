---
title: "Apache Superset sur GKE Autopilot"
description: "Référence de configuration pour déployer Apache Superset sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Superset_GKE.md @ 3055034 sha256:8eaea36a144f -->

# Apache Superset sur GKE Autopilot {#apache-superset-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Superset_GKE.png" alt="Apache Superset sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Apache Superset est une plateforme open source d'exploration et de visualisation de
données utilisée par des organisations du monde entier. Ce module déploie Superset sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Superset et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Superset s'exécute comme une charge de travail web Python/Gunicorn. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Gunicorn, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — stocke les tableaux de bord, graphiques, jeux de données et paramètres utilisateur |
| Stockage objet | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et requêtes asynchrones | Redis | Désactivé par défaut ; fortement recommandé pour les déploiements de production multi-utilisateurs |
| Secrets | Secret Manager | `SUPERSET_SECRET_KEY` et mot de passe de la base de données générés automatiquement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Superset l'utilise comme base de métadonnées pour
  l'ensemble des tableaux de bord, graphiques, jeux de données et définitions de rôles.
  MySQL n'est pas pris en charge.
- **`SUPERSET_SECRET_KEY` est généré automatiquement.** Une clé aléatoire de
  50 caractères est générée et stockée dans Secret Manager. Elle signe les sessions
  Flask — la faire tourner invalide toutes les sessions utilisateur actives.
  Considérez-la comme immuable après le premier déploiement.
- **L'initialisation en deux phases s'exécute automatiquement.** Un job `db-init` crée
  la base de données PostgreSQL et l'utilisateur ; puis un job `app-init` exécute les
  migrations de schéma et crée l'utilisateur administrateur. Les deux s'exécutent à
  chaque déploiement mais sont idempotents.
- **L'affinité de session est `ClientIP`.** Les sessions Flask de Superset tirent
  parti d'un routage persistant, afin que les requêtes d'un même navigateur
  atteignent le même pod.
- **Redis est désactivé par défaut.** Sans Redis, les workers Celery n'ont pas de
  broker ; l'exécution asynchrone des requêtes et la mise en cache des tableaux de bord
  sont indisponibles. Activez-le en production.
- La sonde de santé cible **`/health`** — le point de terminaison de disponibilité
  Gunicorn de Superset.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Superset {#a-gke-autopilot--the-superset-workload}

Les pods Superset sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. L'autoscaling horizontal des pods (Horizontal
Pod Autoscaling) dimensionne le déploiement entre les nombres minimal et maximal de
réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Superset pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à l'échelle
et le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Superset stocke toutes ses métadonnées (tableaux de bord, graphiques, jeux de données,
utilisateurs, rôles, connexions aux bases de données) dans une instance gérée Cloud SQL
for PostgreSQL 15. Les pods s'y connectent de façon privée via le sidecar
**Cloud SQL Auth Proxy** par un socket Unix, si bien qu'aucune IP publique n'est
exposée. Au premier déploiement, le job `db-init` crée la base de données et
l'utilisateur de l'application, et le job `app-init` exécute `superset db upgrade`
pour appliquer le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs).
Pour le modèle de connexion, les sauvegardes automatiques et la rotation du mot de
passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié est provisionné automatiquement pour les exports de
données, les sorties de graphiques et les fichiers de rapports de Superset. L'accès est
accordé automatiquement au compte de service de la charge de travail.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les montages GCS Fuse et les options CMEK.

### D. Cache Redis et moteur de requêtes asynchrones {#d-redis-cache-and-async-query-engine}

Redis sert de backend de cache et de broker Celery à Superset. Lorsqu'il est activé,
il assure l'exécution SQL asynchrone, le préchauffage du cache des tableaux de bord et
les rapports planifiés. Sans Redis, toutes les requêtes s'exécutent de façon synchrone
et bloquent les workers Gunicorn.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

`SUPERSET_SECRET_KEY` et le mot de passe de la base de données sont stockés sous forme
de secrets Secret Manager et injectés dans les pods à l'exécution ; aucune valeur en
clair n'apparaît dans la configuration.

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

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée pour que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE et
de Cloud SQL sont envoyées à Cloud Monitoring. Un test de disponibilité facultatif sur
`/health` et des règles d'alerte facultatives sont disponibles (désactivés par
défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Superset {#3-superset-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  crée la base de données Superset et l'utilisateur de façon idempotente avant le
  démarrage de l'application. Il s'exécute avec `postgres:15-alpine` et arrête le
  sidecar Cloud SQL Auth Proxy via `quitquitquit` à la fin.
- **Migrations de schéma à chaque déploiement.** Le job `app-init` exécute
  `superset db upgrade` à chaque déploiement, appliquant automatiquement les
  modifications de schéma de Flask-AppBuilder et de Superset en attente. Ce job crée
  ou met ensuite à jour l'utilisateur administrateur avec `superset fab create-admin`,
  et exécute enfin `superset init` pour charger les rôles et permissions par défaut.
- **Séquence de démarrage.** Le job `app-init` dépend de la réussite de `db-init`. Son
  délai d'expiration de 30 minutes absorbe les migrations lentes de la première
  exécution sur des schémas volumineux ou complexes. La sonde de démarrage laisse
  jusqu'à 180 secondes (délai initial de 60 s, seuil de 12 échecs à intervalles de
  10 s) au pool de workers Gunicorn pour démarrer.
- **Clé secrète Flask.** `SUPERSET_SECRET_KEY` signe les sessions Flask et chiffre les
  identifiants de connexion aux bases de données stockés dans les métadonnées de
  Superset. La modifier après le premier déploiement invalide toutes les sessions et
  rend illisibles les identifiants stockés. La clé est générée automatiquement sous
  forme de chaîne aléatoire de 50 caractères dans Secret Manager.
- **Requêtes asynchrones et rapports planifiés.** Les workers Celery de Superset
  utilisent Redis comme broker et backend de résultats. Sans Redis, les requêtes
  asynchrones et les rapports planifiés sont indisponibles. Configurez
  `enable_redis = true` et renseignez `redis_host` en production.
- **Chemin de santé.** Les sondes de disponibilité et de vivacité ciblent `/health`,
  qui renvoie HTTP 200 lorsque le pool de workers Gunicorn est prêt.
- **Connexion administrateur.** Les identifiants administrateur sont définis par les
  variables d'environnement `SUPERSET_ADMIN_USERNAME`, `SUPERSET_ADMIN_EMAIL` et
  `SUPERSET_ADMIN_PASSWORD`. Le mot de passe prend par défaut la valeur de
  `SUPERSET_SECRET_KEY` lorsqu'il n'est pas défini explicitement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Superset ou notables pour lui sont
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `superset` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Apache Superset` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Superset ; fixez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Mettez `false` pour ne provisionner que l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par pod ; 2 vCPU / 2 GiB minimum pour Superset. |
| `container_port` | `8088` | Superset/Gunicorn écoute sur le port 8088. |
| `container_image_source` | `custom` | `custom` construit le Dockerfile fourni (nécessaire pour psycopg2) ; `prebuilt` utilise une image existante. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez ≥ 1 pour éviter les délais de démarrage à froid. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `timeout_seconds` | `600` | Délai d'expiration des requêtes ; étendu pour les requêtes SQL de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `SUPERSET_SECRET_KEY` est injecté automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant recommandé pour les sessions Flask de Superset. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans un StatefulSet. Superset ne nécessite pas de stockage par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC lorsqu'il est activé. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai de 60 s, 12 échecs | Laisse jusqu'à 180 s au pool de workers Gunicorn pour s'initialiser. |
| `health_check_config` | HTTP `/health`, délai de 60 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/health` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le pipeline intégré en deux phases db-init + app-init. |
| `cron_jobs` | `[]` | CronJobs récurrents — utiles pour le préchauffage du cache ou la génération de rapports. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires (p. ex. workers Celery). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume Filestore partagé. Superset ne nécessite pas NFS — l'état réside dans PostgreSQL. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur si NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données. |
| `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour Celery et la mise en cache. **Fortement recommandé en production.** |
| `redis_host` | `""` | Nom d'hôte ou IP de Redis. Obligatoire lorsque `enable_redis = true`. |
| `redis_port` | `"6379"` | Port Redis (une chaîne dans la variante GKE). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Superset nécessite PostgreSQL. |
| `application_database_name` | `superset_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `superset_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à porter à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Superset. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Superset. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SUPERSET_SECRET_KEY` (généré automatiquement) | immuable après le premier déploiement | Critique | Modifier la clé invalide toutes les sessions actives et rend définitivement illisibles les identifiants de connexion aux bases de données stockés dans les métadonnées de Superset. |
| `database_type` | `POSTGRES_15` | Critique | Superset nécessite PostgreSQL ; le modifier empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Le désactiver supprime le sidecar Auth Proxy ; toutes les connexions PostgreSQL échouent. |
| `application_database_name` / `_user` | à définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit tous les tableaux de bord et métadonnées. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont des octets et bloquent toute planification de pods. |
| `enable_redis` | `true` en production | Élevé | Sans Redis, les workers Celery n'ont pas de broker ; les requêtes asynchrones et les rapports planifiés sont indisponibles. |
| `redis_host` | à définir explicitement | Élevé | Obligatoire lorsque `enable_redis = true` ; une valeur vide fait échouer les workers Celery au démarrage. |
| `container_resources.memory_limit` | `2Gi` minimum | Élevé | En dessous de 1 GiB, les workers Gunicorn sont arrêtés pour manque de mémoire (OOM) pendant l'exécution des requêtes. |
| `container_resources.cpu_limit` | `2000m` | Élevé | En dessous de 1000m, le job de migration app-init peut dépasser sa fenêtre de 30 minutes. |
| `min_instance_count` | `1` | Élevé | `0` entraîne une mise à zéro ; les requêtes asynchrones soumises pendant le démarrage à froid sont perdues. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, l'état de session Flask est perdu d'une requête à l'autre sur les déploiements à plusieurs réplicas. |
| `startup_probe_config.failure_threshold` | `12` ou plus | Élevé | Le réduire trop fortement amène GKE à arrêter les pods avant que Superset ait terminé les migrations de la base de données. |
| `application_version` | fixer une version précise | Moyen | `latest` déclenche des mises à niveau non maîtrisées susceptibles d'introduire des changements d'API incompatibles. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sans eux, le formulaire de connexion de Superset est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | prévoir une marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Superset, partagée
avec la variante Cloud Run, est décrite dans **[Superset_Common](Superset_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Superset sur GKE Autopilot](../labs/Superset_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Apache Superset sur Google Cloud Run](Superset_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Superset Common — Configuration applicative partagée](Superset_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Kestra sur GKE Autopilot](Kestra_GKE.md) et [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Analytics Warehouse**.
