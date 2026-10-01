---
title: "Windmill sur Google Cloud Run"
description: "Référence de configuration pour déployer Windmill sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Windmill_CloudRun.md @ 3055034 sha256:e458148feae2 -->

# Windmill sur Google Cloud Run {#windmill-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_CloudRun.png" alt="Windmill sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill est une plateforme de développement open source permettant de créer des outils internes, des scripts, des flux et des automatisations. Ce module déploie Windmill sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Windmill et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Windmill s'exécute sous forme de conteneur combiné serveur+worker sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service combiné serveur+worker, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 16 | Obligatoire — Windmill nécessite PostgreSQL 16 ou une version ultérieure |
| Stockage d'objets | Cloud Storage | Un bucket `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties de workflows et les artefacts |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement et secret SMTP provisoire |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 16 est obligatoire.** Windmill utilise des fonctionnalités propres à PostgreSQL ; le moteur de base de données est fixe. Utiliser une version plus ancienne ou `NONE` fait échouer le job d'initialisation.
- **Mode combiné serveur+worker.** `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur d'API et les workers d'exécution de scripts dans la même instance de conteneur. Pour une mise à l'échelle indépendante des workers à haut débit, utilisez `Windmill_GKE`.
- **`DISABLE_NSJAIL=true` est injecté automatiquement.** Cloud Run n'accorde pas `CAP_SYS_ADMIN` ; l'isolation par espaces de noms Linux de Windmill est donc désactivée.
- **Les sondes de santé utilisent HTTP `GET /api/version`.** Ce point de terminaison léger renvoie la chaîne de version de Windmill lorsque le service est prêt. Cloud Run n'émet pas de redirection HTTP→HTTPS sur ce chemin, si bien qu'une sonde HTTP fonctionne correctement.
- **`BASE_URL` et `BASE_INTERNAL_URL` sont construites au démarrage** à partir de variables injectées par la plateforme, afin que les callbacks OAuth et les URL de webhook soient résolus correctement.
- **Redis est désactivé par défaut.** Windmill fonctionne sans Redis pour les déploiements à instance unique. Activez Redis pour un comportement de file d'attente distribuée avec plusieurs instances.
- **Un secret SMTP provisoire est provisionné automatiquement.** Remplacez la valeur `{prefix}-smtp-password` dans Secret Manager avant d'activer les notifications par e-mail.
- **`min_instance_count` vaut `0` par défaut** (mise à l'échelle à zéro). Définissez-la à `1` pour garder une instance active, afin que les déclencheurs de webhook et les flux planifiés ne nécessitent pas de démarrage à froid.
- **`cpu_always_allocated` vaut `false` par défaut** — Windmill fait partie des 12 applications délibérément basculées vers une facturation avec démarrage à froid lors de la passe « coût d'abord » du 2026-07-09 (facturation à la requête, associée à `min_instance_count=0`). Les flux planifiés et les exécutions en file d'attente sont différés jusqu'à ce qu'une requête réveille le worker ; externalisez les planifications avec Cloud Scheduler, ou définissez `cpu_always_allocated = true` et `min_instance_count >= 1` pour rétablir un fonctionnement continu et toujours actif.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Windmill {#a-cloud-run--the-windmill-service}

Windmill s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 16 {#b-cloud-sql-for-postgresql-16}

Windmill stocke toutes les données applicatives — scripts, flux, variables, ressources, planifications et historique des jobs — dans une instance gérée Cloud SQL for PostgreSQL 16. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix (sans IP publique). Lors du premier déploiement, un job d'initialisation crée de manière idempotente la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est provisionné pour les sorties de workflows, les artefacts et les dépendances des scripts. L'accès est accordé automatiquement au compte de service de la charge de travail.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options de buckets supplémentaires, les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données et le mot de passe SMTP provisoire sont stockés dans Secret Manager et injectés dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging au format JSON structuré (`JSON_FMT=true`). Les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option. Un point de terminaison de métriques Prometheus est exposé sur `:9001` pour une collecte au sein du VPC.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Windmill {#3-windmill-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) s'exécute au premier déploiement avec `postgres:16-alpine`. Il crée de manière idempotente les rôles `windmill_admin` et `windmill_user`, l'utilisateur de l'application et la base de données de l'application, puis accorde tous les privilèges. Le job peut être relancé sans risque.
- **Migrations de schéma automatiques.** Windmill exécute ses propres migrations de base de données au démarrage ; la mise à niveau de `application_version` applique donc automatiquement les modifications de schéma.
- **Mode combiné serveur+worker.** Chaque instance exécute à la fois l'API/le planificateur Windmill et `NUM_WORKERS=3` workers d'exécution de scripts. Les workers exécutent des scripts Python, TypeScript, Bash, Go et SQL dans des sous-processus isolés. L'affectation `WORKER_GROUP=default` signifie que tous les flux et scripts sont acheminés par défaut vers ces instances.
- **Construction de `BASE_URL` et `DATABASE_URL`.** Le shim `entrypoint.sh` construit `DATABASE_URL` au démarrage à partir des variables `DB_*` injectées par la plateforme, en gérant à la fois les connexions par socket Unix (Auth Proxy) et TCP. `BASE_URL` et `BASE_INTERNAL_URL` sont définies à partir de l'URL prévue du service, afin que les callbacks OAuth et les webhooks soient résolus correctement.
- **Métriques Prometheus.** `METRICS_ADDR=:9001` expose les métriques Windmill sur `http://<instance-ip>:9001/metrics` pour une collecte depuis le VPC.
- **Chemin de santé.** Les sondes de démarrage et d'activité utilisent toutes deux `GET /api/version`. Ce point de terminaison renvoie HTTP 200 avec la chaîne de version lorsque Windmill est prêt à servir du trafic.
- **Notifications par e-mail SMTP.** Le secret `WINDMILL_SMTP_PASS` est initialisé avec une valeur provisoire de 16 caractères. Remplacez-la et fournissez `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT` et `WINDMILL_SMTP_FROM` via `environment_variables` pour activer les notifications par e-mail depuis les flux et les scripts.
- **Inspecter les jobs et leurs exécutions :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Windmill ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `windmill` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Windmill` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Windmill ; définissez une version précise (par ex. `1.400.0`) pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image avec le Dockerfile fourni ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `""` | URI d'image de remplacement. Laissez vide pour que Cloud Build la gère. |
| `cpu_limit` | `2000m` | CPU par instance. 2 vCPU est le minimum recommandé pour le mode combiné serveur+worker. |
| `memory_limit` | `2Gi` | Mémoire par instance. 4 GiB recommandés pour les charges de travail Python/TypeScript en production. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Définissez ≥ 1 pour que les webhooks et les flux planifiés soient toujours disponibles sans démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximal d'instances. Utilisez Redis au-delà de 1 pour coordonner les files d'attente de jobs. |
| `container_port` | `8000` | Windmill écoute sur le port 8000. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS Fuse et une compatibilité Linux complète. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. Augmentez-la (jusqu'à 3600) pour les scripts de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis pour la connexion par socket Unix. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Windmill dans Artifact Registry pour éviter les limites de débit de ghcr.io. |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green entre les révisions. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés avec les valeurs par défaut de Windmill. Permet de définir `WINDMILL_SMTP_HOST`, des remplacements de `NUM_WORKERS`, etc. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. `WINDMILL_SMTP_PASS` est injecté automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Délai d'attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge (seuls les assets statiques en bénéficient). |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `data` et les éventuels buckets supplémentaires. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé par défaut — Windmill ne nécessite pas de stockage de fichiers partagé. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via la fonctionnalité de volume de stockage de Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixe — Windmill nécessite PostgreSQL 16. Ne la modifiez pas. |
| `db_name` | `windmill` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `windmill` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job PostgreSQL `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/version`, délai initial de 60s, 10 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/version`, délai initial de 60s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/version` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour un comportement de file d'attente distribuée (facultatif). |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critical | Windmill nécessite PostgreSQL 16 ; une version plus ancienne fait échouer le job d'initialisation et la base de données reste non initialisée. |
| `db_name` / `db_user` | défini une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit tous les scripts, flux et l'historique des jobs. |
| `enable_cloudsql_volume` | `true` | Critical | Windmill se connecte via le socket Unix de l'Auth Proxy ; le désactiver provoque une défaillance immédiate de la base de données et le plantage des conteneurs au démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `cpu_limit` | `2000m` | High | Le mode combiné exécute 3 workers dans le processus ; un CPU insuffisant ralentit toute l'exécution des scripts. Chaque worker nécessite environ 500m. |
| `memory_limit` | `2Gi` | High | Les workers Windmill exécutent des scripts utilisateur arbitraires ; les arrêts pour manque de mémoire (OOM) en cours d'exécution produisent des échecs silencieux dans l'interface. |
| `min_instance_count` | `0` (par défaut, mise à l'échelle à zéro) | Medium | Passez-la à `1` pour garder une instance active et éviter les démarrages à froid pour les webhooks et les flux planifiés ; augmente le coût de base. |
| `cpu_always_allocated` | `false` (par défaut, démarrage à froid « coût d'abord ») | Medium | Les jobs planifiés et les exécutions en file d'attente sont différés jusqu'à ce qu'une requête réveille le worker ; externalisez-les avec Cloud Scheduler, ou définissez `true` + `min_instance_count >= 1` pour un fonctionnement continu. |
| `service_url` / `BASE_URL` | URL Cloud Run ou domaine personnalisé | High | Une valeur vide ou incorrecte casse les callbacks OAuth, les points de terminaison de webhook et les liens profonds de l'interface Windmill. |
| `execution_environment` | `gen2` | High | Gen1 ne prend pas en charge les montages GCS Fuse ; requis lorsque `gcs_volumes` est utilisé. |
| `enable_vpc_sc` | `false` sauf si nécessaire | High | Nécessite un `organization_id` explicite ; sans lui, VPC-SC est ignoré silencieusement, ce qui donne une fausse impression de sécurité périmétrique. |
| `enable_redis` | `false` pour une instance unique, `true` pour plusieurs | Medium | Sans Redis, chaque instance ne traite que sa propre file d'attente, ce qui peut entraîner des duplications ou des famines de jobs. |
| `max_instance_count` | `3` | Medium | Au-delà d'une instance sans coordination Redis, un même job peut être pris en charge simultanément par plusieurs workers. |
| `timeout_seconds` | `300` (à augmenter pour les jobs longs) | Medium | Les jobs Windmill qui dépassent le délai d'expiration des requêtes Cloud Run sont interrompus en cours d'exécution sans erreur explicite. |
| `backup_schedule` | `0 2 * * *` | Medium | Une chaîne vide désactive les sauvegardes ; Windmill stocke toutes les définitions d'automatisation dans PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sans ces options, l'interface et l'API Windmill sont accessibles publiquement. |
| `WINDMILL_SMTP_*` (via les variables d'environnement) | tous les champs définis ensemble | Medium | Une configuration SMTP partielle provoque des échecs silencieux de remise des e-mails, sans erreur à l'exécution. |
| `enable_auto_password_rotation` | `false` | Medium | Lorsqu'elle est activée, la révision Cloud Run doit être redéployée après la rotation ; sinon elle utilise un mot de passe expiré jusqu'à ce que les connexions échouent. |

---

Pour le comportement du socle référencé tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Windmill, partagée avec la variante GKE, est décrite dans **[Windmill_Common](Windmill_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Windmill sur Cloud Run](../labs/Windmill_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Windmill sur GKE Autopilot](Windmill_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Windmill Common — Configuration applicative partagée](Windmill_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Kestra sur Google Cloud Run](Kestra_CloudRun.md), [Temporal sur GKE Autopilot](Temporal_GKE.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) dans la solution **Data & Workflow Orchestration**.
