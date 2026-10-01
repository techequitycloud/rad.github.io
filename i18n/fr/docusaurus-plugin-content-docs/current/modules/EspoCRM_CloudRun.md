---
title: "EspoCRM sur Google Cloud Run"
description: "Référence de configuration pour déployer EspoCRM sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/EspoCRM_CloudRun.md @ 3055034 sha256:efccd8fc0a87 -->

# EspoCRM sur Google Cloud Run {#espocrm-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EspoCRM_CloudRun.png" alt="EspoCRM sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

EspoCRM est une plateforme open source de gestion de la relation client (CRM), sous licence GPLv3,
construite sur PHP et Apache. Ce module déploie EspoCRM sur **Cloud Run v2** au-dessus
du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise EspoCRM et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes
les applications Cloud Run — identité du service, ingress et équilibrage de charge, scaling et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

EspoCRM s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache/PHP, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — EspoCRM ne prend pas en charge PostgreSQL ; connexion via TCP sur IP privée |
| Stockage d'objets | Cloud Storage + Filestore (NFS) | Un bucket GCS dédié `gcs-espocrm<tenant-prefix>-espocrm-data` est provisionné mais **n'est pas monté** par défaut ; un volume NFS partagé est monté sur `/var/www/html/data` pour les fichiers envoyés (`enable_nfs = true` par défaut) |
| Cache | Redis (facultatif) | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `ESPOCRM_ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche applicative
  partagée (`database_type = "MYSQL_8_0"`) ; EspoCRM ne prend pas en charge PostgreSQL.
- **La base de données est atteinte via TCP sur IP privée, et non via un socket.** `enable_cloudsql_volume`
  vaut `false` par défaut sur Cloud Run. La connexion PDO MySQL d'EspoCRM nécessite un véritable hôte TCP ;
  `cloud-entrypoint.sh` se connecte donc à l'IP privée de Cloud SQL (`DB_IP`). Cloud SQL MySQL
  n'impose pas SSL sur le TCP en IP privée ; aucun câblage TLS supplémentaire n'est donc nécessaire.
- **Le compte administrateur est amorcé automatiquement.** L'installateur amont crée l'utilisateur
  `admin` avec le `ESPOCRM_ADMIN_PASSWORD` généré automatiquement au premier démarrage — récupérez-le
  dans Secret Manager pour vous connecter.
- **Le schéma est créé au premier démarrage, et non par un job de migration.** `db-init` crée la
  base de données et l'utilisateur ; le `docker-entrypoint.sh` amont exécute ensuite automatiquement l'action
  d'installation/migration au démarrage du conteneur.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max_instance_count = 1`).
  Les démarrages à froid ajoutent plusieurs secondes de latence à la première requête après une période d'inactivité. Définissez
  `min_instance_count = 1` pour éviter les démarrages à froid.
- **NFS est activé par défaut.** `enable_nfs = true` monte un volume Filestore partagé sur
  `/var/www/html/data`, de sorte que les pièces jointes envoyées et les données d'exécution d'EspoCRM persistent d'un
  redémarrage de conteneur à l'autre et sont partagées entre les instances — contrairement à un déploiement Cloud Run
  nu ne disposant que d'un disque éphémère. Le bucket GCS `gcs-espocrm<tenant-prefix>-espocrm-data` provisionné automatiquement
  n'est monté **nulle part** par défaut.
- **Instance unique par défaut.** `max_instance_count = 1` — Cloud Run n'a pas d'affinité de session
  intégrée ; conservez donc le service en instance unique, sauf si vous avez vérifié
  le comportement d'EspoCRM avec des sessions PHP concurrentes réparties sur plusieurs réplicas.
- **`ESPOCRM_SITE_URL` est dérivé de l'URL de service prévue** au moment du plan et
  résolu par le point d'entrée, de sorte que les liens absolus et les vérifications de l'installateur d'EspoCRM utilisent
  le véritable hôte Cloud Run plutôt que `localhost`.
- **Ingress public par défaut.** `ingress_settings = "all"` afin que l'interface du CRM soit accessible ;
  l'activation d'IAP place une connexion Google devant elle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont
indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service EspoCRM {#a-cloud-run--the-espocrm-service}

EspoCRM s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre le nombre minimal
et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

EspoCRM stocke toutes les données de l'application (contacts, prospects, opportunités, activités, utilisateurs) dans
une instance gérée Cloud SQL for MySQL 8.0. Comme `enable_cloudsql_volume` vaut par défaut
`false`, le service se connecte via l'**IP privée** (`DB_IP`) par la sortie VPC sur le port
`3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la
base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs).
Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation
du mot de passe.

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Un bucket **Cloud Storage** dédié (`gcs-espocrm<tenant-prefix>-espocrm-data`) est provisionné automatiquement, mais
il n'est **monté nulle part** par défaut (`gcs_volumes` vaut `[]` par défaut). Le véritable
stockage persistant des pièces jointes envoyées et des données d'exécution d'EspoCRM est un volume **NFS
(Filestore)** partagé, monté sur `/var/www/html/data` puisque `enable_nfs = true` par
défaut. Des buckets GCS supplémentaires peuvent être déclarés via `storage_buckets`, puis montés via
`gcs_volumes` (nécessite l'environnement d'exécution gen2) si vous souhaitez utiliser le bucket.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Redis (cache d'objets) {#d-redis-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini, `REDIS_HOST` et
`REDIS_PORT` sont injectés et EspoCRM utilise Redis comme backend de cache d'objets afin de réduire la
charge sur la base de données. Lorsque `redis_host` est laissé vide et que `enable_nfs` vaut true, l'IP de la VM
du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (en cas d'utilisation d'une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur initial (`ESPOCRM_ADMIN_PASSWORD`) est généré automatiquement et
stocké dans Secret Manager, puis injecté dans le service sous forme de variable d'environnement secrète. Le mot de passe
de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~espocrm-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe
avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'ingress et
la sortie VPC contrôlent la connectivité. EspoCRM se connecte à Cloud SQL via le VPC ; la sortie VPC
doit donc pouvoir atteindre l'IP privée.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

Le `cloud-entrypoint.sh` affiche au démarrage les valeurs résolues de `ESPOCRM_DATABASE_*` et `ESPOCRM_SITE_URL`
— un moyen rapide de vérifier l'hôte de base de données et l'URL du site qu'utilise le conteneur.

---

## 3. Comportement de l'application EspoCRM {#3-espocrm-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec
  `mysql:8.0-debian`. Il résout la connexion Cloud SQL (socket de l'Auth Proxy s'il est présent,
  sinon TCP sur IP privée), crée de manière idempotente la base de données et l'utilisateur de l'application, accorde
  les privilèges et vérifie que l'utilisateur de l'application peut se connecter (en préchauffant le cache d'authentification
  `caching_sha2_password` de MySQL 8). Le job s'exécute lors de l'application et peut être relancé sans risque.
- **Schéma créé au premier démarrage.** Il n'y a pas de job de migration distinct. Une fois que `db-init` a
  provisionné la base de données, le `docker-entrypoint.sh` amont d'EspoCRM exécute automatiquement l'action
  d'installation/migration au démarrage du conteneur, créant le schéma et l'utilisateur
  `admin`.
- **L'identifiant administrateur est généré automatiquement.** Le mot de passe de l'utilisateur `admin` provient du
  secret `ESPOCRM_ADMIN_PASSWORD`. Récupérez-le avant votre première connexion :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-espocrm-admin-password" --project "$PROJECT"
  ```
  Modifiez-le dans l'interface d'EspoCRM (Administration → Users) une fois connecté.
- **L'URL du site doit correspondre à l'hôte accessible.** EspoCRM construit les liens absolus à partir de
  `ESPOCRM_SITE_URL` ; le point d'entrée la définit à partir de l'URL `run.app` prévue (ou de
  `CLOUDRUN_SERVICE_URL` à l'exécution). Si vous placez un domaine personnalisé devant le service, définissez
  l'URL du site sur cet hôte afin que les liens et les redirections OAuth soient corrects.
- **Chemin de santé.** Le démarrage utilise une sonde TCP sur le port `80` ; la sonde de vivacité est
  `HTTP GET /` — EspoCRM y sert sa page de connexion sans authentification (`200`). Prévoyez
  plusieurs minutes au premier démarrage pour l'étape d'installation/migration (la sonde de vivacité par défaut
  a un délai initial de 300 secondes).
- **Les fichiers envoyés persistent sur NFS.** Avec `enable_nfs = true` (par défaut), les pièces jointes
  et les données d'exécution d'EspoCRM résident sous le montage Filestore partagé `/var/www/html/data`, survivent aux
  redémarrages de conteneur et sont partagées entre les instances. Le bucket GCS `gcs-espocrm<tenant-prefix>-espocrm-data` est
  provisionné mais n'est pas monté par défaut.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à EspoCRM ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `espocrm` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `EspoCRM` | Nom lisible affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image `espocrm/espocrm` ; `latest` est figé en interne sur `10.0.2`. Figez une version précise en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les plugins lourds ou les médias volumineux. |
| `upload_max_filesize` | `64M` | Taille maximale d'un fichier envoyé (≤ `post_max_size`). |
| `post_max_size` | `64M` | Taille maximale d'une requête POST ; doit être ≥ `upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; minimum 1 vCPU pour EspoCRM + MySQL. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 512Mi (PHP 8.x). |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | À maintenir à `1`, sauf si le stockage partagé et l'affinité de session sont confirmés. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | EspoCRM se connecte à MySQL via TCP sur IP privée, et non via le socket. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface du CRM. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine le trafic RFC 1918 (y compris l'IP privée de Cloud SQL) via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant EspoCRM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `gcs-espocrm<tenant-prefix>-espocrm-data`. Il n'est monté nulle part, sauf si vous ajoutez une entrée `gcs_volumes` correspondante. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Définitions des buckets provisionnés lorsque `create_cloud_storage` vaut true. |
| `enable_nfs` | `true` | Monte un volume Filestore partagé pour les pièces jointes envoyées et les données d'exécution d'EspoCRM — persistant d'un redémarrage à l'autre par défaut. |
| `nfs_mount_path` | `/var/www/html/data` | Chemin de montage du volume NFS dans le conteneur. |
| `gcs_volumes` | `[]` | Aucun montage GCS Fuse par défaut ; le bucket `gcs-espocrm<tenant-prefix>-espocrm-data` reste non monté, sauf si vous ajoutez une entrée ici. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur Cloud SQL. EspoCRM nécessite MySQL — ne sélectionnez pas PostgreSQL. |
| `db_name` | `espocrm` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `espocrm` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe de base de données généré (plage valide : 16–64). |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis comme backend de cache d'objets d'EspoCRM. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les ressources
en cours d'exécution.

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
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une valeur `redis_port`/`backup_retention_days` hors plage, un environnement d'exécution `gen1` avec des montages NFS/GCS, IAP sans identité autorisée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | EspoCRM ne prend en charge que MySQL ; sélectionner PostgreSQL fait échouer le démarrage. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `ESPOCRM_ADMIN_PASSWORD` (généré automatiquement) | Le récupérer dans Secret Manager ; le modifier dans l'interface | Critical | Ne définit le mot de passe administrateur que lors de la **première** installation ; le perdre vous bloque l'accès jusqu'à une réinitialisation via la base de données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans URI de sauvegarde valide fait échouer le job d'import. |
| `enable_nfs` | `true` | High | Le désactiver relègue le stockage des pièces jointes d'EspoCRM au disque éphémère du conteneur — les fichiers envoyés sont perdus lorsqu'une instance est réduite ou recyclée. |
| `max_instance_count` | `1` sauf si la sécurité a été vérifiée | Medium | Les fichiers envoyés sont stockés sur NFS par défaut, mais Cloud Run n'a pas d'affinité de session intégrée — vérifiez le comportement d'EspoCRM avec des sessions PHP concurrentes avant de dépasser 1 instance. |
| `enable_cloudsql_volume` | `false` (TCP sur IP privée) | High | Forcer le socket sans chemin correspondant dans le point d'entrée peut casser la connexion MySQL ; EspoCRM se connecte à l'IP privée par conception. |
| `ESPOCRM_SITE_URL` (dérivé automatiquement) | URL réelle du service / du domaine personnalisé | High | Une URL de site incorrecte casse les liens absolus, la vérification de l'installateur et les redirections OAuth. |
| `memory_limit` | `2Gi` | High | En dessous de 512Mi, PHP 8.x est arrêté pour OOM pendant l'installation/la migration et sous charge. |
| `cpu_limit` | `1000m` | Medium | En dessous de 1 vCPU, l'installation au premier démarrage et le traitement des plugins lourds sont ralentis. |
| `enable_iap` | uniquement lorsque l'interface publique n'est pas nécessaire | Medium | IAP exige une connexion Google pour chaque requête, y compris les intégrations d'API. |
| `min_instance_count` | `1` en production | Medium | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid et, sans volume partagé, perd les fichiers envoyés locaux lors de la réduction. |
| `application_version` | À figer en production | Medium | `latest` correspond en interne à un tag figé, mais figer explicitement la version évite les mises à niveau inattendues lors d'un redéploiement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, scaling et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**.
La configuration applicative propre à EspoCRM partagée avec la variante GKE est décrite dans
**[EspoCRM_Common](EspoCRM_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : EspoCRM sur Cloud Run](../labs/EspoCRM_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EspoCRM sur GKE Autopilot](EspoCRM_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [EspoCRM Common — Configuration applicative partagée](EspoCRM_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cyclos sur Google Cloud Run](Cyclos_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md) et [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Financial Inclusion & Community Banking**.
