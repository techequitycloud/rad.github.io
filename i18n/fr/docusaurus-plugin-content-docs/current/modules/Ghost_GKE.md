---
title: "Ghost sur GKE Autopilot"
description: "Référence de configuration pour déployer Ghost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ghost_GKE.md @ 3055034 sha256:44dac80b077b -->

# Ghost sur GKE Autopilot {#ghost-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghost_GKE.png" alt="Ghost sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghost est une plateforme de publication open source moderne qui alimente plus de 2M de publications, avec adhésions, abonnements et newsletters intégrés. Ce module déploie Ghost sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Ghost et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Ghost s'exécute sous la forme d'une charge de travail web Node.js. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Ghost 6.x ne prend pas en charge PostgreSQL |
| Fichiers partagés | Filestore (NFS) | Contenus téléversés et thèmes partagés entre tous les réplicas |
| Stockage objet | Cloud Storage | Un bucket de contenu dédié (`ghost-content`) provisionné automatiquement |
| Cache | Redis | Activé par défaut ; se rabat sur l'IP de l'hôte NFS lorsqu'aucun hôte Redis n'est indiqué |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Ghost 6.x nécessite MySQL ; PostgreSQL n'est pas pris en charge et ne démarrera pas.
- **`database__client = "mysql"` est injecté automatiquement.** Sans cela, Ghost se rabat silencieusement sur SQLite — le module s'en charge, vous n'avez donc jamais à le définir manuellement.
- **Redis est activé par défaut.** Ghost utilise Redis pour la mise en cache des pages afin de réduire la charge sur la base de données et d'améliorer les temps de réponse.
- **L'affinité de session est `ClientIP`.** Le panneau d'administration et le portail d'adhésion de Ghost utilisent des sessions côté serveur ; les requêtes d'un navigateur sont épinglées à un même pod.
- **Un bucket GCS `ghost-content` est provisionné automatiquement** par `Ghost_Common` et n'a pas besoin d'être ajouté à `storage_buckets`.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données MySQL et l'utilisateur de Ghost.
- **Les sondes de santé ciblent `/`** avec un délai initial de 90 secondes, pour permettre à Ghost d'exécuter les migrations de base de données et de compiler les thèmes au premier démarrage.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Ghost {#a-gke-autopilot--the-ghost-workload}

Les pods Ghost sont planifiés sur Autopilot, qui facture le CPU et la mémoire effectivement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Ghost pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Ghost stocke toutes les données de l'application (articles, membres, paramètres) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, si bien qu'aucune IP publique n'est exposée. Au premier déploiement, un Job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les contenus téléversés (images, thèmes, fichiers) sont écrits sur un partage **Filestore (NFS)** monté dans chaque pod, de sorte que tous les réplicas voient les mêmes fichiers. Un bucket **Cloud Storage** dédié (`ghost-content`) est également provisionné automatiquement pour le contenu ; l'accès est accordé automatiquement au compte de service de la charge de travail.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket de contenu.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<content-bucket>/          # bucket name is in the Outputs
  # Confirm the share is mounted inside a pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i nfs
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis sert de support à la mise en cache des pages de Ghost. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis env vars are set in the Ghost pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké sous forme de secret Secret Manager et injecté dans les pods à l'exécution ; il n'apparaît jamais en clair dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

La charge de travail est exposée via une IP Cloud Load Balancing externe. `enable_custom_domain` vaut `true` par défaut, ce qui provisionne un Ingress Kubernetes avec un certificat géré par Google pour les noms d'hôte de `application_domains` ; une IP statique est réservée par défaut (`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

La sortie stdout/stderr des pods est envoyée vers Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ghost {#3-ghost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` se connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente la base de données Ghost (avec le jeu de caractères `utf8mb4` et la collation `utf8mb4_0900_ai_ci`), crée l'utilisateur de l'application et lui accorde tous les privilèges. Le job s'exécute à chaque apply et peut être relancé sans risque.
- **Premier démarrage lent.** Ghost exécute les migrations de base de données et compile les thèmes au premier démarrage. La sonde de démarrage accorde un délai initial de 90 secondes (`initial_delay_seconds = 90`, `failure_threshold = 10`) — ne le réduisez pas en dessous de 60 secondes, sinon Ghost sera arrêté avant d'avoir fini de s'initialiser.
- **Détection dynamique de l'URL.** Au démarrage, le script de point d'entrée personnalisé interroge le serveur de métadonnées Cloud Run/GKE pour découvrir l'URL du service et l'exporter en tant que `url` et `admin__url` pour Ghost. Une variable d'environnement `url` explicite est toujours prioritaire.
- **Connexion à la base de données.** Le point d'entrée associe automatiquement les variables `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD` et `DB_PORT` du socle aux paramètres `database__connection__*` de Ghost. Lorsque `DB_HOST` commence par `/`, il est traité comme un chemin de socket Unix.
- **SMTP pour les e-mails.** Ghost nécessite SMTP pour les inscriptions des membres, les réinitialisations de mot de passe et l'envoi des newsletters. Les `environment_variables` sont pré-remplies (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL`, `EMAIL_FROM`) — configurez-les avant d'inviter des membres.
- **Connexion administrateur.** Le panneau d'administration de Ghost se trouve à `<url>/ghost`. Au premier démarrage, Ghost crée un utilisateur administrateur de manière interactive.
- **Chemin de santé.** Les sondes de disponibilité et de vivacité ciblent `/`, qui renvoie HTTP 200 lorsque Ghost est entièrement initialisé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Ghost ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `application_name` | `ghost` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Ghost Blog` | Nom convivial affiché dans la console. |
| `application_description` | `Ghost Publishing Platform on GKE Autopilot` | Annotation de description de la charge de travail. |
| `application_version` | `6.14.0` | Tag de version de l'image Ghost ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; 2 vCPU minimum pour Ghost 6.x. |
| `memory_limit` | `4Gi` | Mémoire par pod ; 4 GiB recommandés (Ghost subit des OOM en dessous de 1 GiB). |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez une valeur ≥ 1 pour éviter les démarrages à froid et les délais de migration. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `2368` | Port HTTP natif de Ghost. Ne le modifiez pas, sauf si votre Dockerfile écoute sur un autre port. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build (par défaut) ; `prebuilt` déploie une image existante. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. Obligatoire pour Ghost. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{SMTP_HOST="", SMTP_PORT="587", SMTP_USER="", SMTP_PASSWORD="", SMTP_SSL="false", EMAIL_FROM="ghost@example.com"}` | Paramètres SMTP pré-remplis pour l'envoi d'e-mails par Ghost. `database__client=mysql` est injecté automatiquement — ne le définissez pas ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les sessions d'administration et d'adhésion de Ghost. |
| `workload_type` | `null` | Se résout automatiquement en StatefulSet lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active des PVC par pod pour les déploiements StatefulSet. |
| `stateful_pvc_size` | `10Gi` | Stockage par pod. Prévoyez davantage pour les publications actives riches en médias. |
| `stateful_pvc_mount_path` | `/data` | Chemin du PVC par pod dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Utilisez obligatoirement des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 90s, 10 échecs | Sonde HTTP sur le chemin racine de Ghost (200 lorsqu'il est prêt). Délai généreux pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60s | Sonde de vivacité ciblant le chemin racine de Ghost. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés pour les tâches de maintenance de Ghost. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez [App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le contenu Ghost (laissez-le activé en multi-réplicas). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket supplémentaire défini dans `storage_buckets`. Le bucket `ghost-content` est toujours provisionné automatiquement. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets supplémentaires en plus du bucket de contenu provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour la mise en cache des pages de Ghost. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP de l'hôte NFS ; définissez-le explicitement lorsque NFS est désactivé. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Ghost nécessite MySQL 8.0 — ne le modifiez pas. |
| `db_name` | `ghost` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `ghost` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `application_database_name` | `gkeappdb` | Nom de la base de données Cloud SQL (variable d'App_GKE). Remplacez-le par `ghost` par souci de cohérence. |
| `application_database_user` | `gkeappuser` | Utilisateur Cloud SQL (variable d'App_GKE). Remplacez-le par `ghost` par souci de cohérence. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; passez à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. Ghost doit connaître son URL publique au démarrage — assurez-vous que le domaine correspond. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Ghost. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Ghost. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `ghost-content`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Ghost nécessite MySQL 8.0 ; tout autre moteur empêche le démarrage. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, le contenu téléversé est perdu au redémarrage d'un pod et n'est pas partagé entre les réplicas. |
| `container_port` | `2368` | Critique | Port natif de Ghost ; une incohérence fait échouer toutes les sondes de santé. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `startup_probe` initial_delay_seconds | `90` | Élevé | Une valeur inférieure à 60 conduit Kubernetes à arrêter Ghost avant la fin de l'exécution des migrations. |
| `enable_redis` | `true` | Élevé | Sans Redis, Ghost sert toutes les pages sans cache, ce qui augmente la charge sur la base de données. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison valide si Redis est activé alors que NFS est désactivé et qu'aucun hôte n'est défini. |
| `memory_limit` | `4Gi` | Élevé | Une mémoire insuffisante provoque un OOM de Node.js lors de l'envoi des newsletters ou de la compilation des thèmes. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions d'administration de Ghost en multi-réplicas échouent par intermittence. |
| Paramètres SMTP de `environment_variables` | un vrai serveur SMTP | Élevé | Sans envoi d'e-mails, pas d'inscriptions de membres, pas de réinitialisations de mot de passe, pas de newsletters. |
| `container_image_source` | `custom` | Élevé | L'image Ghost amont ne dispose pas du point d'entrée personnalisé qui mappe les identifiants de la base de données et détecte l'URL du service. |
| `min_instance_count` | `1` | Moyen | `0` provoque des démarrages à froid pendant lesquels Ghost exécute les migrations, ce qui fait expirer les premières requêtes. |
| `enable_iap` / `enable_cloud_armor` | à activer pour l'administration | Moyen | Sinon, le panneau d'administration de Ghost (`/ghost`) est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `pdb_min_available` par rapport à `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Ghost, partagée avec la variante Cloud Run, est décrite dans **[Ghost_Common](Ghost_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ghost sur GKE Autopilot](../labs/Ghost_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Ghost sur Google Cloud Run](Ghost_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ghost Common — Configuration applicative partagée](Ghost_Common.md) — la configuration partagée par les deux cibles de déploiement.
