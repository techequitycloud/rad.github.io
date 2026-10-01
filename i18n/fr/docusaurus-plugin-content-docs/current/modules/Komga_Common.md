---
title: "Komga Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Komga — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Komga_Common.md @ 3055034 sha256:fcdad67f840e -->

# Komga Common — Configuration applicative partagée {#komga-common--shared-application-configuration}

`Komga_Common` est la **couche applicative partagée** de Komga. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Komga sur laquelle
s'appuient à la fois [Komga_GKE](Komga_GKE.md) et [Komga_CloudRun](Komga_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
c'est important. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Komga, consultez les
guides des plateformes ([Komga_GKE](Komga_GKE.md), [Komga_CloudRun](Komga_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Komga_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré** — le compte administrateur est créé via l'assistant de configuration initiale de Komga sur `/` | Interface web de Komga au premier accès |
| Image de conteneur | L'image précompilée officielle `gotson/komga`, déployée directement (sans étape de build) | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Komga utilise une base de données SQLite intégrée (`database.sqlite`, mode WAL) sous `/config` (`database_type = "NONE"`) | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | **Aucun** — il n'y a pas de job `db-init` ; Komga gère lui-même son stockage et son schéma (les migrations Flyway s'exécutent automatiquement au démarrage) | n/a |
| Stockage objet | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/config` sur Cloud Run (et sur GKE lorsque le PVC en mode bloc est désactivé) | Output `storage_buckets` |
| Paramètres principaux | Définit le port du conteneur `25600` et, en option, le dimensionnement du heap JVM via `JAVA_TOOL_OPTIONS` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes par défaut de démarrage/vivacité ciblant `/actuator/health` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Komga n'a **aucun secret de service injectable**. Contrairement aux applications
adossées à une base de données, il n'exige pas qu'une clé de chiffrement, un jeton
administrateur ou un secret de signature JWT fourni par l'opérateur soit créé à
l'avance — le compte administrateur est créé de manière interactive via
l'**assistant de configuration initiale** la première fois que vous ouvrez
l'interface web sur `/`, et il n'existe aucun moyen par API ou CLI de l'initialiser
de manière non interactive.

En conséquence, les deux outputs de secrets de la couche Common sont vides :

- `secret_ids` — `{}` (transmis au socle sous `module_secret_env_vars`)
- `secret_values` — `{}` (transmis comme map explicite des valeurs de secrets)

Ils sont conservés comme outputs uniquement pour que les wrappers CloudRun/GKE
puissent les raccorder de façon uniforme aux côtés des applications qui *ont* des
secrets générés. Il n'y a rien à récupérer dans Secret Manager pour un déploiement
Komga standard ; les seules entrées que vous y trouverez sont les secrets que vous
ajoutez manuellement via l'entrée `secret_environment_variables` de la plateforme :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~komga"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Komga ne prend **pas** en charge de base de données externe. Tout son état — l'index
de la bibliothèque, les comptes utilisateurs, la progression de lecture, les
marque-pages, les collections et les paramètres — se trouve dans une **base de
données SQLite intégrée** (`database.sqlite`, mode WAL) écrite sous `/config`, aux
côtés de l'index de recherche en texte intégral Lucene, du cache des vignettes, de
la file de tâches (`tasks.sqlite`) et des journaux. Confirmé par une demande de
fonctionnalité amont de Komga (issue #1327, ouverte et non implémentée) — il n'y a
aucune option de base de données externe à activer. Par conséquent :

- `database_type = "NONE"` — aucune instance, base de données ni utilisateur Cloud
  SQL n'est créé pour Komga.
- Il n'y a **pas de job `db-init`** — Komga exécute ses propres migrations de schéma
  Flyway au premier démarrage (confirmé par les journaux locaux du conteneur :
  `org.flywaydb.core.FlywayExecutor`) ; rien ne doit être amorcé à l'avance.
- Aucune extension PostgreSQL, aucun plugin MySQL et aucun Redis n'interviennent.

Comme la base de données est un fichier sur le volume persistant `/config`, sa
durabilité dépend du backend de stockage, et non d'un service de base de données
géré (voir §5 et §7). Si vous avez besoin de tâches personnalisées de chargement de
données ou de migration, vous pouvez fournir vos propres `initialization_jobs` ;
aucun n'est fourni par défaut.

---

## 4. Image de conteneur {#4-container-image}

Komga fournit une **image réellement précompilée et multi-architecture**
(`gotson/komga`) — confirmé
via `docker pull` + `docker inspect` en local (Entrypoint : `java -jar application.jar
--spring.config.additional-location=file:/config/`). Aucun Dockerfile personnalisé ni
aucune étape Cloud Build n'est utilisé :

- **`image_source = "prebuilt"`** — le socle déploie directement
  `gotson/komga:<version>`.
- **`enable_image_mirroring = true`** par défaut duplique tout de même l'image dans
  Artifact Registry via une copie tenant compte du digest (`mirror-image.sh`), ce qui
  évite les limites de débit de Docker Hub — il s'agit d'une copie, pas d'une
  reconstruction.
- **`application_version`** est transmis tel quel comme tag d'image (par ex.
  `"latest"`, `"1.25.0"`) — aucun ARG de build propre à l'application n'est
  nécessaire, contrairement aux modules qui enveloppent une image via un Dockerfile
  de build personnalisé léger.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Komga_Common` établit l'environnement minimal dont Komga a besoin pour démarrer au
premier lancement et écrire son état sur le volume persistant :

- **Port du conteneur `25600`** — Komga sert le HTTP sur le port 25600 par défaut
  (confirmé via l'instruction `EXPOSE` de l'image), ce qui correspond au
  `container_port` du module.
- **Répertoire d'état fixe `/config`** — défini via la valeur par défaut de la
  variable d'environnement `KOMGA_CONFIGDIR` de l'image elle-même (confirmé via
  `docker inspect`). La configuration de Komga, la base SQLite intégrée, l'index de
  recherche Lucene, le cache des vignettes, la file de tâches et les journaux se
  trouvent tous sous ce répertoire unique.
- **Dimensionnement facultatif du heap JVM** — `jvm_heap_max` (vide par défaut),
  lorsqu'il est défini, injecte `JAVA_TOOL_OPTIONS = "-Xmx<value>"` ; des tests
  locaux du conteneur ont confirmé que la JVM Eclipse Temurin de l'image le respecte (`Picked up
  JAVA_TOOL_OPTIONS`).
- **Aucun paramètre de télémétrie, de file d'attente ou de mode d'exécution** — il
  n'y a rien d'autre à configurer au démarrage ; le reste de la configuration (compte
  administrateur, bibliothèques) se fait via l'assistant de configuration initiale
  de l'interface web.

Montage de `/config` selon la plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** avec `stateful_pvc_enabled = true` (la valeur par défaut) monte un PVC en
  mode bloc sur `/config` et définit `enable_gcs_storage_volume = false` pour éviter
  un double montage sur le même chemin (l'absence de véritable verrouillage de
  fichiers dans gcsfuse corromprait aussi les fichiers WAL SQLite de Komga).

Notez que ce module ne persiste que le répertoire d'**état** de Komga. Le contenu
réel de la bibliothèque (BD, mangas) est censé être fourni via des volumes montés —
des `gcs_volumes` supplémentaires ou un montage NFS — que vous enregistrez ensuite
comme bibliothèques dans l'interface de Komga.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux un **HTTP GET
`/actuator/health`**, le point de terminaison Spring Boot Actuator public et non
authentifié de Komga, qui renvoie `200 {"status":"UP"}` dès que le serveur répond —
confirmé par des tests locaux du conteneur. N'utilisez **pas**
`/api/v1/actuator/health` — le préfixe d'API versionné exige une authentification
et renvoie `401 Unauthorized` même lorsque l'application est saine.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage objet {#7-object-storage}

Un seul bucket **Cloud Storage** est déclaré ici et provisionné par le socle, qui
accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**,
  `force_destroy = true`, gestion des versions désactivée, avec
  `public_access_prevention = "enforced"`.
- La `location` du bucket est laissée vide afin que le socle la résolve via la
  région de déploiement découverte automatiquement (ce qui évite un remplacement
  forcé du bucket, dont l'emplacement est immuable, lors d'un nouvel apply dans une
  autre région).
- Sur Cloud Run, il sert de support à `/config` via GCS FUSE ; il contient donc la
  base SQLite de Komga, l'index de recherche Lucene, le cache des vignettes, la file
  de tâches et les journaux.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Remarque sur le type de stockage.** Le répertoire `/config` de Komga contient une
base SQLite en mode WAL, qui a besoin d'un véritable verrouillage de fichiers pour
rester cohérente — ce que gcsfuse ne fournit pas. Sur GKE, le PVC en mode bloc
(`stateful_pvc_enabled = true`) est le choix le plus adapté. Le montage GCS FUSE de
Cloud Run fonctionne, mais avec une latence plus élevée et des garanties de
cohérence plus faibles, et convient mieux aux bibliothèques légères ; les grandes
bibliothèques et les analyses fréquentes des métadonnées se portent bien mieux sur
le PVC en mode bloc de GKE.

---

Pour la configuration de Komga destinée aux utilisateurs (variables par groupe,
outputs, et comment explorer chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[Komga_GKE](Komga_GKE.md)** et
**[Komga_CloudRun](Komga_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Komga sur Google Cloud Run](Komga_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Komga sur GKE Autopilot](Komga_GKE.md) — cette configuration déployée sur GKE.
