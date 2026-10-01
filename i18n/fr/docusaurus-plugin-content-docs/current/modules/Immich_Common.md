---
title: "Immich Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Immich — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Immich_Common.md @ 3055034 sha256:46e064326f58 -->

# Immich Common — Configuration applicative partagée {#immich-common--shared-application-configuration}

`Immich_Common` est la **couche applicative partagée** d'Immich. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Immich sur laquelle s'appuie
[Immich_GKE](Immich_GKE.md). Contrairement à la plupart des paires d'applications de
la plateforme, il n'existe volontairement **aucune variante CloudRun d'Immich** : la
médiathèque d'Immich est un système de fichiers local (elle n'a pas de backend de
stockage S3/GCS) et les envois de photos et vidéos dépassent couramment plusieurs Go
— ni l'un ni l'autre ne s'accorde avec le modèle de requêtes de Cloud Run —, si bien
que la variante GKE est l'unique consommatrice de cette couche. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Immich, consultez le guide
de plateforme ([Immich_GKE](Immich_GKE.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Immich_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé minimal `FROM ghcr.io/immich-app/immich-server` ajoutant un entrypoint cloud ; construit via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Résolution de version | `application_version = "latest"` se résout en tag glissant **`release`** d'Immich ; exposé sous la forme `resolved_version` afin que l'image de machine learning reste parfaitement alignée | Tags d'image des deux conteneurs |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** (Immich exige PostgreSQL >= 14, < 20) et active l'extension `vector` sur l'instance | §Base de données dans le guide de plateforme |
| Amorçage de la base de données | Définit le job `db-init` du premier déploiement — base de données, utilisateur, droits, extensions `pgvector` + `earthdistance` | Sortie `initialization_jobs` |
| Recherche vectorielle | Définit `DB_VECTOR_EXTENSION = "pgvector"` — la solution de repli documentée par Immich (Cloud SQL ne dispose pas de VectorChord) | Comportement de la recherche intelligente |
| Médiathèque | Définit `IMMICH_MEDIA_LOCATION` (par défaut `/usr/src/app/upload`) ; la variante GKE monte le volume NFS partagé exactement à cet emplacement | §Stockage dans le guide de plateforme |
| Paramètres principaux | `IMMICH_PORT = 2283`, `IMMICH_ENV = production`, télémétrie désactivée | Comportement de l'application |
| Contrôles de santé | Sondes de démarrage et de vivacité par défaut ciblant `GET /api/server/ping` (non authentifié) | §Observabilité dans le guide de plateforme |
| Secrets | **Aucun** (`secret_ids = {}`) — les clés de signature JWT résident dans la base de données ; `DB_PASSWORD` est injecté par le socle sous le nom exact que lit Immich | Aucune entrée Secret Manager au niveau de l'application |
| Stockage d'objets | **Aucun** (`storage_buckets = []`) — la médiathèque est sur NFS, et non sur GCS | Aucun bucket géré par le module |

---

## 2. Image de conteneur et résolution de version {#2-container-image-and-version-resolution}

L'image personnalisée est volontairement minimale — une seule couche au-dessus de
l'image officielle :

```dockerfile
ARG IMMICH_VERSION=release
FROM ghcr.io/immich-app/immich-server:${IMMICH_VERSION}
```

à laquelle s'ajoute l'entrypoint cloud, chaîné via `tini` vers le
`CMD ["./start.sh"]` amont. Le port 2283 est exposé et le `WORKDIR /usr/src/app`
amont est conservé.

Deux faits relatifs à la version sont déterminants :

- **Immich ne publie aucun tag `latest`** — uniquement `release` (stable glissant) et
  des tags figés `vX.Y.Z`. `Immich_Common` résout `application_version = "latest"` en
  `release` au moment du plan.
- **L'ARG de build est volontairement propre à l'application (`IMMICH_VERSION`).** Le
  socle injecte `APP_VERSION` dans les `build_args` de chaque build personnalisé et
  l'emporte lors de la fusion ; si le Dockerfile avait utilisé `APP_VERSION`, un
  déploiement `latest` tenterait de tirer l'image inexistante `immich-server:latest`.
  Le tag résolu est également exporté via la sortie `resolved_version`, que la
  variante GKE utilise pour l'image de machine learning préconstruite
  (`ghcr.io/immich-app/immich-machine-learning:<same tag>`), de sorte que le serveur
  et le ML ne divergent jamais.

---

## 3. L'entrypoint cloud — pourquoi un mappage des variables d'environnement à l'exécution {#3-the-cloud-entrypoint--why-runtime-env-mapping}

`scripts/entrypoint.sh` s'exécute avant le démarrage d'Immich et fait correspondre
les variables d'environnement injectées par le socle aux noms attendus par Immich :

| Nom Immich | Mappé depuis | Remarques |
|---|---|---|
| `DB_HOSTNAME` | `DB_HOST` ou `DB_IP` (repli `127.0.0.1`) | Un chemin de *répertoire de socket* du Cloud SQL Auth Proxy est réécrit en `127.0.0.1` — le proxy écoute aussi en TCP sur localhost |
| `DB_USERNAME` | `DB_USER` | |
| `DB_DATABASE_NAME` | `DB_NAME` | |
| `DB_PORT` | — | Vaut `5432` par défaut |
| `REDIS_HOSTNAME` | `REDIS_HOST` (partie hôte) | La plateforme injecte l'IP du Redis hébergé sur le serveur NFS lorsque `enable_redis = true` ; `REDIS_HOST` peut arriver sous la forme `host` ou `host:port`, et l'entrypoint retire tout port afin que `REDIS_HOSTNAME` soit un nom d'hôte ou une IP nus ; **vide → l'entrypoint se termine avec le code 1 et une erreur explicite** (Immich exige Redis) |
| `REDIS_PORT` | `REDIS_HOST` (partie port) | Extrait d'un `REDIS_HOST` au format `host:port` le cas échéant ; vaut `6379` par défaut sinon |
| `REDIS_PASSWORD` | `REDIS_AUTH` | Uniquement s'il est défini |
| `DB_PASSWORD` | _(aucun mappage nécessaire)_ | Le socle l'injecte sous le nom exact que lit Immich |

**Pourquoi un entrypoint plutôt que des références Kubernetes `$(VAR)` :** Kubernetes
ne résout `$(VAR)` qu'à partir des entrées d'environnement définies *plus tôt* dans la
liste d'environnement (rendue par ordre alphabétique). `DB_DATABASE_NAME` est trié
avant `DB_NAME` ; une référence `DB_DATABASE_NAME = "$(DB_NAME)"` parviendrait donc à
Immich sous la forme de la chaîne littérale `$(DB_NAME)`. Le mappage à l'exécution
dans l'entrypoint contourne entièrement cette contrainte d'ordre.

L'entrypoint affiche les valeurs résolues de `DB_HOSTNAME`, `DB_DATABASE_NAME`,
`DB_USERNAME`, `REDIS_HOSTNAME:PORT` ainsi que l'emplacement des médias avant de lancer
par `exec` le script de démarrage amont — les premières lignes du journal du pod
montrent exactement ce à quoi Immich s'est connecté. Il **résout également le script
de démarrage selon la disposition de l'image** : Immich v3 a déplacé l'application
vers `/usr/src/app/server` (script de démarrage à
`/usr/src/app/server/bin/start.sh`) tandis que les images plus anciennes conservent
`/usr/src/app/start.sh` — l'entrypoint teste les deux candidats et ajuste le
répertoire de travail avant l'`exec`.

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Immich exige PostgreSQL ; `Immich_Common` fixe `database_type = "POSTGRES_15"`. Lors
du premier déploiement, un job ponctuel (`db-init`, image `postgres:15-alpine`, délai
d'expiration de 600 secondes, `execute_on_apply = true`) exécute
`scripts/db-init.sh`, qui, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (ou se rabat sur `DB_IP`/`DB_HOST` en TCP),
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) l'utilisateur applicatif avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données applicative avec cet utilisateur comme propriétaire,
5. Accorde tous les privilèges sur la base de données et sur le schéma `public`,
6. **Crée au préalable l'extension `pgvector`** en tant que superutilisateur, de sorte
   que le `CREATE EXTENSION IF NOT EXISTS` d'Immich soit une opération sans effet ne
   nécessitant aucun privilège, accorde `cloudsqlsuperuser` à l'utilisateur
   applicatif afin que les migrations amont puissent gérer elles-mêmes les
   extensions, et **crée au préalable `earthdistance`** (Immich l'utilise pour le
   géocodage inverse),
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement.

Le job peut être relancé sans risque. Deux faits concernant la recherche vectorielle :

- **Cloud SQL ne dispose pas de VectorChord**, l'extension vectorielle privilégiée
  par Immich. L'exécution est donc configurée avec `DB_VECTOR_EXTENSION = "pgvector"`
  — la solution de repli de second rang officiellement reconnue par Immich.
  Fonctionnellement complète ; la construction des index et les requêtes sont plus
  lentes qu'avec VectorChord sur les grandes bibliothèques.
- L'extension `vector` est *également* activée au niveau de l'instance via
  `enable_postgres_extensions = true` / `postgres_extensions = ["vector"]`, et le job
  `db-init` la crée au préalable dans la base de données par précaution.

Immich applique ses propres migrations de schéma à chaque démarrage — aucun job de
migration distinct n'existe ni n'est nécessaire.

---

## 5. Médiathèque — NFS, et non stockage d'objets {#5-media-library--nfs-not-object-storage}

Immich n'a **aucun backend de stockage S3/GCS** : `IMMICH_MEDIA_LOCATION` doit être un
véritable chemin de système de fichiers contenant chaque original, chaque miniature
et chaque vidéo transcodée. `Immich_Common` lui donne par défaut le répertoire
d'envoi interne au conteneur d'Immich, `/usr/src/app/upload` (la variable
`media_location`), et la variante GKE monte le volume NFS partagé de la plateforme
exactement à cet emplacement (`nfs_mount_path`) afin que la bibliothèque survive aux
redémarrages et replanifications des pods. C'est aussi pourquoi la couche ne déclare
aucun bucket GCS (`storage_buckets = []`) et pourquoi la variante GKE valide
`enable_nfs = true` et `max_instance_count = 1` au moment du plan.

---

## 6. Paramètres principaux de l'application {#6-core-application-settings}

Valeurs par défaut injectées dans `config.environment_variables` (les
`environment_variables` fournies par l'appelant sont fusionnées par-dessus) :

| Variable | Valeur | Remarques |
|---|---|---|
| `IMMICH_PORT` | `"2283"` | Correspond à `container_port = 2283` |
| `IMMICH_MEDIA_LOCATION` | `/usr/src/app/upload` | La médiathèque adossée à NFS |
| `DB_VECTOR_EXTENSION` | `"pgvector"` | Repli pour Cloud SQL (pas de VectorChord) |
| `IMMICH_ENV` | `"production"` | API et workers d'arrière-plan dans le même processus (l'amont a fusionné le conteneur microservices dans la v1.106) |
| `IMMICH_TELEMETRY_INCLUDE` | `""` | Télémétrie désactivée par défaut |

Ressources par défaut : `cpu_limit = "2000m"`, `memory_limit = "4Gi"`.

Le **conteneur de machine learning** (recherche intelligente CLIP, reconnaissance
faciale — inférence sur CPU, sans GPU) ne fait volontairement *pas* partie du
`config` de cette couche (`additional_services = []` ici) : la variante GKE le définit
en ligne afin que la liste des services soit connue au moment du plan (un chemin
provenant d'une sortie de module serait « known after apply » et casserait la
planification de `for_each`). La variante consomme `resolved_version` pour le taguer,
surcharge `IMMICH_PORT = "3003"` dans son environnement (l'image ML lit la même
variable que le serveur) et injecte son URL dans le serveur sous la forme
`IMMICH_MACHINE_LEARNING_URL` — le véritable nom DNS du Service Kubernetes
(`http://<service>-ml:3003`), défini via `module_env_vars`, car le mécanisme
`output_env_var_name` du socle compose une URL à nom nu impossible à résoudre (mise de
côté dans la variable d'environnement inutilisée `IMMICH_ML_URL_FOUNDATION_UNUSED`).

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent HTTP
`GET /api/server/ping` — le point de terminaison de vivacité **non authentifié**
d'Immich (renvoie `{"res":"pong"}`). Les sondes s'exécutent sans authentification
(kubelet) ; une page de santé protégée par authentification renverrait donc 401/403 et
bloquerait le déploiement. La sonde de démarrage tolère 30 échecs avec une période de
10 secondes après un délai initial de 30 secondes (environ 5 minutes) — suffisant pour
les migrations de schéma du premier lancement ; la sonde de vivacité vérifie toutes les
30 secondes avec un seuil de 3 échecs.

---

## 8. Sorties {#8-outputs}

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Configuration complète de l'application consommée par le socle (image + configuration de build, port, contrat de base de données, variables d'environnement, job `db-init`, sondes). |
| `secret_ids` | `map(string)` | `{}` — aucune variable d'environnement secrète au niveau de l'application. |
| `secret_values` | `map(string)` | `{}` (sensible). |
| `storage_buckets` | `list(object)` | `[]` — la médiathèque est adossée à NFS. |
| `resolved_version` | `string` | Tag d'image réellement déployé (`latest` → `release`) ; maintient le conteneur de machine learning aligné sur le serveur. |
| `path` | `string` | Chemin absolu du répertoire du module ; résout `scripts_dir`. |
| `resource_prefix` | `string` | Préfixe de nommage des ressources (transmis depuis l'entrée). |
| `service_name` | `string` | `<application_name><resource_prefix>`. |

---

Pour la configuration propre à Immich exposée aux utilisateurs (variables par groupe,
sorties, exploration des services depuis la console et la CLI, et tableau des pièges
classés par niveau de risque), consultez le guide de plateforme :
**[Immich_GKE](Immich_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Immich sur GKE Autopilot](Immich_GKE.md) — cette configuration déployée sur GKE.
