---
title: "Vaultwarden sur Google Cloud Run"
description: "Référence de configuration pour déployer Vaultwarden sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Vaultwarden_CloudRun.md @ 3055034 sha256:2fe2d7470466 -->

# Vaultwarden sur Google Cloud Run {#vaultwarden-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Vaultwarden_CloudRun.png" alt="Vaultwarden sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Vaultwarden est un gestionnaire de mots de passe léger, auto-hébergé et compatible
avec Bitwarden, écrit en Rust. Ce module déploie Vaultwarden sur **Cloud Run v2** en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Vaultwarden et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Vaultwarden s'exécute sous forme de binaire Rust compilé sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service binaire Rust, 1 vCPU / 512 Mi par défaut, mise à l'échelle automatique selon les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 (par défaut) ou MySQL 8.0 | Moteur configurable ; le job d'initialisation s'adapte automatiquement |
| Stockage d'objets | Cloud Storage | Un bucket `vaultwarden-attachments` dédié |
| Secrets | Secret Manager | Mot de passe de la base de données ; Vaultwarden gère lui-même son jeton d'administration en interne |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Les inscriptions sont fermées par défaut.** `signups_allowed = false` empêche
  la création anonyme de comptes. Activez-les uniquement pendant la configuration
  initiale de l'administrateur, puis désactivez-les.
- **Aucun jeton d'administration n'est généré automatiquement.** Le panneau `/admin`
  est désactivé tant que vous ne fournissez pas `ADMIN_TOKEN` dans
  `environment_variables`. C'est la valeur par défaut sécurisée.
- **`domain` doit être défini pour WebAuthn et TOTP.** Sans l'URL publique complète,
  les codes QR de 2FA pointent vers `localhost` et les e-mails d'invitation à une
  organisation contiennent des liens cassés.
- **Les sondes de santé ciblent `/alive`**, le point de terminaison de santé léger
  dédié de Vaultwarden. Vaultwarden démarre en quelques secondes ; la sonde de
  démarrage utilise un délai initial de 30 s.
- **`cpu_limit` doit être d'au moins `1000m`.** Cloud Run gen2 avec CPU toujours
  allouée (requis pour un gestionnaire de mots de passe avec
  `min_instance_count ≥ 1`) exige au moins 1 vCPU.
- **`execution_environment = "gen2"` est la valeur par défaut** et ne doit pas être
  modifiée ; elle est requise pour les connexions par socket Unix au Cloud SQL Auth
  Proxy.
- **`min_instance_count = 1` garde le coffre-fort actif.** La mise à l'échelle à zéro
  rend un gestionnaire de mots de passe indisponible pendant plusieurs secondes ; les
  clients Bitwarden affichent des erreurs de connexion.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Vaultwarden {#a-cloud-run--the-vaultwarden-service}

Vaultwarden s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL — PostgreSQL 15 ou MySQL 8.0 {#b-cloud-sql--postgresql-15-or-mysql-80}

Vaultwarden stocke toutes les données du coffre-fort dans une instance Cloud SQL
gérée. Le moteur par défaut est **PostgreSQL 15** ; définissez
`database_type = "MYSQL_8_0"` pour utiliser MySQL à la place. Le service se connecte
de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix (sans IP
publique). Lors du premier déploiement, un job d'initialisation crée la base de
données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (`vaultwarden-attachments`) est provisionné pour
les pièces jointes. Le compte de service de la charge de travail y reçoit l'accès
automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<attachments-bucket>/    # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les montages GCS Fuse et les options
CMEK.

### D. Secret Manager {#d-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans
le service à l'exécution. Vaultwarden gère lui-même son jeton d'administration
interne et ses clés de signature RSA dans le répertoire `/data` — ceux-ci ne sont pas
stockés dans Secret Manager.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN (avec prudence — ne mettez pas
en cache les réponses d'API authentifiées) et Cloud Armor peuvent être ajoutés.
Cloud Armor est vivement recommandé pour protéger le point de terminaison de
connexion de Vaultwarden contre les attaques par force brute.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité (ciblant `/alive`) et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Vaultwarden {#3-vaultwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation crée la base de données et l'utilisateur Vaultwarden avant le
  démarrage du service. Il est idempotent. L'image de tâche appropriée est
  sélectionnée automatiquement : `postgres:15-alpine` pour PostgreSQL,
  `mysql:8.0-debian` pour MySQL.
- **Aucune migration de schéma au démarrage.** Vaultwarden gère automatiquement
  l'évolution de son schéma interne ; aucune commande de migration n'est nécessaire.
- **Aucune tâche planifiée requise.** Contrairement à de nombreuses applications web,
  Vaultwarden n'a aucune tâche cron obligatoire. Toutes les opérations du coffre-fort
  sont déclenchées par des requêtes.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent toutes deux
  `/alive`, qui renvoie `OK` lorsque le serveur est prêt. Le délai initial est de
  30 s, en phase avec le démarrage rapide de Vaultwarden en Rust.
- **Panneau d'administration.** Le panneau `/admin` est désactivé tant que
  `ADMIN_TOKEN` n'est pas fourni via `environment_variables`. Générez un jeton
  aléatoire sécurisé (par exemple avec `openssl rand -base64 48`) et injectez-le à
  l'exécution.
- **SMTP pour les notifications.** Vaultwarden utilise SMTP pour la vérification des
  comptes, les codes de récupération 2FA et les e-mails d'accès d'urgence. Configurez
  `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USERNAME` et `SMTP_PASSWORD` (via
  `secret_environment_variables`) comme un ensemble complet — une configuration SMTP
  partielle provoque des échecs de distribution silencieux.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Vaultwarden ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application et paramètres Vaultwarden {#group-3--application-identity--vaultwarden-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `vaultwarden` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Vaultwarden Password Manager` | Nom convivial affiché dans la console. |
| `description` | _(set)_ | Description du service. |
| `application_version` | `1.32.7` | Tag de version de l'image Vaultwarden. |
| `domain` | `""` | **URL publique complète** (par exemple `https://vault.example.com`). Requise pour WebAuthn, les codes QR TOTP, les invitations à une organisation et les liens des pièces jointes. |
| `signups_allowed` | `false` | Autoriser l'auto-inscription de nouveaux utilisateurs. Activez-la uniquement pendant la configuration initiale ; désactivez-la immédiatement après avoir créé les comptes administrateurs. |
| `web_vault_enabled` | `true` | Servir l'interface web de Vaultwarden. Désactivez-la pour un accès uniquement par API via les clients natifs. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` effectue le build à partir du Dockerfile ; `prebuilt` utilise une URI d'image existante. |
| `cpu_limit` | `1000m` | CPU par instance. Minimum de `1000m` imposé par validation (exigence de Cloud Run gen2). |
| `memory_limit` | `512Mi` | Mémoire par instance. Vaultwarden est très léger au repos. |
| `min_instance_count` | `1` | Nombre minimal d'instances. Conservez ≥ 1 pour éviter l'indisponibilité du coffre-fort due aux démarrages à froid. |
| `max_instance_count` | `3` | Nombre maximal d'instances (plafond de coût). |
| `container_port` | `80` | Port HTTP Rocket de Vaultwarden. Doit correspondre à `ROCKET_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. Requis. |
| `execution_environment` | `gen2` | Gen2 est requis pour la prise en charge des sockets Unix. Ne le modifiez pas. |
| `cpu_always_allocated` | `false` | Par défaut, Vaultwarden sert à la demande (facturation à la requête). Passez à `true` uniquement si vous activez le serveur de notifications push WebSocket de Vaultwarden — sinon, la CPU limitée entre les requêtes casse la connexion WS persistante que les clients interrogent. |
| `timeout_seconds` | `300` | Durée maximale d'une requête en secondes (0–3600). |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver pour un retour arrière. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode d'acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exiger une connexion Google via Identity-Aware Proxy. Remarque : IAP peut empêcher les clients Bitwarden natifs de se connecter. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(SMTP/log defaults)_ | Paramètres en texte clair. Les variables principales `ROCKET_PORT`, `SIGNUPS_ALLOWED`, `WEB_VAULT_ENABLED`, `DATA_FOLDER` et, en option, `DOMAIN` sont injectées automatiquement. Les valeurs par défaut incluent `LOG_LEVEL=warn`, `SHOW_PASSWORD_HINT=false` et des valeurs SMTP fictives. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par exemple `{ SMTP_PASSWORD = "vaultwarden-smtp-pass" }`). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `30` | Durée de rétention ; la valeur par défaut de 30 jours reflète l'importance de la récupération du coffre-fort. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et Cloud Armor {#group-10--load-balancer-cdn--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | **Recommandé pour Vaultwarden.** Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor pour protéger le point de terminaison de connexion contre la force brute. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `application_domains` | `[]` | Noms d'hôte personnalisés. Définissez également `domain` sur l'URL `https://` complète. |
| `enable_cdn` | `false` | Cloud CDN. **Ne mettez pas en cache les réponses d'API authentifiées** — assurez-vous que des en-têtes `Cache-Control: no-store` sont en place. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(set)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket des pièces jointes. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires. |
| `enable_nfs` | `false` | Volume NFS Filestore facultatif. Non requis pour Vaultwarden sur Cloud Run (les données sont dans Cloud SQL et GCS). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | `POSTGRES_15` (par défaut) ou `MYSQL_8_0`. L'image du job d'initialisation est sélectionné automatiquement. |
| `db_name` | `vaultwarden` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `vaultwarden` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les informations de connexion sont injectées. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche de configuration de base de données intégrée (qui sélectionne automatiquement l'image appropriée pour PostgreSQL ou MySQL). |
| `cron_jobs` | `[]` | Vaultwarden n'a aucune tâche planifiée requise ; ajoutez ici des Cloud Run Jobs personnalisés si nécessaire. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/alive`, délai de 30 s, 6 échecs | Chemin de santé dédié de Vaultwarden ; 30 s correspond au démarrage rapide en Rust. |
| `liveness_probe` | HTTP `/alive`, délai de 30 s, 3 échecs | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/alive` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Vaultwarden n'utilise pas Redis nativement. Laissez désactivé sauf si vous ajoutez une intégration personnalisée. |
| `redis_host` / `redis_port` / `redis_auth` | _(set)_ | Point de terminaison, port et authentification Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

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
| `initialization_jobs` | Noms des tâches de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `signups_allowed` | `false` | Critical | Tant que la valeur est `true`, n'importe quel internaute peut s'inscrire lui-même sur le coffre-fort. Désactivez-la immédiatement après avoir créé les comptes administrateurs. |
| `enable_cloudsql_volume` | `true` | Critical | Vaultwarden se connecte à Cloud SQL par socket Unix ; la désactivation fait échouer toutes les connexions à la base de données au démarrage. |
| `db_name` / `db_user` | définis une seule fois | Critical | Les modifier après le premier déploiement amène Vaultwarden à se connecter à une base de données vide ; tous les identifiants semblent perdus. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `domain` | URL `https://` complète | High | Sans elle, les codes QR TOTP pointent vers `localhost`, les e-mails d'invitation à une organisation contiennent des liens cassés et les URL des pièces jointes sont invalides. |
| `database_type` | défini une seule fois | High | Le modifier après le premier déploiement amène Vaultwarden à voir une base de données vide ; tous les identifiants semblent perdus. |
| `cpu_limit` | `1000m` ou plus | High | Cloud Run gen2 avec CPU toujours allouée rejette les valeurs inférieures à `1000m` au moment du déploiement. |
| `container_port` | `80` | High | Doit correspondre à `ROCKET_PORT` ; en cas de discordance, les vérifications de santé de Cloud Run échouent et toutes les requêtes expirent. |
| `execution_environment` | `gen2` | High | Gen1 ne prend pas en charge le chemin de socket Unix utilisé par le Cloud SQL Auth Proxy, ce qui provoque des échecs de connexion à la base de données au démarrage. |
| `min_instance_count` | `1` | High | La mise à l'échelle à zéro rend un gestionnaire de mots de passe indisponible pendant 5–15 s lors d'un démarrage à froid ; les clients Bitwarden affichent des erreurs de connexion. |
| `cpu_always_allocated` | `false` sauf si le push WS est activé | Medium | Laisser `false` alors que le serveur de notifications push WebSocket est activé limite la CPU entre les requêtes et casse la connexion WS persistante ; passez à `true` dans ce cas. |
| `enable_cloud_armor` | activer en production | Medium | Sans Cloud Armor, le point de terminaison de connexion de Vaultwarden est exposé aux attaques par force brute depuis Internet. |
| `enable_cdn` | `false` ou avec contrôles de cache | Medium | Mettre en cache des réponses d'API authentifiées divulgue des données du coffre-fort entre utilisateurs. |
| `backup_retention_days` | `30` (à augmenter en production) | Medium | Un gestionnaire de mots de passe sans rétention suffisante entraîne une perte d'identifiants en cas de défaillance de la base de données. |
| `enable_iap` avec des clients natifs | à utiliser avec précaution | Medium | IAP exige une authentification OAuth dans un navigateur ; les clients Bitwarden natifs ne peuvent pas mener à bien le flux IAP. |
| variables d'environnement `smtp_*` | à configurer comme un ensemble complet | High | Une configuration SMTP partielle provoque des échecs silencieux d'envoi d'e-mails — les codes de récupération 2FA et les e-mails d'invitation ne sont jamais envoyés. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Vaultwarden partagée avec la variante GKE est décrite dans
**[Vaultwarden_Common](Vaultwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Vaultwarden sur Cloud Run](../labs/Vaultwarden_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Vaultwarden sur GKE Autopilot](Vaultwarden_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Vaultwarden Common — Configuration applicative partagée](Vaultwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md), [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Secure Team Communications**.
