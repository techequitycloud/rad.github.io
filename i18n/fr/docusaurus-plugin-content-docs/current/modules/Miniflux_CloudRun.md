---
title: "Miniflux sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Miniflux sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Miniflux_CloudRun.md @ 15fd4c7 sha256:8f78ea944c81 -->

# Miniflux sur Google Cloud Run {#miniflux-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_CloudRun.png" alt="Miniflux sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un
binaire Go statique unique qui stocke tout son état dans PostgreSQL. Ce module
déploie Miniflux sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Miniflux et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Miniflux s'exécute comme un conteneur Go unique sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 2 vCPU / 4 GiB par défaut, CPU toujours alloué avec `min = 1` pour le sondeur de flux intégré |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Miniflux stocke **tout** l'état ici ; pas de MySQL/autre moteur |
| Stockage d'objets | Cloud Storage | Un bucket `data` par défaut est provisionné mais non monté/utilisé par l'application (tout l'état réside dans PostgreSQL) ; un montage NFS optionnel est également disponible mais inutilisé par défaut |
| Cache et file d'attente | Aucun | Miniflux n'a pas de dépendance Redis et pas de worker séparé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` auto-généré (propriétaire initial) ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; la sélection de tout autre moteur
  interrompt le démarrage.
- **Le sondeur de flux s'exécute en interne.** Miniflux n'a pas de worker
  séparé — le même conteneur sert l'interface utilisateur et rafraîchit les
  flux sur `POLLING_FREQUENCY`. Pour cette raison, `cpu_always_allocated = true` et `min_instance_count = 1` sont les
  valeurs par défaut : la facturation basée sur les requêtes étranglerait le
  sondeur à ~0 CPU au repos et bloquerait les rafraîchissements. Pour une mise
  à l'échelle à zéro, basculez `cpu_always_allocated = false` + `min = 0` et externalisez le
  sondage via un appel Cloud Scheduler à `/v1/feeds/refresh`.
- **Le propriétaire initial est amorcé, non auto-enregistré.** `CREATE_ADMIN = 1` amorce
  le compte `admin` à partir du secret `ADMIN_PASSWORD` au premier démarrage ;
  l'inscription en libre-service reste désactivée. Récupérez le mot de passe
  de Secret Manager pour vous connecter.
- **Les migrations de schéma s'exécutent au démarrage** (`RUN_MIGRATIONS = 1`) — il n'y
  a pas de job de migration séparé, donc la mise à niveau de la version
  applique automatiquement les modifications de schéma.
- **Pas de Redis.** `enable_redis = false` — Miniflux conserve chaque flux, entrée et
  session dans PostgreSQL. Laissez-le désactivé.
- **Ingress public par défaut.** `ingress_settings = "all"` pour que l'interface web (et les
  propres API / Fever / Google Reader de Miniflux) soient accessibles.
  L'activation d'IAP placera l'interface utilisateur derrière la connexion
  Google.
- **`DATABASE_URL` est composé à l'exécution** par le point d'entrée du conteneur
  (forme clé/valeur libpq), en se ramifiant sur le socket vs loopback vs TCP
  IP privée afin que la même image fonctionne sur Cloud Run et GKE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Miniflux {#a-cloud-run--the-miniflux-service}

Miniflux s'exécute comme un service Cloud Run v2 écoutant sur le port
**8080**. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements sûrs. Étant donné que le
sondeur de flux s'exécute dans le conteneur, le CPU est alloué en permanence
et au moins une instance est maintenue active.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~miniflux"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Miniflux stocke **toutes** les données d'application (flux, entrées,
utilisateurs, sessions, catégories) dans une instance Cloud SQL gérée pour
PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy**
sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée la base de données `miniflux` et le rôle
et installe l'extension `hstore` appartenant au rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage / NFS {#c-cloud-storage--nfs}

Miniflux n'a **pas** besoin de stockage d'objets — il conserve tout l'état
dans PostgreSQL. Le `storage_buckets` par défaut de la variante provisionne toujours un
bucket Cloud Storage `data` (boilerplate d'échafaudage), mais il n'est pas
monté ou référencé par l'application ; remplacez `storage_buckets = []` pour ignorer sa
création. NFS est désactivé par défaut (`enable_nfs = false`) : Miniflux lie les
pièces jointes plutôt que de les télécharger, il n'a donc pas de stockage de
pièces jointes et n'a pas besoin de système de fichiers partagé.

- **Console :** Filestore → Instances (si NFS est activé) ; Cloud Storage →
  Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options NFS, GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : `ADMIN_PASSWORD` — le mot de passe du
propriétaire initial amorcé dans Miniflux au premier démarrage. Le mot de
passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (ingress public). Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle
d'egress VPC contrôlent la connectivité. Lorsqu'un domaine personnalisé est
utilisé, définissez `BASE_URL` afin que Miniflux émette des liens absolus et des
URL de proxy de flux corrects.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests
de disponibilité et des politiques d'alerte optionnels. Le point d'entrée
enregistre son mode de connexion `DATABASE_URL` (socket / loopback / TCP IP privée)
au démarrage — utile pour diagnostiquer la connectivité de la base de données.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Miniflux {#3-miniflux-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données
  `miniflux` et le rôle, accorde les privilèges, réattribue le schéma
  `public` et installe l'extension `hstore` **appartenant au rôle de
  l'application** (afin que la migration Miniflux `v119`, qui supprime
  `hstore`, réussisse). Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée définit
  `RUN_MIGRATIONS=1`, de sorte que Miniflux applique ses propres migrations de schéma à
  chaque démarrage — pas d'étape de migration séparée. Prévoyez un temps
  supplémentaire au premier démarrage pour la construction initiale du schéma.
- **Le propriétaire initial est amorcé.** `CREATE_ADMIN=1` amorce le compte
  `admin` (`ADMIN_USERNAME`) à partir du secret `ADMIN_PASSWORD`. C'est idempotent — les
  démarrages ultérieurs enregistrent "l'utilisateur existe déjà". Récupérez le
  mot de passe pour vous connecter :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Chemin de santé.** Les valeurs par défaut `startup_probe`/`liveness_probe` de la
  variante ciblent `/` (racine), et non le propre point de terminaison
  `/healthcheck` de l'application — les deux renvoient un `200 OK` non
  authentifié. Ne pointez pas les sondes vers des pages authentifiées.
- **Le sondeur de flux est intégré.** Les flux se rafraîchissent sur
  `POLLING_FREQUENCY` à l'intérieur du même conteneur. Avec les valeurs par défaut
  `cpu_always_allocated = true` + `min = 1`, le sondage s'exécute en continu. Si vous passez à
  la mise à l'échelle à zéro, les flux ne se rafraîchiront pas pendant que le
  service est inactif, sauf si vous pilotez `/v1/feeds/refresh` depuis Cloud Scheduler.
- **`BASE_URL` pilote les liens absolus.** Il utilise par défaut le
  `CLOUDRUN_SERVICE_URL` injecté. Définissez-le explicitement (via `environment_variables`) sur
  l'URL du domaine personnalisé lorsque vous placez un équilibreur de charge
  devant le service.
- **Inspectez l'exécution du job db-init :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Miniflux sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels l'accès au projet et les alertes de surveillance sont accordés. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `miniflux` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Miniflux` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image Miniflux (`FROM miniflux/miniflux:<tag>`). Épinglez à une version (par exemple `2.2.15`) en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué pour le sondeur de flux intégré. Passez à `false` uniquement avec `min = 0` + sondage externalisé. |
| `min_instance_count` | `1` | `1` maintient le sondeur de flux en cours d'exécution entre les requêtes ; `0` (mise à l'échelle à zéro) arrête le sondage en arrière-plan sauf s'il est externalisé. |
| `max_instance_count` | `5` | Limite supérieure d'autoscaling. Miniflux est un processus unique ; les instances supplémentaires partagent simplement la charge des requêtes. |
| `container_port` | `8080` | Miniflux écoute sur 8080 (`LISTEN_ADDR`). |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Miniflux dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` maintient l'interface utilisateur/API publiquement accessible. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Miniflux. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets fusionnés dans le conteneur (par exemple `BASE_URL`, `POLLING_FREQUENCY`, `DISABLE_LOCAL_AUTH`). Ne définissez pas `PORT` (réservé) ou `DATABASE_URL` (composé à l'exécution). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_file`, `backup_format` — sauvegarde Cloud SQL automatisée et restauration au
déploiement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data", location=""}]` | Le bucket `data` par défaut est provisionné mais inutilisé/non monté par Miniflux — remplacez par `[]` pour l'ignorer. |
| `enable_nfs` | `false` | Provisionne un montage NFS Filestore à `/opt/miniflux/storage`. Laissez désactivé — Miniflux stocke tout l'état dans PostgreSQL. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Miniflux nécessite PostgreSQL. |
| `db_name` | `miniflux` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `miniflux` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (rôle/base de données/`hstore`). |
| `cron_jobs` | `[]` | Jobs planifiés optionnels (par exemple, un appel Cloud Scheduler `/v1/feeds/refresh` lorsque mis à l'échelle à zéro). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s de délai initial, 30 échecs | Sonde de démarrage. Fenêtre généreuse pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `/`, 60s de délai initial, 30s de période | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring par rapport au point de terminaison public ; activez et définissez un chemin pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux n'utilise pas Redis — laissez désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Inutilisé par Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` — voir
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (`miniflux`). |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut sauf si remplacé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — une
> configuration IAP sans identités autorisées, un runtime `gen1` avec des
> montages NFS/GCS, un `database_type` qui ne correspond pas à une extension
> activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Miniflux ne prend en charge que PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `db_name` / `db_user` | Définir une fois (`miniflux`) | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les flux et entrées. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide échoue le job d'importation. |
| `ADMIN_PASSWORD` (auto-généré) | Récupérer de Secret Manager | Élevé | C'est la seule credential de propriétaire amorcée au premier démarrage ; sans elle, vous ne pouvez pas vous connecter tant que vous ne la réinitialisez pas dans la base de données. |
| `cpu_always_allocated` + `min_instance_count` | `true` + `1` | Élevé | La définition de `false`/`0` sans sondage externalisé arrête les rafraîchissements de flux pendant que le service est inactif. |
| `enable_redis` | `false` | Moyen | Redis est inutilisé ; l'activer gaspille des ressources et ne change rien. |
| `ingress_settings` | `all` | Élevé | `internal` bloque l'interface utilisateur publique et les clients de lecteurs de flux externes (Fever / Google Reader API). |
| `enable_iap` | désactivé sauf si l'interface utilisateur doit être protégée | Moyen | IAP place l'interface utilisateur/API derrière la connexion Google, bloquant les clients Fever/Reader API qui s'authentifient avec des jetons d'application. |
| `BASE_URL` (env) | URL publique réelle | Moyen | Une URL de base obsolète/incorrecte entraîne des liens absolus et des URL d'image de proxy de flux cassés. |
| `startup_probe.path` | `/` (par défaut) | Élevé | Pointer la sonde vers une page authentifiée renvoie 401/403 et la révision ne devient jamais prête. |
| `memory_limit` | `4Gi` (plancher ≥512Mi) | Moyen | En dessous du plancher de 512Mi de gen2, l'apply est rejeté ; Miniflux lui-même est léger. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Miniflux partagée avec la variante GKE est décrite
dans **[Miniflux_Common](Miniflux_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Miniflux sur Cloud Run](../labs/Miniflux_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [Miniflux sur GKE Autopilot](Miniflux_GKE.md) — la même application sur
  Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Miniflux Common — Configuration d'application partagée](Miniflux_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
