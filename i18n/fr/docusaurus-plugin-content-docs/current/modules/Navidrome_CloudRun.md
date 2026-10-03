---
title: "Navidrome sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Navidrome sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Navidrome_CloudRun.md @ 15fd4c7 sha256:8cdb529055cb -->

# Navidrome sur Google Cloud Run {#navidrome-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Navidrome_CloudRun.png" alt="Navidrome sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Navidrome est un serveur de streaming musical auto-hébergé, gratuit, open-source
(GPLv3), compatible Subsonic, écrit en Go. Il scanne une bibliothèque musicale,
la sert via une interface web rapide et utilise l'API Subsonic/OpenSubsonic
pour que tout client mobile ou de bureau compatible puisse en diffuser. Ce
module déploie Navidrome sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Navidrome et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Navidrome s'exécute comme un conteneur Go unique sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur musical Go, 1 vCPU / 1 GiB par défaut, épinglé à une seule instance chaude |
| Persistance | Cloud Filestore (NFS) | Le répertoire `/data` (base de données SQLite, cache de métadonnées, index de recherche) est un partage NFS |
| Base de données | SQLite interne (embarquée) | Pas de Cloud SQL — Navidrome conserve tout l'état dans un fichier SQLite sous `/data` |
| Secrets | Secret Manager | Mot de passe `admin` généré (`ND_DEVAUTOCREATEADMINPASSWORD`) lorsque `enable_admin_password = true` |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | `internal` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Livraison d'images | Artifact Registry | L'image `deluan/navidrome` est mise en miroir avant le déploiement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Navidrome stocke tout son état —
  la base de données SQLite, le cache de métadonnées et l'index de recherche —
  sous un seul répertoire `/data`. Aucune instance Cloud SQL, aucun job `db-init` et
  aucun Redis ne sont provisionnés (`database_type = NONE` ; `enable_redis = false`).
- **`/data` doit persister entre les révisions, sur NFS.** Cloud Run n'a pas de
  périphérique de bloc, et GCS FUSE ne peut pas héberger une base de données
  SQLite (pas de verrouillage POSIX ; il rejette les écritures désordonnées de
  SQLite). Ainsi, `enable_nfs = true` (par défaut) monte le volume NFS partagé à `/data`
  (`nfs_mount_path`), et le montage GCS FUSE du bucket `storage` y est désactivé
  lorsque NFS est activé. Sans un `/data` persistant, chaque nouvelle révision
  démarre avec une bibliothèque vide et réexécute le scan et la configuration
  du premier démarrage.
- **Le conteneur écoute sur le port 4533.** Cloud Run achemine le trafic HTTP
  vers le port web/API par défaut de Navidrome. `GET /ping` renvoie `{"status":"ok"}` (200, non
  authentifié) une fois le serveur démarré.
- **Un compte administrateur généré par défaut.** `enable_admin_password = true` génère un mot de passe
  aléatoire de 24 caractères, le stocke dans Secret Manager et l'injecte comme
  `ND_DEVAUTOCREATEADMINPASSWORD` afin que l'utilisateur `admin` soit automatiquement créé au premier
  démarrage. Récupérez-le de Secret Manager et modifiez-le après la première
  connexion. Définissez `enable_admin_password = false` pour créer le premier administrateur via
  l'assistant web à la place.
- **Une seule instance chaude est la valeur par défaut.** `min_instance_count = 1` maintient le
  serveur chaud (évitant la latence de démarrage à froid en cours de
  streaming) et `max_instance_count = 1` maintient une seule bibliothèque SQLite partagée sur un
  seul volume. **Ne pas exécuter plusieurs réplicas** — Navidrome est un
  serveur à écrivain unique ; des écrivains concurrents sur un seul fichier
  SQLite corrompent la bibliothèque.
- **La bibliothèque musicale n'est pas montée automatiquement.** `ND_MUSICFOLDER = /music` est
  défini, mais le module ne monte rien à cet endroit — fournissez la collection
  musicale via un montage `gcs_volumes` (ou NFS) à `/music`.
- **L'ingress public nécessite le mot de passe administrateur généré.** Une
  garde au moment de la planification rejette `ingress_settings = "all"` à moins que `enable_admin_password = true` —
  sinon l'assistant de première exécution est ouvert à quiconque atteint l'URL
  en premier.

> **Cloud Run vs GKE — choisissez le bon emplacement pour votre bibliothèque.**
> **Cloud Run (ce module)** monte `/data` depuis le volume NFS partagé. Il est
> simple, exécute une seule instance chaude et convient à une démo ou à une
> petite bibliothèque personnelle ; le stockage réseau est plus lent qu'un
> périphérique de bloc pour le répertoire `/data`, très dépendant de SQLite.
> **[Navidrome_GKE](Navidrome_GKE.md)** s'exécute comme un StatefulSet avec un
> véritable **PVC de bloc** à `/data`, offrant la sémantique de système de
> fichiers correcte dont la base de données SQLite embarquée a besoin — le
> choix recommandé pour une bibliothèque plus grande ou plus active, avec NFS
> facultatif pour une grande collection musicale.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Navidrome {#a-cloud-run--the-navidrome-service}

Navidrome s'exécute comme un service Cloud Run v2. Étant donné que la
bibliothèque est un magasin SQLite unique sur un seul volume, le service est
épinglé à une seule instance plutôt que mis à l'échelle automatiquement. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Stockage persistant (SQLite sur `/data`) {#b-persistent-data-store-sqlite-on-data}

Navidrome n'a **pas de base de données externe**. Tout son état — la base de
données SQLite, le cache de métadonnées et l'index de recherche — se trouve
sous `/data` (`ND_DATAFOLDER = /data`). Il n'y a pas d'instance Cloud SQL, pas de proxy d'auth,
et pas de job d'initialisation pour créer un schéma ; Navidrome crée et migre
sa propre base de données SQLite au premier démarrage.

Parce que tout ce qui est important est un fichier sous `/data`, la persistance
de ce répertoire **est** la persistance de l'ensemble du serveur. Sur Cloud
Run, il s'agit du partage NFS monté à `/data` (`enable_nfs = true`, `nfs_mount_path = "/data"`).

- **Inspecter le volume monté sur la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — le bucket `/data` (et la bibliothèque musicale) {#c-cloud-storage--the-data-bucket-and-music-library}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Il est monté à `/data` via **GCS FUSE** uniquement lorsque NFS
est désactivé (`enable_gcs_storage_volume = !enable_nfs`) — non recommandé, car SQLite ne peut pas s'exécuter en
toute sécurité sur GCS FUSE. Le bucket est de classe `STANDARD`, `force_destroy = true`, sans
gestion de versions, avec `public_access_prevention = enforced`. La **bibliothèque musicale** à `/music` n'est
pas montée automatiquement — déclarez un volume GCS FUSE supplémentaire via
`gcs_volumes` (ou activez NFS) pointant vers votre collection musicale.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS FUSE et
CMEK.

### D. Secret Manager et le mot de passe administrateur {#d-secret-manager--the-admin-password}

Lorsque `enable_admin_password = true` (la valeur par défaut), la couche commune génère un mot de passe
aléatoire de 24 caractères, le stocke dans Secret Manager sous le nom `secret-<prefix>-navidrome-admin-password`,
et l'injecte comme `ND_DEVAUTOCREATEADMINPASSWORD` afin que Navidrome crée automatiquement l'utilisateur
`admin` au premier démarrage. Il n'y a pas de clé de chiffrement ou de secret
JWT à gérer.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut `ingress_settings = "internal"`, le service n'est donc accessible que depuis le VPC —
approprié pour un serveur musical privé. Définissez `ingress_settings = "all"` pour une URL `run.app`
publique (nécessite `enable_admin_password = true`, appliqué au moment de la planification), ou ajoutez
un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN
et Cloud Armor. Le contrôle d'égression VPC régit la connectivité sortante.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
stratégies d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Navidrome {#3-navidrome-application-behaviour}

- **Pas de job d'initialisation.** Navidrome n'a pas besoin d'étape `db-init` — il
  crée et migre sa propre base de données SQLite sous `/data` la première fois
  qu'il démarre. Laissez `initialization_jobs` vide, sauf si vous avez des tâches de chargement
  de données personnalisées.
- **Création automatique de l'administrateur au premier démarrage.** Avec
  `enable_admin_password = true`, `ND_DEVAUTOCREATEADMINPASSWORD` est injecté et Navidrome crée l'utilisateur `admin` avec le mot
  de passe généré au premier démarrage. Connectez-vous en tant que `admin`,
  récupérez le mot de passe de Secret Manager et modifiez-le. Avec `enable_admin_password = false`, le
  premier accès sert un **assistant de création d'administrateur** à la place —
  complétez-le immédiatement afin que personne d'autre ne puisse revendiquer le
  compte administrateur.
- **Le scan de la bibliothèque s'exécute au démarrage.** Navidrome scanne
  `ND_MUSICFOLDER` (`/music`) au démarrage et périodiquement ; une grande collection prend
  du temps à indexer dans la base de données SQLite et l'index de recherche
  sous `/data`.
- **`/data` est la seule source de vérité — persistez-la.** Tout l'état de la
  bibliothèque se trouve sur le volume `/data` basé sur NFS. Modifier `nfs_mount_path` ou
  désactiver NFS orpheline la base de données, les utilisateurs, les listes de
  lecture et les comptes de lecture. Limitez Cloud Run à une utilisation
  légère/personnelle et déplacez une bibliothèque plus grande vers la variante
  GKE block-PVC.
- **L'image personnalisée est un wrapper fin.** Le Dockerfile est `ARG NAVIDROME_VERSION=0.54.3` /
  `FROM deluan/navidrome:${NAVIDROME_VERSION}`, donc `image_source = "custom"` et la Fondation le met en miroir dans Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` se résout en `0.54.3` épinglé via l'argument de build `NAVIDROME_VERSION`
  spécifique à l'application — il n'est **pas** écrasé par l'injection
  générique `APP_VERSION` de la Fondation.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `GET /ping`,
  qui renvoie `{"status":"ok"}` (200) sans authentification une fois le serveur prêt. La
  sonde de démarrage autorise un délai initial de 15 secondes avec une fenêtre
  de nouvelle tentative généreuse ; la sonde de vivacité interroge toutes les
  30 secondes.
- **Inspecter l'image et l'environnement de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Navidrome sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `navidrome` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Navidrome Music Server` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Navidrome — self-hosted, Subsonic-compatible music streaming server` | Description du service. |
| `application_version` | `latest` | Tag de l'image Navidrome ; `latest` épingle à `0.54.3` via l'argument de build `NAVIDROME_VERSION`. |
| `enable_admin_password` | `true` | Génère un mot de passe `admin` aléatoire dans Secret Manager et injecte `ND_DEVAUTOCREATEADMINPASSWORD`. Requis pour l'ingress public. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez pour le scan de grandes bibliothèques. |
| `memory_limit` | `1Gi` | Mémoire par instance ; Navidrome conserve son index de recherche en mémoire — dimensionnez en fonction de la bibliothèque. |
| `min_instance_count` | `1` | Gardez 1 pour rester chaud et éviter les démarrages à froid en cours de streaming. |
| `max_instance_count` | `1` | **Gardez à 1.** Une seule bibliothèque SQLite partagée sur un seul volume — ne jamais exécuter plusieurs réplicas. |
| `container_port` | `4533` | Port web/API de Navidrome. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE et NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Navidrome n'a pas de Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir `deluan/navidrome` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal` maintient le serveur privé au sein du VPC ; `all` (public) nécessite `enable_admin_password = true`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Navidrome. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ND_*` supplémentaires ; écrasez `ND_MUSICFOLDER` / `ND_DATAFOLDER` ici si vous remappez les volumes. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC) du bucket `/data`. |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané `/data` lors du déploiement (`tar` par défaut). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — **non applicable à Navidrome** (pas de base
de données SQL) ; conservé pour la compatibilité de la fondation. Héberge
également `nfs_instance_name` / `nfs_instance_base_name` pour la découverte NFS.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket Navidrome `/data` (créé automatiquement) et tout supplément. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Monte le volume NFS partagé à `/data` pour la base de données SQLite. Gardez activé — GCS FUSE ne peut pas héberger SQLite. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires — utilisez pour monter la bibliothèque musicale à `/music`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Navidrome_Common — Navidrome utilise SQLite embarqué, pas de Cloud SQL. |
| `database_password_length` | `32` | Inerte ; transféré pour la compatibilité de la fondation. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Non applicable — pas de base de données SQL. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Navidrome n'a pas besoin de job d'initialisation ; à fournir uniquement pour des tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run facultatifs pour les tâches de maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/ping` 15s de délai | Sonde de démarrage ; `/ping` renvoie `{"status":"ok"}` (200) une fois prêt. |
| `liveness_probe` | HTTP `/ping` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/ping` | Sonde de démarrage structurée alternative. |
| `health_check_config` | HTTP `/ping` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ path="/ping" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis (transféré pour la compatibilité de la fondation) {#group-21--redis-forwarded-for-foundation-compatibility}

`enable_redis` est défini sur `false` par ce module et Navidrome n'utilise ni cache ni
file d'attente ; `redis_host` / `redis_port` / `redis_auth` sont inertes. Laissez les valeurs
par défaut.

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `navidrome_url` | URL du service pour l'interface web Navidrome / API Subsonic (interne au VPC lorsque `ingress_settings = internal`). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour un déploiement Navidrome par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

Le mot de passe administrateur généré n'est pas renvoyé en sortie ;
récupérez-le de Secret Manager (`secret-<prefix>-navidrome-admin-password`, voir §2 / §4.D).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> runtime `gen1` avec des montages NFS/GCS, IAP sans identités autorisées, une
> valeur `container_port`/`backup_retention_days`/`timeout_seconds` hors plage. Une garde spécifique à Navidrome
> rejette en outre `ingress_settings = "all"` à moins que `enable_admin_password = true`, et `min_instance_count > max_instance_count`. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la
> création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` / `nfs_mount_path` | `true` / `/data` | Critique | Le partage NFS à `/data` contient la base de données SQLite, les utilisateurs et les listes de lecture ; désactiver NFS place la base de données sur GCS FUSE, ce qui corrompt les écritures SQLite. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans un seul fichier SQLite et corrompent la bibliothèque. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `ingress_settings = "all"` sans `enable_admin_password` | garder le mot de passe admin activé | Critique | Bloqué au moment de la planification — une URL publique avec un assistant de première exécution ouvert permet à un étranger de revendiquer le compte `admin`. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne peut pas monter NFS, donc `/data` ne persiste jamais. |
| `min_instance_count` | `1` | Élevé | Les démarrages à froid à l'échelle zéro interrompent les flux en cours et rouvrent la bibliothèque. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Élevé | Navidrome conserve son index de recherche en mémoire ; trop peu de mémoire tue le serveur OOM pendant le scan. |
| Montage `ND_MUSICFOLDER` | Fournir de la musique à `/music` | Élevé | Sans un montage `gcs_volumes`/NFS à `/music`, la bibliothèque est vide — rien à diffuser. |
| `enable_admin_password` | `true` | Moyen | Désactivé laisse un assistant de création d'administrateur ouvert au premier accès ; complétez-le immédiatement ou restreignez l'ingress. |
| `ingress_settings` | `internal` sauf si public | Moyen | `all` expose le serveur musical à Internet — associez-le à IAP ou Cloud Armor. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer un ancien instantané de bibliothèque. |
| Mot de passe administrateur généré | Changer après la première connexion | Moyen | Le mot de passe de démarrage se trouve dans Secret Manager ; faites-le pivoter dans l'application pour les utilisateurs réels. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Navidrome partagée avec la variante GKE est décrite
dans **[Navidrome_Common](Navidrome_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Navidrome sur Cloud Run](../labs/Navidrome_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Navidrome sur GKE Autopilot](Navidrome_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Navidrome Common — Configuration d'application partagée](Navidrome_Common.md) — la configuration partagée par les deux cibles de déploiement.
