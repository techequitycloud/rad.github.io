---
title: "GlitchTip sur Google Cloud Run"
description: "Référence de configuration pour déployer GlitchTip sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/GlitchTip_CloudRun.md @ 3055034 sha256:2df996ff69d9 -->

# GlitchTip sur Google Cloud Run {#glitchtip-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GlitchTip_CloudRun.png" alt="GlitchTip sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GlitchTip est une plateforme open source de suivi des erreurs et de surveillance des
performances compatible avec Sentry (Django/Python). Vos applications envoient leurs
exceptions et leurs traces au point de terminaison d'ingestion de GlitchTip, qui parle
le protocole Sentry, et GlitchTip les stocke, les déduplique et déclenche des alertes.
Ce module déploie GlitchTip sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise GlitchTip et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GlitchTip s'exécute comme un conteneur Python sur Cloud Run v2, servi par **Granian**
sur le port 8080. Le rôle de serveur `all_in_one` exécute le serveur web, le worker
Celery et Celery beat dans un seul conteneur. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Django/Granian, 2 vCPU / 4 GiB par défaut ; `min_instance_count = 1` maintient le worker/beat en vie |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — GlitchTip ne prend en charge ni MySQL ni d'autres moteurs |
| File de tâches et cache | Cloud SQL (PostgreSQL) | `VALKEY_URL = ""` fait passer la file Celery, le cache et les sessions par Postgres ; Redis est facultatif |
| Stockage d'objets / de fichiers | Cloud Storage + NFS | Un bucket de données `storage` ; NFS monté sur `/opt/glitchtip/storage` pour les pièces jointes téléversées |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe initial du superutilisateur générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur casse le démarrage.
- **L'image est un build personnalisé léger.** GlitchTip est construit `FROM glitchtip/glitchtip:6.2.0`
  avec un point d'entrée cloud qui compose `DATABASE_URL` à partir des variables `DB_*`
  injectées (le mot de passe de la base est un secret d'exécution, impossible à
  interpoler au moment du plan) et désactive Valkey/Redis avant de passer la main au
  `./bin/start.sh` propre à l'image.
- **Pas de Redis par défaut.** `VALKEY_URL = ""` signifie que la file Celery, le cache
  et les sessions utilisent tous PostgreSQL. C'est le bon choix pour une instance
  unique toujours active ; n'activez Redis que si vous devez faire évoluer la flotte de
  workers.
- **`min_instance_count = 1` et `cpu_always_allocated = true`.** Comme le worker et le
  beat Celery s'exécutent dans le même processus (`SERVER_ROLE = all_in_one`), une mise
  à l'échelle jusqu'à zéro ou un bridage du CPU entre les requêtes arrêterait le
  traitement des événements en arrière-plan et le nettoyage planifié.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés automatiquement**
  et stockés dans Secret Manager. `SECRET_KEY` est injectée dans le conteneur ; le mot
  de passe du superutilisateur n'est utilisé que par le job `glitchtip-migrate`.
- **Le propriétaire initial est créé d'office, pas par auto-inscription.**
  `glitchtip-migrate` crée le superutilisateur `admin@techequity.cloud` ;
  `ENABLE_OPEN_USER_REGISTRATION` vaut `false` par défaut.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin que
  les SDK applicatifs et les navigateurs puissent joindre le point de terminaison
  d'ingestion et le tableau de bord. Activer IAP bloque l'ingestion d'événements non
  authentifiés.
- **La rétention des événements est de 90 jours** (`GLITCHTIP_MAX_EVENT_LIFE_DAYS = 90`) ;
  les événements stockés plus anciens sont purgés par le worker d'arrière-plan.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service GlitchTip {#a-cloud-run--the-glitchtip-service}

GlitchTip s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs. Comme le worker/beat s'exécute dans le même processus, le service est
maintenu actif (`min_instance_count = 1`, `cpu_always_allocated = true`).

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GlitchTip stocke toutes les données applicatives (projets, tickets, événements,
utilisateurs et la file Celery) dans une instance gérée Cloud SQL for PostgreSQL 15.
Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket
Unix ; aucune IP publique n'est exposée. Au premier déploiement, les Jobs `db-init` et
`glitchtip-migrate` créent la base de données et l'utilisateur, exécutent les
migrations et créent le superutilisateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base, l'utilisateur et le secret du mot de passe figurent dans
les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket de données **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement. Les pièces jointes téléversées et les source maps de GlitchTip sont
stockées sur **NFS**, monté par défaut sur `/opt/glitchtip/storage` (`enable_nfs = true`).

- **Console :** Cloud Storage → Buckets ; Filestore/Compute Engine pour le serveur NFS.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Redis / Valkey (facultatif) {#d-redis--valkey-optional}

Redis est **désactivé par défaut** (`VALKEY_URL = ""` → file et cache adossés à
PostgreSQL). Définir `enable_redis = true` et fournir `redis_host` fait pointer le
broker Celery et le cache de GlitchTip vers Redis/Valkey — utile uniquement lorsque
vous séparez la flotte de workers du niveau web à des volumes plus élevés.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the queue backend in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets sont générés automatiquement : la `SECRET_KEY` de Django (signature des
sessions) et le mot de passe initial du superutilisateur (utilisé par le job de
migration). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app`, ce qui permet l'accès public
nécessaire à l'ingestion des événements des SDK. Un équilibreur de charge HTTPS externe
avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres
d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont transmis à Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL sont transmises à Cloud Monitoring, avec des tests de disponibilité et
des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GlitchTip {#3-glitchtip-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init`
  (`postgres:15-alpine`) se connecte via le Cloud SQL Auth Proxy et crée de façon
  idempotente la base de données et l'utilisateur de l'application, accorde les
  privilèges et réattribue la propriété du schéma `public`. Il peut être relancé sans
  risque.
- **Migrations + amorçage du superutilisateur.** Le Job `glitchtip-migrate` s'exécute
  sur l'image GlitchTip construite (`depends_on = ["db-init"]`). Il compose
  `DATABASE_URL`, exécute `./manage.py migrate --noinput`, puis
  `createsuperuser --noinput` avec `SUPERUSER_EMAIL` (`admin@techequity.cloud`) et le
  mot de passe du superutilisateur stocké dans Secret Manager. Un compte en double est
  ignoré, de sorte que les relances sont sûres. Le mot de passe administrateur initial
  se trouve dans Secret Manager (`secret-<prefix>-<app>-superuser-password`).
- **Rôle de serveur `all_in_one`.** `SERVER_ROLE = all_in_one` exécute le serveur web,
  le worker Celery et le beat dans un seul conteneur. Conservez
  `min_instance_count >= 1` et `cpu_always_allocated = true` — une mise à l'échelle
  jusqu'à zéro arrête l'ingestion en arrière-plan et la purge quotidienne liée à la
  rétention des événements.
- **`SECRET_KEY` ne doit pas être renouvelée à la légère.** Elle signe les
  sessions/cookies ; la renouveler déconnecte tout le monde.
- **L'ingestion des événements nécessite une entrée publique.** Les SDK applicatifs
  envoient (POST) les événements au point de terminaison d'ingestion
  (`/api/<project>/store/` et le point de terminaison envelope). Conservez
  `ingress_settings = "all"` ; activer IAP bloque l'ingestion des SDK (ne placez IAP
  que devant le tableau de bord si vous séparez les usages).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut.
  Prévoyez jusqu'à plusieurs minutes au premier démarrage (la sonde de démarrage offre
  un délai initial de 60 secondes plus une large fenêtre d'échec de 30 tentatives à une
  période de 15 s) pendant l'exécution des migrations.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à GlitchTip ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement (utilisez `cr` pour une exécution aux côtés de la variante GKE). |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `glitchtip` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `GlitchTip Error Tracking` | Nom lisible affiché dans l'interface de la plateforme. |
| `description` | `GlitchTip - Open-source Sentry-compatible error tracking platform` | Brève description de la finalité de l'application. |
| `application_version` | `6.2.0` | Tag de l'image GlitchTip ; pilote le build `FROM glitchtip/glitchtip:<tag>`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | GlitchTip est un build personnalisé léger ; conservez `custom`. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | Obligatoire — le worker/beat Celery intégré au processus doit s'exécuter entre les requêtes. |
| `min_instance_count` | `1` | Conservez ≥ 1 pour que le worker/beat reste en vie. |
| `max_instance_count` | `5` | Limite supérieure de la mise à l'échelle automatique. |
| `container_port` | `8080` | GlitchTip est servi par Granian sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Socket du Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour l'ingestion publique des événements des SDK. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque l'ingestion d'événements non authentifiés.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas ici `SECRET_KEY`, `DATABASE_URL` ni `VALKEY_URL`. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création des secrets. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatisées (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | (bucket de données) | Un bucket de données `storage` est déclaré par `GlitchTip_Common`. |
| `enable_nfs` | `true` | Stockage NFS des pièces jointes monté sur `nfs_mount_path`. |
| `nfs_mount_path` | `/opt/glitchtip/storage` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (gen2 requis). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — GlitchTip exige PostgreSQL 15. |
| `db_name` | `glitchtip` | Nom de la base PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `glitchtip` | Utilisateur de la base de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` + `glitchtip-migrate`. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 60s delay, 30 × 15s failure window | Sonde de démarrage. Prévoyez plusieurs minutes au premier démarrage. |
| `liveness_probe` | HTTP `/` 60s delay | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, mêmes délais | Sondes structurées alternatives. |
| `uptime_check_config` | désactivé (`enabled=false`, chemin `/`) | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Utilise Redis/Valkey pour la file et le cache au lieu de PostgreSQL. |
| `redis_host` | `""` | Point de terminaison Redis. Doit être défini explicitement sur Cloud Run. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison / port de la base. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `glitchtip-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit tous les événements et projets stockés. |
| `SECRET_KEY` (générée automatiquement) | Ne jamais la renouveler à la légère | Élevé | La renouveler invalide toutes les sessions et déconnecte tous les utilisateurs. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle jusqu'à zéro arrête le worker/beat Celery intégré au processus — les files d'ingestion des événements se bloquent et la purge de rétention ne s'exécute jamais. |
| `cpu_always_allocated` | `true` | Élevé | La facturation à la requête bride le CPU à ~0 entre les requêtes, privant le worker/beat de ressources. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` bloque l'ingestion des événements des SDK externes. |
| `enable_iap` | uniquement pour un déploiement limité au tableau de bord | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les POST d'événements des SDK. |
| `ENABLE_OPEN_USER_REGISTRATION` (fixé à `false`) | n/a | Élevé | Non exposé comme variable sur cette variante — `GlitchTip_Common` le définit toujours à `false`, si bien que l'inscription reste sur invitation d'un administrateur. |
| `database_type` | `POSTGRES_15` | Élevé | GlitchTip exige PostgreSQL ; tout autre moteur casse le démarrage (fixé par `GlitchTip_Common`). |
| `memory_limit` | `4Gi` | Moyen | En dessous d'environ 1 GiB, les processus Django + worker + beat risquent un OOM lors des pics d'événements. |
| `container_port` | valeur par défaut du module | Moyen | GlitchTip écoute sur `8080` ; modifier le port sans adapter la liaison de Granian casse les sondes de santé. |
| `GLITCHTIP_MAX_EVENT_LIFE_DAYS` (fixé à `90`) | n/a | Faible | Non exposé comme variable sur cette variante ; une valeur trop élevée ferait croître la base sans limite, une valeur trop basse supprimerait des événements dont vous pourriez encore avoir besoin. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à GlitchTip,
partagée avec la variante GKE, est décrite dans
**[GlitchTip_Common](GlitchTip_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GlitchTip sur Cloud Run](../labs/GlitchTip_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GlitchTip sur GKE Autopilot](GlitchTip_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [GlitchTip Common — Configuration applicative partagée](GlitchTip_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md) et [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Source Control & CI/CD**.
