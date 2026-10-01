---
title: "Tandoor sur Google Cloud Run"
description: "Référence de configuration pour déployer Tandoor sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Tandoor_CloudRun.md @ 3055034 sha256:585ceac02a7e -->

# Tandoor sur Google Cloud Run {#tandoor-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tandoor_CloudRun.png" alt="Tandoor sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tandoor Recipes est un gestionnaire de recettes et planificateur de repas auto-hébergé,
open source et sous licence AGPL-3.0, doté d'un backend d'API REST Python/Django et d'un
frontend Vue 3 intégré. Ce module déploie Tandoor sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Tandoor et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Tandoor s'exécute comme un conteneur unique tout-en-un sur Cloud Run v2 — nginx
s'exécute *à l'intérieur* du conteneur et sert de proxy vers gunicorn via un socket Unix,
de sorte qu'aucun sidecar ni aucune entrée `additional_services` n'est nécessaire. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur unique tout-en-un (nginx + gunicorn), 1 vCPU / 1Gi par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Tandoor n'a pas de moteur de repli pris en charge en production |
| Stockage d'objets | Cloud Storage | Un bucket `data` dédié provisionné automatiquement et monté sur `/opt/recipes/mediafiles` (images des recettes) |
| Cache | Redis (optionnel) | Réellement optionnel — Django se rabat sur un cache en mémoire locale lorsqu'il n'est pas défini ; pas de Celery ni de worker d'arrière-plan |
| Secrets | Secret Manager | `SECRET_KEY` Django et mot de passe initial du superutilisateur générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Tandoor_Common` fixe `database_type =
  "POSTGRES_15"` et `DB_ENGINE = django.db.backends.postgresql`. Le
  `boot.sh` de Tandoor interroge `pg_isready` avant de poursuivre — pas de connexion différée — de sorte que la
  base de données doit être joignable au démarrage du conteneur.
- **Des variables d'environnement Postgres distinctes, pas une DSN.** Tandoor lit
  directement `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_HOST` / `POSTGRES_PORT` /
  `POSTGRES_DB`. Les valeurs `DB_*` standard de la plateforme sont associées à ces noms
  via les variables du socle `db_*_env_var_name`. Aucun encodage d'URL ni point
  d'entrée personnalisé n'est nécessaire.
- **`SECRET_KEY` et le mot de passe du superutilisateur sont générés automatiquement** et
  stockés dans Secret Manager. `SECRET_KEY` ne doit jamais faire l'objet d'une rotation
  après le premier démarrage sans fenêtre de maintenance — sa rotation invalide toutes les
  sessions actives et tous les jetons signés (p. ex. les liens de réinitialisation de mot
  de passe) en cours de validité.
- **Aucun identifiant administrateur fixe ou codé en dur.** Contrairement à l'autre
  module de gestion de recettes de ce catalogue (Mealie, qui est livré avec un identifiant
  `changeme@example.com`/`MyPassword` non documenté et non configurable), Tandoor dispose
  d'un job d'initialisation `create-superuser` qui crée un identifiant réel et unique à
  partir de Secret Manager à chaque déploiement.
- **La mise à l'échelle jusqu'à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Tandoor n'a ni worker d'arrière-plan ni exécuteur de
  tâches planifiées — l'extraction des recettes par import d'URL s'exécute de manière
  synchrone dans la requête qui la déclenche — de sorte que la facturation à la requête
  ne nécessite aucune surcharge.
- **Redis est réellement optionnel et désactivé par défaut.** `CACHES['default']` ne
  bascule vers Redis que si `REDIS_HOST` est défini ; sinon, le cache intégré en mémoire
  locale de Django est utilisé. Il n'y a ni worker Celery ni file d'attente à maintenir
  actifs.
- **Le stockage des images de recettes est monté sur GCS par défaut.** `Tandoor_Common`
  déclare une entrée `gcs_volumes` qui monte le bucket `data`
  (`gcs-<application_name><tenant_prefix>-data`) sur `/opt/recipes/mediafiles`, de sorte
  que les images de recettes téléversées persistent d'une révision à l'autre au lieu de
  résider sur le disque éphémère du conteneur. Une valeur `gcs_volumes` fournie par
  l'opérateur remplace cette valeur par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Tandoor {#a-cloud-run--the-tandoor-service}

Tandoor s'exécute comme un service Cloud Run v2 qui se met automatiquement à l'échelle en
fonction de la charge de requêtes, entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements progressifs sûrs.

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

Tandoor stocke toutes les données de l'application (recettes, plans de repas, listes de
courses, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service se
connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (bien que l'alias
`db_host_env_var_name` utilisé par le `POSTGRES_HOST` propre à Tandoor se résolve en
l'IP privée brute sur Cloud Run — voir le tableau des pièges). Au premier déploiement, un
Job d'initialisation crée la base de données et l'utilisateur de l'application, et un
second job crée le compte superutilisateur.

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

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `data` dédié est provisionné automatiquement pour les images
de recettes et monté dans le conteneur sur `/opt/recipes/mediafiles` (le `MEDIA_ROOT` de
Tandoor) via GCS FUSE. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets` ; fournir vos propres `gcs_volumes` remplace le montage par défaut.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut**. Tandoor n'a ni worker Celery ni file d'attente
d'arrière-plan — activer Redis ne fait que basculer le backend de cache de Django d'un
cache en mémoire locale vers une instance Redis partagée, ce qui est utile pour les
déploiements multi-instances qui ont besoin d'un cache partagé.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets applicatifs sont générés automatiquement et stockés dans Secret Manager : la
`SECRET_KEY` Django (signature cryptographique des sessions, des jetons CSRF et des liens
de réinitialisation de mot de passe) et `DJANGO_SUPERUSER_PASSWORD` (l'identifiant de
connexion initial du superutilisateur). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=secret-<prefix>-tandoor-superuser-password --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les
paramètres d'ingress et la sortie VPC contrôlent la connectivité.

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
règles d'alerte optionnels.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Tandoor {#3-tandoor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job
  d'initialisation `db-init` s'exécute avec `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données et l'utilisateur
  de l'application, puis accorde les privilèges. Le job peut être relancé sans risque.
- **Création du superutilisateur.** Le job d'initialisation `create-superuser` dépend de
  `db-init`. Il applique les migrations Django (idempotentes — un filet de sécurité,
  puisque `boot.sh` effectue aussi les migrations à chaque démarrage du conteneur du
  service principal, mais le job d'initialisation peut s'exécuter avant la fin de ce
  premier démarrage), puis exécute `python manage.py createsuperuser --noinput` en lisant
  `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD`
  depuis l'environnement. Il vérifie d'abord l'existence d'un compte, de sorte que
  réappliquer le module ne provoque pas d'erreur sur une instance déjà initialisée.
- **Migrations à chaque démarrage.** Le `boot.sh` propre à Tandoor applique les
  migrations Django à chaque démarrage du conteneur (de manière idempotente), de sorte
  que la mise à niveau de `application_version` applique automatiquement les
  modifications de schéma.
- **`SECRET_KEY` est immuable après le premier démarrage.** Elle est générée une seule
  fois et écrite dans Secret Manager. Sa rotation invalide toutes les sessions actives et
  tous les jetons signés en cours de validité (p. ex. les liens de réinitialisation de mot
  de passe). N'effectuez de rotation que pendant une fenêtre de maintenance planifiée.
- **Chemin de santé.** La sonde de démarrage cible `/accounts/login/` — la vue de
  connexion publique et non authentifiée de Django — puisque Tandoor n'a pas de point de
  terminaison de santé ou d'information dédié. Elle ne renvoie 200 qu'une fois que
  l'application s'est connectée à Postgres et a appliqué les migrations, ce qui en fait un
  véritable signal de disponibilité. La sonde de liveness cible le même chemin en HTTP :
  Cloud Run rejette purement et simplement les sondes de liveness de type TCP (« Cloud Run
  currently does not support TCP socket in liveness probe » — le TCP n'y est accepté que
  pour la sonde de démarrage), de sorte que `Tandoor_CloudRun` remplace la valeur par
  défaut de liveness TCP de `Tandoor_Common` par une sonde HTTP.
- **Connectez-vous avec l'identifiant généré.** Récupérez `DJANGO_SUPERUSER_PASSWORD`
  dans Secret Manager et connectez-vous sur `/accounts/login/` avec le `admin_username`
  configuré (par défaut `admin`).
- **Inspectez l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Tandoor ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tandoor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Tandoor` | Nom lisible affiché dans la console. |
| `application_description` | `Tandoor recipe manager on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tandoor publie un véritable tag `latest` — transmis tel quel comme tag de l'image. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Tandoor utilise directement l'image officielle — aucun build personnalisé n'est nécessaire. |
| `container_image` | `""` | Laissez vide pour la valeur par défaut du module (`vabene1111/recipes`). |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. Le gunicorn de Tandoor (3 workers) + nginx + django-vite entrent dans une boucle de plantages OOM à 512Mi — 1Gi est le minimum. |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro par défaut. |
| `max_instance_count` | `1` | À augmenter pour du trafic concurrent. |
| `container_port` | `80` | Le nginx de Tandoor écoute sur le port 80 (`TANDOOR_PORT`). |
| `cpu_always_allocated` | `false` | Facturation à la requête — aucun worker d'arrière-plan à maintenir actif. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Tandoor dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, `DJANGO_SUPERUSER_USERNAME`/`EMAIL` sont définis automatiquement — ne les surchargez pas ici à moins de savoir ce que vous modifiez. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL depuis un
bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket `data` provisionné automatiquement. |
| `gcs_volumes` | `[]` | Vide signifie que la valeur par défaut du module s'applique (le bucket `data` sur `/opt/recipes/mediafiles`) ; toute entrée ici remplace entièrement cette valeur par défaut. |
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé par `Tandoor_Common` ; non transmis. |
| `application_database_name` | `tandoor` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `tandoor` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` | `POSTGRES_HOST` | Nom de la variable d'environnement de l'hôte Postgres de Tandoor. |
| `db_user_env_var_name` | `POSTGRES_USER` | Nom de la variable d'environnement de l'utilisateur Postgres de Tandoor. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Nom de la variable d'environnement du mot de passe Postgres de Tandoor. |
| `db_name_env_var_name` | `POSTGRES_DB` | Nom de la variable d'environnement de la base de données Postgres de Tandoor. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Nom de la variable d'environnement du port Postgres de Tandoor. |
| `admin_username` | `admin` | Nom d'utilisateur du superutilisateur initial (`DJANGO_SUPERUSER_USERNAME`). |
| `admin_email` | `admin@techequity.cloud` | E-mail du superutilisateur initial (`DJANGO_SUPERUSER_EMAIL`). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire de jobs intégrés `db-init` + `create-superuser`. |
| `cron_jobs` | `[]` | Non utilisé — Tandoor n'a pas de tâches récurrentes planifiées par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/accounts/login/` délai de 30s | Sonde de démarrage — réussit une fois la connectivité Postgres et les migrations établies. |
| `liveness_probe` | HTTP `/accounts/login/` délai de 30s | Sonde de liveness — en HTTP, car Cloud Run ne prend pas en charge les sondes de liveness TCP. |
| `startup_probe_config` | HTTP `/accounts/login/` | Sonde structurée alternative transmise directement au socle. |
| `health_check_config` | TCP | Sonde de liveness structurée alternative transmise directement au socle. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; activez-le explicitement pour le mettre en service. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Tandoor ne nécessite pas Redis ; laissez `false` sauf pour intégrer une instance externe. |
| `redis_host` | `""` | Point de terminaison Redis. |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
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
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `create-superuser`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration
> par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant toute création de
> ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY` (générée automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation invalide toutes les sessions actives et tous les jetons signés (p. ex. les liens de réinitialisation de mot de passe) en cours de validité. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_file` valide fait échouer le job d'import. |
| Chemin de `startup_probe` | `/accounts/login/` | Critical | Pointer la sonde vers un point de terminaison authentifié/d'administration renvoie 401/403 et la révision ne devient jamais Ready — Tandoor n'a pas d'autre point de terminaison de santé non authentifié. |
| Formule du bucket_name de `gcs_volumes` | `gcs-tandoor<tenant_prefix>-data` | High | Un préfixe erroné monte un bucket inexistant, ce qui bloque le pod à l'étape Init. |
| `DJANGO_SUPERUSER_PASSWORD` (généré automatiquement) | À récupérer dans Secret Manager avant la première connexion | Medium | Sans le récupérer, vous ne pouvez pas vous connecter — il n'existe aucun identifiant de repli comme la valeur fixe par défaut de Mealie. |
| `db_ssl_mode` (`PGSSLMODE`, défini en interne) | `require` sur Cloud Run | High | L'alias `db_host_env_var_name` se résout en l'IP privée brute de Cloud SQL sur Cloud Run (et non en un socket), qui refuse le TCP non chiffré — ce module code `require` en dur dans son câblage, de sorte que cela ne devrait nécessiter aucune intervention manuelle, mais ne le surchargez pas avec `disable`. |
| `enable_redis` | `false` sauf si nécessaire | Low | Tandoor n'a pas de worker d'arrière-plan ; Redis n'affecte que le backend de cache de Django. |
| `ingress_settings` | `all` pour une application publique | Medium | Le définir sur `internal` bloque l'accès depuis le navigateur, sauf s'il est associé à IAP ou à un chemin réseau privé. |
| `memory_limit` | `1Gi` | High | Confirmé en conditions réelles : Tandoor entre dans une boucle de plantages OOM à 512Mi (workers gunicorn tués par SIGKILL). Gen2 impose aussi son propre minimum de 512Mi, quel que soit le mode de facturation. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Tandoor,
partagée avec la variante GKE, est décrite dans **[Tandoor_Common](Tandoor_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Tandoor sur Cloud Run](../labs/Tandoor_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Tandoor sur GKE Autopilot](Tandoor_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Tandoor Common — Configuration applicative partagée](Tandoor_Common.md) — la configuration partagée par les deux cibles de déploiement.
