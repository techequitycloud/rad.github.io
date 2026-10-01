---
title: "Application Sample sur Google Cloud Run"
description: "Référence de configuration pour déployer l'application Sample sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Sample_CloudRun.md @ 3055034 sha256:c9079298f6db -->

# Application Sample sur Google Cloud Run {#sample-application-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Sample_CloudRun.png" alt="Application Sample sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Le module Sample est une implémentation de référence qui montre comment les modules
applicatifs sont construits sur cette plateforme. Il déploie une application web Flask
minimale (Python 3.11, PostgreSQL 15, Redis facultatif, NFS facultatif) sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par l'application Sample et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

L'application Sample s'exécute sous forme de conteneur Python/Gunicorn sur Cloud Run v2.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Flask/Gunicorn, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique en fonction des requêtes |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire ; la tâche `db-init` crée le schéma au premier déploiement |
| Fichiers partagés | Filestore (NFS) | Activé par défaut ; volume partagé monté sur `/mnt/nfs` (nécessite l'environnement d'exécution gen2) |
| Stockage d'objets | Cloud Storage | Un unique bucket `data` provisionné par défaut |
| Cache et sessions | Redis | Facultatif (`enable_redis = false` par défaut) ; lorsqu'il est activé, un service interne `redis:alpine` est déployé |
| Secrets | Secret Manager | `SECRET_KEY` Flask généré automatiquement et stocké au moment du déploiement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est imposé.** Le moteur de base de données est fixé à `POSTGRES_15` par
  `Sample_Common` et ne peut pas être remplacé par MySQL ni par `NONE` dans ce module.
- **Une tâche `db-init` s'exécute au premier déploiement** pour créer la base de données
  PostgreSQL, l'utilisateur et le schéma. Elle est idempotente et peut être relancée sans
  risque.
- **Redis est désactivé par défaut.** Lorsque `enable_redis = true`, un service Cloud Run
  interne `redis:alpine` est déployé. Contrairement à la variante GKE, il n'existe pas de
  repli automatique sur `127.0.0.1` — vous devez définir explicitement `redis_host` avec
  l'URL interne du service ou l'adresse IP privée d'une instance Cloud Memorystore.
- **Le `SECRET_KEY` Flask est généré automatiquement** et stocké dans Secret Manager ; il
  n'est jamais défini en clair.
- **`min_instance_count` vaut `0` par défaut** (mise à l'échelle à zéro). Le module ne
  remplace pas cette valeur ; définissez-la à `1` si vous voulez éliminer les démarrages à
  froid.
- **Les sondes de santé ciblent `/healthz`** — une sonde de démarrage TCP Cloud Run et une
  sonde de vivacité HTTP sur le point de terminaison `/healthz` (qui renvoie
  `{"status": "healthy"}`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Sample {#a-cloud-run--the-sample-service}

L'application Flask s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

L'application Sample stocke son compteur de visiteurs dans une instance gérée Cloud SQL
for PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth
Proxy** sur un socket Unix (sans adresse IP publique). Au premier déploiement, une Job
d'initialisation crée la base de données de l'application, l'utilisateur et accorde les
privilèges.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Lorsque `enable_nfs = true` (valeur par défaut), un partage **Filestore (NFS)** est monté
dans le service Cloud Run afin que toutes les instances partagent les mêmes fichiers.
Cela nécessite l'environnement d'exécution `gen2`. Un bucket **Cloud Storage** dédié est
également provisionné.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Lorsque `enable_redis = true`, un service Cloud Run interne `redis:alpine` est déployé aux
côtés de l'application. L'application Flask l'utilise pour stocker les sessions côté
serveur. Les variables d'environnement `ENABLE_REDIS`, `REDIS_HOST` et `REDIS_PORT` sont
injectées automatiquement. Vous devez définir `redis_host` explicitement — les instances
Cloud Run ne peuvent pas joindre un service co-localisé via `127.0.0.1`.

- **Console :** Cloud Run — le service Redis apparaît comme un service Cloud Run distinct
  dans le même projet et la même région.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <redis-service-name> --project "$PROJECT" --region "$REGION"
  ```

### E. Secret Manager {#e-secret-manager}

Le `SECRET_KEY` Flask est généré automatiquement au premier déploiement et stocké sous
forme de secret Secret Manager. Le mot de passe de la base de données est lui aussi géré
dans Secret Manager par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut s'y ajouter ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Sample {#3-sample-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une Job d'initialisation
  exécute `db-init.sh` (avec l'image `postgres:15-alpine`), qui crée de manière idempotente
  l'utilisateur de base de données PostgreSQL et la base de données, et accorde les
  privilèges. Elle peut être relancée sans risque.
- **Sondes de santé.** La sonde de démarrage est de type TCP (elle vérifie que le port 8080
  est ouvert). La sonde de vivacité cible `GET /healthz`, qui renvoie
  `{"status": "healthy"}` immédiatement, sans requête à la base de données.
- **Compteur de visiteurs.** La route racine (`GET /`) incrémente un compteur persistant
  dans la table PostgreSQL `visitors`, ce qui démontre à la fois la connectivité à la base
  de données et (lorsque Redis est activé) le suivi par session.
- **Diagnostic de la base de données.** `GET /db` exécute `SELECT version()` et renvoie la
  chaîne de version de PostgreSQL — pratique pour vérifier rapidement la connectivité à la
  base de données.
- **Gestion des sessions Redis.** Lorsque `enable_redis = true` et que `redis_host` pointe
  vers un point de terminaison joignable, l'application Flask utilise `Flask-Session` avec
  un backend Redis. Lorsque `REDIS_HOST` est vide, un avertissement est journalisé et les
  sessions se rabattent sur des cookies signés.
- **`SECRET_KEY` Flask.** La clé générée automatiquement est récupérée dans Secret Manager
  et injectée en tant que variable d'environnement `SECRET_KEY` au démarrage de
  l'instance. Elle sert à signer les sessions.
- **Inspecter les instances en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run revisions list --service <service-name> --region "$REGION" --project "$PROJECT"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Sample_CloudRun ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudrunapp` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Cloudrun Application` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image de conteneur. |
| `application_database_name` | `sampleapp` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `cloudrunapp` | Utilisateur de l'application. Immuable après le premier déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | `"prebuilt"` déploie une image existante ; `"custom"` la construit via Cloud Build. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | URI de l'image lorsque `container_image_source = "prebuilt"`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance. |
| `min_instance_count` | `0` | Nombre minimal d'instances (0 = mise à l'échelle à zéro). |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `container_port` | `8080` | Flask/Gunicorn écoute sur le port 8080. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle des accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode de routage du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôte personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Associe une règle WAF / restreint l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé. Nécessite l'environnement d'exécution `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS existante ; laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM NFS créée en ligne lorsqu'aucune n'existe. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée de `Sample_Common`. |
| `cron_jobs` | `[]` | Cloud Run Jobs récurrentes déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, port 8080 | Sonde de démarrage TCP (attend l'ouverture du port). |
| `health_check_config` | HTTP `GET /` | Sonde de vivacité. |
| `startup_probe` / `liveness_probe` | HTTP `GET /healthz` | Paramètres de sonde au niveau applicatif transmis à `Sample_Common`. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Déploie un service Redis interne et active le stockage des sessions. |
| `redis_host` | `""` | **Doit être défini explicitement.** Aucun repli automatique — le laisser vide produit un `REDIS_HOST` vide et un échec de connexion. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
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
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
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

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` (via `Sample_Common`) | PostgreSQL 15 (imposé) | Critical | Le script `db-init` utilise des commandes propres à PostgreSQL ; un autre moteur casse la configuration de la base de données. |
| `application_database_name` / `_user` | défini une seule fois | Critical | Immuable après le premier déploiement ; un renommage recrée la base de données / l'utilisateur et détruit les données. |
| `application_name` | défini une seule fois | Critical | Intégré au nom du service Cloud Run, au dépôt Artifact Registry et aux identifiants des secrets Secret Manager. Le modifier rend orphelins les secrets existants. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `container_port` | `8080` | Critical | Une incohérence fait échouer la sonde de démarrage TCP — la révision ne devient jamais saine. |
| `enable_cloudsql_volume` | `true` | Critical | `false` avec PostgreSQL : toutes les connexions à la base de données échouent au démarrage. La tâche `db-init` échoue également. |
| `execution_environment` | `gen2` | High | `gen1` avec `enable_nfs = true` : le montage NFS échoue au démarrage du conteneur. |
| `enable_redis` | `false` (par défaut) | High | `true` sans `redis_host` défini : `REDIS_HOST` est vide et l'application Flask ne peut pas se connecter à Redis. |
| `memory_limit` | `512Mi` ou plus | High | Une mémoire insuffisante entraîne l'arrêt de l'application Flask pour dépassement de mémoire (OOM) au démarrage. |
| `ingress_settings` | `all` pour les tests ; `internal-and-cloud-load-balancing` avec Cloud Armor | Medium | Utiliser `all` avec Cloud Armor permet aux requêtes de contourner le WAF via l'URL `*.run.app`. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sinon, l'application est accessible publiquement. |
| `min_instance_count` | `1` pour les charges de travail sensibles à la latence | Medium | `0` implique des démarrages à froid (5–10 s) sous charge. |
| `enable_vpc_sc` avec `vpc_sc_dry_run = false` | tester d'abord en mode simulation (dry-run) | Critical | Si un compte de service ou une adresse IP manque dans le niveau d'accès, les accès à Cloud Run, Cloud SQL et Secret Manager échouent tous simultanément. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative partagée (secret Flask,
initialisation de la base de données, comportement des sondes et sidecar Redis) est
décrite dans **[Sample_Common](Sample_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Sample sur Cloud Run](../labs/Sample_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Application Sample sur GKE Autopilot](Sample_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Sample Common — Configuration applicative partagée](Sample_Common.md) — la configuration partagée par les deux cibles de déploiement.
