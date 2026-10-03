---
title: "Jellyfin sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Jellyfin sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Jellyfin_CloudRun.md @ 15fd4c7 sha256:740d4d121fbe -->

# Jellyfin sur Google Cloud Run {#jellyfin-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellyfin_CloudRun.png" alt="Jellyfin sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Jellyfin est un serveur multimédia auto-hébergé gratuit et open-source (GPLv2)
pour diffuser vos propres films, émissions de télévision, musique, photos et
télévision en direct. Écrit en .NET/C# et maintenu comme un fork communautaire
d'Emby, il n'a pas de suivi, pas de publicités et pas de niveau premium. Ce
module déploie Jellyfin sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud que Jellyfin utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Jellyfin s'exécute comme un conteneur .NET unique sur Cloud Run v2. Le
déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur multimédia .NET, 1 vCPU / 1 GiB par défaut, épinglé à une seule instance chaude |
| Persistance | Cloud Filestore (NFS) | Le répertoire `/config` (bases de données SQLite, métadonnées, plugins) est sur le partage NFS par défaut ; GCS FUSE uniquement si NFS est désactivé |
| Base de données | SQLite interne (embarquée) | Pas de Cloud SQL — Jellyfin conserve tout l'état dans des fichiers SQLite sous `/config` |
| Secrets | Secret Manager | Clé API auto-générée facultative ; pas de secrets cryptographiques obligatoires |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | `internal` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Livraison d'images | Artifact Registry | L'image `jellyfin/jellyfin` est mise en miroir avant le déploiement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Jellyfin stocke l'intégralité de
  sa bibliothèque — les bases de données SQLite, le XML de configuration, les
  métadonnées, les illustrations, les plugins, le cache de transcodage et les
  journaux — sous un seul répertoire `/config`. Aucune instance Cloud SQL, aucun
  job `db-init` et aucun Redis ne sont provisionnés (`database_type = NONE`).
- **`/config` doit persister entre les révisions.** Sur Cloud Run, le chemin
  `/config` est sauvegardé par le volume **NFS** partagé (`enable_nfs = true`, `nfs_mount_path = /config`).
  Gardez NFS activé : s'il est désactivé, `/config` revient à un bucket GCS FUSE,
  qui ne peut pas héberger SQLite (pas de verrouillage POSIX). Sans un
  répertoire `/config` persistant, chaque nouvelle révision démarre avec une
  bibliothèque vide et réexécute l'assistant de première exécution.
- **Le conteneur écoute sur le port 8096.** Cloud Run achemine le trafic HTTP
  vers le port web/API par défaut de Jellyfin. L'interface utilisateur web et
  l'assistant de configuration de première exécution sont servis à `/web` (et
  `/`) ; `GET /health` renvoie `Healthy` (200, non authentifié).
- **Il n'y a pas de identifiants par défaut.** Lors du premier accès,
  l'assistant de configuration vous guide pour créer le compte
  administrateur et ajouter des bibliothèques multimédias. Rien n'est
  utilisable tant que ce compte n'existe pas.
- **Une seule instance chaude est la valeur par défaut.** `min_instance_count = 1` maintient le
  serveur multimédia chaud (évitant la latence de démarrage à froid en cours de
  diffusion) et `max_instance_count = 1` maintient une seule bibliothèque SQLite partagée sur un
  seul volume. **Ne pas exécuter plusieurs réplicas** — les écritures
  concurrentes sur un seul fichier SQLite corrompent la bibliothèque.
- **Cloud Run est idéal pour une utilisation légère/de démonstration.** La
  latence du stockage réseau et le modèle d'exécution sans état et à délai
  d'attente de requête de Cloud Run rendent cette variante bien adaptée à
  l'évaluation et à une utilisation personnelle légère — mais **pas** au
  transcodage intensif ou à de nombreux flux simultanés. Pour une véritable
  bibliothèque multimédia, déployez [Jellyfin_GKE](Jellyfin_GKE.md) avec un PVC
  de bloc.
- **L'authentification par clé API est facultative et désactivée par défaut.**
  `enable_api_key = false`. L'authentification principale est le compte administrateur créé par
  l'assistant ; les clés API par application sont créées dans l'application
  sous **Tableau de bord → Clés API**.

> **Cloud Run vs GKE — choisissez le bon emplacement pour votre bibliothèque.**
> **Cloud Run (ce module)** monte `/config` à partir du volume NFS partagé. Il est
> simple, évolue vers une seule instance chaude et est idéal pour une
> démonstration ou une petite bibliothèque personnelle avec une diffusion
> occasionnelle en lecture directe. La latence du stockage réseau et le modèle
> de délai d'attente par requête le rendent peu adapté au transcodage en direct
> ou à la diffusion multi-utilisateur intensive. **[Jellyfin_GKE](Jellyfin_GKE.md)**
> s'exécute en tant que StatefulSet avec un véritable **PVC de bloc** à `/config`,
> offrant une sémantique de système de fichiers correcte pour SQLite et le
> cache de transcodage — le choix recommandé pour un serveur multimédia de
> production, avec NFS facultatif pour les grandes bibliothèques multimédias.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Jellyfin {#a-cloud-run--the-jellyfin-service}

Jellyfin s'exécute comme un service Cloud Run v2. Étant donné que la
bibliothèque est un seul magasin SQLite sur un seul volume, le service est
épinglé à une seule instance plutôt que d'être mis à l'échelle
automatiquement. Chaque déploiement crée une révision immuable ; le trafic peut
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

### B. Stockage de configuration persistant (SQLite sur `/config`) {#b-persistent-configuration-store-sqlite-on-config}

Jellyfin n'a **pas de base de données externe**. Tout son état — la
bibliothèque SQLite et les bases de données de lecture, le XML de
configuration, les métadonnées et les illustrations mises en cache, les plugins
installés, le cache de transcodage et les journaux — se trouve sous `/config`
(`JELLYFIN_CONFIG_DIR = /config`). Il n'y a pas d'instance Cloud SQL, pas de proxy d'authentification
et pas de job d'initialisation pour créer un schéma ; Jellyfin crée et migre
ses propres bases de données SQLite au premier démarrage.

Parce que tout ce qui est important est un fichier sous `/config`, la persistance
de ce répertoire **est** la persistance de l'ensemble du serveur. Sur Cloud
Run, il est sauvegardé par le partage NFS (`enable_nfs = true`, la valeur par défaut).

- **Inspecter la configuration montée sur la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — le bucket `/config` {#c-cloud-storage--the-config-bucket}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Il est monté à `/config` via **GCS FUSE** uniquement lorsque
`enable_nfs = false` — avec NFS activé (la valeur par défaut), le partage NFS contient
`/config` à la place, car deux volumes ne peuvent pas partager un chemin de montage
et GCS FUSE ne peut pas héberger SQLite. Le bucket est de classe `STANDARD`,
`force_destroy = true`, sans versioning, avec `public_access_prevention = enforced`. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS FUSE et
CMEK.

### D. Configuration initiale et bibliothèque multimédia {#d-first-run-setup--the-media-library}

Lors du premier accès, Jellyfin propose un **assistant de configuration**
interactif à `/web` (et `/`) qui crée le compte administrateur, définit la
langue préférée et vous permet d'ajouter des bibliothèques multimédias (films,
séries télévisées, musique, photos). Rien n'est authentifié ou utilisable tant
que vous n'avez pas terminé l'assistant — il n'y a pas d'identifiants par
défaut.

Les bibliothèques multimédias pointent vers des chemins à l'intérieur du
conteneur. Sur Cloud Run, les médias sont servis à partir du volume `/config` monté
ou de montages GCS FUSE supplémentaires ; pour les grandes bibliothèques
multimédias, préférez la variante GKE avec stockage de bloc ou NFS.

- **Accéder à l'assistant / à l'interface utilisateur web :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  # open <url>/web in a browser (requires ingress=all or an LB/IAP path)
  ```

### E. Secret Manager et la clé API facultative {#e-secret-manager--the-optional-api-key}

Jellyfin ne nécessite **aucun secret cryptographique obligatoire** — il n'y a
pas de clé de chiffrement, de JWT ou de mot de passe maître à gérer. Lorsque
`enable_api_key = true`, le module génère une valeur aléatoire de 32 caractères et la stocke
dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key`. **Bug connu :** la sortie `Jellyfin_Common` de
`secret_ids` mappe cette valeur à la clé de variable d'environnement `QDRANT__SERVICE__API_KEY` — un
vestige de copier-coller du module Qdrant_Common dont le module Jellyfin a été
cloné — et `Jellyfin_CloudRun` la transmet inchangée via `module_secret_env_vars`. Jellyfin n'a aucun mécanisme
pour lire une clé API à partir d'une variable d'environnement (son Dockerfile
est un wrapper mince non modifié sans point d'entrée personnalisé pour en
consommer une), donc aujourd'hui `enable_api_key = true` ne crée qu'un secret Secret Manager
orphelin — il ne permet **pas** aux appelants externes de s'authentifier. La
seule façon d'obtenir une clé API utilisable est dans l'application sous
**Tableau de bord → Clés API** ; l'authentification principale reste le compte
administrateur de l'assistant.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut `ingress_settings = "internal"`, le service n'est donc accessible que depuis le VPC —
approprié pour un serveur multimédia privé. Définissez `ingress_settings = "all"` pour une URL
publique `run.app`, ou superposez un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor. Le contrôle de l'égression VPC
gouverne la connectivité sortante.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Jellyfin {#3-jellyfin-application-behaviour}

- **Pas de job d'initialisation.** Jellyfin n'a pas besoin d'étape `db-init` — il
  crée et migre ses propres bases de données SQLite sous `/config` la première
  fois qu'il démarre. Laissez `initialization_jobs` vide, sauf si vous avez des tâches de
  chargement de données personnalisées.
- **L'assistant de première exécution crée l'administrateur.** L'assistant de
  configuration `/web` vous guide pour créer le compte administrateur et ajouter
  des bibliothèques. Tant qu'il n'est pas terminé, le serveur n'a pas
  d'utilisateurs ni de contenu.
- **`/config` est la source unique de vérité — persistez-la.** Tout l'état de la
  bibliothèque se trouve sur le volume `/config` sauvegardé par NFS. Désactiver
  NFS déplace `/config` sur GCS FUSE, qui ne peut pas héberger SQLite ; la
  suppression du partage efface l'ensemble du serveur, des plugins et des
  utilisateurs. Limitez Cloud Run à une utilisation légère/de démonstration et
  déplacez une vraie bibliothèque vers la variante GKE avec PVC de bloc.
- **L'image personnalisée est un wrapper mince.** Le Dockerfile est
  `ARG JELLYFIN_VERSION=10.10.3` / `FROM jellyfin/jellyfin:${JELLYFIN_VERSION}`, donc `image_source = "custom"` et la Fondation le met en miroir dans Artifact
  Registry (`enable_image_mirroring = true`). `application_version = "latest"` se résout en `10.10.3` épinglé via l'argument de build
  spécifique à l'application `JELLYFIN_VERSION` — il n'est **pas** écrasé par l'injection
  générique `APP_VERSION` de la Fondation.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `GET /health`,
  qui renvoie `Healthy` (200) sans authentification une fois le serveur prêt. La
  sonde de démarrage permet un délai initial de 15 secondes avec une fenêtre de
  nouvelle tentative généreuse ; la sonde de vivacité interroge toutes les 30
  secondes.
- **Le transcodage est gourmand en CPU et sans GPU.** Cloud Run n'a pas de GPU,
  alors préférez les clients de lecture directe. Augmentez `cpu_limit` pour le
  transcodage en direct et `memory_limit` pour les grandes bibliothèques.
- **Inspecter l'image et les montages de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Jellyfin sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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
| `application_name` | `jellyfin` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Jellyfin Media Server` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image Jellyfin ; `latest` épingle à `10.10.3` via l'argument de build `JELLYFIN_VERSION`. |
| `enable_api_key` | `false` | Générer une clé API aléatoire dans Secret Manager. Recommandé pour tout déploiement accessible en dehors du VPC. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmenter pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmenter pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Garder 1 pour rester chaud et éviter les démarrages à froid en cours de diffusion. |
| `max_instance_count` | `1` | **Garder à 1.** Une bibliothèque SQLite partagée sur un seul volume — ne jamais exécuter plusieurs réplicas. |
| `container_port` | `8096` | Port web/API de Jellyfin. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE et NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Jellyfin n'a pas de Cloud SQL — laisser `false`. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` uniquement pour HTTP/2 en clair. |
| `enable_image_mirroring` | `true` | Mettre en miroir `jellyfin/jellyfin` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Inerte dans ce module ; la fondation gère la rétention des révisions. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` maintient le serveur privé au sein du VPC ; définir `all` pour une URL publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Jellyfin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets injectés dans la révision. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC) du bucket `/config`. |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané `/config` lors du déploiement (`tar` par défaut). |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — **non applicable à Jellyfin** (pas de base de
données SQL) ; conservé pour la compatibilité de la fondation. Héberge également
`nfs_instance_name` / `nfs_instance_base_name` pour la découverte NFS.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket Jellyfin `/config` (créé automatiquement) et tout supplément. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Monte le volume NFS partagé à `/config`, qui contient les bases de données SQLite de Jellyfin. Gardez-le activé — s'il est désactivé, `/config` revient à GCS FUSE, qui ne peut pas héberger SQLite. |
| `nfs_mount_path` | `/config` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires (le bucket `/config` est ajouté automatiquement lorsque `enable_nfs = false`). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Jellyfin_Common — Jellyfin utilise SQLite embarqué, pas Cloud SQL. |
| `database_password_length` | `32` | Inerte ; transmis pour la compatibilité de la fondation. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Non applicable — pas de base de données SQL. |
| `db_*_env_var_name` / `service_url_env_var_name` | `""` | Alias de variables d'environnement supplémentaires facultatifs ; laisser vide pour Jellyfin. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jellyfin n'a pas besoin de job d'initialisation ; fournir uniquement pour les tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run facultatifs pour les tâches de maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s de délai | Sonde de démarrage ; `/health` renvoie 200 une fois prêt. |
| `liveness_probe` | HTTP `/health` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage structurée alternative. |
| `health_check_config` | HTTP `/health` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `jellyfin_url` | URL du service pour l'interface utilisateur web / API de Jellyfin (interne au VPC lorsque `ingress_settings = internal`). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/config`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour un déploiement Jellyfin par défaut). |
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
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> runtime `gen1` avec montages NFS/GCS, IAP sans identités autorisées, un
> `container_port`/`backup_retention_days`/`timeout_seconds` hors plage. Une configuration invalide échoue la
> **planification** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` (la valeur par défaut) | Critique | Le partage NFS contient `/config` — la bibliothèque SQLite, les utilisateurs et les métadonnées. Le désactiver déplace `/config` sur GCS FUSE, qui ne peut pas héberger SQLite ; la suppression du partage efface l'ensemble du serveur. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans un seul fichier SQLite et corrompent la bibliothèque. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne peut pas monter NFS ou GCS FUSE, donc `/config` ne persiste jamais. |
| `min_instance_count` | `1` | Élevé | Les démarrages à froid à l'échelle zéro interrompent les flux en cours et rechargent la bibliothèque. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Élevé | Trop peu de mémoire tue le serveur par manque de mémoire lors de la numérisation ou du transcodage d'une grande bibliothèque. |
| `cpu_limit` | `1000m` (augmenter pour le transcodage) | Élevé | Le transcodage en direct sur Cloud Run (pas de GPU) sature le CPU ; préférer la lecture directe. |
| Transcodage lourd / nombreux flux | Utiliser [Jellyfin_GKE](Jellyfin_GKE.md) | Élevé | La latence du stockage réseau et les délais d'attente des requêtes Cloud Run rendent Cloud Run peu adapté au streaming intensif. |
| `enable_api_key` | Laisser `false` ; non fonctionnel actuellement | Moyen | Le secret généré est injecté comme `QDRANT__SERVICE__API_KEY` (un vestige de copier-coller de Qdrant_Common) — Jellyfin ne le lit jamais, il ne crée donc qu'un secret Secret Manager orphelin. Créez plutôt des clés API dans l'application sous Tableau de bord → Clés API. |
| `ingress_settings` | `internal` sauf si public | Moyen | `all` expose le serveur multimédia à Internet — associez-le à IAP ou Cloud Armor. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer un instantané de bibliothèque plus ancien. |
| Assistant de première exécution | Terminer immédiatement | Moyen | Un serveur non configuré n'a pas d'administrateur ; quiconque y accède peut revendiquer le compte administrateur. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Jellyfin partagée avec la variante GKE est décrite
dans **[Jellyfin_Common](Jellyfin_Common.md)**. Pour un guide détaillé,
consultez le [lab Jellyfin_CloudRun](../labs/Jellyfin_CloudRun.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellyfin sur Cloud Run](../labs/Jellyfin_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellyfin Common — Configuration d'application partagée](Jellyfin_Common.md) — la configuration partagée par les deux cibles de déploiement.
