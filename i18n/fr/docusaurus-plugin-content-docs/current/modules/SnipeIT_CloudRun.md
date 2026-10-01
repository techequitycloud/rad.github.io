---
title: "Snipe-IT sur Google Cloud Run"
description: "Référence de configuration pour déployer Snipe-IT sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SnipeIT_CloudRun.md @ 3055034 sha256:f8bf1cb9ae7a -->

# Snipe-IT sur Google Cloud Run {#snipe-it-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SnipeIT_CloudRun.png" alt="Snipe-IT sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Snipe-IT est un système libre et open source de gestion des actifs et de
l'inventaire informatiques, utilisé pour suivre le matériel, les licences
logicielles, les accessoires et les consommables, avec l'attribution et la
restitution des actifs, la journalisation d'audit, l'amortissement et une API
REST complète. Il repose sur Laravel/PHP et s'exécute derrière Apache. Ce module
déploie Snipe-IT sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide porte sur les services cloud qu'utilise Snipe-IT et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes
et cycle de vie du déploiement — consultez le
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les retrouver
répétés ici.

---

## 1. Vue d'ensemble {#1-overview}

Snipe-IT s'exécute sous la forme du conteneur PHP/Apache officiel
`snipe/snipe-it`, récupéré directement depuis Docker Hub — il n'y a pas d'étape
de build personnalisée. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Image PHP/Apache préconstruite `snipe/snipe-it`, port 80, 1 vCPU / 2 GiB par défaut ; autoscaling serverless avec mise à l'échelle à zéro |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — imposé par `SnipeIT_Common` ; les autres moteurs ne sont pas pris en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les images d'actifs, signatures et codes-barres téléversés sont conservés sous `/var/lib/snipeit` |
| Stockage d'objets | Cloud Storage | Un bucket `snipeit-uploads` provisionné automatiquement |
| Cache | Redis (facultatif) | Activé par défaut pour le cache et les sessions Laravel |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données géré par le socle |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Image officielle préconstruite uniquement.** `container_image_source = "prebuilt"`
  est la valeur par défaut — le module déploie directement
  `snipe/snipe-it:<application_version>` (tag par défaut `v8-latest`), dupliquée
  dans Artifact Registry lorsque `enable_image_mirroring = true`. Il n'y a pas
  d'étape Cloud Build/Dockerfile.
- **MySQL 8.0 est obligatoire.** `SnipeIT_Common` fixe `database_type` à
  `MYSQL_8_0` quelle que soit la valeur de la variable ; les autres moteurs ne
  sont pas pris en charge.
- **Cloud SQL est joint en TCP par défaut, et non via un socket Unix.**
  `enable_cloudsql_volume` vaut `false` par défaut ici — contrairement à la
  plupart des modules App_CloudRun. C'est délibéré : Snipe-IT est un client
  Laravel/MySQL et, selon la convention de ce dépôt, les applications
  Laravel-mysql (Snipe-IT, Matomo) se connectent via l'IP privée de Cloud SQL
  plutôt que via le socket de l'Auth Proxy. `db-init.sh` prend toujours en
  charge le chemin du socket si vous passez `enable_cloudsql_volume = true`,
  mais la valeur par défaut éprouvée et testée est TCP.
- **Les variables d'environnement de la base de données sont mappées en dur vers les noms natifs de Laravel.**
  `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name =
  "DB_DATABASE"` et `db_password_env_var_name = "DB_PASSWORD"` — les noms exacts
  que lit la configuration `env()` de Laravel — ainsi que `DB_CONNECTION = "mysql"` et
  `DB_PORT = "3306"` définis par `SnipeIT_Common`. Il s'agit d'une convention
  déjà corrigée et éprouvée (reprise du même correctif appliqué à
  BookStack/Matomo), et non de quelque chose que vous devez configurer.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/var/lib/snipeit`) afin que les images d'actifs, signatures et codes-barres
  téléversés soient conservés et survivent à la mise à l'échelle à zéro et aux
  démarrages à froid — contrairement à des applications comme Activepieces, où
  NFS est désactivé par défaut.
- **Un `APP_KEY` Laravel est généré automatiquement** et stocké dans Secret
  Manager (`secret-<prefix>-snipeit-app-key`), puis injecté comme variable
  d'environnement secrète `APP_KEY`. Le régénérer après le premier démarrage
  invalide toutes les sessions actives et toutes les données de l'application
  chiffrées avec l'ancienne clé.
- **Plafond d'une seule instance par défaut.** `max_instance_count = 1` — le
  comportement multi-instances avec le stockage NFS partagé et le pilote de
  sessions en base de données de Laravel n'a pas été vérifié pour Snipe-IT.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
  Les démarrages à froid ajoutent de la latence à la première requête après une
  période d'inactivité.
- **Redis est activé par défaut** (`enable_redis = true`) pour décharger le
  cache et les sessions Laravel ; laisser `redis_host` vide revient à la
  résolution standard du point de terminaison Redis de la plateforme.
- **Deux tâches d'initialisation ordonnées s'exécutent à chaque apply.**
  `db-init` (crée la base de données et l'utilisateur via `mysql:8.0-debian`)
  s'exécute en premier, puis `migrate` (`php
  artisan migrate --force` sur l'image `snipe/snipe-it`) — toutes deux sont en
  `execute_on_apply = true` et peuvent être relancées sans risque.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Snipe-IT {#a-cloud-run--the-snipe-it-service}

Snipe-IT s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à
la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les
  révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Snipe-IT stocke toutes les données de l'application (actifs, licences,
accessoires, consommables, utilisateurs, piste d'audit) dans une instance gérée
Cloud SQL for MySQL 8.0. Par défaut, le service la joint via **l'IP privée en
TCP** (`enable_cloudsql_volume = false`), et non via le socket Unix du Cloud SQL
Auth Proxy utilisé par la plupart des autres modules App_CloudRun. Lors du
premier déploiement, la tâche d'initialisation `db-init` crée la base de données
et l'utilisateur de l'application (en essayant d'abord le chemin du socket, puis
en se rabattant sur TCP vers `DB_IP`), suivie de la tâche `migrate`, qui exécute
`artisan migrate --force` de Laravel.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions,
  les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe figurent dans les [Sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers NFS {#c-cloud-storage--nfs-file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `snipeit-uploads`) est provisionné
automatiquement. Par ailleurs, l'arborescence des fichiers téléversés de
Snipe-IT à l'exécution (images d'actifs, signatures, codes-barres) réside sur
**NFS (Cloud Filestore)** dans `/var/lib/snipeit`, partagée entre les instances
et conservée lors des redémarrages de conteneurs et des démarrages à froid —
indispensable, car le système de fichiers local des conteneurs Cloud Run est
éphémère.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les volumes GCS Fuse et les
options CMEK.

### D. Redis (backend de cache) {#d-redis-cache-backend}

Redis est **activé par défaut** (`enable_redis = true`) pour la couche de cache
de Laravel. Lorsque `redis_host` est laissé vide, la résolution Redis standard
de la plateforme s'applique (le Redis colocalisé sur le serveur NFS, lorsque NFS
est activé).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected value in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret Snipe-IT est généré automatiquement et stocké dans Secret Manager :
l'`APP_KEY` Laravel (`base64:<...>`, 32 octets aléatoires encodés en base64). Le
mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~snipeit"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de
la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings =
"all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peuvent s'y ajouter ; les paramètres d'entrée et la
sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de
Cloud Run et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs (désactivés par défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Snipe-IT {#3-snipe-it-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  d'initialisation `db-init` s'exécute sur `mysql:8.0-debian`. Elle vérifie
  d'abord la présence d'un socket Unix Cloud SQL monté (présent uniquement si
  `enable_cloudsql_volume = true`) et, en son absence, se rabat sur TCP vers
  `DB_IP` (l'IP privée de l'instance) — le chemin par défaut du module. Elle
  crée de manière idempotente la base de données et l'utilisateur de
  l'application, accorde les privilèges et vérifie que l'utilisateur de
  l'application peut réellement se connecter (ce qui préchauffe également le
  cache d'authentification `caching_sha2_password` côté serveur de MySQL 8).
  Elle peut être relancée sans risque.
- **Tâche de migration explicite, et pas seulement une migration automatique au démarrage.**
  Une tâche `migrate` distincte exécute `php /var/www/html/artisan migrate --force`
  (`depends_on_jobs = ["db-init"]`, `max_retries = 2`) afin que le schéma
  existe avant que la première révision ne serve du trafic. La migration
  automatique au démarrage de l'image officielle, si elle existe, constitue un
  filet de sécurité secondaire.
- **Mappage des variables d'environnement de la base de données vers les noms Laravel (déjà corrigé, ce n'est pas un piège).**
  `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"`,
  `db_name_env_var_name = "DB_DATABASE"` et `db_password_env_var_name =
  "DB_PASSWORD"`, et `SnipeIT_Common` définit `DB_CONNECTION = "mysql"` et
  `DB_PORT = "3306"`. Le socle injecte les identifiants de base de données
  propres au tenant directement sous ces noms natifs de Laravel — aucun alias
  dans le point d'entrée n'est nécessaire. Les variables
  `db_user_env_var_name`/`db_name_env_var_name`/
  `db_password_env_var_name` déclarées dans `variables.tf` sont inertes pour ce
  module (leurs valeurs sont ignorées sans avertissement ; les littéraux
  ci-dessus l'emportent toujours).
- **`APP_KEY` est immuable après le premier démarrage.** Généré une seule fois
  (`random_password` + encodage base64 avec le préfixe `base64:` qu'attend
  Laravel) et écrit dans Secret Manager. Le régénérer invalide toutes les
  sessions actives et toutes les données que Snipe-IT a chiffrées avec
  l'ancienne clé.
- **Persistance des sessions, du cache et de la file d'attente.** `SnipeIT_Common` définit `SESSION_DRIVER =
  "database"`, `CACHE_DRIVER = "file"` et `QUEUE_DRIVER = "database"` afin que
  les sessions et les tâches en file d'attente survivent aux redémarrages
  d'instances, même avec `max_instance_count = 1`.
- **`APP_URL` est dérivé automatiquement.** L'URL prévue du service Cloud Run
  (construite à partir de `module.deployment_id.service_name` — le nom propre à
  l'application, et non le `resource_prefix` propre au seul tenant, selon un
  commentaire explicite dans `main.tf` qui prévient une boucle de 404 due à un
  mauvais hôte) est transmise comme `service_url` et injectée sous le nom
  `APP_URL` lorsqu'elle n'est pas vide.
- **Pas d'inscription libre-service ouverte.** Contrairement aux applications
  dotées d'un parcours d'inscription public, une installation neuve de Snipe-IT
  redirige `/` vers l'assistant d'installation `/setup`, où le premier compte
  administrateur est créé de manière interactive. Une erreur sur `APP_URL`/l'hôte
  du service casse cette redirection.
- **Chemin de santé.** La sonde de démarrage par défaut est une sonde **TCP** sur
  le port du conteneur (délai initial de 30 s, période de 15 s, seuil d'échec de
  20 — généreux pour laisser le temps à la configuration de la base de données
  au premier démarrage). La sonde de vivacité par défaut est une sonde **HTTP**
  `GET /` (délai initial de 300 s, période de 60 s, seuil d'échec de 3) —
  Snipe-IT sert sa page de connexion/d'installation sur `/` sans
  authentification, ce qui confirme que l'application PHP et la connexion à la
  base de données sont saines.
- **`php_memory_limit`, `upload_max_filesize`, `post_max_size` sont acceptés
  mais non appliqués.** Ces variables sont déclarées pour la parité des
  conventions de l'interface, mais ne sont jamais référencées par la
  configuration de `SnipeIT_Common` — l'image préconstruite conserve ses propres
  paramètres PHP intégrés, quelles que soient ces valeurs.
- **Inspectez l'exécution des tâches et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Snipe-IT ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `snipeit` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Snipe-IT` | Nom lisible affiché dans la console. |
| `description` | `Snipe-IT IT asset management on Cloud Run` | Description du service. |
| `application_version` | `v8-latest` | Tag de l'image officielle `snipe/snipe-it` ; épinglez une version précise en production. |
| `php_memory_limit` | `512M` | Accepté mais **non appliqué** — l'image préconstruite conserve sa propre configuration PHP. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Acceptés mais **non appliqués** à l'image préconstruite. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle ; `"custom"` n'est pas le chemin pris en charge pour Snipe-IT. |
| `cpu_limit` | `1000m` | 1 vCPU minimum recommandé avec MySQL. |
| `memory_limit` | `2Gi` | Minimum 512Mi ; 2Gi recommandé en production. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Conservez `1` tant que le comportement multi-instances des sessions/de NFS n'a pas été vérifié. |
| `container_port` | `80` | Snipe-IT (Apache) écoute sur le port 80, et non sur le port 8080 habituel par défaut de Cloud Run. |
| `execution_environment` | `gen2` | Requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **TCP par défaut** — délibéré pour cette application Laravel-mysql ; `true` monte à la place le socket de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | Duplique l'image Docker Hub dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité des conventions ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle des accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour atteindre l'assistant d'installation public et l'interface. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google avant d'accéder à l'application. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs de base `APP_*`/`DB_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`. Rarement utilisé, car Snipe-IT déploie l'image
officielle préconstruite plutôt qu'un build personnalisé.

### Groupe 9 — Initialisation personnalisée et scripts SQL {#group-9--custom-initialization--sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutent du SQL
provenant d'un bucket GCS sur la base de données après le provisionnement.
Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage du miroir Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets GCS supplémentaires en plus du bucket `snipeit-uploads` provisionné automatiquement. |
| `enable_nfs` | `true` | Activé par défaut afin que les images d'actifs, signatures et codes-barres téléversés soient conservés et partagés entre les instances. Laissez-le activé. |
| `nfs_mount_path` | `/var/lib/snipeit` | Emplacement où Snipe-IT stocke les fichiers téléversés et les données d'exécution. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Imposé par `SnipeIT_Common` quelle que soit la valeur — Snipe-IT nécessite MySQL. |
| `db_name` | `snipeit` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `snipeit` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé / `90` | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Déclarées pour la parité des conventions ; **inertes** pour ce module — `main.tf` code en dur directement le mappage natif de Laravel `DB_USERNAME`/`DB_DATABASE`/`DB_PASSWORD` et ne transmet pas ces variables. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne de tâches intégrée `db-init` → `migrate`. |
| `cron_jobs` | `[]` | Transmis au socle ; vide par défaut, car Snipe-IT n'a pas de tâche de maintenance planifiée intégrée. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30 s, seuil d'échec de 20 | Généreux pour laisser le temps à la configuration de la base de données au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 300 s, seuil d'échec de 3 | Confirme que l'application PHP et la connexion à la base de données sont saines. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Activé par défaut pour le backend de cache de Laravel. |
| `redis_host` | `""` | Laissez vide pour utiliser la résolution standard du point de terminaison Redis de la plateforme. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

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
| `initialization_jobs` | Noms des tâches de configuration (`db-init`, `migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs
> *et leurs combinaisons* au moment du plan — un réplica en lecture sans son
> instance principale, IAP sans identités autorisées, un environnement
> d'exécution `gen1` avec des montages NFS/GCS, un
> `redis_port`/`backup_retention_days` hors plage. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en
> amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critical | Snipe-IT nécessite MySQL ; `SnipeIT_Common` ignore les autres valeurs. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelines toutes les données. |
| `APP_KEY` (généré automatiquement) | Ne jamais le modifier après le premier démarrage | Critical | Le régénérer invalide toutes les sessions actives et toutes les données chiffrées avec l'ancienne clé. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `enable_cloudsql_volume` | `false` (TCP) | High | C'est la valeur par défaut testée pour le client Laravel/MySQL de Snipe-IT ; passer à `true` monte à la place le chemin du socket, mais cela n'a pas été vérifié avec la configuration de base de données Laravel de Snipe-IT pour ce module. |
| `enable_nfs` | `true` | High | Le désactiver rend éphémères les images d'actifs, signatures et codes-barres téléversés — isolés par instance et perdus lors d'un démarrage à froid. |
| `max_instance_count` | `1` | High | Dépasser 1 sans comportement vérifié du NFS partagé et du pilote de sessions expose à des incohérences dans les fichiers téléversés et la gestion des sessions. |
| `ingress_settings` | `all` | High | La restreindre à `internal` bloque l'assistant public `/setup` nécessaire à la création du premier compte administrateur. |
| `container_port` | `80` | High | L'Apache de Snipe-IT écoute sur le port 80 ; le modifier sans image personnalisée correspondante casse le routage. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | À laisser tels quels | Low | Ces variables sont inertes pour ce module — `main.tf` code en dur les bons noms natifs de Laravel, quelle que soit leur valeur. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N'importe quelle valeur | Low | Acceptés mais non appliqués à l'image préconstruite — ne comptez pas sur eux pour modifier le comportement de PHP. |
| `min_instance_count` | `1` pour la production | Medium | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| `memory_limit` | `2Gi` | Medium | Des valeurs proches du plancher de 512Mi exposent à des arrêts OOM lors d'imports/téléversements d'actifs simultanés. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | À activer en production | Medium | L'assistant d'installation et l'interface d'administration sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
duplication des images — consultez **[App_CloudRun](App_CloudRun.md)**. La
configuration applicative propre à Snipe-IT partagée avec la variante GKE
(image, secret `APP_KEY`, tâches d'initialisation) est décrite dans
`modules/SnipeIT_Common/README.md` — aucun guide autonome
`docs/modules/SnipeIT_Common.md` n'existe encore.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SnipeIT sur Cloud Run](../labs/SnipeIT_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Snipe-IT sur GKE Autopilot](SnipeIT_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Snipe-IT Common — Configuration applicative partagée](SnipeIT_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [NetBox sur Google Cloud Run](Netbox_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **IT Asset & Infrastructure Records**.
