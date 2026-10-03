---
title: "Mixpost sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Mixpost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mixpost_CloudRun.md @ 15fd4c7 sha256:cd2e6d9f336c -->

# Mixpost sur Google Cloud Run {#mixpost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mixpost_CloudRun.png" alt="Mixpost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mixpost est une plateforme open source et auto-hébergée de planification et de
gestion des médias sociaux — une alternative à Buffer/Hootsuite pour composer,
planifier, publier et analyser des publications sur plusieurs comptes sociaux
à partir d'un seul tableau de bord. Il est livré sous la forme d'une
application Laravel unique (nginx + PHP-FPM + supervisord exécutant le worker
de file d'attente et le planificateur à l'intérieur d'un seul conteneur,
l'image officielle `inovector/mixpost`). Ce module déploie Mixpost sur
**Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Mixpost et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications Cloud Run — identité de service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Mixpost s'exécute comme un conteneur web unique et autonome sur Cloud Run v2 —
pas d'étape de build séparée, puisque l'image officielle pré-construite est
déployée directement.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | conteneur nginx + PHP-FPM + supervisord écoutant sur le port 80, 2 vCPU / 2 GiB par défaut ; autoscaling sans serveur |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis et fixe — `Mixpost_Common` code en dur `MYSQL_8_0` |
| File d'attente, cache et sessions | Redis | Activé par défaut ; pilote `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` ; utilise par défaut l'IP du serveur NFS colocalisé si aucun hôte externe n'est spécifié |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Mixpost_Common` |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-générée ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Mixpost_Common` définit `database_type = "MYSQL_8_0"`
  et `DB_CONNECTION = "mysql"` inconditionnellement ; la valeur nominale de la variable
  `database_type` n'est pas réellement transmise depuis le module d'application
  pour le choix du moteur Mixpost — seul MySQL est pris en charge.
- **La base de données est accessible via un socket Unix Cloud SQL Auth Proxy,
  et non via TCP.** `enable_cloudsql_volume` active par défaut `false` sur ce
  module (contrairement à la plupart des modules Cloud Run MySQL/Laravel) —
  vérifiez la révision déployée si l'application ne peut pas atteindre la base
  de données ; l'activation monte le socket à `/cloudsql` et
  `db-init.sh` détecte automatiquement le type de connexion
  (`-S <socket>` vs `-h <host> --get-server-public-key`).
- **Redis est activé par défaut et effectivement requis.** `enable_redis = true`
  connecte `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` à
  `redis` (en revenant à `sync`/`file` uniquement
  lorsqu'il est désactivé) — cette fusion se produit dans les variables
  locales `main.tf` du module d'application, et non dans `Mixpost_Common`.
  Lorsque `redis_host` est vide, l'IP de la VM du serveur NFS est utilisée
  comme point de terminaison Redis (nécessite `enable_nfs = true`).
- **`min_instance_count = 0`, `cpu_always_allocated = false` — démarrage à froid,
  facturation basée sur les requêtes.** Contrairement à la variante GKE (qui
  définit `min = 1` par défaut pour maintenir le planificateur
  intra-pod en fonctionnement continu), la variante Cloud Run se met à l'échelle
  à zéro entre les requêtes. **Compromis :** le cron `schedule:run` et le
  worker de file d'attente Laravel ne s'exécutent que lorsqu'une instance est
  chaude/traite une requête, de sorte que les publications sociales planifiées
  ne sont **pas** publiées de manière fiable par elles-mêmes — externalisez
  `schedule:run` avec Cloud Scheduler en appelant un point de terminaison cron
  (toutes les minutes), ou définissez `cpu_always_allocated = true` **et**
  `min_instance_count >= 1` pour restaurer le fonctionnement continu en cours de
  processus (reflétant les applications toujours actives documentées dans le
  CLAUDE.md du dépôt).
- **NFS est activé par défaut** (`enable_nfs = true`, `/mnt/nfs`) pour le
  stockage partagé de médias/fichiers, et sert également d'hôte Redis par
  défaut lorsque `redis_host` est laissé vide.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager
  au format natif `base64:<value>` de Laravel — ne le faites jamais pivoter
  après le premier démarrage.
- **Le mappage des variables d'environnement de la base de données Laravel est
  codé en dur dans `main.tf`.** `db_user_env_var_name =
  "DB_USERNAME"`, `db_name_env_var_name = "DB_DATABASE"` et
  `service_url_env_var_name = "APP_URL"` sont définis dans `main.tf` du module
  d'application (non configurable par l'opérateur) afin que les
  `DB_USER`/`DB_NAME`/URL de service du locataire de la fondation
  atterrissent sur les noms de variables d'environnement que `env()` de
  Laravel lit réellement.
- **La sonde de démarrage est TCP, la sonde de vivacité est HTTP.**
  `main.tf` remplace la configuration de `Mixpost_Common` pour utiliser
  une sonde de démarrage `TCP` sur le port 80 (les vérifications de
  santé Cloud Run arrivent via HTTP simple depuis une adresse interne à Google,
  et TCP est suffisant pour confirmer que le port écoute) et une sonde de
  vivacité `HTTP` contre `/`, à laquelle Mixpost
  répond avec `200`.
- **`container_image_source = "prebuilt"`** déploie `inovector/mixpost:<version>`
  directement ; il n'y a pas de build Dockerfile personnalisé pour ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de services et de ressources sont indiqués dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Mixpost {#a-cloud-run--the-mixpost-service}

Mixpost s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge des requêtes entre les nombres minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mixpost stocke toutes les données d'application (comptes sociaux, publications,
métadonnées de médias, utilisateurs) dans une instance gérée de Cloud SQL pour
MySQL 8.0. Lors du premier déploiement, le job d'initialisation `db-init`
crée la base de données d'application (`utf8mb4`) et l'utilisateur et
accorde les privilèges ; la méthode de connexion (socket vs TCP) est
auto-détectée à partir de `$DB_HOST`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié suffixé par `storage` est provisionné
automatiquement par `Mixpost_Common`. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (file d'attente, cache et sessions) {#d-redis-queue-cache--sessions}

Redis est **activé par défaut** (`enable_redis = true`), pilotant
`QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. Aucune instance
Memorystore dédiée n'est provisionnée par ce module — à moins que
`redis_host` ne soit remplacé par une instance externe, Redis est attendu
à l'IP de la VM du serveur NFS (la même VM Compute Engine qui sert NFS exécute
également Redis dans la convention d'infrastructure partagée de ce dépôt).

- **Console :** Memorystore → Redis (uniquement si pointé vers une instance
  gérée) ; sinon Compute Engine → Instances de VM pour l'hôte NFS/Redis.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Mixpost est généré automatiquement : la clé
`APP_KEY` de Laravel (`secret-<resource_prefix>-<application_name>-app-key`), une valeur aléatoire de
32 caractères encodée en base64 au format natif `base64:<value>` de Laravel. Le
mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Cloud Filestore (NFS) {#f-cloud-filestore-nfs}

**Activé par défaut** (`enable_nfs = true`), monté à `/mnt/nfs` pour la
persistance partagée des médias/téléchargements, et — lorsque
`redis_host` est laissé vide — également le point de terminaison Redis par
défaut.

- **Console :** Filestore → Instances ; ou Compute Engine → Instances de VM si
  l'hôte Redis/NFS est la VM NFS auto-gérée du dépôt.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### G. Réseau et entrée {#g-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peuvent être superposés ; les paramètres d'entrée et de sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mixpost {#3-mixpost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  d'initialisation `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il détecte automatiquement si `$DB_HOST` est un
  chemin de socket Unix (`-S`) ou un hôte TCP
  (`-h ... --get-server-public-key`, nécessaire car `caching_sha2_password` de MySQL 8 refuse
  d'envoyer un mot de passe sur ce qui ressemble à une connexion non chiffrée),
  crée de manière idempotente la base de données d'application avec
  `utf8mb4`, crée l'utilisateur de l'application et accorde les
  privilèges. Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries = 1`).
- **Pas de job de migration séparé.** Le point d'entrée supervisord
  intégré de l'image `inovector/mixpost` pré-construite exécute
  `php artisan migrate --force` et initialise le compte administrateur à chaque démarrage,
  il n'y a donc pas de job d'initialisation de migration distinct — la mise à
  niveau de `application_version` applique automatiquement les modifications de
  schéma au prochain démarrage.
- **`APP_KEY` est immuable après le premier démarrage.** Généré
  une fois par `Mixpost_Common` et écrit dans Secret Manager sous le nom
  `base64:<32-char value>`. Sa rotation invalide les données de session/cookie
  chiffrées et tous les champs de base de données chiffrés.
- **Les valeurs par défaut du compte administrateur sont intégrées à
  l'image, non configurables via ce module.** `mixpost_admin_email` est déclaré
  pour la transmission mais n'est **pas actuellement injecté** dans la
  configuration du conteneur en cours d'exécution — l'image initialise son
  propre compte administrateur par défaut, quelle que soit cette variable.
  Récupérez les identifiants réels de première connexion à partir des
  valeurs par défaut documentées de l'image et modifiez le mot de passe
  immédiatement après la première connexion.
- **La publication planifiée dépend du maintien de l'instance en état de
  fonctionnement.** Avec la valeur par défaut de démarrage à froid
  (`min_instance_count = 0`, `cpu_always_allocated = false`), le planificateur Laravel et le
  worker de file d'attente intégrés au conteneur ne s'exécutent que
  lorsqu'une requête est en cours ou que l'instance se trouve dans sa fenêtre
  de maintien en état de fonctionnement. Pour une publication planifiée
  fiable, soit pointez un job Cloud Scheduler vers un point de terminaison
  cron/santé toutes les minutes pour maintenir une instance en vie et déclencher
  `schedule:run`, soit définissez `cpu_always_allocated = true` avec
  `min_instance_count >= 1`.
- **Chemin de santé.** La sonde de démarrage est `TCP` sur le port
  80 (évite toute complication de redirection/authentification HTTP au premier
  démarrage) ; la sonde de vivacité est `HTTP` sur
  `/`, à laquelle Mixpost/nginx répond directement avec
  `200`. `REQUIRE_HTTPS = false` est injecté car Cloud Run
  termine TLS devant le conteneur.
- **Inspecter l'exécution du job :**
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

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Mixpost sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mixpost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Mixpost` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Mixpost - Open-source social media management platform` | Description du service. |
| `application_version` | `latest` | Tag d'image `inovector/mixpost` déployé directement (pré-construit, pas de build personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie `inovector/mixpost` directement ; transmis explicitement pour que la Fondation ne le traite pas comme un build personnalisé sans Dockerfile. |
| `container_image` | `""` | Remplacez par un URI d'image miroir ou personnalisé. |
| `cpu_limit` | `2000m` | 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mixpost nécessite au moins 2 Gi pour le traitement des médias et les workers de file d'attente. |
| `cpu_always_allocated` | `false` | Facturation basée sur le démarrage à froid/les requêtes. Définissez `true` (avec `min_instance_count >= 1`) pour maintenir le planificateur/worker de file d'attente Laravel en fonctionnement continu ; sinon, externalisez `schedule:run` via Cloud Scheduler. |
| `min_instance_count` | `0` | `0` permet la mise à l'échelle à zéro ; définissez `1`+ pour éviter les démarrages à froid et maintenir le planificateur chaud. |
| `max_instance_count` | `3` | Plafond de coût ; augmentez avec prudence — Mixpost n'a pas de coordination de file d'attente multi-instances intégrée au-delà de Redis. |
| `container_port` | `80` | nginx + PHP-FPM servent du HTTP simple sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Socket Unix Cloud SQL Auth Proxy. Activez pour les connexions basées sur socket ; `db-init.sh` détecte automatiquement le socket ou le TCP dans tous les cas. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image Mixpost dans Artifact Registry. |
| `traffic_split` | `[]` | Répartissez le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |
| `container_protocol` | `http1` | `h2c` disponible si l'application prend en charge HTTP/2 cleartext. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de montage pour le socket Cloud SQL Auth Proxy. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour l'interface utilisateur Mixpost et tous les webhooks de plateforme sociale entrants. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `APP_*`/`DB_*`/`MAIL_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager lors du déploiement. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |

### Groupe 10 — Cloud Armor, CDN et rétention d'images {#group-10--cloud-armor-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "storage" }]` | Le bucket auto-provisionné plus tous les buckets supplémentaires. |
| `enable_nfs` | `true` | Activé par défaut pour les médias/téléchargements partagés, et sert également de source d'hôte Redis par défaut. |
| `nfs_mount_path` | `/var/www/html/storage/app/public` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Mixpost_Common` ; non modifiable pour un autre moteur. |
| `application_database_name` | `mixpost` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mixpost` | Utilisateur de la base de données d'application ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non connecté au propre planificateur de Mixpost — utilisez ceci ou un job Cloud Scheduler externe si vous externalisez `schedule:run` sous la valeur par défaut de démarrage à froid. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` port 80, délai de 90s, `failure_threshold=36` | Sonde de démarrage remplacée dans `main.tf` par TCP. |
| `liveness_probe` | HTTP `/`, délai de 120s, `failure_threshold=3` | Sonde de vivacité ; Mixpost/nginx répond à `/` avec `200`. |
| `startup_probe_config` | HTTP `/`, délai de 90s | Sonde structurée alternative (valeur par défaut de l'objet de configuration ; remplacée par la surcharge `startup_probe` ci-dessus pour la révision Cloud Run réelle). |
| `health_check_config` | HTTP `/`, délai de 120s | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Connecte `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` à `redis` ; revient à `sync`/`file` lorsqu'il est désactivé. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Mixpost {#group-23--mixpost-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Déclaré pour le câblage ; **non actuellement injecté** dans la configuration en cours d'exécution — l'image initialise son propre compte administrateur par défaut, quelle que soit cette variable. |
| `mail_from_name` | `Mixpost` | Nom d'affichage de l'expéditeur sur les e-mails sortants (`MAIL_FROM_NAME`). |
| `mail_from_address` | `mixpost@example.com` | Adresse de l'expéditeur sur les e-mails sortants (`MAIL_FROM_ADDRESS`) ; `MAIL_MAILER = "smtp"` est défini automatiquement. |

Toutes les autres entrées suivent le comportement standard de
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données d'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification —
> un réplica en lecture sans son primaire, IAP sans identités autorisées, un
> runtime `gen1` avec des montages NFS/GCS, une
> `redis_port`/`backup_retention_days` hors plage. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critique | Non modifiable pour un autre moteur ; `Mixpost_Common` code en dur MySQL quelle que soit la valeur nominale de cette variable. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | La rotation de la clé Laravel invalide les données de session/cookie chiffrées et tous les champs de base de données chiffrés. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` si vous utilisez la publication planifiée | Élevé | Laisser la valeur par défaut de démarrage à froid (`false` / `0`) signifie que le planificateur Laravel et le worker de file d'attente ne s'exécutent que lorsqu'une instance est chaude — les publications sociales planifiées cessent silencieusement de se publier selon un calendrier à moins d'être externalisées via Cloud Scheduler. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS activé, ou un `redis_host` explicite | Élevé | L'activation de Redis sans source d'hôte (pas de `redis_host`, pas de NFS) laisse la connexion Redis vide et l'application échoue à mettre en file d'attente/cacher/session correctement. |
| `enable_cloudsql_volume` | Correspondre aux attentes de connexion à la base de données de l'application | Élevé | Ce module le définit par défaut `false` (TCP/IP privée) ; si `db-init` ou l'application ne peut pas atteindre la base de données, vérifiez si un socket (`true`) ou un chemin TCP est réellement utilisé à la révision déployée. |
| `memory_limit` | `2Gi` | Élevé | Mixpost nécessite au moins 2 Gi pour le traitement des médias et les workers de file d'attente ; des valeurs inférieures risquent des OOM kills sous charge concurrente. |
| `mixpost_admin_email` | Récupérer les identifiants réels après le déploiement | Moyen | La variable n'est pas injectée dans la configuration en cours d'exécution ; l'image initialise son propre compte administrateur par défaut, quelle que soit cette variable — modifiez le mot de passe immédiatement après la première connexion. |
| `min_instance_count` | `0` pour le coût, `1`+ pour la latence/planification | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité, en plus du compromis de planification ci-dessus. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur d'administration et la connexion sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Mixpost (le secret `APP_KEY`, le script
`db-init` et les variables d'environnement fusionnées dans le conteneur)
est partagée avec la variante GKE via le module interne `Mixpost_Common`, qui
n'est pas déployé directement et n'a pas encore son propre guide de
configuration.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mixpost sur Cloud Run](../labs/Mixpost_CloudRun.md) —
  déployez-le étape par étape, avec les écrans de console et les commandes à
  chaque étape.
- [Mixpost sur GKE Autopilot](Mixpost_GKE.md) — la même application sur
  Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mixpost Common — Configuration d'application partagée](Mixpost_Common.md) —
  la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Mautic sur Google Cloud Run](Mautic_CloudRun.md),
  [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md),
  [Matomo sur Google Cloud Run](Matomo_CloudRun.md),
  [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution
  **Marketing Automation Suite**.
