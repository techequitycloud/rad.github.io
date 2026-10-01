---
title: "CloudBeaver Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module CloudBeaver — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/CloudBeaver_Common.md @ 3055034 sha256:5ad9edb3ea71 -->

# CloudBeaver Common — Configuration applicative partagée {#cloudbeaver-common--shared-application-configuration}

`CloudBeaver_Common` est la **couche applicative partagée** de CloudBeaver. Elle n'est pas
déployée seule ; elle fournit la configuration propre à CloudBeaver sur laquelle s'appuient
[CloudBeaver_GKE](CloudBeaver_GKE.md) et
[CloudBeaver_CloudRun](CloudBeaver_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

CloudBeaver est un gestionnaire de bases de données web, accessible depuis un navigateur, issu du projet DBeaver :
une console d'administration permettant de se connecter à PostgreSQL, MySQL,
SQL Server, Oracle, SQLite et de nombreux autres moteurs, et de les interroger, via une interface web unique. Il est
autonome — il stocke son propre état (une base de métadonnées intégrée, les connexions
enregistrées, les utilisateurs et la configuration) dans un répertoire d'espace de travail et ne nécessite **aucune
base de données applicative externe** qui lui soit propre.

Pour l'infrastructure qui provisionne et exécute réellement CloudBeaver, consultez les
guides de plateforme ([CloudBeaver_GKE](CloudBeaver_GKE.md),
[CloudBeaver_CloudRun](CloudBeaver_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par CloudBeaver_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Enveloppe l'image officielle `dbeaver/cloudbeaver` via un Dockerfile léger afin que le socle puisse la construire/la répliquer dans **Artifact Registry** | Output `container_image` du déploiement de plateforme |
| Port du conteneur | Fixe le port de l'interface web à **8978** | §Calcul dans les guides de plateforme |
| Moteur de base de données | Définit `database_type = "NONE"` — CloudBeaver ne provisionne **aucun Cloud SQL** ; il conserve son propre état dans le volume de l'espace de travail | §Comportement de l'application dans les guides de plateforme |
| Stockage persistant | Déclare un bucket **Cloud Storage** (suffixe `storage`) et un volume d'espace de travail monté sur `/opt/cloudbeaver/workspace` | Output `storage_buckets` ; §Persistance dans les guides de plateforme |
| Secrets | Émet des `secret_ids` / `secret_values` **vides** — CloudBeaver n'a besoin d'aucun secret au niveau du service pour démarrer (le compte administrateur est créé par l'assistant de configuration au premier lancement) | §Secrets dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/` (HTTP 200 une fois l'interface prête) | §Observabilité dans les guides de plateforme |
| Valeurs de mise à l'échelle par défaut | `min_instance_count = 1`, `max_instance_count = 1` — un service JVM à écrivain unique | §Mise à l'échelle dans les guides de plateforme |

---

## 2. Image de conteneur et build {#2-container-image-and-build}

CloudBeaver est livré sous forme d'image amont préconstruite, `dbeaver/cloudbeaver`. Cette couche
l'enveloppe dans un **Dockerfile léger** (`scripts/Dockerfile`) afin que le socle puisse la construire
avec Cloud Build (Kaniko) et répliquer le résultat dans le dépôt Artifact
Registry du déploiement :

```dockerfile
ARG CLOUDBEAVER_VERSION=latest
FROM dbeaver/cloudbeaver:${CLOUDBEAVER_VERSION}
```

- **`image_source = "custom"`** avec `container_build_config.enabled = true` —
  l'image est construite (répliquée) plutôt que tirée directement.
- **`CLOUDBEAVER_VERSION` est un ARG de build propre à l'application.** Le socle injecte l'ARG
  générique `APP_VERSION` (et le forcerait à `latest`) ; le Dockerfile lit délibérément
  son **propre** ARG `CLOUDBEAVER_VERSION` afin qu'une `application_version`
  épinglée se propage correctement. Le tag amont `dbeaver/cloudbeaver:latest`
  est valide, donc `latest` est transmis sans problème.
- Aucun point d'entrée personnalisé n'est greffé — le démarrage propre à l'image amont est utilisé
  tel quel. Le compte administrateur est créé de manière interactive via l'assistant de configuration au premier
  accès ; aucun préremplissage au démarrage n'est donc nécessaire.

Inspecter l'image déployée :

```bash
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'   # Cloud Run
```

---

## 3. Aucune base de données applicative {#3-no-application-database}

Contrairement aux applications adossées à une base de données, `CloudBeaver_Common` définit **`database_type = "NONE"`**. La
plateforme ne provisionne **aucune instance Cloud SQL, aucune base de données applicative et aucun job
db-init** pour CloudBeaver. Tout l'état propre à CloudBeaver — sa base de métadonnées H2
intégrée, les définitions de connexions, les utilisateurs qu'il gère et sa configuration —
réside entièrement dans le répertoire de l'espace de travail (`/opt/cloudbeaver/workspace`), qui est
adossé au volume persistant décrit ci-dessous.

Les bases de données que CloudBeaver *administre* sont entièrement distinctes : un opérateur les ajoute
dans l'interface de CloudBeaver après le déploiement (par exemple en pointant vers le Cloud SQL
partagé du déploiement via le VPC). Ces connexions ne sont pas provisionnées par ce module.

Comme il n'y a pas de base de données applicative, `initialization_jobs` est vide par défaut et
aucun job d'amorçage n'est injecté. Les `initialization_jobs` fournis par l'opérateur sont néanmoins
transmis tels quels s'ils sont renseignés.

---

## 4. Stockage persistant — l'espace de travail {#4-persistent-storage--the-workspace}

CloudBeaver persiste **tout** son état sous un répertoire d'espace de travail fixe,
`/opt/cloudbeaver/workspace`. Ce chemin est figé dans l'image amont et n'est pas
configurable par variable d'environnement ; il doit donc être la cible de montage du volume persistant. Cette couche
déclare un unique bucket **Cloud Storage** à cet effet :

```hcl
storage_buckets = [{ name_suffix = "storage", storage_class = "STANDARD", ... }]
```

La manière dont l'espace de travail est réellement monté diffère selon la plateforme :

- **Cloud Run** — le bucket est monté comme volume **GCS FUSE** nommé `storage` sur
  `/opt/cloudbeaver/workspace` (`enable_gcs_storage_volume` vaut `true` par défaut dans cette
  couche).
- **GKE** — lorsqu'un **PVC en mode bloc** de StatefulSet est activé (`stateful_pvc_enabled = true`,
  la configuration recommandée), le PVC est monté sur le même chemin et la couche
  définit automatiquement `enable_gcs_storage_volume = false` pour éviter un double montage sur
  `/opt/cloudbeaver/workspace`. Un PVC en mode bloc — et non GCS FUSE — est le stockage
  adapté pour la base H2 intégrée de CloudBeaver.

Lister le bucket après le déploiement :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 5. Aucun secret de service {#5-no-service-secrets}

`CloudBeaver_Common` émet volontairement des outputs `secret_ids` et `secret_values`
**vides**. CloudBeaver n'a besoin d'aucune variable d'environnement secrète au niveau du service pour démarrer : le
compte administrateur est créé de manière interactive via l'**assistant de configuration** de premier lancement
lors du premier accès, et tout l'état réside dans l'espace de travail persistant. Les tables vides sont
conservées afin que le câblage des variantes (`module_secret_env_vars = secret_ids`,
`explicit_secret_values = secret_values`) se résolve proprement.

> **Remarque de sécurité.** Comme le compte administrateur revient à quiconque termine
> l'assistant de configuration en premier, terminez-le immédiatement dès que le service est accessible et gardez
> l'entrée restreinte tant que ce n'est pas fait. Consultez les guides de plateforme.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut sont des contrôles HTTP ciblant le chemin racine `/` —
CloudBeaver y sert son interface web et renvoie **HTTP 200** une fois que la JVM a complètement
démarré et que l'espace de travail est prêt. Comme le point de terminaison est public et non authentifié
(la page de connexion/de configuration), c'est une cible de sonde valide à la fois pour le frontal Cloud Run
et pour le kubelet GKE.

- **Cloud Run** — sonde de démarrage HTTP `/`, délai initial de 15 s, fenêtre de 10 échecs ;
  sonde de vivacité HTTP `/`, délai initial de 30 s.
- **GKE** — les mêmes valeurs par défaut de sonde HTTP `/`, ajustées au temps de démarrage de la JVM.

CloudBeaver repose sur la JVM et démarre lentement à froid ; c'est pourquoi les deux variantes définissent par défaut
`min_instance_count = 1`.

---

## 7. Modèle de mise à l'échelle {#7-scaling-model}

L'espace de travail de CloudBeaver est un magasin à **écrivain unique** (une base H2 intégrée plus
une configuration basée sur des fichiers). Exécuter plus d'une instance sur le même espace de travail corrompt
cet état. Les deux variantes utilisent donc par défaut une seule instance :

- **`min_instance_count = 1`** — garde une instance à chaud pour éviter les démarrages à froid lents de la JVM.
- **`max_instance_count = 1`** — n'exécutez jamais un second écrivain sur l'espace de travail.

Il n'y a ni Redis ni file d'attente : `enable_redis` est forcé à `false` dans les deux variantes.

---

Pour la configuration propre à CloudBeaver destinée aux utilisateurs (variables par groupe, outputs
et manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[CloudBeaver_GKE](CloudBeaver_GKE.md)** et
**[CloudBeaver_CloudRun](CloudBeaver_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [CloudBeaver sur GKE Autopilot](CloudBeaver_GKE.md) — cette configuration déployée sur GKE.
