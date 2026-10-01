---
title: "Cloudreve sur Google Cloud Run"
description: "Référence de configuration pour déployer Cloudreve sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Cloudreve_CloudRun.md @ 3055034 sha256:e2f16c8265c6 -->

# Cloudreve sur Google Cloud Run {#cloudreve-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Cloudreve_CloudRun.png" alt="Cloudreve sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cloudreve est une plateforme populaire, open source et auto-hébergée, de stockage
cloud et de partage de fichiers, écrite en Go. Elle fournit une interface web pour
téléverser, organiser, prévisualiser et partager des fichiers, avec des backends de
stockage interchangeables. Ce module déploie Cloudreve sur **Cloud Run v2** au-dessus
du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Cloudreve et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cloudreve s'exécute comme un unique binaire Go qui sert à la fois l'interface web et
l'API de stockage de fichiers. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go sur le port 5212, instance unique par défaut (`min = max = 1`) |
| Persistance | Cloud Storage, monté via GCS FUSE | Monté sur `/cloudreve` ; contient la base SQLite intégrée, le `conf.ini` généré et les fichiers téléversés. C'est la **seule** option de persistance sur Cloud Run — il n'existe aucun équivalent en volume bloc au PVC de GKE |
| Stockage objet | Cloud Storage | Le même bucket `storage` sert aussi de volume de données monté via GCS FUSE |
| Base de données | Aucune | Cloudreve utilise une base SQLite intégrée sur le volume monté — aucune instance Cloud SQL n'est créée |
| Secrets | Secret Manager | Aucun n'est créé — le mot de passe administrateur du premier démarrage est généré par Cloudreve lui-même et affiché dans les journaux du conteneur |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL.** `database_type` est fixé à `NONE` par
  `Cloudreve_Common` ; chaque variable liée à Cloud SQL n'est transmise au socle que
  pour la compatibilité d'interface et n'a aucun effet.
- **GCS FUSE est le mécanisme de persistance par nécessité, non par choix.** Cloud
  Run n'offre aucune option de volume bloc ; le bucket `storage` créé automatiquement
  est donc toujours monté via GCS FUSE sur `/cloudreve` (`enable_gcs_storage_volume =
  true` dans `Cloudreve_Common` ; ce réglage n'est pas exposé comme variable de
  `Cloudreve_CloudRun`). Le `module_description` du module signale explicitement ce
  compromis : *"Cloudreve is a stateful single-writer datastore — for
  production use prefer Cloudreve_GKE, which mounts a block Persistent Volume
  (gcsfuse corrupts the embedded SQLite DB)."*
- **La cohabitation binaire/données est traitée lors du build de l'image.** L'image
  amont `cloudreve/cloudreve` conserve à la fois le binaire `cloudreve` et ses
  données dans `/cloudreve`. Le Dockerfile de ce module déplace le binaire vers
  `/usr/local/bin/cloudreve` dans un build multi-étapes (`ENTRYPOINT
  ["/usr/local/bin/cloudreve"]`, `WORKDIR /cloudreve`), de sorte que monter le volume
  GCS FUSE sur `/cloudreve` ne masque que les fichiers de données, jamais le binaire.
  Voir la [section 3](#3-cloudreve-application-behaviour).
- **Pas de Cloud SQL, pas de Redis.** `enable_cloudsql_volume` vaut `false` par
  défaut et `enable_redis` est explicitement forcé à `false` dans `main.tf`, quelle
  que soit la valeur de la variable.
- **Aucun secret administrateur injectable.** Cloudreve génère son propre mot de
  passe administrateur initial au premier démarrage et l'affiche dans les journaux du
  conteneur — aucun secret Secret Manager n'est créé ; `secret_ids`/`secret_values`
  de `Cloudreve_Common` sont des maps vides.
- **Instance unique par défaut.** `min_instance_count = max_instance_count =
  1`, ce qui correspond à l'absence de prise en charge du clustering distribué/
  multi-nœud par Cloudreve et évite des écrivains concurrents sur l'unique fichier
  SQLite monté.
- **`container_port` vaut `5212` par défaut** et est réellement transmis à la
  configuration effective par application (contrairement à certaines autres variables
  de transmission de ce module) — mais le modifier ne change **pas** le port sur
  lequel le binaire Cloudreve écoute en interne, puisqu'aucune variable
  d'environnement ni option CLI ne relie ce port au conteneur. Laissez la valeur par
  défaut.
- **L'entrée publique est activée par défaut** (`ingress_settings = "all"`) afin que
  l'interface web soit directement accessible à l'URL Cloud Run.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Cloudreve {#a-cloud-run--the-cloudreve-service}

Cloudreve s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre révisions pour des mises en
production sûres. Avec la valeur par défaut
`min_instance_count = max_instance_count = 1`, une seule instance sert tout le
trafic à tout moment.

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

### B. Cloud Storage (persistance GCS FUSE) {#b-cloud-storage-gcs-fuse-persistence}

La base SQLite intégrée de Cloudreve (`cloudreve.db`), le `conf.ini` généré et les
fichiers téléversés résident tous sous `/cloudreve`, le répertoire de travail du
conteneur. Un bucket Cloud Storage `storage` dédié est créé automatiquement par
`Cloudreve_Common` et monté dans le conteneur comme volume **GCS FUSE** à cet
emplacement — Cloud Run n'a aucun équivalent en volume bloc à un PVC GKE ; c'est donc
le seul moyen de conserver l'état entre les révisions et lors de la mise à zéro.

- **Console :** Cloud Storage → Buckets → filtrez sur le suffixe `storage` du
  déploiement.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/
  ```

Le modèle de cohérence de gcsfuse étant plus faible que celui d'un véritable
périphérique bloc, exécuter plus d'une instance (`max_instance_count > 1`) expose à
une corruption du fichier SQLite intégré — voir la [section 6](#6-configuration-pitfalls--sensible-defaults).
Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager pour Cloudreve lui-même —
le mot de passe administrateur du premier démarrage est généré en interne par
Cloudreve et affiché dans les journaux du conteneur au premier démarrage, sans être
stocké dans Secret Manager. Les secrets configurés via
`secret_environment_variables` restent injectés par le mécanisme Secret Manager
standard.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~cloudreve"
  gcloud logging read 'resource.type="cloud_run_revision"' --project "$PROJECT" --limit 200 | grep -i "admin\|password"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation (la rotation n'a ici aucun effet puisqu'aucun secret de service n'existe).

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`
(`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec domaine
personnalisé, Cloud CDN et Cloud Armor peut être ajouté via `enable_cloud_armor` ;
sinon, les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging — c'est aussi là qu'apparaît
le mot de passe administrateur généré au premier démarrage (voir la
[section 3](#3-cloudreve-application-behaviour)). Les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cloudreve {#3-cloudreve-application-behaviour}

- **Aucun job d'initialisation de base de données.** `Cloudreve_Common` n'injecte
  pas de job `db-init`/`db-create` par défaut — Cloudreve n'a aucune base SQL à
  provisionner. `initialization_jobs` n'exécute que les jobs que vous fournissez
  explicitement.
- **Auto-configuration au premier démarrage, mot de passe administrateur dans les
  journaux.** Au premier démarrage, Cloudreve crée son schéma SQLite sur le volume
  monté via GCS FUSE et génère le compte administrateur initial, en affichant le mot
  de passe généré dans les journaux du conteneur. Il n'existe ni étape de migration
  distincte ni secret Secret Manager depuis lequel le récupérer — capturez-le avec
  `gcloud run services logs read` (ou `gcloud logging read`) avant la rotation du
  tampon de journaux, puis changez-le via l'interface web.
- **Le masquage par volume est corrigé à l'avance dans le Dockerfile.** Sans le
  déplacement décrit à la [section 1](#1-overview), le montage GCS FUSE sur
  `/cloudreve` masquerait le binaire qui y cohabite, produisant `exec ./cloudreve: no such
  file or directory` (boucle de plantage). Il s'agit d'un module à **build
  personnalisé** (`container_image_source = "custom"`, `image_source = "custom"` dans
  `Cloudreve_Common`) précisément pour que ce correctif
  (`modules/Cloudreve_Common/scripts/Dockerfile`) soit intégré à l'image — ce n'est
  pas une simple reprise de l'image amont. Modifier le Dockerfile exige un nouveau
  build (`tofu taint
  'module.app_cloudrun.module.app_build.null_resource.build_and_push_application_image[0]'`
  si un déclencheur basé sur l'empreinte du contenu ne détecte pas le changement).
- **L'épinglage de version utilise un ARG de build propre à l'application.** Le
  Dockerfile lit `CLOUDREVE_VERSION` (épinglé à `3.8.3` lorsque `application_version =
  "latest"`), et non l'`APP_VERSION` générique que le socle injecte et qui forcerait
  sinon le tag introuvable `latest`.
- **Chemins des sondes de santé.** La sonde de démarrage est une sonde **HTTP** `GET /`
  (`initial_delay_seconds = 15`, `failure_threshold = 10`, soit jusqu'à ~100 s pour
  être prêt) ; la sonde de vivacité est aussi une sonde **HTTP** `GET /`
  (`initial_delay_seconds = 30`, `period_seconds = 30`). Cloudreve n'a pas de point de
  terminaison de santé distinct de son interface web — `/` renvoie 200 dès que le
  serveur répond.
- **Sémantique d'instance unique.** Avec `min_instance_count = max_instance_count
  = 1`, une seule instance sert le trafic ; n'augmentez pas `max_instance_count`
  sans avoir vérifié la prise en charge multi-nœud/clustering propre à Cloudreve (non
  gérée par ce module) — le fichier SQLite partagé monté via GCS FUSE n'offre aucune
  protection intégrée contre les écrivains concurrents.
- **`container_port` est transmis mais pas relié à l'application.** Le binaire
  Cloudreve écoute sur son propre port par défaut (5212), sans variable
  d'environnement ni option CLI dans le Dockerfile de ce module pour le changer ;
  modifier `container_port` ne change que la cible de routage de Cloud Run, il doit
  donc rester à la valeur par défaut.
- **Inspecter le service en cours d'exécution et l'exécution des jobs :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement (selon leurs tags `{{UIMeta group=N}}`). Seuls les paramètres propres à
Cloudreve ou notables pour lui sont listés ; toutes les autres entrées sont héritées
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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudreve` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Cloudreve` | Nom lisible affiché dans la console. |
| `description` | `Cloudreve — self-hosted cloud storage / file-sharing system` | Description du service. |
| `application_version` | `latest` | Tag de l'image `cloudreve/cloudreve` ; `latest` est épinglé à `3.8.3` au moment du build via l'ARG de build `CLOUDREVE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; dimensionnez-la pour la diffusion de fichiers et les transferts simultanés. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid pendant le chargement de l'index de Cloudreve. |
| `max_instance_count` | `1` | **Laissez à 1** — aucune prise en charge multi-nœud/clustering vérifiée, et un fichier SQLite partagé monté via GCS FUSE n'offre aucune protection contre les écrivains concurrents. |
| `container_port` | `5212` | Port HTTP par défaut de Cloudreve. Transmis à la configuration effective par application, mais non relié au port d'écoute du binaire — laissez la valeur par défaut. |
| `execution_environment` | `gen2` | Requis pour le montage GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Cloudreve n'a pas de base Cloud SQL — toujours `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Cloudreve dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des mises en production progressives. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` est disponible mais non requis par Cloudreve. |
| `service_annotations` / `service_labels` | `{}` | Annotations/libellés personnalisés sur la ressource de service Cloud Run. |
| `container_image` / `container_image_source` / `container_build_config` / `container_resources` / `cloudsql_volume_mount_path` / `max_revisions_to_retain` | _(divers)_ | Déclarées uniquement pour refléter les variables du socle — **non transmises** dans `main.tf`. L'image réelle, la configuration de build (chemin du Dockerfile, ARG de build `CLOUDREVE_VERSION`) et le dimensionnement des ressources sont fixés dans `Cloudreve_Common`. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public permettant d'atteindre directement l'interface web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google en amont de la page de connexion propre à Cloudreve. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets transmis tels quels au conteneur. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager (aucun secret de service n'existe à faire tourner par défaut). |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement (`backup_uri` est transmis à l'entrée `backup_file` du socle). |
| `additional_containers` / `additional_services` | `[]` | Déclarées uniquement pour refléter le socle ; Cloudreve n'utilise ni conteneurs sidecar ni services supplémentaires. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Scripts SQL personnalisés et sélection de l'instance NFS {#group-9--custom-sql-scripts--nfs-instance-selection}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Sans objet — Cloudreve n'a pas de base SQL. |
| `nfs_instance_name` / `nfs_instance_base_name` / `nfs_volume_name` | découverte automatique / `app-nfs` / `nfs-data-volume` | Pertinent uniquement si `enable_nfs = true` est activé séparément (désactivé par défaut ; Cloudreve n'a pas besoin de NFS). |

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets` ; conditionne aussi le bucket `storage` provisionné automatiquement. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket de données provisionné automatiquement. |
| `enable_nfs` | `false` | Désactivé par défaut — Cloudreve stocke son état sur le volume GCS FUSE, pas sur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé séparément. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires. Le bucket `storage` est toujours monté sur `/cloudreve` en plus des entrées indiquées ici (`enable_gcs_storage_volume = true`, fixé dans `Cloudreve_Common` et non exposé comme variable ici). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | Valeur par défaut d'App_CloudRun `true`, mais **forcée à `false`** dans `main.tf` | Cloudreve n'utilise pas Redis ; la valeur de la variable n'a aucun effet, quel que soit le réglage. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Cloudreve_Common` — Cloudreve n'a pas de base SQL. |
| `database_password_length` / `enable_auto_password_rotation` / `rotation_propagation_delay_sec` / `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` / `service_url_env_var_name` / `application_database_name` / `application_database_user` / `enable_mysql_plugins` / `mysql_plugins` / `enable_postgres_extensions` / `postgres_extensions` / `sql_instance_name` / `sql_instance_base_name` | _(divers)_ | Toutes déclarées uniquement pour refléter les variables du socle et **non transmises** dans `main.tf` — Cloudreve n'a aucune base de données à laquelle elles pourraient s'appliquer. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut n'est injecté — Cloudreve ne nécessite aucune configuration de base de données. Ne fournissez des jobs que pour un chargement de données personnalisé ou des tâches de maintenance. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |
| `backup_file` | `backup.sql` | Déclarée uniquement pour refléter le socle ; le nom de fichier de restauration réel provient de `backup_uri` (groupe 7) via `backup_source`/`backup_format`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, `initial_delay=15s`, `failure_threshold=10` | Aucun point de terminaison de santé dédié — Cloudreve sert `/` une fois prêt. |
| `liveness_probe` | HTTP `GET /`, `initial_delay=30s`, `period=30s` | Même point de terminaison que la sonde de démarrage. |
| `startup_probe_config` | HTTP `/`, activée | Sonde structurée alternative ; c'est la `startup_probe` par application ci-dessus qui est réellement transmise via `Cloudreve_Common`. |
| `health_check_config` | HTTP `/`, activée | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 15 — Réseau {#group-15--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `network_name` | `""` (découverte automatique) | Déclarée uniquement pour refléter le socle ; **non transmise** dans `main.tf` — le module découvre toujours automatiquement l'unique VPC géré par Services_GCP. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `organization_id` | `""` | Valeur de remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyés lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `cloudreve_url` | URL de l'interface web Cloudreve (port 5212). L'accessibilité dépend de `ingress_settings` ; `internal` la restreint au même VPC. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL de service propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket `storage` monté via GCS FUSE. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur (Cloudreve n'en injecte aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

Notez que, contrairement à la plupart des modules applicatifs, il n'existe **aucun
output `database_*`** — Cloudreve n'a pas d'instance Cloud SQL à décrire.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec le montage GCS Fuse requis, un `container_port`/`backup_retention_days`/`secret_propagation_delay` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Mécanisme de persistance (GCS FUSE sur `/cloudreve`) | Acceptez-le comme le compromis de Cloud Run ; utilisez `Cloudreve_GKE` pour la production | Critical | Le modèle de cohérence de gcsfuse est plus faible que celui d'un périphérique bloc ; la base SQLite intégrée risque d'être corrompue en cas d'accès concurrent. C'est une limitation architecturale documentée de la variante CloudRun, et non un bug à corriger ici. |
| Déplacement du binaire dans le Dockerfile (`/usr/local/bin/cloudreve`) | Conservez-le tel que livré | Critical | Revenir à `ENTRYPOINT ["./cloudreve"]` dans `/cloudreve` réintroduit le masquage par volume : le montage GCS FUSE cache le binaire et le conteneur plante en boucle avec `exec ./cloudreve: no such file or directory`. |
| `max_instance_count` | `1` | Critical | Cloudreve n'a pas de mode multi-nœud/clustering vérifié dans ce module ; dépasser 1 expose à des écrivains concurrents sur le même fichier SQLite monté via GCS FUSE, sans aucune garantie de verrouillage. |
| Récupération du mot de passe administrateur | Capturez-le depuis `gcloud run services logs read` immédiatement après le premier démarrage | High | Le mot de passe administrateur généré n'est affiché qu'une seule fois dans les journaux du conteneur ; le manquer vous empêche d'accéder au compte super-administrateur initial tant que vous n'avez pas trouvé une autre voie de récupération. |
| `container_port` | `5212` | High | Le binaire de Cloudreve écoute sur un port par défaut fixe, sans câblage par variable d'environnement ou CLI permettant de le changer dans ce module ; modifier la variable ne change que la cible de routage de Cloud Run, ce qui rompt la connectivité. |
| `min_instance_count` | `1` | Medium | La mise à zéro (`0`) ajoute une latence de démarrage à froid pendant que Cloudreve recharge son index depuis le volume GCS FUSE, et augmente le risque que des instances froides et chaudes accèdent brièvement en même temps au même fichier SQLite lors d'une mise en production. |
| `ingress_settings` | `all` | Medium | La valeur `internal` bloque l'accès direct à l'interface web, sauf derrière un équilibreur de charge ou depuis le VPC. |
| `enable_iap` | Facultatif | Low–Medium | IAP ajoute un contrôle d'identité Google en amont de la page de connexion de Cloudreve ; sans lui, l'authentification propre à Cloudreve est la seule barrière face à l'internet public. |
| `database_type` / autres variables `db_*` / `sql_*` | Laissez les valeurs par défaut | Low | Cloudreve n'a pas de base SQL — toute valeur ici est sans effet, puisque `database_type` est fixé à `NONE` par `Cloudreve_Common`. |
| `enable_redis` | Laissez la valeur par défaut | Low | Forcé à `false` dans `main.tf` quelle que soit la valeur de la variable — Cloudreve n'utilise pas Redis. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Cloudreve
et partagée avec la variante GKE se trouve dans le module `Cloudreve_Common`
(`modules/Cloudreve_Common`) ; un guide `Cloudreve_Common.md` dédié n'existe pas
encore dans cette documentation — voir aussi
**[Cloudreve_GKE](Cloudreve_GKE.md)** pour l'alternative de production reposant sur
un PVC bloc.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cloudreve sur Cloud Run](../labs/Cloudreve_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cloudreve sur GKE Autopilot](Cloudreve_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Cloudreve Common — Configuration applicative partagée](Cloudreve_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md), [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md) dans la solution **File Sharing & Transfer**.
