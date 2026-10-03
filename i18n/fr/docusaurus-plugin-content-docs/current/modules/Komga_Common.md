---
title: "Komga Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Komga — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Komga_Common.md @ 15fd4c7 sha256:77536ea521dd -->

# Komga Common — Configuration d'application partagée {#komga-common--shared-application-configuration}

`Komga_Common` est la **couche d'application partagée** pour Komga. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration spécifique à Komga sur laquelle
[Komga_GKE](Komga_GKE.md) et [Komga_CloudRun](Komga_CloudRun.md) s'appuient,
de sorte que les deux variantes de plateforme se comportent de manière identique
là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a pas ses propres entrées d'interface utilisateur de
déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut
que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Komga, consultez les guides de
la plateforme ([Komga_GKE](Komga_GKE.md), [Komga_CloudRun](Komga_CloudRun.md))
et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Komga_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré** — le compte administrateur est créé via l'assistant de configuration de première exécution de Komga à `/` | Interface utilisateur web de Komga lors du premier accès |
| Image de conteneur | L'image officielle pré-construite `gotson/komga`, déployée directement (aucune étape de build) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Komga utilise une base de données SQLite embarquée (`database.sqlite`, mode WAL) sous `/config` (`database_type = "NONE"`) | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | **Aucun** — il n'y a pas de job `db-init` ; Komga gère son propre stockage et son schéma (les migrations Flyway s'exécutent automatiquement au démarrage) | n/a |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui soutient `/config` sur Cloud Run (et sur GKE lorsque le PVC de bloc est désactivé) | Sortie `storage_buckets` |
| Paramètres de base | Définit le port de conteneur `25600` et, éventuellement, le dimensionnement du tas JVM via `JAVA_TOOL_OPTIONS` | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/actuator/health` | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Komga n'a **aucun secret de service injectable**. Contrairement aux applications
s'appuyant sur une base de données, il ne nécessite pas de clé de chiffrement,
de jeton administrateur ou de secret de signature JWT fourni par l'opérateur
pour être créé à l'avance — le compte administrateur est créé de manière
interactive via l'**assistant de configuration de première exécution** la
première fois que vous ouvrez l'interface utilisateur web à `/`, et il n'y a
pas de chemin API/CLI pour l'amorcer de manière non interactive.

En conséquence, les deux sorties de secrets de la couche Common sont vides :

- `secret_ids` — `{}` (transmis à la fondation en tant que `module_secret_env_vars`)
- `secret_values` — `{}` (transmis en tant que carte de valeurs de secrets explicite)

Elles sont conservées en tant que sorties uniquement pour que les wrappers
CloudRun/GKE puissent les connecter uniformément aux applications qui *ont* des
secrets générés. Il n'y a rien à récupérer de Secret Manager pour un
déploiement Komga standard ; tous les secrets que vous ajoutez manuellement via
l'entrée `secret_environment_variables` de la plateforme sont les seules entrées que vous trouverez :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~komga"
```

Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Komga ne prend **pas** en charge une base de données externe. Tout son état —
l'index de la bibliothèque, les comptes d'utilisateurs, la progression de la
lecture, les signets, les collections et les paramètres — réside dans une
**base de données SQLite embarquée** (`database.sqlite`, mode WAL) écrite sous `/config`,
aux côtés de l'index de recherche en texte intégral Lucene, du cache de
miniatures, de la file d'attente des tâches (`tasks.sqlite`) et des journaux. Confirmé
via une demande de fonctionnalité en amont de Komga (problème #1327, ouvert et
non implémenté) — il n'y a pas d'option de base de données externe à activer.
Par conséquent :

- `database_type = "NONE"` — aucune instance Cloud SQL, base de données ou utilisateur n'est
  créé pour Komga.
- Il n'y a **pas de job `db-init`** — Komga exécute ses propres migrations de
  schéma Flyway au premier démarrage (confirmé via les journaux de conteneur
  locaux : `org.flywaydb.core.FlywayExecutor`) ; rien n'a besoin d'être amorcé à l'avance.
- Aucune extension PostgreSQL, aucun plugin MySQL et aucun Redis ne sont
  impliqués.

Étant donné que la base de données est un fichier sur le volume persistant
`/config`, la durabilité est fonction du backend de stockage, et non d'un service
de base de données géré (voir §5 et §7). Si vous avez besoin de tâches de
chargement ou de migration de données personnalisées, vous pouvez fournir votre
propre `initialization_jobs` ; aucune n'est fournie par défaut.

---

## 4. Image de conteneur {#4-container-image}

Komga fournit une **image multi-architecture véritablement pré-construite**
(`gotson/komga`) — confirmée via `docker pull` + `docker inspect` local (Point d'entrée : `java -jar application.jar
--spring.config.additional-location=file:/config/`).
Aucun Dockerfile personnalisé ou étape Cloud Build n'est utilisé :

- **`image_source = "prebuilt"`** — la fondation déploie `gotson/komga:<version>` directement.
- **`enable_image_mirroring = true`** par défaut met toujours en miroir l'image dans Artifact Registry
  via une copie sensible au digest (`mirror-image.sh`), évitant les limites de débit de
  Docker Hub — il s'agit d'une copie, pas d'une reconstruction.
- **`application_version`** est transmis directement comme étiquette d'image (par exemple
  `"latest"`, `"1.25.0"`) — aucun ARG de build spécifique à l'application n'est
  nécessaire, contrairement aux modules qui encapsulent une image via un
  Dockerfile de build personnalisé mince.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`Komga_Common` établit l'environnement minimal dont Komga a besoin pour démarrer au
premier lancement et écrire son état sur le volume persistant :

- **Port de conteneur `25600`** — Komga sert HTTP sur le port 25600 par défaut
  (confirmé via le `EXPOSE` de l'image), correspondant au `container_port` du module.
- **Répertoire d'état fixe `/config`** — défini via la valeur par défaut de
  l'environnement `KOMGA_CONFIGDIR` de l'image (confirmé via `docker inspect`). La
  configuration de Komga, la base de données SQLite embarquée, l'index de
  recherche Lucene, le cache de miniatures, la file d'attente des tâches et les
  journaux résident tous sous ce répertoire unique.
- **Dimensionnement optionnel du tas JVM** — `jvm_heap_max` (vide par défaut), lorsqu'il
  est défini, injecte `JAVA_TOOL_OPTIONS = "-Xmx<value>"` ; confirmé respecté par la JVM Eclipse Temurin de
  l'image via des tests de conteneur locaux (`Picked up
  JAVA_TOOL_OPTIONS`).
- **Aucun paramètre de télémétrie, de file d'attente ou de mode d'exécution**
  — il n'y a rien de plus à configurer au démarrage ; le reste de la
  configuration (compte administrateur, bibliothèques) se fait via l'assistant
  de première exécution de l'interface utilisateur web.

Montage spécifique à la plateforme de `/config` :

- **Cloud Run** monte le partage Filestore (NFS) à `/config` (`Komga_CloudRun` par
  défaut `enable_nfs = true`, `nfs_mount_path = "/config"`) et définit `enable_gcs_storage_volume = false`. Bien que `/config` soit sur
  NFS, ce module définit `KOMGA_DATABASE_CHECKLOCALFILESYSTEM` et `KOMGA_TASKSDB_CHECKLOCALFILESYSTEM` à `false` : les vérifications
  de démarrage de Komga rejettent tout système de fichiers réseau par type,
  bien que NFS fournisse le verrouillage dont SQLite a besoin. Le bucket
  `storage` est monté à `/config` via GCS FUSE uniquement si NFS ne l'est pas.
- **GKE** avec `stateful_pvc_enabled = true` (par défaut) monte un PVC de bloc à `/config` et
  définit `enable_gcs_storage_volume = false` pour éviter un double montage au même chemin (l'absence de
  verrouillage de fichier réel de gcsfuse corromprait également les fichiers
  WAL SQLite de Komga).

Notez que ce module ne persiste que le répertoire d'**état** de Komga. Le
contenu réel de la bibliothèque (bandes dessinées, mangas) est censé être fourni
via des volumes montés — `gcs_volumes` supplémentaires ou un montage NFS — que vous
enregistrez ensuite comme bibliothèques dans l'interface utilisateur de Komga.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux un **HTTP GET
`/actuator/health`**, le point de terminaison public et non authentifié de Spring Boot
Actuator de Komga qui renvoie `200 {"status":"UP"}` une fois que le serveur est en service —
confirmé via des tests de conteneur locaux. **N'utilisez pas** `/api/v1/actuator/health` — le
préfixe d'API versionné est protégé par authentification et renvoie `401 Unauthorized` même
lorsque l'application est saine.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`, `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`, `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un seul bucket **Cloud Storage** est déclaré ici et provisionné par la
fondation, qui accorde également l'accès au compte de service de la charge de
travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, `force_destroy = true`,
  versioning désactivé, avec `public_access_prevention = "enforced"`.
- Le bucket `location` est laissé vide afin que la fondation le résolve via la
  région de déploiement auto-découverte (évitant un remplacement forcé du
  bucket à emplacement immuable lors d'un nouvel apply inter-régions).
- Il soutient `/config` via GCS FUSE uniquement lorsque ni NFS (par défaut de
  Cloud Run) ni un PVC de bloc (par défaut de GKE) n'y est monté.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Note sur le type de stockage.** Le `/config` de Komga contient une base de
données SQLite en mode WAL, qui nécessite un véritable verrouillage de fichier
pour rester cohérente — gcsfuse ne le fournit pas. Sur GKE, le PVC de bloc
(`stateful_pvc_enabled = true`) le fournit ; sur Cloud Run, le partage NFS le fait. Sur GCS FUSE, les
bases de données ne sont pas persistantes, ne faites donc pas fonctionner
`/config` là-bas.

---

Pour la configuration spécifique à Komga et orientée utilisateur (variables par
groupe, sorties et comment explorer chaque service depuis la Console et la CLI),
consultez les guides de la plateforme : **[Komga_GKE](Komga_GKE.md)** et
**[Komga_CloudRun](Komga_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Komga sur Google Cloud Run](Komga_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Komga sur GKE Autopilot](Komga_GKE.md) — cette configuration déployée sur GKE.
