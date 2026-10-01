---
title: "Emby sur Google Cloud Run"
description: "Référence de configuration pour déployer Emby sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Emby_CloudRun.md @ 3055034 sha256:983ce86c2d36 -->

# Emby sur Google Cloud Run {#emby-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Emby_CloudRun.png" alt="Emby sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Emby est un serveur multimédia auto-hébergé permettant d'organiser et de diffuser vos
propres films, séries TV, musiques et photos, avec des applications clientes pour la
plupart des téléviseurs, téléphones et navigateurs. La lecture de base, la diffusion
sans transcodage et l'assistant de configuration sont gratuits — aucune clé de licence
ni aucun compte emby.media n'est nécessaire pour démarrer ou naviguer. Emby Premiere, un
module complémentaire payant acheté séparément dans l'application, conditionne le
transcodage accéléré par matériel, les applications mobiles/TV complètes, le DVR/la TV en
direct et la synchronisation hors ligne ; c'est ce qui le distingue de Jellyfin
(également présent dans ce catalogue), un fork communautaire du code d'origine d'Emby
Server, entièrement open source et sans palier payant équivalent. Ce module déploie
Emby sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Emby et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Emby s'exécute comme un conteneur unique sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur multimédia, 1 vCPU / 1 GiB par défaut, fixé à une seule instance maintenue active |
| Persistance | Cloud Storage + GCS FUSE | Le répertoire `/config` (bases de données SQLite, métadonnées, plugins) est adossé à un bucket GCS |
| Base de données | SQLite interne (embarqué) | Pas de Cloud SQL — Emby conserve tout son état dans des fichiers SQLite sous `/config` |
| Secrets | Secret Manager | Clé d'API facultative générée automatiquement ; aucun secret cryptographique obligatoire |
| Entrée | URL Cloud Run / Cloud Load Balancing | `internal` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |
| Distribution de l'image | Artifact Registry | L'image `emby/embyserver` est mise en miroir avant le déploiement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Emby stocke l'intégralité de sa
  bibliothèque — bases de données SQLite, configuration, métadonnées, illustrations,
  plugins, cache de transcodage et journaux — dans un unique répertoire `/config`.
  Aucune instance Cloud SQL, aucun job `db-init` ni aucun Redis n'est provisionné
  (`database_type = NONE`).
- **`/config` doit persister d'une révision à l'autre.** Sur Cloud Run, le chemin
  `/config` est adossé à un bucket Cloud Storage monté via **GCS FUSE**
  (`enable_gcs_storage_volume = true`). Sans `/config` persistant, chaque nouvelle
  révision démarre avec une bibliothèque vide et relance l'assistant de premier
  démarrage.
- **Le conteneur écoute sur le port 8096.** Cloud Run achemine le trafic HTTP vers le
  port web/API par défaut d'Emby. L'interface web et l'assistant de configuration
  initiale sont servis sur `/web` (et `/`). Contrairement à Jellyfin, Emby ne dispose
  **d'aucun point de terminaison de santé HTTP non authentifié confirmé et documenté** —
  un test sur un conteneur actif a montré que `/health` renvoie `404` tandis que `/`
  répond `302` vers l'assistant de configuration — les deux sondes utilisent donc par
  défaut une vérification **TCP** sur le port 8096 plutôt qu'un chemin HTTP supposé.
- **Il n'y a pas d'identifiants par défaut.** Au premier accès, l'assistant de
  configuration vous guide dans la création du compte administrateur et l'ajout des
  bibliothèques multimédias. Rien n'est utilisable tant que ce compte n'existe pas.
- **Une seule instance maintenue active est la valeur par défaut.**
  `min_instance_count = 1` garde le serveur multimédia actif (évitant la latence d'un
  démarrage à froid en pleine diffusion) et `max_instance_count = 1` conserve une
  bibliothèque SQLite unique et partagée sur un seul volume. **N'exécutez pas plusieurs
  réplicas** — des écritures concurrentes sur un même fichier SQLite corrompent la
  bibliothèque.
- **Cloud Run convient surtout à un usage léger ou de démonstration.** La latence de GCS
  FUSE, combinée au modèle d'exécution sans état de Cloud Run et à son délai
  d'expiration par requête, rend cette variante adaptée à l'évaluation et à un usage
  personnel léger — mais **pas** au transcodage intensif ni à de nombreuses diffusions
  simultanées. Pour une véritable bibliothèque multimédia, déployez
  [Emby_GKE](Emby_GKE.md) avec un PVC en mode bloc.
- **L'authentification par clé d'API est facultative et désactivée par défaut.**
  `enable_api_key = false`. L'authentification principale repose sur le compte
  administrateur créé par l'assistant ; les clés d'API par application sont créées dans
  l'application, sous **Dashboard → API Keys**. La valeur Secret Manager générée est
  injectée en tant que `EMBY_API_KEY` — elle s'adresse aux opérateurs qui souhaitent un
  identifiant stable à fournir à des clients d'API externes, et n'est pas lue par Emby
  au démarrage.
- **Emby Premiere est un palier payant distinct et facultatif.** Il n'a aucune incidence
  sur la réussite du déploiement de ce module ni sur le fonctionnement de la diffusion
  de base — il ne conditionne que des fonctionnalités facultatives (clients, DVR,
  transcodage matériel) que l'opérateur peut débloquer ultérieurement.

> **Cloud Run ou GKE — choisissez le bon hébergement pour votre bibliothèque.**
> **Cloud Run (ce module)** monte `/config` depuis un bucket GCS via FUSE. Cette option
> est simple, se limite à une seule instance maintenue active et convient idéalement à
> une démonstration ou à une petite bibliothèque personnelle avec une diffusion
> occasionnelle en lecture directe. La latence d'E/S de FUSE et le modèle de délai
> d'expiration par requête la rendent peu adaptée au transcodage en direct ou à une
> diffusion multi-utilisateur soutenue. **[Emby_GKE](Emby_GKE.md)** s'exécute comme un
> StatefulSet avec un véritable **PVC en mode bloc** sur `/config`, offrant une
> sémantique de système de fichiers correcte pour SQLite et le cache de transcodage —
> c'est le choix recommandé pour un serveur multimédia de production, avec NFS en option
> pour les grandes bibliothèques multimédias.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Emby {#a-cloud-run--the-emby-service}

Emby s'exécute comme un service Cloud Run v2. La bibliothèque étant un magasin SQLite
unique sur un seul volume, le service est fixé à une instance au lieu d'être mis à
l'échelle automatiquement. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Magasin de configuration persistant (SQLite sur `/config`) {#b-persistent-configuration-store-sqlite-on-config}

Emby n'a **aucune base de données externe**. Tout son état — les bases de données
SQLite de la bibliothèque et de la lecture, la configuration, les métadonnées et
illustrations mises en cache, les plugins installés, le cache de transcodage et les
journaux — réside sous `/config`
(`EMBY_CONFIG_DIR = /config`). Il n'y a ni instance Cloud SQL, ni Auth Proxy, ni Job
d'initialisation pour créer un schéma ; Emby crée et migre ses propres bases de données
SQLite au premier démarrage.

Comme tout ce qui compte est un fichier sous `/config`, persister ce répertoire
**revient à** persister l'ensemble du serveur. Sur Cloud Run, il est adossé à un bucket
Cloud Storage (voir ci-dessous).

- **Inspecter la configuration montée sur la révision en cours :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — le bucket `/config` {#c-cloud-storage--the-config-bucket}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement et monté sur `/config` via **GCS FUSE**
(`enable_gcs_storage_volume = true`, environnement d'exécution gen2). Le bucket est de
classe `STANDARD`, avec `force_destroy = true`, sans gestion des versions, et
`public_access_prevention = enforced`. Des buckets supplémentaires peuvent être déclarés
via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options de montage GCS FUSE et CMEK.

### D. Configuration initiale et médiathèque {#d-first-run-setup--the-media-library}

Au premier accès, Emby sert un **assistant de configuration** interactif sur `/web`
(et `/`) qui crée le compte administrateur, définit la langue préférée et vous permet
d'ajouter des bibliothèques multimédias (films, séries TV, musique, photos). Rien n'est
authentifié ni utilisable tant que vous n'avez pas terminé l'assistant — il n'y a pas
d'identifiants par défaut.

Les bibliothèques multimédias pointent vers des chemins à l'intérieur du conteneur. Sur
Cloud Run, les médias sont servis depuis le volume `/config` monté ou depuis des montages
GCS FUSE supplémentaires ; pour les grandes bibliothèques multimédias, privilégiez la
variante GKE avec un stockage en mode bloc ou NFS.

- **Accéder à l'assistant / à l'interface web :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  # open <url>/web in a browser (requires ingress=all or an LB/IAP path)
  ```

### E. Secret Manager et la clé d'API facultative {#e-secret-manager--the-optional-api-key}

Emby ne nécessite **aucun secret cryptographique obligatoire** — il n'y a ni clé de
chiffrement, ni JWT, ni mot de passe maître à gérer. Lorsque `enable_api_key = true`, le
module génère une valeur aléatoire de 32 caractères et la stocke dans Secret Manager sous
`secret-<prefix>-<app>-api-key`, injectée dans le conteneur en tant que `EMBY_API_KEY`.
Emby ne dispose d'aucune variable d'environnement qui l'utilise au démarrage — la seule
façon d'obtenir une clé d'API utilisable dans Emby est de la créer dans l'application,
sous **Dashboard → API Keys** ; ce secret existe en tant qu'identifiant stable, adossé à
Secret Manager, que les opérateurs peuvent référencer en externe. L'authentification
principale reste le compte administrateur créé par l'assistant.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, `ingress_settings = "internal"` : le service n'est accessible que depuis le
VPC — ce qui convient à un serveur multimédia privé. Définissez
`ingress_settings = "all"` pour obtenir une URL `run.app` publique, ou ajoutez un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor.
Le contrôle de la sortie VPC régit la connectivité sortante.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run sont
envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Emby {#3-emby-application-behaviour}

- **Aucun Job d'initialisation.** Emby n'a besoin d'aucune étape `db-init` — il crée et
  migre ses propres bases de données SQLite sous `/config` lors de son premier
  démarrage. Laissez `initialization_jobs` vide, sauf si vous avez des tâches
  personnalisées de chargement de données.
- **L'assistant de premier démarrage crée l'administrateur.** L'assistant de
  configuration `/web` vous guide dans la création du compte administrateur et l'ajout
  des bibliothèques. Tant qu'il n'est pas terminé, le serveur n'a ni utilisateurs ni
  contenu.
- **`/config` est l'unique source de vérité — rendez-le persistant.** Tout l'état de la
  bibliothèque se trouve sur le volume `/config` adossé à GCS. Supprimer ce bucket ou le
  faire pointer ailleurs efface la bibliothèque, les plugins et les utilisateurs. GCS
  FUSE n'étant pas un véritable système de fichiers POSIX, limitez Cloud Run à un usage
  léger ou de démonstration et migrez une véritable bibliothèque vers la variante GKE
  avec PVC en mode bloc.
- **L'image personnalisée est une simple surcouche.** Le Dockerfile est
  `ARG EMBY_VERSION=4.10.0.15` / `FROM emby/embyserver:${EMBY_VERSION}` ; ainsi
  `image_source = "custom"` et le socle la met en miroir dans Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` se résout vers la
  version épinglée `4.10.0.15` via l'argument de build propre à l'application
  `EMBY_VERSION` — il n'est **pas** écrasé par l'injection générique d'`APP_VERSION`
  effectuée par le socle. Une vérification locale par `docker build` + `docker run`
  a confirmé que l'image démarre proprement avec seulement `EMBY_CONFIG_DIR` et atteint
  la véritable logique de démarrage d'Emby Server.
- **Aucun chemin de santé dédié — sondes TCP.** Les sondes de démarrage et de vivacité
  utilisent toutes deux une vérification **TCP** sur le port 8096, qui réussit dès
  qu'Emby écoute. Un test en conditions réelles a confirmé que `/health` renvoie `404`
  (point de terminaison inexistant) tandis que `/` répond `302` vers l'assistant de
  configuration — ce qui exclut un chemin HTTP comme cible de sonde, contrairement à
  Jellyfin, qui documente un `/health` fonctionnel.
- **Le transcodage est gourmand en CPU et sans GPU.** Cloud Run ne dispose pas de GPU ;
  privilégiez donc les clients en lecture directe. Augmentez `cpu_limit` pour le
  transcodage en direct et `memory_limit` pour les grandes bibliothèques.
- **Inspecter l'image et les montages de la révision en cours :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Emby ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `emby` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Emby Media Server` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service, y compris la note sur la licence Premiere. |
| `application_version` | `latest` | Tag de l'image Emby ; `latest` épingle la version `4.10.0.15` via l'argument de build `EMBY_VERSION`. |
| `enable_api_key` | `false` | Génère une clé d'API aléatoire dans Secret Manager (`EMBY_API_KEY`). Recommandé pour tout déploiement accessible depuis l'extérieur du VPC. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez-le pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmentez-la pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Conservez 1 pour rester actif et éviter les démarrages à froid en pleine diffusion. |
| `max_instance_count` | `1` | **Conservez 1.** Une bibliothèque SQLite unique et partagée sur un seul volume — n'exécutez jamais plusieurs réplicas. |
| `container_port` | `8096` | Port web/API d'Emby. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE et NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Emby n'utilise pas Cloud SQL — laissez `false`. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` uniquement pour HTTP/2 en clair. |
| `enable_image_mirroring` | `true` | Met `emby/embyserver` en miroir dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Sans effet dans ce module ; le socle gère la conservation des révisions. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` maintient le serveur privé au sein du VPC ; définissez `all` pour une URL publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant Emby. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets injectés dans la révision. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron (UTC) de la sauvegarde automatisée du bucket `/config`. |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure un instantané de `/config` lors du déploiement (`tar` par défaut). |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **non applicables à Emby** (aucune base de données SQL) ;
conservées pour la compatibilité avec le socle. Ce groupe héberge également
`nfs_instance_name` / `nfs_instance_base_name` pour la découverte NFS.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `/config` d'Emby (créé automatiquement) et d'éventuels buckets supplémentaires. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires, en plus du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `false` | Provisionne Cloud Filestore (NFS) ; à activer pour les grandes bibliothèques multimédias partagées. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires (le bucket `/config` est ajouté automatiquement). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Emby_Common — Emby utilise SQLite embarqué, sans Cloud SQL. |
| `database_password_length` | `32` | Sans effet ; transmis pour la compatibilité avec le socle. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Non applicable — aucune base de données SQL. |
| `db_*_env_var_name` / `service_url_env_var_name` | `""` | Alias de variables d'environnement supplémentaires facultatifs ; laissez vide pour Emby. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Emby n'a besoin d'aucun job d'initialisation ; n'en fournissez que pour des tâches personnalisées de chargement de données. |
| `cron_jobs` | `[]` | Jobs Cloud Run facultatifs pour les tâches de maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP 8096, 15s de délai | Sonde de démarrage ; en TCP car Emby n'a pas de chemin de santé confirmé. |
| `liveness_probe` | TCP 8096, 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | `{ enabled = true }` | Sonde de démarrage structurée alternative. |
| `health_check_config` | `{ enabled = true }` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `emby_url` | URL du service pour l'interface web / l'API d'Emby (interne au VPC lorsque `ingress_settings = internal`). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/config`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide pour un déploiement Emby par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un environnement d'exécution `gen1` avec des montages NFS/GCS, IAP sans identités autorisées, un `container_port`/`backup_retention_days`/`timeout_seconds` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket GCS `/config` | Ne jamais le supprimer ni le faire pointer ailleurs | Critique | Le bucket `/config` contient la bibliothèque SQLite, les utilisateurs et les métadonnées ; le supprimer efface l'ensemble du serveur. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans un même fichier SQLite via FUSE et corrompent la bibliothèque. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne peut pas monter GCS FUSE ; `/config` ne persiste donc jamais. |
| `min_instance_count` | `1` | Élevé | Les démarrages à froid liés à la mise à l'échelle jusqu'à zéro interrompent les diffusions en cours et rechargent la bibliothèque. |
| `memory_limit` | `1Gi` (à augmenter pour les grandes bibliothèques) | Élevé | Une mémoire insuffisante provoque l'arrêt OOM du serveur pendant l'analyse ou le transcodage d'une grande bibliothèque. |
| `cpu_limit` | `1000m` (à augmenter pour le transcodage) | Élevé | Le transcodage en direct sur Cloud Run (sans GPU) sature le CPU ; privilégiez la lecture directe. |
| Transcodage intensif / nombreuses diffusions | Utilisez [Emby_GKE](Emby_GKE.md) | Élevé | La latence de GCS FUSE et les délais d'expiration des requêtes Cloud Run rendent Cloud Run peu adapté à une diffusion soutenue. |
| Type de `startup_probe`/`liveness_probe` | `TCP` (par défaut) | Élevé | Un chemin HTTP `/health` supposé renvoie 404 sur Emby (vérifié en conditions réelles) — une sonde HTTP ne réussirait jamais ici. |
| `ingress_settings` | `internal` sauf si public | Moyen | `all` expose le serveur multimédia à Internet — associez-le à IAP ou à Cloud Armor. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour récupérer un instantané plus ancien de la bibliothèque. |
| Assistant de premier démarrage | À terminer immédiatement | Moyen | Un serveur non configuré n'a pas d'administrateur ; toute personne qui l'atteint peut s'approprier le compte administrateur. |
| `enable_api_key` | Comprendre qu'elle est réservée à l'opérateur | Faible | Emby ne lit jamais `EMBY_API_KEY` au démarrage — créez des clés d'API dans l'application, sous Dashboard → API Keys, pour l'authentification REST effective auprès d'Emby. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Emby,
partagée avec la variante GKE, est décrite dans
**[Emby_Common](Emby_Common.md)**. Pour une présentation guidée, consultez le
[lab Emby_CloudRun](../labs/Emby_CloudRun.md).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Emby sur Cloud Run](../labs/Emby_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Emby sur GKE Autopilot](Emby_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Emby Common — Configuration applicative partagée](Emby_Common.md) — la configuration partagée par les deux cibles de déploiement.
