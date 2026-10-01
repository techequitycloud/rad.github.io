---
title: "PhotoPrism sur Google Cloud Run"
description: "Référence de configuration pour déployer PhotoPrism sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PhotoPrism_CloudRun.md @ 3055034 sha256:61a58c542749 -->

# PhotoPrism sur Google Cloud Run {#photoprism-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhotoPrism_CloudRun.png" alt="PhotoPrism sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PhotoPrism est une application auto-hébergée de gestion de photos et de vidéos
fondée sur l'IA : elle permet de parcourir, d'organiser et de partager une
médiathèque personnelle avec étiquetage automatique, reconnaissance faciale et
recherche plein texte/visuelle, le tout servi par un unique binaire Go doté
d'une base de données SQLite embarquée — sans moteur de base de données externe
ni processus worker distinct. Ce module déploie PhotoPrism sur **Cloud Run v2**
en mode **SQLite embarqué, adossé à GCS**, au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise PhotoPrism et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

PhotoPrism s'exécute sous la forme d'un conteneur à binaire Go unique sur Cloud
Run v2, épinglé à exactement une instance. Le déploiement assemble un ensemble
volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur à binaire Go sur le port 2342, 1 vCPU / 1 GiB par défaut ; **toujours une seule instance** (`min=1`, `max=1`) — pas de mise à l'échelle à zéro, pas de mise à l'échelle horizontale |
| Base de données | Aucune | SQLite embarqué (`PHOTOPRISM_DATABASE_DRIVER=sqlite`) — aucune instance Cloud SQL n'est provisionnée par défaut |
| Stockage persistant | Cloud Storage (GCS FUSE) | La **seule** couche de persistance de cette variante — tout le répertoire de données `/photoprism` (base SQLite, cache, originaux, imports) est monté depuis un unique bucket GCS via GCS FUSE |
| Secrets | Secret Manager | `PHOTOPRISM_ADMIN_PASSWORD` généré automatiquement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est jamais provisionnée par défaut.** `database_type` vaut
  `"NONE"` par défaut et `enable_cloudsql_volume` est codé en dur à `false` dans `main.tf` — PhotoPrism
  gère son propre fichier SQLite sous `/photoprism/storage`. Contrairement à la variante GKE
  (qui code en dur `database_type = "NONE"` sans condition), **ce module Cloud
  Run transmet toujours `var.database_type` au socle** — voir le piège
  décrit en §6 si vous la changez pour une autre valeur que `NONE`.
- **GCS FUSE est le seul mécanisme de persistance — il n'existe pas d'option de PVC
  bloc sur Cloud Run.** La description même du module l'énonce clairement : *« This module
  deploys PhotoPrism on Cloud Run in embedded SQLite mode with a GCS-backed data
  volume. For production media libraries requiring a durable block volume, use
  PhotoPrism_GKE (block PVC). »* Le modèle d'écriture et de cohérence de gcsfuse est plus faible
  que celui d'un véritable périphérique bloc pour les fichiers WAL/journal de SQLite ; c'est
  l'épinglage à une seule instance (ci-dessous) qui garantit la sécurité, et non une
  quelconque garantie de verrouillage fournie par gcsfuse lui-même.
- **Une seule instance, toujours.** `min_instance_count = 1` et `max_instance_count = 1`
  sont tous deux définis par défaut et décrits comme fixes — PhotoPrism sert une seule bibliothèque
  SQLite partagée depuis un seul volume accessible en écriture ; exécuter deux instances sur le même
  bucket monté via gcsfuse expose à une corruption de la base de données et de l'index.
- **Redis est forcé à off, quelle que soit la variable.** La valeur par défaut du socle
  App_CloudRun pour `enable_redis` est `true`, mais `main.tf` code en dur
  `enable_redis = false` sans condition — PhotoPrism n'a aucune intégration Redis et
  aucune variable `REDIS_HOST`/`REDIS_PORT` n'est jamais injectée.
- **Le mot de passe administrateur est généré automatiquement.** Un mot de passe de 24 caractères (sans
  caractères spéciaux) est créé et stocké dans Secret Manager, puis injecté comme
  variable d'environnement secrète `PHOTOPRISM_ADMIN_PASSWORD` ; le nom d'utilisateur est la simple
  variable `admin_username` (valeur par défaut `admin`).
- **Le build d'image personnalisé est un simple miroir, pas de la logique applicative.** Le build encapsule
  l'image amont `photoprism/photoprism` (`FROM photoprism/photoprism:${PHOTOPRISM_VERSION}`)
  afin que le socle puisse la mettre en miroir dans Artifact Registry ; l'ARG de build propre à l'application
  est `PHOTOPRISM_VERSION` (et non l'`APP_VERSION` générique), épinglé à `240915` lorsque
  `application_version = "latest"`.
- **L'environnement d'exécution `gen2` est obligatoire.** Les volumes GCS FUSE exigent
  `execution_environment = "gen2"` (valeur par défaut) ; passer à `gen1` casse complètement
  le montage du stockage.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux le point de terminaison
  non authentifié `GET /api/v1/status`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service PhotoPrism (instance unique) {#a-cloud-run--the-photoprism-service-single-instance}

PhotoPrism s'exécute comme un service Cloud Run v2 épinglé à exactement une instance
(`min_instance_count = max_instance_count = 1`) — il n'y a aucune plage d'autoscaling à
ajuster. Chaque déploiement crée une révision immuable ; le trafic peut toujours être réparti
entre révisions pour des déploiements progressifs, mais faire servir simultanément du trafic réel
par deux révisions expose à deux écrivains sur le même fichier SQLite monté via gcsfuse.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume persistant GCS FUSE {#b-cloud-storage--the-gcs-fuse-persistent-volume}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage` dans `storage_buckets`) est
provisionné automatiquement et monté dans le conteneur en tant que volume **GCS FUSE** sur
`/photoprism` (entrée `gcs_volumes` `name = "storage"`, `mount_path = "/photoprism"`,
en lecture-écriture). Ce montage unique couvre tout ce que PhotoPrism persiste :
`/photoprism/storage` (base de données SQLite + cache des miniatures), `/photoprism/originals`
(médias importés/indexés) et `/photoprism/import` (imports en attente). Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`, et des montages GCS FUSE supplémentaires via
`gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/photoprism/originals/   # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Un secret est généré automatiquement : le mot de passe administrateur de PhotoPrism
(`secret-<prefix>-photoprism-admin-password`), une chaîne aléatoire de 24 caractères sans
caractères spéciaux, injectée en tant que `PHOTOPRISM_ADMIN_PASSWORD`. Il n'y a pas de mot de passe
de base de données à gérer, puisqu'aucune instance Cloud SQL n'existe par défaut.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings =
"all"`), ce qui permet un accès direct à l'interface web. Un équilibreur de charge HTTPS externe
avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'ingress
et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run à Cloud Monitoring,
avec un test de disponibilité facultatif (désactivé par défaut) et des règles d'alerte personnalisées.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PhotoPrism {#3-photoprism-application-behaviour}

- **Aucun job d'initialisation/de création de base par défaut.** `initialization_jobs` vaut `[]` par défaut —
  il n'y a pas de base de données externe à amorcer. PhotoPrism crée et migre son
  propre schéma SQLite au premier démarrage, directement sur le volume monté via gcsfuse.
- **Organisation du stockage.** Tout l'état réside sous l'unique répertoire monté
  `/photoprism` : `PHOTOPRISM_STORAGE_PATH=/photoprism/storage` (base de données SQLite +
  cache), `PHOTOPRISM_ORIGINALS_PATH=/photoprism/originals` (médias importés/indexés),
  `PHOTOPRISM_IMPORT_PATH=/photoprism/import` (imports en attente).
- **Compte administrateur.** `PHOTOPRISM_ADMIN_USER` est la simple variable `admin_username`
  (valeur par défaut `admin`) ; `PHOTOPRISM_ADMIN_PASSWORD` est la valeur Secret
  Manager générée automatiquement, injectée comme variable d'environnement secrète. `PHOTOPRISM_AUTH_MODE = "password"`
  est défini explicitement. Récupérez le mot de passe dans Secret Manager avant la première connexion.
- **URL du site.** `PHOTOPRISM_SITE_URL` est vide par défaut — PhotoPrism le tolère
  et se rabat sur l'hôte de la requête, mais définissez `site_url` sur l'URL Cloud Run
  déployée pour que les liens absolus et les URL des miniatures soient générés correctement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `GET /api/v1/status`, un
  point de terminaison non authentifié qui renvoie 200 dès que le serveur HTTP est démarré et que
  l'index SQLite est prêt. La sonde de démarrage laisse environ 15s + 10×10s (~1 minute
  55 secondes) après le délai initial pour la création du schéma au premier démarrage et le préchauffage
  de l'index ; la sonde de vivacité revérifie toutes les 30 secondes avec un seuil de 3
  échecs.
- **Pas de mise à l'échelle horizontale, pas de coordination de file d'attente.** Comme tout l'état de
  l'application — base de données SQLite, index, cache des miniatures et originaux — réside sur un
  seul volume gcsfuse accessible en écriture, PhotoPrism doit s'exécuter en instance unique
  (`min_instance_count = max_instance_count = 1`) ; il n'existe aucune prise en charge de plusieurs
  écrivains.
- **Inspecter la configuration en cours et le stockage :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep PHOTOPRISM_
  gcloud run jobs list --project "$PROJECT" --region "$REGION"   # empty unless custom jobs were added
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à PhotoPrism ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `photoprism` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `PhotoPrism` | Nom lisible affiché dans la console. |
| `description` | `PhotoPrism — AI-powered photo management app` | Description du service. |
| `application_version` | `latest` | Tag de l'image `photoprism/photoprism` utilisé comme base du build personnalisé ; `latest` est épinglé à un tag éprouvé (`240915`) au moment du build. |
| `admin_username` | `admin` | Nom d'utilisateur du compte administrateur initial (`PHOTOPRISM_ADMIN_USER`) ; le mot de passe est généré séparément. |
| `site_url` | `""` | URL publique du site (`PHOTOPRISM_SITE_URL`). Vide, elle se rabat sur l'hôte de la requête ; définissez-la dès que l'URL Cloud Run est connue pour obtenir des liens absolus corrects. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | « PhotoPrism loads vector indexes into memory; size this based on your collections. » 2Gi est le minimum qui permet de conserver la reconnaissance faciale et la prise en charge RAW — la valeur de base de `PhotoPrism_Common` est `4Gi` pour de véritables charges d'indexation sur de grandes bibliothèques. |
| `min_instance_count` | `1` | Fixé à 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | **Conservez 1** — une seule instance PhotoPrism pour garantir la cohérence des données. |
| `container_port` | `2342` | Port du serveur HTTP de PhotoPrism. |
| `execution_environment` | `gen2` | **Obligatoire** — les volumes GCS FUSE ne fonctionnent qu'en gen2. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Également codé en dur à `false` dans `main.tf`, quelle que soit cette variable — PhotoPrism n'a pas de Cloud SQL. |
| `container_protocol` | `http1` | HTTP/1.1 suffit ; PhotoPrism n'a pas besoin de `h2c`. |
| `enable_image_mirroring` | `true` | Met en miroir dans Artifact Registry l'image construite à partir de `photoprism/photoprism`. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec la convention ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet un accès direct à l'interface web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google devant l'interface. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par ex. réglages `PHOTOPRISM_*` additionnels). Ne définissez pas `PHOTOPRISM_ADMIN_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` | `false` | Restaure une sauvegarde lors du déploiement. |
| `backup_source` | `gcs` | `gcs` ou `gdrive`. |
| `backup_uri` | `""` | Emplacement de la sauvegarde ; utilisé uniquement lorsque `enable_backup_import = true`. |
| `backup_format` | `tar` | PhotoPrism n'ayant pas de base de données SQL, une restauration de sauvegarde est une archive du système de fichiers du bucket de médias/bibliothèque, et non un dump de base de données — gardez un format d'archive de fichiers (`tar`/`zip`/etc.), pas `sql`. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Sans objet — PhotoPrism n'a pas de base de données SQL. |
| `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | _(vide)_ | Sans objet pour PhotoPrism. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | Découverte facultative d'une VM NFS préexistante/intégrée. Transmises mais inutilisées par défaut — PhotoPrism s'appuie sur le volume GCS FUSE, et non sur NFS, pour la persistance (`enable_nfs = false`). |

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS — prudence avec la mise en cache des réponses photo/médias si vous l'activez. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis {#group-11--storage-filesystem--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` provisionné automatiquement, ainsi que ceux de `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires, en plus du bucket de données PhotoPrism provisionné automatiquement. |
| `enable_nfs` | `false` | Désactivé par défaut et inutile — le volume GCS FUSE est le stockage principal de PhotoPrism sur cette variante. |
| `nfs_mount_path` | `/mnt/nfs` | Sans effet sauf si `enable_nfs = true`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le volume PhotoPrism `storage` sur `/photoprism` est ajouté automatiquement par `PhotoPrism_Common`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (valeur par défaut de la variable) → **forcé à `false`** | `main.tf` code en dur `enable_redis = false` quelle que soit cette valeur — PhotoPrism n'a aucune intégration Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Sans effet — jamais injectées, puisque Redis est forcé à off. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | PhotoPrism n'utilise aucune base de données SQL. Contrairement à la variante GKE, **cette valeur est toujours transmise au socle** — voir le piège décrit en §6 avant de la modifier. |
| `database_password_length` | `32` | Sans effet — aucun mot de passe de base de données n'est jamais généré tant que `database_type = NONE`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation intégré — PhotoPrism amorce lui-même son schéma SQLite. N'ajoutez des jobs personnalisés que pour des tâches spécifiques de chargement de données ou de maintenance. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut (vous pourriez par exemple en ajouter une pour des instantanés périodiques de la bibliothèque). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/status`, délai de 15s, période de 10s, seuil de 10 échecs | Sonde de démarrage principale (fenêtre d'environ 1m55s après le délai). |
| `liveness_probe` | HTTP `/api/v1/status`, délai de 30s, période de 30s, seuil de 3 échecs | Sonde de vivacité principale. |
| `startup_probe_config` | `enabled = true`, chemin `/api/v1/status` | Interface alternative structurée pour la sonde de démarrage. {/* TODO: verify precedence against `startup_probe` if both are set to conflicting values — unlike some sibling modules this alternative surface defaults `enabled = true` here, not disabled. */} |
| `health_check_config` | `enabled = true`, chemin `/api/v1/status` | Interface alternative structurée pour la sonde de vivacité (même réserve de priorité que ci-dessus). |
| `uptime_check_config` | `{ enabled = false, path = "/api/v1/status" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `organization_id` | `""` | Valeur de remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en fonctionnement.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `photoprism_url` | URL du service Cloud Run. La description propre de la sortie la présente comme une « internal VPC URL … only reachable within the same VPC when ingress_settings is 'internal' » — mais `ingress_settings` vaut `all` (public) par défaut ; vérifiez l'accessibilité réelle du service déployé par rapport à votre propre valeur d'`ingress_settings` plutôt que de vous fier au nom de la sortie. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés, y compris le bucket GCS FUSE `storage` de PhotoPrism. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation personnalisés (vide par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

Notez qu'il n'y a aucune sortie `database_*` — aucune instance Cloud SQL n'est provisionnée par
défaut (contrairement aux modules de type Activepieces/BookStack).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages GCS Fuse, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` / `min_instance_count` | `1` / `1` | Critical | Dépasser 1 donne à deux instances une unique base de données SQLite accessible en écriture et montée via gcsfuse — risque de corruption et de contention de verrous, pire qu'avec un PVC bloc, car le modèle de cohérence de gcsfuse est plus faible. |
| `execution_environment` | `gen2` | Critical | `gen1` ne peut pas monter de volumes GCS FUSE — tout le répertoire de données `/photoprism` (base, médias) ne parvient pas à s'attacher et l'application ne peut pas démarrer. |
| `database_type` | `NONE` | Medium | Contrairement à `PhotoPrism_GKE` (qui code `NONE` en dur), ce module transmet toujours la variable au socle. La définir sur `MYSQL`/`POSTGRES` provisionne une véritable instance Cloud SQL facturée que `PhotoPrism_Common` ne raccorde jamais à l'application (aucune variable `DB_HOST`/`DB_USER` n'est consommée) — un coût inutile sans aucun bénéfice fonctionnel. |
| `enable_redis` | Forcé à `false` dans `main.tf` | Low | Aucune action requise — le forçage est intentionnel et ne peut pas être contourné en définissant la variable sur `true`. |
| `enable_cloudsql_volume` | `false` (par défaut et codé en dur) | Low | Ne peut pas être activé, même en définissant la variable — à titre informatif uniquement. |
| `memory_limit` | `2Gi` par défaut — à augmenter pour de vraies bibliothèques | High | La valeur de base de `PhotoPrism_Common` est `4Gi` pour les charges d'indexation et de reconnaissance faciale ; 2Gi est le plancher qui maintient ces fonctionnalités actives, mais peut tout de même entraîner des arrêts OOM dès qu'une bibliothèque contient un volume significatif de photos/vidéos. |
| `PHOTOPRISM_ADMIN_PASSWORD` (généré automatiquement) | À récupérer avant la première connexion | Medium | Ne pas le connaître vous bloque hors du premier compte administrateur jusqu'à sa réinitialisation via la base de données. |
| `site_url` | À définir sur l'URL Cloud Run déployée dès qu'elle est connue | Medium | Laissée vide, PhotoPrism se rabat sur l'hôte de la requête ; les liens absolus et les URL des miniatures peuvent être erronés derrière un équilibreur de charge ou un domaine personnalisé. |
| `ingress_settings` | `all` pour un accès direct à l'interface web | Medium | La valeur `internal` bloque l'accès à l'interface depuis le navigateur, sauf via un client connecté au VPC ou un équilibreur de charge interne. |
| `backup_format` | Un format d'archive de fichiers (`tar`, `zip`, …), pas `sql` | Medium | PhotoPrism n'a pas de base de données SQL — un `backup_uri` pointant vers un dump de base de données n'a aucun sens pour cette application ; les sauvegardes doivent cibler le contenu du bucket de médias/bibliothèque. |
| `enable_nfs` | `false` | Low | Valeur par défaut correcte — PhotoPrism n'a pas besoin de NFS, puisque le volume GCS FUSE est son stockage principal ; l'activer ajoute un coût sans bénéfice, sauf si des jobs personnalisés ont besoin d'un accès à un système de fichiers partagé. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | à activer en production | Medium | L'interface web publique et la connexion administrateur sont accessibles sans protection WAF par défaut. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à PhotoPrism
partagée avec la variante GKE — l'identifiant administrateur, le moteur de base de données SQLite
embarqué, l'organisation du stockage, le build du conteneur et les sondes de santé
par défaut — est décrite dans **[PhotoPrism_Common](PhotoPrism_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhotoPrism sur Cloud Run](../labs/PhotoPrism_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [PhotoPrism sur GKE Autopilot](PhotoPrism_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [PhotoPrism Common — Configuration applicative partagée](PhotoPrism_Common.md) — la configuration partagée par les deux cibles de déploiement.
