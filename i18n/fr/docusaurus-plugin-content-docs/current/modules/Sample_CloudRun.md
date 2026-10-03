---
title: "Exemple d'application sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'une application exemple sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Sample_CloudRun.md @ 15fd4c7 sha256:f40793caf4de -->

# Exemple d'application sur Google Cloud Run {#sample-application-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Sample_CloudRun.png" alt="Exemple d'application sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Le module Sample est une implémentation de référence qui démontre comment les modules
d'application sont construits sur cette plateforme. Il déploie une application web Flask
minimale (Python 3.11, PostgreSQL 15, Redis optionnel, NFS optionnel) sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par l'application Sample et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de
service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

L'application Sample s'exécute en tant que conteneur Python/Gunicorn sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Flask/Gunicorn, 1 vCPU / 512 Mio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis ; le job `db-init` crée le schéma lors du premier déploiement |
| Fichiers partagés | Filestore (NFS) | Activé par défaut ; volume partagé monté à `/mnt/nfs` (nécessite un environnement d'exécution gen2) |
| Stockage d'objets | Cloud Storage | Un seul bucket `data` provisionné par défaut |
| Cache et sessions | Redis | Optionnel (`enable_redis = false` par défaut) ; lorsqu'il est activé, un service interne `redis:alpine` est déployé |
| Secrets | Secret Manager | Clé secrète Flask `SECRET_KEY` auto-générée stockée au moment du déploiement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est fixe.** Le moteur de base de données est défini sur `POSTGRES_15` par
  `Sample_Common` et ne peut pas être changé en MySQL ou `NONE` dans ce module.
- **Un job `db-init` s'exécute lors du premier déploiement** pour créer la base de données
  PostgreSQL, l'utilisateur et le schéma. Il est idempotent et peut être réexécuté en
  toute sécurité.
- **Redis est désactivé par défaut.** Lorsque `enable_redis = true`, un service interne
  `redis:alpine` Cloud Run est déployé. Contrairement à la variante GKE, il n'y a pas de
  repli automatique vers `127.0.0.1` — vous devez définir `redis_host` explicitement sur
  l'URL interne du service ou une IP privée Cloud Memorystore.
- **La clé secrète Flask `SECRET_KEY` est auto-générée** et stockée dans Secret Manager ; elle
  n'est jamais définie en texte clair.
- **`min_instance_count` est par défaut à `0`** (mise à l'échelle à zéro). Le module ne
  remplace pas cela ; définissez-le sur `1` si vous souhaitez éliminer les
  démarrages à froid.
- **Les sondes de santé ciblent `/healthz`** — une sonde de démarrage TCP Cloud Run et une
  sonde de vivacité HTTP contre le point de terminaison `/healthz` (renvoie `{"status": "healthy"}`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Sample {#a-cloud-run--the-sample-service}

L'application Flask s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre les nombres minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

L'application Sample stocke son compteur de visiteurs dans une instance gérée de Cloud SQL
pour PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur
un socket Unix (pas d'IP publique). Lors du premier déploiement, un job
d'initialisation crée la base de données de l'application, l'utilisateur et accorde les
privilèges.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Lorsque `enable_nfs = true` (par défaut), un partage **Filestore (NFS)** est monté dans le
service Cloud Run afin que toutes les instances partagent les mêmes fichiers. Cela
nécessite l'environnement d'exécution `gen2`. Un bucket **Cloud Storage** dédié
est également provisionné.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis (optionnel) {#d-redis-cache-optional}

Lorsque `enable_redis = true`, un service interne `redis:alpine` Cloud Run est déployé
parallèlement à l'application. L'application Flask l'utilise pour le stockage des
sessions côté serveur. Les variables d'environnement `ENABLE_REDIS`, `REDIS_HOST` et
`REDIS_PORT` sont injectées automatiquement. Vous devez définir `redis_host`
explicitement — les instances Cloud Run ne peuvent pas atteindre un service colocalisé via
`127.0.0.1`.

- **Console :** Cloud Run — le service Redis apparaît comme un service Cloud Run séparé
  dans le même projet et la même région.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <redis-service-name> --project "$PROJECT" --region "$REGION"
  ```

### E. Secret Manager {#e-secret-manager}

La clé secrète Flask `SECRET_KEY` est auto-générée lors du premier déploiement et
stockée en tant que secret Secret Manager. Le mot de passe de la base de données est
également géré dans Secret Manager par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés
en couches ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Sample {#3-sample-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` (en utilisant l'image `postgres:15-alpine`) qui crée de
  manière idempotente l'utilisateur de la base de données PostgreSQL, la base de données
  et accorde les privilèges. Il peut être réexécuté en toute sécurité.
- **Sondes de santé.** La sonde de démarrage est TCP (vérifie que le port 8080 est
  ouvert). La sonde de vivacité cible `GET /healthz`, qui renvoie `{"status": "healthy"}`
  immédiatement sans requête de base de données.
- **Compteur de visiteurs.** La route racine (`GET /`) incrémente un compteur
  persistant dans la table `visitors` de PostgreSQL, démontrant à la fois la
  connectivité de la base de données et (lorsque Redis est activé) le suivi par session.
- **Diagnostics de base de données.** `GET /db` exécute `SELECT version()` et
  renvoie la chaîne de version de PostgreSQL — utile pour vérifier rapidement la
  connectivité de la base de données.
- **Gestion des sessions Redis.** Lorsque `enable_redis = true` et `redis_host` est défini
  sur un point de terminaison accessible, l'application Flask utilise `Flask-Session` avec
  un backend Redis. Lorsque `REDIS_HOST` est vide, un avertissement est enregistré et
  les sessions se replient sur des cookies signés.
- **Clé secrète Flask `SECRET_KEY`.** La clé auto-générée est récupérée de Secret
  Manager et injectée en tant que variable d'environnement `SECRET_KEY` au démarrage de
  l'instance. Elle est utilisée pour la signature des sessions.
- **Inspecter les instances en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run revisions list --service <service-name> --region "$REGION" --project "$PROJECT"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Sample_CloudRun sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudrunapp` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Cloudrun Application` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de version de l'image du conteneur. |
| `application_database_name` | `sampleapp` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `cloudrunapp` | Utilisateur de l'application. Immuable après le premier déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `"prebuilt"` déploie une image existante ; `"custom"` construit via Cloud Build. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | URI de l'image lorsque `container_image_source = "prebuilt"`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance. |
| `min_instance_count` | `0` | Instances minimales (0 = mise à l'échelle à zéro). |
| `max_instance_count` | `1` | Instances maximales. |
| `container_port` | `8080` | Flask/Gunicorn écoute sur le port 8080. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (`all` / `internal` / `internal-and-cloud-load-balancing`). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé. Nécessite l'environnement d'exécution `gen2`. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS existante ; laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM NFS intégrée lorsqu'il n'en existe pas. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré de `Sample_Common`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, port 8080 | Sonde de démarrage TCP (attend que le port s'ouvre). |
| `health_check_config` | HTTP `GET /` | Sonde de vivacité. |
| `startup_probe` / `liveness_probe` | HTTP `GET /healthz` | Paramètres de sonde au niveau de l'application passés à `Sample_Common`. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Déployer un service Redis interne et activer le stockage de session. |
| `redis_host` | `""` | **Doit être défini explicitement.** Pas de repli automatique — laisser vide entraîne un `REDIS_HOST` vide et un échec de connexion. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` (via `Sample_Common`) | PostgreSQL 15 (fixe) | Critique | Le script `db-init` utilise des commandes spécifiques à PostgreSQL ; un moteur différent rompt la configuration de la base de données. |
| `application_database_name` / `_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `application_name` | défini une fois | Critique | Intégré dans le nom du service Cloud Run, le dépôt Artifact Registry et les ID de secret Secret Manager. La modification orpheline les secrets existants. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide échoue le job d'importation. |
| `container_port` | `8080` | Critique | Une non-concordance entraîne l'échec de la sonde de démarrage TCP — la révision ne devient jamais saine. |
| `enable_cloudsql_volume` | `true` | Critique | `false` avec PostgreSQL : toutes les connexions à la base de données échouent au démarrage. Le job `db-init` échoue également. |
| `execution_environment` | `gen2` | Élevé | `gen1` avec `enable_nfs = true` : le montage NFS échoue au démarrage du conteneur. |
| `enable_redis` | `false` (par défaut) | Élevé | `true` sans `redis_host` défini : `REDIS_HOST` est vide et l'application Flask ne peut pas se connecter à Redis. |
| `memory_limit` | `512Mi` ou plus | Élevé | Trop peu de mémoire entraîne l'arrêt de l'application Flask par OOM au démarrage. |
| `ingress_settings` | `all` pour les tests ; `internal-and-cloud-load-balancing` avec Cloud Armor | Moyen | L'utilisation de `all` avec Cloud Armor permet aux requêtes de contourner le WAF via l'URL `*.run.app`. |
| `enable_iap` / `enable_cloud_armor` | activer pour la production | Moyen | L'application est autrement accessible publiquement. |
| `min_instance_count` | `1` pour les charges de travail sensibles à la latence | Moyen | `0` signifie des démarrages à froid (5–10 s) sous charge. |
| `enable_vpc_sc` avec `vpc_sc_dry_run = false` | tester d'abord en mode dry-run | Critique | Si un SA ou une IP est manquant du niveau d'accès, l'accès à Cloud Run, Cloud SQL et Secret Manager échoue simultanément. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application partagée (clé secrète
Flask, amorçage de la base de données, comportement des sondes et sidecar Redis) est
décrite dans **[Sample_Common](Sample_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Sample sur Cloud Run](../labs/Sample_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Exemple d'application sur GKE Autopilot](Sample_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Sample Common — Configuration d'application partagée](Sample_Common.md) — la configuration partagée par les deux cibles de déploiement.
