---
title: "Directus sur Cloud Run"
description: "Référence de configuration pour déployer Directus sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Directus_CloudRun.md @ 3055034 sha256:0bd831974819 -->

# Directus sur Cloud Run {#directus-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Directus_CloudRun.png" alt="Directus sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Directus est une plateforme open source de CMS headless et de Backend-as-a-Service (BaaS) qui encapsule n'importe quelle base de données SQL avec des API REST et GraphQL générées automatiquement et une application d'administration sans code. Ce module déploie Directus sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Directus et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Directus s'exécute sous la forme d'un conteneur Node.js sur Cloud Run entièrement géré. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Serverless, mise à l'échelle automatique jusqu'à zéro entre les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Directus impose en dur `DB_CLIENT = "pg"` |
| Fichiers partagés | Filestore (NFS) | Ressources et médias téléversés partagés entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléversements ; GCS est le pilote de stockage par défaut de Directus |
| Cache | Redis | Activé par défaut ; utilise par défaut l'adresse IP de l'hôte NFS lorsqu'aucun hôte explicite n'est défini |
| Secrets | Secret Manager | KEY, SECRET, ADMIN_PASSWORD et URL de connexion REDIS générés automatiquement |
| Entrée | Cloud Load Balancing | HTTPS via un NEG serverless + domaine personnalisé et certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Directus impose en dur `DB_CLIENT = "pg"`. Passer à MySQL ou à `NONE` empêche le démarrage.
- **GCS est le pilote de stockage de fichiers par défaut.** `Directus_Common` injecte automatiquement `STORAGE_GCS_DRIVER`, `STORAGE_GCS_BUCKET` et `STORAGE_LOCATIONS = "gcs"`, de sorte que tous les téléversements aboutissent dans le bucket Cloud Storage dédié.
- **La migration automatique et l'amorçage s'exécutent à chaque démarrage.** `AUTO_MIGRATE = "true"` applique toutes les migrations de schéma de base de données en attente au démarrage. `BOOTSTRAP = "true"` crée l'utilisateur administrateur et les collections système au premier démarrage — les deux opérations sont idempotentes.
- **La mise à l'échelle à zéro est la valeur par défaut** (`min_instance_count = 0`). Directus utilise des sessions stockées dans Redis, de sorte que les démarrages à froid sont acceptables pour les déploiements dont la latence n'est pas critique. Définissez `min_instance_count = 1` pour éliminer les démarrages à froid en production.
- **Les KEY et SECRET de Directus** sont générés automatiquement et stockés dans Secret Manager. Leur rotation après le premier déploiement invalide toutes les sessions actives et tous les JWT.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `SERVICE_NAME` sont définis. Le nom du service et les autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. Service Cloud Run — la charge de travail Directus {#a-cloud-run-service--the-directus-workload}

Directus s'exécute sous la forme d'un unique service Cloud Run. Chaque nouveau déploiement crée une nouvelle révision ; la gestion du trafic détermine quelle révision reçoit le trafic.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, la répartition du trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  # Stream live logs:
  gcloud run services logs tail "$SERVICE_NAME" --project "$PROJECT" --region "$REGION"
  # Verify the health endpoint manually:
  curl -sf "$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" --format='value(status.url)')/server/ping"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour l'autoscaling, la concurrence, les environnements d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Directus stocke toutes les données applicatives dans une instance gérée Cloud SQL for PostgreSQL 15. Les instances se connectent par défaut en **TCP** (connecteur Cloud SQL, sans socket Unix par défaut sur Cloud Run). Une tâche `db-init` s'exécute à chaque apply (de manière idempotente) : elle crée la base de données et l'utilisateur de l'application, accorde les privilèges et installe l'extension `uuid-ossp`.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe, consultez [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les ressources téléversées sont écrites sur un partage **Filestore (NFS)** monté dans chaque instance, afin que tous les réplicas voient les mêmes fichiers. Un bucket **Cloud Storage** dédié aux téléversements est également provisionné ; Directus est configuré pour utiliser GCS comme pilote de stockage principal via `STORAGE_GCS_DRIVER = "gcs"`.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le bucket des téléversements.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis sert de support à la mise en cache des réponses d'API de Directus et à l'état de limitation de débit. Lorsqu'aucun hôte Redis explicite n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis par défaut. L'URL de connexion Redis complète (y compris un éventuel mot de passe d'authentification) est stockée comme secret Secret Manager et injectée sous forme de variable d'environnement `REDIS`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  # Confirm REDIS is injected into the Cloud Run service environment:
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" \
    --format='yaml(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Quatre secrets sont générés et stockés automatiquement : `KEY` (chiffrement des données), `SECRET` (signature des JWT), `ADMIN_PASSWORD` (compte administrateur initial) et `REDIS` (URL de connexion Redis lorsque Redis est activé). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password:
  gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"
  # Retrieve the DB password:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Le nom `database_password_secret` figure dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle d'injection des secrets.

### F. Réseau et entrée {#f-networking--ingress}

Le service Cloud Run est placé derrière un groupe de points de terminaison du réseau (NEG) serverless rattaché à un équilibreur de charge Cloud global. HTTPS est géré automatiquement. Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée.

- **Console :** Services réseau → Équilibrage de charge ; Cloud Run → service → onglet Mise en réseau.
- **CLI :**
  ```bash
  gcloud run services describe "$SERVICE_NAME" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des conteneurs sont envoyées vers Cloud Logging. Les métriques Cloud Run et les tests de disponibilité facultatifs sont envoyés vers Cloud Monitoring.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE_NAME"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Directus {#3-directus-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche `db-init` s'exécute à chaque apply (`execute_on_apply = true`). Elle crée l'utilisateur de base de données Directus avec le mot de passe généré, crée la base de données `directus`, installe l'extension `uuid-ossp` et accorde tous les privilèges. La tâche est idempotente.
- **Amorçage au premier démarrage.** `BOOTSTRAP = "true"` crée l'utilisateur administrateur initial et les collections système de Directus au premier démarrage. L'adresse e-mail de l'administrateur vaut par défaut `admin@example.com` — **remplacez-la via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement.**
- **Migrations à chaque démarrage.** `AUTO_MIGRATE = "true"` fait exécuter `database migrate:latest` par Directus à chaque démarrage d'instance, de sorte que la mise à niveau de `application_version` applique automatiquement les changements de schéma.
- **Sonde de santé.** La sonde de démarrage cible `/server/ping` avec un délai initial de 30 secondes et un seuil d'échec généreux (`failure_threshold = 10`, `period_seconds = 20`) pour laisser le temps à la configuration de la base de données au premier démarrage. La sonde de vivacité cible également `/server/ping`.
- **Connexions TCP à la base de données par défaut.** Contrairement à la variante GKE (qui utilise un socket Unix via le sidecar Auth Proxy), la variante Cloud Run se connecte à Cloud SQL en TCP à l'aide du connecteur Cloud SQL (`enable_cloudsql_volume = false` par défaut). Le trafic sortant ne transite que vers des adresses IP privées (`vpc_egress_setting = "PRIVATE_RANGES_ONLY"`).
- **Rotation de KEY et SECRET.** La rotation du secret `KEY` invalide immédiatement toutes les sessions utilisateur actives. La rotation de `SECRET` invalide tous les JWT émis. N'effectuez jamais l'une ou l'autre sans fenêtre de maintenance planifiée ni notification des clients.
- **Connexion administrateur.** Récupérez le mot de passe administrateur généré dans Secret Manager (voir §2.E). L'adresse e-mail de l'administrateur par défaut est `admin@example.com`, sauf si elle a été remplacée.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Directus ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service Cloud Run et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Ne le modifiez pas après le premier déploiement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `directus` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement — il est intégré aux identifiants des secrets Secret Manager. |
| `display_name` | `Directus CMS` | Nom convivial affiché dans la console. |
| `application_version` | `11.1.0` | Tag de version de l'image Directus ; incrémentez-le pour déployer une nouvelle version. Fixez un tag précis — évitez `latest` en production. |
| `description` | `Directus - Open Source Headless CMS and Backend-as-a-Service` | Annotation de description du service. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure (Cloud SQL, stockage, secrets) sans déployer le service Cloud Run. |
| `cpu_limit` | `1000m` | vCPU par instance ; 1 vCPU convient aux charges de travail légères. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 1 GiB par défaut pour un usage léger/typique (environ 150Mi observés) — portez-la à 2 GiB pour la production ou pour des schémas volumineux et des transformations d'images. |
| `cpu_always_allocated` | `false` | Facturation à la requête — sans risque pour le mode requête/réponse par défaut de Directus. Ne définissez `true` que si vous activez les abonnements temps réel/WebSocket ou des flux planifiés qui doivent s'exécuter sans requête entrante. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Définissez `1` pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Plafond de concurrence maximal. Augmentez-le pour le trafic de production. |
| `container_port` | `8055` | Port d'écoute par défaut de Directus. |
| `execution_environment` | `gen2` | Environnement d'exécution Cloud Run de deuxième génération (recommandé). |
| `enable_cloudsql_volume` | `false` | Connexion TCP par défaut ; définissez `true` pour activer le socket Unix via le sidecar Auth Proxy. |

### Groupe 5 — Entrée et IAP {#group-5--ingress--iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `"all"` (public) ou `"internal-and-cloud-load-balancing"` (privé). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic vers des plages privées via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant Directus. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(valeurs SMTP par défaut)_ | Paramètres non secrets supplémentaires. La valeur par défaut inclut des variables SMTP d'exemple. **Remplacez `ADMIN_EMAIL` ici avant le premier déploiement.** |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. Définissez `enable_backup_import = false` immédiatement après une restauration réussie. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés et NFS {#group-9--custom-sql-scripts--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` | exécution de SQL depuis GCS | Consultez [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` / `nfs_instance_base_name` | référence l'instance Filestore partagée | À définir lorsque l'instance Filestore n'a pas été créée par le même déploiement Services_GCP. |

### Groupe 10 — Cloud Armor, domaines et CDN {#group-10--cloud-armor-domains--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'équilibreur de charge. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour les accès privilégiés. |
| `application_domains` | `[]` | Noms d'hôte personnalisés — à activer en production avec un vrai nom DNS. |
| `enable_cdn` | `false` | Active Cloud CDN via l'équilibreur de charge. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets supplémentaires en plus du bucket de téléversements provisionné automatiquement. |
| `storage_buckets` | `[{ name_suffix = "data", location = "" }]` | Buckets GCS supplémentaires, en plus du bucket de téléversements provisionné automatiquement par `Directus_Common`. |
| `enable_nfs` | `true` | Volume Filestore partagé pour les ressources téléversées (à laisser activé en multi-instances). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Directus nécessite PostgreSQL. Ne le modifiez pas. |
| `db_name` | `directus` | Nom de la base de données PostgreSQL. Ne le modifiez pas après le premier déploiement. |
| `db_user` | `directus` | Utilisateur de l'application. Ne le modifiez pas après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init` fournie par `Directus_Common`. |
| `cron_jobs` | `[]` | Tâches Cloud Run récurrentes (p. ex. purge du cache, synchronisation des données). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `/server/ping`, HTTP, délai de 30s, failure_threshold=10, période=20s | Sonde de démarrage Cloud Run. Accorde jusqu'à ~230 s aux migrations du premier démarrage. |
| `liveness_probe` | `/server/ping`, HTTP, délai de 15s | L'instance est redémarrée après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé par défaut, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour la mise en cache et la limitation de débit. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP de l'hôte NFS ; définissez-le explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). L'URL de connexion complète est stockée dans Secret Manager. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). Utilisez d'abord `vpc_sc_dry_run = true`. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL HTTPS publique permettant d'accéder à Directus. |
| `service_location` | Région dans laquelle le service est déployé. |
| `stage_services` | URL des services par étape Cloud Deploy (lorsque le déploiement multi-étapes est activé). |
| `load_balancer_ip` | Adresse IP externe du frontal de l'équilibreur de charge. |
| `load_balancer_url` | URL HTTPS via l'équilibreur de charge (lorsqu'un domaine personnalisé ou une IP statique est utilisé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | Hôte de la base de données (sensible — renvoyé sous la forme `(sensitive)` dans la sortie du plan). |
| `database_port` | Port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux et tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Directus nécessite PostgreSQL ; passer à MySQL ou à `NONE` empêche le démarrage et rend orpheline la base de données existante. |
| `application_name` | à définir une seule fois | Critique | Intégré aux identifiants des secrets Secret Manager (KEY, SECRET, ADMIN_PASSWORD). Le modifier recrée tous les secrets — toutes les sessions actives et tous les JWT sont immédiatement invalidés. |
| `tenant_id` | à définir une seule fois | Critique | Le modifier après le premier déploiement rend orpheline l'instance Cloud SQL et génère une nouvelle base de données vide ainsi que de nouvelles KEY/SECRET, invalidant toutes les sessions. |
| Secrets `KEY` / `SECRET` | générés automatiquement, ne jamais les faire tourner à la légère | Critique | La rotation de KEY déconnecte tous les utilisateurs. La rotation de SECRET invalide tous les jetons d'API. N'effectuez de rotation que pendant une fenêtre de maintenance planifiée. |
| Variable d'environnement `ADMIN_EMAIL` | une adresse e-mail réelle | Élevé | La valeur par défaut `admin@example.com` crée le compte administrateur avec une adresse e-mail facile à deviner. Remplacez-la via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement. |
| `enable_nfs` | `true` | Élevé | Sans NFS partagé, les ressources téléversées écrites par une instance sont invisibles pour les autres et perdues lors d'une réduction d'échelle (sauf si GCS est utilisé exclusivement). |
| `enable_redis` | `true` en multi-instances | Élevé | Sans Redis, chaque instance dispose d'un cache isolé ; la limitation de débit s'applique par instance et la mise en cache de Directus ne fonctionne plus entre les réplicas. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison Redis valide si Redis est activé, NFS désactivé et aucun hôte défini. |
| `startup_probe.failure_threshold` | `10` au premier déploiement | Élevé | Trop bas : les migrations de Directus peuvent prendre 1 à 3 minutes sur une base de données vierge ; l'instance est arrêtée avant la fin des migrations. |
| `enable_backup_import` | `false` après restauration | Élevé | Le laisser à `true` relance l'importation à chaque apply, écrasant les données en production par la sauvegarde obsolète. |
| `memory_limit` | `2Gi` | Élevé | Une mémoire insuffisante provoque des arrêts OOM lors du chargement du schéma ou de la transformation d'images. |
| `min_instance_count` | `1` en production | Moyen | `0` en production provoque des démarrages à froid de 20 à 40 s sur la première requête d'API après une période d'inactivité. |
| `max_instance_count` | à adapter au trafic | Moyen | `1` bloque la mise à l'échelle horizontale et provoque la mise en file d'attente des requêtes sous charge. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les usages d'administration | Moyen | Sinon, l'interface d'administration est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de rétention liées à la conformité. |
| `enable_vpc_sc` + `vpc_sc_dry_run` | commencer avec `vpc_sc_dry_run = true` | Critique | Activer l'application sans inclure le compte de service dans le niveau d'accès bloque simultanément Cloud SQL, Secret Manager et Artifact Registry. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Directus partagée avec la variante GKE est décrite dans **[Directus_Common](Directus_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Directus sur Cloud Run](../labs/Directus_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Directus sur GKE Autopilot](Directus_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Directus Common — Configuration applicative partagée](Directus_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Umami sur Google Cloud Run](Umami_CloudRun.md) dans la solution **Headless Content Platform**.
