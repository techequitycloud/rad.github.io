---
title: "Navidrome sur Google Cloud Run"
description: "Référence de configuration pour déployer Navidrome sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Navidrome_CloudRun.md @ 3055034 sha256:5713148b04b5 -->

# Navidrome sur Google Cloud Run {#navidrome-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Navidrome_CloudRun.png" alt="Navidrome sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Navidrome est un serveur de streaming musical auto-hébergé, gratuit et open source (GPLv3),
compatible Subsonic et écrit en Go. Il analyse une bibliothèque musicale, la sert via une
interface web rapide et parle l'API Subsonic/OpenSubsonic, de sorte que tout client mobile ou
de bureau compatible peut l'utiliser pour le streaming. Ce module déploie Navidrome sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Navidrome et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Navidrome s'exécute comme un unique conteneur Go sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur musical Go, 1 vCPU / 1 GiB par défaut, épinglé à une seule instance active |
| Persistance | Cloud Storage + GCS FUSE | Le répertoire `/data` (base SQLite, cache de métadonnées, index de recherche) repose sur un bucket GCS |
| Base de données | SQLite interne (embarquée) | Pas de Cloud SQL — Navidrome conserve tout son état dans un fichier SQLite sous `/data` |
| Secrets | Secret Manager | Mot de passe `admin` généré (`ND_DEVAUTOCREATEADMINPASSWORD`) lorsque `enable_admin_password = true` |
| Entrée | URL Cloud Run / Cloud Load Balancing | `internal` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |
| Livraison des images | Artifact Registry | L'image `deluan/navidrome` y est dupliquée avant le déploiement |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Navidrome stocke l'intégralité de son état — la
  base de données SQLite, le cache de métadonnées et l'index de recherche — dans un seul
  répertoire `/data`. Aucune instance Cloud SQL, aucun job `db-init` et aucun Redis ne sont
  provisionnés (`database_type = NONE` ; `enable_redis = false`).
- **`/data` doit persister entre les révisions.** Sur Cloud Run, le chemin `/data` repose sur
  un bucket Cloud Storage monté via **GCS FUSE** (`enable_gcs_storage_volume = true`,
  environnement d'exécution gen2). Sans `/data` persistant, chaque nouvelle révision démarre
  avec une bibliothèque vide et relance l'analyse et la configuration du premier démarrage.
- **Le conteneur écoute sur le port 4533.** Cloud Run achemine le trafic HTTP vers le port
  web/API par défaut de Navidrome. `GET /ping` renvoie `{"status":"ok"}` (200, sans
  authentification) une fois le serveur démarré.
- **Un compte administrateur généré par défaut.** `enable_admin_password = true` génère un
  mot de passe aléatoire de 24 caractères, le stocke dans Secret Manager et l'injecte sous la
  forme `ND_DEVAUTOCREATEADMINPASSWORD` afin que l'utilisateur `admin` soit créé
  automatiquement au premier démarrage. Récupérez-le dans Secret Manager et modifiez-le après
  la première connexion. Définissez `enable_admin_password = false` pour créer plutôt le
  premier administrateur via l'assistant web.
- **Une seule instance active par défaut.** `min_instance_count = 1` garde le serveur actif
  (ce qui évite la latence de démarrage à froid en cours d'écoute) et
  `max_instance_count = 1` conserve une seule bibliothèque SQLite partagée sur un seul volume.
  **N'exécutez pas plusieurs réplicas** — Navidrome est un serveur à écrivain unique ; des
  écrivains concurrents sur un même fichier SQLite corrompent la bibliothèque.
- **La bibliothèque musicale n'est pas montée automatiquement.** `ND_MUSICFOLDER = /music` est
  défini, mais le module n'y monte rien — fournissez la collection musicale via un montage
  `gcs_volumes` (ou NFS) sur `/music`.
- **Une entrée publique requiert le mot de passe administrateur généré.** Une garde au moment
  du plan rejette `ingress_settings = "all"` sauf si `enable_admin_password = true` — sinon,
  l'assistant de premier lancement est ouvert à quiconque atteint l'URL en premier.

> **Cloud Run ou GKE — choisissez le bon hébergement pour votre bibliothèque.**
> **Cloud Run (ce module)** monte `/data` depuis un bucket GCS via FUSE. C'est simple, cela se
> limite à une seule instance active et c'est idéal pour une démonstration ou une petite
> bibliothèque personnelle. La latence d'E/S de FUSE rend le répertoire `/data`, très sollicité
> par SQLite, plus lent qu'un stockage en mode bloc. **[Navidrome_GKE](Navidrome_GKE.md)**
> s'exécute comme StatefulSet avec un véritable **PVC en mode bloc** sur `/data`, offrant la
> sémantique de système de fichiers correcte dont la base SQLite embarquée a besoin — le choix
> recommandé pour une bibliothèque plus grande ou plus sollicitée, avec NFS en option pour une
> grande collection musicale.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et
des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Navidrome {#a-cloud-run--the-navidrome-service}

Navidrome s'exécute comme un service Cloud Run v2. La bibliothèque étant un magasin SQLite
unique sur un seul volume, le service est épinglé à une instance plutôt que mis à l'échelle
automatiquement. Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Magasin de données persistant (SQLite sur `/data`) {#b-persistent-data-store-sqlite-on-data}

Navidrome n'a **aucune base de données externe**. L'intégralité de son état — la base de
données SQLite, le cache de métadonnées et l'index de recherche — se trouve sous `/data`
(`ND_DATAFOLDER = /data`). Il n'y a ni instance Cloud SQL, ni Auth Proxy, ni Job
d'initialisation pour créer un schéma ; Navidrome crée et migre sa propre base SQLite au
premier démarrage.

Comme tout ce qui compte est un fichier sous `/data`, rendre ce répertoire persistant
**revient à** rendre tout le serveur persistant. Sur Cloud Run, il repose sur un bucket Cloud
Storage (voir ci-dessous).

- **Inspecter le volume monté sur la révision en cours :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — le bucket `/data` (et la bibliothèque musicale) {#c-cloud-storage--the-data-bucket-and-music-library}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné automatiquement
et monté sur `/data` via **GCS FUSE** (`enable_gcs_storage_volume = true`, environnement
d'exécution gen2). Le bucket est de classe `STANDARD`, avec `force_destroy = true`, sans
gestion des versions et avec `public_access_prevention = enforced`. La **bibliothèque
musicale** sur `/music` n'est pas montée automatiquement — déclarez un volume GCS FUSE
supplémentaire via `gcs_volumes` (ou activez NFS) pointant vers votre collection musicale.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options de montage GCS FUSE et CMEK.

### D. Secret Manager et le mot de passe administrateur {#d-secret-manager--the-admin-password}

Lorsque `enable_admin_password = true` (valeur par défaut), la couche Common génère un mot de
passe aléatoire de 24 caractères, le stocke dans Secret Manager sous le nom
`secret-<prefix>-navidrome-admin-password` et l'injecte sous la forme
`ND_DEVAUTOCREATEADMINPASSWORD` afin que Navidrome crée automatiquement l'utilisateur `admin`
au premier démarrage. Il n'y a ni clé de chiffrement ni secret JWT à gérer.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, `ingress_settings = "internal"` : le service n'est accessible que depuis le VPC,
ce qui convient à un serveur musical privé. Définissez `ingress_settings = "all"` pour une URL
`run.app` publique (requiert `enable_admin_password = true`, vérifié au moment du plan), ou
ajoutez un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor. Le contrôle de sortie VPC régit la connectivité sortante.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Navidrome {#3-navidrome-application-behaviour}

- **Aucun Job d'initialisation.** Navidrome n'a besoin d'aucune étape `db-init` — il crée et
  migre sa propre base SQLite sous `/data` lors de son premier démarrage. Laissez
  `initialization_jobs` vide, sauf si vous avez des tâches personnalisées de chargement de
  données.
- **Création automatique de l'administrateur au premier démarrage.** Avec
  `enable_admin_password = true`, `ND_DEVAUTOCREATEADMINPASSWORD` est injecté et Navidrome
  crée l'utilisateur `admin` avec le mot de passe généré au premier démarrage. Connectez-vous
  en tant qu'`admin`, récupérez le mot de passe dans Secret Manager et modifiez-le. Avec
  `enable_admin_password = false`, le premier accès affiche plutôt un **assistant de création
  d'administrateur** — terminez-le immédiatement afin que personne d'autre ne puisse
  s'approprier le compte administrateur.
- **L'analyse de la bibliothèque s'exécute au démarrage.** Navidrome analyse
  `ND_MUSICFOLDER` (`/music`) au démarrage puis périodiquement ; l'indexation d'une grande
  collection dans la base SQLite et l'index de recherche sous `/data` prend du temps.
- **`/data` est l'unique source de vérité — rendez-le persistant.** Tout l'état de la
  bibliothèque se trouve sur le volume `/data` reposant sur GCS. Supprimer ce bucket ou le
  faire pointer ailleurs efface la base de données, les utilisateurs, les playlists et les
  compteurs d'écoute. GCS FUSE n'étant pas un véritable système de fichiers POSIX, limitez
  Cloud Run à un usage léger ou personnel et migrez une bibliothèque plus grande vers la
  variante GKE avec PVC en mode bloc.
- **L'image personnalisée est une fine surcouche.** Le Dockerfile est
  `ARG NAVIDROME_VERSION=0.54.3` / `FROM deluan/navidrome:${NAVIDROME_VERSION}` ; ainsi
  `image_source = "custom"` et le socle la duplique dans Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` se résout en la version
  épinglée `0.54.3` via l'argument de build propre à l'application `NAVIDROME_VERSION` — il
  n'est **pas** écrasé par l'injection générique `APP_VERSION` du socle.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `GET /ping`, qui renvoie
  `{"status":"ok"}` (200) sans authentification une fois le serveur prêt. La sonde de
  démarrage accorde un délai initial de 15 secondes avec une fenêtre de nouvelles tentatives
  généreuse ; la sonde de vivacité interroge toutes les 30 secondes.
- **Inspecter l'image et l'environnement de la révision en cours :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Navidrome ou notables pour lui sont listés ; toutes
les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `navidrome` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Navidrome Music Server` | Nom lisible affiché dans la console. |
| `description` | `Navidrome — self-hosted, Subsonic-compatible music streaming server` | Description du service. |
| `application_version` | `latest` | Tag de l'image Navidrome ; `latest` est épinglé à `0.54.3` via l'argument de build `NAVIDROME_VERSION`. |
| `enable_admin_password` | `true` | Générer un mot de passe `admin` aléatoire dans Secret Manager et injecter `ND_DEVAUTOCREATEADMINPASSWORD`. Requis pour une entrée publique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; à augmenter pour l'analyse de grandes bibliothèques. |
| `memory_limit` | `1Gi` | Mémoire par instance ; Navidrome conserve son index de recherche en mémoire — dimensionnez selon la bibliothèque. |
| `min_instance_count` | `1` | Gardez 1 pour rester actif et éviter les démarrages à froid en cours d'écoute. |
| `max_instance_count` | `1` | **Gardez 1.** Une seule bibliothèque SQLite partagée sur un seul volume — n'exécutez jamais plusieurs réplicas. |
| `container_port` | `4533` | Port web/API de Navidrome. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS FUSE et NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Navidrome n'utilise pas Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Dupliquer `deluan/navidrome` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements par étapes. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal` garde le serveur privé au sein du VPC ; `all` (public) requiert `enable_admin_password = true`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger une connexion Google devant Navidrome. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ND_*` supplémentaires ; remplacez ici `ND_MUSICFOLDER` / `ND_DATAFOLDER` si vous remappez les volumes. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC) du bucket `/data`. |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané de `/data` lors du déploiement (`tar` par défaut). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **non applicables à Navidrome** (aucune base de données SQL) ;
conservés pour la compatibilité avec le socle. Ce groupe héberge aussi `nfs_instance_name` /
`nfs_instance_base_name` pour la découverte NFS.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket `/data` de Navidrome (créé automatiquement) et d'éventuels buckets supplémentaires. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `false` | Provisionner Cloud Filestore (NFS) ; à activer pour monter une grande bibliothèque musicale partagée. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires — à utiliser pour monter la bibliothèque musicale sur `/music`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Imposé à `NONE` par Navidrome_Common — Navidrome utilise SQLite embarqué, sans Cloud SQL. |
| `database_password_length` | `32` | Sans effet ; transmis pour la compatibilité avec le socle. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Non applicable — aucune base de données SQL. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Navidrome n'a besoin d'aucun job d'initialisation ; à fournir uniquement pour des tâches personnalisées de chargement de données. |
| `cron_jobs` | `[]` | Jobs Cloud Run facultatifs pour les tâches de maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/ping` délai de 15 s | Sonde de démarrage ; `/ping` renvoie `{"status":"ok"}` (200) une fois prêt. |
| `liveness_probe` | HTTP `/ping` délai de 30 s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/ping` | Sonde de démarrage structurée alternative. |
| `health_check_config` | HTTP `/ping` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ path="/ping" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis (transmis pour la compatibilité avec le socle) {#group-21--redis-forwarded-for-foundation-compatibility}

`enable_redis` est défini à `false` par ce module et Navidrome n'utilise ni cache ni file
d'attente ; `redis_host` / `redis_port` / `redis_auth` sont sans effet. Laissez les valeurs par
défaut.

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `navidrome_url` | URL du service pour l'interface web de Navidrome / l'API Subsonic (interne au VPC lorsque `ingress_settings = internal`). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide pour un déploiement Navidrome par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

Le mot de passe administrateur généré n'est pas renvoyé comme sortie ; récupérez-le dans Secret
Manager (`secret-<prefix>-navidrome-admin-password`, voir § 2 / § 4.D).

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un environnement d'exécution `gen1` avec des montages NFS/GCS, IAP sans identités autorisées, un `container_port`/`backup_retention_days`/`timeout_seconds` hors plage. Une garde propre à Navidrome rejette en outre `ingress_settings = "all"` sauf si `enable_admin_password = true`, ainsi que `min_instance_count > max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket GCS `/data` | Ne jamais le supprimer ni le faire pointer ailleurs | Critical | Le bucket `/data` contient la base SQLite, les utilisateurs et les playlists ; le supprimer efface tout le serveur. |
| `max_instance_count` | `1` | Critical | Plusieurs réplicas écrivent dans un même fichier SQLite via FUSE et corrompent la bibliothèque. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `ingress_settings = "all"` sans `enable_admin_password` | garder le mot de passe administrateur activé | Critical | Bloqué au moment du plan — une URL publique avec un assistant de premier lancement ouvert permet à un inconnu de s'approprier le compte `admin`. |
| `execution_environment` | `gen2` | High | Gen1 ne peut pas monter GCS FUSE ; `/data` n'est donc jamais persistant. |
| `min_instance_count` | `1` | High | Les démarrages à froid liés à la mise à l'échelle à zéro interrompent les écoutes en cours et rouvrent la bibliothèque. |
| `memory_limit` | `1Gi` (à augmenter pour les grandes bibliothèques) | High | Navidrome conserve son index de recherche en mémoire ; une mémoire insuffisante provoque l'arrêt OOM du serveur pendant l'analyse. |
| Montage `ND_MUSICFOLDER` | Fournir la musique sur `/music` | High | Sans montage `gcs_volumes`/NFS sur `/music`, la bibliothèque est vide — rien à diffuser. |
| `enable_admin_password` | `true` | Medium | Désactivé, un assistant de création d'administrateur reste ouvert au premier accès ; terminez-le immédiatement ou restreignez l'entrée. |
| `ingress_settings` | `internal` sauf usage public | Medium | `all` expose le serveur musical à Internet — associez-le à IAP ou Cloud Armor. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour restaurer un instantané plus ancien de la bibliothèque. |
| Mot de passe administrateur généré | À modifier après la première connexion | Medium | Le mot de passe d'amorçage reste dans Secret Manager ; modifiez-le dans l'application pour les vrais utilisateurs. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Navidrome partagée
avec la variante GKE est décrite dans **[Navidrome_Common](Navidrome_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Navidrome sur Cloud Run](../labs/Navidrome_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Navidrome sur GKE Autopilot](Navidrome_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Navidrome Common — Configuration applicative partagée](Navidrome_Common.md) — la configuration partagée par les deux cibles de déploiement.
