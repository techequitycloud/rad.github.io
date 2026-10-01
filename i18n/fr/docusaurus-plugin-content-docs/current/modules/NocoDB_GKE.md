---
title: "NocoDB sur GKE Autopilot"
description: "Référence de configuration pour déployer NocoDB sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/NocoDB_GKE.md @ 3055034 sha256:f44c31ec4c69 -->

# NocoDB sur GKE Autopilot {#nocodb-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NocoDB_GKE.png" alt="NocoDB sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

NocoDB est une alternative open source à Airtable qui transforme n'importe quelle
base de données en tableur intelligent, avec une interface sans code, des API REST
et GraphQL et des automatisations intégrées. Ce module déploie NocoDB sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par NocoDB et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

NocoDB s'exécute sous forme de charge de travail Node.js. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Moteur par défaut ; MySQL 8.0 également pris en charge via `database_type` |
| Stockage d'objets | Cloud Storage | Provisionné, mais non relié au stockage des pièces jointes de NocoDB (voir ci-dessous) |
| Cache (facultatif) | Redis | Désactivé par défaut ; requis lorsque plusieurs réplicas s'exécutent |
| Secrets | Secret Manager | Secret JWT généré automatiquement (`NC_AUTH_JWT_SECRET`) et mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est la valeur par défaut.** MySQL 8.0 est également pris en
  charge ; définissez `database_type` avant le premier déploiement.
- **NocoDB se connecte en TCP via l'IP privée, et non via le socket de l'Auth
  Proxy.** Le sidecar Cloud SQL Auth Proxy est activé par défaut dans la variante GKE (`enable_cloudsql_volume
  = true`), mais le constructeur d'URL interne de NocoDB exige un hôte TCP — c'est l'IP
  privée qui est utilisée, et non le chemin du socket Unix.
- **NFS est désactivé par défaut.** NocoDB ne dépend d'aucun système de fichiers
  partagé, mais il ne dispose pas non plus d'un backend de pièces jointes Cloud
  Storage fonctionnel prêt à l'emploi (voir §2C) — les pièces jointes utilisent le
  disque local/éphémère du pod, sauf configuration manuelle.
- **Redis est désactivé par défaut.** Un réplica unique fonctionne sans Redis ;
  activez-le avant de dépasser un pod.
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager.
  N'effectuez pas sa rotation après le premier déploiement — toutes les sessions et
  tous les jetons d'API existants seraient immédiatement invalidés.
- **NocoDB gère lui-même ses migrations de base de données au premier démarrage.**
  Aucun job d'initialisation externe n'est requis, bien qu'un job `db-init`
  soit tout de même fournie pour créer la base de données et l'utilisateur.
- **Les sondes de santé ciblent `/api/v1/health`**, le point de terminaison de
  santé dédié exposé par NocoDB.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail NocoDB {#a-gke-autopilot--the-nocodb-workload}

Les pods NocoDB sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  NocoDB pour consulter les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NocoDB stocke toutes les données applicatives (tables, vues, automatisations,
données des lignes) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods
la joignent via une connexion TCP sur IP privée. Au premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application ; NocoDB
exécute ensuite ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage — provisionné, non relié aux pièces jointes {#c-cloud-storage--provisioned-not-wired-to-attachments}

La variable `storage_buckets` provisionne un bucket GCS (par défaut `name_suffix =
"data"`) et une valeur `GCS_BUCKET_NAME` est injectée dans le conteneur sous forme
de variable d'environnement. Cependant, le script de point d'entrée de
`NocoDB_Common` ne lit jamais `GCS_BUCKET_NAME` (ni `GCS_BASE_URL`, propre à GKE),
et le nom de bucket injecté ne correspond au nom d'aucun bucket réellement créé par
le socle. NocoDB ne stocke donc **pas** automatiquement les pièces jointes dans
Cloud Storage — les fichiers téléversés sont écrits sur le disque local/éphémère du
pod et sont perdus lors d'un redémarrage du pod. Pour conserver les pièces jointes
dans GCS, configurez manuellement les paramètres de stockage compatible S3 propres
à NocoDB (via son interface d'administration ou `environment_variables`) en les
faisant pointer vers un bucket auquel le compte de service de la charge de travail
peut accéder.

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket provisionné.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/      # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour CMEK et les options de buckets
supplémentaires.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis soutient la couche de cache de NocoDB et, dans les déploiements à plusieurs
réplicas, maintient la cohérence de l'état du cache entre les pods. Redis est
désactivé par défaut ; un `redis_host` doit être fourni lorsqu'il est activé.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret JWT de NocoDB (`NC_AUTH_JWT_SECRET`) et le mot de passe de la base de
données sont stockés sous forme de secrets Secret Manager et injectés dans les pods
à l'exécution ; aucune valeur en clair n'apparaît dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration de
Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. Un domaine personnalisé avec certificat géré par Google peut être activé,
et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité
facultatifs sur `/api/v1/health` et des règles d'alerte sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application NocoDB {#3-nocodb-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) crée la base de données et l'utilisateur NocoDB
  avant le démarrage de l'application. Il est idempotent et peut être réexécuté
  sans risque.
- **Migrations autogérées.** NocoDB exécute ses propres migrations de schéma de
  base de données au premier démarrage — il est inutile de configurer des jobs de
  migration externes.
- **Secret JWT.** `NC_AUTH_JWT_SECRET` est généré automatiquement et stocké dans
  Secret Manager. N'effectuez pas sa rotation après le premier déploiement ; toutes
  les sessions et tous les jetons d'API existants sont immédiatement invalidés si le
  secret change.
- **Les téléversements GCS ne sont pas automatiques.** Une variable
  d'environnement `GCS_BUCKET_NAME` est injectée, mais le script de point d'entrée
  ne la lit jamais et sa valeur ne correspond à aucun bucket créé par le socle. Les
  pièces jointes utilisent le disque local/éphémère du pod, sauf si l'opérateur
  configure manuellement les paramètres de stockage compatible S3 propres à NocoDB.
- **Variables d'environnement NC_DB_*.** Le Dockerfile personnalisé de
  `NocoDB_Common` associe les variables de connexion standard `DB_*` (injectées par
  le socle) aux noms `NC_DB_*` attendus par NocoDB. Lorsque
  `container_image_source = "prebuilt"`, cette correspondance n'est pas appliquée —
  configurez manuellement les variables `NC_DB_*` via `environment_variables`.
- **Chemin de santé.** Les sondes de disponibilité (readiness) et de vivacité ciblent
  `/api/v1/health`, qui renvoie HTTP 200 lorsque NocoDB est prêt à accepter des
  requêtes.
- **Sessions multi-réplicas.** Avec plus d'un pod et sans Redis, NocoDB ne peut pas
  partager l'état des sessions ni du cache ; les utilisateurs peuvent être
  déconnectés lorsque les requêtes sont acheminées vers un autre pod. Activez Redis
  et définissez `redis_host` avant de dépasser un réplica.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à NocoDB ou notables pour lui sont
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
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nocodb` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `NocoDB` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image NocoDB ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "1Gi" }` | Limites de CPU et de mémoire du pod NocoDB ; `1Gi` de mémoire au minimum. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les délais de démarrage à froid. |
| `max_instance_count` | `10` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8080` | NocoDB écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (connexion via l'IP privée, et non via le socket). |
| `enable_vertical_pod_autoscaling` | `false` | Laisser Autopilot ajuster automatiquement les demandes de ressources. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build avec la correspondance NC_DB_* ; `prebuilt` déploie une image existante. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets injectés dans le conteneur. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager pour des secrets supplémentaires. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant ; recommandé pour un comportement cohérent des sessions NocoDB. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` ; définissez `StatefulSet` uniquement si un stockage par pod est nécessaire. |
| `network_tags` | `["nfsserver"]` | Tags des nœuds/pods ; `nfsserver` est requis si NFS est activé un jour. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Options de StatefulSet (modèles de PVC, service headless, gestion des pods,
stratégie de mise à jour, fsGroup) — voir [App_GKE](App_GKE.md). Généralement
inutiles pour NocoDB, qui stocke son état dans PostgreSQL et GCS.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonner le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Utilisez obligatoirement des unités binaires (`4Gi`, `8192Mi`)** — les entiers sans unité sont interprétés comme des octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartir les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | `/api/v1/health` | Sonde HTTP, délai initial de 30 s, 30 échecs tolérés. |
| `health_check_config` / `liveness_probe` | `/api/v1/health` | Sonde de vivacité HTTP. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/api/v1/health`. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents (par exemple, tâches personnalisées de synchronisation de données). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas requis pour NocoDB. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS définis dans `storage_buckets`. Non relié aux pièces jointes de NocoDB — voir §2C. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis. Requis lorsque plus d'un réplica s'exécute. |
| `redis_host` | `""` | Hôte Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | PostgreSQL par défaut ; `MYSQL_8_0` également pris en charge. À définir avant le premier déploiement. |
| `application_database_name` | `nocodb` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `nocodb` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Extensions PostgreSQL facultatives à installer. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger une connexion Google devant NocoDB. Recommandé pour les espaces de travail internes. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à NocoDB. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison (IP privée) / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NC_AUTH_JWT_SECRET` | généré automatiquement (immuable) | Critique | Sa rotation après le premier déploiement invalide immédiatement toutes les sessions et tous les jetons d'API. |
| `application_database_name` / `_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers sans unité sont des octets et bloquent toute planification. |
| `container_resources.memory_limit` | `1Gi` | Élevé | Le processus Node.js de NocoDB est tué pour OOM en dessous de 512 Mi ; les charges de travail de production comportant de nombreuses automatisations nécessitent 2 Gi. |
| `enable_redis` | `true` lorsque >1 réplica | Élevé | Plusieurs pods sans Redis provoquent l'invalidation des sessions lorsque les requêtes sont acheminées vers des pods différents. |
| `redis_host` | explicite lorsque Redis est activé | Élevé | Un hôte manquant fait échouer toutes les connexions Redis au démarrage du pod. |
| `min_instance_count` | `1` | Élevé | `0` permet des démarrages à froid pendant lesquels les rappels de webhooks expirent et sont perdus. |
| `max_instance_count` | maintenir bas sans Redis | Moyen | Dépasser `1` sans Redis provoque l'invalidation des sessions. |
| `enable_iap` / `enable_cloud_armor` | activer pour un usage interne | Moyen | Sinon, NocoDB est publiquement accessible depuis l'IP de l'équilibreur de charge. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |
| `application_version` | épingler un tag précis | Moyen | `latest` déclenche des mises à niveau non maîtrisées à chaque reconstruction du conteneur. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à NocoDB,
partagée avec la variante Cloud Run, est décrite dans
**[NocoDB_Common](NocoDB_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NocoDB sur GKE Autopilot](../labs/NocoDB_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [NocoDB Common — Configuration applicative partagée](NocoDB_Common.md) — la configuration partagée par les deux cibles de déploiement.
