---
title: "Chibisafe sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Chibisafe sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chibisafe_CloudRun.md @ 15fd4c7 sha256:93a9df66a9fe -->

# Chibisafe sur Google Cloud Run {#chibisafe-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chibisafe_CloudRun.png" alt="Chibisafe sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chibisafe est un téléchargeur de fichiers et d'images auto-hébergé avec un
tableau de bord moderne, des téléchargements par glisser-déposer, des albums
et une API publique. Ce module déploie la **pile Chibisafe complète** —
l'interface utilisateur web à `/`, l'API REST sous `/api`, la
référence OpenAPI à `/docs`, et les fichiers téléchargés servis par nom —
en tant que service unique sur **Cloud Run v2**, au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée. L'amont livre Chibisafe sous forme de
trois conteneurs (le backend chibisafe-server, un frontend Next.js et un
proxy inverse Caddy) ; ce module les combine en une seule image construite
sur mesure.

> **Statut :** l'image full-stack n'a pas encore été construite ou déployée,
> le comportement ci-dessous est donc décrit à partir de la source du module
> et de la version `v6.5.5` de l'amont, non vérifié en direct.

Ce guide se concentre sur les services cloud utilisés par Chibisafe et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chibisafe s'exécute en tant que conteneur unique, construit sur mesure, sur
Cloud Run v2 — Caddy devant deux processus Node.js (backend et frontend) —
sans base de données externe. Le déploiement connecte un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Image full-stack construite sur mesure (Caddy sur le port 8000 → backend + frontend Next.js sur loopback) ; 1 vCPU / 1 GiB par défaut ; `min=max=1` (instance unique) |
| Base de données | Aucune | Chibisafe conserve sa base de données SQLite, ses téléchargements et ses journaux sur le volume monté — aucune instance Cloud SQL n'est créée |
| Stockage persistant | Cloud Storage (GCS Fuse) | Un bucket `storage` est toujours provisionné et monté à `/data` via GCS Fuse (nécessite `gen2`) ; **pas** un périphérique de bloc durable |
| Secrets | Secret Manager | Optionnel `ADMIN_PASSWORD` (géré par `enable_api_key`, désactivé par défaut) |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, publique par défaut (`ingress_settings = "all"`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule "base de données".** `database_type` est fixé à `NONE` par
  `Chibisafe_Common` ; les nombreuses variables `database_*`/`db_*`/`sql_instance_*`
  reflétées dans `variables.tf` existent uniquement pour la parité de convention de la
  Fondation et n'ont aucun effet.
- **La persistance est GCS Fuse, pas un périphérique de bloc — et le module le
  précise.** Cloud Run n'a pas d'option PVC/stockage par blocs, donc le
  bucket `storage` unique est monté à `/data` via GCS Fuse. Le
  propre `module_description` de ce module avertit explicitement : *"Envisagez
  Chibisafe_GKE avec un PVC de bloc pour un stockage SQLite durable en
  production."* Les sémantiques de verrouillage de fichiers POSIX de GCS Fuse
  sont plus faibles qu'un véritable système de fichiers, ce qui est un risque
  réel pour une application SQLite à un seul rédacteur sous une charge
  d'écriture soutenue.
- **Instance unique, rédacteur unique.** `min_instance_count = max_instance_count
  = 1` par défaut — ne pas
  dépasser 1 sans repenser le stockage.
- **Image construite sur mesure avec une version spécifique à l'application.**
  Le Dockerfile est basé sur `chibisafe/chibisafe-server` (backend à `/app`),
  copie le frontend Next.js `chibisafe/chibisafe` (`/opt/chibisafe-web`) et un binaire
  Caddy `2.11.4` statique, et lit son propre argument de build `CHIBISAFE_VERSION`
  (pas le générique `APP_VERSION` que la Fondation injecte ; une balise épingle
  backend et frontend) ; `application_version = "latest"` est épinglé à `v6.5.5` au
  moment de la construction.
- **Pas de Redis, jamais.** Le module reflète une variable `enable_redis`
  (par défaut `true`) pour la parité de convention de la Fondation, mais
  `main.tf` transmet toujours `enable_redis = false` à App_CloudRun
  indépendamment de sa valeur — Chibisafe n'a pas de dépendance Redis.
- **`enable_cloudsql_volume` est inerte.** Sa valeur par défaut déclarée est déjà
  `false`, et `main.tf` code en dur `enable_cloudsql_volume = false`
  dans l'appel à App_CloudRun — la valeur de la variable est ignorée dans les
  deux cas.
- **Ingress public par défaut.** `ingress_settings = "all"` — Chibisafe est une
  interface utilisateur publique de téléchargement/hébergement de fichiers
  consultée directement. (Ce module a été précédemment affecté par un bug
  généralisé où le boilerplate "charge de travail de base de données"
  copié-collé définissait par défaut `ingress_settings` à `"internal"` ; la
  source actuelle confirme que la valeur par défaut ici est correctement
  `"all"`.)
- **Mot de passe administrateur.** Le compte propriétaire de première
  exécution de Chibisafe est `admin`. Avec `enable_api_key = true` (la valeur par
  défaut de ce module, et requise par une règle de protection au moment de la
  planification lorsque `ingress_settings = "all"`), son mot de passe est une valeur
  aléatoire de 24 caractères `ADMIN_PASSWORD` de Secret Manager ; sinon, c'est le
  mot de passe par défaut bien connu de l'amont `admin` — changez-le
  immédiatement après la première connexion.
- **Le chemin de santé est `/api/health`.** Les sondes `startup_probe` /
  `liveness_probe` de ce module ciblent `/api/health` via le proxy Caddy
  intégré au conteneur : un `200 {"status":"yes"}` littéral, non authentifié, qui
  prouve que le proxy et le backend fonctionnent. `/` est l'interface
  utilisateur web, dont le code d'état est le choix du frontend plutôt qu'un
  signal de santé. Les variables séparées `startup_probe_config` / `health_check_config`
  (maintenant également par défaut à `/api/health`) sont remplacées pour ce
  module — voir §6.
- **Les téléchargements de plus de 32 Mo nécessitent une taille de bloc plus
  petite.** Voir §3.
- **Tout l'état réside sous un seul montage.** Le point d'entrée lie
  symboliquement les répertoires `/app/database`, `/app/uploads` et `/app/logs`
  de l'image dans des sous-répertoires du volume GCS Fuse unique
  (`/data`), migrant tout contenu amorcé par l'image sur le volume vide
  lors du premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Chibisafe {#a-cloud-run--the-chibisafe-service}

Chibisafe s'exécute en tant que service Cloud Run v2 unique. Chaque
déploiement crée une révision immuable ; avec `min=max=1`, il y a
normalement exactement une instance de conteneur active.

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

### B. Cloud Storage — le volume d'état persistant {#b-cloud-storage--the-persistent-state-volume}

Chibisafe n'a pas de service de base de données à inspecter — tout son état
(base de données SQLite, fichiers téléchargés et journaux) réside sur le
bucket Cloud Storage unique monté via GCS Fuse à `/data` (nécessite
`execution_environment = "gen2"`). Chibisafe_Common provisionne toujours ce bucket `storage` ;
des buckets supplémentaires peuvent être déclarés via `storage_buckets`, et des
montages GCS Fuse supplémentaires via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les mécanismes de montage GCS Fuse
et les options CMEK.

### C. Secret Manager {#c-secret-manager}

Chibisafe ne génère **aucun secret par défaut**. Le seul secret optionnel est
un mot de passe administrateur aléatoire, géré par `enable_api_key` (par défaut
`true` dans ce module) : lorsqu'il est activé, une valeur aléatoire de
24 caractères est stockée dans Secret Manager (suffixe de nom `api-key`) et
injectée en tant que variable d'environnement `ADMIN_PASSWORD` via le chemin de
référence standard de Cloud Run Secret Manager — le backend de Chibisafe
initialise son compte administrateur de première exécution à partir de cette
valeur au lieu du mot de passe par défaut bien connu de l'amont.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation. Notez que (contrairement à la variante GKE) le `outputs.tf` de ce
module ne fait **pas** apparaître le nom du secret généré en tant que sortie
— localisez-le avec le filtre `gcloud secrets
list` ci-dessus.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut
(`ingress_settings = "all"`), ce qui convient à une interface utilisateur publique de
téléchargement/hébergement de fichiers. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté via `enable_cloud_armor`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring. Les tests de disponibilité et les
stratégies d'alerte optionnels sont désactivés par défaut (`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chibisafe {#3-chibisafe-application-behaviour}

- **Pas de job d'initialisation ou de migration.** Chibisafe gère son propre
  stockage SQLite ; `Chibisafe_Common` n'injecte pas de job `db-init`/migration
  (`database_type =
  NONE`). La variable `initialization_jobs` est transmise à la fondation
  mais n'est utile que pour les tâches de chargement de données personnalisées.
- **Relocalisation de l'état au premier démarrage.** L'image conserve l'état
  mutable sous trois répertoires frères dans son WORKDIR — `/app/database`
  (SQLite), `/app/uploads` (fichiers/miniatures) et `/app/logs`. Le
  point d'entrée (`entrypoint.sh`) lie symboliquement chacun d'eux dans un
  sous-répertoire du montage GCS Fuse unique (`/data`), migrant tout
  contenu amorcé par l'image dans le volume vide lors du premier démarrage.
  C'est idempotent lors des redémarrages — les répertoires déjà liés
  symboliquement sont laissés tels quels. Le même script de point d'entrée
  est partagé avec la variante GKE, qui monte un PVC de bloc au même chemin
  à la place.
- **Compte administrateur.** Au premier démarrage, le backend crée le compte
  propriétaire `admin`. Si `enable_api_key = true` (la valeur par défaut), une
  valeur aléatoire est générée et injectée en tant que `ADMIN_PASSWORD`, que le
  backend utilise comme mot de passe de ce compte au lieu du mot de passe par
  défaut bien connu de l'amont (`admin`) ; sinon, connectez-vous avec
  `admin`/`admin` et changez-le immédiatement. `ADMIN_PASSWORD`
  est transmis uniquement au processus backend — le point d'entrée le supprime
  de l'environnement du frontend et de Caddy.
- **Pas d'alias de variable d'environnement de base de données.** `database_type = NONE`
  — il n'y a pas d'injection ou d'alias `DB_HOST`/`DB_USER` à
  craindre ; SQLite réside entièrement sur le volume GCS Fuse `/data`.
- **Processus et ports.** `tini` est le PID 1 ; le point d'entrée
  (après la relocalisation de l'état ci-dessus) démarre trois processus :

  | Processus | Écoute sur | Sert |
  |---|---|---|
  | Caddy | `0.0.0.0:$PORT` (= `container_port`, par défaut `8000`) | Le seul écouteur vers lequel Cloud Run achemine |
  | chibisafe-server backend | `127.0.0.1:18000` (loopback uniquement) | `/api/*`, `/docs*` |
  | Frontend Next.js | `127.0.0.1:18001` (loopback uniquement) | L'interface utilisateur web |

  Ils sont supervisés en mode **fail-fast** : si l'un d'eux se termine, les
  autres sont arrêtés et le conteneur se termine avec le statut 1, de sorte
  que Cloud Run le redémarre (choisi plutôt que supervisord, qui maintiendrait
  un conteneur en bonne santé avec un frontend mort).
- **Routage** (Caddyfile `v6.5.5` de l'amont, même ordre) : tout chemin
  nommant un fichier sous `/data/uploads` est servi directement par Caddy (le
  backend ne sert pas les téléchargements en production) ; `/api/*` →
  backend (l'API REST — voir la sortie `api_url`) ; `/docs*` →
  backend (la référence OpenAPI Scalar) ; tout le reste → frontend (l'interface
  utilisateur web à `/`, par exemple `/dashboard`, `/login`).
  Deux déviations par rapport à l'amont : l'en-tête `Host` est
  préservé, de sorte que les liens de fichiers construits par le backend sont
  corrects sans définir "Servir les téléchargements depuis" ; et
  `X-Forwarded-For`/`X-Real-IP` sont définis sur l'adresse IP du client que Caddy
  résout lui-même (plages Google front-end fiables, sélection stricte la plus
  à droite), de sorte qu'un client ne peut pas les usurper.
- **Frontend → backend.** Le rendu côté serveur du frontend appelle le
  backend directement à `BASE_API_URL=http://127.0.0.1:18000`, défini par le point d'entrée — rien
  ne repose sur l'interpolation de `$(VAR)` par Cloud Run, ce qu'il ne
  fait pas. Le navigateur appelle le `/api` de même origine.
- **Environnement du conteneur.** `NODE_ENV=production` est la seule valeur par défaut
  à l'échelle du conteneur ; `HOST`/`HOSTNAME`/`PORT` pour les
  deux processus Node sont définis par processus par le point d'entrée.
  `PORT` n'est délibérément **pas** injecté par `Chibisafe_Common`
  car Cloud Run réserve ce nom de variable d'environnement et le définit
  automatiquement à partir de `container_port` — l'injecter explicitement
  provoquerait une erreur 400 lors de l'appel de création de service. Caddy
  écoute sur ce `PORT`.
- **`container_port` est actif ici (contrairement à la variante GKE).** `chibisafe.tf`
  fusionne `container_port = var.container_port` dans la configuration du module que la Fondation lit,
  donc changer cette variable modifie réellement le port vers lequel Cloud Run
  route et la valeur `PORT` sur laquelle Caddy écoute. Il ne doit pas
  être `18000` ou `18001` (les ports internes) ; le conteneur
  refuse de démarrer.
- **Téléchargements de plus de 32 Mo.** Cloud Run plafonne un corps de
  requête HTTP/1 à 32 Mo, et la taille de bloc de téléchargement par défaut
  de Chibisafe est d'environ 81 Mo, de sorte que les téléchargements de
  fichiers de plus de 32 Mo échouent sur Cloud Run jusqu'à ce qu'un
  administrateur réduise la **taille de bloc** dans les paramètres du tableau
  de bord (par exemple à 25-30 Mo). Ceci est dérivé de la source amont et de
  la limite documentée de Cloud Run, non mesuré en direct. `Chibisafe_GKE`
  derrière un équilibreur de charge n'a pas une telle limite.
- **Mémoire.** Le `1Gi` par défaut contient maintenant deux processus
  Node plus Caddy ; cela n'a pas encore été mesuré en direct — augmentez
  `memory_limit` si les révisions sont tuées par manque de mémoire.
- **Mise à jour d'un déploiement existant.** Une MISE À JOUR d'un
  déploiement effectué avec la version précédente uniquement backend
  reconstruit l'image automatiquement (le hachage de contenu du répertoire
  scripts change), conserve le port `8000`, supprime la variable
  d'environnement `HOST=0.0.0.0` à l'échelle du conteneur (maintenant définie
  par processus) et laisse les données sur `/data` intactes. `/`
  passe d'une réponse JSON 404 à l'interface utilisateur web.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  **HTTP** `GET
  /api/health` (variables `startup_probe`/`liveness_probe` de ce
  module, par défaut `initial_delay_seconds = 15` / `30`), envoyées via Caddy
  au backend, qui renvoie un 200 littéral une fois le service démarré, sans
  authentification requise. Voir §6 pour savoir pourquoi les variables
  séparées `startup_probe_config` / `health_check_config` n'ont en fait aucune
  importance ici.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)'
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Chibisafe sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chibisafe` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Chibisafe` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Balise d'image `chibisafe/chibisafe-server` ; `latest` est épinglé à `v6.5.5` au moment de la construction via l'argument de construction `CHIBISAFE_VERSION` spécifique à l'application. |
| `enable_api_key` | `true` | Génère une valeur aléatoire de 24 caractères dans Secret Manager, injectée en tant que `ADMIN_PASSWORD`, initialisant le mot de passe administrateur de première exécution au lieu de la valeur par défaut de l'amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | 1 GiB par défaut. Le texte de description mentionne "index vectoriels"/"collections" — un artefact de copier-coller d'un module de base de données vectorielle ; ignorez la formulation, la valeur par défaut est correcte. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Gardez à 1 — Chibisafe est une application SQLite à un seul rédacteur sur un montage GCS Fuse. |
| `container_port` | `8000` | Le port du proxy Caddy. Actif (voir §3) — modifie à la fois la route Cloud Run et la variable d'environnement `PORT` injectée. Ne doit pas être `18000`/`18001`. |
| `execution_environment` | `gen2` | Requis pour le montage GCS Fuse `/data`. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0-3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Inerte** — `main.tf` code en dur `false` à la Fondation quelle que soit la valeur de cette variable. Chibisafe n'a pas de base de données Cloud SQL. |
| `container_protocol` | `http1` | La description mentionne "requis pour Chibisafe gRPC" — un autre artefact de copier-coller ; Chibisafe n'a pas d'interface gRPC. Laissez à `http1`. |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes de service Cloud Run personnalisées. |
| `enable_image_mirroring` | `true` | Miroir de l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non transmis par le `main.tf` de ce module. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / `{enabled=true}` / `{1000m,512Mi}` | Espaces réservés inertes, reflétés par la Fondation — la construction réelle (Dockerfile, argument de construction `CHIBISAFE_VERSION`) provient de la configuration fixe de `Chibisafe_Common`, pas de ces variables. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut — Chibisafe est une interface utilisateur de téléchargement de fichiers directement consultée. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `NODE_ENV=production` et `HOST=0.0.0.0` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` sont transmis à la
Fondation mais sont une opération nulle — Chibisafe n'a pas de base de
données SQL (`database_type =
NONE`).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis (inerte) {#group-11--storage-filesystem--redis-inert}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` toujours présent. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : la base de données SQLite de Chibisafe, les téléchargements et les journaux résident sous `/data`, et GCS FUSE ne peut pas héberger une base de données SQLite. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur (pertinent uniquement si `enable_nfs` est défini). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires. Le bucket Chibisafe `storage` est automatiquement ajouté à `/data`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (reflété, **inerte**) | Déclaré uniquement pour la parité de convention de la Fondation — `main.tf` transmet toujours `enable_redis = false` à App_CloudRun quelle que soit cette valeur. Chibisafe n'a pas de dépendance Redis. |

### Groupe 12 — Backend de base de données (non applicable) {#group-12--database-backend-not-applicable}

`database_type` est fixé à `NONE` par `Chibisafe_Common`. Toutes les autres
variables du Groupe 12 — `sql_instance_name`, `sql_instance_base_name`,
`database_password_length`, `application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`,
`enable_mysql_plugins`/`mysql_plugins`,
`enable_postgres_extensions`/`postgres_extensions`,
`enable_auto_password_rotation`/`rotation_propagation_delay_sec` — sont déclarées
purement pour la mise en miroir des conventions de la Fondation et n'ont aucun
effet sur ce module.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut n'est injecté ; utilisez uniquement pour des tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés récurrents ; aucun par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai initial de 15s | La sonde de démarrage effective et active (voir §3). |
| `liveness_probe` | HTTP `/api/health`, délai initial de 30s | La sonde de vivacité effective et active. |
| `startup_probe_config` | HTTP `/api/health`, activée | **Inerte pour ce module** — la fondation d'App_CloudRun préfère toujours la sonde `startup_probe` spécifique à l'application fournie via `application_config` à cette variable autonome, donc la modifier n'a aucun effet sur la sonde déployée. |
| `health_check_config` | HTTP `/api/health`, activée | Même inertie que `startup_probe_config` — `liveness_probe` (Groupe 14, ci-dessus) est ce qui est réellement déployé. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `organization_id` | `""` | Remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_url` | URL de l'interface utilisateur web de Chibisafe (servie à `/`). La même origine sert l'API REST sous `/api`, la référence OpenAPI à `/docs` et les fichiers téléchargés par nom. |
| `api_url` | URL de base de l'API REST (`<service_url>/api`), pour les clients de téléchargement et les scripts ; `GET <api_url>/health` renvoie `200 {"status":"yes"}`. |
| `service_name` | Nom du service Cloud Run. |
| `chibisafe_url` | Alias de `service_url` (l'interface utilisateur web) ; accessible uniquement depuis le même VPC lorsque `ingress_settings` est `internal`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsque `enable_cloud_armor` est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs d'initialisation personnalisés. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

Notez l'absence de sortie pour le secret optionnel `enable_api_key` — contrairement
à `Chibisafe_GKE` (qui expose `chibisafe_api_key_secret_id`), ce module ne fait pas
apparaître le nom du secret généré ; trouvez-le via `gcloud secrets list
--filter="name~chibisafe"`.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs *et les combinaisons* au moment de la planification
> — un `container_port`/`timeout_seconds`/`backup_retention_days` hors plage, un
> runtime `gen1` combiné à `gcs_volumes`, un `traffic_split`
> invalide. Une configuration invalide échoue à la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que
> la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au
> moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Modèle de persistance | GCS Fuse `/data` (seule option de ce module) | Critique | SQLite sur les sémantiques de verrouillage de fichiers POSIX de GCS Fuse n'est pas entièrement sûr sous des écritures soutenues/concurrentes. Les métadonnées du module recommandent explicitement `Chibisafe_GKE` (PVC de bloc) pour un stockage de production durable ; utilisez cette variante Cloud Run uniquement pour les téléchargeurs légers/à faible trafic. |
| `max_instance_count` | `1` | Critique | Chibisafe est une application SQLite à un seul rédacteur ; la mise à l'échelle au-delà d'une instance risque de corrompre la base de données SQLite sur le montage GCS Fuse partagé par des rédacteurs concurrents. |
| `startup_probe` / `liveness_probe` `path` | `/api/health` | Moyen | `/api/health` est un 200 littéral via le proxy vers le backend. `/` est l'interface utilisateur web, dont le code d'état est le choix du frontend, donc une sonde à cet endroit n'est pas un signal de santé fiable. |
| `container_port` | `8000` | Moyen | `18000`/`18001` entrent en collision avec les ports internes du backend/frontend et le conteneur refuse de démarrer. |
| Taille de bloc de téléchargement | réduire à 25-30 Mo dans les paramètres du tableau de bord | Moyen | Le plafond de 32 Mo du corps de requête HTTP/1 de Cloud Run rejette les blocs par défaut de ~81 Mo de Chibisafe, de sorte que les téléchargements de fichiers de plus de 32 Mo échouent (dérivé de la source amont, non mesuré en direct). |
| `enable_api_key` | `true` pour tout déploiement en dehors d'un réseau de confiance | Élevé | Avec `ingress_settings = all` (la valeur par défaut) et `enable_api_key = false`, la règle de protection au moment de la planification rejette la configuration ; sans cela, le compte `admin` conserverait le mot de passe bien connu de l'amont `admin` jusqu'à ce que quelqu'un le change. |
| `ingress_settings` | `all` | Moyen | Confirmez que votre copie de travail de ce module n'a pas régressé à `internal` — un bug historique de copier-coller à l'échelle de la flotte a défini par défaut le `ingress_settings` de plusieurs modules à `internal`, ce qui rendrait ce téléchargeur de fichiers public complètement inaccessible malgré la réussite des contrôles de santé. |
| `startup_probe_config` / `health_check_config` | laisser tel quel ; comprendre qu'ils sont inertes | Faible | La fondation d'App_CloudRun préfère toujours les sondes `startup_probe`/`liveness_probe` spécifiques à l'application fournies via `application_config` à ces variables autonomes lorsque les deux sont présentes, donc la modification de ces deux n'a aucun effet sur la sonde déployée. |
| `enable_cloudsql_volume` | `false` (seule valeur qui compte) | Faible | `main.tf` code en dur `false` à la Fondation quelle que soit la valeur de cette variable ; Chibisafe n'a pas de base de données Cloud SQL. |
| `enable_redis` | toute valeur (inerte) | Faible | `main.tf` transmet toujours `enable_redis = false` — la modification de cette variable n'a aucun effet ; ne vous fiez pas à elle pour ajouter la connectivité Redis. |
| `memory_limit` / `min_instance_count` / `container_protocol` descriptions | ignorer la formulation | Faible | Le texte de description de ces variables fait référence à des "index vectoriels", des "collections", du "chargement d'index" et du "gRPC" — un copier-coller résiduel d'un modèle de module de base de données vectorielle. Chibisafe est un téléchargeur de fichiers sans rien de tout cela ; les valeurs par défaut numériques/chaînes elles-mêmes (`1Gi`, `1`, `http1`) sont correctes et non affectées. |
| `database_type` / `db_*` / `sql_instance_*` variables | `NONE` / inertes | Faible | Chibisafe n'a pas de base de données SQL ; celles-ci existent uniquement pour la mise en miroir des variables de la Fondation et sont ignorées silencieusement. |
| `enable_api_key` découvrabilité du secret | utiliser `gcloud secrets list --filter="name~chibisafe"` | Faible | Le `outputs.tf` de ce module n'expose pas le nom du secret généré en tant que sortie (contrairement au `Chibisafe_GKE` de `chibisafe_api_key_secret_id`). |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La
configuration d'application spécifique à Chibisafe partagée avec la variante
GKE se trouve dans le module `Chibisafe_Common` (`modules/Chibisafe_Common/README.md`) ; la
variante GKE elle-même est documentée dans **[Chibisafe_GKE](Chibisafe_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chibisafe sur Cloud Run](../labs/Chibisafe_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Chibisafe sur GKE Autopilot](Chibisafe_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chibisafe Common — Configuration d'application partagée](Chibisafe_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md), [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) dans la solution **Partage et transfert de fichiers**.
