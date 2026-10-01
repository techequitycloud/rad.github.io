---
title: "Mixpost sur Google Cloud Run"
description: "Référence de configuration pour déployer Mixpost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mixpost_CloudRun.md @ 3055034 sha256:e6c362f20442 -->

# Mixpost sur Google Cloud Run {#mixpost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mixpost_CloudRun.png" alt="Mixpost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mixpost est une plateforme open source et auto-hébergée de planification et de
gestion des réseaux sociaux — une alternative à Buffer/Hootsuite pour rédiger,
planifier, publier et analyser des publications sur plusieurs comptes sociaux depuis
un seul tableau de bord. Elle est livrée sous la forme d'une unique application
Laravel (nginx + PHP-FPM + supervisord exécutant le worker de file d'attente et le
planificateur dans un seul conteneur, l'image officielle `inovector/mixpost`). Ce
module déploie Mixpost sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Mixpost et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Mixpost s'exécute comme un conteneur web unique et autonome sur Cloud Run v2 — sans
étape de build séparée, puisque l'image officielle préconstruite est déployée
directement.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx + PHP-FPM + supervisord écoutant sur le port 80, 2 vCPU / 2 GiB par défaut ; autoscaling serverless |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire et fixe — `Mixpost_Common` code en dur `MYSQL_8_0` |
| File d'attente, cache et sessions | Redis | Activé par défaut ; pilote `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` ; utilise par défaut l'IP du serveur NFS colocalisé lorsqu'aucun hôte externe n'est fourni |
| Stockage objet | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Mixpost_Common` |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Mixpost_Common` définit `database_type = "MYSQL_8_0"`
  et `DB_CONNECTION = "mysql"` sans condition ; la valeur apparente de la variable
  `database_type` n'est en réalité pas transmise par le module applicatif pour le
  choix du moteur de Mixpost — seul MySQL est pris en charge.
- **La base de données est jointe via un socket Unix du Cloud SQL Auth Proxy, pas en
  TCP.** `enable_cloudsql_volume` vaut `false` par défaut dans ce module
  (contrairement à la plupart des modules Cloud Run MySQL/Laravel) — vérifiez la
  révision déployée si l'application ne parvient pas à joindre la base de données ;
  l'activer monte le socket sur `/cloudsql`, et `db-init.sh` détecte
  automatiquement le type de connexion (`-S <socket>` ou
  `-h <host> --get-server-public-key`).
- **Redis est activé par défaut et, de fait, indispensable.** `enable_redis = true`
  oriente `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` vers `redis` (avec
  repli sur `sync`/`file` uniquement lorsqu'il est désactivé) — cette fusion a lieu
  dans les locals du `main.tf` du module applicatif lui-même, et non dans
  `Mixpost_Common`. Lorsque `redis_host` est vide, l'IP de la VM du serveur NFS est
  utilisée comme point de terminaison Redis (nécessite `enable_nfs = true`).
- **`min_instance_count = 0`, `cpu_always_allocated = false` — démarrage à froid,
  facturation à la requête.** Contrairement à la variante GKE (qui définit par défaut
  `min = 1` pour maintenir en permanence le planificateur intégré au pod), la
  variante Cloud Run descend à zéro entre les requêtes. **Compromis :** le cron
  Laravel `schedule:run` et le worker de file d'attente ne s'exécutent que lorsqu'une
  instance est active ou sert une requête, de sorte que les publications sociales
  planifiées ne sont **pas** publiées de manière fiable d'elles-mêmes — externalisez
  `schedule:run` avec Cloud Scheduler appelant un point de terminaison cron (toutes
  les minutes), ou définissez `cpu_always_allocated = true` **et**
  `min_instance_count >= 1` pour rétablir un fonctionnement continu dans le processus
  (à l'image des applications toujours actives documentées dans le CLAUDE.md du
  dépôt).
- **NFS est activé par défaut** (`enable_nfs = true`, `/mnt/nfs`) pour le stockage
  partagé des médias et fichiers, et sert aussi d'hôte Redis par défaut lorsque
  `redis_host` est laissé vide.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager au format
  natif de Laravel `base64:<value>` — ne le faites jamais tourner après le premier
  démarrage.
- **La correspondance des variables de base de données Laravel est codée en dur dans
  `main.tf`.** `db_user_env_var_name =
  "DB_USERNAME"`, `db_name_env_var_name = "DB_DATABASE"` et
  `service_url_env_var_name = "APP_URL"` sont définis dans le `main.tf` du module
  applicatif (non configurables par l'opérateur) afin que les valeurs
  `DB_USER`/`DB_NAME`/URL du service propres au tenant fournies par le socle
  aboutissent sur les noms de variables d'environnement que lit réellement `env()`
  de Laravel.
- **La sonde de démarrage est TCP, la sonde de vivacité est HTTP.** `main.tf`
  remplace la configuration de `Mixpost_Common` pour utiliser une sonde de démarrage
  `TCP` sur le port 80 (les contrôles de santé Cloud Run arrivent en HTTP simple
  depuis une adresse interne à Google, et TCP suffit pour confirmer que le port
  écoute) et une sonde de vivacité `HTTP` sur `/`, à laquelle Mixpost répond `200`.
- **`container_image_source = "prebuilt"`** déploie directement
  `inovector/mixpost:<version>` ; il n'y a pas de build de Dockerfile personnalisé
  pour ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Mixpost {#a-cloud-run--the-mixpost-service}

Mixpost s'exécute comme un service Cloud Run v2 qui se met à l'échelle selon la
charge des requêtes entre le nombre minimal et le nombre maximal d'instances. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mixpost stocke toutes les données applicatives (comptes sociaux, publications,
métadonnées des médias, utilisateurs) dans une instance gérée Cloud SQL for
MySQL 8.0. Au premier déploiement, le Job d'initialisation `db-init` crée la base de
données applicative (`utf8mb4`) et l'utilisateur, puis accorde les privilèges ; la
méthode de connexion (socket ou TCP) est détectée automatiquement à partir de
`$DB_HOST`.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié, suffixé `storage`, est provisionné automatiquement
par `Mixpost_Common`. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (file d'attente, cache et sessions) {#d-redis-queue-cache--sessions}

Redis est **activé par défaut** (`enable_redis = true`) et pilote
`QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. Ce module ne provisionne
aucune instance Memorystore dédiée — sauf si `redis_host` est remplacé par une
instance externe, Redis est attendu à l'IP de la VM du serveur NFS (selon la
convention d'infrastructure partagée de ce dépôt, la même VM Compute Engine qui sert
NFS exécute aussi Redis).

- **Console :** Memorystore → Redis (uniquement s'il pointe vers une instance
  gérée) ; sinon Compute Engine → Instances de VM pour l'hôte NFS/Redis.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### E. Secret Manager {#e-secret-manager}

Un secret propre à Mixpost est généré automatiquement : l'`APP_KEY` de Laravel
(`secret-<resource_prefix>-<application_name>-app-key`), une valeur aléatoire de
32 caractères encodée en base64 au format natif de Laravel `base64:<value>`. Le mot
de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Cloud Filestore (NFS) {#f-cloud-filestore-nfs}

**Activé par défaut** (`enable_nfs = true`), monté sur `/mnt/nfs` pour la persistance
partagée des médias et des téléversements, et — lorsque `redis_host` est laissé
vide — également point de terminaison Redis par défaut.

- **Console :** Filestore → Instances ; ou Compute Engine → Instances de VM si l'hôte
  Redis/NFS est la VM NFS autogérée du dépôt.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### G. Réseau et entrée {#g-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mixpost {#3-mixpost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job
  d'initialisation `db-init` exécute `db-init.sh` avec `mysql:8.0-debian`. Il détecte
  automatiquement si `$DB_HOST` est un chemin de socket Unix (`-S`) ou un hôte TCP
  (`-h ... --get-server-public-key`, nécessaire car `caching_sha2_password` de
  MySQL 8 refuse d'envoyer un mot de passe sur ce qui ressemble à une connexion non
  chiffrée), crée de manière idempotente la base de données applicative en
  `utf8mb4`, crée l'utilisateur applicatif et accorde les privilèges. Le job peut être
  relancé sans risque (`execute_on_apply = true`, `max_retries = 1`).
- **Pas de job de migration séparé.** Le point d'entrée supervisord intégré à l'image
  préconstruite `inovector/mixpost` exécute `php artisan migrate --force` et crée le
  compte administrateur à chaque démarrage ; il n'existe donc pas de job
  d'initialisation de migration distinct — la mise à niveau de
  `application_version` applique automatiquement les changements de schéma au
  démarrage suivant.
- **`APP_KEY` est immuable après le premier démarrage.** Il est généré une seule fois
  par `Mixpost_Common` et écrit dans Secret Manager sous la forme
  `base64:<32-char value>`. Le faire tourner invalide les données chiffrées de
  session/cookies et tous les champs chiffrés de la base de données.
- **Les valeurs par défaut du compte administrateur sont intégrées à l'image et ne
  sont pas configurables via ce module.** `mixpost_admin_email` est déclarée pour être
  transmise mais n'est **actuellement pas injectée** dans la configuration du
  conteneur en cours d'exécution — l'image crée son propre compte administrateur par
  défaut indépendamment de cette variable. Récupérez les identifiants réels de
  première connexion dans les valeurs par défaut documentées de l'image et changez le
  mot de passe immédiatement après la première connexion.
- **La publication planifiée dépend du maintien de l'instance active.** Avec les
  valeurs par défaut de démarrage à froid (`min_instance_count = 0`,
  `cpu_always_allocated = false`), le planificateur/worker de file d'attente Laravel
  du conteneur ne s'exécute que pendant le traitement d'une requête ou tant que
  l'instance est dans sa fenêtre de maintien à chaud. Pour une publication planifiée
  fiable, faites appeler par un job Cloud Scheduler un point de terminaison cron/santé
  toutes les minutes afin de garder une instance active et de déclencher
  `schedule:run`, ou définissez `cpu_always_allocated = true` avec
  `min_instance_count >= 1`.
- **Chemin de santé.** La sonde de démarrage est `TCP` sur le port 80 (ce qui évite
  toute complication de redirection HTTP ou d'authentification au premier
  démarrage) ; la sonde de vivacité est `HTTP` sur `/`, auquel Mixpost/nginx répond
  directement `200`. `REQUIRE_HTTPS = false` est injecté car Cloud Run termine le TLS
  devant le conteneur.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'DB_|APP_URL|QUEUE_CONNECTION'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Mixpost ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mixpost` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Mixpost` | Nom lisible affiché dans la console. |
| `application_description` | `Mixpost - Open-source social media management platform` | Description du service. |
| `application_version` | `latest` | Tag de l'image `inovector/mixpost` déployée directement (préconstruite, sans build personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement `inovector/mixpost` ; transmis explicitement afin que le socle ne le traite pas comme un build personnalisé sans Dockerfile. |
| `container_image` | `""` | Remplacez-la par l'URI d'une image mise en miroir ou personnalisée. |
| `cpu_limit` | `2000m` | 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mixpost requiert au moins 2Gi pour le traitement des médias et les workers de file d'attente. |
| `cpu_always_allocated` | `false` | Démarrage à froid / facturation à la requête. Définissez `true` (avec `min_instance_count >= 1`) pour maintenir en permanence le planificateur/worker de file d'attente Laravel ; sinon, externalisez `schedule:run` via Cloud Scheduler. |
| `min_instance_count` | `0` | `0` permet la mise à zéro ; définissez `1` ou plus pour éviter les démarrages à froid et garder le planificateur actif. |
| `max_instance_count` | `3` | Plafond de coût ; augmentez-le avec prudence — Mixpost n'a pas de coordination de file d'attente multi-instances intégrée au-delà de Redis. |
| `container_port` | `80` | nginx + PHP-FPM servent du HTTP simple sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Socket Unix du Cloud SQL Auth Proxy. Activez-le pour les connexions par socket ; `db-init.sh` détecte automatiquement socket ou TCP dans tous les cas. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Mixpost dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec la convention ; non référencée par le déploiement de ce module. |
| `container_protocol` | `http1` | `h2c` est disponible si l'application prend en charge HTTP/2 en clair. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de montage du socket du Cloud SQL Auth Proxy. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour l'interface Mixpost et les éventuels webhooks entrants des plateformes sociales. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales `APP_*`/`DB_*`/`MAIL_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(définis)_ | Instance NFS existante / nom de base d'une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. Consultez [App_CloudRun](App_CloudRun.md). |

### Groupe 10 — Cloud Armor, CDN et conservation des images {#group-10--cloud-armor-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définis)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "storage" }]` | Le bucket provisionné automatiquement ainsi que d'éventuels buckets supplémentaires. |
| `enable_nfs` | `true` | Activé par défaut pour les médias/téléversements partagés, et sert aussi de source par défaut de l'hôte Redis. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Mixpost_Common` ; ne peut pas être remplacé par un autre moteur. |
| `application_database_name` | `mixpost` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mixpost` | Utilisateur applicatif de la base de données ; mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non relié au planificateur propre à Mixpost — utilisez ceci ou un job Cloud Scheduler externe pour externaliser `schedule:run` avec la valeur par défaut de démarrage à froid. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` port 80, 90s delay, `failure_threshold=36` | Sonde de démarrage remplacée par une sonde TCP dans `main.tf`. |
| `liveness_probe` | HTTP `/`, 120s delay, `failure_threshold=3` | Sonde de vivacité ; Mixpost/nginx répond `200` sur `/`. |
| `startup_probe_config` | HTTP `/`, 90s delay | Sonde structurée alternative (valeur par défaut de l'objet de configuration ; supplantée par le remplacement `startup_probe` ci-dessus pour la révision Cloud Run effective). |
| `health_check_config` | HTTP `/`, 120s delay | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Oriente `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` vers `redis` ; repli sur `sync`/`file` lorsqu'il est désactivé. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définis)_ | CIDR des niveaux d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

### Groupe 23 — Paramètres de l'application Mixpost {#group-23--mixpost-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Déclarée pour le câblage ; **actuellement non injectée** dans la configuration en cours d'exécution — l'image crée de toute façon son propre compte administrateur par défaut. |
| `mail_from_name` | `Mixpost` | Nom d'expéditeur affiché sur les e-mails sortants (`MAIL_FROM_NAME`). |
| `mail_from_address` | `mixpost@example.com` | Adresse d'expéditeur des e-mails sortants (`MAIL_FROM_ADDRESS`) ; `MAIL_MAILER = "smtp"` est défini automatiquement. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

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
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critique | Ne peut pas être remplacé par un autre moteur ; `Mixpost_Common` code MySQL en dur quelle que soit la valeur apparente de cette variable. |
| `application_database_name` / `application_database_user` | Définis une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend toutes les données orphelines. |
| `APP_KEY` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Faire tourner la clé Laravel invalide les données chiffrées de session/cookies et tous les champs chiffrés de la base de données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` si vous utilisez la publication planifiée | Élevé | Conserver la valeur par défaut de démarrage à froid (`false` / `0`) signifie que le planificateur et le worker de file d'attente Laravel ne s'exécutent que lorsqu'une instance se trouve active — les publications sociales planifiées cessent silencieusement d'être publiées à l'heure prévue, sauf si elles sont externalisées via Cloud Scheduler. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS activé, ou un `redis_host` explicite | Élevé | Activer Redis sans source d'hôte (pas de `redis_host`, pas de NFS) laisse la connexion Redis vide, et l'application ne gère plus correctement la file d'attente, le cache et les sessions. |
| `enable_cloudsql_volume` | Conforme aux attentes de connexion de l'application à la base de données | Élevé | Ce module le définit à `false` par défaut (TCP/IP privée) ; si `db-init` ou l'application ne parvient pas à joindre la base de données, vérifiez si c'est un socket (`true`) ou un chemin TCP qui est réellement utilisé dans la révision déployée. |
| `memory_limit` | `2Gi` | Élevé | Mixpost requiert au moins 2Gi pour le traitement des médias et les workers de file d'attente ; des valeurs inférieures exposent à des arrêts pour manque de mémoire (OOM) sous charge concurrente. |
| `mixpost_admin_email` | Récupérer les identifiants réels après le déploiement | Moyen | La variable n'est pas injectée dans la configuration en cours d'exécution ; l'image crée de toute façon son propre compte administrateur par défaut — changez le mot de passe immédiatement après la première connexion. |
| `min_instance_count` | `0` pour le coût, `1` ou plus pour la latence/la planification | Moyen | La mise à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité, en plus du compromis de planification ci-dessus. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |
| `enable_cloud_armor` | à activer en production | Moyen | L'interface d'administration et la page de connexion sont joignables publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Mixpost
(le secret `APP_KEY`, le script `db-init` et les variables d'environnement fusionnées
dans le conteneur) est partagée avec la variante GKE via le module interne
`Mixpost_Common`, qui n'est pas déployé directement et ne dispose pas encore de son
propre guide de configuration.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mixpost sur Cloud Run](../labs/Mixpost_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mixpost sur GKE Autopilot](Mixpost_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mixpost Common — Configuration applicative partagée](Mixpost_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution **Marketing Automation Suite**.
