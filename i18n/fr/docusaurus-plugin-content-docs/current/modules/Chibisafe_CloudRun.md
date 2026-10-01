---
title: "Chibisafe sur Google Cloud Run"
description: "Référence de configuration pour déployer Chibisafe sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Chibisafe_CloudRun.md @ 3055034 sha256:f142356c09e6 -->

# Chibisafe sur Google Cloud Run {#chibisafe-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chibisafe_CloudRun.png" alt="Chibisafe sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chibisafe est un outil auto-hébergé de téléversement de fichiers et d'images,
doté d'un tableau de bord moderne, du téléversement par glisser-déposer,
d'albums et d'une API publique. Ce module déploie la **pile Chibisafe complète**
— l'interface web à `/`, l'API REST sous `/api`, la référence OpenAPI à `/docs`
et les fichiers téléversés servis par leur nom — sous la forme d'un seul service
sur **Cloud Run v2**, en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée. En amont,
Chibisafe est distribué sous forme de trois conteneurs (le backend
chibisafe-server, un front-end Next.js et un reverse proxy Caddy) ; ce module
les regroupe dans une seule image construite sur mesure.

> **Statut :** l'image de la pile complète n'a pas encore été construite ni
> déployée ; le comportement décrit ci-dessous est donc tiré du code source du
> module et de la version amont `v6.5.5`, et non vérifié en conditions réelles.

Ce guide se concentre sur les services cloud utilisés par Chibisafe et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chibisafe s'exécute sous la forme d'un unique conteneur construit sur mesure sur
Cloud Run v2 — Caddy devant deux processus Node.js (backend et front-end) — sans
base de données externe. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Image complète construite sur mesure (Caddy sur le port 8000 → backend + front-end Next.js sur la boucle locale) ; 1 vCPU / 1 GiB par défaut ; `min=max=1` (instance unique) |
| Base de données | Aucune | Chibisafe conserve sa base SQLite, ses fichiers téléversés et ses journaux sur le volume monté — aucune instance Cloud SQL n'est créée |
| Stockage persistant | Cloud Storage (GCS Fuse) | Un bucket `storage` est toujours provisionné et monté sur `/data` via GCS Fuse (nécessite `gen2`) ; ce n'est **pas** un périphérique bloc durable |
| Secrets | Secret Manager | `ADMIN_PASSWORD` facultatif (contrôlé par `enable_api_key`, désactivé par défaut) |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, publique par défaut (`ingress_settings = "all"`) |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **SQLite est la seule « base de données ».** `database_type` est fixé à `NONE`
  par `Chibisafe_Common` ; les nombreuses variables `database_*`/`db_*`/`sql_instance_*`
  reprises dans `variables.tf` n'existent que par souci de cohérence avec les
  conventions du socle et n'ont aucun effet.
- **La persistance repose sur GCS Fuse, pas sur un périphérique bloc — et le
  module le dit.** Cloud Run n'offre aucune option de PVC ni de stockage bloc ;
  l'unique bucket `storage` est donc monté sur `/data` via GCS Fuse. Le propre
  `module_description` de ce module avertit explicitement : *"Consider
  Chibisafe_GKE with a block PVC for durable SQLite storage in production."* La
  sémantique de verrouillage de fichiers POSIX de GCS Fuse est plus faible que
  celle d'un vrai système de fichiers, ce qui représente un risque réel pour une
  application SQLite à rédacteur unique soumise à une charge d'écriture soutenue.
- **Instance unique, rédacteur unique.** `min_instance_count = max_instance_count
  = 1` par défaut — ne dépassez pas 1 sans repenser le stockage.
- **Image construite sur mesure avec un épinglage de version propre à
  l'application.** Le Dockerfile se base sur `chibisafe/chibisafe-server`
  (backend dans `/app`), y copie le front-end Next.js `chibisafe/chibisafe`
  (`/opt/chibisafe-web`) et un binaire Caddy `2.11.4` statique, et lit son propre
  argument de build `CHIBISAFE_VERSION` (et non le `APP_VERSION` générique
  qu'injecte le socle ; une seule étiquette épingle le backend et le front-end) ;
  `application_version = "latest"` est épinglé sur `v6.5.5` au moment du build.
- **Jamais de Redis.** Le module reprend une variable `enable_redis` (par défaut
  `true`) par souci de cohérence avec les conventions du socle, mais `main.tf`
  transmet toujours `enable_redis = false` à App_CloudRun, quelle que soit sa
  valeur — Chibisafe ne dépend pas de Redis.
- **`enable_cloudsql_volume` est inerte.** Sa valeur par défaut déclarée est déjà
  `false`, et `main.tf` code en dur `enable_cloudsql_volume = false` dans l'appel
  à App_CloudRun — la valeur de la variable est ignorée dans tous les cas.
- **Entrée publique par défaut.** `ingress_settings = "all"` — Chibisafe est une
  interface publique de téléversement et d'hébergement de fichiers consultée
  directement. (Ce module a auparavant été touché par un bug à l'échelle du parc,
  où du code standard de « charge de travail de base de données » copié-collé
  fixait `ingress_settings` à `"internal"` par défaut ; le code source actuel
  confirme que la valeur par défaut est bien `"all"` ici.)
- **Mot de passe administrateur.** Le compte propriétaire créé au premier
  démarrage de Chibisafe est `admin`. Avec `enable_api_key = true` (la valeur par
  défaut de ce module, exigée par un garde-fou au moment du plan lorsque
  `ingress_settings = "all"`), son mot de passe est un `ADMIN_PASSWORD` aléatoire
  provenant de Secret Manager ; sinon, c'est la valeur par défaut amont bien connue
  `admin` — changez-la immédiatement après la première connexion.
- **Le chemin de santé est `/api/health`.** Les sondes `startup_probe` /
  `liveness_probe` de ce module ciblent `/api/health` via le proxy Caddy du
  conteneur : un `200 {"status":"yes"}` littéral et non authentifié qui prouve
  que le proxy et le backend répondent. `/` est l'interface web, dont le code
  d'état relève du front-end plutôt que d'un signal de santé. Les variables
  distinctes `startup_probe_config` / `health_check_config` (dont la valeur par
  défaut est désormais aussi `/api/health`) sont supplantées pour ce module —
  voir §6.
- **Les téléversements de plus de 32 MiB nécessitent une taille de bloc plus
  petite.** Voir §3.
- **Tout l'état réside sous un seul point de montage.** Le point d'entrée crée des
  liens symboliques des répertoires `/app/database`, `/app/uploads` et `/app/logs`
  de l'image vers des sous-répertoires de l'unique volume GCS Fuse (`/data`), en
  migrant au premier démarrage tout contenu fourni par l'image.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Chibisafe {#a-cloud-run--the-chibisafe-service}

Chibisafe s'exécute sous la forme d'un unique service Cloud Run v2. Chaque
déploiement crée une révision immuable ; avec `min=max=1`, il y a normalement
exactement une instance de conteneur active.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume d'état persistant {#b-cloud-storage--the-persistent-state-volume}

Chibisafe n'a aucun service de base de données à inspecter — tout son état (base
SQLite, fichiers téléversés et journaux) réside dans l'unique bucket Cloud
Storage monté via GCS Fuse sur `/data` (nécessite
`execution_environment = "gen2"`). Chibisafe_Common provisionne toujours ce
bucket `storage` ; des buckets supplémentaires peuvent être déclarés via
`storage_buckets`, et des montages GCS Fuse supplémentaires via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les mécanismes de montage GCS Fuse
et les options CMEK.

### C. Secret Manager {#c-secret-manager}

Chibisafe ne génère **aucun secret par défaut**. Le seul secret facultatif est un
mot de passe administrateur aléatoire, contrôlé par `enable_api_key` (par défaut
`true` dans ce module) : lorsqu'il est activé, une valeur aléatoire de 24
caractères est stockée dans Secret Manager (suffixe de nom `api-key`) et injectée
comme variable d'environnement `ADMIN_PASSWORD` par le mécanisme standard de
référence Secret Manager de Cloud Run — le backend de Chibisafe initialise son
compte administrateur de premier démarrage avec cette valeur au lieu de la valeur
par défaut amont bien connue.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation. Notez que (contrairement à la variante GKE) le fichier `outputs.tf` de
ce module n'expose **pas** le nom du secret généré en tant que sortie —
retrouvez-le avec le filtre `gcloud secrets
list` ci-dessus.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`
(`ingress_settings = "all"`), ce qui convient à une interface publique de
téléversement et d'hébergement de fichiers. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
via `enable_cloud_armor`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring. Les tests de disponibilité et les règles
d'alerte facultatifs sont désactivés par défaut
(`uptime_check_config.enabled = false`).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Chibisafe {#3-chibisafe-application-behaviour}

- **Aucune tâche d'initialisation ni de migration.** Chibisafe gère son propre
  stockage SQLite ; `Chibisafe_Common` n'injecte aucune tâche `db-init` ni de
  migration (`database_type =
  NONE`). La variable `initialization_jobs` est transmise au socle, mais n'est
  utile que pour des tâches de chargement de données personnalisées.
- **Relocalisation de l'état au premier démarrage.** L'image conserve son état
  modifiable dans trois répertoires frères de son WORKDIR — `/app/database`
  (SQLite), `/app/uploads` (fichiers et miniatures) et `/app/logs`. Le point
  d'entrée (`entrypoint.sh`) crée un lien symbolique de chacun d'eux vers un
  sous-répertoire de l'unique montage GCS Fuse (`/data`), en migrant au premier
  démarrage tout contenu fourni par l'image vers le volume vide. L'opération est
  idempotente d'un redémarrage à l'autre — les répertoires déjà liés sont laissés
  tels quels. Le même script de point d'entrée est partagé avec la variante GKE,
  qui monte à la place un PVC bloc sur le même chemin.
- **Compte administrateur.** Au premier démarrage, le backend crée le compte
  propriétaire `admin`. Si `enable_api_key = true` (la valeur par défaut), une
  valeur aléatoire est générée et injectée comme `ADMIN_PASSWORD`, que le backend
  utilise comme mot de passe de ce compte au lieu de la valeur par défaut amont
  bien connue (`admin`) ; sinon, connectez-vous avec `admin`/`admin` et changez-le
  immédiatement. `ADMIN_PASSWORD` n'est transmis qu'au processus backend — le
  point d'entrée le retire de l'environnement du front-end et de Caddy.
- **Aucun alias de variables d'environnement de base de données.**
  `database_type = NONE` — il n'y a aucune injection ni aucun alias
  `DB_HOST`/`DB_USER` dont se soucier ; SQLite réside entièrement sur le volume
  GCS Fuse `/data`.
- **Processus et ports.** `tini` est le PID 1 ; le point d'entrée (après la
  relocalisation de l'état décrite ci-dessus) démarre trois processus :

  | Processus | Écoute sur | Sert |
  |---|---|---|
  | Caddy | `0.0.0.0:$PORT` (= `container_port`, par défaut `8000`) | Le seul écouteur vers lequel Cloud Run achemine le trafic |
  | Backend chibisafe-server | `127.0.0.1:18000` (boucle locale uniquement) | `/api/*`, `/docs*` |
  | Front-end Next.js | `127.0.0.1:18001` (boucle locale uniquement) | L'interface web |

  Ils sont supervisés en mode **fail-fast** : si l'un d'eux s'arrête, les autres
  sont arrêtés et le conteneur se termine avec le code 1, si bien que Cloud Run le
  redémarre (choix préféré à supervisord, qui laisserait un conteneur paraître
  sain avec un front-end mort).
- **Routage** (le Caddyfile amont de `v6.5.5`, dans le même ordre) : tout chemin
  désignant un fichier sous `/data/uploads` est servi directement par Caddy (le
  backend ne sert pas les fichiers téléversés en production) ; `/api/*` → backend
  (l'API REST — voir la sortie `api_url`) ; `/docs*` → backend (la référence
  OpenAPI Scalar) ; tout le reste → front-end (l'interface web à `/`, par exemple
  `/dashboard`, `/login`). Deux écarts par rapport à l'amont : l'en-tête `Host`
  est conservé, de sorte que les liens de fichiers construits par le backend sont
  corrects sans avoir à définir « Serve uploads from » ; et
  `X-Forwarded-For`/`X-Real-IP` sont fixés à l'adresse IP cliente que Caddy
  résout lui-même (plages du front-end Google approuvées, sélection stricte la
  plus à droite), si bien qu'un client ne peut pas les usurper.
- **Front-end → backend.** Le rendu côté serveur du front-end appelle directement
  le backend à `BASE_API_URL=http://127.0.0.1:18000`, défini par le point
  d'entrée — rien ne compte sur une interpolation de `$(VAR)` par Cloud Run, qu'il
  n'effectue pas. Le navigateur appelle `/api` sur la même origine.
- **Environnement du conteneur.** `NODE_ENV=production` est la seule valeur par
  défaut à l'échelle du conteneur ; `HOST`/`HOSTNAME`/`PORT` des deux processus
  Node sont définis processus par processus par le point d'entrée. `PORT` n'est
  volontairement **pas** injecté par `Chibisafe_Common`, car Cloud Run réserve ce
  nom de variable d'environnement et le définit automatiquement à partir de
  `container_port` — l'injecter explicitement ferait échouer avec une erreur 400
  l'appel de création du service. Caddy écoute sur ce `PORT`.
- **`container_port` est actif ici (contrairement à la variante GKE).**
  `chibisafe.tf` fusionne `container_port = var.container_port` dans la
  configuration de module que lit le socle ; modifier cette variable change donc
  réellement le port vers lequel Cloud Run achemine le trafic et la valeur `PORT`
  sur laquelle Caddy écoute. Elle ne doit pas valoir `18000` ni `18001` (les ports
  internes) ; le conteneur refuse alors de démarrer.
- **Téléversements de plus de 32 MiB.** Cloud Run plafonne le corps d'une requête
  HTTP/1 à 32 MiB, et la taille de bloc de téléversement par défaut de Chibisafe
  est d'environ 81 MB ; les téléversements de fichiers de plus de 32 MiB échouent
  donc sur Cloud Run tant qu'un administrateur n'a pas réduit **Chunk Size**
  (taille de bloc) dans les paramètres du tableau de bord (par exemple à
  25–30 MB). Ceci est déduit du code source amont et de la limite documentée de
  Cloud Run, et non mesuré en conditions réelles. `Chibisafe_GKE` derrière un
  LoadBalancer n'a pas ce plafond.
- **Mémoire.** La valeur par défaut `1Gi` héberge désormais deux processus Node
  plus Caddy ; cela n'a pas encore été mesuré en conditions réelles — augmentez
  `memory_limit` si des révisions sont arrêtées pour dépassement de mémoire (OOM).
- **Mise à jour d'un déploiement existant.** Un UPDATE d'un déploiement réalisé
  avec la version antérieure limitée au backend reconstruit automatiquement
  l'image (le hachage du contenu du répertoire de scripts change), conserve le
  port `8000`, supprime la variable d'environnement `HOST=0.0.0.0` définie à
  l'échelle du conteneur (désormais définie par processus) et laisse intactes les
  données de `/data`. `/` passe d'une réponse JSON 404 à l'interface web.
- **Chemin de santé.** Les sondes de démarrage et d'activité sont toutes deux des
  requêtes **HTTP** `GET
  /api/health` (variables `startup_probe`/`liveness_probe` de ce module, par
  défaut `initial_delay_seconds = 15` / `30`), envoyées via Caddy au backend, qui
  renvoie un 200 littéral dès qu'il répond, sans authentification requise. Voir §6
  pour comprendre pourquoi les variables distinctes `startup_probe_config` /
  `health_check_config` n'ont en réalité aucune importance ici.
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
plateforme de déploiement. Seuls les paramètres propres à Chibisafe ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
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
| `application_name` | `chibisafe` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Chibisafe` | Nom lisible affiché dans la console. |
| `description` | _(définie)_ | Description du service. |
| `application_version` | `latest` | Étiquette de l'image `chibisafe/chibisafe-server` ; `latest` est épinglé sur `v6.5.5` au moment du build via l'argument de build `CHIBISAFE_VERSION` propre à l'application. |
| `enable_api_key` | `true` | Génère une valeur aléatoire de 24 caractères dans Secret Manager, injectée comme `ADMIN_PASSWORD`, qui initialise l'identifiant administrateur de premier démarrage au lieu de la valeur par défaut amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | 1 GiB par défaut. Le texte de description mentionne des « vector indexes »/« collections » — un artefact de copier-coller issu d'un module de base de données vectorielle ; ignorez la formulation, la valeur par défaut convient. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Laissez à 1 — Chibisafe est une application SQLite à rédacteur unique sur un seul montage GCS Fuse. |
| `container_port` | `8000` | Le port du proxy Caddy. Actif (voir §3) — modifie à la fois l'acheminement Cloud Run et la variable d'environnement `PORT` injectée. Ne doit pas valoir `18000`/`18001`. |
| `execution_environment` | `gen2` | Requis pour le montage GCS Fuse `/data`. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Inerte** — `main.tf` code en dur `false` vers le socle, quelle que soit la valeur de cette variable. Chibisafe n'a pas de base de données Cloud SQL. |
| `container_protocol` | `http1` | La description mentionne « required for Chibisafe gRPC » — un autre artefact de copier-coller ; Chibisafe n'a aucune interface gRPC. Laissez `http1`. |
| `service_annotations` / `service_labels` | `{}` | Annotations/libellés personnalisés du service Cloud Run. |
| `enable_image_mirroring` | `true` | Duplique l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec les conventions ; non transmise par le `main.tf` de ce module. |
| `container_image_source` / `container_image` / `container_build_config` / `container_resources` | `custom` / `""` / `{enabled=true}` / `{1000m,512Mi}` | Espaces réservés inertes repris du socle — le build réel (Dockerfile, argument de build `CHIBISAFE_VERSION`) provient de la configuration fixe de `Chibisafe_Common`, et non de ces variables. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut — Chibisafe est une interface de téléversement de fichiers consultée directement. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `NODE_ENV=production` et `HOST=0.0.0.0` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path` et `custom_sql_scripts_use_root` sont transmises au
socle mais sont sans effet — Chibisafe n'a pas de base de données SQL
(`database_type =
NONE`).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage, système de fichiers et Redis (inerte) {#group-11--storage-filesystem--redis-inert}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` toujours présent. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket de données provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé par défaut ; non utilisé par le modèle de stockage de Chibisafe. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (pertinent uniquement si `enable_nfs` est défini). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires. Le bucket `storage` de Chibisafe est ajouté automatiquement sur `/data`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `enable_redis` | `true` (reprise, **inerte**) | Déclarée uniquement par souci de cohérence avec les conventions du socle — `main.tf` transmet toujours `enable_redis = false` à App_CloudRun, quelle que soit cette valeur. Chibisafe ne dépend pas de Redis. |

### Groupe 12 — Backend de base de données (sans objet) {#group-12--database-backend-not-applicable}

`database_type` est fixé à `NONE` par `Chibisafe_Common`. Toutes les autres
variables du groupe 12 — `sql_instance_name`, `sql_instance_base_name`,
`database_password_length`, `application_database_name`,
`application_database_user`, `db_password_env_var_name`,
`db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`,
`db_port_env_var_name`, `service_url_env_var_name`,
`enable_mysql_plugins`/`mysql_plugins`,
`enable_postgres_extensions`/`postgres_extensions`,
`enable_auto_password_rotation`/`rotation_propagation_delay_sec` — ne sont
déclarées que pour refléter les variables du socle et n'ont aucun effet sur ce
module.

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucune tâche par défaut n'est injectée ; à utiliser uniquement pour des tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Tâches Cloud Run planifiées récurrentes ; aucune par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai initial de 15s | La sonde de démarrage réellement en vigueur (voir §3). |
| `liveness_probe` | HTTP `/api/health`, délai initial de 30s | La sonde d'activité réellement en vigueur. |
| `startup_probe_config` | HTTP `/api/health`, activée | **Inerte pour ce module** — le socle App_CloudRun privilégie toujours la `startup_probe` propre à l'application, fournie via `application_config`, plutôt que cette variable autonome ; la modifier n'a donc aucun effet sur la sonde déployée. |
| `health_check_config` | HTTP `/api/health`, activée | Même inertie que `startup_probe_config` — c'est `liveness_probe` (groupe 14, ci-dessus) qui est réellement déployée. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 23 — VPC Service Controls et journaux d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `organization_id` | `""` | Valeur de remplacement pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_url` | URL de l'interface web de Chibisafe (servie à `/`). La même origine sert l'API REST sous `/api`, la référence OpenAPI à `/docs` et les fichiers téléversés par leur nom. |
| `api_url` | URL de base de l'API REST (`<service_url>/api`), pour les clients de téléversement et les scripts ; `GET <api_url>/health` renvoie `200 {"status":"yes"}`. |
| `service_name` | Nom du service Cloud Run. |
| `chibisafe_url` | Alias de `service_url` (l'interface web) ; accessible uniquement depuis le même VPC lorsque `ingress_settings` vaut `internal`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsque `enable_cloud_armor` est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuelles tâches d'initialisation personnalisées. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

Notez l'absence de sortie pour le secret facultatif `enable_api_key` —
contrairement à `Chibisafe_GKE` (qui expose `chibisafe_api_key_secret_id`), ce
module n'expose pas le nom du secret généré ; retrouvez-le via `gcloud secrets list
--filter="name~chibisafe"`.

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `container_port`/`timeout_seconds`/`backup_retention_days` hors plage, un environnement d'exécution `gen1` combiné à `gcs_volumes`, un `traffic_split` invalide. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Modèle de persistance | GCS Fuse `/data` (seule option de ce module) | Critique | SQLite sur la sémantique de verrouillage de fichiers POSIX de GCS Fuse n'est pas entièrement sûr en cas d'écritures soutenues ou concurrentes. Les propres métadonnées du module recommandent explicitement `Chibisafe_GKE` (PVC bloc) pour un stockage de production durable ; réservez cette variante Cloud Run aux outils de téléversement légers ou à faible trafic. |
| `max_instance_count` | `1` | Critique | Chibisafe est une application SQLite à rédacteur unique ; dépasser 1 instance expose à des rédacteurs concurrents qui corrompent la base SQLite sur le montage GCS Fuse partagé. |
| `path` de `startup_probe` / `liveness_probe` | `/api/health` | Moyen | `/api/health` renvoie un 200 littéral via le proxy vers le backend. `/` est l'interface web, dont le code d'état relève du front-end ; une sonde à cet endroit n'est donc pas un signal de santé fiable. |
| `container_port` | `8000` | Moyen | `18000`/`18001` entrent en collision avec les ports internes du backend et du front-end, et le conteneur refuse de démarrer. |
| Taille de bloc de téléversement | réduire à 25–30 MB dans les paramètres du tableau de bord | Moyen | Le plafond de 32 MiB de Cloud Run sur le corps des requêtes HTTP/1 rejette les blocs par défaut d'environ 81 MB de Chibisafe ; les téléversements de fichiers de plus de 32 MiB échouent donc (déduit du code source amont, non mesuré en conditions réelles). |
| `enable_api_key` | `true` pour tout déploiement hors d'un réseau de confiance | Élevé | Avec `ingress_settings = all` (la valeur par défaut) et `enable_api_key = false`, le garde-fou du plan rejette la configuration ; sans lui, le compte `admin` conserverait le mot de passe amont bien connu `admin` jusqu'à ce que quelqu'un le change. |
| `ingress_settings` | `all` | Moyen | Vérifiez que votre copie de travail de ce module n'est pas revenue à `internal` — un ancien bug de copier-coller à l'échelle du parc fixait par défaut `ingress_settings` à `internal` pour plusieurs modules, ce qui rendrait cet outil public de téléversement totalement inaccessible malgré des contrôles de santé réussis. |
| `startup_probe_config` / `health_check_config` | laisser tels quels ; comprendre qu'ils sont inertes | Faible | Le socle App_CloudRun privilégie toujours les `startup_probe`/`liveness_probe` propres à l'application, fournies via `application_config`, plutôt que ces variables autonomes lorsque les deux sont présentes ; modifier ces deux variables n'a donc aucun effet sur la sonde déployée. |
| `enable_cloudsql_volume` | `false` (seule valeur qui compte) | Faible | `main.tf` code en dur `false` vers le socle, quelle que soit la valeur de cette variable ; Chibisafe n'a pas de base de données Cloud SQL. |
| `enable_redis` | n'importe quelle valeur (inerte) | Faible | `main.tf` transmet toujours `enable_redis = false` — modifier cette variable n'a aucun effet ; ne comptez pas sur elle pour ajouter une connectivité Redis. |
| Descriptions de `memory_limit` / `min_instance_count` / `container_protocol` | ignorer la formulation | Faible | Le texte de description de ces variables fait référence à des « vector indexes », des « collections », de l'« index loading » et à « gRPC » — des restes de copier-coller d'un modèle de module de base de données vectorielle. Chibisafe est un outil de téléversement de fichiers qui n'a rien de tout cela ; les valeurs par défaut numériques et textuelles elles-mêmes (`1Gi`, `1`, `http1`) sont correctes et non affectées. |
| Variables `database_type` / `db_*` / `sql_instance_*` | `NONE` / inertes | Faible | Chibisafe n'a pas de base de données SQL ; ces variables n'existent que pour refléter celles du socle et sont ignorées sans avertissement. |
| Repérage du secret `enable_api_key` | utiliser `gcloud secrets list --filter="name~chibisafe"` | Faible | Le fichier `outputs.tf` de ce module n'expose pas le nom du secret généré en tant que sortie (contrairement à `chibisafe_api_key_secret_id` de `Chibisafe_GKE`). |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication
d'images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Chibisafe, partagée avec la variante GKE, se trouve dans le
module `Chibisafe_Common` (`modules/Chibisafe_Common/README.md`) ; la variante
GKE elle-même est documentée dans **[Chibisafe_GKE](Chibisafe_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chibisafe sur Cloud Run](../labs/Chibisafe_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Chibisafe sur GKE Autopilot](Chibisafe_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chibisafe Common — Configuration applicative partagée](Chibisafe_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Gokapi sur Google Cloud Run](Gokapi_CloudRun.md), [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) dans la solution **File Sharing & Transfer**.
