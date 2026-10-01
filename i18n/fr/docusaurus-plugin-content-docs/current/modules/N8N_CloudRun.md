---
title: "n8n sur Google Cloud Run"
description: "Référence de configuration pour déployer n8n sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/N8N_CloudRun.md @ 3055034 sha256:88e595ada1df -->

# n8n sur Google Cloud Run {#n8n-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/N8N_CloudRun.png" alt="n8n sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

n8n est une plateforme d'automatisation de workflows « fair-code » qui connecte des API, des
bases de données et des services grâce à un éditeur visuel de nœuds. Ce module déploie n8n sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par n8n et sur la manière de les explorer
et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de
charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

n8n s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, toujours actif (facturation à l'instance, `min_instance_count = 1`) afin que les déclencheurs cron/planifiés et l'exécution de la file d'attente se lancent sans requête entrante |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — n8n utilise PostgreSQL pour toutes les données de workflows et d'identifiants |
| Fichiers partagés | Filestore (NFS) | Données de fichiers binaires partagées entre toutes les instances ; sert aussi de point de terminaison Redis par défaut |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié |
| File d'attente et coordination | Redis | Activé par défaut ; active le mode file d'attente de n8n pour la mise à l'échelle horizontale |
| Secrets | Secret Manager | Clé de chiffrement générée automatiquement et valeur provisoire du mot de passe SMTP |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé ; choisir un autre
  moteur ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Le mode file d'attente permet à plusieurs instances n8n de se
  répartir l'exécution des workflows. Sans Redis, une seule instance peut s'exécuter de manière
  fiable.
- **La clé de chiffrement est irremplaçable.** `N8N_ENCRYPTION_KEY` est générée une seule fois
  et stockée dans Secret Manager. Tous les identifiants des workflows sont chiffrés avec elle.
  Si la clé fait l'objet d'une rotation ou est supprimée, chaque identifiant enregistré devient
  définitivement illisible.
- **`min_instance_count` vaut `1` par défaut.** n8n garde une instance active afin que les
  webhooks et le planificateur/la file d'attente se déclenchent sans délai de démarrage à froid.
  Ne le définissez à `0` que si une latence occasionnelle des webhooks au démarrage à froid est
  acceptable.
- **`WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont prédéfinis** sur l'URL prévue du service Cloud
  Run afin que les webhooks se résolvent correctement dès le premier démarrage. Si un domaine
  personnalisé est ajouté plus tard, redéployez pour mettre à jour ces valeurs.
- **L'environnement d'exécution Gen2 est requis** pour les montages NFS.
  `execution_environment` vaut `"gen2"` par défaut.
- Le secret du **mot de passe SMTP** est initialisé avec une valeur factice ; mettez-le à jour
  dans Secret Manager avant de configurer l'envoi d'e-mails.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et
des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service n8n {#a-cloud-run--the-n8n-service}

n8n s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement selon la
charge des requêtes, entre les nombres minimal et maximal d'instances. Chaque déploiement crée
une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

n8n stocke toutes les définitions de workflows, l'historique des exécutions et les identifiants
chiffrés dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte en privé
via le **Cloud SQL Auth Proxy**, par un socket Unix (sans IP publique). Le script
`entrypoint.sh` convertit à l'exécution les variables `DB_*` injectées par la plateforme en
variables natives n8n `DB_POSTGRESDB_*`. Lors du premier déploiement, un Job d'initialisation
crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent
dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les fichiers binaires téléversés vers les workflows ou produits par eux sont écrits sur un
partage **Filestore (NFS)** monté dans le service, afin que toutes les instances partagent les
mêmes données (`N8N_DEFAULT_BINARY_DATA_MODE=filesystem`). L'IP de l'hôte NFS sert aussi de
point de terminaison Redis par défaut lorsqu'aucun `redis_host` explicite n'est configuré. Un
bucket **Cloud Storage** dédié est provisionné pour une persistance plus large des données.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. File d'attente Redis {#d-redis-queue}

Redis active le mode file d'attente de n8n, qui répartit les exécutions de workflows entre
plusieurs instances à l'aide de Bull. En mode file d'attente, une ou plusieurs instances
« worker » récupèrent les exécutions dans la file tandis que l'instance principale gère
l'éditeur et l'enregistrement des webhooks. Lorsqu'aucun hôte Redis externe n'est configuré et
que NFS est activé, l'IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

La clé de chiffrement de n8n et la valeur provisoire du mot de passe SMTP sont stockées dans
Secret Manager et injectées dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Update the SMTP password with the real credential:
  echo -n "my-real-smtp-password" | \
    gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, le service est accessible via son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application n8n {#3-n8n-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation
  (`db-init`) utilise `postgres:15-alpine` pour créer la base de données et l'utilisateur n8n
  avant le démarrage du service. Il est idempotent.
- **Conversion des variables d'environnement.** `entrypoint.sh` fait correspondre `DB_HOST`,
  `DB_NAME`, `DB_USER` et `DB_PASSWORD` (injectés par la plateforme) à leurs équivalents
  natifs n8n `DB_POSTGRESDB_*` au démarrage du conteneur.
- **Fonctionnement en mode file d'attente.** Avec `enable_redis = true` (valeur par défaut),
  n8n démarre en mode file d'attente. L'instance principale gère l'enregistrement des webhooks,
  l'interface de l'éditeur et la coordination des exécutions ; les instances supplémentaires
  servent de workers.
- **Stabilité de l'URL des webhooks.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis sur
  l'URL prévue du service Cloud Run avant le déploiement. Ajouter un domaine personnalisé plus
  tard nécessite un redéploiement pour mettre à jour ces valeurs.
- **Mise à l'échelle à zéro et webhooks.** `min_instance_count` vaut `1` par défaut, ce qui
  garde une instance active pour les charges de travail de webhooks. Le définir à `0` signifie
  qu'aucune instance ne s'exécute au repos — les services externes appelant des webhooks
  subiront une latence de démarrage à froid et des expirations si le service appelant a un
  délai d'expiration court.
- **Stockage des données binaires.** `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` indique à n8n
  d'écrire les fichiers binaires sur le système de fichiers monté en NFS plutôt que dans la base
  de données, ce qui est requis pour les déploiements multi-instances.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine de n8n (`/`),
  qui ne renvoie HTTP 200 qu'une fois l'application entièrement initialisée. La sonde de
  démarrage utilise un délai initial de 120 secondes pour la configuration du premier
  démarrage.
- **Caractère critique de la clé de chiffrement.** `N8N_ENCRYPTION_KEY` chiffre tous les
  identifiants des workflows. Si elle change, tous les identifiants enregistrés deviennent
  définitivement illisibles.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à n8n ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `n8n` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `N8N Workflow Automation` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service Cloud Run. |
| `application_version` | `2.4.7` | Tag de version de l'image n8n. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure sans déployer le conteneur. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Nombre minimal d'instances. Garde par défaut une instance active pour les charges de travail de webhooks ; définissez `0` pour une mise à l'échelle à zéro. |
| `cpu_always_allocated` | `true` | CPU alloué en permanence (facturation à l'instance) — les déclencheurs cron/planifiés et l'exécution de la file d'attente de n8n se lancent sans requête entrante. |
| `max_instance_count` | `1` | Nombre maximal d'instances (plafond de coût). |
| `container_port` | `5678` | n8n écoute sur le port 5678. |
| `execution_environment` | `gen2` | Génération d'exécution Cloud Run. Gen2 est requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête, en secondes. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Dupliquer l'image n8n dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions Cloud Run à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode de routage du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exiger une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Valeurs SMTP provisoires par défaut | Paramètres supplémentaires non secrets. Les valeurs principales `N8N_*` et `DB_TYPE` sont définies automatiquement. La correspondance par défaut inclut `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SSL` et `EMAIL_FROM`, prêtes à être remplacées. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter du SQL depuis un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associer une règle WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les données de fichiers binaires. Requiert `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base d'une instance intégrée. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé — ne pas modifier. |
| `db_name` | `n8n_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `n8n_user` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les informations de connexion sont injectées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job de configuration de base de données `db-init` intégré. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. Le planificateur intégré de n8n gère les déclencheurs de workflows ; utilisez-les pour des opérations externes. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `GET /`, délai initial de 120 s | La sonde de démarrage cible la racine de n8n. |
| `liveness_probe` / `health_check_config` | HTTP `GET /`, délai initial de 30 s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — File d'attente Redis {#group-21--redis-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour l'exécution des workflows en mode file d'attente. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP de l'hôte NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
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
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `N8N_ENCRYPTION_KEY` | _(générée automatiquement, ne jamais effectuer de rotation)_ | Critique | La rotation ou la suppression de cette clé détruit définitivement tous les identifiants de workflows enregistrés. |
| `db_name` / `db_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données des workflows. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les fichiers binaires ne sont pas partagés entre les instances et le mode binaire `filesystem` échoue. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `enable_redis` | `true` | Élevé | Sans le mode file d'attente Redis, exécuter plus d'une instance provoque des conflits d'exécution des workflows. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Aucun point de terminaison valide si Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini. |
| `min_instance_count` | `1` (par défaut) pour les charges de travail de webhooks | Élevé | La valeur `0` provoque des expirations au démarrage à froid lors des appels de webhooks provenant de services ayant un délai d'expiration court. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Les montages NFS requièrent Gen2 ; les instances Gen1 ne peuvent pas monter de volumes NFS. |
| `memory_limit` | `4Gi` | Élevé | Une mémoire insuffisante provoque des arrêts OOM lors de l'exécution de gros lots de workflows. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sinon, l'éditeur n8n est accessible publiquement et expose tous les identifiants enregistrés. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à n8n partagée avec la
variante GKE est décrite dans **[N8N_Common](N8N_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : N8N sur Cloud Run](../labs/N8N_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [n8n sur GKE Autopilot](N8N_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [N8N Common — Configuration applicative partagée](N8N_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md) et [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution **Marketing Automation Suite**.
