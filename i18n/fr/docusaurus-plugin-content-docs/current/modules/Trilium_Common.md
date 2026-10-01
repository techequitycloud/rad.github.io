---
title: "Trilium Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Trilium — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Trilium_Common.md @ 3055034 sha256:18a8e05220d9 -->

# Trilium Common — Configuration applicative partagée {#trilium-common--shared-application-configuration}

`Trilium_Common` est la **couche applicative partagée** de Trilium Notes (le fork
TriliumNext, activement maintenu, de l'application auto-hébergée de prise de notes
hiérarchique). Elle n'est pas déployée seule ; elle fournit la configuration propre à
Trilium sur laquelle s'appuient à la fois [Trilium_GKE](Trilium_GKE.md) et
[Trilium_CloudRun](Trilium_CloudRun.md), afin que les deux variantes de plateforme se
comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement.

Pour l'infrastructure qui provisionne et exécute réellement Trilium, consultez les
guides de plateforme ([Trilium_GKE](Trilium_GKE.md),
[Trilium_CloudRun](Trilium_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Trilium_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule `triliumnext/notes` dans un Dockerfile léger (`ARG TRILIUM_VERSION`) afin que le socle puisse la construire/la dupliquer via Cloud Build | Sortie `container_image` |
| Moteur de base de données | Impose `database_type = "NONE"` — SQLite intégré uniquement, aucune instance Cloud SQL | Comportement de l'application dans les guides de plateforme |
| Stockage persistant | Déclare le bucket de données Cloud Storage, monté sur `/home/node/trilium-data` (GCS FUSE sur Cloud Run, ou PVC de StatefulSet sur GKE) | Sortie `storage_buckets` |
| Paramètres principaux | Définit `TRILIUM_DATA_DIR` et lie l'application à `0.0.0.0:8080` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Valeurs par défaut des sondes de démarrage/d'activité ciblant `/api/health-check` | §Observabilité dans les guides de plateforme |
| Identifiants | Aucun identifiant généré — le mot de passe de Trilium est défini via son propre écran web « Set Password » | Étape manuelle de l'opérateur |

---

## 2. Image de conteneur et build {#2-container-image-and-build}

```dockerfile
ARG TRILIUM_VERSION=v0.95.0
FROM triliumnext/notes:${TRILIUM_VERSION}
```

`TRILIUM_VERSION` est un ARG de build propre à l'application, volontairement distinct
du générique `APP_VERSION` injecté par le socle (qui imposerait sinon
`FROM triliumnext/notes:latest` quelle que soit la version demandée).

```bash
gcloud artifacts docker images list <repo-url> --project "$PROJECT" --filter="package~trilium"
```

---

## 3. Moteur de base de données {#3-database-engine}

`database_type` est fixé à `NONE`. L'intégralité du magasin de documents de Trilium
est un unique fichier SQLite intégré, `document.db`, créé et migré par l'application
elle-même lors de la première visite web, via son propre assistant de configuration.

---

## 4. Stockage persistant {#4-persistent-storage}

Un bucket de données Cloud Storage dédié est provisionné et monté sur
`/home/node/trilium-data` :

- **Cloud Run :** volume GCS FUSE avec `mount_options = uid=1000,gid=1000,file-mode=0664,dir-mode=0775` — correspondant à l'utilisateur `node` sous lequel s'exécute le conteneur de Trilium (confirmé via `docker run ... id node`).
- **GKE :** GCS FUSE par défaut, ou un PVC bloc de StatefulSet (`stateful_pvc_enabled = true`) avec `fsGroup = 1000` pour les grandes collections de notes nécessitant un véritable verrouillage de fichiers POSIX.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

- **Répertoire de données** — `TRILIUM_DATA_DIR=/home/node/trilium-data`.
- **Port** — `8080` par défaut.
- **Aucun amorçage d'authentification.** Confirmé en inspectant chaque référence
  `process.env.TRILIUM_*` dans le `main.cjs` empaqueté de l'image construite — il
  n'existe aucune variable d'environnement de mot de passe ou de clé d'API. Le seul
  moyen de définir le mot de passe initial est l'écran « Set Password » de Trilium,
  affiché lors de la première visite.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/health-check` — confirmé en conditions réelles
(`curl` renvoie `200 {"status":"ok"}` sans authentification). Le chemin racine `/`
redirige (302) vers l'écran de configuration/connexion et n'est pas utilisé pour les
sondes.

---

Pour la configuration propre à Trilium exposée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Trilium_GKE](Trilium_GKE.md)** et
**[Trilium_CloudRun](Trilium_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Trilium sur Google Cloud Run](Trilium_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Trilium sur GKE Autopilot](Trilium_GKE.md) — cette configuration déployée sur GKE.
