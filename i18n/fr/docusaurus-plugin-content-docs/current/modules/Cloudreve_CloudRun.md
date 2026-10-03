---
title: "Cloudreve sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Cloudreve sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Cloudreve_CloudRun.md @ 15fd4c7 sha256:ed755b247d65 -->

# Cloudreve sur Google Cloud Run {#cloudreve-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cloudreve_CloudRun.png" alt="Cloudreve sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cloudreve est une plateforme de stockage cloud et de partage de fichiers
open-source, auto-hébergée et populaire, écrite en Go. Elle fournit une
interface utilisateur web pour le téléchargement, l'organisation, la
prévisualisation et le partage de fichiers, avec des back-ends de stockage
enfichables. Ce module déploie Cloudreve sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Cloudreve et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cloudreve s'exécute comme un seul binaire Go servant à la fois l'interface
utilisateur web et l'API de stockage de fichiers. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go sur le port 5212, instance unique par défaut (`min = max = 1`) |
| Persistance | Cloud Filestore (NFS) | Monté à `/cloudreve` (`enable_nfs = true` par défaut) ; contient la base de données SQLite embarquée, les `conf.ini` générés, les téléchargements et les avatars. Cloud Run n'a pas d'équivalent de volume de bloc à la PVC de GKE, et GCS FUSE ne peut pas héberger une base de données SQLite |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est créé ; il est monté à `/cloudreve` via GCS FUSE uniquement si `enable_nfs` est désactivé (non recommandé) |
| Base de données | Aucune | Cloudreve utilise une base de données SQLite embarquée sur le volume monté — aucune instance Cloud SQL n'est créée |
| Secrets | Secret Manager | Aucun créé — le mot de passe administrateur de première exécution est généré par Cloudreve lui-même et imprimé dans les journaux du conteneur |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par `Cloudreve_Common` ;
  toutes les variables liées à Cloud SQL sont transmises à la fondation
  uniquement pour la compatibilité de l'interface et n'ont aucun effet.
- **NFS est le mécanisme de persistance, et `enable_nfs` doit rester `true`.**
  Cloud Run n'a pas d'option de volume de bloc, et GCS FUSE ne peut pas
  héberger une base de données SQLite (pas de verrouillage POSIX ou de mémoire
  partagée ; écritures d'ajout séquentiel uniquement) — sur GCS FUSE, les
  écritures de journal de Cloudreve échouent et une instance peut ne pas
  démarrer du tout. Ainsi, le volume NFS partagé est monté à `/cloudreve`
  (`nfs_mount_path`) et le wrapper désactive le volume de stockage GCS FUSE
  chaque fois que NFS est activé (`enable_gcs_storage_volume = !var.enable_nfs`). Cloudreve utilise un
  journal de retour arrière plutôt que WAL, donc NFS est une cible solide avec
  un seul rédacteur. Pour un véritable périphérique de bloc, utilisez
  Cloudreve_GKE.
- **La colocation binaire/données est gérée dans la build de l'image.** L'image
  `cloudreve/cloudreve` en amont conserve à la fois le binaire `cloudreve` et ses
  données dans `/cloudreve`. Le Dockerfile de ce module déplace le binaire
  vers `/usr/local/bin/cloudreve` dans une build multi-étapes (`ENTRYPOINT
  ["/usr/local/bin/cloudreve"]`, `WORKDIR /cloudreve`),
  donc le montage du volume de données à `/cloudreve` ne masque que les
  fichiers de données, jamais le binaire. Voir la [Section 3](#3-cloudreve-application-behaviour).
- **Pas de Cloud SQL, pas de Redis.** `enable_cloudsql_volume` par défaut `false` et
  `enable_redis` est explicitement remplacé par `false` dans `main.tf`,
  quelle que soit la valeur de la variable.
- **Pas de secret administrateur injectable.** Cloudreve génère son propre mot
  de passe administrateur initial au premier démarrage et l'imprime dans les
  journaux du conteneur — aucun secret Secret Manager n'est créé ;
  `secret_ids`/`secret_values` de `Cloudreve_Common` sont des cartes vides.
- **Instance unique par défaut.** `min_instance_count = max_instance_count =
  1`, correspondant à l'absence de
  support de clustering distribué/multi-nœuds de Cloudreve et évitant les
  écritures concurrentes sur le fichier SQLite monté unique.
- **`container_port` par défaut à `5212`** et est en fait transmis à la
  configuration effective par application (contrairement à d'autres variables
  pass-through dans ce module) — mais le modifier ne change **pas** ce que le
  binaire Cloudreve lui-même écoute en interne, car il n'y a pas de variable
  d'environnement ou de drapeau CLI qui connecte ce port au conteneur. Laissez
  la valeur par défaut.
- **L'ingress public est activé par défaut** (`ingress_settings = "all"`) afin que
  l'interface utilisateur web soit accessible directement à l'URL Cloud Run.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Cloudreve {#a-cloud-run--the-cloudreve-service}

Cloudreve s'exécute en tant que service Cloud Run v2. Chaque déploiement crée
une révision immuable ; le trafic peut être réparti entre les révisions pour
des déploiements sûrs. Avec la valeur par défaut `min_instance_count = max_instance_count = 1`, une seule
instance sert tout le trafic à tout moment.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Filestore (persistance NFS) et Cloud Storage {#b-cloud-filestore-nfs-persistence-and-cloud-storage}

La base de données SQLite embarquée de Cloudreve (`cloudreve.db`), les
`conf.ini` générés et les fichiers téléchargés se trouvent tous sous
`/cloudreve`, le répertoire de travail du conteneur. Ce chemin est le point
de montage du volume **NFS** partagé (`enable_nfs = true`, `nfs_mount_path = "/cloudreve"`) —
Cloud Run n'a pas d'équivalent de volume de bloc à une PVC GKE, et GCS FUSE ne
peut pas héberger une base de données SQLite. Un bucket Cloud Storage
`storage` dédié est toujours créé par `Cloudreve_Common` ; il est monté à
`/cloudreve` via GCS FUSE uniquement si vous désactivez NFS, ce qui n'est
pas recommandé.

- **Console :** Cloud Storage → Buckets → filtrez par le suffixe
  `storage` du déploiement.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/
  ```

SQLite a un seul rédacteur ici, donc l'exécution de plus d'une instance
(`max_instance_count > 1`) risque de corrompre le fichier de base de données embarqué —
voir la [Section 6](#6-configuration-pitfalls--sensible-defaults). Voir
[App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager pour Cloudreve lui-même
— le mot de passe administrateur de première exécution est généré
internement par Cloudreve et imprimé dans les journaux du conteneur au premier
démarrage, non stocké dans Secret Manager. Tous les secrets configurés via
`secret_environment_variables` sont toujours injectés via le mécanisme Secret Manager standard.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~cloudreve"
  gcloud logging read 'resource.type="cloud_run_revision"' --project "$PROJECT" --limit 200 | grep -i "admin\|password"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation (la rotation n'a aucun effet ici car aucun secret de service n'existe).

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut
(`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peut être superposé via `enable_cloud_armor` ;
les paramètres d'ingress et le contrôle d'égression VPC contrôlent la
connectivité autrement.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging — c'est aussi là
qu'apparaît le mot de passe administrateur généré lors de la première
exécution (voir la [Section 3](#3-cloudreve-application-behaviour)). Les
métriques Cloud Run sont envoyées à Cloud Monitoring, avec des vérifications
de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cloudreve {#3-cloudreve-application-behaviour}

- **Pas de job d'initialisation de base de données.** `Cloudreve_Common`
  n'injecte pas de job `db-init`/`db-create` par défaut — Cloudreve
  n'a pas de base de données SQL à provisionner. `initialization_jobs` n'exécute que
  les jobs que vous fournissez explicitement.
- **Auto-configuration au premier démarrage, mot de passe administrateur dans les journaux.**
  Au premier démarrage, Cloudreve crée son schéma SQLite sur le volume
  `/cloudreve` monté et génère le compte administrateur initial, en
  imprimant le mot de passe généré dans les journaux du conteneur. Il n'y a
  pas d'étape de migration distincte ni de secret Secret Manager pour le
  récupérer — capturez-le avec `gcloud run services logs read` (ou `gcloud logging read`) avant
  que le tampon de journal ne tourne, puis modifiez-le via l'interface
  utilisateur web.
- **L'occultation de volume est pré-corrigée dans le Dockerfile.** Sans le
  déplacement décrit dans la [Section 1](#1-overview), le volume monté à
  `/cloudreve` occulterait le binaire colocalisé, produisant `exec ./cloudreve: no such
  file or directory`
  (boucle de crash). Il s'agit d'un module de **build personnalisé**
  (`container_image_source = "custom"`, `image_source = "custom"` dans `Cloudreve_Common`)
  précisément pour que cette correction (`modules/Cloudreve_Common/scripts/Dockerfile`) puisse être
  intégrée — ce n'est pas un simple passage de l'image en amont. La
  modification du Dockerfile nécessite une reconstruction (`tofu taint
  'module.app_cloudrun.module.app_build.null_resource.build_and_push_application_image[0]'` si
  un déclencheur de hachage de contenu manque le changement).
- **Le verrouillage de version utilise un ARG de build spécifique à l'application.**
  Le Dockerfile lit `CLOUDREVE_VERSION` (verrouillé à `3.8.3` lorsque
  `application_version =
  "latest"`), et non le générique `APP_VERSION` que la Fondation injecte
  et forcerait autrement à la balise irrésoluble `latest`.
- **Chemins de sonde de santé.** La sonde de démarrage est **HTTP** `GET /`
  (`initial_delay_seconds = 15`, `failure_threshold = 10`, c'est-à-dire jusqu'à ~100s pour être
  prête) ; la sonde de vivacité est également **HTTP** `GET /`
  (`initial_delay_seconds = 30`, `period_seconds = 30`). Cloudreve n'a pas de point de terminaison
  de santé dédié distinct de son interface utilisateur web — `/`
  renvoie 200 une fois que le serveur est en service.
- **Sémantique d'instance unique.** Avec `min_instance_count = max_instance_count
  = 1`, une seule instance
  sert le trafic ; n'augmentez pas `max_instance_count` sans vérifier le support
  multi-nœuds/clustering de Cloudreve (non géré par ce module) — le fichier
  SQLite partagé n'a pas de protection intégrée contre les rédacteurs
  concurrents.
- **`container_port` est transmis mais non câblé à l'application.** Le binaire
  Cloudreve écoute sur son propre port par défaut (5212) sans variable
  d'environnement ni drapeau CLI dans le Dockerfile de ce module pour le
  modifier ; la modification de `container_port` ne modifie que ce vers quoi
  Cloud Run achemine, il doit donc rester à la valeur par défaut.
- **Inspectez le service en cours d'exécution et l'exécution du job :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement (selon leurs balises `{{UIMeta group=N}}`). Seuls les
paramètres spécifiques ou notables pour Cloudreve sont listés ; toutes les
autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudreve` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Cloudreve` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Cloudreve — self-hosted cloud storage / file-sharing system` | Description du service. |
| `application_version` | `latest` | Balise d'image `cloudreve/cloudreve` ; `latest` est épinglé à `3.8.3` au moment de la build via l'ARG de build `CLOUDREVE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; taille pour le service de fichiers et les transferts concurrents. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid pendant le chargement de l'index de Cloudreve. |
| `max_instance_count` | `1` | **Maintenez à 1** — pas de support multi-nœuds/clustering vérifié, et un fichier SQLite partagé n'a pas de protection contre les rédacteurs concurrents. |
| `container_port` | `5212` | Port HTTP par défaut de Cloudreve. Transmis à la configuration effective par application, mais non câblé au port d'écoute du binaire — laissez la valeur par défaut. |
| `execution_environment` | `gen2` | Requis pour les montages NFS (et GCS Fuse). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Cloudreve n'a pas de base de données Cloud SQL — toujours `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Cloudreve dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` disponible mais non requis par Cloudreve. |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes personnalisées sur la ressource de service Cloud Run. |
| `container_image` / `container_image_source` / `container_build_config` / `container_resources` / `cloudsql_volume_mount_path` / `max_revisions_to_retain` | _(divers)_ | Déclaré pour la mise en miroir des variables de la Fondation uniquement — **non transmis** dans `main.tf`. L'image réelle, la configuration de build (chemin du Dockerfile, ARG de build `CLOUDREVE_VERSION`) et la forme de la ressource sont fixées à l'intérieur de `Cloudreve_Common`. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public pour atteindre directement l'interface utilisateur web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant la propre connexion de Cloudreve. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets transmis directement au conteneur. |
| `secret_environment_variables` | `{}` | Carte de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager (aucun secret de service n'existe pour la rotation par défaut). |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement (`backup_uri` est transmis à l'entrée `backup_file` de la fondation). |
| `additional_containers` / `additional_services` | `[]` | Déclaré pour la mise en miroir de la Fondation uniquement ; Cloudreve n'utilise pas de conteneurs sidecar ou de services supplémentaires. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Scripts SQL personnalisés et sélection d'instance NFS {#group-9--custom-sql-scripts--nfs-instance-selection}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Non applicable — Cloudreve n'a pas de base de données SQL. |
| `nfs_instance_name` / `nfs_instance_base_name` / `nfs_volume_name` | auto-découverte / `app-nfs` / `nfs-data-volume` | Sélectionnez l'instance NFS qui prend en charge `/cloudreve` (`enable_nfs` est activé par défaut et doit le rester pour Cloudreve sur Cloud Run). |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets` ; gère également le bucket `storage` auto-provisionné. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : Cloudreve conserve `conf.ini`, sa base de données SQLite, les téléchargements et les avatars sous `/cloudreve`, et GCS FUSE ne peut pas héberger une base de données SQLite. |
| `nfs_mount_path` | `/cloudreve` | Doit rester `/cloudreve` — le répertoire de travail de Cloudreve, où se trouve tout son état. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires. Le bucket `storage` est monté à `/cloudreve` uniquement lorsque `enable_nfs = false` ; avec NFS activé (par défaut), seules les entrées ici sont montées. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | Valeur par défaut App_CloudRun `true`, mais **forcé `false`** dans `main.tf` | Cloudreve n'utilise pas Redis ; la valeur de la variable n'a aucun effet quelle que soit la configuration. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Cloudreve_Common` — Cloudreve n'a pas de base de données SQL. |
| `database_password_length` / `enable_auto_password_rotation` / `rotation_propagation_delay_sec` / `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` / `service_url_env_var_name` / `application_database_name` / `application_database_user` / `enable_mysql_plugins` / `mysql_plugins` / `enable_postgres_extensions` / `postgres_extensions` / `sql_instance_name` / `sql_instance_base_name` | _(divers)_ | Tous déclarés pour la mise en miroir des variables de la Fondation uniquement et **non transmis** dans `main.tf` — Cloudreve n'a pas de base de données à laquelle l'une de ces variables pourrait s'appliquer. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut n'est injecté — Cloudreve n'a pas besoin de configuration de base de données. Ne fournissez des jobs que pour le chargement de données personnalisées ou les tâches de maintenance. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |
| `backup_file` | `backup.sql` | Déclaré pour la mise en miroir de la Fondation uniquement ; le nom de fichier de restauration réel provient de `backup_uri` (groupe 7) via `backup_source`/`backup_format`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, `initial_delay=15s`, `failure_threshold=10` | Pas de point de terminaison de santé dédié — Cloudreve sert `/` une fois prêt. |
| `liveness_probe` | HTTP `GET /`, `initial_delay=30s`, `period=30s` | Même point de terminaison que la sonde de démarrage. |
| `startup_probe_config` | HTTP `/`, activé | Sonde structurée alternative ; le `startup_probe` par application ci-dessus est celui qui est réellement câblé via `Cloudreve_Common`. |
| `health_check_config` | HTTP `/`, activé | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité de Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 15 — Réseau {#group-15--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` (auto-découverte) | Déclaré pour la mise en miroir de la Fondation uniquement ; **non transmis** dans `main.tf` — le module auto-découvre toujours le VPC unique géré par Services_GCP. |

### Groupe 23 — Contrôles de service VPC et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `organization_id` | `""` | Remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `cloudreve_url` | URL de l'interface utilisateur web de Cloudreve (port 5212). L'accessibilité dépend de `ingress_settings` ; `internal` la restreint au même VPC. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket `storage`. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (Cloudreve n'en injecte aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Notez que, contrairement à la plupart des modules d'application, il n'y a
**pas de sorties `database_*`** — Cloudreve n'a pas d'instance Cloud SQL à
décrire.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification —
> IAP sans identités autorisées, un runtime `gen1` avec le montage GCS
> Fuse requis, un `container_port`/`backup_retention_days`/`secret_propagation_delay` hors
> plage. Une configuration invalide fait échouer le **plan** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_nfs` (persistance à `/cloudreve`) | `true` | Critique | Le désactiver revient à un montage GCS FUSE, qui ne peut pas héberger la base de données SQLite de Cloudreve : les écritures de journal échouent et une instance peut ne pas démarrer. Pour un périphérique de bloc, utilisez `Cloudreve_GKE`. |
| Déplacement binaire du Dockerfile (`/usr/local/bin/cloudreve`) | Conserver tel quel | Critique | Revenir à `ENTRYPOINT ["./cloudreve"]` à l'intérieur de `/cloudreve` réintroduit l'occultation de volume : le montage de volume `/cloudreve` masque le binaire et le conteneur entre en boucle de crash avec `exec ./cloudreve: no such file or directory`. |
| `max_instance_count` | `1` | Critique | Cloudreve n'a pas de mode multi-nœuds/clustering vérifié dans ce module ; la mise à l'échelle au-delà de 1 risque des rédacteurs concurrents sur le même fichier SQLite. |
| Récupération du mot de passe administrateur | Capturer depuis `gcloud run services logs read` immédiatement après le premier démarrage | Élevé | Le mot de passe administrateur généré n'est imprimé qu'une seule fois dans les journaux du conteneur ; le manquer vous bloque l'accès au compte super-administrateur de première exécution jusqu'à ce que vous trouviez un autre chemin de récupération. |
| `container_port` | `5212` | Élevé | Le binaire de Cloudreve écoute sur un port par défaut fixe sans câblage env/CLI pour le modifier dans ce module ; la modification de la variable ne modifie que la cible de routage de Cloud Run, rompant la connectivité. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid pendant que Cloudreve recharge son index à partir du volume monté, et augmente le risque d'instances froides/chaudes qui se chevauchent touchant momentanément le même fichier SQLite pendant un déploiement. |
| `ingress_settings` | `all` | Moyen | La définition à `internal` bloque l'accès direct à l'interface utilisateur web, sauf si elle est précédée d'un équilibreur de charge ou accessible depuis le VPC. |
| `enable_iap` | Optionnel | Faible–Moyen | IAP ajoute une passerelle d'identité Google devant la propre connexion de Cloudreve ; sans elle, la propre authentification de Cloudreve est la seule barrière à l'internet public. |
| `database_type` / autres `db_*` / variables `sql_*` | Laisser les valeurs par défaut | Faible | Cloudreve n'a pas de base de données SQL — toute valeur ici est une opération nulle, puisque `database_type` est fixé à `NONE` par `Cloudreve_Common`. |
| `enable_redis` | Laisser la valeur par défaut | Faible | Forcé à `false` dans `main.tf` quelle que soit la valeur de la variable — Cloudreve n'utilise pas Redis. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Cloudreve partagée avec la variante GKE se trouve
dans le module `Cloudreve_Common` (`modules/Cloudreve_Common`) ; un guide
`Cloudreve_Common.md` dédié n'existe pas encore dans cet ensemble de
documentation — voir aussi **[Cloudreve_GKE](Cloudreve_GKE.md)** pour
l'alternative de production basée sur PVC de bloc.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Cloudreve sur Cloud Run](../labs/Cloudreve_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Cloudreve sur GKE Autopilot](Cloudreve_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Cloudreve Common — Configuration d'application partagée](Cloudreve_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md), [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md) dans la solution **Partage et transfert de fichiers**.
