---
title: "Wikijs Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Wikijs — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Wikijs_Common.md @ 3055034 sha256:d663768bb777 -->

# Wikijs Common — Configuration applicative partagée {#wikijs-common--shared-application-configuration}

`Wikijs_Common` est la **couche applicative partagée** de Wiki.js. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Wiki.js sur laquelle
s'appuient à la fois [Wikijs_GKE](Wikijs_GKE.md) et [Wikijs_CloudRun](Wikijs_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
c'est important. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Wiki.js, consultez les
guides des plateformes ([Wikijs_GKE](Wikijs_GKE.md), [Wikijs_CloudRun](Wikijs_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Wikijs_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Fixe `requarks/wiki:2` et construit une image personnalisée à partir de `scripts/` via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Extension PostgreSQL | Déclare `enable_postgres_extensions = true` et `postgres_extensions = ["pg_trgm"]` pour la recherche en texte intégral de Wiki.js | Étape d'installation du socle au moment du déploiement |
| Amorçage de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage objet | Déclare le **bucket Cloud Storage `wikijs-storage`** pour le stockage persistant des ressources | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Wiki.js (`DB_TYPE`, `DB_PORT`, `DB_USER`, `DB_NAME`, `DB_SSL`, `HA_STORAGE_PATH`) | Variables d'environnement de l'application |
| Contrôles de santé | Fournit la sonde par défaut de démarrage/d'activité ciblant `/healthz` avec un délai initial de 60 secondes | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur {#2-container-image}

`Wikijs_Common` définit `container_image = "requarks/wiki:2"` et
`image_source = "custom"`. Cloud Build est utilisé pour construire une image étendue
à partir du `Dockerfile` du sous-répertoire `scripts/`, qui installe Chromium (pour
l'export PDF) et intègre un `entrypoint.sh` personnalisé. L'image construite est
poussée vers Artifact Registry.

Lorsque `enable_image_mirroring = true` (valeur par défaut), l'image amont
`requarks/wiki:2` est mise en miroir depuis Docker Hub dans Artifact Registry avant le
build, ce qui évite les limites de débit de Docker Hub et garantit la
reproductibilité du build.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Wiki.js nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en
charge. Lors du premier déploiement, une tâche ponctuelle `db-init` exécute l'image
`postgres:15-alpine` et se connecte à Cloud SQL via l'Auth Proxy. De manière
idempotente, elle :

1. Crée l'utilisateur `wikijs` (ou met à jour son mot de passe s'il existe déjà),
2. Accorde à l'utilisateur les rôles nécessaires,
3. Crée la base de données `wikijs` appartenant à cet utilisateur (si elle est absente),
4. Accorde à l'utilisateur tous les droits sur la base de données et le schéma public.

La tâche signale ensuite au sidecar Cloud SQL Proxy de s'arrêter afin que le Job se
termine proprement. La tâche peut être réexécutée sans risque. Inspectez directement
la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

L'extension PostgreSQL `pg_trgm` — requise pour la recherche en texte intégral de
Wiki.js — est installée séparément par le socle après le provisionnement de la base
de données.

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Wikijs_Common` établit l'environnement de base de Wiki.js afin que l'application
démarre correctement au premier lancement :

- **Connexion à la base de données** — `DB_TYPE=postgres`, `DB_PORT=5432`, `DB_USER`,
  `DB_NAME`, `DB_SSL=false`. Ces valeurs sont préremplies dans `environment_variables`
  et ne doivent pas être supprimées. `DB_HOST` est injecté à l'exécution à partir du
  chemin du socket du Cloud SQL Auth Proxy. `DB_PASS` provient de Secret Manager et est
  injecté via `secret_environment_variables`.
- **Chemin de stockage des ressources** — `HA_STORAGE_PATH=/wiki-storage` indique à
  Wiki.js où écrire les fichiers et ressources téléversés. Le volume NFS (lorsque
  `enable_nfs = true`) ou le volume GCS Fuse doit être monté sur ce même chemin.
  Modifier `HA_STORAGE_PATH` sans modifier également le chemin de montage du volume
  fait atterrir les fichiers téléversés sur le disque éphémère du conteneur, et ils
  sont perdus au redémarrage.
- **Port du conteneur** — Wiki.js écoute sur le port 3000. Ce port est fixé par
  `Wikijs_Common` et ne doit pas être modifié.
- **Point d'entrée** — `entrypoint.sh` fait correspondre les noms de variables standard
  de la plateforme (`DB_PASSWORD` → `DB_PASS`, `DB_IP` → `DB_HOST`) aux noms que lit
  Wiki.js avant de passer la main à `node server`.

---

## 5. Stockage d'objets {#5-object-storage}

Un bucket **Cloud Storage** dédié `wikijs-storage` est déclaré ici et provisionné par
le socle. Le bucket contient les ressources persistantes de Wiki.js. Pour rendre le
bucket accessible dans le conteneur, configurez `gcs_volumes` dans le module de
plateforme afin de le monter sur `/wiki-storage` :

```bash
# List the provisioned storage bucket:
gcloud storage buckets list --project "$PROJECT" --filter="name~wikijs"
```

Pour les variantes Cloud Run comme GKE, le bucket n'est pas monté automatiquement —
vous devez ajouter explicitement une entrée de volume GCS Fuse via `gcs_volumes`. Le
partage NFS Filestore (`enable_nfs = true`) fournit un volume partagé complémentaire
pour les fichiers qui nécessitent un accès à faible latence par plusieurs pods.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et d'activité ciblent toutes deux `/healthz`, que Wiki.js
expose comme un point de terminaison léger reflétant l'état en direct de
l'application et de la connexion à la base de données. Les sondes comportent un
**délai initial de 60 secondes** sur les deux variantes afin de laisser le temps :

- Au premier lancement : à la tâche `db-init` de se terminer, puis à Wiki.js de se
  connecter et d'exécuter sa propre migration interne du schéma avant d'accepter des
  requêtes.
- En régime établi : au processus Node.js de charger tous les modules avant que le pod
  soit marqué comme prêt.

Ne réduisez pas `initial_delay_seconds` en dessous de 30 sur les nouveaux
déploiements — Wiki.js serait arrêté avant la fin de l'initialisation de sa base de
données.

---

Pour la configuration propre à Wiki.js destinée aux utilisateurs (variables par
groupe, outputs, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Wikijs_GKE](Wikijs_GKE.md)** et
**[Wikijs_CloudRun](Wikijs_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Wiki.js sur Google Cloud Run](Wikijs_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Wiki.js sur GKE Autopilot](Wikijs_GKE.md) — cette configuration déployée sur GKE.
