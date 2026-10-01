---
title: "Moodle sur Google Cloud Run"
description: "Référence de configuration pour déployer Moodle sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Moodle_CloudRun.md @ 3055034 sha256:f6ab4631f3ce -->

# Moodle sur Google Cloud Run {#moodle-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Moodle_CloudRun.png" alt="Moodle sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Moodle est le système de gestion de l'apprentissage (LMS) open source le plus
populaire au monde, utilisé par des universités, des écoles, des entreprises et des
organismes de formation en ligne partout dans le monde.
Ce module déploie Moodle sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Moodle et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Moodle s'exécute sous forme de conteneur PHP 8.3/Apache sur Cloud Run v2. Le
déploiement associe un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP 8.3/Apache, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Moodle ne prend pas en charge MySQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoire Moodle `moodledata` partagé entre toutes les instances ; obligatoire |
| Stockage d'objets | Cloud Storage | Un bucket de données et tout bucket supplémentaire défini par l'utilisateur |
| Cache et sessions | Redis | Activé par défaut ; requis pour la cohérence des sessions PHP entre plusieurs instances |
| Secrets | Secret Manager | Mot de passe cron généré automatiquement, mot de passe SMTP et mot de passe de la base de données |
| Planificateur | Cloud Scheduler | Tâche cron provisionnée automatiquement (toutes les minutes) sur `/admin/cron.php` |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître dès le départ :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe et `MOODLE_DB_TYPE =
  "pgsql"` est codé en dur ; sélectionner MySQL ou `NONE` empêche le démarrage.
- **NFS est obligatoire.** Le répertoire Moodle `moodledata` doit être un système de
  fichiers partagé, accessible en écriture depuis toutes les instances. `enable_nfs`
  vaut `true` par défaut et requiert `execution_environment = "gen2"`.
- **La sonde de démarrage est une sonde HTTP ciblant `/health.php`.** Contrairement à
  certaines applications PHP qui émettent des redirections HTTP→HTTPS, Apache écoute
  dans ce déploiement sur le port 8080 sans redirection ; une sonde HTTP sur
  `/health.php` renvoie donc directement 200.
- **Redis est activé par défaut.** Sans magasin de sessions partagé, les utilisateurs
  sont déconnectés lorsqu'une requête atteint une autre instance Cloud Run.
- **Une tâche Cloud Scheduler est provisionnée automatiquement.** Elle appelle
  `/admin/cron.php` toutes les minutes à l'aide d'un mot de passe cron sécurisé, généré
  automatiquement et stocké dans Secret Manager.
- Le **mot de passe cron** et le **mot de passe SMTP** sont générés automatiquement et
  stockés dans Secret Manager ; vous ne les saisissez jamais en clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Moodle {#a-cloud-run--the-moodle-service}

Moodle s'exécute comme un service Cloud Run v2 sans état. L'autoscaling basé sur les
requêtes ajoute des instances sous charge et, avec `min_instance_count = 0`, réduit à
zéro entre les sessions (développement) ou conserve une instance active lorsqu'il vaut
`1` (production).

- **Console :** Cloud Run → sélectionnez le service Moodle pour consulter les journaux,
  les révisions, les métriques et la configuration.
- **CLI :**
  ```bash
  gcloud run services list --region "$REGION" --project "$PROJECT"
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run revisions list --service <service-name> --region "$REGION" --project "$PROJECT"
  # Stream recent logs:
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="<service-name>"' \
    --project "$PROJECT" --limit 50 --order asc
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur la mise à l'échelle,
la concurrence et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Moodle stocke toutes les données applicatives (cours, utilisateurs, notes, journaux
d'activité) dans une instance gérée Cloud SQL for PostgreSQL 15. Chaque instance
Cloud Run s'y connecte en privé via le sidecar **Cloud SQL Auth Proxy** sur un socket
Unix, si bien qu'aucune adresse IP publique n'est exposée. Lors du premier déploiement,
une tâche d'initialisation crée la base de données et l'utilisateur, et active
l'extension `pg_trgm` pour la recherche en texte intégral de Moodle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Outputs](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `moodledata` de Moodle est écrit sur un partage **Filestore (NFS)** monté
dans chaque instance Cloud Run, afin que toutes les instances voient les mêmes fichiers
téléversés, supports de cours et devoirs des utilisateurs. Un bucket de données
**Cloud Storage** dédié est également provisionné ; le compte de service y reçoit
automatiquement l'accès.

> Les montages de volumes NFS requièrent `execution_environment = "gen2"` (la valeur par défaut).

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets
  pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, GCS Fuse et
les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la gestion des sessions PHP et le cache applicatif de Moodle.
Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP de
l'hôte NFS sert de point de terminaison Redis — ce qui convient au développement. En
production avec plusieurs instances, définissez `redis_host` sur l'adresse IP d'une
instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping           # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe cron et le mot de passe SMTP de Moodle sont générés automatiquement par
`Moodle_Common` et stockés sous forme de secrets Secret Manager. Le mot de passe de la
base de données est généré et géré par le socle. Les trois sont injectés dans les
instances Cloud Run à l'exécution ; aucune valeur en clair n'apparaît dans les fichiers
de configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Outputs](#5-outputs). Après le déploiement, mettez à jour le secret du mot de passe
SMTP avec votre véritable identifiant SMTP :
```bash
echo -n "your-smtp-password" | \
  gcloud secrets versions add <smtp-password-secret> --data-file=- --project "$PROJECT"
```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de la rotation.

### F. Cloud Scheduler {#f-cloud-scheduler}

Une tâche Cloud Scheduler est provisionnée automatiquement à chaque déploiement pour
piloter la file de tâches interne de Moodle. Elle s'exécute toutes les minutes et
s'authentifie à l'aide du `MOODLE_CRON_PASSWORD` généré automatiquement.

- **Console :** Cloud Scheduler → Jobs.
- **CLI :**
  ```bash
  gcloud scheduler jobs list --project "$PROJECT"
  gcloud scheduler jobs describe <job-name> --location "$REGION" --project "$PROJECT"
  # Manually trigger a cron run:
  gcloud scheduler jobs run <job-name> --location "$REGION" --project "$PROJECT"
  ```

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, Moodle est accessible via l'URL `run.app` gérée par Cloud Run. Un
équilibreur de charge HTTPS facultatif avec Cloud Armor et un domaine personnalisé peut
être activé. Définir `application_domains` injecte automatiquement
`MOODLE_REVERSE_PROXY = "true"` et `ENABLE_REVERSE_PROXY = "TRUE"` afin que Moodle
génère des URL HTTPS correctes derrière l'équilibreur de charge.

- **Console :** Cloud Run → sélectionnez le service → Networking ; Network services →
  Load balancing (si vous utilisez Cloud Armor).
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format="value(status.url)"
  gcloud compute forwarding-rules list --project "$PROJECT"     # if LB is enabled
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés, Cloud
CDN et les adresses IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des instances Cloud Run sont envoyées à Cloud Logging ; les
métriques de requêtes et les métriques Cloud SQL sont envoyées à Cloud Monitoring. Des
tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="<service-name>"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Moodle {#3-moodle-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Deux tâches
  d'initialisation s'exécutent avant que le service Cloud Run soit en ligne. La tâche
  `db-init` crée la base de données et l'utilisateur Moodle, active l'extension
  `pg_trgm` et accorde les privilèges (idempotente, peut être relancée sans risque). La
  tâche `nfs-init` crée les sous-répertoires Moodle requis (`filedir`, `temp`, `cache`,
  `localcache`) sur le partage NFS et en attribue la propriété à `www-data`.
- **Planification cron automatique.** Une tâche Cloud Scheduler s'exécute toutes les
  minutes en ciblant `/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`. Elle pilote
  toutes les tâches planifiées de Moodle : sauvegardes de cours, notifications par
  e-mail, traitement des badges et achèvements d'activités. La tâche est toujours créée
  et ne peut pas être désactivée.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent HTTP
  `/health.php`, qui renvoie HTTP 200 lorsque PHP est opérationnel. La sonde de
  démarrage accorde jusqu'à 10 minutes (`failure_threshold = 20`,
  `period_seconds = 30`) pour la création du schéma et l'enregistrement des plugins au
  premier démarrage.
- **E-mail sortant SMTP.** Les paramètres SMTP sont injectés sous forme de variables
  d'environnement. Remplacez les valeurs par défaut via `environment_variables` (voir le
  Groupe 6). Le mot de passe SMTP est généré automatiquement et stocké dans Secret
  Manager ; mettez à jour le secret avec votre véritable identifiant après le
  déploiement.
- **Résolution de `wwwroot`.** Le `config.php` de Moodle résout `wwwroot` à partir de
  la variable d'environnement `APP_URL`, avec `CLOUDRUN_SERVICE_URL` en repli. Lorsque
  `application_domains` est défini, `MOODLE_REVERSE_PROXY` et `ENABLE_REVERSE_PROXY`
  sont automatiquement définis sur `"true"` / `"TRUE"` afin que Moodle génère des URL
  HTTPS correctes derrière l'équilibreur de charge.
- **Réduction à zéro.** `min_instance_count = 0` est la valeur par défaut ; la première
  requête après une période d'inactivité déclenche un démarrage à froid du conteneur
  PHP/Apache. Définissez `min_instance_count = 1` en production pour éliminer la latence
  de démarrage à froid pour les étudiants.
- **Connexion administrateur.** Le nom d'utilisateur et l'adresse e-mail de
  l'administrateur initial sont configurables via `environment_variables`. Le mot de
  passe administrateur est défini lors de la première installation de Moodle via
  `admin/cli/install_database.php`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Moodle ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement et leurs valeurs par défaut standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `moodle` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Moodle LMS` | Nom convivial affiché dans la console. |
| `description` | `Moodle LMS - Online learning and course management platform` | Annotation de description du service. |
| `application_version` | `4.5.1` | Tag de version de l'image de conteneur ; incrémentez-le pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Augmentez à `2000m` en production avec des étudiants simultanés. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 GiB offrent une marge pour PHP avec OPcache. |
| `cpu_always_allocated` | `false` | Valeur par défaut privilégiant le coût, avec démarrage à froid (facturation à la requête, associée à `min_instance_count = 0`). Le cron Moodle intégré au conteneur s'arrête, mais Moodle prend officiellement en charge un cron externe — Cloud Scheduler pilote `admin/cli/cron.php` pendant que le service est réduit à zéro, il n'y a donc aucune perte de fonctionnalité. Définissez `true` avec `min_instance_count >= 1` pour rétablir un fonctionnement continu et permanent. |
| `min_instance_count` | `0` | Nombre minimal d'instances actives. Définissez `1` pour éliminer la latence de démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximal d'instances simultanées. |
| `container_port` | `8080` | Moodle/Apache écoute sur le port 8080. |
| `execution_environment` | `gen2` | Requis pour les montages de volumes NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez jusqu'à 3600 pour les téléversements de fichiers volumineux. |
| `enable_image_mirroring` | `false` | Désactivé — Moodle utilise un Dockerfile personnalisé sans image prébuildée externe. |

### Groupe 5 — Réseau {#group-5--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `"all"` autorise le trafic Internet public. Utilisez `"internal-and-cloud-load-balancing"` lorsque Cloud Armor est placé en amont. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine uniquement le trafic RFC 1918 via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Remplacez ici les valeurs SMTP injectées automatiquement (par ex. `MOODLE_SMTP_HOST`, `MOODLE_ADMIN_EMAIL`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--recovery}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Utilisez-les pour installer des extensions PostgreSQL supplémentaires
ou injecter des données initiales. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Sécurité, stockage et images {#group-10--security-storage--images}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe un WAF Cloud Armor + un équilibreur de charge HTTPS. |
| `application_domains` | `[]` | Noms de domaine personnalisés ; active aussi `MOODLE_REVERSE_PROXY = "true"`. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge. |
| `create_cloud_storage` | `true` | Provisionne le bucket de données. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |

### Groupe 11 — Système de fichiers (NFS) et Cloud Storage {#group-11--filesystem-nfs--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le `moodledata` de Moodle (à laisser activé — requis pour tous les déploiements). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin du conteneur où le partage NFS est monté ; injecté sous la forme `MOODLE_DATA_DIR`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour les thèmes ou les plugins. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 — ne le modifiez pas. |
| `db_name` | `moodle` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `moodle` | Utilisateur de base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 13 — Tâches {#group-13--jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `db-init` et `nfs-init`. |
| `cron_jobs` | `[]` | Tâches Cloud Run Jobs complémentaires déclenchées par Cloud Scheduler (la tâche de planification cron de Moodle est toujours créée séparément). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health.php`, 20 échecs × 30 s | Jusqu'à 10 minutes pour que Moodle termine sa configuration au premier démarrage. |
| `liveness_probe` | HTTP `/health.php`, délai initial de 120 s | Contrôle de santé périodique après le démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utilise Redis pour les sessions PHP et le cache applicatif de Moodle. |
| `redis_host` | `""` | Laissez vide pour utiliser l'adresse IP de l'hôte NFS (développement uniquement) ; définissez l'adresse IP d'une instance Cloud Memorystore pour la production. |
| `redis_port` | `6379` | Port Redis (type chaîne). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut pour accéder à Moodle. |
| `service_location` | Région du service Cloud Run. |
| `stage_services` | URL des révisions de service propres à chaque étape (lorsque Cloud Deploy est activé). |
| `load_balancer_ip` | Adresse IP de l'équilibreur de charge externe (lorsque Cloud Armor + domaine personnalisé sont activés). |
| `load_balancer_url` | URL HTTPS via l'équilibreur de charge. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Hôte de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `nfs_server_ip` | Adresse IP privée du serveur NFS Filestore (sensible). |
| `nfs_instance_tags` | Tags réseau GCE de l'instance NFS. |
| `nfs_mount_path` | Chemin du conteneur où le partage NFS est monté. |
| `nfs_share_path` | Chemin d'exportation sur le serveur NFS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `uptime_check_names` | Noms des tests de disponibilité Cloud Monitoring. |
| `initialization_jobs` / `nfs_setup_job` | Noms des tâches de configuration et d'initialisation NFS. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Moodle requiert PostgreSQL ; `MOODLE_DB_TYPE = "pgsql"` est codé en dur — tout autre moteur empêche le démarrage. |
| `enable_nfs` | `true` | Critical | Sans stockage NFS partagé, `moodledata` n'est pas partagé entre les instances et les fichiers téléversés sont perdus au redémarrage. |
| `execution_environment` | `gen2` (par défaut) | Critical | Les montages de volumes NFS ne sont pas pris en charge en gen1 ; le service ne démarre pas avec NFS activé. |
| `db_name` / `db_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; un renommage recrée la base de données et l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `enable_redis` | `true` | High | Sans magasin de sessions partagé, les utilisateurs d'un déploiement multi-instances sont déconnectés à chaque nouvelle instance. |
| `redis_host` | `""` (NFS) ou explicite | High | Aucun point de terminaison valide si Redis est activé alors que NFS est désactivé et qu'aucun hôte n'est défini. |
| `memory_limit` | `2Gi` | High | Une mémoire insuffisante provoque des erreurs OOM de PHP lors des importations de cours ou des téléversements de fichiers volumineux. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` pour la production | High | Les deux valent par défaut `0` / `false` (priorité au coût, démarrage à froid) : le service est réduit à zéro et le CPU n'est facturé qu'à la requête. `0` provoque des délais de démarrage à froid sur la première requête après une période d'inactivité, y compris l'appel minute par minute de Cloud Scheduler à `admin/cli/cron.php` — Moodle prend officiellement en charge ce modèle de cron externe, donc les tâches planifiées s'exécutent toujours correctement (aucune perte de fonctionnalité), avec simplement une latence supplémentaire occasionnelle. Définissez les deux sur `1` / `true` pour éliminer les démarrages à froid et rétablir un fonctionnement continu. |
| `nfs_mount_path` | `/mnt/nfs` | High | Doit correspondre à `MOODLE_DATA_DIR` ; le modifier après le premier déploiement déplace la racine des données et casse l'installation. |
| `application_domains` + `MOODLE_REVERSE_PROXY` | définis ensemble | High | Sans les flags de reverse proxy, Moodle génère des URL HTTP derrière un équilibreur de charge HTTPS, ce qui casse les liens et les connexions. |
| `enable_cloud_armor` / `enable_iap` | à activer pour l'accès administrateur | Medium | Sinon, l'interface d'administration est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |
| `max_revisions_to_retain` | `7` | Low | Un nombre illimité de révisions conservées peut s'accumuler au fil du temps. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et cycle de vie des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration partagée propre à Moodle est
décrite dans **[Moodle_Common](Moodle_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Moodle sur Cloud Run](../labs/Moodle_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Moodle sur GKE Autopilot](Moodle_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Moodle Common — Configuration applicative partagée](Moodle_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md) dans la solution **Learning Management Platform**.
