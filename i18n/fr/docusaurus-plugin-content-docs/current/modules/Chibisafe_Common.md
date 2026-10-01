---
title: "Chibisafe Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Chibisafe — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Chibisafe_Common.md @ 3055034 sha256:478afcdc5ca0 -->

# Chibisafe Common — Configuration applicative partagée {#chibisafe-common--shared-application-configuration}

`Chibisafe_Common` est la **couche applicative partagée** de Chibisafe. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Chibisafe sur
laquelle s'appuient [Chibisafe_GKE](Chibisafe_GKE.md) et
[Chibisafe_CloudRun](Chibisafe_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte — même image
construite sur mesure, même point d'entrée, même modèle fixe « sans base de
données », même bucket de stockage provisionné automatiquement. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut et les particularités que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Chibisafe, consultez
les guides des plateformes ([Chibisafe_GKE](Chibisafe_GKE.md),
[Chibisafe_CloudRun](Chibisafe_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Chibisafe_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques / identifiants | Génère en option un `ADMIN_PASSWORD` aléatoire de 24 caractères dans **Secret Manager**, contrôlé par `enable_api_key` (par défaut `false`) | Injecté automatiquement lorsqu'il est activé ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Regroupe les trois conteneurs amont — le backend `chibisafe/chibisafe-server` (image de base), le front-end Next.js `chibisafe/chibisafe` et un reverse proxy Caddy — dans **une seule image personnalisée** dotée d'un point d'entrée de relocalisation et de supervision ; construite via Cloud Build avec un argument de build `CHIBISAFE_VERSION` propre à l'application | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe `database_type = "NONE"` — Chibisafe ne dépend **d'aucun Cloud SQL** ; l'état réside entièrement dans SQLite sur le volume monté | §Base de données dans les guides des plateformes (toutes les variables `database_*`/`db_*` sont inertes) |
| Amorçage de la base de données | Aucun — aucune tâche `db-init` n'est injectée ; `initialization_jobs` n'est accepté que pour des tâches personnalisées fournies par l'utilisateur | Sortie `initialization_jobs` (vide sauf si fournie par l'utilisateur) |
| Stockage d'objets | Déclare le bucket Cloud Storage `storage`, toujours présent, qui sous-tend l'unique montage `/data` | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Chibisafe : `NODE_ENV=production` ; retient volontairement `PORT` (les `HOST`/`PORT` par processus sont définis par le point d'entrée) ; le port de conteneur `8000` est celui du proxy Caddy (interface web à `/`, API sous `/api`, référence OpenAPI à `/docs`, fichiers téléversés par leur nom) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Déclare des sondes de démarrage et d'activité par défaut au niveau de Common (`path = "/api/health"`, via le proxy) — les deux variantes de plateforme déclarent leurs propres variables `startup_probe`/`liveness_probe` avec le même chemin, et ce sont elles qui sont déployées | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Chibisafe ne génère **aucun secret par défaut**. Contrairement aux applications
qui ont besoin d'une clé de chiffrement ou d'un secret de signature JWT, le
backend de Chibisafe gère en interne les sessions et les identifiants ;
`Chibisafe_Common` ne propose qu'une seule valeur générée **facultative** :

- **`ADMIN_PASSWORD`** (suffixe de nom de secret `api-key`) — une chaîne
  alphanumérique aléatoire de 24 caractères (`random_password.api_key`,
  `special = false`), créée uniquement lorsque `enable_api_key = true` (par
  défaut `false`). Elle est injectée comme variable d'environnement
  `ADMIN_PASSWORD`, que le backend chibisafe-server lit pour initialiser son
  compte administrateur de **premier démarrage** au lieu de la valeur par défaut
  amont bien connue (nom d'utilisateur `admin`, mot de passe `admin` —
  changez-le immédiatement après la première connexion si vous laissez
  `enable_api_key` désactivé). Elle n'est transmise qu'au processus backend ; le
  point d'entrée la retire de l'environnement du front-end et de Caddy. Comme
  elle n'est utilisée que la première fois que le backend initialise son
  utilisateur administrateur, la faire tourner **après** le premier démarrage n'a
  aucun effet sur le compte déjà créé — traitez-la comme un identifiant
  d'amorçage, et non comme un mot de passe actif et renouvelable. Il s'agit d'un
  simple mot de passe aléatoire, pas d'une clé cryptographique ; rien ici ne
  corromprait des données stockées en cas de rotation (contrairement aux
  applications qui détiennent une clé de chiffrement applicative).
- Le module exécute aussi `cleanup_orphaned_secrets` sur le même ID de secret
  avant de le créer, et conditionne les sorties du secret à un `time_sleep` de
  30 secondes afin que les ressources dépendantes (l'injection de variables
  d'environnement secrètes par la plateforme) n'entrent pas en concurrence avec
  la propagation du secret.

Récupérez le secret après le déploiement (présent uniquement si
`enable_api_key = true`) :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~chibisafe AND name~api-key"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Chibisafe n'a pas de base de données ; il n'y a donc aucun mot de passe de base
de données géré séparément à mettre en regard ici (contrairement aux
applications documentées sous [App_Common](App_Common.md) qui s'appuient sur le
modèle de secret de base de données partagé du socle).

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Chibisafe ne nécessite **aucune base de données externe**. `Chibisafe_Common`
code en dur `database_type = "NONE"` (ainsi que `db_name = ""`, `db_user = ""`
et `enable_cloudsql_volume = false`) directement dans sa sortie `config` — ces
valeurs ne proviennent d'aucune variable, si bien que rien de ce qu'un opérateur
définit ne peut activer une instance Cloud SQL pour cette application. Aucune
tâche `db-init` n'est jamais injectée ; `initialization_jobs` se contente de
transmettre les tâches personnalisées que fournit l'appelant (utile uniquement
pour un chargement de données sur mesure, jamais pour la mise en place du
schéma).

Tout l'état de Chibisafe — le ou les fichiers de base SQLite, les fichiers
téléversés et les journaux — réside sur un unique montage persistant à `/data`
(un volume GCS Fuse sur Cloud Run, un PersistentVolumeClaim bloc sur GKE). Il
n'existe aucun client `psql`/`mysql` auquel se connecter ; inspectez plutôt les
données directement :

```bash
# Cloud Run (GCS Fuse-backed bucket):
gcloud storage ls gs://<data-bucket>/database gs://<data-bucket>/uploads gs://<data-bucket>/logs

# GKE (block PVC):
kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /data/database /data/uploads /data/logs
```

Le nom du bucket ou du PVC figure dans les sorties du déploiement de la
plateforme (`storage_buckets` sur Cloud Run, le PVC listé par `kubectl get pvc`
sur GKE).

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

En amont, Chibisafe est distribué sous forme de trois conteneurs (backend,
front-end Next.js, reverse proxy Caddy). Les socles RAD déploient un conteneur
par service et les sidecars d'App_CloudRun n'ont pas de pipeline de build ;
l'image personnalisée (`modules/Chibisafe_Common/scripts/Dockerfile`) embarque
donc **la pile complète** :

| Chemin dans l'image | Contenu |
|---|---|
| `/app` | `chibisafe/chibisafe-server:<CHIBISAFE_VERSION>` — le backend, utilisé comme image de base (il détient la base SQLite et les fichiers téléversés) ; son `CMD` amont est conservé |
| `/opt/chibisafe-web` | `chibisafe/chibisafe:<CHIBISAFE_VERSION>` — le front-end Next.js autonome (`server.js`, `.next/`, `public/`, `node_modules/`) ; l'amont publie les deux étiquettes ensemble, si bien qu'un seul ARG épingle les deux |
| `/usr/bin/caddy` | Binaire Caddy statique, Caddy `2.11.4` |
| `/etc/caddy/Caddyfile` | Routage, adapté du `Caddyfile` amont (`scripts/Caddyfile`) |

`tini` est le PID 1 : il récupère les processus orphelins et transmet le
`SIGTERM` de la plateforme à l'ensemble du groupe de processus du point d'entrée.

Le build lit son propre ARG `CHIBISAFE_VERSION` plutôt que le
`APP_VERSION` générique qu'injecte le socle (qui imposerait sinon
`application_version = "latest"` à une étiquette d'image inexistante) ;
le `main.tf` de `Chibisafe_Common` fait correspondre `application_version == "latest"` à
la valeur par défaut épinglée `v6.5.5` au moment du build.

Le point d'entrée (`entrypoint.sh`) a deux responsabilités. La première consiste
à **relocaliser l'état modifiable du backend sur l'unique montage persistant de
la plateforme** (inchangé par rapport à la version antérieure limitée au
backend) :

- L'image amont conserve trois répertoires frères sous son WORKDIR
  (`/app`) : `/app/database` (SQLite), `/app/uploads` (fichiers et miniatures)
  et `/app/logs`. La plateforme fournit au conteneur un volume persistant monté
  sur `/data` (`CHIBISAFE_DATA_ROOT`, par défaut `/data`).
- Pour chacun des trois répertoires, le point d'entrée crée le sous-répertoire
  correspondant sous `/data`, y migre au premier démarrage tout contenu fourni
  par l'image (uniquement si la destination est vide et la source non vide),
  supprime le répertoire d'origine dans l'image et le remplace par un lien
  symbolique vers `/data`. Les répertoires déjà liés sont laissés intacts, ce
  qui rend l'opération idempotente d'un redémarrage à l'autre.
- Il n'y a **aucune traduction de variables d'environnement `DB_*`** ni
  **aucune correction d'URL** dans ce point d'entrée (contrairement aux
  applications dotées d'un backend Cloud SQL ou d'une URL de service prédite à
  corriger) — `database_type = "NONE"` signifie qu'il n'y a rien à aliaser, et
  Chibisafe n'a aucune URL sortante de webhook ou OAuth à corriger à l'exécution.

La seconde consiste à **exécuter et superviser trois processus** :

| Processus | Écoute sur | Sert |
|---|---|---|
| Caddy | `0.0.0.0:${PORT:-8000}` — le port du conteneur, le seul écouteur vers lequel la plateforme achemine le trafic | Toutes les requêtes ; routage ci-dessous |
| Backend — le `CMD` de l'image (`yarn workspace @chibisafe/backend start`, qui exécute d'abord `prisma migrate deploy`) | `127.0.0.1:18000`, boucle locale uniquement | `/api/*`, `/docs*` |
| Front-end — `node server.js` dans `/opt/chibisafe-web` | `127.0.0.1:18001`, boucle locale uniquement | L'interface web |

- **Fail-fast.** Si **l'un quelconque** des trois s'arrête, le point d'entrée
  arrête les deux autres et le conteneur se termine avec le code 1, si bien que
  Cloud Run / GKE le redémarre. Ce choix a été préféré à supervisord, qui
  redémarre (ou finit par abandonner) un programme mort à l'intérieur d'un
  conteneur qui paraît toujours sain — un front-end mort servirait des erreurs à
  `/` derrière une sonde `/api/health` au vert.
- **Garde-fou de port.** Un port de conteneur `18000` ou `18001` entre en
  collision avec un port interne ; le point d'entrée journalise une erreur fatale
  et le conteneur refuse de démarrer.
- **Routage** (Caddyfile amont de `v6.5.5`, dans l'ordre amont) :
  1. tout chemin désignant un fichier sous le répertoire des téléversements
     (`/data/uploads`) est servi directement par Caddy — le backend ne sert pas
     les fichiers téléversés en production ;
  2. `/api/*` → backend (l'API REST) ;
  3. `/docs*` → backend (la référence OpenAPI Scalar) ;
  4. tout le reste → front-end (l'interface web à `/`, par exemple `/dashboard`,
     `/login`).
- **Écarts par rapport au Caddyfile amont.** L'en-tête `Host` du client est
  **conservé** (l'amont le réécrit), de sorte que les liens de fichiers que le
  backend construit à partir de `Host` sont corrects sans avoir à définir
  « Serve uploads from ». `X-Forwarded-For`/`X-Real-IP` sont **fixés à
  l'adresse IP cliente résolue par Caddy** plutôt que transmis depuis le client
  (plages du front-end Google approuvées, sélection stricte la plus à droite),
  car le backend fait confiance à l'entrée la plus à gauche de
  `X-Forwarded-For` et c'est sur elle que s'appuient la limitation de débit et
  les bannissements. HTTP simple uniquement — le TLS se termine au front-end de
  Cloud Run / à l'équilibreur de charge GKE.
- **Front-end → backend.** Le rendu côté serveur appelle directement le backend
  à `BASE_API_URL=http://127.0.0.1:18000`, défini par le point d'entrée — rien ne
  compte sur une interpolation de `$(VAR)` par Cloud Run, qu'il n'effectue pas.
  Le navigateur appelle `/api` sur la même origine.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Chibisafe_Common` établit une base minimale pour que la pile écoute
correctement sur les deux plateformes :

- **`NODE_ENV = "production"`** est toujours défini (fusionné avec
  `var.environment_variables`, qui peut le remplacer). `HOST = "0.0.0.0"` n'est
  **plus** défini à l'échelle du conteneur : `HOST`/`HOSTNAME`/`PORT` des deux
  processus Node sont définis processus par processus par le point d'entrée
  (boucle locale, ports internes fixes), car une valeur à l'échelle du conteneur
  serait lue par les deux à la fois.
- **`PORT` n'est volontairement jamais injecté.** Cloud Run réserve le nom de
  variable d'environnement `PORT` et le définit automatiquement à partir de
  `container_port` ; le définir explicitement ici ferait échouer avec une erreur
  400 l'appel de création du service Cloud Run. GKE ne réserve pas `PORT` ; le
  proxy Caddy écoute sur `${PORT:-8000}`, et `8000` y est le `container_port`.
- **Le port de conteneur `8000`** est celui du proxy Caddy. C'est le même port
  que celui qu'utilisait la version antérieure limitée au backend (pour le
  backend) ; un UPDATE d'un déploiement existant conserve donc son port.
- **`enable_postgres_extensions = false`**, **`postgres_extensions = []`**,
  **`additional_services = []`** — tous codés en dur ; il n'y a aucun service
  secondaire ni aucune extension de base de données à configurer.

Les ajustements propres à chaque plateforme sont effectués par les modules de
*variante*, et non par `Chibisafe_Common` lui-même, mais ils sont importants pour
comprendre la configuration partagée :

- **Cloud Run** fusionne sa propre `var.container_port` dans la configuration de
  sortie de `Chibisafe_Common` (`chibisafe.tf`) ; modifier cette variable change
  donc réellement le port d'acheminement. La variable équivalente de GKE n'est
  **pas** transmise — le port de conteneur y est fixé au `8000` de Common.
- **La source du montage `/data` diffère.** Les deux variantes transmettent
  directement leurs propres `gcs_volumes`, mais `enable_gcs_storage_volume` (qui
  détermine si le bucket `storage`, toujours créé, est effectivement monté sur
  `/data` via GCS Fuse) est calculé différemment : Cloud Run conserve la valeur
  par défaut de Common (`true` — GCS Fuse est la seule option de stockage de
  Cloud Run), tandis que GKE la fixe à `!stateful_pvc_enabled` (par défaut
  `false`, puisque `stateful_pvc_enabled = true` par défaut sur GKE) afin que le
  PVC bloc du StatefulSet — et non le bucket GCS — occupe `/data`, ce qui évite
  un double montage.
- **`enable_redis` et `enable_cloudsql_volume` sont décidés au-dessus de cette
  couche.** `Chibisafe_Common` ne déclare aucune variable `enable_redis` ; le
  propre `main.tf` de chaque variante code en dur `enable_redis = false` dans son
  appel au module socle, quelle que soit la valeur d'une éventuelle variable
  reprise. `enable_cloudsql_volume = false` **est** défini dans
  `Chibisafe_Common` lui-même (codé en dur dans la sortie `config`, §3) — chaque
  variante en hérite inconditionnellement.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`Chibisafe_Common` déclare ses propres variables `startup_probe`/`liveness_probe`
avec un `path = "/api/health"` par défaut. Les deux variantes de plateforme
déclarent leurs propres variables `startup_probe`/`liveness_probe` (même chemin)
et transmettent leurs valeurs directement aux entrées de ce module (`main.tf`) ;
c'est donc la valeur choisie par la variante qui atteint le conteneur.

**Pourquoi `/api/health`.** La sonde passe **par le proxy Caddy** jusqu'au
backend ; un 200 prouve donc que les deux répondent. La route renvoie un
`200 {"status":"yes"}` littéral sans authentification, que kubelet accepte, tout
comme le contrôle de santé de la Gateway GKE (qui exige exactement un 200). `/`
n'est pas utilisé, bien qu'il serve désormais l'interface web : son code d'état
relève du front-end et ne constitue pas un signal de santé. Un front-end qui
meurt est malgré tout détecté, car il entraîne l'arrêt de tout le conteneur (§4).

- **Chibisafe_CloudRun** fixe par défaut ses `startup_probe`/`liveness_probe` à
  **`path = "/api/health"`**.
- **Chibisafe_GKE** fait de même et transmet les deux à `App_GKE` (`main.tf`) ;
  la `HealthCheckPolicy` de la Gateway reflète la sonde de vivacité.

Les deux variantes comportent aussi des variables `health_check_config`/`startup_probe_config`
(déclarées uniquement pour refléter les variables du socle), dont la valeur par
défaut est désormais aussi `path = "/api/health"`. Elles sont **supplantées** —
les socles prennent les sondes dans la configuration de module construite à
partir de `startup_probe`/`liveness_probe` — et n'ont donc aucun effet sur la
sonde déployée ; modifiez plutôt `startup_probe`/
`liveness_probe`.

**Statut :** l'image de la pile complète n'a pas encore été construite ni
déployée ; l'organisation des processus, le routage et le comportement des sondes
décrits ici proviennent du code source du module et de la version amont
`v6.5.5`, et non d'un déploiement réel.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** toujours présent (`name_suffix = "storage"`)
est déclaré ici et provisionné par le socle :

- `storage_class = "STANDARD"`, `force_destroy = true`, `versioning_enabled =
  false`, `public_access_prevention = "enforced"`.
- `location` est laissé vide afin que le socle le résolve via
  `coalesce(bucket.location, local.region)` — l'épingler ici pourrait forcer le
  remplacement du bucket (dont l'emplacement est immuable) lors d'un
  nouvel apply ultérieur dans une autre région.
- Ce bucket est le stockage sous-jacent de tout le montage `/data` décrit aux
  §3/§4/§5. Le fait qu'il soit effectivement *monté* (et non simplement
  provisionné) dépend de la plateforme : toujours monté sur Cloud Run, monté sur
  GKE uniquement lorsque le PVC bloc du StatefulSet est désactivé.
- Des volumes supplémentaires peuvent être ajoutés via `var.gcs_volumes`,
  concaténés avec le volume `/data` toujours présent dans `main.tf`.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
```

---

Pour la configuration de Chibisafe visible par l'utilisateur (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la
CLI), consultez les guides des plateformes : **[Chibisafe_GKE](Chibisafe_GKE.md)**
et **[Chibisafe_CloudRun](Chibisafe_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Chibisafe sur GKE Autopilot](Chibisafe_GKE.md) — cette configuration déployée sur GKE.
