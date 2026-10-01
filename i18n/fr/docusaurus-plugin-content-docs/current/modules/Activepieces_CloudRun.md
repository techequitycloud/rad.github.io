---
title: "Activepieces sur Google Cloud Run"
description: "Référence de configuration pour déployer Activepieces sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Activepieces_CloudRun.md @ 3055034 sha256:c66ab468dcc9 -->

# Activepieces sur Google Cloud Run {#activepieces-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Activepieces_CloudRun.png" alt="Activepieces sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Activepieces est une plateforme open source d'automatisation de workflows sans
code, sous licence Apache 2.0, permettant de connecter applications, API et
sources de données. Ce module déploie Activepieces sur **Cloud Run v2** en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Activepieces et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Activepieces s'exécute sous forme de conteneur Node.js sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Activepieces ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et file d'attente | Redis (facultatif) | Requis pour la mise à l'échelle horizontale ; le mode de file d'attente en mémoire est la valeur par défaut |
| Secrets | Secret Manager | `AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par
  la couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Le mode de file d'attente en mémoire est la valeur par défaut.**
  `AP_QUEUE_MODE = MEMORY` signifie que toutes les tâches de workflow s'exécutent
  dans le processus d'une seule instance. Dépasser une instance nécessite Redis
  (`enable_redis = true`).
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont générés automatiquement** et
  stockés dans Secret Manager. Ces clés ne doivent jamais faire l'objet d'une
  rotation après le premier démarrage sans fenêtre de maintenance — la rotation de
  `AP_ENCRYPTION_KEY` corrompt tous les identifiants de connexion stockés, et celle
  de `AP_JWT_SECRET` invalide toutes les sessions utilisateur actives.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
  Les démarrages à froid ajoutent 5–15 secondes de latence à la première requête
  après une période d'inactivité. Définissez `min_instance_count = 1` pour éviter
  les démarrages à froid sur les flux de webhooks sensibles au temps.
- **Une entrée publique est requise pour les webhooks.** `ingress_settings = "all"`
  est la valeur par défaut afin que les services externes puissent envoyer des POST
  aux points de terminaison de webhooks d'Activepieces. Activer IAP bloquera ces
  appels externes.
- **NFS est désactivé par défaut.** Activepieces stocke tout l'état des workflows
  dans PostgreSQL. N'activez NFS que si vous hébergez Redis sur la VM du serveur NFS.
- **L'extension `pgvector` est installée automatiquement** lors de la tâche de
  configuration de la base de données au premier déploiement, ce qui active les
  pièces de workflow alimentées par l'IA.
- **`AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` sont définis à partir de l'URL de
  service prévue au moment du plan et corrigés à l'exécution** par le point d'entrée
  du conteneur, ce qui garantit que les URL de webhook et de redirection OAuth
  reflètent toujours l'URL réelle du service Cloud Run.
- **Les flux planifiés/déclenchés ne se déclenchent pas, sans aucun message, avec
  la mise à l'échelle par défaut.** Ce module utilise par défaut la facturation à
  la requête avec `min_instance_count = 0`. Activepieces fournit ses propres
  composants de déclenchement de type planificateur/worker/cron/file d'attente, qui
  ne s'exécutent que tant qu'une instance est active — activer les flux planifiés
  d'Activepieces sur un service mis à l'échelle à zéro signifie que ces
  déclencheurs ne se déclenchent jamais, sans aucun message. La solution de
  contournement documentée est `cpu_always_allocated = true` +
  `min_instance_count = 1` (même logique que pour n8n), mais **ce module n'expose
  pas `cpu_always_allocated`** — il n'est ni déclaré dans `variables.tf` ni transmis
  au socle. Définissez `min_instance_count = 1` pour garder une instance active ;
  la configuration actuelle convient telle quelle à un usage limité aux webhooks
  ou interactif.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Activepieces {#a-cloud-run--the-activepieces-service}

Activepieces s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Activepieces stocke toutes les données applicatives (flux, connexions, historique
d'exécution, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Le
service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket
Unix ; aucune IP publique n'est exposée. Au premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application et
installe l'extension `pgvector`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour le
stockage de fichiers d'Activepieces. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (mode file d'attente) {#d-redis-queue-mode}

Redis est **désactivé par défaut** (`AP_QUEUE_MODE = MEMORY`). Lorsque
`enable_redis = true` est défini, le backend de file d'attente passe à
`AP_QUEUE_MODE = REDIS`, ce qui est requis avant de dépasser une instance. Lorsque
`redis_host` est laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur
NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm queue mode in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `AP_ENCRYPTION_KEY` (utilisé pour chiffrer tous les identifiants de
connexion stockés) et `AP_JWT_SECRET` (utilisé pour signer les jetons de session
utilisateur). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`, qui autorise l'accès
public nécessaire aux points de terminaison de webhooks. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Activepieces {#3-activepieces-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` à l'aide de `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de façon idempotente la base de
  données et l'utilisateur de l'application, accorde les privilèges et installe
  l'extension `pgvector` pour les pièces de flux alimentées par l'IA. La tâche peut
  être relancée sans risque.
- **Migrations de la base de données au démarrage.** Activepieces applique
  automatiquement ses propres migrations de schéma à chaque démarrage ; la mise à
  niveau de la version de l'application applique donc les changements de schéma
  sans étape de migration distincte.
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont immuables après le premier
  démarrage.** Ces clés sont générées une seule fois et écrites dans Secret Manager.
  Modifier `AP_ENCRYPTION_KEY` corrompt définitivement tous les identifiants de
  connexion stockés. Modifier `AP_JWT_SECRET` invalide toutes les sessions
  utilisateur actives. N'effectuez de rotation que pendant une fenêtre de
  maintenance planifiée.
- **Points de terminaison de webhooks.** La valeur par défaut
  `ingress_settings = "all"` permet aux systèmes externes d'envoyer des POST aux URL
  de webhooks d'Activepieces. Activer IAP bloquera ces appels. Après le déploiement,
  vérifiez que `AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` correspondent à l'URL
  réelle du service. Inspectez la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **L'inscription est ouverte par défaut.** `AP_SIGN_UP_ENABLED = "true"` est
  injecté automatiquement. Après avoir créé le compte administrateur initial,
  désactivez l'inscription en ajoutant `AP_SIGN_UP_ENABLED = "false"` à
  `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/v1/flags` — le point de terminaison de l'API de flags d'Activepieces, qui ne
  répond que lorsque le serveur est entièrement initialisé et connecté à PostgreSQL.
  Prévoyez au moins 7 minutes au premier démarrage (la sonde de démarrage par défaut
  prévoit un délai initial de 120 secondes plus une fenêtre de nouvelles tentatives
  de 300 secondes).
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Activepieces ou notables pour lui
sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `activepieces` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Activepieces Workflow Automation` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Étiquette de suivi du déploiement pour l'image construite. **Ne fige pas la version amont** : le Dockerfile d'`Activepieces_Common` construit toujours `FROM activepieces/activepieces:latest` sans ARG de version ; modifier cette valeur ne fait donc que réétiqueter le tag poussé dans Artifact Registry. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 1 GiB. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid sur les webhooks. |
| `max_instance_count` | `1` | **N'augmentez que lorsque `enable_redis = true`.** |
| `container_port` | `8080` | Activepieces écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Activepieces dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec la convention ; non utilisée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les points de terminaison de webhooks publics. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les points de terminaison de webhooks publics.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs `AP_*` principales sont définies automatiquement — ne définissez pas `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET` ni `AP_POSTGRES_*` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention des images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket de données provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé par défaut ; ne l'activez que si vous hébergez Redis sur le serveur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `activepieces_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `ap_user` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Non transmise — Activepieces n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/flags` délai de 120s | Sonde de démarrage. Prévoyez 7 minutes ou plus au premier démarrage. |
| `liveness_probe` | HTTP `/api/v1/flags` délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | désactivée | Sonde structurée alternative (désactivée par défaut ; `startup_probe` s'applique). |
| `health_check_config` | HTTP `/` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, activez-le explicitement. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fait passer `AP_QUEUE_MODE` de `MEMORY` à `REDIS`. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AP_ENCRYPTION_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation corrompt définitivement tous les identifiants de connexion stockés — ils ne peuvent plus être déchiffrés. |
| `AP_JWT_SECRET` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions utilisateur actives et oblige tout le monde à se reconnecter immédiatement. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | URL réelle du service | Critique | Une URL incorrecte casse toutes les intégrations de webhooks et les rappels OAuth. |
| `max_instance_count` | `1` sauf si Redis est activé | Élevé | Dépasser 1 en mode file d'attente en mémoire répartit la file des tâches entre les instances, ce qui provoque des exécutions en double et des exécutions perdues. |
| `enable_redis` | `true` avant de mettre à l'échelle | Élevé | Sans Redis, chaque instance gère sa propre file d'attente en mémoire — exécution incohérente au-delà d'une instance. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, la chaîne de connexion Redis est vide et l'application ne démarre pas. |
| `memory_limit` | `2Gi` | Élevé | Des valeurs inférieures à 1 GiB provoquent des arrêts OOM lors d'exécutions de flux concurrentes. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` bloque tous les rappels de webhooks externes. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhooks externes. |
| `AP_SIGN_UP_ENABLED` (injecté automatiquement à `"true"`) | Désactiver après le premier administrateur | Élevé | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute des délais de démarrage à froid de 5–15 secondes sur les webhooks entrants après une période d'inactivité. |
| `min_instance_count` (avec les flux planifiés/déclenchés d'Activepieces activés) | `1` (aucun remplacement par `cpu_always_allocated` n'existe) | Élevé | Les composants planificateur/worker/cron d'Activepieces ne s'exécutent que tant qu'une instance est active ; avec `min_instance_count = 0`, les flux planifiés ne se déclenchent jamais, sans aucun message, et ce module n'expose pas `cpu_always_allocated` pour forcer à la place un CPU toujours alloué. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | à activer en production | Moyen | Les points de terminaison de webhooks et l'interface d'administration sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Activepieces partagée avec la variante GKE est décrite dans
**[Activepieces_Common](Activepieces_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Activepieces sur Cloud Run](../labs/Activepieces_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Activepieces sur GKE Autopilot](Activepieces_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Activepieces Common — Configuration applicative partagée](Activepieces_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [n8n sur Google Cloud Run](N8N_CloudRun.md), [Node-RED sur Google Cloud Run](NodeRED_CloudRun.md), [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md), [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) dans la solution **Workflow Automation Hub**.
