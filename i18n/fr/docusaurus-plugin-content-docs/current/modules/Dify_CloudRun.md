---
title: "Dify sur Google Cloud Run"
description: "Référence de configuration pour déployer Dify sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Dify_CloudRun.md @ 3055034 sha256:315501e6db28 -->

# Dify sur Google Cloud Run {#dify-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dify_CloudRun.png" alt="Dify sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dify est une plateforme open source de développement d'applications LLM permettant de créer des
applications d'IA de niveau production, avec un éditeur visuel de workflows, un pipeline RAG, un
framework d'agents, une gestion multi-modèles et une observabilité intégrée. Ce module déploie Dify
sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Dify et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs
à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Dify s'exécute sous la forme d'un conteneur d'API Python/Flask (avec un worker Celery intégré sous
supervisord), accompagné d'un service frontal web Next.js distinct. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 (gen2) | Service API+worker (2 vCPU / 4 GiB par défaut) + service frontal web, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — extension pgvector activée pour le stockage vectoriel |
| Base vectorielle | pgvector (dans la base de données) | Réutilise l'instance Cloud SQL ; aucune base vectorielle distincte n'est nécessaire |
| Fichiers partagés | Filestore (NFS) | Fournit l'hôte Redis par défaut (la VM du serveur NFS héberge également Redis) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié (`gcs-dify<tenant-prefix>-storage`) pour les fichiers et ressources téléversés |
| Cache et file de tâches | Redis | Requis pour le broker/backend Celery et le streaming LLM SSE/WebSocket |
| Secrets | Secret Manager | SECRET_KEY et mot de passe de la base de données générés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** MySQL et `NONE` ne sont pas pris en charge ; Dify a besoin de
  PostgreSQL pour toutes les métadonnées, l'état des workflows et les comptes utilisateur.
- **pgvector est toujours activé.** L'extension `vector` est installée automatiquement sur
  l'instance Cloud SQL, ce qui fait de cette même instance la base vectorielle — aucun service
  supplémentaire n'est requis.
- **Redis est obligatoire.** Celery (exécution des workflows, indexation des documents, appels LLM
  asynchrones) et le bus d'événements SSE/WebSocket dépendent tous deux de Redis. Le désactiver
  interrompt tout le traitement en arrière-plan.
- **NFS est activé par défaut.** La VM du serveur NFS héberge le processus Redis lorsqu'aucun hôte
  Redis externe n'est défini. Nécessite l'environnement d'exécution gen2.
- **Un service frontal web est déployé automatiquement.** Un service Cloud Run
  `langgenius/dify-web` est relié à l'URL du service d'API — vous n'avez pas besoin de le
  configurer séparément. Accédez à Dify via la sortie `web_url`.
- **SECRET_KEY est généré automatiquement** et stocké dans Secret Manager ; il signe les sessions
  Dify et ne doit jamais être modifié après le premier déploiement.
- **Les migrations de base de données s'exécutent à chaque démarrage d'instance** (via
  `MIGRATION_ENABLED=true`), de sorte que les mises à niveau de version appliquent automatiquement
  les changements de schéma.
- **L'environnement d'exécution gen2 est obligatoire** pour les montages NFS et les volumes GCS
  Fuse.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des
ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — les services Dify {#a-cloud-run--the-dify-services}

Dify s'exécute sous la forme de deux services Cloud Run v2 : le service API+worker
(Flask/gunicorn + Celery via supervisord) et le frontal web (Next.js). Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service d'API ou le service web pour consulter les
  révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Dify stocke toutes les données applicatives (workflows, bases de connaissances, comptes
utilisateur, clés API) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte
de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix — aucune adresse IP publique
n'est exposée. Lors du premier déploiement, un job d'initialisation crée la base de données et
l'utilisateur de l'application. L'extension `pgvector` est installée automatiquement afin que la
même instance serve de base vectorielle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans
les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation du mot de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Un partage **Filestore (NFS)** est monté dans le service. La VM du serveur NFS exécute également le
processus Redis utilisé comme broker Celery lorsqu'aucun hôte Redis externe n'est configuré. Un
bucket **Cloud Storage** dédié (`gcs-dify<tenant-prefix>-storage`) est provisionné pour les
fichiers et ressources téléversés ; le pilote `google-storage` de Dify y accède via l'identité du
service Cloud Run — aucun fichier de clé de compte de service n'est nécessaire.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Redis — Celery et bus d'événements {#d-redis--celery-and-event-bus}

Redis est requis pour trois fonctions dans Dify :

| Rôle | Base Redis | Objet |
|---|---|---|
| Broker et backend Celery | db 1 | Met en file d'attente et suit toutes les tâches d'arrière-plan (inférence LLM, indexation des documents) |
| Bus d'événements | db 0 | Streaming SSE/WebSocket pour la sortie LLM en temps réel |
| Cache général | db 0 | Mise en cache applicative |

Lorsqu'aucun hôte Redis externe n'est configuré, l'adresse IP de la VM du serveur NFS est utilisée
comme point de terminaison Redis. En production, faites pointer `redis_host` vers une instance
Memorystore for Redis dédiée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le `SECRET_KEY` de Dify (utilisé pour la signature des JWT et le chiffrement des sessions) et le
mot de passe de la base de données sont stockés dans Secret Manager et injectés dans le service à
l'exécution. Le `SECRET_KEY` est généré une seule fois et ne doit pas faire l'objet d'une rotation
tant que le déploiement est en cours d'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service d'API est accessible par défaut via son URL `run.app` ; ouvrez la sortie `web_url` dans
un navigateur pour accéder à la console Dify. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL
sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en
option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Dify {#3-dify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  (`db-init`) se connecte à Cloud SQL via l'Auth Proxy et crée de manière idempotente
  l'utilisateur et la base de données Dify. Il s'exécute automatiquement au premier déploiement
  et peut être relancé sans risque.
- **Migrations au démarrage.** Chaque instance exécute les migrations de base de données
  Flask-Migrate de Dify au démarrage (`MIGRATION_ENABLED=true`), de sorte que la mise à niveau de
  la version de l'application applique automatiquement les changements de schéma. Aucun job de
  migration distinct n'est nécessaire.
- **API + worker dans un seul conteneur.** Le conteneur personnalisé encapsule
  `langgenius/dify-api` avec supervisord. Le serveur d'API gunicorn (port 5001) et le worker
  Celery s'exécutent dans le même conteneur — ils partagent l'allocation de CPU et de mémoire.
  Dimensionnez en conséquence : 2 vCPU et 4 GiB constituent le minimum recommandé.
- **Frontal web.** Un service Cloud Run `langgenius/dify-web` est déployé automatiquement et relié
  à l'URL Cloud Run calculée (prédite) du service d'API via `CONSOLE_API_URL`/`APP_API_URL`.
  Accédez à Dify via la sortie `web_url`.
- **Clés API des fournisseurs LLM.** Les clés des fournisseurs (OpenAI, Anthropic, etc.) se
  configurent par espace de travail via la console web de Dify et sont stockées dans la base de
  données de l'application. N'utilisez `secret_environment_variables` que pour la configuration au
  niveau de l'environnement qui ne peut pas être définie dans l'interface.
- **CORS.** `WEB_API_CORS_ALLOW_ORIGINS` et `CONSOLE_CORS_ALLOW_ORIGINS` valent `"*"` par défaut.
  En production, limitez-les à votre domaine via `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` avec un délai
  initial de 30 secondes. Les deux sondes HTTP fonctionnent correctement sur Cloud Run, car l'API
  Dify sert le port 5001 sans complications liées à TLS ou aux redirections (contrairement aux
  applications PHP). La sonde de démarrage accorde jusqu'à 30 × 10 = 300 secondes pour la
  configuration au premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Dify ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dify` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Dify - LLM Application Platform` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `0.15.0` | Tag de version de l'image Dify ; s'applique aux conteneurs d'API et web. Fixez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU minimum — gunicorn et Celery se partagent cette allocation. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés pour la mise en cache des workflows LLM et le traitement des documents. |
| `min_instance_count` | `0` | Nombre minimal d'instances (mise à l'échelle à zéro). Définissez ≥ 1 pour que le worker Celery maintienne sa connexion au broker Redis. |
| `max_instance_count` | `3` | Nombre maximal d'instances. Sert de plafond de coût. |
| `cpu_always_allocated` | `false` | Valeur par défaut privilégiant le coût (facturation à la requête, associée à `min_instance_count=0`) : le CPU n'est facturé que pendant le traitement d'une requête. Contrepartie — les pipelines asynchrones Celery (embedding des jeux de données, jobs planifiés/par lots) s'arrêtent lorsque le service est mis à l'échelle à zéro ; le chat interactif et les applications fonctionnent toujours à la demande. Définissez `true` avec `min_instance_count >= 1` pour rétablir un fonctionnement continu. |
| `container_port` | `5001` | Le serveur d'API Dify écoute sur le port 5001. |
| `execution_environment` | `gen2` | **Obligatoire** — gen2 est nécessaire pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. Augmentez à `3600` pour les workflows LLM de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. Requis pour la connectivité à la base de données. |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green entre les révisions. La somme de toutes les entrées doit être égale à 100. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` (public), `internal` ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. À utiliser pour remplacer `WEB_API_CORS_ALLOW_ORIGINS`, `LOG_LEVEL`, etc. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. À utiliser pour les clés API des fournisseurs LLM. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Délai d'attente de réplication / fréquence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base d'une instance créée en mode intégré (inline). |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. Consultez [App_CloudRun](App_CloudRun.md). |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend du LB. Nécessite `enable_cloud_armor = true`. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint les accès privilégiés. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé ; fournit aussi l'hôte Redis par défaut. Nécessite gen2. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. Le bucket `storage` (`gcs-dify<tenant-prefix>-storage`) est toujours provisionné. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Obligatoire — ne le modifiez pas. Dify ne prend en charge que PostgreSQL. |
| `db_name` | `dify_db` | Nom de la base de données. **Immuable après le premier déploiement.** |
| `db_user` | `dify_user` | Utilisateur de l'application. **Immuable après le premier déploiement.** |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les informations de connexion sont injectées (remplacements facultatifs). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init`. Fournissez une liste non vide pour le remplacer entièrement. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, délai de 30 s | Sonde de démarrage — le conteneur ne reçoit aucun trafic tant que `/health` ne renvoie pas 200. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/health` | Test de disponibilité Cloud Monitoring ; définissez `enabled = true` pour le provisionner. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire.** Active Redis pour la file de tâches Celery et le streaming SSE/WebSocket. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP du serveur NFS ; définissez-le pour une instance Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run (API Dify). |
| `web_url` | URL du frontal web Dify — ouvrez-la dans un navigateur pour accéder à la console Dify. |
| `api_url` | URL du service d'API Dify (utilisée par l'interface web et les intégrations externes). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_redis` | `true` (obligatoire) | Critique | Toutes les tâches Celery (exécution des workflows, indexation des documents, appels LLM asynchrones) échouent silencieusement sans Redis. |
| `enable_cloudsql_volume` | `true` (obligatoire) | Critique | Le sidecar Auth Proxy est le seul chemin vers PostgreSQL ; le désactiver interrompt toute connectivité à la base de données. |
| `SECRET_KEY` (généré automatiquement) | immuable une fois défini | Critique | Toutes les instances doivent partager la même clé ; sa rotation déconnecte tous les utilisateurs et invalide les sessions actives. |
| `db_name` / `db_user` | à définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `secret_environment_variables` pour les clés LLM | toujours utiliser des références de secrets | Critique | Des variables d'environnement en clair exposent les clés API dans les métadonnées de révision Cloud Run visibles dans la console. |
| `enable_redis` + `enable_nfs` | tous deux `true` en l'absence de Redis externe | Critique | Sans NFS, il n'existe aucun hôte Redis lorsque `redis_host` est vide — Celery ne démarre pas. |
| `redis_host` | hôte correct | Élevé | Un hôte incorrect produit une URL de broker Celery mal formée ; toutes les tâches asynchrones restent indéfiniment en file d'attente. |
| `database_type` | `POSTGRES_15` | Élevé | Dify nécessite PostgreSQL ; tout autre moteur empêche le démarrage. |
| `memory_limit` | `4Gi` | Élevé | Une mémoire insuffisante provoque des arrêts OOM lors de l'ingestion de documents ou de la mise en cache des workflows LLM. |
| `min_instance_count` + `cpu_always_allocated` | livrés à `0` / `false` (priorité au coût) ; définissez `1`+ / `true` pour un Celery continu | Élevé | Les valeurs par défaut livrées relèvent d'un choix délibéré privilégiant le coût, et non d'un oubli : la mise à l'échelle à zéro abandonne les tâches Celery en cours (embedding des jeux de données, jobs planifiés/par lots) lorsque le service est inactif. Le chat interactif et les applications fonctionnent toujours à la demande. Modifiez les deux paramètres ensemble pour rétablir un traitement continu en arrière-plan. |
| `timeout_seconds` | `300` (à augmenter pour les workflows) | Élevé | Les workflows à plusieurs étapes et l'indexation RAG peuvent dépasser 300 s ; augmentez à `3600` pour les déploiements complexes. |
| `execution_environment` | `gen2` | Élevé | gen1 ne prend pas en charge les montages NFS ni GCS Fuse. |
| `WEB_API_CORS_ALLOW_ORIGINS` | à restreindre en production | Élevé | La valeur par défaut `"*"` autorise les requêtes cross-origin depuis n'importe quel domaine. |
| `application_version` | fixer une version précise | Moyen | Des versions non fixées risquent de déclencher des migrations de schéma inattendues qui cassent l'application lors d'un redéploiement. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sans ces contrôles, la console Dify est accessible publiquement. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Dify partagée avec la
variante GKE est décrite dans **[Dify_Common](Dify_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dify sur Cloud Run](../labs/Dify_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Dify sur GKE Autopilot](Dify_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Dify Common — Configuration applicative partagée](Dify_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md), [Langfuse sur Google Cloud Run](Langfuse_CloudRun.md) dans la solution **AI Application Builder**.
