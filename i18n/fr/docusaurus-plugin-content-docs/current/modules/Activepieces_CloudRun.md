---
title: "Activepieces sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Activepieces sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Activepieces_CloudRun.md @ 15fd4c7 sha256:a41c3edc2cd7 -->

# Activepieces sur Google Cloud Run {#activepieces-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Activepieces_CloudRun.png" alt="Activepieces sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Activepieces est une plateforme d'automatisation de flux de travail sans code,
open-source et sous licence Apache 2.0, permettant de connecter des applications,
des API et des sources de données. Ce module déploie Activepieces sur **Cloud Run v2**
sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Activepieces et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à chaque application Cloud Run — identité
de service, ingress et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Activepieces s'exécute comme un conteneur Node.js sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Activepieces ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et file d'attente | Redis (facultatif) | Requis pour la mise à l'échelle horizontale ; le mode file d'attente en mémoire est le défaut |
| Secrets | Secret Manager | `AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; la sélection de tout autre moteur empêche le
  démarrage.
- **Le mode file d'attente en mémoire est le défaut.** `AP_QUEUE_MODE = MEMORY` signifie que tous
  les jobs de flux de travail s'exécutent en interne dans une seule instance. La
  mise à l'échelle au-delà d'une instance nécessite Redis (`enable_redis = true`).
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont générés automatiquement** et stockés dans
  Secret Manager. Ces clés ne doivent jamais être renouvelées après le premier
  démarrage sans une fenêtre de maintenance — le renouvellement de `AP_ENCRYPTION_KEY`
  corrompt toutes les informations d'identification de connexion stockées, et le
  renouvellement de `AP_JWT_SECRET` invalide toutes les sessions utilisateur actives.
- **Une instance est maintenue chaude par défaut** (`min_instance_count = 1`), car le
  planificateur d'Activepieces s'exécute en interne. Le réglage à `0`
  active la mise à l'échelle à zéro, ce qui ajoute 5 à 15 secondes de latence de
  démarrage à froid après l'inactivité.
- **L'ingress public est requis pour les webhooks.** `ingress_settings = "all"` est la valeur par
  défaut afin que les services externes puissent POSTer vers les points de terminaison
  webhook d'Activepieces. L'activation d'IAP bloquera ces appels externes.
- **NFS est désactivé par défaut.** Activepieces stocke tout l'état du flux de
  travail dans PostgreSQL. N'activez NFS que si Redis est co-localisé sur la VM du
  serveur NFS.
- **L'extension `pgvector` est installée automatiquement** lors du job de
  configuration de la base de données au premier déploiement, permettant des pièces
  de flux de travail basées sur l'IA.
- **`AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` sont définis à partir de l'URL de service
  prédite au moment de la planification et corrigés à l'exécution** par le point
  d'entrée du conteneur, garantissant que les URL de webhook et de redirection OAuth
  reflètent toujours l'URL réelle du service Cloud Run.
- **Les flux planifiés/déclenchés nécessitent une instance chaude — maintenez `min_instance_count = 1`.**
  Activepieces fournit ses propres composants de planificateur/travailleur/cron/déclencheur
  de type file d'attente, qui ne s'exécutent que tant qu'une instance existe, donc sur
  un service mis à l'échelle à zéro (`0`), les flux planifiés ne se déclenchent
  jamais silencieusement. Le module par défaut est donc `min_instance_count = 1`. Notez que
  **ce module n'expose pas `cpu_always_allocated`** — il n'est pas déclaré dans `variables.tf`
  ni transmis à la fondation. Réduisez le minimum à `0` uniquement pour une
  utilisation uniquement par webhook ou interactive.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Activepieces {#a-cloud-run--the-activepieces-service}

Activepieces s'exécute comme un service Cloud Run v2 qui s'auto-adapte en fonction
de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Activepieces stocke toutes les données de l'application (flux, connexions,
historique d'exécution, utilisateurs) dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy**
sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de l'application
et installe l'extension `pgvector`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
le renouvellement du mot de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour
le stockage de fichiers Activepieces. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (mode file d'attente) {#d-redis-queue-mode}

Redis est **désactivé par défaut** (`AP_QUEUE_MODE = MEMORY`). Lorsque `enable_redis = true` est défini,
le backend de la file d'attente passe à `AP_QUEUE_MODE = REDIS`, ce qui est requis avant de
dépasser une instance. Lorsque `redis_host` est laissé vide et `enable_nfs` est vrai,
l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

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
Manager : `AP_ENCRYPTION_KEY` (utilisé pour chiffrer toutes les informations d'identification
de connexion stockées) et `AP_JWT_SECRET` (utilisé pour signer les jetons de session
utilisateur). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
renouvellement.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, ce qui permet un accès
public requis pour les points de terminaison webhook. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Activepieces {#3-activepieces-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur de l'application, accorde les privilèges et installe l'extension
  `pgvector` pour les pièces de flux basées sur l'IA. Le job peut être réexécuté
  en toute sécurité.
- **Migrations de base de données au démarrage.** Activepieces applique ses propres
  migrations de schéma automatiquement à chaque démarrage, de sorte que la mise à
  jour de la version de l'application applique les changements de schéma sans étape
  de migration séparée.
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont immuables après le premier démarrage.** Ces
  clés sont générées une fois et écrites dans Secret Manager. La modification de
  `AP_ENCRYPTION_KEY` corrompt de manière permanente toutes les informations d'identification
  de connexion stockées. La modification de `AP_JWT_SECRET` invalide toutes les sessions
  utilisateur actives. Ne les renouvelez que pendant une fenêtre de maintenance
  planifiée.
- **Points de terminaison webhook.** Le `ingress_settings = "all"` par défaut permet aux systèmes
  externes de POSTer vers les URL webhook d'Activepieces. L'activation d'IAP
  bloquera ces appels. Après le déploiement, vérifiez que `AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX`
  correspondent à l'URL réelle du service. Inspectez la révision en cours
  d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **L'inscription est ouverte par défaut.** `AP_SIGN_UP_ENABLED = "true"` est injecté
  automatiquement. Après avoir créé le compte administrateur initial, désactivez
  l'inscription en ajoutant `AP_SIGN_UP_ENABLED = "false"` à `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/v1/flags` —
  le point de terminaison de l'API de drapeaux Activepieces qui ne répond que
  lorsque le serveur est entièrement initialisé et connecté à PostgreSQL.
  Prévoyez au moins 7 minutes au premier démarrage (la sonde de démarrage par
  défaut fournit un délai initial de 120 secondes plus une fenêtre de nouvelle
  tentative de 300 secondes).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Activepieces sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `activepieces` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Activepieces Workflow Automation` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de suivi du déploiement pour l'image construite. **Ne fixe pas la version amont** : le Dockerfile de `Activepieces_Common` construit toujours `FROM activepieces/activepieces:latest` sans ARG de version, donc la modification de cette valeur ne fait que réétiqueter le tag Artifact Registry poussé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 1 GiB. |
| `min_instance_count` | `1` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid sur les webhooks. |
| `max_instance_count` | `1` | **N'augmentez que lorsque `enable_redis = true`.** |
| `container_port` | `8080` | Activepieces écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Activepieces dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour les points de terminaison webhook publics. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les points de terminaison webhook publics.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs `AP_*` de base sont définies automatiquement — ne définissez pas `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET` ou `AP_POSTGRES_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention d'images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `false` | NFS est désactivé par défaut ; n'activez que si Redis est co-localisé sur le serveur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 11 — Scripts SQL personnalisés {#group-11--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `activepieces_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `ap_user` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non transmis — Activepieces n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/flags` 120s de délai | Sonde de démarrage. Prévoir 7+ minutes au premier démarrage. |
| `liveness_probe` | HTTP `/api/v1/flags` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | désactivé | Sonde structurée alternative (désactivée par défaut ; `startup_probe` prend effet). |
| `health_check_config` | HTTP `/` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Basculer `AP_QUEUE_MODE` de `MEMORY` à `REDIS`. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
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
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, une `database_type` qui ne correspond pas à une extension activée, une `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AP_ENCRYPTION_KEY` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler corrompt de manière permanente toutes les informations d'identification de connexion stockées — elles ne peuvent pas être déchiffrées. |
| `AP_JWT_SECRET` (auto-généré) | Ne renouveler que pendant une fenêtre de maintenance | Critique | Le renouveler invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate pour tout le monde. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | URL réelle du service | Critique | Une URL incorrecte rompt toutes les intégrations webhook et les rappels OAuth. |
| `max_instance_count` | `1` sauf si Redis est activé | Élevé | La mise à l'échelle au-delà de 1 en mode file d'attente en mémoire divise la file d'attente des jobs entre les instances, entraînant des exécutions en double et des exécutions perdues. |
| `enable_redis` | `true` avant la mise à l'échelle | Élevé | Sans Redis, chaque instance maintient sa propre file d'attente en mémoire — exécution incohérente avec plus d'une instance. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, la chaîne de connexion Redis est vide et l'application ne démarre pas. |
| `memory_limit` | `2Gi` | Élevé | Les valeurs inférieures à 1 GiB provoquent des arrêts OOM lors d'exécutions de flux concurrentes. |
| `ingress_settings` | `all` | Élevé | Le réglage à `internal` bloque tous les rappels webhook externes. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels webhook externes. |
| `AP_SIGN_UP_ENABLED` (auto-injecté `"true"`) | Désactiver après le premier administrateur | Élevé | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `min_instance_count` | `1` (le défaut) | Moyen | La mise à l'échelle à zéro (`0`) ajoute des délais de démarrage à froid de 5 à 15 secondes sur les webhooks entrants après l'inactivité. |
| `min_instance_count` (avec les flux planifiés/déclenchés Activepieces activés) | `1` (aucune substitution `cpu_always_allocated` n'existe) | Élevé | Les propres composants de planificateur/travailleur/cron d'Activepieces ne s'exécutent que lorsqu'une instance est chaude ; à `min_instance_count = 0`, les flux planifiés ne se déclenchent jamais silencieusement, et ce module n'expose pas `cpu_always_allocated` pour forcer le CPU toujours actif à la place. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | Les points de terminaison webhook et l'interface utilisateur d'administration sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à Activepieces partagée avec la variante GKE est décrite dans
**[Activepieces_Common](Activepieces_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Activepieces sur Cloud Run](../labs/Activepieces_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Activepieces sur GKE Autopilot](Activepieces_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Activepieces Common — Configuration d'application partagée](Activepieces_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [n8n sur Google Cloud Run](N8N_CloudRun.md), [Node-RED sur Google Cloud Run](NodeRED_CloudRun.md), [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md), [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) dans la solution **Workflow Automation Hub**.
