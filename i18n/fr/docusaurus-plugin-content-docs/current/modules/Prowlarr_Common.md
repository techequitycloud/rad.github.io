---
title: "Prowlarr Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Prowlarr — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Prowlarr_Common.md @ 3055034 sha256:2d6c38aeab58 -->

# Prowlarr Common — Configuration applicative partagée {#prowlarr-common--shared-application-configuration}

`Prowlarr_Common` est la **couche applicative partagée** de Prowlarr. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Prowlarr sur laquelle
s'appuie [Prowlarr_GKE](Prowlarr_GKE.md). Les utilisateurs finaux ne configurent
jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de
déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que
vous voyez dans le guide de plateforme.

**Il n'existe aucune variante Cloud Run avec laquelle rester synchronisé.** La
plupart des modules `*_Common` de ce catalogue existent pour qu'une variante
CloudRun et une variante GKE se comportent de façon identique. Prowlarr est
différent : il est **exclusivement GKE**. L'image officielle
`lscr.io/linuxserver/prowlarr` utilise s6-overlay comme processus d'initialisation,
qui ne peut pas s'exécuter dans le bac à sable gVisor de Cloud Run — ce qui a été
confirmé par trois déploiements de diagnostic distincts en conditions réelles
(configuration par défaut, avec un volume GCS ajouté, et avec davantage de
CPU/mémoire), tous échouant de manière identique, sans aucune sortie du conteneur et
avec « Application exec likely failed. » Un module `Prowlarr_CloudRun` a été
construit, déployé, diagnostiqué, puis retiré du catalogue — voir
[Prowlarr_GKE](Prowlarr_GKE.md) §3 pour le compte rendu complet. `Prowlarr_Common`
suit la même forme que tous les modules Common de ce catalogue uniquement par souci
de cohérence, et non parce qu'une seconde variante de plateforme existe ou est
prévue.

Pour l'infrastructure qui provisionne et exécute réellement Prowlarr, consultez le
guide de plateforme ([Prowlarr_GKE](Prowlarr_GKE.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Prowlarr_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré** — Prowlarr est livré sans compte administrateur par défaut ; les opérateurs activent l'authentification via Settings → General → Security dans l'interface web s'ils le souhaitent | Sorties `secret_ids` / `secret_values` (deux tables vides) |
| Image de conteneur | L'image **officielle** `lscr.io/linuxserver/prowlarr`, déployée sans modification — ni Dockerfile, ni build, ni point d'entrée personnalisé | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | **Aucun** — Prowlarr utilise une base de données SQLite interne et intégrée (mode WAL) à `/config/prowlarr.db` (`database_type = "NONE"`) | §3 ci-dessous et guide de plateforme |
| Initialisation de la base de données | **Aucune** — il n'y a pas de job `db-init` ; Prowlarr gère lui-même son schéma | n/a |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage`, monté à `/config` uniquement lorsqu'aucun PVC en mode bloc n'est utilisé | Sortie `storage_buckets` |
| Paramètres principaux | Port de conteneur `9696` ; aucun environnement supplémentaire requis pour le premier démarrage | Comportement de l'application dans le guide de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/ping` | §6 ci-dessous |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Prowlarr n'a **aucun secret généré**. Contrairement aux applications de ce
catalogue adossées à une base de données, il n'y a ni clé de chiffrement ni secret
de signature JWT à créer — et contrairement aux applications sans secret qui ont
tout de même besoin d'un identifiant administrateur initialisé, Prowlarr n'a pas non
plus de compte administrateur de premier lancement que cette couche devrait
préconfigurer. Il démarre simplement avec l'authentification désactivée jusqu'à ce
qu'un opérateur l'active explicitement dans l'interface web.

`Prowlarr_Common` expose tout de même les sorties standard `secret_ids` et
`secret_values`, afin de s'assembler avec `App_GKE` de la même manière que tous les
autres modules applicatifs de ce catalogue, mais les deux se résolvent en **tables
vides** — il n'existe aucune logique de création de secrets dans ce module.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~prowlarr"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity sur lequel s'appuient tous les modules applicatifs, y compris
celui-ci.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Prowlarr n'utilise **pas** de base de données externe. Tout son état — indexeurs
configurés, applications *arr connectées (Sonarr, Radarr, Lidarr, Readarr) et
journaux de synchronisation/d'historique — réside dans une **base de données SQLite
interne et intégrée, en mode WAL**, à `/config/prowlarr.db`. Par conséquent :

- `database_type = "NONE"` — aucune instance, base de données ni utilisateur
  Cloud SQL n'est créé.
- Il n'y a **pas de job `db-init`** — Prowlarr crée et migre lui-même son schéma
  SQLite au premier démarrage ; rien ne doit être initialisé à l'avance.
- Aucune extension PostgreSQL, aucun plugin MySQL et aucun Redis n'interviennent
  (`enable_redis` est codé en dur à `false` par le `main.tf` de `Prowlarr_GKE`).

Comme la base de données est un fichier sur le volume persistant `/config`, sa
durabilité dépend entièrement du backend de stockage, et non d'un service de base de
données géré — voir §7. Fournissez vos propres `initialization_jobs` si vous avez
besoin de tâches personnalisées de chargement de données ou de migration ; aucune
n'est fournie par défaut.

---

## 4. Image de conteneur {#4-container-image}

Contrairement à plusieurs modules Common de ce catalogue qui ajoutent un point
d'entrée personnalisé à une image de base amont, `Prowlarr_Common` déploie
l'**image officielle sans modification** :

```
lscr.io/linuxserver/prowlarr:<application_version>
```

- **`image_source = "prebuilt"`, `container_build_config.enabled = false`**
  — il n'y a ni Dockerfile ni étape de build. Le répertoire `scripts/` de
  `Prowlarr_Common` ne contient qu'un fichier de remplacement (`.gitkeep`) — c'est,
  sur ce point précis, le module Common le plus simple du catalogue.
- **`enable_image_mirroring = true`** s'applique toujours par défaut — l'image
  officielle est mise en miroir dans l'Artifact Registry du projet afin d'éviter les
  limites de débit de Docker Hub, même si rien n'est modifié dans l'image.
- **Pas d'ARG de build d'épinglage de version propre à l'application.** Plusieurs
  modules Common à build personnalisé de ce catalogue lisent un ARG de build
  `*_VERSION` propre à l'application au lieu de l'`APP_VERSION` générique (que le
  socle forcerait à `latest`) — toute cette catégorie de problèmes ne s'applique pas
  ici, puisqu'il n'y a pas de build. `application_version = "latest"` est transmis
  tel quel comme tag de l'image déployée.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Prowlarr_Common` établit la configuration minimale dont Prowlarr a besoin pour
démarrer et servir son interface et son API :

- **Port de conteneur `9696`** — le port HTTP par défaut de Prowlarr, qui
  correspond au `container_port` du module.
- **`/config`** — Prowlarr conserve par défaut sa base de données SQLite intégrée et
  tout le reste de l'état de l'application sous `/config` (le chemin standard des
  données persistantes de l'image LinuxServer.io). Aucune variable d'environnement
  dédiée n'est requise — c'est la valeur par défaut de l'image elle-même.
- **Aucun paramètre de télémétrie, de file d'attente ou de mode d'exécution** — il
  n'y a rien de plus à configurer au démarrage ; l'authentification, si vous la
  souhaitez, s'active entièrement depuis l'interface web.

Montage de `/config` :

- **GKE**, avec `stateful_pvc_enabled = true` (valeur par défaut), monte un
  véritable PVC en mode bloc à `/config` et définit
  `enable_gcs_storage_volume = false` pour éviter un double montage sur le même
  chemin — c'est la disposition recommandée, car SQLite en mode WAL a besoin d'un
  véritable verrouillage de fichiers POSIX, qu'un périphérique en mode bloc fournit
  et que GCS FUSE ne fournit pas de manière fiable.
- Sans le PVC, c'est le bucket GCS `storage` qui est monté à `/config` via GCS
  FUSE.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux un **HTTP GET `/ping`**,
le point de terminaison d'état public et non authentifié de Prowlarr — dont il a été
confirmé, par des tests de conteneur en local et par un déploiement GKE en
conditions réelles, qu'il renvoie `200 {"status":"OK"}`.

Il s'agit d'une véritable correction par rapport à la source clonée à l'origine de
ce module, qui dirigeait les deux sondes vers `/api/health` (un chemin qui n'existe
pas dans Prowlarr et aurait fait échouer toutes les sondes). Cette valeur
`/api/health` obsolète subsiste encore dans les variables distinctes de niveau
module `startup_probe_config` / `health_check_config` / `uptime_check_config`
exposées par `Prowlarr_GKE` — mais pour les sondes de démarrage et de vivacité du Pod
réel, elle est sans danger : `App_GKE` privilégie toujours les `startup_probe`/
`liveness_probe` propres à l'application fournies ici (via la sortie `config` de
`Prowlarr_Common`) plutôt que les variables de premier niveau
`startup_probe_config`/`health_check_config` ; la valeur par défaut obsolète de ces
deux variables n'atteint donc jamais le Pod en cours d'exécution. La seule exception
est `uptime_check_config`, qui **est** appliquée telle quelle si un opérateur active
le test de disponibilité Cloud Monitoring facultatif — voir
[Prowlarr_GKE](Prowlarr_GKE.md) §6.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par le socle, qui
accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, avec
  `public_access_prevention = "enforced"`.
- Réellement monté à `/config` uniquement lorsque `stateful_pvc_enabled = false`
  — ce qui n'est pas la configuration recommandée pour Prowlarr. Avec le PVC en mode
  bloc par défaut en place, ce bucket est provisionné mais inutilisé comme montage.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~prowlarr"
```

**Pourquoi le type de stockage compte ici.** La base de données SQLite intégrée de
Prowlarr, en mode WAL, a besoin d'un système de fichiers doté d'un véritable
verrouillage de fichiers POSIX. Le PVC en mode bloc de GKE
(`stateful_pvc_enabled = true`, la valeur par défaut) est la solution adaptée — des
E/S aléatoires à faible latence avec un véritable verrouillage sur le fichier
SQLite. GCS FUSE ne prend pas en charge ce modèle de verrouillage de manière fiable,
et ce catalogue a un historique documenté de corruption par GCS FUSE d'autres
applications SQLite en mode WAL (voir UptimeKuma) — c'est précisément pourquoi
Prowlarr utilise par défaut le PVC plutôt que le montage du bucket que la plupart des
modules Common de ce catalogue utilisent par défaut.

---

Pour la configuration propre à Prowlarr exposée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez le guide de plateforme : **[Prowlarr_GKE](Prowlarr_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md) — cette configuration déployée sur GKE.
