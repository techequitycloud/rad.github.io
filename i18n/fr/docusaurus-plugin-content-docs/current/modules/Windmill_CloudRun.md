---
title: "Windmill sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Windmill sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Windmill_CloudRun.md @ 15fd4c7 sha256:15532075b9d5 -->

# Windmill sur Google Cloud Run {#windmill-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Windmill_CloudRun.png" alt="Windmill sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Windmill est une plateforme de développement open source pour la création d'outils internes, de scripts, de flux et d'automatisations. Ce module déploie Windmill sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Windmill et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Windmill s'exécute comme un conteneur combiné serveur+worker sur Cloud Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service combiné serveur+worker, 2 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 16 | Requis — Windmill nécessite PostgreSQL 16 ou ultérieur |
| Stockage d'objets | Cloud Storage | Un bucket `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties et artefacts de workflow |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré et secret de remplacement SMTP |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 16 est requis.** Windmill utilise des fonctionnalités spécifiques à PostgreSQL ; le moteur de base de données est fixe. L'utilisation d'une version plus ancienne ou de `NONE` entraînera l'échec du job d'initialisation.
- **Mode combiné serveur+worker.** `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur API et les workers d'exécution de scripts dans la même instance de conteneur. Pour une mise à l'échelle indépendante des workers à haut débit, utilisez `Windmill_GKE`.
- **`DISABLE_NSJAIL=true` est injecté automatiquement.** Cloud Run n'accorde pas `CAP_SYS_ADMIN` ; l'isolation de l'espace de noms Linux de Windmill est désactivée en conséquence.
- **Les sondes de santé utilisent HTTP `GET /api/version`.** Ce point de terminaison léger renvoie la chaîne de version de Windmill lorsque le service est prêt. Cloud Run n'émet pas de redirections HTTP→HTTPS sur ce chemin, donc une sonde HTTP fonctionne correctement.
- **`BASE_URL` et `BASE_INTERNAL_URL` sont construits au démarrage** à partir de variables injectées par la plateforme afin que les rappels OAuth et les URL de webhook se résolvent correctement.
- **Redis est désactivé par défaut.** Windmill fonctionne sans Redis pour les déploiements à instance unique. Activez Redis pour un comportement de file d'attente distribuée avec plusieurs instances.
- **Un secret de remplacement SMTP est provisionné automatiquement.** Remplacez la valeur `{prefix}-smtp-password` dans Secret Manager avant d'activer les notifications par e-mail.
- **`min_instance_count` est par défaut `1`.** Le conteneur exécute le serveur de Windmill et son pool de workers (`MODE=server,worker`), c'est donc ce qui exécute les jobs planifiés ; à `0` Cloud Run le récupère environ 15 minutes après la dernière requête et les déclenchements planifiés s'arrêtent.
- **`cpu_always_allocated` est par défaut `true`.** Les jobs s'exécutent sur un worker en arrière-plan, et sous la facturation basée sur les requêtes, ce travail est limité à presque zéro entre les requêtes. Conservez les deux valeurs par défaut pour des planifications et des webhooks fiables.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Windmill {#a-cloud-run--the-windmill-service}

Windmill s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 16 {#b-cloud-sql-for-postgresql-16}

Windmill stocke toutes les données d'application — scripts, flux, variables, ressources, planifications et historique des jobs — dans une instance Cloud SQL pour PostgreSQL 16 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique). Lors du premier déploiement, un job d'initialisation crée de manière idempotente la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est provisionné pour les sorties de workflow, les artefacts et les dépendances de script. Le compte de service de la charge de travail se voit accorder l'accès automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de bucket supplémentaires, les montages GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données et le mot de passe de remplacement SMTP sont stockés dans Secret Manager et injectés dans le service au moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Replace the SMTP placeholder before enabling email features:
  echo -n "your-smtp-password" | gcloud secrets versions add \
    <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs de conteneur sont envoyés à Cloud Logging au format JSON structuré (`JSON_FMT=true`). Les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles. Un point de terminaison de métriques Prometheus est exposé à `:9001` pour le scraping au sein du VPC.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Windmill {#3-windmill-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) s'exécute au premier déploiement en utilisant `postgres:16-alpine`. Il crée de manière idempotente les rôles `windmill_admin` et `windmill_user`, l'utilisateur de l'application et la base de données de l'application, puis accorde tous les privilèges et l'appartenance aux deux rôles (Windmill a besoin de `SET ROLE windmill_admin`). Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma automatiques.** Windmill exécute ses propres migrations de base de données au démarrage, de sorte que la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **Mode combiné serveur+worker.** Chaque instance exécute à la fois l'API/ordonnanceur Windmill et `NUM_WORKERS=3` workers d'exécution de scripts. Les workers exécutent des scripts Python, TypeScript, Bash, Go et SQL dans des sous-processus isolés. L'affectation `WORKER_GROUP=default` signifie que tous les flux et scripts sont acheminés vers ces instances par défaut.
- **Construction de `BASE_URL` et `DATABASE_URL`.** Le shim `entrypoint.sh` construit `DATABASE_URL` à partir de variables `DB_*` injectées par la plateforme au démarrage, gérant à la fois les connexions par socket Unix (Auth Proxy) et TCP. `BASE_URL` et `BASE_INTERNAL_URL` sont définis à partir de l'URL de service prédite afin que les rappels OAuth et les webhooks se résolvent correctement.
- **Métriques Prometheus.** `METRICS_ADDR=:9001` expose les métriques Windmill à `http://<instance-ip>:9001/metrics` pour le scraping depuis le VPC.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent `GET /api/version`. Ce point de terminaison renvoie HTTP 200 avec la chaîne de version lorsque Windmill est prêt à servir le trafic.
- **Notifications par e-mail SMTP.** Le secret `WINDMILL_SMTP_PASS` est initialisé avec un espace réservé de 16 caractères. Remplacez-le et fournissez `WINDMILL_SMTP_HOST`, `WINDMILL_SMTP_PORT` et `WINDMILL_SMTP_FROM` via `environment_variables` pour activer les notifications par e-mail des flux et des scripts.
- **Inspecter les jobs et leurs exécutions :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Windmill sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `windmill` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Windmill` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image Windmill ; défini sur une version spécifique (par exemple `1.400.0`) pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit avec le Dockerfile fourni ; `prebuilt` déploie une image existante. |
| `container_image` | `""` | Remplacer l'URI de l'image. Laisser vide pour que Cloud Build gère. |
| `cpu_limit` | `2000m` | CPU par instance. 2 vCPU est le minimum recommandé pour le mode combiné serveur+worker. |
| `memory_limit` | `2Gi` | Mémoire par instance. 4 GiB recommandé pour les charges de travail Python/TypeScript en production. |
| `min_instance_count` | `1` | Instances minimales. Définir ≥ 1 pour que les webhooks et les flux planifiés soient toujours disponibles sans démarrage à froid. |
| `max_instance_count` | `3` | Instances maximales. Utiliser Redis lors de la mise à l'échelle au-delà de 1 pour coordonner les files d'attente de jobs. |
| `container_port` | `8000` | Windmill écoute sur le port 8000. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse et la compatibilité Linux complète. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmenter (jusqu'à 3600) pour les scripts de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — requis pour la connexion par socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Windmill dans Artifact Registry pour éviter les limites de débit de ghcr.io. |
| `traffic_split` | `[]` | Allocation de trafic Canary/bleu-vert entre les révisions. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés avec les valeurs par défaut de Windmill. Utiliser pour définir `WINDMILL_SMTP_HOST`, les remplacements `NUM_WORKERS`, etc. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `WINDMILL_SMTP_PASS` est injecté automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé et NFS {#group-9--custom-sql--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend LB (seuls les actifs statiques en bénéficient). |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket `data` et tout bucket supplémentaire. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `false` | NFS est désactivé par défaut — Windmill ne nécessite pas de stockage de fichiers partagé. |
| `gcs_volumes` | `[]` | Montages GCS Fuse via la fonctionnalité de volume de stockage de Cloud Run. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_16` | Fixe — Windmill nécessite PostgreSQL 16. Ne pas modifier. |
| `db_name` | `windmill` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `windmill` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job PostgreSQL `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/version`, délai initial de 60s, 10 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/version`, délai initial de 60s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/version` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour un comportement de file d'attente distribuée (facultatif). |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_16` | Critique | Windmill nécessite PostgreSQL 16 ; l'utilisation d'une version plus ancienne entraîne l'échec du job d'initialisation et la base de données reste non initialisée. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les scripts, flux et l'historique des jobs. |
| `enable_cloudsql_volume` | `true` | Critique | Windmill se connecte via le socket Unix du Auth Proxy ; la désactivation de cela entraîne une défaillance immédiate de la base de données et des plantages de conteneurs au démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `cpu_limit` | `2000m` | Élevé | Le mode combiné exécute 3 workers en cours de processus ; un CPU insuffisant limite toutes les exécutions de scripts. Chaque worker a besoin d'environ 500m. |
| `memory_limit` | `2Gi` | Élevé | Les workers Windmill exécutent des scripts utilisateur arbitraires ; les kills OOM en cours d'exécution produisent des échecs silencieux dans l'interface utilisateur. |
| `min_instance_count` | `1` (la valeur par défaut) | Élevé | La réduction à `0` permet à Cloud Run de récupérer l'instance lorsqu'elle est inactive, et avec elle le pool de workers — les flux planifiés cessent de se déclencher jusqu'à ce qu'une requête réveille le service. |
| `cpu_always_allocated` | `true` (la valeur par défaut) | Élevé | La définition de `false` limite le worker en arrière-plan entre les requêtes, de sorte que les jobs planifiés et les exécutions en file d'attente s'exécutent plusieurs fois plus lentement ou stagnent. |
| `service_url` / `BASE_URL` | URL Cloud Run ou domaine personnalisé | Élevé | Une valeur vide ou incorrecte interrompt les rappels OAuth, les points de terminaison de webhook et les liens profonds de l'interface utilisateur Windmill. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne prend pas en charge les montages GCS Fuse ; requis lorsque `gcs_volumes` est utilisé. |
| `enable_vpc_sc` | `false` sauf si nécessaire | Élevé | Nécessite un `organization_id` explicite ; sans cela, VPC-SC est ignoré silencieusement, donnant un faux sentiment de sécurité périmétrique. |
| `enable_redis` | `false` pour une instance unique, `true` pour plusieurs | Moyen | Sans Redis, plusieurs instances traitent chacune leur propre file d'attente, ce qui peut entraîner une duplication ou une famine de jobs. |
| `max_instance_count` | `3` | Moyen | Au-delà d'une instance sans coordination Redis, le même job peut être pris en charge par plusieurs workers simultanément. |
| `timeout_seconds` | `300` (augmenter pour les jobs longs) | Moyen | Les jobs Windmill qui dépassent le délai d'attente de requête Cloud Run sont tués en cours d'exécution sans erreur gracieuse. |
| `backup_schedule` | `0 2 * * *` | Moyen | Une chaîne vide désactive les sauvegardes ; Windmill stocke toutes les définitions d'automatisation dans PostgreSQL. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | Sans cela, l'interface utilisateur et l'API Windmill sont accessibles publiquement. |
| `WINDMILL_SMTP_*` (via les variables d'environnement) | tous les champs définis ensemble | Moyen | Une configuration SMTP partielle entraîne des échecs de livraison d'e-mails silencieux sans erreur d'exécution. |
| `enable_auto_password_rotation` | `false` | Moyen | Lorsqu'elle est activée, la révision Cloud Run doit être redéployée après la rotation ; sinon, elle utilise un mot de passe expiré jusqu'à ce que les connexions échouent. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Windmill partagée avec la variante GKE est décrite dans **[Windmill_Common](Windmill_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Windmill sur Cloud Run](../labs/Windmill_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Windmill sur GKE Autopilot](Windmill_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Windmill Common — Configuration d'application partagée](Windmill_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Kestra sur Google Cloud Run](Kestra_CloudRun.md), [Temporal sur GKE Autopilot](Temporal_GKE.md), [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) dans la solution **Orchestration de données et de workflows**.
