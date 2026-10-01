---
title: "Saleor sur Google Cloud Run"
description: "Référence de configuration pour déployer Saleor sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Saleor_CloudRun.md @ 3055034 sha256:4bb4a6c25842 -->

# Saleor sur Google Cloud Run {#saleor-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_CloudRun.png" alt="Saleor sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor est une plateforme d'e-commerce headless open source, pensée d'abord pour GraphQL
et construite sur Python/Django (catalogue de produits, paiement de commande, commandes
et plugins de paiement, le tout exposé via une API GraphQL plutôt qu'une vitrine
intégrée). Ce module déploie Saleor sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise Saleor et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications Cloud Run — identité de service, entrée
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Saleor s'exécute dans un conteneur construit sur mesure (`ghcr.io/saleor/saleor:3.23`
encapsulé avec un point d'entrée cloud) sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Deux services Cloud Run : l'API Saleor principale (uvicorn, 2 workers + worker/beat Celery colocalisé) et un service Dashboard précompilé distinct ; 2 vCPU / 3 GiB par défaut pour le service principal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — fixé par `Saleor_Common` quelle que soit la valeur de `database_type` |
| Stockage d'objets | Cloud Storage | Un bucket `media` dédié provisionné automatiquement |
| Cache et broker | Redis (facultatif) | Supporte `CACHE_URL`/`CELERY_BROKER_URL` pour le worker Celery colocalisé |
| Secrets | Secret Manager | `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, entièrement publique ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Saleor_Common` fixe le moteur de base de données ;
  choisir une autre valeur dans `database_type` n'a aucun effet.
- **Le worker Celery (traitement des commandes, webhooks, e-mails, tâches planifiées)
  s'exécute en colocalisation dans le conteneur principal**, lancé comme processus
  d'arrière-plan par le point d'entrée cloud — et non comme sidecar
  `additional_services` distinct. Il a besoin de la même image construite sur mesure,
  dont le socle ne connaît le chemin Artifact Registry *qu'après* l'appel de ce module ;
  la colocalisation évite donc un cycle au moment du plan.
- **`cpu_always_allocated = true` par défaut.** Le worker Celery colocalisé a besoin de
  CPU en continu entre les requêtes, et pas seulement pendant le traitement d'une
  requête — il a été confirmé en conditions réelles que la facturation à la requête
  sous-dimensionne la charge de travail combinée.
- **Le dimensionnement des ressources est préréglé : `2000m` de CPU / `3Gi` de mémoire.**
  Il a été confirmé en conditions réelles que des tailles inférieures provoquent des
  OOMKill sous la charge combinée de 2 workers uvicorn + Django + worker/beat Celery,
  le tout dans un seul conteneur.
- **Trois secrets sont générés automatiquement** : `SECRET_KEY`, `RSA_PRIVATE_KEY` (la
  paire de clés de signature JWT de Saleor — ne jamais en effectuer la rotation à la
  légère) et `DJANGO_SUPERUSER_PASSWORD`.
- **Un service Dashboard distinct et réellement précompilé**
  (`ghcr.io/saleor/saleor-dashboard:3.23`) est déployé aux côtés de l'API en tant
  qu'entrée `additional_services`. Son `API_URL` est intégrée à l'interface servie au
  démarrage du conteneur, calculée à partir de l'URL de service prévue de l'API
  principale + `/graphql/`.
- **Redis est facultatif et désactivé par défaut** (`enable_redis = false`). Lorsqu'il
  est activé, `redis_host` doit être défini explicitement — Cloud Run ne dispose d'aucun
  repli automatique sur l'IP NFS.
- **Les sondes de santé ciblent `/health/`**, sans authentification, avec un 200
  confirmé en local comme en conditions réelles.
- **`min_instance_count = 0`** par défaut — l'API principale est mise à l'échelle à zéro
  lorsqu'elle est inactive ; définissez `1` en production pour éviter les démarrages à
  froid.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — les services API et Dashboard de Saleor {#a-cloud-run--the-saleor-api-and-dashboard-services}

L'API de Saleor s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à
la charge des requêtes. Le Dashboard s'exécute comme un second service Cloud Run
indépendant (une entrée `additional_services`) qui sert le bundle statique de
l'interface d'administration.

- **Console :** Cloud Run → sélectionnez l'un ou l'autre service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Saleor stocke toutes les données applicatives (produits, commandes, paniers,
utilisateurs, enregistrements de paiement) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte en privé via le **Cloud SQL Auth Proxy** (socket
Unix ou IP privée TCP selon `enable_cloudsql_volume`) ; aucune IP publique n'est
exposée. Au premier déploiement, `db-init` crée la base de données et le rôle de
l'application, puis `db-migrate` (qui dépend de `db-init`) applique les migrations de
schéma de Django.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et
  métriques.
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

Un bucket **Cloud Storage** `media` dédié est provisionné automatiquement pour les
ressources produits/médias téléversées dans Saleor. Des buckets supplémentaires peuvent
être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache et broker Celery) {#d-redis-cache--celery-broker}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini,
`redis_host` et `redis_port` sont injectés sous la forme `REDIS_HOST`/`REDIS_PORT`, et
le point d'entrée cloud en compose `CACHE_URL` (base Redis `/0`) et `CELERY_BROKER_URL`
(base Redis `/1`).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs in the running revision's logs (entrypoint echoes on start):
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager : `SECRET_KEY`
(la clé de signature cryptographique de Django), `RSA_PRIVATE_KEY` (la paire de clés de
signature JWT pour tous les jetons d'accès/d'actualisation émis) et
`DJANGO_SUPERUSER_PASSWORD` (mot de passe du compte administrateur d'amorçage). Le mot
de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service API principal est accessible par défaut à son URL `run.app` (entièrement
public — `ingress_settings = "all"`). Le service Dashboard est déployé avec
`ingress = INGRESS_TRAFFIC_ALL` afin que l'interface d'administration soit elle aussi
directement accessible. Un équilibreur de charge HTTPS externe avec domaine
personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs des deux services sont envoyés à Cloud Logging ; les
métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Saleor {#3-saleor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init`
  (`postgres:15-alpine`) crée de manière idempotente la base de données et le rôle de
  l'application. `db-migrate` (l'image de l'application,
  `depends_on_jobs = ["db-init"]`) exécute ensuite
  `python3 manage.py migrate --noinput`. Les deux jobs peuvent être relancés sans
  risque.
- **Extensions toujours installées.** `pg_trgm`, `unaccent`, `hstore` et `citext` sont
  installées sans condition par la configuration assemblée de `Saleor_Common` — les
  variables `enable_postgres_extensions`/`postgres_extensions` du module appelant n'ont
  aucun effet supplémentaire sur cet ensemble de base.
- **Le worker + beat Celery s'exécute en colocalisation, pas comme service distinct.**
  Le traitement des commandes, les webhooks, les e-mails et les tâches planifiées
  s'exécutent tous dans le processus worker d'arrière-plan du conteneur principal. C'est
  pourquoi `cpu_always_allocated` vaut `true` par défaut — sans allocation continue de
  CPU, le worker manque de ressources entre les requêtes d'API.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY` et `DJANGO_SUPERUSER_PASSWORD` sont immuables après
  le premier démarrage.** `RSA_PRIVATE_KEY` en particulier signe chaque JWT émis par
  Saleor — sa rotation invalide toutes les sessions actives. N'effectuez de rotation que
  pendant une fenêtre de maintenance planifiée.
- **Amorçage du superutilisateur.** Le point d'entrée cloud exécute
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` à chaque
  démarrage lorsque `DJANGO_SUPERUSER_PASSWORD` est défini (de manière idempotente — sans
  effet une fois l'utilisateur créé). `SALEOR_SUPERUSER_EMAIL` vaut par défaut
  `admin@example.com` et n'est pas exposée comme variable de ce module — c'est la valeur
  par défaut fixe propre à `Saleor_Common`.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/health/` — le
  point de terminaison de santé non authentifié de Saleor, dont il a été confirmé qu'il
  renvoie `200` dès que le serveur ASGI accepte les connexions.
- **L'`API_URL` du Dashboard est intégrée au démarrage du conteneur**, et non lue
  dynamiquement — ce qui a été confirmé via le script
  `/docker-entrypoint.d/50-replace-env-vars.sh` de l'image Dashboard officielle, qui
  remplace `API_URL` par sed dans le fichier `index.html` compilé. Sur Cloud Run, il
  s'agit d'une chaîne calculée (l'URL de service prévue de l'API principale +
  `/graphql/`), sûre pour la planification `for_each` puisqu'elle n'est pas connue
  seulement après l'apply.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Saleor ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région des services et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `saleor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Saleor Application` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Correspond à l'ARG de build `SALEOR_VERSION` (`3.23` lorsque `latest`) et au tag propre à l'image Dashboard. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Dimensionné pour la charge de travail combinée uvicorn + Celery — voir la Vue d'ensemble. |
| `cpu_always_allocated` | `true` | Nécessaire pour que le worker Celery colocalisé continue son traitement entre les requêtes. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût. |
| `container_port` | `8000` | Port d'écoute d'uvicorn — doit correspondre au `CMD` de l'image de base. |
| `execution_environment` | `gen2` | Gen2 nécessaire pour les montages NFS/GCS Fuse, le cas échéant. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entièrement public par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés par-dessus les valeurs par défaut propres à `Saleor_Common` (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Ne définissez pas `SECRET_KEY`, `RSA_PRIVATE_KEY` ni `DJANGO_SUPERUSER_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_file`, `backup_format` standard — consultez [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

Options standard d'App_CloudRun pour l'équilibreur de charge, le CDN et le nettoyage
d'Artifact Registry — consultez [App_CloudRun](App_CloudRun.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires, en plus du bucket `media` déclaré par `Saleor_Common`. |
| `enable_nfs` | `true` | Déclaré mais non utilisé par le chemin de stockage propre à Saleor — les médias sont servis depuis le bucket GCS `media`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Déclarée par souci de cohérence avec la convention ; `Saleor_Common` fixe toujours PostgreSQL 15, quelle que soit cette valeur. |
| `application_database_name` | `saleor_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `saleor_user` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 12 — Jobs et tâches planifiées {#group-12--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire intégrée `db-init` → `db-migrate`. |
| `cron_jobs` | `[]` | Jobs récurrents (par exemple, commandes de gestion Saleor) via Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, délai 20s | Sonde de démarrage transmise à `Saleor_Common`. |
| `liveness_probe` | HTTP `/health/`, délai 30s | Sonde de vivacité transmise à `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active le cache/broker de Saleor sur Redis. |
| `redis_host` | `""` | Doit être défini explicitement lorsqu'il est activé — aucun repli automatique sur Cloud Run. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options standard d'App_CloudRun pour VPC-SC et les journaux d'audit — consultez
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run (API principale). |
| `service_url` | URL `run.app` par défaut du service API principal. |
| `service_location` | Région dans laquelle s'exécutent les services. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (dont `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image de l'API déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs `db-init`/`db-migrate`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

L'URL propre au service Dashboard est renvoyée dans l'environnement de l'API principale
sous la forme `SALEOR_DASHBOARD_URL`, plutôt que comme sortie Terraform de premier niveau.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (généré automatiquement) | Jamais de rotation hors d'une fenêtre de maintenance | Critique | Sa rotation invalide chaque JWT émis — toutes les sessions actives doivent se réauthentifier. |
| `SECRET_KEY` (généré automatiquement) | Jamais de rotation à la légère | Critique | La rotation de la clé de signature de Django invalide les cookies/sessions signés. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `cpu_always_allocated` | `true` | Élevé | Le définir sur `false` prive le worker Celery colocalisé de ressources entre les requêtes — le traitement des commandes/webhooks/e-mails se dégrade ou se bloque. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | Élevé | Des tailles inférieures provoquent des OOMKill sous la charge combinée uvicorn + Celery — confirmé en conditions réelles. |
| `enable_redis` | `true` avant de compter sur le débit des tâches asynchrones à grande échelle | Moyen | Sans Redis, le cache et le broker Celery se replient sur un comportement inopérant/en mémoire lié à une seule instance. |
| `redis_host` | À définir explicitement lorsque `enable_redis = true` | Élevé | Cloud Run n'a pas de repli automatique pour l'hôte Redis ; un hôte vide casse la composition de `CACHE_URL`/`CELERY_BROKER_URL`. |
| `min_instance_count` | `1` en production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité, plus un bref intervalle avant la reprise du worker Celery. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Récupérer rapidement depuis Secret Manager | Élevé | Le compte administrateur d'amorçage est le seul moyen d'accès au premier déploiement ; perdre la trace du mot de passe généré impose une réinitialisation manuelle via le shell Django. |
| `enable_iap` | uniquement lorsque le Dashboard/l'API n'ont pas besoin d'un accès public | Élevé | IAP bloque les requêtes non authentifiées vers les services API et Dashboard. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Saleor
partagée avec la variante GKE est décrite dans **[Saleor_Common](Saleor_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Saleor sur Cloud Run](../labs/Saleor_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Saleor sur GKE Autopilot](Saleor_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Saleor Common — Configuration applicative partagée](Saleor_Common.md) — la configuration partagée par les deux cibles de déploiement.
