---
title: "ToolJet sur GKE Autopilot"
description: "Référence de configuration pour déployer ToolJet sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ToolJet_GKE.md @ 3055034 sha256:a764cbf85f84 -->

# ToolJet sur GKE Autopilot {#tooljet-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ToolJet_GKE.png" alt="ToolJet sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ToolJet est une plateforme low-code open source permettant de créer et de déployer
des outils internes — tableaux de bord, panneaux d'administration, applications CRUD
et workflows — à l'aide d'un éditeur glisser-déposer branché sur vos propres bases de
données et API. Ce module déploie ToolJet sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par ToolJet et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ToolJet s'exécute sous forme d'une unique charge de travail web NestJS + React —
l'API backend et le client compilé sont servis par le même processus
(`SERVE_CLIENT = "true"`) sur le port 80. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — **deux** bases de données sur une même instance (métadonnées + ToolJet Database) |
| ToolJet Database | PostgREST dans le conteneur | Sert la seconde base (`tooljet_db`) aux requêtes des applications ; signé avec `PGRST_JWT_SECRET` |
| Cache et file d'attente | Redis | Activé par défaut ; sert de support aux files BullMQ de ToolJet ; la VM NFS héberge aussi Redis lorsque `redis_host` est vide |
| Secrets | Secret Manager | `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Deux bases de données sont créées.** La tâche `db-init` du premier déploiement
  crée la base de métadonnées (`tooljet`) et la seconde « ToolJet Database »
  (`tooljet_db`), et accorde au rôle applicatif partagé l'attribut **`CREATEROLE`**.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée du
  conteneur exécute `npm run db:migrate:prod` (TypeORM) **avant** de lancer le
  serveur.
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont générés
  automatiquement** et stockés dans Secret Manager. Ces clés ne doivent jamais faire
  l'objet d'une rotation après le premier démarrage — la rotation de
  `LOCKBOX_MASTER_KEY` corrompt tous les identifiants de sources de données stockés,
  et celle de `SECRET_KEY_BASE` invalide toutes les sessions.
- **L'affinité de session est `ClientIP` par défaut.** L'éditeur d'applications de
  ToolJet utilise des connexions WebSocket persistantes pour l'édition multijoueur ;
  les requêtes d'un même client doivent atteindre le même pod.
- **`PORT` prend par défaut la valeur 80 dans le point d'entrée.** GKE n'injecte pas
  `PORT` ; sans cette valeur par défaut, ToolJet écouterait sur le port 3000 alors
  que le Service et les sondes ciblent le port 80.
- **Redis est activé par défaut** et, lorsque `redis_host` est vide, l'IP de la VM
  du serveur NFS est injectée comme `REDIS_HOST` (`enable_nfs = true` provisionne
  cette VM).
- **Une IP externe stable + un hôte HTTPS `nip.io`** sont provisionnés d'office
  (`reserve_static_ip = true`, `enable_custom_domain = true`).
- **L'inscription est désactivée par défaut.** `DISABLE_SIGNUPS = "true"` est activé
  d'office ; le premier lancement est un **assistant de configuration** qui crée
  l'utilisateur administrateur initial et l'espace de travail.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ToolJet {#a-gke-autopilot--the-tooljet-workload}

Les pods ToolJet sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail ToolJet pour afficher les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 — deux bases de données {#b-cloud-sql-for-postgresql-15--two-databases}

ToolJet stocke toutes les données applicatives — applications, configurations des
sources de données, utilisateurs, espaces de travail, sessions — dans une instance
managée Cloud SQL for PostgreSQL 15, et utilise une **seconde base de données**
(`tooljet_db`) sur la même instance pour la fonctionnalité intégrée ToolJet Database.
Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un
point de terminaison TCP de loopback (`127.0.0.1`) ; aucune IP publique n'est
exposée. Au premier déploiement, un job d'initialisation crée les deux bases de
données, le rôle partagé `CREATEROLE`, `pgcrypto` et un schéma `postgrest`
appartenant à l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=tooljet_db --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

> **`enable_cloudsql_volume` doit rester à `true` sur GKE.** Le sidecar Auth Proxy
> fournit le point de terminaison PostgreSQL `127.0.0.1` dont dépendent le pod et la
> tâche `db-create` ; le désactiver sur GKE bloque `db-create`.

### C. Redis (file d'attente et cache) {#c-redis-queue--cache}

Redis est **activé par défaut** et sert de support aux files BullMQ de ToolJet
(tâches d'arrière-plan, notifications, éditeur multijoueur). Lorsque `redis_host`
est laissé vide et que `enable_nfs = true`, l'IP privée de la VM du serveur NFS est
injectée comme `REDIS_HOST` ; définissez explicitement `redis_host` pour pointer vers
une instance Memorystore à la place.

- **Console :** Memorystore → Redis (si vous utilisez une instance managée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the host injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `SECRET_KEY_BASE` (signe les sessions), `LOCKBOX_MASTER_KEY` (chiffre tous
les identifiants de sources de données stockés) et `PGRST_JWT_SECRET` (signe les JWT
PostgREST internes). Le mot de passe de la base de données est géré séparément par
le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing,
avec un hôte HTTPS `nip.io` et un certificat géré par Google. Un domaine personnalisé
peut être activé, et une IP statique est réservée afin que l'adresse survive aux
redéploiements. `TOOLJET_HOST` (qui détermine les liens générés et les URI de
redirection OAuth) prend par défaut l'URL calculée du service.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### F. Cloud Storage et NFS {#f-cloud-storage--nfs}

ToolJet stocke les applications, les configurations des sources de données et les
fichiers téléversés dans PostgreSQL ; un bucket Cloud Storage `data` est provisionné
par défaut (`storage_buckets`), mais ToolJet lui-même n'en dépend pas. NFS est activé
par défaut uniquement parce que sa VM héberge aussi Redis lorsque `redis_host` est
vide ; les pods ToolJet eux-mêmes sont sans état.

- **Console :** Cloud Storage → Buckets ; Compute Engine → Instances de VM (serveur
  NFS).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="labels.managed-by=services-gcp"
  ```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
de GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ToolJet {#3-tooljet-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente la base de métadonnées
  et la ToolJet Database, le rôle partagé `CREATEROLE`, accorde `cloudsqlsuperuser`,
  pré-crée `pgcrypto` et réinitialise le schéma `postgrest` pour qu'il appartienne à
  l'application sur les deux bases. Sans schéma `postgrest` appartenant à
  l'application, le `reconfigurePostgrest` exécuté par ToolJet au démarrage échoue
  avec `permission denied for schema postgrest` et le pod redémarre en boucle. La
  tâche peut être réexécutée sans risque.
- **Les migrations s'exécutent avant le démarrage du serveur.** `cloud-entrypoint.sh`
  exécute d'abord `npm run db:migrate:prod` (TypeORM `migration:run`) — le
  `start:prod` de ToolJet est `node dist/src/main` et n'effectue **aucune**
  migration. Sans cette étape, la base de métadonnées reste vide et toute action
  reposant sur la base échoue (`relation "user_sessions" does not exist`).
- **`SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY` et `PGRST_JWT_SECRET` sont immuables
  après le premier démarrage.** Modifier `LOCKBOX_MASTER_KEY` corrompt tous les
  identifiants de sources de données stockés ; modifier `SECRET_KEY_BASE` invalide
  toutes les sessions. N'y touchez que pendant une fenêtre de maintenance planifiée.
- **Le premier lancement est un assistant de configuration.** Avec
  `DISABLE_SIGNUPS = "true"`, ouvrez l'URL externe et terminez l'assistant : il crée
  le premier utilisateur administrateur et l'espace de travail, puis vous mène à
  l'éditeur d'applications.
- **L'édition multijoueur nécessite des sessions persistantes.**
  `session_affinity = "ClientIP"` maintient la connexion WebSocket d'un client sur un
  même pod ; sans cela, la collaboration en temps réel dans l'éditeur est perturbée.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/` par défaut
  (le client servi est public et non authentifié) ; `/api/health` est également
  disponible comme chemin de sonde. Prévoyez plusieurs minutes au premier démarrage
  pour l'étape de migration.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à ToolJet ou notables pour lui sont
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
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tooljet` | Nom de base des ressources (et racine de l'espace de noms). Ne pas modifier après le premier déploiement. |
| `application_display_name` | `ToolJet` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `tooljet/tooljet-ce` ; épinglez une version précise en production. |
| `application_database_name` | `tooljet` | Nom de la base de métadonnées. Immuable après le premier déploiement. |
| `application_database_user` | `tooljet` | Utilisateur de base de données de l'application (partagé par les deux bases). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et demandes de CPU/mémoire par pod. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. **À n'augmenter que si Redis est activé** (il l'est par défaut). |
| `enable_vertical_pod_autoscaling` | `false` | VPA pour l'ajustement automatique des demandes. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — obligatoire sur GKE. |
| `enable_image_mirroring` | `true` | Met en miroir l'image ToolJet dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `SECRET_KEY_BASE`, `LOCKBOX_MASTER_KEY`, `PGRST_JWT_SECRET` ni `PG_*` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (auto) | `Deployment` ou `StatefulSet` ; se résout en `Deployment` s'il n'est pas défini. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour l'éditeur multijoueur WebSocket. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Active les modèles de PVC. Non recommandé — ToolJet stocke tout son état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 60s | Sonde de démarrage avec un budget large (30 × 15s) pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | activées, HTTP `/` | Sondes d'infrastructure au niveau d'App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de ToolJet. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut ; sa VM héberge aussi Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/opt/tooljet/storage` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS configurés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée un bucket `data` (l'état propre de ToolJet réside dans PostgreSQL). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Sert de support aux files BullMQ de ToolJet. Transmis tel quel. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`), ou définissez un point de terminaison Memorystore. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16/17 — Backend de base de données {#group-1617--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17/6 — Sauvegarde et maintenance {#group-176--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à porter à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 10/19 — Domaine personnalisé, IP statique et réseau {#group-1019--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress + un certificat géré (hôte `nip.io` par défaut). |
| `application_domains` | `[]` | Noms d'hôte supplémentaires à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant ToolJet. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 13/21 — Cloud Armor {#group-1321--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à disposer d'un accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à ToolJet. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de métadonnées. |
| `database_user` | Utilisateur de base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et (facultative) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `LOCKBOX_MASTER_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation corrompt définitivement tous les identifiants de sources de données stockés — ils ne peuvent plus être déchiffrés. |
| `SECRET_KEY_BASE` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critical | Sa rotation invalide toutes les sessions actives et oblige tout le monde à se reconnecter immédiatement. |
| `PGRST_JWT_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation casse la couche de requêtes de la ToolJet Database jusqu'à ce que chaque pod redémarre. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE ; le désactiver bloque `db-create`. |
| Rôle applicatif `CREATEROLE` (défini par `db-init`) | Laisser tel que provisionné | High | Sans lui, la création d'espaces de travail ToolJet échoue avec `permission denied to create role`. |
| Schéma `postgrest` appartenant à l'application (défini par `db-init`) | Laisser tel que provisionné | High | Un schéma appartenant à `postgres` fait échouer `reconfigurePostgrest` et le pod redémarre en boucle. |
| `PORT` (valeur par défaut 80 du point d'entrée) | Laisser tel que provisionné | High | Si le pod écoute sur le port 3000 alors que le Service cible le port 80, il ne devient jamais Ready. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les reconnexions WebSocket sont acheminées vers des pods différents, ce qui perturbe l'édition multijoueur. |
| `min_instance_count` | `1` | High | GKE exige un minimum ≥ 1 ; le contrôle de validation rejette les valeurs invalides. |
| `memory_limit` | `4Gi` | High | ToolJet + PostgREST + le worker peuvent subir un arrêt OOM en dessous d'environ 2 GiB sous charge. |
| `enable_redis` | `true` | Medium | Sans Redis, BullMQ passe en mode de repli et les fonctionnalités d'arrière-plan se dégradent. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `DISABLE_SIGNUPS` (injecté automatiquement à `"true"`) | Laisser activé après le premier administrateur | High | Ouvrir l'inscription permet à quiconque dispose de l'URL de créer un compte. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à ToolJet partagée
avec la variante Cloud Run est décrite dans **[ToolJet_Common](ToolJet_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ToolJet sur GKE Autopilot](../labs/ToolJet_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [ToolJet sur Google Cloud Run](ToolJet_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ToolJet Common — Configuration applicative partagée](ToolJet_Common.md) — la configuration partagée par les deux cibles de déploiement.
