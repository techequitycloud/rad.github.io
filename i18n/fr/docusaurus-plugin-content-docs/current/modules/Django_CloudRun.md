---
title: "Django sur Cloud Run"
description: "Référence de configuration pour déployer Django sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Django_CloudRun.md @ 3055034 sha256:2021c75b8062 -->

# Django sur Cloud Run {#django-on-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Django_CloudRun.png" alt="Django sur Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Django est un framework web Python éprouvé qui favorise un développement rapide et
une conception propre et pragmatique, et qui fait fonctionner certaines des applications web les plus exigeantes au monde.
Ce module déploie Django sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Django et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — Workload Identity, entrée (ingress), autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Django s'exécute comme un conteneur Python/Gunicorn sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Python/Gunicorn, 1 vCPU / 512 MiB par défaut ; autoscaling jusqu'à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le `DB_ENGINE` de Django est fixé à `django.db.backends.postgresql` |
| Fichiers partagés | Filestore (NFS) | Médias partagés entre toutes les instances de conteneur (nécessite l'environnement d'exécution gen2) |
| Stockage d'objets | Cloud Storage | Un bucket de médias dédié provisionné par Django_Common |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe de la base de données générés automatiquement |
| Cache (facultatif) | Redis / Cloud Memorystore | Désactivé par défaut ; à activer pour le stockage des sessions et la mise en cache |
| Entrée | Cloud Load Balancing | Équilibreur de charge HTTPS externe avec domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est imposé.** `Django_Common` fixe `DB_ENGINE` sur PostgreSQL ;
  MySQL et `NONE` ne sont pas pris en charge par ce module.
- **La `SECRET_KEY` Django est générée automatiquement** et stockée dans Secret Manager ;
  elle est injectée à l'exécution et n'est jamais définie en clair.
- **Quatre extensions PostgreSQL sont installées automatiquement** (`pg_trgm`, `unaccent`,
  `hstore`, `citext`) par le job `db-init`, vous n'avez donc pas à les configurer.
- **Deux jobs d'initialisation s'exécutent par défaut** — `db-init` (crée la base de données et
  l'utilisateur) et `db-migrate` (exécute `manage.py migrate` et `collectstatic`). Sur Cloud Run,
  ils s'exécutent sous forme de Cloud Run Jobs déclenchés à l'apply.
- **NFS est activé par défaut.** Toutes les instances de conteneur partagent le même volume
  Filestore pour les fichiers médias téléversés. Les montages NFS nécessitent
  `execution_environment = "gen2"` (défini automatiquement).
- **Redis est désactivé par défaut.** Activez-le avec `enable_redis = true` et pointez-le vers une
  instance Cloud Memorystore pour le stockage des sessions et la mise en cache en production.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count` vaut `0` par défaut ; définissez-le à `1`
  en production pour éliminer les démarrages à froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `SERVICE` sont définis. Le nom du service et
les autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run v2 — le service Django {#a-cloud-run-v2--the-django-service}

Django s'exécute comme un service Cloud Run mis à l'échelle automatiquement entre `min_instance_count`
et `max_instance_count`. Chaque instance exécute un sidecar Cloud SQL Auth Proxy et,
lorsque NFS est activé, monte le partage Filestore.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, la répartition du trafic, les journaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT"
  gcloud run services list --region "$REGION" --project "$PROJECT"
  # Stream live logs:
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"' \
    --project "$PROJECT" --limit 50
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la répartition du trafic entre révisions, le nombre minimal/maximal
d'instances, la concurrence et la configuration de l'environnement d'exécution.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Django stocke toutes les données applicatives dans une instance gérée Cloud SQL for PostgreSQL 15.
Les instances de conteneur y accèdent via le **Cloud SQL Auth Proxy** par un socket Unix
local, de sorte qu'aucune IP publique n'est exposée. Lors du premier déploiement, le Cloud Run Job `db-init`
crée la base de données applicative et l'utilisateur, installe les extensions requises et
accorde les privilèges. Le job `db-migrate` exécute ensuite `manage.py migrate` et
`manage.py collectstatic`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  # List the initialization jobs:
  gcloud run jobs list --region "$REGION" --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous exposés dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatiques et la rotation des mots de passe, consultez [App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les médias téléversés sont écrits sur un partage **Filestore (NFS)** monté dans chaque instance
de conteneur, afin que tous les réplicas voient les mêmes fichiers. Un bucket de médias **Cloud Storage**
dédié est également provisionné automatiquement par `Django_Common` ; le compte de service
de la charge de travail y reçoit l'accès. Les montages NFS sur Cloud Run nécessitent l'environnement d'exécution `gen2`,
que ce module définit par défaut.

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage → Buckets pour
  le bucket de médias.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, les volumes GCS Fuse
et les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, Django reçoit
`REDIS_HOST` et `REDIS_PORT` comme variables d'environnement. Configurez `settings.py` pour
les utiliser dans `CACHES` et `SESSION_ENGINE`. Le module ne provisionne pas d'instance
Redis — utilisez une instance Cloud Memorystore et définissez `redis_host` sur son IP privée.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  # Confirm REDIS_HOST and REDIS_PORT are in the service environment:
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format="json" | jq '.spec.template.spec.containers[0].env[]|select(.name|startswith("REDIS"))'
  ```

### E. Secret Manager {#e-secret-manager}

La `SECRET_KEY` Django et le mot de passe de la base de données sont stockés sous forme de secrets
Secret Manager et injectés dans les instances de conteneur à l'exécution ; aucune valeur en clair n'apparaît dans
la configuration. Le mot de passe du superutilisateur (si vous en créez un via `DJANGO_SUPERUSER_PASSWORD`)
doit également être stocké ici.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # The database password secret name is in the Outputs:
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de montage des secrets, les montages de volume
par rapport aux références de variables d'environnement, et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, le service est exposé directement sur son URL HTTPS `run.app`
(`ingress_settings = "all"`). L'entrée peut être restreinte à `internal` ou à
`internal-and-cloud-load-balancing` via `ingress_settings`, et la sortie VPC peut être
contrôlée via `vpc_egress_setting`. Les noms d'hôte du chemin équilibré en charge sont
configurés via `application_domains`.

- **Console :** Network services → Load balancing ; Cloud Run → service → onglet Networking.
- **CLI :**
  ```bash
  gcloud run services describe "$SERVICE" --region "$REGION" --project "$PROJECT" \
    --format="value(status.url)"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés, Cloud CDN,
l'IP statique et les détails de la sortie VPC.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers
Cloud Monitoring. Des tests de disponibilité (uptime checks) et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="'"$SERVICE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Django {#3-django-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Cloud Run Job `db-init` crée la base de données
  PostgreSQL et l'utilisateur, accorde les privilèges et installe les quatre extensions requises
  (`pg_trgm`, `unaccent`, `hstore`, `citext`) à l'aide du secret de superutilisateur `ROOT_PASSWORD`.
  Le job est idempotent et peut être réexécuté sans risque.
- **Migrations au premier déploiement.** Un Cloud Run Job `db-migrate` exécute
  `manage.py migrate` et `manage.py collectstatic --noinput --clear` une fois `db-init`
  terminé. Les deux jobs sont déclenchés automatiquement à l'apply
  (`execute_on_apply = true`). Remplacez `initialization_jobs` par une liste non vide
  pour les remplacer par des jobs personnalisés.
- **Gestion de `SECRET_KEY`.** Une clé aléatoire de 50 caractères est générée par
  `Django_Common` et stockée dans Secret Manager. Elle est injectée sous le nom `SECRET_KEY`.
  Ne définissez pas `SECRET_KEY` dans `environment_variables`.
- **Création du superutilisateur.** Si `DJANGO_SUPERUSER_USERNAME`, `DJANGO_SUPERUSER_EMAIL`
  et `DJANGO_SUPERUSER_PASSWORD` sont présents comme variables d'environnement au démarrage du
  conteneur, `entrypoint.sh` crée un superutilisateur Django au premier démarrage. Utilisez
  `secret_environment_variables` pour le mot de passe :
  ```bash
  # Retrieve the superuser password from Secret Manager:
  gcloud secrets versions access latest --secret=<superuser-secret> --project "$PROJECT"
  ```
- **Sondes de santé.** La sonde de démarrage cible `GET /healthz` sur le port 8080 avec un
  délai initial de 60 secondes. La sonde de vivacité cible également `GET /healthz` avec un
  délai initial de 30 secondes. Implémentez une vue `/healthz/` légère qui renvoie un HTTP
  200 sans redirection. Notez que le trafic des sondes de santé Cloud Run arrive en HTTP ;
  évitez de définir `SECURE_SSL_REDIRECT = True` dans `settings.py`, sinon la sonde
  recevra une redirection 301 et le service ne deviendra jamais sain.
- **Tâches planifiées.** Les commandes de gestion Django (par ex. `clearsessions`) peuvent être
  planifiées sous forme de Cloud Run Jobs via la variable `cron_jobs` :
  ```bash
  gcloud run jobs list --region "$REGION" --project "$PROJECT"
  gcloud run jobs execute <job-name> --region "$REGION" --project "$PROJECT"
  ```
- **Environnement d'exécution gen2.** Les montages NFS nécessitent des conteneurs Cloud Run gen2.
  Celui-ci est défini automatiquement lorsque `enable_nfs = true`. Si vous désactivez NFS, vous pouvez
  remplacer `execution_environment` par `"gen1"`, mais gen2 est fortement recommandé.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Django ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service Cloud Run et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails bénéficiant de l'accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `django` | Nom de base des ressources. **Ne pas modifier après le premier déploiement.** |
| `application_display_name` | `Django Application` | Nom convivial affiché dans la console. |
| `application_description` | `Django Application - High-level Python Web framework` | Annotation de description du service. |
| `application_version` | `latest` | Tag de version de l'image ; incrémentez-le pour déployer une nouvelle révision. Épinglez un tag précis en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image via Cloud Build ; `prebuilt` déploie une URI d'image existante. |
| `container_image` | `us-docker.pkg.dev/cloudrun/container/hello` | URI d'image de conteneur de remplacement. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire par instance. |
| `min_instance_count` | `0` | Nombre minimal d'instances actives. Définissez ≥ 1 pour éliminer les démarrages à froid en production. |
| `max_instance_count` | `1` | Nombre maximal d'instances actives simultanément. |
| `container_port` | `8080` | Django/Gunicorn écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. Ne pas modifier, sauf si NFS est désactivé. |

### Groupe 5 — Gestion du trafic et IAP {#group-5--traffic-management--iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée Cloud Run : `all`, `internal` ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Sortie via le connecteur VPC sans serveur. |
| `enable_iap` | `false` | Exiger une connexion Google devant Django. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder lorsque IAP est activé. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. N'y incluez pas `SECRET_KEY` ni `DB_*`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (par ex. `DJANGO_SUPERUSER_PASSWORD`). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. Définissez `enable_backup_import = false` après un import réussi. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor et CDN {#group-10--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associer une règle Cloud Armor (WAF) au backend. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur l'équilibreur de charge. |
| `application_domains` | `[]` | Noms d'hôte à servir (également utilisés pour le domaine personnalisé). |

### Groupe 11 — Système de fichiers (NFS) et Cloud Storage {#group-11--filesystem-nfs--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les médias Django (à garder activé en multi-instance). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. Doit correspondre à `MEDIA_ROOT` dans `settings.py`. |
| `create_cloud_storage` | `true` | Provisionner le bucket de données supplémentaire. Le bucket de médias est toujours provisionné par `Django_Common`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket de médias provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **PostgreSQL 15 obligatoire.** Django ne prend pas en charge MySQL via ce module. |
| `application_database_name` | `django_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `django_user` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_user_env_var_name` / `db_name_env_var_name` | `""` | Remplacer le nom de la variable d'environnement utilisée pour injecter l'utilisateur/le nom de la base de données. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

Les quatre extensions requises (`pg_trgm`, `unaccent`, `hstore`, `citext`) sont installées
automatiquement par le job `db-init` intégré — aucune variable n'est nécessaire pour elles.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | _(built-in `db-init`)_ | Par défaut, un seul Cloud Run Job `db-init` est défini. Le job `db-migrate` est toujours ajouté par `Django_Common`. Fournissez une liste non vide pour remplacer le `db-init` par défaut par des jobs personnalisés. |
| `cron_jobs` | `[]` | Cloud Run Jobs planifiés (par ex. `clearsessions`, `cleartokens`). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /healthz`, 60s initial delay | Sonde de démarrage transmise à `Django_Common`. Augmentez le délai pour les ensembles de migrations volumineux. **N'utilisez pas de chemin qui redirige.** |
| `liveness_probe` | HTTP `GET /healthz`, 30s initial delay | Sonde de vivacité. Utilisez un point de terminaison léger qui renvoie 200 sans corps. |
| `startup_probe_config` | enabled, HTTP `/healthz` | Sonde de démarrage d'infrastructure au niveau d'App_CloudRun. |
| `health_check_config` | enabled, HTTP `/healthz` | Contrôle de santé d'infrastructure au niveau d'App_CloudRun. |
| `uptime_check_config` | disabled (`enabled = false`, path `/`) | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage des sessions et la mise en cache. |
| `redis_host` | `""` | IP ou nom d'hôte Redis. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL HTTPS permettant d'atteindre Django. |
| `service_location` | Région dans laquelle le service est déployé. |
| `stage_services` | Correspondance des noms et URL des services par étape Cloud Deploy. |
| `load_balancer_ip` / `load_balancer_url` | IP externe et URL HTTPS (lorsqu'une IP statique est réservée). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des Cloud Run Jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `uptime_check_names` | Noms des tests de disponibilité Cloud Monitoring provisionnés. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Django exige PostgreSQL ; MySQL ou `NONE` fera échouer le job `db-init`. |
| `application_name` / `tenant_id` | définis une seule fois | Critical | Intégrés aux noms des ressources ; les modifier recrée toutes les ressources nommées et détruit les données. |
| `application_database_name` / `_user` | définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit les données. |
| Chemin de `startup_probe` | `/healthz` (sans redirection) | Critical | Le trafic des sondes Cloud Run est en HTTP simple ; une redirection renvoie 301, Cloud Run ne voit jamais de 200 et le service ne démarre jamais. |
| `SECURE_SSL_REDIRECT` dans `settings.py` | `False` ou exemption de `/healthz` | Critical | `True` redirige chaque requête HTTP, y compris la sonde de démarrage ; le service reste bloqué à l'état `STARTING`. |
| `enable_backup_import` | `false` après restauration | High | Le laisser à `true` relance l'import à chaque apply, écrasant les données en production par la sauvegarde obsolète. |
| `enable_nfs` | `true` (par défaut) | High | Le désactiver avec `max_instance_count > 1` signifie que chaque instance dispose d'un stockage éphémère isolé ; les téléversements sont perdus à l'arrêt de l'instance. |
| `execution_environment` | `gen2` (par défaut lorsque NFS est activé) | High | `gen1` ne prend pas en charge les montages de volumes NFS ; le service ne démarre pas. |
| `nfs_mount_path` | `/mnt/nfs` — doit correspondre à `MEDIA_ROOT` | High | Une incohérence amène Django à écrire les médias sur un stockage éphémère ; les fichiers sont perdus à l'arrêt de l'instance. |
| Mémoire de `container_resources` | ≥ `512Mi` ; à augmenter pour les charges de travail intensives en ORM | High | Mémoire insuffisante : l'instance s'arrête en OOM (exit 137) sur les querysets volumineux ou le traitement de fichiers. |
| `min_instance_count` | `1` en production | Medium | `0` provoque des démarrages à froid (> 60 s) sur la première requête après une période d'inactivité ; les cron jobs peuvent ne trouver aucune instance active. |
| `application_version` | tag épinglé, pas `latest` | Medium | `latest` rend le retour arrière ambigu ; Cloud Run ne peut pas distinguer deux tirages de `latest`. |
| `enable_redis` | `true` en cas de sessions stockées dans Redis | Medium | Laissé à `false` avec un `settings.py` configuré pour Redis : `ConnectionRefusedError` à chaque accès au cache ou aux sessions. |
| `ingress_settings` | `internal-and-cloud-load-balancing` pour les services privés derrière un équilibreur de charge | Medium | `all` permet l'appel direct de l'URL du point de terminaison Cloud Run en contournant Cloud Armor/IAP. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les accès d'administration | Medium | Sinon, l'interface d'administration Django est accessible publiquement à l'URL du service. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Django, partagée
avec la variante GKE, est décrite dans **[Django_Common](Django_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Django sur Cloud Run](../labs/Django_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Django sur GKE Autopilot](Django_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Django Common — Configuration applicative partagée](Django_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Custom Application Starter**.
