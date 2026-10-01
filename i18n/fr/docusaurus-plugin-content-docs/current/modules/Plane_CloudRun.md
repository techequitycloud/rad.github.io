---
title: "Plane sur Google Cloud Run"
description: "Référence de configuration pour déployer Plane sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Plane_CloudRun.md @ 3055034 sha256:8e106503c66a -->

# Plane sur Google Cloud Run {#plane-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plane_CloudRun.png" alt="Plane sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plane est une plateforme open source de gestion de projets — une alternative à Jira / Linear pour les tickets, les cycles, les modules et les feuilles de route. Ce module déploie Plane sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Plane et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

La pile auto-hébergée amont de Plane comporte plusieurs services : `web` / `space` / `admin` (frontends), `api` (Django/gunicorn), `worker` + `beat` (Celery), `live` (collaboration en temps réel) et un job `migrator`, plus PostgreSQL, Redis, RabbitMQ et un stockage objet compatible S3. Ce module déploie l'**image communautaire tout-en-un** publiée par Plane (`makeplane/plane-aio-community`), qui regroupe tous les sous-services derrière un **reverse proxy Caddy interne sur le port 80** via supervisord — un seul service Cloud Run expose donc toute l'application. Le déploiement assemble :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur tout-en-un (api + workers + frontends + migrator), 2 vCPU / 4 GiB par défaut |
| Courtier de messages | RabbitMQ en **sidecar dans le pod** | `rabbitmq:3.13-management-alpine` sur `127.0.0.1:5672` — obligatoire pour Celery |
| Base de données | Cloud SQL for PostgreSQL 15 | PostgreSQL standard, aucune extension requise |
| Cache / backend de file de tâches | Redis | Activé par défaut ; hébergé sur la VM du serveur NFS si aucun hôte externe n'est indiqué |
| Fichiers partagés | Filestore / NFS autogéré | Nécessaire à la colocalisation de Redis (environnement d'exécution gen2) |
| Stockage objet | Cloud Storage | Un bucket `storage` dédié est provisionné — le câblage des téléversements S3 est un TODO documenté |
| Secrets | Secret Manager | `SECRET_KEY`, `LIVE_SERVER_SECRET_KEY` et le mot de passe de la base de données gérés automatiquement |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur imposé.** Plane est une application Django ; `database_type = "POSTGRES_15"` et aucun autre moteur ne fonctionne.
- **RabbitMQ est obligatoire et s'exécute en sidecar dans le pod.** Le `start.sh` de Plane se termine avec un code non nul si `AMQP_URL` est vide. AMQP (TCP 5672) est un protocole non HTTP que le réseau de service à service de Cloud Run ne peut pas acheminer ; le courtier partage donc le pod sur `127.0.0.1:5672`. L'état du courtier est **éphémère** (la durabilité des files est un TODO documenté).
- **Build personnalisé.** Un Dockerfile wrapper minimal ajoute un point d'entrée de la plateforme à l'image AIO ; ce point d'entrée compose les chaînes de connexion `DATABASE_URL` / `REDIS_URL` / `AMQP_URL` attendues par Plane à partir des valeurs distinctes `DB_*` / `REDIS_*` / `RABBITMQ_*` injectées par le socle.
- **`application_version` vaut `stable` par défaut.** L'image amont n'a pas de tag `latest` — une entrée `latest` est automatiquement convertie en `stable` au moment du build.
- **Démarrage à froid par défaut.** `cpu_always_allocated = false` et `min_instance_count = 0` (facturation à la requête, mise à zéro). Les notifications, webhooks et exports Celery sont différés jusqu'à ce que la requête suivante réveille une instance — définissez `cpu_always_allocated = true` et `min_instance_count = 1` pour un traitement en arrière-plan continu.
- **Deux secrets applicatifs sont générés automatiquement** dans Secret Manager : le `SECRET_KEY` Django (50 caractères) et `LIVE_SERVER_SECRET_KEY` (40 caractères, authentification de la collaboration en temps réel).
- **Un job `db-init` s'exécute à chaque apply** pour créer de façon idempotente la base de données et l'utilisateur Plane ; les migrations de schéma sont exécutées au démarrage par l'étape `migrator` propre à l'image AIO.
- **Les téléversements de fichiers sont un TODO.** Plane a besoin d'un point de terminaison compatible S3 ; le bucket GCS `storage` existe, mais les clés HMAC d'interopérabilité S3 de GCS ne sont pas encore câblées. Les tickets, projets et cycles fonctionnent sans lui — les pièces jointes et les avatars, non.
- **Les sondes de santé ciblent `/health`** via le proxy Caddy interne sur le port 80.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Plane (avec le sidecar RabbitMQ) {#a-cloud-run--the-plane-service-with-the-rabbitmq-sidecar}

Plane s'exécute comme un service Cloud Run v2 unique. Le conteneur principal est l'image tout-en-un (supervisord exécute migrator → api / frontends / live + worker/beat Celery derrière Caddy sur :80) ; un second **conteneur sidecar `mq`** exécute RabbitMQ. Le démarrage du conteneur principal attend la sonde TCP 5672 du sidecar.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques. Le sidecar apparaît dans l'onglet Conteneurs de la révision.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Plane stocke les espaces de travail, projets, tickets, cycles et utilisateurs dans une instance gérée Cloud SQL for PostgreSQL 15. Au premier déploiement, un Job `db-init` crée la base de données et l'utilisateur de l'application ; l'étape `migrator` de l'image AIO applique ensuite les migrations Django à chaque démarrage du conteneur. Le point d'entrée de la plateforme se connecte via **l'IP privée en TCP avec `sslmode=require`** (le volume de socket Cloud SQL est monté, mais Django/psycopg de Plane utilise le `DATABASE_URL` composé).

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Outputs](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Redis (backend Celery et cache) {#c-redis-celery-backend-and-cache}

Redis sert de cache à Plane et de stockage des résultats Celery. Lorsqu'aucun `redis_host` externe n'est configuré, la VM du serveur NFS héberge Redis et son IP est résolue à l'exécution (le point d'entrée substitue l'espace réservé `$(NFS_SERVER_IP)` avant de composer `REDIS_URL`).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée) ; Compute Engine → Instances de VM (VM NFS/Redis).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 | grep "Composed REDIS_URL"
  ```

### D. Cloud Storage {#d-cloud-storage}

Un bucket `storage` dédié (`gcs-<service-name>-storage`) est provisionné pour les téléversements de fichiers de Plane. **Le câblage des téléversements est un TODO** : Plane exige un point de terminaison compatible S3, et bien que `AWS_S3_ENDPOINT_URL` pointe vers `https://storage.googleapis.com`, les **clés HMAC** d'interopérabilité S3 de GCS **ne sont pas provisionnées** — fournissez `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` via `environment_variables` (ou utilisez un bucket S3 externe) pour activer les pièces jointes.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~plane"
  gcloud storage ls gs://<storage-bucket>/
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont gérés automatiquement : le `SECRET_KEY` Django, le `LIVE_SERVER_SECRET_KEY` (authentification de la collaboration en temps réel) et le mot de passe Cloud SQL. Tous sont injectés à l'exécution ; le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plane"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le détail de l'injection et de la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app` ; l'URL prévue est injectée en tant que `WEB_URL` / `DOMAIN_NAME` / `CORS_ALLOWED_ORIGINS` afin que les redirections OAuth, CORS et les liens des e-mails fonctionnent d'emblée. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté — dans ce cas, le domaine doit correspondre à ces variables d'URL.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur (y compris la sortie supervisord de chaque sous-service intégré et du sidecar `mq`) sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers Cloud Monitoring, avec un test de disponibilité facultatif sur `/health` (désactivé par défaut) et des règles d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Tests de disponibilité.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Plane {#3-plane-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init` (`postgres:15-alpine`) crée de façon idempotente la base de données et l'utilisateur Plane, accorde les privilèges (dont `GRANT <user> TO postgres` afin que la propriété puisse être définie) et arrête proprement son sidecar Cloud SQL Proxy. Il s'exécute à chaque apply et peut être relancé sans risque.
- **Les migrations s'exécutent au démarrage, pas dans un job d'initialisation.** Le supervisord de l'image AIO exécute un programme `migrator` (`manage.py migrate`) avant le démarrage de l'api et des frontends. La sonde de démarrage accorde jusqu'à ~5 minutes (délai initial de 30 s + 30 échecs × 10 s) pour un premier démarrage à froid.
- **Les URL de connexion sont composées par le point d'entrée.** Le point d'entrée de la plateforme construit `DATABASE_URL` (TCP sur IP privée, `sslmode=require` ; loopback avec `sslmode=disable` sur GKE), `REDIS_URL` (en résolvant `$(NFS_SERVER_IP)`) et `AMQP_URL` (à partir de l'hôte injecté du sidecar), puis exécute le `/app/start.sh` intégré de Plane. Recherchez les lignes de journal `Composed DATABASE_URL / REDIS_URL / AMQP_URL` lors du débogage.
- **RabbitMQ est obligatoire.** Le `start.sh` de Plane valide `AMQP_URL` et se termine s'il est vide. L'état du courtier du sidecar est éphémère — les tâches Celery en file sont perdues lors du recyclage d'une instance (TODO de durcissement documenté).
- **Configuration initiale — God Mode.** Ouvrez `<web_url>/god-mode/` pour créer l'administrateur de l'instance et configurer celle-ci (le point d'entrée modifie le Caddyfile interne avec une redirection 308 de `/god-mode` vers `/god-mode/`, pour contourner un problème de basename de la SPA Remix). Inscrivez-vous ensuite à l'URL racine et créez votre premier espace de travail.
- **Les téléversements de fichiers échouent tant que le stockage S3 n'est pas câblé.** Tout le reste (tickets, projets, cycles, modules) fonctionne ; les pièces jointes et les avatars nécessitent de vrais identifiants S3 (voir §2D).
- **Compromis du démarrage à froid.** Avec la configuration par défaut `cpu_always_allocated = false` + `min = 0`, le travail Celery en arrière-plan (notifications, webhooks, exports) ne s'exécute que lorsqu'une instance est active. Pour les équipes qui dépendent de notifications rapides, passez à `cpu_always_allocated = true` + `min_instance_count = 1`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ainsi que le test de disponibilité ciblent `/health` sur le port 80 (le proxy Caddy interne).
- **Vérification :**
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
  gcloud run services logs read <service-name> --region "$REGION" --limit 100 | grep -E "Composed|Starting Plane"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Plane ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `plane` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Plane - Project Management` | Nom convivial affiché dans la console. |
| `application_version` | `stable` | Tag de l'image AIO. L'image amont n'a pas de tag `latest` — `latest` est converti en `stable` au moment du build. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | L'image AIO exécute de nombreux processus (api, workers, frontends, Caddy) ; 2 vCPU au minimum. |
| `memory_limit` | `4Gi` | 4 GiB recommandés — augmentez si le migrator ou le worker manque de mémoire (OOM). |
| `cpu_always_allocated` | `false` | Démarrage à froid / facturation à la requête. Les notifications, webhooks et exports Celery sont différés jusqu'à la requête suivante ; définissez `true` (avec `min ≥ 1`) pour un traitement en arrière-plan continu. |
| `min_instance_count` | `0` | Mise à zéro. Définissez `1` pour éviter les démarrages à froid et maintenir le flux des tâches en arrière-plan. |
| `max_instance_count` | `3` | Plafond de coût. |
| `container_port` | `80` | Le port du proxy Caddy interne — le seul port qu'expose le conteneur AIO. |
| `enable_cloudsql_volume` | `true` | Monte le volume de socket Cloud SQL (le point d'entrée se connecte néanmoins en TCP sur l'IP privée). |
| `execution_environment` | `gen2` | Nécessaire pour les montages NFS. |
| `timeout_seconds` | `300` | Délai d'expiration des requêtes. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle de l'accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public depuis Internet (nécessaire pour accéder à Plane depuis un navigateur). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Sortie vers les plages privées via le connecteur VPC (Cloud SQL, Redis, NFS). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Remplace ou complète l'environnement de Plane. Utilisez-le pour fournir de vrais identifiants S3 (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`) une fois le stockage objet câblé. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7–10 — Sauvegarde, CI/CD, SQL personnalisé, domaine et CDN {#groups-710--backup-cicd-custom-sql-domain--cdn}

Comportement standard d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). À noter pour Plane : si vous définissez `application_domains`, le domaine personnalisé devient l'hôte qu'atteignent les utilisateurs, et `WEB_URL` / `CORS_ALLOWED_ORIGINS` / `DOMAIN_NAME` doivent pointer vers lui (surcharge via `environment_variables`), faute de quoi la connexion et les liens des e-mails ne fonctionnent plus.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Nécessaire à la colocalisation de Redis sur la VM du serveur NFS (gen2). |
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` déclaré par `Plane_Common`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Plane exige PostgreSQL — ne pas passer à MySQL. |
| `db_name` | `plane_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `plane_user` | Utilisateur de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). Les migrations de schéma sont gérées au démarrage par le migrator propre à l'image AIO. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai initial de 30 s, 30 échecs × 10 s | Fenêtre généreuse (~5 min) pour l'étape migrator du premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30 s, période de 30 s | Vivacité vérifiée sur le point de terminaison de santé servi par Caddy. |
| `uptime_check_config` | désactivé, chemin `/health` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Obligatoire — la file de tâches Celery et le cache de Plane dépendent de Redis. |
| `redis_host` | `""` | Laissez vide pour utiliser le Redis hébergé sur la VM NFS. |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Comportement standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging`) — consultez [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `web_url` | URL de l'interface web de Plane (le proxy Caddy interne sert web/space/admin/api sur cette URL unique). |
| `api_url` | URL de l'API Plane (même URL de service, routée par le proxy interne). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (dont le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Les validations au moment du plan détectent plusieurs de ces erreurs ; les autres n'apparaissent qu'à l'exécution.

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Plane est une application Django/PostgreSQL ; MySQL ou `NONE` cassent le migrator et le démarrage. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| Sidecar RabbitMQ | Le laisser câblé | Critical | Le `start.sh` de Plane se termine si `AMQP_URL` est vide — le courtier est obligatoire et doit se trouver dans le pod (Cloud Run ne peut pas acheminer AMQP entre services). |
| `container_port` | `80` | Critical | Le conteneur AIO n'expose que le proxy Caddy interne sur :80 ; tout autre port fait échouer toutes les sondes. |
| `application_version` | `stable` ou un tag réel | High | L'image amont n'a pas de tag `latest` ; le module convertit `latest`→`stable`, mais un tag explicite invalide fait échouer le build en 404 (MANIFEST_UNKNOWN). |
| `enable_redis` | `true` | High | Sans Redis, Celery et le cache n'ont pas de backend ; les workers ne démarrent pas. |
| `enable_nfs` | `true` (lorsque `redis_host` est vide) | High | Le Redis par défaut réside sur la VM NFS ; désactiver NFS sans `redis_host` externe laisse Plane sans point de terminaison Redis. |
| Fenêtre d'échec de `startup_probe` | ≥ 30 × 10 s | High | Le migrator du premier démarrage peut prendre plusieurs minutes ; une sonde trop stricte tue l'instance en pleine migration. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` pour les équipes dépendantes des notifications | Medium | Avec le démarrage à froid par défaut, les notifications/webhooks/exports Celery ne s'exécutent que lorsqu'une instance est active. |
| Stockage objet (`AWS_*`) | De vrais identifiants S3 avant de compter sur les téléversements | Medium | Les téléversements de fichiers (pièces jointes, avatars) échouent tant que des clés HMAC ou un point de terminaison S3 externe ne sont pas fournis — le reste de Plane fonctionne. |
| `application_domains` + variables d'environnement d'URL | Les garder synchronisés | Medium | Un domaine personnalisé qui ne correspond pas à `WEB_URL`/`CORS_ALLOWED_ORIGINS`/`DOMAIN_NAME` casse les redirections de connexion et les liens des e-mails. |
| `memory_limit` | `4Gi` | Medium | L'image AIO exécute de nombreux processus ; un sous-dimensionnement provoque un manque de mémoire (OOM) du migrator ou du worker Celery. |
| Durabilité de RabbitMQ | Accepter l'éphémère ou externaliser | Low | L'état du courtier du sidecar est éphémère ; les tâches en file sont perdues lors du recyclage d'une instance. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Plane, partagée avec la variante GKE, est décrite dans **[Plane_Common](Plane_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Plane sur Cloud Run](../labs/Plane_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Plane sur GKE Autopilot](Plane_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Plane Common — Configuration applicative partagée](Plane_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Planka sur Google Cloud Run](Planka_CloudRun.md), [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md) dans la solution **Project & Task Delivery**.
