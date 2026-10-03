---
title: "Odoo sur Cloud Run"
description: "Référence de configuration pour le déploiement d'Odoo sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Odoo_CloudRun.md @ 15fd4c7 sha256:4641b2d1b3e1 -->

# Odoo sur Cloud Run {#odoo-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Odoo_CloudRun.png" alt="Odoo sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Odoo est une suite ERP open source complète avec plus de 12 millions d'utilisateurs et des
modules couvrant la GRC, la comptabilité, les stocks, la fabrication, les RH et le commerce
électronique. Ce module déploie Odoo Community Edition sur **Cloud Run v2** sur la base de
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'Odoo utilise et sur la façon de les explorer
et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
partagés par toutes les applications Cloud Run — Workload Identity, gestion du trafic, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de base App_CloudRun](App_CloudRun.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Odoo fonctionne comme une charge de travail ERP Python/PostgreSQL. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Odoo ; environnement d'exécution gen2 requis pour les montages NFS ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Odoo ne prend pas en charge MySQL ou SQL Server |
| Fichiers partagés | Filestore (NFS) | Répertoires Filestore, sessions et extra-addons partagés entre toutes les instances |
| Stockage d'objets | Cloud Storage | Un bucket d'addons dédié (`odoo-addons`) pour les addons personnalisés et communautaires |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; requis lorsque `max_instance_count > 1` pour partager l'état de la session |
| Secrets | Secret Manager | Mot de passe maître auto-généré (`ODOO_MASTER_PASS`) et mot de passe de base de données |
| Ingress | Cloud Load Balancing | IP externe avec domaine personnalisé facultatif et certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** Le moteur de base de données est fixe ; la sélection de
  MySQL ou `NONE` empêche le démarrage.
- **NFS est requis.** Sans volume Filestore partagé, le filestore d'Odoo (pièces jointes,
  champs binaires, actifs compilés) est isolé pour chaque instance et perdu au redémarrage.
- **La mise à l'échelle à zéro est la valeur par défaut.** `min_instance_count = 0`. Les démarrages à froid
  sur le service Odoo ajoutent 30 à 60 secondes plus le temps de migration du schéma. Définissez
  `min_instance_count = 1` pour la production ou toute charge de travail interactive.
- **Deux jobs d'initialisation s'exécutent à chaque déploiement.** `nfs-init` configure la
  propriété du répertoire NFS et `db-init` crée la base de données et l'utilisateur
  PostgreSQL — les deux sont idempotents.
- **Le mot de passe maître Odoo** est généré automatiquement et stocké dans Secret Manager ;
  vous ne le définissez jamais en texte clair.
- **Le premier démarrage est lent.** Odoo installe le module de base et exécute les
  migrations de schéma au premier démarrage ; la sonde de démarrage utilise une vérification
  **TCP** (délai initial de 60 s, période de 30 s, 3 tentatives — environ 2,5 minutes de budget
  total) car HTTP n'est pas fiable tant que l'initialisation de la base de données n'est pas
  terminée.
- **`execution_environment = "gen2"` est requis.** Les montages de volume NFS ne sont pris en charge que par
  l'environnement d'exécution Cloud Run de deuxième génération.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `SERVICE` sont définis sur les
valeurs indiquées dans les [Sorties](#5-outputs).

### A. Cloud Run v2 — le service Odoo {#a-cloud-run-v2--the-odoo-service}

Le service Odoo s'exécute en tant que service Cloud Run v2 dans l'environnement d'exécution
`gen2`. Les requêtes vers le service sont acheminées via un équilibreur de charge Cloud.

- **Console :** Cloud Run → sélectionnez le service Odoo pour voir les révisions, les
  répartitions de trafic, les logs et les métriques.
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

Voir [App_CloudRun](App_CloudRun.md) pour la gestion des révisions, la répartition du trafic,
les instances min/max et les paramètres de concurrence.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Odoo stocke toutes les données ERP (contacts, factures, inventaire, commandes) dans une
instance Cloud SQL pour PostgreSQL 15 gérée. Les instances de service se connectent
privilégiement via le sidecar **Cloud SQL Auth Proxy** sur un socket Unix, de sorte qu'aucune
IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée la base de
données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  indicateurs et les métriques.
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

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle
de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir
[App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le filestore d'Odoo (pièces jointes binaires, images, actifs compilés), les données de
session et les répertoires extra-addons sont écrits sur un partage **Filestore (NFS)** monté
dans chaque instance de service afin que toutes les révisions voient les mêmes fichiers. Un
bucket **Cloud Storage** dédié (`odoo-addons`) est également provisionné pour les addons
personnalisés et communautaires.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour le
  bucket d'addons.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<addons-bucket>/        # bucket name is in the Outputs
  # Confirm NFS subdirectories via a Cloud Run Jobs execution:
  gcloud run jobs execute nfs-init --project "$PROJECT" --region "$REGION" --wait
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, GCS Fuse et les options
CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis prend en charge le stockage des sessions d'Odoo lorsque plusieurs instances sont en
cours d'exécution. Sans Redis, la mise à l'échelle à zéro et les instances multiples
entraînent toutes deux des pertes de session fréquentes. Redis est désactivé par défaut ;
définissez `enable_redis = true` et `redis_host` pour l'activer.

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

Le mot de passe maître Odoo (`ODOO_MASTER_PASS`) et le mot de passe de la base de données sont stockés
en tant que secrets Secret Manager et injectés dans les instances de service au moment de
l'exécution ; le texte clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the master password:
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  # Retrieve the database password:
  gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour l'intégration CSI et la
rotation.

### F. Réseau, ingress et équilibrage de charge {#f-networking-ingress--load-balancing}

Par défaut, le service Cloud Run est précédé d'un équilibreur de charge Cloud. Un domaine
personnalisé avec un certificat géré par Google et une IP externe statique peuvent être
activés.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  gcloud compute forwarding-rules list --project "$PROJECT"
  gcloud compute addresses list --project "$PROJECT"
  gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés, le CDN et les détails
de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr du service vers Cloud Logging ; les métriques Cloud Run vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont
disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes /
  Vérifications de disponibilité.
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
    `/mnt/extra-addons` avec la propriété `101:101` (l'utilisateur du processus Odoo). Doit
    réussir avant le démarrage d'Odoo.
  - `db-init` — s'exécute après `nfs-init` et crée de manière idempotente la base de
    données PostgreSQL et l'utilisateur de l'application. Les deux jobs peuvent être
    réexécutés en toute sécurité.
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```
- **Migration de schéma au démarrage.** Le conteneur démarre Odoo avec `-i base`, qui
  applique automatiquement toutes les migrations de schéma en attente. Les mises à niveau de
  version sont appliquées lors du prochain déploiement.
- **Mot de passe maître Odoo.** Un mot de passe alphanumérique de 16 caractères
  auto-généré est stocké dans Secret Manager et injecté en tant que `ODOO_MASTER_PASS`. Il
  protège l'interface de gestion de base de données à `/web/database/manager`. Remplacez-le en
  utilisant `explicit_secret_values` :
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~master-password"
  gcloud secrets versions access latest --secret=<master-password-secret> --project "$PROJECT"
  ```
- **Mise à l'échelle à zéro et démarrages à froid.** La valeur par défaut `min_instance_count = 0`
  signifie que le service se met à l'échelle à zéro lorsqu'il est inactif. Les démarrages à
  froid ajoutent 30 à 60 secondes pour l'initialisation Python/Odoo en plus du temps de
  montage NFS. Définissez `min_instance_count = 1` pour tout déploiement à usage interactif.
- **Multi-instance et état de session.** Sans Redis, plusieurs instances concurrentes ne
  peuvent pas partager l'état de session Odoo. N'augmentez pas `max_instance_count` au-dessus de
  `1` sans activer Redis et fournir une valeur `redis_host`. Sans Redis, la
  perte de session est fréquente dans les déploiements multi-instances.
- **SMTP pour les e-mails sortants.** Odoo utilise des variables d'environnement pour son
  transport de courrier sortant. Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_SSL` et `EMAIL_FROM` dans `environment_variables` avant de passer en production ;
  déplacez `SMTP_PASSWORD` vers `secret_environment_variables`.
- **Sondes de santé.** La sonde de démarrage utilise **TCP** (port 8069) avec un délai
  initial de 60 secondes. La sonde de vivacité utilise **HTTP** `GET /web/health` (nécessite
  HTTP 200). La sonde de vivacité commence après 120 secondes. Lors du premier démarrage
  (création du schéma), le démarrage peut prendre 2 à 10 minutes.
  ```bash
  curl -s -o /dev/null -w "%{http_code}" "https://<service-url>/web/health"
  # Expect: 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Odoo sont listés ; toutes les
autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriétés. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `odoo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Odoo ERP` | Nom convivial affiché dans la console. |
| `application_description` | `Odoo ERP on Cloud Run` | Annotation de description du service. |
| `application_version` | `18.0` | Canal nocturne Odoo à installer (`"18.0"`, `"17.0"`, `"16.0"`). Incrémenter pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de CPU et de mémoire de l'instance. **Augmentez à ≥ 2 vCPU / 4 Gio pour la production.** |
| `cpu_always_allocated` | `false` | Lorsque `true`, le CPU est alloué en permanence (facturation basée sur l'instance) au lieu de seulement lors du traitement d'une requête. Odoo utilise par défaut la facturation basée sur les requêtes, mais il exécute également un cron intégré (`max_cron_threads`) pour les actions planifiées — définissez `true` si vous comptez sur celles-ci (factures/rappels récurrents), sinon le CPU se ralentit entre les requêtes et les jobs cron s'arrêtent. |
| `min_instance_count` | `0` | Instances minimales. Définissez sur `1` pour éviter les démarrages à froid pour les utilisateurs actifs. |
| `max_instance_count` | `1` | Instances maximales. N'augmentez pas au-dessus de `1` sans activer Redis. |
| `container_port` | `8069` | Port sur lequel Odoo écoute. Ne pas modifier sauf si le serveur Odoo est reconfiguré. |
| `execution_environment` | `gen2` | Requis pour les montages de volume NFS. Ne pas modifier. |
| `timeout_seconds` | `300` | Délai d'expiration de traitement des requêtes (5 minutes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions socket. |

### Groupe 5 — Ingress et VPC {#group-5--ingress--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Trafic autorisé vers le service. Définissez sur `internal-and-cloud-load-balancing` avec Cloud Armor pour la production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'envoie que le trafic RFC-1918 sur VPC ; le trafic public sort via NAT. |
| `enable_iap` | `false` | Exige une connexion Google devant Odoo. Recommandé pour les déploiements ERP réservés aux administrateurs. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en texte clair. Vide par défaut — définissez `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_SSL` et `EMAIL_FROM` ici pour les e-mails sortants. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager (par exemple `SMTP_PASSWORD`). |
| `explicit_secret_values` | `{}` | Valeurs sensibles écrites dans Secret Manager pendant le déploiement. Utilisez pour définir un `ODOO_MASTER_PASS` personnalisé. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 90+ pour les données financières/de conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure un dump PostgreSQL lors du déploiement. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, domaines et Artifact Registry {#group-10--cloud-armor-domains--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor (WAF) à l'équilibreur de charge. Fortement recommandé pour tout déploiement Odoo exposé à Internet. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket d'addons. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires au-delà du bucket `odoo-addons` géré par Odoo. |
| `enable_nfs` | `true` | Requis — le filestore, les sessions et les répertoires d'addons d'Odoo doivent résider sur un stockage partagé. |
| `nfs_mount_path` | `/mnt` | Chemin de montage NFS à l'intérieur du conteneur tel que vu par App_CloudRun. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas changer pour MySQL ou `NONE`. |
| `application_database_name` | `odoo` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `odoo` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `nfs-init` + `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées définies par l'utilisateur (Cloud Scheduler → Cloud Run Jobs). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `{ type = "TCP", initial_delay_seconds = 60 }` | Sonde TCP sur le port 8069 ; HTTP non disponible avant l'initialisation de la base de données. |
| `liveness_probe` | `{ type = "HTTP", path = "/web/health", initial_delay_seconds = 120 }` | Vérification HTTP après 120 secondes ; `/web/health` renvoie 200 uniquement lorsque Odoo a une connexion de base de données active. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de disponibilité Cloud Monitoring facultative ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

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
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL principale du service Odoo. |
| `service_location` | Région Cloud Run. |
| `stage_services` | Mappage des URL de service pour les révisions spécifiques à l'étape de Cloud Deploy. |
| `load_balancer_ip` | IP externe de l'équilibreur de charge. |
| `load_balancer_url` | URL de domaine personnalisé lorsqu'un domaine est configuré. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | IP privée de l'instance Cloud SQL (accessible via la sortie VPC — Cloud Run n'a pas de proxy `127.0.0.1` ; le montage de socket pour `DB_HOST` se trouve à `/cloudsql/...`). **Sensible.** |
| `database_port` | Port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux et vérifications de disponibilité. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Odoo nécessite exclusivement PostgreSQL ; MySQL ou `NONE` empêche le démarrage. |
| `enable_nfs` | `true` | Critique | Sans NFS, les pièces jointes et les données de session sont isolées par instance et perdues au redémarrage. |
| `execution_environment` | `gen2` | Critique | Les montages de volume NFS ne sont pas pris en charge dans `gen1` ; le service ne démarrera pas. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données ERP. |
| `memory_limit` | `≥ 4Gi` pour la production | Critique | La valeur par défaut `1Gi` peut déclencher une erreur OOM Python lors du chargement de modules ou du traitement de transactions importantes. |
| `explicit_secret_values` (ODOO_MASTER_PASS) | fort, unique | Critique | Le gestionnaire de base de données à `/web/database/manager` n'est protégé que par ce mot de passe ; une valeur faible expose la suppression de base de données à quiconque peut atteindre l'URL. |
| `max_instance_count` avec Redis désactivé | `1` | Élevé | Plusieurs instances sans Redis invalident continuellement les sessions les unes des autres. |
| `enable_redis` | `true` lorsque `max_instance_count > 1` | Élevé | Sans Redis, les utilisateurs sont déconnectés lorsque leur requête atterrit sur une instance différente. |
| `redis_host` | point de terminaison explicite | Élevé | Requis lorsque `enable_redis = true` ; vide provoque des échecs du backend de session au démarrage. |
| `min_instance_count` | `1` pour la production | Élevé | La mise à l'échelle à zéro ajoute des délais de démarrage à froid de 30 à 90 secondes et arrête le planificateur d'arrière-plan Odoo. |
| `cpu_always_allocated` | `true` si vous comptez sur le cron d'Odoo | Élevé | La valeur par défaut `false` est la facturation basée sur les requêtes — le CPU se ralentit à presque zéro entre les requêtes **même avec `min_instance_count = 1`**, de sorte que le cron intégré d'Odoo (`max_cron_threads`) qui pilote les actions planifiées (factures/rappels récurrents) peut s'arrêter ou ne jamais s'exécuter. Définissez `true` pour maintenir le CPU alloué au worker cron. |
| `backup_retention_days` | `90` pour la production | Élevé | Odoo contient des enregistrements financiers ; 7 jours sont insuffisants pour la plupart des exigences de conformité. |
| `application_version` | LTS valide (`18.0`, `17.0`) | Élevé | Une balise de version invalide échoue l'étape Cloud Build lors de la création de l'image. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Élevé | Le gestionnaire de base de données Odoo et le portail d'administration ne doivent pas être accessibles publiquement sans authentification. |
| `ingress_settings` | `internal-and-cloud-load-balancing` avec Cloud Armor | Moyen | `all` expose directement l'URL Cloud Run, contournant la couche WAF. |
| `timeout_seconds` | `900` pour les déploiements riches en rapports | Moyen | Les rapports ou importations Odoo longs peuvent dépasser 5 minutes ; la valeur par défaut `300` renverra 504 pour la génération de rapports volumineux. |

---

Pour le comportement de base référencé tout au long — IAM, gestion du trafic, mise à l'échelle,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images
— voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Odoo
partagée avec la variante GKE est décrite dans **[Odoo_Common](Odoo_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Odoo sur Cloud Run](../labs/Odoo_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Odoo sur GKE Autopilot](Odoo_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Configuration d'application partagée Odoo](Odoo_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Plateforme ERP intégrée**.
