---
title: "Beszel Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Beszel — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Beszel_Common.md @ 3055034 sha256:7957964f1012 -->

# Beszel Common — Configuration applicative partagée {#beszel-common--shared-application-configuration}

`Beszel_Common` est la **couche applicative partagée** de Beszel. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Beszel sur laquelle
s'appuient à la fois [Beszel_GKE](Beszel_GKE.md) et
[Beszel_CloudRun](Beszel_CloudRun.md), afin que les deux variantes de plateforme se
comportent de manière identique là où c'est important. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Beszel, consultez les
guides des plateformes ([Beszel_GKE](Beszel_GKE.md),
[Beszel_CloudRun](Beszel_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Beszel est un hub de supervision de serveurs léger et open source (construit sur
PocketBase — Go et une base de données SQLite intégrée). Son hub sert une interface
web et une API REST sur un seul port ; les agents installés sur les machines
supervisées lui remontent les statistiques de CPU, de mémoire, de disque, de réseau
et des conteneurs Docker, et il stocke les données historiques et déclenche des
alertes configurables.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Beszel_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | **Aucun n'est injecté.** Beszel n'a aucune variable d'environnement secrète applicative ; les outputs `secret_ids` et `secret_values` se résolvent en maps vides. Le premier compte administrateur est créé via l'interface web au premier lancement. | n/a |
| Image de conteneur | Encapsule l'image officielle du hub `henrygd/beszel` dans un `Dockerfile` minimal (`FROM henrygd/beszel:${BESZEL_VERSION}`) ; construite via Cloud Build (Kaniko) et mise en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** (`database_type = "NONE"`). Beszel intègre sa propre base PocketBase/SQLite sous `/beszel_data` ; aucune instance Cloud SQL n'est provisionnée | §Comportement de l'application dans les guides des plateformes |
| Amorçage de la base de données | **Pas de job d'initialisation.** Beszel crée et migre son propre schéma SQLite au premier démarrage | Sortie `initialization_jobs` (vide) |
| Stockage objet | Déclare un bucket de données **Cloud Storage** (suffixe `storage`), monté via FUSE sur `/beszel_data` sur Cloud Run pour la persistance | Sortie `storage_buckets` |
| Modèle de persistance | Cloud Run : bucket GCS FUSE sur `/beszel_data` ; GKE : PVC bloc (StatefulSet) sur `/beszel_data` | §Persistance dans les guides des plateformes |
| Paramètres principaux | Fixe `container_port = 8090` et un profil à instance unique (`min = max = 1`) — un seul écrivain SQLite, pas de mise à l'échelle horizontale | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/health` (200, non authentifiée) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets — aucun n'est requis {#2-secrets--none-required}

Beszel n'a besoin d'**aucune variable d'environnement secrète injectée** pour son
fonctionnement normal. Les outputs `secret_ids` et `secret_values` de
`Beszel_Common` renvoient délibérément des maps vides ; ils n'existent que pour que
les variantes Cloud Run et GKE puissent les transmettre au socle en tant que
`module_secret_env_vars` / `explicit_secret_values`, par souci de compatibilité.

Le compte administrateur initial est créé **de manière interactive via l'interface
web** la première fois que vous ouvrez le hub (le parcours de création du
superutilisateur au premier lancement de PocketBase) — aucun mot de passe
administrateur généré automatiquement n'est stocké dans Secret Manager.

Comme il n'y a aucun secret au niveau de l'application, la liste des secrets de ce
déploiement ne montre que ceux que le socle crée lui-même (il n'y a pas de secret de
mot de passe de base de données, puisque Beszel n'a pas de base Cloud SQL) :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~beszel"
```

Consultez [App_Common](App_Common.md) pour le modèle Workload Identity partagé.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

L'image personnalisée est une fine surcouche de l'image amont du hub :

```dockerfile
ARG BESZEL_VERSION=0.9.1
FROM henrygd/beszel:${BESZEL_VERSION}
```

- **ARG de version propre à l'application.** Le Dockerfile lit `BESZEL_VERSION`, et
  **non** l'`APP_VERSION` générique qu'injecte le socle (et qu'il force à `latest`).
  Lorsque `application_version = "latest"`, `Beszel_Common` épingle
  `BESZEL_VERSION = "0.9.1"` (la valeur par défaut raisonnable du Dockerfile lui-même)
  afin que le tag de l'image de base se résolve toujours vers une version réellement
  publiée ; toute version explicite est transmise telle quelle.
- **Construite, pas seulement référencée.** `image_source = "custom"` avec
  `container_build_config.enabled = true` : le socle exécute un Cloud Build (Kaniko)
  qui construit la surcouche et la pousse dans Artifact Registry, puis la charge de
  travail s'exécute à partir de l'image mise en miroir.

Inspectez l'image déployée et le registre :

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/$PROJECT/<repo>/beszel --project "$PROJECT"
```

Le nom du dépôt Artifact Registry figure dans les outputs du déploiement de la
plateforme (`container_registry` / `artifact_registry_repository`).

---

## 4. Base de données — intégrée, sans amorçage {#4-database--embedded-no-bootstrap}

Beszel n'utilise **pas** Cloud SQL. `database_type = "NONE"`, `enable_cloudsql_volume
= false`, et aucun nom ni utilisateur de base de données n'est défini. Beszel intègre
une base SQLite gérée par PocketBase (ainsi que ses fichiers téléversés et de
sauvegarde) sous `/beszel_data` — le `DATA_DIR` par défaut de l'image.

En conséquence, `Beszel_Common` ne définit **aucun job d'initialisation** : Beszel
crée et migre automatiquement son propre schéma au premier démarrage, puis de nouveau
à chaque mise à niveau de version. Des jobs personnalisés peuvent toujours être
fournis via `initialization_jobs` pour des tâches ponctuelles de chargement de
données ou de migration, mais aucun n'est nécessaire.

---

## 5. Persistance — `/beszel_data` {#5-persistence--beszel_data}

Tout l'état de Beszel (la base SQLite, la configuration téléversée et les métriques
historiques) réside sous `/beszel_data`. `Beszel_Common` déclare un unique bucket de
données Cloud Storage (suffixe `storage`, emplacement laissé vide afin que le socle
le résolve vers la région du déploiement) et, sur Cloud Run, le monte comme volume
**GCS FUSE** sur `/beszel_data` (`enable_gcs_storage_volume = true`).

Sur GKE, l'application s'appuie plutôt sur un **PVC bloc** au même chemin. Lorsqu'un
PVC de StatefulSet est monté sur `/beszel_data` (`Beszel_GKE` avec
`stateful_pvc_enabled = true`, la valeur par défaut sur GKE), le module définit
`enable_gcs_storage_volume = false` pour éviter un conflit de double montage sur ce
chemin.

Comme un unique fichier de base SQLite fait référence, Beszel est une application à
**écrivain unique** — `min_instance_count = max_instance_count = 1` par défaut ; ne
la mettez pas à l'échelle horizontalement.

Listez le bucket de données avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~beszel"
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`GET /api/health`** — le
point de terminaison de santé public et non authentifié de Beszel, qui renvoie `200`
dès que le hub est prêt.

- **Sonde de démarrage :** HTTP `/api/health`, délai initial de 15 secondes, période
  de 10 secondes, 10 tentatives — une fenêtre généreuse pour la création du schéma au
  premier démarrage.
- **Sonde de vivacité :** HTTP `/api/health`, délai initial de 30 secondes, période
  de 30 secondes, 3 tentatives.

Les deux variantes peuvent remplacer ces chemins dans leur propre `variables.tf`,
mais la valeur par défaut `/api/health` est le bon point de terminaison de vivacité
non authentifié pour le hub (l'interface et les routes de données `/api/*`
nécessitent la session administrateur).

---

Pour la configuration de Beszel destinée aux utilisateurs (variables par groupe,
outputs, et comment explorer chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[Beszel_GKE](Beszel_GKE.md)** et
**[Beszel_CloudRun](Beszel_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Beszel sur Google Cloud Run](Beszel_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Beszel sur GKE Autopilot](Beszel_GKE.md) — cette configuration déployée sur GKE.
