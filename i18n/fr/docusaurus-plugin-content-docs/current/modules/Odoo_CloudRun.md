---
title: "Odoo sur Cloud Run"
description: "Référence de configuration pour déployer Odoo sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Odoo_CloudRun.md @ 3055034 sha256:61d0f5bac6f9 -->

# Odoo sur Cloud Run {#odoo-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_CloudRun.png" alt="Odoo sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo est une suite ERP open source complète comptant plus de 12M d'utilisateurs, avec des modules couvrant le CRM,
la comptabilité, les stocks, la fabrication, les RH et l'eCommerce. Ce module déploie Odoo Community
Edition sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Odoo et sur la manière de les explorer et de les exploiter depuis
la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — Workload Identity, gestion du trafic, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Odoo s'exécute comme une charge de travail ERP Python/PostgreSQL. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Odoo ; environnement d'exécution gen2 requis pour les montages NFS ; descend à zéro par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Odoo ne prend en charge ni MySQL ni SQL Server |
| Fichiers partagés | Filestore (NFS) | Répertoires filestore, sessions et extra-addons partagés entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket d'addons dédié (`odoo-addons`) pour les addons personnalisés et communautaires |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; requis lorsque `max_instance_count > 1` pour partager l'état des sessions |
| Secrets | Secret Manager | Mot de passe maître généré automatiquement (`ODOO_MASTER_PASS`) et mot de passe de la base de données |
| Entrée | Cloud Load Balancing | IP externe avec domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** Le moteur de base de données est fixe ; choisir MySQL ou `NONE` empêche
  le démarrage.
- **NFS est requis.** Sans volume Filestore partagé, le filestore d'Odoo (pièces jointes,
  champs binaires, ressources compilées) est isolé dans chaque instance et perdu au redémarrage.
- **La descente à zéro est le comportement par défaut.** `min_instance_count = 0`. Les démarrages à froid du service Odoo
  ajoutent 30 à 60 secondes, plus le temps de migration du schéma. Définissez `min_instance_count = 1` pour la production ou
  toute charge de travail interactive.
- **Deux jobs d'initialisation s'exécutent à chaque déploiement.** `nfs-init` configure la propriété des répertoires NFS et
  `db-init` crée la base de données et l'utilisateur PostgreSQL — toutes deux sont idempotentes.
- **Le mot de passe maître Odoo** est généré automatiquement et stocké dans Secret Manager ; vous
  ne le définissez jamais en clair.
- **Le premier démarrage est lent.** Odoo installe le module de base et exécute les migrations de schéma au premier
  démarrage ; la sonde de démarrage utilise un contrôle **TCP** (délai initial de 60s, période de 30s, 3 tentatives —
  environ 2.5 minutes au total), car HTTP n'est pas fiable avant la fin de l'initialisation de la base de données.
- **`execution_environment = "gen2"` est requis.** Les montages de volumes NFS ne sont pris en charge que par
  l'environnement d'exécution Cloud Run de deuxième génération.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `SERVICE` sont définis avec les valeurs indiquées dans les
[sorties](#5-outputs).

### A. Cloud Run v2 — le service Odoo {#a-cloud-run-v2--the-odoo-service}

Le service Odoo s'exécute comme un service Cloud Run v2 dans l'environnement d'exécution `gen2`. Les requêtes
adressées au service sont acheminées via un Cloud Load Balancer.

- **Console :** Cloud Run → sélectionnez le service Odoo pour voir les révisions, la répartition du trafic, les journaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION"
  gcloud run services logs read "$SERVICE" --project "$PROJECT" --region "$REGION" --limit 100
  # Tail logs live:
  gcloud run services logs tail "$SERVICE" --project "$PROJECT" --region "$REGION"
  # Check Odoo health endpoint:
  curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
  # Expect: 200
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la gestion des révisions, la répartition du trafic,
le nombre minimal/maximal d'instances et les paramètres de concurrence.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Odoo stocke toutes les données de l'ERP (contacts, factures, stocks, commandes) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les instances du service s'y connectent en privé via le sidecar **Cloud SQL Auth
Proxy** sur un socket Unix ; aucune IP publique n'est donc exposée. Au premier déploiement, la tâche `db-init`
crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # Confirm database and user were created:
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  gcloud sql users list --instance=<instance-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, consultez [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le filestore d'Odoo (pièces jointes binaires, images, ressources compilées), les données de session et les répertoires extra-addons
sont écrits sur un partage **Filestore (NFS)** monté dans chaque instance du service, afin que
toutes les révisions voient les mêmes fichiers. Un bucket **Cloud Storage** dédié (`odoo-addons`) est
également provisionné pour les addons personnalisés et communautaires.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le
  bucket des addons.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<addons-bucket>/        # bucket name is in the Outputs
  # Confirm NFS subdirectories via a Cloud Run Jobs execution:
  gcloud run jobs execute nfs-init --project "$PROJECT" --region "$REGION" --wait
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis sert de magasin de sessions à Odoo lorsque plusieurs instances s'exécutent. Sans Redis,
la descente à zéro comme l'exécution de plusieurs instances entraînent de fréquentes pertes de session. Redis est désactivé par
défaut ; définissez `enable_redis = true` et `redis_host` pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm Redis environment variables injected into the running service:
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe maître Odoo (`ODOO_MASTER_PASS`) et le mot de passe de la base de données sont stockés en tant que
secrets Secret Manager et injectés dans les instances du service à l'exécution ; aucune valeur en clair
n'apparaît dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  # Retrieve the database password:
  gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour l'intégration CSI et la rotation.

### F. Réseau, entrée et équilibrage de charge {#f-networking-ingress--load-balancing}

Par défaut, le service Cloud Run est placé derrière un Cloud Load Balancer. Un domaine personnalisé avec
certificat géré par Google et une IP externe statique peuvent être activés.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  gcloud compute forwarding-rules list --project "$PROJECT"
  gcloud compute addresses list --project "$PROJECT"
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur les domaines personnalisés, le CDN et l'IP
statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr du service sont envoyées vers Cloud Logging ; les métriques Cloud Run vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting / Uptime checks.
- **CLI :**
  ```bash
  gcloud run services logs read "$SERVICE" --project "$PROJECT" --region "$REGION" --limit 50
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\"" \
    --project "$PROJECT" --limit 50
  # Watch for Odoo startup progress:
  gcloud run services logs tail "$SERVICE" --project "$PROJECT" --region "$REGION" \
    | grep -E "odoo.modules|http.server"
  ```

---

## 3. Comportement de l'application Odoo {#3-odoo-application-behaviour}

- **Deux jobs d'initialisation à chaque déploiement.**
  - `nfs-init` — monte le partage NFS et crée `/mnt/filestore`, `/mnt/sessions` et
    `/mnt/extra-addons` avec la propriété `101:101` (l'utilisateur du processus Odoo). Doit réussir
    avant le démarrage d'Odoo.
  - `db-init` — s'exécute après `nfs-init` et crée de manière idempotente la base de données PostgreSQL et
    l'utilisateur de l'application. Les deux tâches peuvent être relancées sans risque.
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```
- **Migration du schéma au démarrage.** Le conteneur démarre Odoo avec `-i base`, qui applique automatiquement
  les migrations de schéma en attente. Les mises à niveau de version sont appliquées au déploiement suivant.
- **Mot de passe maître Odoo.** Un mot de passe alphanumérique de 16 caractères généré automatiquement est stocké dans
  Secret Manager et injecté sous le nom `ODOO_MASTER_PASS`. Il protège l'interface de gestion des
  bases de données à l'adresse `/web/database/manager`. Remplacez-le à l'aide de `explicit_secret_values` :
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **Descente à zéro et démarrages à froid.** La valeur par défaut `min_instance_count = 0` signifie que le service
  descend à zéro instance lorsqu'il est inactif. Les démarrages à froid ajoutent 30 à 60 secondes pour l'initialisation de Python/Odoo,
  en plus du temps de montage NFS. Définissez `min_instance_count = 1` pour tout déploiement à usage interactif.
- **Instances multiples et état des sessions.** Sans Redis, plusieurs instances simultanées ne peuvent pas
  partager l'état des sessions Odoo. N'augmentez pas `max_instance_count` au-delà de `1` sans activer Redis
  et fournir une valeur `redis_host`. Sans Redis, les pertes de session sont fréquentes dans les déploiements
  à plusieurs instances.
- **SMTP pour les e-mails sortants.** Odoo utilise des variables d'environnement pour son transport de courrier sortant.
  Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` dans
  `environment_variables` avant la mise en service ; placez `SMTP_PASSWORD` dans
  `secret_environment_variables`.
- **Sondes de santé.** La sonde de démarrage utilise **TCP** (port 8069) avec un délai initial de 60 secondes.
  La sonde de vivacité utilise **HTTP** `GET /web/health` (HTTP 200 requis). La sonde de vivacité
  commence après 120 secondes. Au premier démarrage (création du schéma), le démarrage peut prendre de 2 à 10 minutes.
  ```bash
  curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
  # Expect: 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres
à Odoo ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `odoo` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Odoo ERP` | Nom convivial affiché dans la console. |
| `application_description` | `Odoo ERP on Cloud Run` | Annotation de description du service. |
| `application_version` | `18.0` | Canal nightly d'Odoo à installer (`"18.0"`, `"17.0"`, `"16.0"`). Incrémentez-le pour effectuer une mise à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de CPU et de mémoire de l'instance. **Augmentez à ≥ 2 vCPU / 4 GiB pour la production.** |
| `cpu_always_allocated` | `false` | Lorsque la valeur est `true`, la CPU est allouée en permanence (facturation à l'instance) au lieu de l'être uniquement pendant le traitement d'une requête. Odoo utilise par défaut la facturation à la requête, mais il exécute aussi un cron interne au processus (`max_cron_threads`) pour les actions planifiées — définissez `true` si vous en dépendez (factures récurrentes/relances) ; sinon, la CPU est bridée entre les requêtes et les tâches cron se bloquent. |
| `min_instance_count` | `0` | Nombre minimal d'instances. Définissez `1` pour éviter les démarrages à froid pour les utilisateurs actifs. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Ne dépassez pas `1` sans activer Redis. |
| `container_port` | `8069` | Port d'écoute d'Odoo. Ne le modifiez pas, sauf si le serveur Odoo est reconfiguré. |
| `execution_environment` | `gen2` | Requis pour les montages de volumes NFS. Ne le modifiez pas. |
| `timeout_seconds` | `300` | Délai de traitement des requêtes (5 minutes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |

### Groupe 5 — Entrée et VPC {#group-5--ingress--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Trafic autorisé vers le service. Définissez `internal-and-cloud-load-balancing` avec Cloud Armor pour la production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'envoie que le trafic RFC-1918 via le VPC ; le trafic public sort via NAT. |
| `enable_iap` | `false` | Impose une connexion Google devant Odoo. Recommandé pour les déploiements d'ERP réservés aux administrateurs. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en clair. Vide par défaut — définissez ici `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` pour les e-mails sortants. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par ex. `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Valeurs sensibles écrites dans Secret Manager pendant le déploiement. À utiliser pour définir un `ODOO_MASTER_PASS` personnalisé. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; portez-la à 90+ pour les données financières ou de conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure un dump PostgreSQL lors du déploiement. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, domaines et Artifact Registry {#group-10--cloud-armor-domains--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) à l'équilibreur de charge. Vivement recommandé pour tout déploiement Odoo exposé à Internet. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket des addons. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket `odoo-addons` géré par Odoo. |
| `enable_nfs` | `true` | Requis — les répertoires filestore, sessions et addons d'Odoo doivent résider sur un stockage partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS dans le conteneur, tel que le voit App_CloudRun. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le remplacez pas par MySQL ou `NONE`. |
| `application_database_name` | `odoo` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `odoo` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `nfs-init` + `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées définies par l'utilisateur (Cloud Scheduler → Cloud Run Jobs). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type = "TCP", initial_delay_seconds = 60 }` | Sonde TCP sur le port 8069 ; HTTP n'est disponible qu'après l'initialisation de la base de données. |
| `liveness_probe` | `{ type = "HTTP", path = "/web/health", initial_delay_seconds = 120 }` | Contrôle HTTP après 120 secondes ; `/web/health` ne renvoie 200 que lorsqu'Odoo dispose d'une connexion active à la base de données. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour le stockage des sessions. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL principale du service Odoo. |
| `service_location` | Région Cloud Run. |
| `stage_services` | Correspondance des URL de service pour les révisions propres à chaque étape Cloud Deploy. |
| `load_balancer_ip` | IP externe de l'équilibreur de charge. |
| `load_balancer_url` | URL du domaine personnalisé lorsqu'un domaine est configuré. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | IP privée de l'instance Cloud SQL (accessible via la sortie VPC — Cloud Run n'a pas de proxy `127.0.0.1` ; le montage du socket pour `DB_HOST` se trouve dans `/cloudsql/...`). **Sensible.** |
| `database_port` | Port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux et tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration. |
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
| `database_type` | `POSTGRES_15` | Critical | Odoo exige exclusivement PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critical | Sans NFS, les pièces jointes et les données de session sont isolées par instance et perdues au redémarrage. |
| `execution_environment` | `gen2` | Critical | Les montages de volumes NFS ne sont pas pris en charge en `gen1` ; le service ne démarrera pas. |
| `application_database_name` / `_user` | à définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données de l'ERP. |
| `memory_limit` | `≥ 4Gi` pour la production | Critical | La valeur par défaut `1Gi` peut provoquer un OOM Python lors du chargement des modules ou du traitement de transactions volumineuses. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | fort et unique | Critical | Le gestionnaire de bases de données à l'adresse `/web/database/manager` n'est protégé que par ce mot de passe ; une valeur faible permet à quiconque peut atteindre l'URL de supprimer la base de données. |
| `max_instance_count` avec Redis désactivé | `1` | High | Plusieurs instances sans Redis invalident en permanence les sessions les unes des autres. |
| `enable_redis` | `true` lorsque `max_instance_count > 1` | High | Sans Redis, les utilisateurs sont déconnectés lorsque leur requête aboutit sur une autre instance. |
| `redis_host` | point de terminaison explicite | High | Requis lorsque `enable_redis = true` ; une valeur vide provoque des défaillances du backend de sessions au démarrage. |
| `min_instance_count` | `1` pour la production | High | La descente à zéro ajoute des délais de démarrage à froid de 30 à 90 secondes et arrête le planificateur d'arrière-plan d'Odoo. |
| `cpu_always_allocated` | `true` si vous dépendez du cron d'Odoo | High | La valeur par défaut `false` correspond à la facturation à la requête — la CPU est bridée à quasi zéro entre les requêtes **même avec `min_instance_count = 1`**, si bien que le cron interne au processus d'Odoo (`max_cron_threads`) qui pilote les actions planifiées (factures récurrentes/relances) peut se bloquer ou ne jamais s'exécuter. Définissez `true` pour conserver la CPU allouée au worker cron. |
| `backup_retention_days` | `90` pour la production | High | Odoo contient des données financières ; 7 jours ne suffisent pas pour la plupart des exigences de conformité. |
| `application_version` | LTS valide (`18.0`, `17.0`) | High | Un tag de version invalide fait échouer l'étape Cloud Build lors du build de l'image. |
| `enable_iap` / `enable_cloud_armor` | à activer pour la production | High | Le gestionnaire de bases de données et le portail d'administration d'Odoo ne doivent pas être accessibles publiquement sans authentification. |
| `ingress_settings` | `internal-and-cloud-load-balancing` avec Cloud Armor | Medium | `all` expose directement l'URL Cloud Run, en contournant la couche WAF. |
| `timeout_seconds` | `900` pour les déploiements riches en rapports | Medium | Les rapports ou imports Odoo longs peuvent dépasser 5 minutes ; la valeur par défaut `300` renverra une erreur 504 lors de la génération de rapports volumineux. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM, gestion du trafic, mise à l'échelle,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Odoo partagée avec la
variante GKE est décrite dans **[Odoo_Common](Odoo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Odoo sur Cloud Run](../labs/Odoo_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Odoo sur GKE Autopilot](Odoo_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Configuration applicative partagée d'Odoo](Odoo_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), de [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), d'[OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) et de [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Integrated ERP Platform**.
