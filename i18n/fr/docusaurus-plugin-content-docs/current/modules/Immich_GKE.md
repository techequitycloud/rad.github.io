---
title: "Immich sur GKE Autopilot"
description: "Référence de configuration pour déployer Immich sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Immich_GKE.md @ 3055034 sha256:09af46e3fa22 -->

# Immich sur GKE Autopilot {#immich-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Immich_GKE.png" alt="Immich sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Immich est une plateforme open source auto-hébergée de gestion de photos et de vidéos,
sous licence AGPL-3.0 — une alternative à Google Photos avec sauvegarde automatique
depuis le mobile, chronologie, albums, partage, recherche intelligente propulsée par
CLIP et reconnaissance faciale. Toutes les fonctionnalités sont gratuites : la clé
produit facultative à $99 n'est qu'un badge de soutien, sans aucune restriction de
fonctionnalités. Ce module déploie Immich sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Il n'existe volontairement **aucune variante CloudRun** de ce module. La médiathèque
d'Immich est un système de fichiers local — elle n'a pas de backend de stockage
S3/GCS — et les envois de photos et vidéos dépassent couramment plusieurs Go ; ni l'un
ni l'autre ne s'accorde avec le modèle de requêtes de Cloud Run.

Ce guide se concentre sur les services cloud utilisés par Immich et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md).

---

## 1. Vue d'ensemble {#1-overview}

Immich s'exécute sous forme de **deux services** : le serveur Immich (API + workers
d'arrière-plan dans le même processus, image construite sur mesure) et un conteneur
de machine learning distinct, préconstruit.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul (serveur) | GKE Autopilot | Image personnalisée basée sur `ghcr.io/immich-app/immich-server`, port 2283, 2 vCPU / 4 GiB, **exactement un réplica** |
| Calcul (ML) | GKE Autopilot | `ghcr.io/immich-app/immich-machine-learning` préconstruite, port 3003, interne uniquement, inférence sur CPU (sans GPU), 2 vCPU / 4 GiB |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — avec l'extension `pgvector` (`DB_VECTOR_EXTENSION=pgvector` ; Cloud SQL ne dispose pas de VectorChord) |
| Médiathèque | NFS (volume partagé de la plateforme) | Monté sur `/usr/src/app/upload` (`IMMICH_MEDIA_LOCATION`) — Immich n'a pas de backend de stockage d'objets |
| Cache et file d'attente | Redis | Obligatoire — file d'attente des jobs et pub/sub d'Immich ; le Redis hébergé sur le serveur NFS est injecté par défaut |
| Build de l'image | Cloud Build + Artifact Registry | Build personnalisé minimal ajoutant l'entrypoint cloud |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **`enable_nfs = true` est validé, et pas seulement une valeur par défaut.** Toute la
  bibliothèque de photos et de vidéos réside dans `IMMICH_MEDIA_LOCATION` ; sans NFS,
  ce chemin est le disque éphémère du pod et chaque redémarrage efface la
  bibliothèque. Le plan échoue si vous le désactivez.
- **`enable_redis = true` est validé.** Immich refuse de démarrer sans Redis. En
  l'absence de `redis_host` explicite, la plateforme injecte l'IP du Redis hébergé
  sur le serveur NFS.
- **`max_instance_count = 1` est validé.** Une seule médiathèque NFS, un seul
  rédacteur ; les workers de jobs internes au processus d'Immich supposent une
  instance unique.
- **Le Deployment utilise la stratégie `Recreate`**, et non `RollingUpdate` — App_GKE
  bascule automatiquement pour les applications adossées à NFS ; les mises à jour de
  version entraînent donc une courte interruption au lieu d'un interblocage de deux
  pods sur la même bibliothèque.
- **`application_version = "latest"` se résout en tag glissant `release` d'Immich.**
  Immich publie des tags `release` et `vX.Y.Z` mais aucun `latest` ; la couche
  partagée associe `latest` → `release` via l'ARG de build `IMMICH_VERSION` propre à
  l'application, et l'image de machine learning utilise le même tag résolu
  (alignement strict).
- **pgvector est le backend vectoriel.** Cloud SQL ne dispose pas de VectorChord
  (l'extension privilégiée par Immich) ; Immich s'exécute sur sa solution de repli
  pgvector documentée. Le job `db-init` crée au préalable les extensions `vector` et
  `earthdistance`.
- **Les sondes interrogent `GET /api/server/ping`** — le point de terminaison de
  vivacité non authentifié d'Immich (`{"res":"pong"}`).
- **Aucun secret au niveau de l'application.** Les clés de signature JWT d'Immich
  résident dans la base de données ; `DB_PASSWORD` est injecté par le socle sous le
  nom exact que lit Immich.
- **Le premier lancement est interactif.** Ouvrez l'interface web et créez le compte
  administrateur sur l'écran d'inscription ; les applications mobiles Immich
  (iOS/Android) se connectent ensuite à la même URL de serveur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — les charges de travail serveur et ML d'Immich {#a-gke-autopilot--the-immich-server-and-ml-workloads}

Le Deployment du serveur exécute un seul réplica ; le service de machine learning
s'exécute en tant que second Deployment dans le même espace de noms, accessible
uniquement depuis l'intérieur du cluster.

- **Console :** Kubernetes Engine → Workloads → filtrez par espace de noms pour voir
  les deux Deployments, les pods et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods -A | grep immich                       # find the namespace fast
  kubectl get pods,svc,deploy -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o name | grep -v ml | head -1 | cut -d/ -f2)" --tail=100
  # The cloud entrypoint logs the resolved DB/Redis/media config on the first lines:
  kubectl logs -n "$NAMESPACE" <server-pod> | head -15
  # Confirm the ML URL wiring:
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- env | grep IMMICH_MACHINE_LEARNING_URL
  ```

### B. Cloud SQL for PostgreSQL 15 + pgvector {#b-cloud-sql-for-postgresql-15--pgvector}

Immich stocke toutes ses métadonnées (utilisateurs, albums, ressources, EXIF,
embeddings de recherche intelligente, données de reconnaissance faciale) dans Cloud
SQL PostgreSQL 15, accessible via le sidecar **Cloud SQL Auth Proxy**. Le job
`db-init` du premier déploiement crée la base de données et l'utilisateur, et crée au
préalable les extensions `pgvector` et `earthdistance` ; Immich s'exécute avec
`DB_VECTOR_EXTENSION = pgvector`, car Cloud SQL ne propose pas VectorChord.

- **Console :** SQL → sélectionnez l'instance.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Inside psql — confirm the vector extension:
  #   SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector','earthdistance');
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret du mot
de passe figurent dans les [Sorties](#5-outputs).

### C. NFS — la médiathèque {#c-nfs--the-media-library}

Le volume NFS partagé de la plateforme est monté sur `/usr/src/app/upload`
(`IMMICH_MEDIA_LOCATION`). Chaque original, chaque miniature et chaque vidéo encodée
y réside ; le pod lui-même est jetable.

- **CLI :**
  ```bash
  # The NFS server is a Compute Engine VM managed by Services_GCP:
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  # Verify the mount and library content from inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- df -h /usr/src/app/upload
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- ls /usr/src/app/upload
  ```

### D. Redis (file d'attente des jobs et pub/sub) {#d-redis-job-queue-and-pubsub}

Immich place chaque job d'arrière-plan (génération de miniatures, extraction de
métadonnées, embeddings de recherche intelligente, détection de visages) dans une file
d'attente Redis. Par défaut, la VM du serveur NFS héberge aussi Redis et la plateforme
injecte son IP sous la forme `REDIS_HOST` ; l'entrypoint cloud la fait correspondre à
`REDIS_HOSTNAME` d'Immich et **échoue immédiatement** si elle se résout en valeur
vide.

- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<server-deploy> -- env | grep -E 'REDIS_HOST'
  ```

### E. Machine learning — recherche intelligente CLIP et reconnaissance faciale {#e-machine-learning--clip-smart-search-and-face-recognition}

Le conteneur préconstruit `ghcr.io/immich-app/immich-machine-learning` sert les
embeddings CLIP, la reconnaissance faciale et l'OCR en HTTP sur le port 3003 (interne
uniquement). Il s'agit d'inférence sur CPU — sans GPU. Son environnement définit
explicitement `IMMICH_PORT = "3003"` : le socle propage l'environnement du serveur aux
services additionnels et l'image ML lit la même variable `IMMICH_PORT` — sans cette
surcharge, elle hérite de 2283, écoute sur le mauvais port et sa sonde de démarrage
`:3003` ne réussit jamais. Le serveur la trouve via la variable injectée
`IMMICH_MACHINE_LEARNING_URL`, définie via `module_env_vars` sur le **véritable nom DNS
du Service Kubernetes** (`http://<service>-ml:3003` — le Service est nommé
`<service>-ml`) ; le mécanisme `output_env_var_name` du socle compose une URL à nom nu
impossible à résoudre (`http://ml:3003`), si bien que sa sortie est mise de côté dans
la variable d'environnement inutilisée `IMMICH_ML_URL_FOUNDATION_UNUSED`. Les fichiers
de modèles sont téléchargés à la demande **lors de la première utilisation** dans
`/cache` sur le disque éphémère du pod (de nouveau téléchargés après une
replanification — compromis accepté).

- **CLI :**
  ```bash
  kubectl get pods -n "$NAMESPACE" | grep ml
  kubectl logs -n "$NAMESPACE" deploy/<ml-deploy> --tail=50    # model downloads + inference requests
  ```

### F. Cloud Build et Artifact Registry {#f-cloud-build--artifact-registry}

L'image du serveur est un build personnalisé minimal
(`FROM ghcr.io/immich-app/immich-server` plus l'entrypoint cloud) produit par Cloud
Build et stocké dans Artifact Registry. L'ARG de build `IMMICH_VERSION` porte le tag
résolu — volontairement propre à l'application, car le socle injecte `APP_VERSION` et
l'emporte lors de la fusion, et Immich n'a pas de tag `latest`.

- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/"$PROJECT"/<repo> 2>/dev/null | grep immich
  ```

### G. Réseau, Logging et Monitoring {#g-networking-logging--monitoring}

L'accès externe s'effectue via une IP Cloud Load Balancing
(`service_type = LoadBalancer`) ; un domaine personnalisé avec certificat géré et une
IP statique réservée sont activés par défaut (`enable_custom_domain = true`,
`reserve_static_ip = true`).

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Immich {#3-immich-application-behaviour}

- **L'entrypoint cloud fait correspondre les noms des variables d'environnement à
  l'exécution.** Le `cloud-entrypoint.sh` de l'image personnalisée fait correspondre
  `DB_HOST`/`DB_IP` injectés par le socle → `DB_HOSTNAME`
  (en réécrivant un chemin de répertoire de socket de l'Auth Proxy en `127.0.0.1` TCP),
  `DB_USER` → `DB_USERNAME`, `DB_NAME` → `DB_DATABASE_NAME`, et `REDIS_HOST` →
  `REDIS_HOSTNAME`/`REDIS_PORT` — le socle peut injecter `REDIS_HOST` sous la forme
  `host` ou `host:port` ; l'entrypoint le scinde donc en un nom d'hôte nu et un port
  (`6379` par défaut en l'absence de port). Des références Kubernetes `$(VAR)` ne
  pourraient pas le faire : K8s ne résout `$(VAR)` qu'à partir des entrées
  d'environnement définies *plus tôt* dans la liste rendue par ordre alphabétique, et
  `DB_DATABASE_NAME` est trié avant `DB_NAME` ; `$(DB_NAME)` resterait donc une chaîne
  littérale. `DB_PASSWORD` ne nécessite aucun mappage. L'entrypoint résout également
  le script de démarrage amont selon la disposition de l'image — Immich v3 a déplacé
  l'application vers `/usr/src/app/server` (script de démarrage à
  `server/bin/start.sh`) tandis que les images plus anciennes conservent
  `/usr/src/app/start.sh` ; les deux sont testés et le répertoire de travail est
  ajusté avant l'`exec`. L'entrypoint affiche la configuration résolue en tête du
  journal du pod — toujours le premier endroit où regarder.
- **Initialisation de la base de données au premier déploiement.** Le job `db-init`
  (`postgres:15-alpine`) exécute `db-init.sh` de manière idempotente : utilisateur,
  base de données, droits, extensions `pgvector` + `earthdistance`, et attribution de
  `cloudsqlsuperuser` afin que les migrations amont puissent gérer elles-mêmes les
  extensions. Immich applique ses propres migrations de schéma à chaque démarrage.
- **Rédacteur unique, déploiements en Recreate.** Comme la médiathèque est un seul
  système de fichiers NFS et que les workers de jobs s'exécutent dans le processus,
  un seul réplica est autorisé (validé au moment du plan), et les mises à jour de
  version remplacent le pod avec `Recreate` (brève interruption) plutôt qu'avec un
  déploiement progressif.
- **La recherche intelligente et la reconnaissance faciale sont asynchrones.** Après
  un envoi, le serveur place en file d'attente des jobs qui appellent le service ML ;
  la première requête de recherche intelligente déclenche aussi le téléchargement du
  modèle CLIP, et elle est donc nettement lente une fois par durée de vie d'un pod
  ML. La progression des jobs est visible dans l'interface web sous Administration →
  Jobs.
- **Administrateur au premier lancement.** Lors de la première visite, l'interface
  web affiche l'écran d'inscription ; le premier compte enregistré devient
  l'administrateur. Les applications iOS/Android d'Immich se connectent à la même URL
  de serveur pour la sauvegarde automatique depuis le mobile.
- **La télémétrie est désactivée** (`IMMICH_TELEMETRY_INCLUDE = ""`) et `IMMICH_ENV =
  production` ; l'API et les workers d'arrière-plan s'exécutent dans un seul conteneur
  (l'amont a fusionné le conteneur microservices dans la v1.106).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Immich ou notables pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de repli lorsque la découverte du réseau ne peut pas la déterminer. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `immich` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag des images serveur + ML, maintenus strictement alignés. `latest` se résout en tag glissant `release` d'Immich (aucun tag `latest` n'existe en amont) ; figez `vX.Y.Z` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | Ressources du conteneur serveur. |
| `container_port` | `2283` | Port natif d'Immich (`IMMICH_PORT`). |
| `min_instance_count` | `1` | Conservez 1 pour qu'Immich soit toujours disponible. |
| `max_instance_count` | `1` | **Doit valoir 1** — validé au moment du plan (rédacteur NFS unique, workers internes au processus). |
| `ml_cpu_limit` / `ml_memory_limit` | `2000m` / `4Gi` | Ressources du conteneur de machine learning. Les modèles CLIP + visages nécessitent environ 2–3Gi résidents ; 4Gi est la valeur par défaut sûre. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Répliquer les images dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires fusionnés par-dessus les valeurs par défaut d'Immich (`IMMICH_PORT`, `IMMICH_MEDIA_LOCATION`, `DB_VECTOR_EXTENSION`, `IMMICH_ENV`, télémétrie). Ne définissez pas ici de `DB_*`/`REDIS_*` — l'entrypoint gère ce mappage. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface web et les applications mobiles. |
| `session_affinity` | `ClientIP` | Routage persistant (réplica unique, donc surtout sans objet). |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `60` | Délai de grâce avant l'arrêt forcé. |
| `deployment_timeout` | `1800` | Nombre de secondes pendant lesquelles Terraform attend le déploiement. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/server/ping`, délai de 30s, 30×10s | Sonde de démarrage de l'application (Groupe 14 sur la plateforme). |
| `liveness_probe` | HTTP `/api/server/ping`, délai de 30s | Sonde de vivacité de l'application. |
| `uptime_check_config` | désactivé, chemin `/api/server/ping` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 11 — Jobs et services additionnels {#group-11--jobs--additional-services}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Immich migre son propre schéma au démarrage. |
| `additional_services` | `[]` | Ajoutés après le service de machine learning intégré. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Doit rester à true** — validé au moment du plan. Toute la médiathèque réside sur NFS ; Immich n'a pas de backend S3/GCS. |
| `nfs_mount_path` | `/usr/src/app/upload` | Monté exactement sur `IMMICH_MEDIA_LOCATION`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `immich_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `immich_user` | Utilisateur applicatif de la base de données. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques de la base de données et du NFS (UTC). |
| `backup_retention_days` | `7` | À augmenter en production — la bibliothèque NFS est l'unique copie de vos photos. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Gateway API + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** les applications mobiles Immich s'authentifient auprès du
> serveur Immich, et non de Google — placer IAP devant l'API casse la sauvegarde
> automatique depuis le mobile, sauf si chaque appareil peut mener à bien le parcours
> de connexion Google.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Requiert un domaine personnalisé et les deux identifiants OAuth (validé). |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Doit rester à true** — validé au moment du plan ; Immich refuse de démarrer sans Redis. |
| `redis_host` | `""` | Vide = l'IP du Redis hébergé sur le serveur NFS est injectée. |
| `enable_cloud_armor` | `false` | Associer une règle WAF au backend de l'Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Entrées App_GKE standard : `enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`,
`organization_id`, `enable_audit_logging`. Consultez [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécutent les charges de travail. |
| `service_cluster_ip` / `stage_service_cluster_ips` | ClusterIP internes au cluster. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `web_url` | URL de l'interface web d'Immich — IP du LoadBalancer externe si disponible, sinon URL interne du cluster. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Détails du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs d'initialisation et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` et sorties GitHub/déclencheur | État et détails de la CI/CD. |
| `kubernetes_ready` | Indique si toutes les ressources Kubernetes ont été déployées (false lors du premier apply d'un nouveau cluster intégré (inline)). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan.** `Immich_GKE` comporte ses propres garde-fous de
> validation en plus des contrôles du socle [App_GKE](App_GKE.md) : `enable_nfs = false`,
> `enable_redis = false`, `max_instance_count > 1`, Redis sans source d'hôte et IAP
> sans identifiants OAuth font tous échouer le **plan** avec une erreur nommée avant la
> création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` (validé) | Critique | Avec NFS désactivé, toute la médiathèque se trouve sur le disque éphémère du pod — **chaque replanification du pod efface toutes les photos et vidéos**. Immich n'a aucun backend S3/GCS de repli. Bloqué au moment du plan. |
| `max_instance_count` | `1` (validé) | Critique | Plus d'un réplica signifie plusieurs rédacteurs sur une même bibliothèque NFS et des workers de jobs dupliqués dans les processus — corruption de la bibliothèque et jobs concurrents. Bloqué au moment du plan. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données ou l'utilisateur et rend orphelines toutes les métadonnées des ressources, les albums et les utilisateurs. |
| `backup_retention_days` | À augmenter en production | Élevé | La bibliothèque NFS est l'unique copie des médias ; 7 jours de sauvegardes, c'est peu pour une archive de photos. |
| `enable_redis` / `redis_host` | `true` / `""` (validé) | Élevé | Sans Redis, le serveur s'arrête au démarrage (l'entrypoint échoue immédiatement avec une erreur explicite). Avec Redis activé mais sans NFS ni hôte explicite, `REDIS_HOST` est vide — également bloqué au moment du plan. |
| Surcharge ML de `IMMICH_PORT` | Conservez la valeur intégrée `IMMICH_PORT = "3003"` sur le service ML | Élevé | Le socle propage l'environnement du serveur aux services additionnels, et l'image ML lit la **même variable `IMMICH_PORT`** que le serveur — sans la surcharge, le conteneur ML hérite de `2283`, écoute sur le mauvais port et sa sonde de démarrage `:3003` ne réussit jamais (le Deployment ML ne devient jamais Ready). |
| `IMMICH_MACHINE_LEARNING_URL` | Ne modifiez pas l'URL DNS réelle injectée | Élevé | Le mécanisme `output_env_var_name` du socle compose l'URL à partir du nom nu du service additionnel (`http://ml:3003`), mais le Service qu'il crée s'appelle `<service>-ml` — le nom nu ne se résout pas et la recherche intelligente ainsi que la reconnaissance faciale échouent. Le module injecte l'URL DNS réelle du Service via `module_env_vars` et met de côté la valeur composée par le socle dans la variable inutilisée `IMMICH_ML_URL_FOUNDATION_UNUSED`. |
| `ml_memory_limit` | `4Gi` (par défaut ; à considérer comme un plancher) | Moyen | En deçà des quelque 2–3Gi que les modèles CLIP + visages doivent garder résidents, le chargement des modèles provoque un arrêt OOM du pod ML — **la recherche intelligente et la reconnaissance faciale échouent sans bruit alors que l'application principale paraît parfaitement saine** (les envois et la navigation fonctionnent toujours). Surveillez les redémarrages `OOMKilled` du pod ML. |
| `enable_iap` | `false` sauf si l'accès mobile est géré | Moyen | IAP intercepte l'API appelée par les applications mobiles ; la sauvegarde automatique est cassée pour les appareils qui ne peuvent pas mener à bien la connexion Google. |
| `application_version` | `latest` (→ `release`) ou un `vX.Y.Z` figé | Moyen | Définir un tag qui n'existe pas en amont fait échouer le build ou le tirage ; les tags serveur et ML sont maintenus alignés automatiquement — ne les faites pas pointer manuellement vers des versions différentes. |
| Mises à jour de version | Prévoir une brève interruption | Faible | Les applications adossées à NFS sont déployées avec la stratégie `Recreate` — l'ancien pod s'arrête avant le démarrage du nouveau. C'est intentionnel (les mises à jour progressives provoquent un interblocage sur la bibliothèque partagée). |
| pgvector ou VectorChord | Accepter pgvector sur Cloud SQL | Faible | La construction des index de recherche intelligente et les requêtes sont plus lentes qu'avec VectorChord, l'extension privilégiée par Immich — attendu sur Cloud SQL, qui ne propose pas VectorChord. Fonctionnellement complet, simplement plus lent sur les grandes bibliothèques. |
| Latence de la première requête ML | Prévoir une première recherche lente | Faible | Les modèles CLIP/visages sont téléchargés lors de la première utilisation (cache sur disque éphémère, de nouveau téléchargé après une replanification du pod ML) — la première requête de recherche intelligente après un déploiement est lente. |
| Chemin de la sonde de démarrage | `/api/server/ping` | Faible | Tout point de terminaison authentifié renvoie 401/403 à la sonde kubelet non authentifiée et bloque le déploiement ; conservez la valeur par défaut. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La couche applicative partagée propre à Immich (image,
entrypoint, amorçage de la base de données, sondes) est décrite dans
**[Immich_Common](Immich_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Immich sur GKE Autopilot](../labs/Immich_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Immich Common — Configuration applicative partagée](Immich_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md), [Kopia sur GKE Autopilot](Kopia_GKE.md) dans la solution **Personal Cloud**.
