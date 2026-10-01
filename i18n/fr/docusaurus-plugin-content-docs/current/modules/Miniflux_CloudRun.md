---
title: "Miniflux sur Google Cloud Run"
description: "Référence de configuration pour déployer Miniflux sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Miniflux_CloudRun.md @ 3055034 sha256:df2f55b42ff1 -->

# Miniflux sur Google Cloud Run {#miniflux-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_CloudRun.png" alt="Miniflux sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un unique
binaire Go statique qui stocke tout son état dans PostgreSQL. Ce module déploie
Miniflux sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Miniflux et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Miniflux s'exécute comme un unique conteneur Go sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Un seul binaire Go, 2 vCPU / 4 GiB par défaut, CPU toujours allouée avec `min = 1` pour le collecteur de flux intégré au processus |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Miniflux stocke **tout** son état ici ; pas de MySQL ni d'autre moteur |
| Stockage objet | Cloud Storage | Un bucket `data` par défaut est provisionné mais n'est ni monté ni utilisé par l'application (tout l'état réside dans PostgreSQL) ; un montage NFS facultatif est également disponible mais inutilisé par défaut |
| Cache et file d'attente | Aucun | Miniflux ne dépend pas de Redis et n'a pas de worker séparé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` généré automatiquement (propriétaire initial) ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Le collecteur de flux s'exécute dans le processus.** Miniflux n'a pas de worker
  séparé — le même conteneur sert l'interface et actualise les flux selon
  `POLLING_FREQUENCY`. C'est pourquoi `cpu_always_allocated = true` et
  `min_instance_count = 1` sont les valeurs par défaut : une facturation à la requête
  réduirait la CPU du collecteur à ~0 au repos et bloquerait les actualisations. Pour
  permettre la mise à zéro, passez à `cpu_always_allocated = false` + `min = 0` et
  externalisez la collecte via un appel Cloud Scheduler à `/v1/feeds/refresh`.
- **Le propriétaire initial est pré-créé, pas auto-inscrit.** `CREATE_ADMIN = 1` crée
  le compte `admin` à partir du secret `ADMIN_PASSWORD` au premier démarrage ;
  l'inscription libre en libre-service reste désactivée. Récupérez le mot de passe
  dans Secret Manager pour vous connecter.
- **Les migrations de schéma s'exécutent au démarrage** (`RUN_MIGRATIONS = 1`) — il
  n'existe pas de job de migration séparé, de sorte que la mise à niveau de la version
  applique automatiquement les changements de schéma.
- **Pas de Redis.** `enable_redis = false` — Miniflux conserve chaque flux, entrée et
  session dans PostgreSQL. Laissez-le désactivé.
- **Entrée publique par défaut.** `ingress_settings = "all"` pour que l'interface web
  (ainsi que les points de terminaison API / Fever / Google Reader de Miniflux) soit
  joignable. Activer IAP place l'interface derrière une connexion Google.
- **`DATABASE_URL` est composée à l'exécution** par le point d'entrée du conteneur
  (forme mot-clé/valeur de libpq), selon le mode socket, loopback ou TCP sur IP
  privée, afin que la même image fonctionne sur Cloud Run et GKE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Miniflux {#a-cloud-run--the-miniflux-service}

Miniflux s'exécute comme un service Cloud Run v2 qui écoute sur le port **8080**.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs. Comme le collecteur de flux
s'exécute dans le conteneur, la CPU est allouée en permanence et au moins une
instance est maintenue active.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~miniflux"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Miniflux stocke **toutes** les données applicatives (flux, entrées, utilisateurs,
sessions, catégories) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service
se connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix ;
aucune IP publique n'est exposée. Au premier déploiement, le job `db-init` crée la
base de données et le rôle `miniflux` et installe l'extension `hstore`, dont le rôle
applicatif est propriétaire.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Miniflux n'a besoin d'**aucun** stockage objet — il conserve tout son état dans
PostgreSQL. La valeur par défaut `storage_buckets` de la variante provisionne
néanmoins un bucket Cloud Storage `data` (code standard de l'ossature), mais il n'est
ni monté ni référencé par l'application ; définissez `storage_buckets = []` pour ne
pas le créer. La variante définit aussi par défaut `enable_nfs = true` (un montage
Cloud Filestore sur `/opt/miniflux/storage`) pour les opérateurs qui souhaitent un
stockage partagé des pièces jointes, mais Miniflux n'en a pas besoin ; désactivez-le
pour réduire les coûts si vous n'en avez pas l'usage.

- **Console :** Filestore → Instances (si NFS est activé) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : `ADMIN_PASSWORD` — le mot de passe du
propriétaire initial, injecté dans Miniflux au premier démarrage. Le mot de passe de
la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (entrée publique). Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité. Lorsqu'un domaine personnalisé est utilisé, définissez `BASE_URL` pour
que Miniflux produise des liens absolus et des URL de proxy de flux corrects.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs. Le point d'entrée journalise au démarrage son mode de
connexion `DATABASE_URL` (socket / loopback / TCP sur IP privée) — utile pour
diagnostiquer la connectivité à la base de données.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Miniflux {#3-miniflux-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth
  Proxy et crée de manière idempotente la base de données et le rôle `miniflux`,
  accorde les privilèges, réattribue la propriété du schéma `public` et installe
  l'extension `hstore` **dont le rôle applicatif est propriétaire** (afin que la
  migration Miniflux `v119`, qui supprime `hstore`, réussisse). Le job peut être
  relancé sans risque.
- **Migrations de schéma au démarrage.** Le point d'entrée définit `RUN_MIGRATIONS=1`,
  de sorte que Miniflux applique ses propres migrations de schéma à chaque démarrage —
  pas d'étape de migration séparée. Prévoyez un délai supplémentaire au premier
  démarrage pour la construction initiale du schéma.
- **Le propriétaire initial est pré-créé.** `CREATE_ADMIN=1` crée le compte `admin`
  (`ADMIN_USERNAME`) à partir du secret `ADMIN_PASSWORD`. L'opération est idempotente
  — les démarrages suivants journalisent « user already exists ». Récupérez le mot de
  passe pour vous connecter :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Chemin de santé.** Les valeurs par défaut `startup_probe`/`liveness_probe` de la
  variante ciblent `/` (racine), et non le point de terminaison `/healthcheck` propre
  à l'application — les deux renvoient un `200 OK` sans authentification. Ne dirigez
  pas les sondes vers des pages authentifiées.
- **Le collecteur de flux s'exécute dans le processus.** Les flux sont actualisés
  selon `POLLING_FREQUENCY` dans le même conteneur. Avec les valeurs par défaut
  `cpu_always_allocated = true` + `min = 1`, la collecte tourne en continu. Si vous
  passez à la mise à zéro, les flux ne seront pas actualisés pendant que le service
  est inactif, sauf si vous appelez `/v1/feeds/refresh` depuis Cloud Scheduler.
- **`BASE_URL` détermine les liens absolus.** Sa valeur par défaut est la variable
  injectée `CLOUDRUN_SERVICE_URL`. Définissez-la explicitement (via
  `environment_variables`) sur l'URL du domaine personnalisé lorsque vous placez le
  service derrière un équilibreur de charge.
- **Inspecter l'exécution du job db-init :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Miniflux ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `miniflux` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Miniflux` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Miniflux (`FROM miniflux/miniflux:<tag>`). Épinglez une version (p. ex. `2.2.15`) en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | Maintient la CPU allouée pour le collecteur de flux intégré au processus. Passez à `false` uniquement avec `min = 0` + une collecte externalisée. |
| `min_instance_count` | `1` | `1` maintient le collecteur de flux actif entre les requêtes ; `0` (mise à zéro) arrête la collecte en arrière-plan sauf si elle est externalisée. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. Miniflux est mono-processus ; les instances supplémentaires se partagent simplement la charge des requêtes. |
| `container_port` | `8080` | Miniflux écoute sur 8080 (`LISTEN_ADDR`). |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Miniflux dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` garde l'interface/API joignable publiquement. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant Miniflux. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés dans le conteneur (p. ex. `BASE_URL`, `POLLING_FREQUENCY`, `DISABLE_LOCAL_AUTH`). Ne définissez pas `PORT` (réservé) ni `DATABASE_URL` (composée à l'exécution). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_file`, `backup_format` — sauvegarde automatisée de Cloud SQL et restauration
au déploiement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data", location=""}]` | Le bucket `data` par défaut est provisionné mais n'est ni utilisé ni monté par Miniflux — remplacez par `[]` pour ne pas le créer. |
| `enable_nfs` | `true` | Provisionne un montage NFS Filestore sur `/opt/miniflux/storage`. Facultatif — Miniflux stocke son état dans PostgreSQL ; désactivez-le pour réduire les coûts. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Miniflux requiert PostgreSQL. |
| `db_name` | `miniflux` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `miniflux` | Utilisateur applicatif de la base de données. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (rôle/base de données/`hstore`). |
| `cron_jobs` | `[]` | Jobs planifiés facultatifs (p. ex. un appel Cloud Scheduler à `/v1/feeds/refresh` en cas de mise à zéro). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s initial delay, 30 failures | Sonde de démarrage. Fenêtre généreuse pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, 60s initial delay, 30s period | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring sur le point de terminaison public ; activez-le et définissez un chemin pour l'utiliser. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux n'utilise pas Redis — laissez-le désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Non utilisés par Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` —
consultez [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative (`miniflux`). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut sauf remplacement). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Miniflux ne prend en charge que PostgreSQL ; tout autre moteur empêche le démarrage. |
| `db_name` / `db_user` | Défini une fois (`miniflux`) | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les flux et entrées. |
| `enable_backup_import` | `false` sauf restauration | Critical | L'activer sans source de sauvegarde valide fait échouer le job d'import. |
| `ADMIN_PASSWORD` (généré automatiquement) | À récupérer dans Secret Manager | High | C'est le seul identifiant de propriétaire créé au premier démarrage ; sans lui, vous ne pouvez pas vous connecter tant que vous ne l'avez pas réinitialisé dans la base de données. |
| `cpu_always_allocated` + `min_instance_count` | `true` + `1` | High | Passer à `false`/`0` sans collecte externalisée arrête l'actualisation des flux pendant que le service est inactif. |
| `enable_redis` | `false` | Medium | Redis n'est pas utilisé ; l'activer gaspille des ressources sans rien changer. |
| `ingress_settings` | `all` | High | `internal` bloque l'interface publique et les clients de lecture de flux externes (API Fever / Google Reader). |
| `enable_iap` | désactivé sauf si l'interface doit être protégée | Medium | IAP place l'interface/API derrière une connexion Google, ce qui bloque les clients API Fever/Reader qui s'authentifient avec des jetons applicatifs. |
| `BASE_URL` (env) | URL publique réelle | Medium | Une URL de base obsolète ou erronée produit des liens absolus et des URL d'images de proxy de flux cassés. |
| `startup_probe.path` | `/` (par défaut) | High | Diriger la sonde vers une page authentifiée renvoie 401/403 et la révision ne devient jamais Ready. |
| `memory_limit` | `4Gi` (plancher ≥512Mi) | Medium | En dessous du plancher gen2 de 512 Mi, l'apply est rejeté ; Miniflux lui-même est léger. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Miniflux,
partagée avec la variante GKE, est décrite dans **[Miniflux_Common](Miniflux_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Miniflux sur Cloud Run](../labs/Miniflux_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Miniflux sur GKE Autopilot](Miniflux_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Miniflux Common — Configuration applicative partagée](Miniflux_Common.md) — la configuration partagée par les deux cibles de déploiement.
