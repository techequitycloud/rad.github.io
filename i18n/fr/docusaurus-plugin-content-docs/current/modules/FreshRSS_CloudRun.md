---
title: "FreshRSS sur Google Cloud Run"
description: "Référence de configuration pour déployer FreshRSS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/FreshRSS_CloudRun.md @ 3055034 sha256:a23878675554 -->

# FreshRSS sur Google Cloud Run {#freshrss-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreshRSS_CloudRun.png" alt="FreshRSS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreshRSS est un agrégateur de flux RSS et Atom gratuit, auto-hébergé et sous licence
GPL-3.0 — un « lecteur d'actualités » léger et multi-utilisateur écrit en PHP, qui
s'exécute derrière Apache et expose les API Google Reader et Fever pour les clients
mobiles. Ce module déploie FreshRSS sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par FreshRSS et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

FreshRSS s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à l'échelle à zéro activée |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le point d'entrée effectue l'installation avec `--db-type pgsql` |
| Stockage persistant | NFS (Filestore / autogéré) | Monté sur `/var/www/FreshRSS/data` ; contient la configuration, l'état par utilisateur et le cache des flux. Aucun bucket GCS |
| Cache | Redis (facultatif) | Désactivé par défaut ; FreshRSS n'en a pas besoin |
| Secrets | Secret Manager | `FRESHRSS_ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur pris en charge.** Le point d'entrée du conteneur
  code en dur `--db-type pgsql` et le job `db-init` ne prend en charge que Postgres ;
  le schéma est créé par l'installateur de FreshRSS lui-même au premier démarrage.
- **NFS est activé par défaut** (`enable_nfs = true`) et monté sur
  `/var/www/FreshRSS/data`. FreshRSS y écrit sa configuration générée
  (`data/config.php`), l'état par utilisateur, les articles mis en cache et les
  favicons — sans volume persistant, cet état est perdu à chaque démarrage à froid
  ou redéploiement.
- **`FRESHRSS_ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret
  Manager. Il initialise le compte `admin` par défaut (ainsi que son mot de passe
  d'API pour les clients mobiles) lors de la première installation.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent quelques secondes de
  latence à la première requête après une période d'inactivité.
- **L'actualisation des flux s'exécute via un cron dans le conteneur**
  (`CRON_MIN = */15`). Tant que le service est mis à l'échelle à zéro, ce cron ne
  se déclenche pas — consultez le tableau des pièges.
- **`max_instance_count = 1`.** Une seule instance détient le cron d'actualisation
  du conteneur et l'état de session/cache stocké sur fichiers ; exécuter plusieurs
  instances sans précaution duplique les actualisations de flux.
- **Le conteneur écoute sur le port 80** (Apache), et non 8080.
- **`BASE_URL` est défini à partir de l'URL de service prévue au moment du plan et
  corrigé à l'exécution** à partir de `CLOUDRUN_SERVICE_URL`, afin que les liens
  autoréférents de FreshRSS et la redirection `/` → configuration pointent vers le
  véritable hôte Cloud Run.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [Outputs](#5-outputs) du
déploiement.

### A. Cloud Run — le service FreshRSS {#a-cloud-run--the-freshrss-service}

FreshRSS s'exécute comme un service Cloud Run v2 qui se met automatiquement à
l'échelle selon la charge des requêtes, entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~freshrss"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

FreshRSS stocke toutes les données de l'application (flux, abonnements, articles,
catégories, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Le
service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket
Unix ; aucune adresse IP publique n'est exposée. Lors du premier déploiement, le Job
`db-init` crée la base de données et l'utilisateur de l'application, et
l'installateur de FreshRSS crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Outputs](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Stockage persistant (NFS) {#c-persistent-storage-nfs}

Le répertoire de données de FreshRSS (`/var/www/FreshRSS/data`) repose sur un
**volume NFS** (`enable_nfs = true`), qui contient la configuration générée, l'état
par utilisateur, les articles mis en cache et les favicons. Ce module ne déclare
**aucun bucket GCS** — le contenu des flux est conservé dans PostgreSQL et dans le
répertoire de données NFS.

- **Console :** Filestore → Instances (NFS géré), ou Compute Engine → Instances de
  VM (serveur NFS autogéré).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount inside the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de serveur NFS et les
options GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`) et FreshRSS n'en a pas
besoin. Il est exposé comme option transmise par souci de cohérence avec les modules
PHP apparentés ; laissez-le désactivé sauf raison précise de l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

Un secret d'application est généré automatiquement : `FRESHRSS_ADMIN_PASSWORD`, qui
initialise le compte `admin` par défaut et son mot de passe d'API lors de la
première installation. Le mot de passe de la base de données est géré séparément
par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freshrss"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (entrée publique). Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application FreshRSS {#3-freshrss-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init`
  s'exécute avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données et l'utilisateur de l'application,
  puis accorde les privilèges. Le job peut être réexécuté sans risque.
- **Installation au premier démarrage.** Le script `platform-entrypoint.sh` du
  conteneur résout l'hôte de la base de données, puis pilote les scripts de
  FreshRSS `cli/do-install.php` (qui crée `data/config.php` et le schéma) et
  `cli/create-user.php` (qui crée le compte `admin` à partir de
  `FRESHRSS_ADMIN_PASSWORD`), avant d'enchaîner sur le point d'entrée d'origine.
  L'installation est idempotente — elle est ignorée dès que `data/config.php`
  existe sur le volume NFS.
- **Cron d'actualisation des flux.** L'image d'origine démarre un cron dans le
  conteneur (`CRON_MIN = */15`) qui actualise les flux suivis toutes les
  15 minutes. Il ne s'exécute que tant qu'une instance est active — avec la mise à
  l'échelle à zéro (`min_instance_count = 0`), les actualisations sont suspendues
  jusqu'à ce que la requête suivante réveille le service.
- **Identifiant administrateur.** L'identifiant par défaut est `admin` avec le
  `FRESHRSS_ADMIN_PASSWORD` généré ; la même valeur est définie comme mot de passe
  d'API utilisé par les clients mobiles des API Google Reader / Fever. Modifiez-le
  dans l'interface de FreshRSS après la première connexion — la seule rotation de la
  valeur dans Secret Manager ne réinitialise pas un compte déjà installé.
- **Chemin de santé.** La sonde de démarrage est une vérification TCP sur le
  port 80 ; la sonde d'activité est un HTTP GET sur `/` (200). FreshRSS sert
  également un point de terminaison JSON `/status` non authentifié, adapté aux
  tests de disponibilité. Prévoyez une fenêtre généreuse au premier démarrage, le
  temps que l'installateur crée le schéma.
- **URL de base.** `BASE_URL` est défini sur l'URL Cloud Run prévue au moment du
  plan et corrigé à l'exécution à partir de `CLOUDRUN_SERVICE_URL`. Vérifiez la
  révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à FreshRSS ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freshrss` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `FreshRSS` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image FreshRSS ; `latest` est épinglé sur un tag éprouvé (`1.26.3`) au moment du build. Épinglez-le explicitement en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | FreshRSS est livré avec un build personnalisé léger ; n'utilisez `prebuilt` qu'avec une `container_image` externe. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par instance ; conservez au moins 512Mi. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour que le cron d'actualisation des flux continue de s'exécuter. |
| `max_instance_count` | `1` | Conservez 1 — une seule instance détient le cron d'actualisation et l'état stocké sur fichiers. |
| `container_port` | `80` | FreshRSS/Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Socket du Cloud SQL Auth Proxy pour les connexions Postgres. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle de l'accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise l'accès public. |
| `enable_iap` | `false` | Exige une connexion Google devant FreshRSS. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un volume NFS persistant pour le répertoire de données de FreshRSS. **Laissez-le activé** — indispensable pour conserver la configuration et l'état par utilisateur. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Emplacement de montage du volume NFS dans le conteneur. |
| `create_cloud_storage` / `storage_buckets` | `true` / `[]` | FreshRSS ne déclare aucun bucket propre ; ajoutez-en ici si nécessaire. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse facultatifs (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Version du moteur PostgreSQL. FreshRSS s'installe avec `--db-type pgsql`. |
| `db_name` | `freshrss` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `freshrss` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s delay, threshold 20 | Sonde de démarrage ; le seuil élevé laisse le temps à l'installation du premier démarrage. |
| `liveness_probe` | HTTP `/` 300s delay | Sonde d'activité ; `/status` est un point de terminaison JSON non authentifié alternatif. |
| `uptime_check_config` | disabled, path `/` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut ; FreshRSS n'a pas besoin de Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis, s'il est activé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Outputs {#5-outputs}

Renvoyés lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (FreshRSS n'en déclare aucun). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un runtime `gen1` avec des montages NFS, IAP sans identité autorisée, un `redis_port`/`backup_retention_days` hors limites, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Le désactiver place le répertoire de données de FreshRSS sur un disque éphémère — `config.php`, l'état par utilisateur et le cache sont effacés à chaque démarrage à froid ou redéploiement, ce qui impose une réinstallation. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Critical | Un montage ailleurs laisse le répertoire de données éphémère (même effet qu'une absence de NFS). |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur, et rend orphelines toutes les données des flux. |
| `database_type` | `POSTGRES_15` | Critical | FreshRSS s'installe avec `--db-type pgsql` ; un moteur autre que Postgres casse l'installateur et `db-init`. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `container_port` | `80` | High | FreshRSS/Apache écoute sur le port 80 ; un port erroné fait échouer la sonde de démarrage et le service ne devient jamais prêt. |
| `enable_cloudsql_volume` | `true` | High | Le socket de l'Auth Proxy évite l'exigence SSL d'une connexion TCP directe par IP privée vers Cloud SQL Postgres ; le désactiver peut rompre la connectivité. |
| `min_instance_count` | `1` pour une actualisation fiable | High | Avec `0` (mise à l'échelle à zéro), le cron d'actualisation des flux du conteneur est suspendu pendant l'inactivité ; les flux ne sont mis à jour que lorsqu'une requête réveille le service. |
| `max_instance_count` | `1` | High | Exécuter plusieurs instances duplique le cron d'actualisation du conteneur et fragmente l'état de session/cache stocké sur fichiers. |
| `enable_iap` | uniquement pour les déploiements privés | High | IAP bloque toutes les requêtes non authentifiées, y compris celles des clients mobiles utilisant les API Google Reader / Fever. |
| `FRESHRSS_ADMIN_PASSWORD` (généré automatiquement) | À modifier dans l'interface après la première connexion | Medium | La seule rotation du secret ne réinitialise pas un compte déjà installé ; le premier mot de passe reste valide jusqu'à sa modification dans l'application. |
| `memory_limit` | `2Gi` | Medium | Les valeurs inférieures à 512Mi exposent à un OOM lors d'actualisations de flux intensives. |
| `application_version` | À épingler en production | Medium | `latest` est résolu en un tag épinglé au moment du build, mais un épinglage explicite rend les mises à niveau délibérées. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à FreshRSS, partagée avec la variante GKE, est décrite dans
**[FreshRSS_Common](FreshRSS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreshRSS sur Cloud Run](../labs/FreshRSS_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [FreshRSS sur GKE Autopilot](FreshRSS_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreshRSS Common — Configuration applicative partagée](FreshRSS_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md), [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md) dans la solution **Personal Knowledge & Reading**.
