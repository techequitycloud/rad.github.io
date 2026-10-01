---
title: "Speedtest Tracker sur Google Cloud Run"
description: "Référence de configuration pour déployer Speedtest Tracker sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SpeedtestTracker_CloudRun.md @ 3055034 sha256:b363bb2e95c7 -->

# Speedtest Tracker sur Google Cloud Run {#speedtest-tracker-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SpeedtestTracker_CloudRun.png" alt="Speedtest Tracker sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Speedtest Tracker est un outil gratuit, open source et auto-hébergé de surveillance
des tests de débit Internet, construit sur Laravel (PHP). Il exécute des tests de
débit Ookla selon une planification récurrente, stocke les résultats dans une base de
données et les présente sous forme de graphiques historiques via un tableau de bord
web et une API REST. Ce module déploie Speedtest Tracker sur **Cloud Run v2** en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Speedtest Tracker et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Speedtest Tracker s'exécute sous forme de conteneur PHP sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur PHP (LinuxServer), 1 vCPU / 1 GiB par défaut, **toujours actif** (pas de mise à l'échelle à zéro) |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — ce module impose MySQL ; la valeur par défaut SQLite de l'image amont est contournée |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; Speedtest Tracker utilise le pilote de cache local file/sync |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (`database_type = "MYSQL_8_0"`) ; PostgreSQL n'est pas pris en
  charge. La valeur par défaut SQLite de Speedtest Tracker (utilisée lorsqu'aucune
  variable d'environnement de base de données n'est définie) n'est jamais atteinte,
  car ce module câble toujours MySQL.
- **L'image préconstruite `linuxserver/speedtest-tracker` est utilisée directement.**
  Il n'y a pas de Cloud Build personnalisé pour le déploiement par défaut ; l'image
  officielle LinuxServer.io est mise en miroir dans Artifact Registry
  (`enable_image_mirroring = true`) et déployée telle quelle. Solution de repli :
  `ghcr.io/alexjustesen/speedtest-tracker` (basée sur Alpine, sans s6-overlay) si
  l'image LinuxServer se révélait un jour incompatible avec le bac à sable gVisor de
  Cloud Run — une catégorie de risque documentée pour les images s6-overlay de ce
  catalogue (confirmée sur Prowlarr, mais pas universelle ; BookStack, également une
  image LinuxServer, fonctionne bien sur Cloud Run).
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **Toujours actif par conception, et non par défaut de coût.** `cpu_always_allocated = true`
  et `min_instance_count = 1` / `max_instance_count = 1`. L'expression cron
  `SPEEDTEST_SCHEDULE` pilote un **planificateur Laravel intégré au processus** qui
  déclenche les tests de débit indépendamment de toute requête HTTP entrante — avec
  une facturation à la requête ou une mise à l'échelle à zéro, la planification ne
  mène jamais son travail à bien, sans aucun message (la même catégorie de défaillance
  que celle documentée pour n8n/Kestra dans ce catalogue). `max_instance_count` est
  plafonné à 1, car le planificateur ne dispose d'aucun verrouillage entre instances ;
  plusieurs instances actives risquent de déclencher des tests de débit en double au
  même déclenchement.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une seule fois et stockée dans Secret Manager ; sa rotation rend toutes
  les valeurs chiffrées de la base de données indéchiffrables.
- **L'image exécute automatiquement `php artisan migrate --force` au démarrage** ; le
  schéma est donc créé au premier démarrage, une fois que `db-init` a provisionné la
  base de données et l'utilisateur — il n'y a pas de tâche de migration distincte.
- **Pas de stockage par défaut.** Speedtest Tracker stocke tous les résultats et la
  configuration dans Cloud SQL, sans flux de téléversement de fichiers par les
  utilisateurs — `create_cloud_storage` et `enable_nfs` sont désactivés par défaut.
- **Cloud Run se connecte à Cloud SQL en TCP sur adresse IP privée.**
  `enable_cloudsql_volume = false` par défaut ; `DB_HOST` est donc l'adresse IP privée
  de l'instance ; MySQL en TCP sur adresse IP privée ne nécessite pas SSL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Speedtest Tracker {#a-cloud-run--the-speedtest-tracker-service}

Speedtest Tracker s'exécute comme un service Cloud Run v2 maintenu toujours actif
(`min_instance_count = 1`) afin que son planificateur cron intégré au processus
continue de se déclencher. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Speedtest Tracker stocke tous les résultats des tests de débit et la configuration de
l'application dans une instance gérée Cloud SQL for MySQL 8.0. Le service se connecte
via l'**adresse IP privée** de Cloud SQL par la sortie VPC
(`enable_cloudsql_volume = false`) ; `DB_HOST` est défini sur l'adresse IP privée de
l'instance et aucune adresse IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=speedtesttracker --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis (cache et sessions facultatifs) {#c-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; Speedtest Tracker utilise
ses pilotes locaux de cache et de sessions file/sync, ce qui convient à un déploiement
à instance unique. Lorsque `enable_redis = true` est défini, la couche partagée
injecte `REDIS_HOST` et `REDIS_PORT`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the DB/schedule wiring in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'DB_|REDIS_|SPEEDTEST_'
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
l'**`APP_KEY`** Laravel (`base64:<44-char base64>`), utilisée pour chiffrer toutes les
données que Speedtest Tracker stocke sous forme chiffrée. Le mot de passe de la base
de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être ajouté par-dessus ; les paramètres d'entrée et la sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de
Cloud Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Speedtest Tracker {#3-speedtest-tracker-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il détecte le socket
  Cloud SQL ou le point de terminaison TCP, attend que MySQL soit joignable, crée la
  base de données et l'utilisateur de l'application, accorde les privilèges, vérifie
  que l'utilisateur de l'application peut se connecter et arrête proprement le sidecar
  Cloud SQL Auth Proxy. La tâche est idempotente et peut être relancée sans risque
  (`max_retries = 3`).
- **Migration automatique du schéma au démarrage.** L'image LinuxServer de Speedtest
  Tracker exécute automatiquement `php artisan migrate --force` à chaque démarrage du
  conteneur ; le schéma est donc créé au premier démarrage et mis à niveau lors des
  démarrages suivants — il n'y a **pas de tâche de migration distincte**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application Laravel
  est générée une seule fois et écrite dans Secret Manager. Sa rotation rend toutes les
  valeurs chiffrées de la base de données définitivement indéchiffrables. N'effectuez
  de rotation que pendant une fenêtre de maintenance planifiée, avec un plan de
  rechiffrement.
- **Planificateur cron intégré au processus.** `SPEEDTEST_SCHEDULE` (par défaut
  `"0 * * * *"`, toutes les heures) pilote le propre planificateur Laravel de Speedtest
  Tracker pour exécuter des tests de débit automatisés. Celui-ci se déclenche sans
  aucune requête HTTP entrante ; le déploiement utilise donc par défaut
  `cpu_always_allocated = true` + `min_instance_count = 1` précisément pour le rendre
  fiable — ne modifiez pas ces valeurs, sauf si la planification est entièrement
  désactivée.
- **Élagage des résultats.** `PRUNE_RESULTS_OLDER_THAN` (par défaut `"0"`, désactivé)
  supprime automatiquement les résultats de tests de débit antérieurs au nombre de
  jours configuré.
- **Chemin de santé.** La sonde de vivacité cible `/api/healthcheck` — le point de
  terminaison de santé JSON non authentifié de Speedtest Tracker. La sonde de démarrage
  est un contrôle TCP sur le port 80. Prévoyez une fenêtre généreuse pour le premier
  démarrage : la sonde de vivacité a un délai initial de 300 secondes afin de laisser
  le temps aux migrations automatiques.
- **Configuration au premier lancement.** L'interface web de Speedtest Tracker guide la
  création du compte lors de la première visite — il n'existe aucun compte
  administrateur par défaut préchargé à modifier.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Speedtest Tracker ou notables pour
celui-ci sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `speedtesttracker` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Speedtest Tracker` | Nom lisible affiché dans la console. |
| `description` | `Speedtest Tracker — automated internet speed test monitoring and history` | Description du service. |
| `application_version` | `latest` | Étiquette de l'image `linuxserver/speedtest-tracker` ; à figer (par ex. `version-v1.6.3`) en production. |
| `speedtest_schedule` | `0 * * * *` | Expression cron de la planification automatisée des tests de débit. |
| `prune_results_older_than` | `0` | Nombre de jours au-delà duquel les anciens résultats sont élagués ; `0` désactive l'élagage. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image LinuxServer mise en miroir — aucun build personnalisé. |
| `container_image` | `""` | Remplace la référence de l'image ; laissez vide pour utiliser l'image mise en miroir par défaut. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | **Doit rester à true** — le planificateur cron a besoin de CPU sans requête entrante. |
| `min_instance_count` | `1` | **Doit rester ≥ 1** — le planificateur a besoin d'une instance toujours en cours d'exécution. |
| `max_instance_count` | `1` | À maintenir à 1 — évite les tests de débit planifiés en double entre instances. |
| `container_port` | `80` | Speedtest Tracker écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `execution_environment` | `gen2` | Environnement d'exécution de deuxième génération (gen2). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Connexion en TCP sur l'adresse IP privée de Cloud SQL (correct pour MySQL sur Cloud Run). |
| `enable_image_mirroring` | `true` | Met en miroir l'image LinuxServer dans Artifact Registry. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Entrée et VPC {#group-5--ingress--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise l'accès public au tableau de bord. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par ex. `DISPLAY_TIMEZONE`, `SPEEDTEST_SERVERS`). Ne définissez pas `APP_KEY` ni `DB_*` ici. |
| `secret_environment_variables` | `{}` | Association variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, CDN et domaine personnalisé {#group-10--cloud-armor-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets déclarés dans `storage_buckets` (vide par défaut). |
| `storage_buckets` | `[]` | Buckets GCS à provisionner. Non nécessaires par défaut. |
| `enable_nfs` | `false` | Non requis par défaut — tout l'état réside dans Cloud SQL. |
| `nfs_mount_path` | `/config` | Chemin de montage si NFS est activé (par ex. pour des certificats personnalisés). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — Speedtest Tracker requiert MySQL 8.0 dans ce module. |
| `db_name` | `speedtesttracker` | Nom de la base de données MySQL (préfixé par le tenant). Immuable après le premier déploiement. |
| `db_user` | `speedtesttracker` | Utilisateur de base de données de l'application (préfixé par le tenant). Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Rotation du mot de passe de la base de données. |

### Groupe 13 — Automatisation des charges de travail {#group-13--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Pour des tâches de maintenance sans rapport — la planification des tests de débit de Speedtest Tracker s'exécute dans le processus via `SPEEDTEST_SCHEDULE`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP port 80, délai de 30s | Sonde de démarrage (contrôle d'écoute du port). |
| `liveness_probe` | HTTP `/api/healthcheck`, délai de 300s | Sonde de vivacité sur le point de terminaison de santé non authentifié. |
| `uptime_check_config` | `{ enabled=false, path="/api/healthcheck" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache et sessions Redis {#group-21--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecte `REDIS_HOST`/`REDIS_PORT` afin que Speedtest Tracker puisse utiliser Redis pour le cache et les sessions. Non requis par défaut. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (adresse IP privée, sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas au moteur requis par Speedtest Tracker, un `redis_port`/`backup_retention_days` hors plage. Ce module vérifie en outre que `cpu_always_allocated=true` implique `min_instance_count >= 1`, et que `max_instance_count <= 1` dès que `speedtest_schedule` est défini. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation rend toutes les valeurs chiffrées de la base de données définitivement indéchiffrables. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `database_type` | `MYSQL_8_0` | Critique | Speedtest Tracker requiert MySQL dans ce module ; tout autre moteur empêche le démarrage. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` | Critique | Modifier l'une ou l'autre de ces valeurs empêche `SPEEDTEST_SCHEDULE` de se déclencher, sans aucun message — le service paraîtra déployé et en bonne santé, mais n'exécutera jamais de test de débit planifié. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 avec un `speedtest_schedule` actif risque de déclencher des tests de débit en double au même déclenchement de la planification (aucun verrouillage entre instances). |
| `memory_limit` | `1Gi` | Élevé | Des valeurs inférieures exposent à des arrêts OOM pendant les migrations ou en cas d'utilisation simultanée du tableau de bord. |
| `enable_cloudsql_volume` | `false` (TCP sur adresse IP privée) | Élevé | Sur Cloud Run, Speedtest Tracker se connecte en TCP sur adresse IP privée ; forcer le chemin du socket est inutile et peut rompre la connectivité à la base de données. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` bloque tout accès externe au tableau de bord. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | Élevé | IAP bloque tout accès anonyme. |
| `container_image_source` | `prebuilt` | Moyen | Un Cloud Build personnalisé sans Dockerfile fait échouer le build. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Speedtest Tracker partagée avec la variante GKE est décrite dans
**[SpeedtestTracker_Common](SpeedtestTracker_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Speedtest Tracker sur Cloud Run](../labs/SpeedtestTracker_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Speedtest Tracker sur GKE Autopilot](SpeedtestTracker_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Speedtest Tracker Common — Configuration applicative partagée](SpeedtestTracker_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Beszel sur Google Cloud Run](Beszel_CloudRun.md) dans la solution **Monitoring & NOC**.
