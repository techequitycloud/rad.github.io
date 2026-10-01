---
title: "Meilisearch Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Meilisearch — paramètres de la couche applicative utilisés par le déploiement GKE Autopilot."
---

<!-- translated-from: docs/modules/Meilisearch_Common.md @ 3055034 sha256:4ce2d116267c -->

# Meilisearch Common — Configuration applicative partagée {#meilisearch-common--shared-application-configuration}

`Meilisearch_Common` est la **couche applicative partagée** de Meilisearch. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Meilisearch
sur laquelle s'appuie [Meilisearch_GKE](Meilisearch_GKE.md). Elle servait
auparavant aussi une variante Cloud Run, retirée en septembre 2026 — voir la remarque
ci-dessous. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle ne possède aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans
la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Meilisearch, consultez le
guide de plateforme ([Meilisearch_GKE](Meilisearch_GKE.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Meilisearch_Common | Où cela apparaît |
|---|---|---|
| Clé maître | Génère une `MEILI_MASTER_KEY` de 32 caractères et la stocke dans **Secret Manager** (`enable_api_key = true`) | Injectée automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `getmeili/meilisearch` (figée sur `v1.11`) afin que le socle puisse la mettre en miroir dans Artifact Registry | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **`database_type = "NONE"`** — Meilisearch n'a pas de base de données externe | §Base de données dans les guides de plateforme |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage`, monté sur `/meili_data` | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Meilisearch : chemin des données, adresse d'écoute, mode production, télémétrie | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage et de vivacité par défaut ciblant `/health` | §Observabilité dans les guides de plateforme |

---

## 2. La clé maître dans Secret Manager {#2-the-master-key-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini
en clair et ne doit faire l'objet d'une rotation qu'en même temps que tous les clients qui l'utilisent :

- **`MEILI_MASTER_KEY`** — une chaîne alphanumérique aléatoire de 32 caractères, stockée sous
  `secret-<wrapper_prefix>-<application_name>-api-key`. Meilisearch s'exécute en
  **mode production** (`MEILI_ENV = production`), qui **exige** une clé maître d'au
  moins 16 octets ; le serveur refuse de démarrer sans elle. La clé maître est un
  identifiant racine — elle peut créer et supprimer des index, modifier les paramètres et
  émettre des clés d'API à portée limitée, restreintes à un locataire, via `POST /keys`. Les
  applications doivent recevoir des clés à portée limitée, jamais la clé maître.

Le secret est exposé au socle de deux manières afin que chaque variante de plateforme puisse
l'injecter nativement :

- **Cloud Run** utilise `secret_ids` (`{ MEILI_MASTER_KEY = <secret-id> }`) via
  le mécanisme `module_secret_env_vars` du socle.
- **GKE** utilise `secret_values` (la valeur brute) et matérialise un **Secret
  Kubernetes natif** via `explicit_secret_values`.

Récupérez la clé maître après le déploiement :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read the master key:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Il n'y a pas de mot de passe de base de données distinct — Meilisearch n'a pas de base de données. Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et stockage {#3-database-engine-and-storage}

Meilisearch ne nécessite **aucune base de données** ; le moteur est fixé à `database_type = "NONE"`
et MySQL, PostgreSQL et les autres moteurs ne s'appliquent pas. Meilisearch est un
binaire Rust autonome qui persiste ses index, documents, paramètres et sa file de
tâches dans un unique répertoire sur disque. Aucune instance Cloud SQL, aucun utilisateur
applicatif ni aucun job `db-init` n'est créé.

La durabilité repose entièrement sur le volume de stockage monté sur `/meili_data`
(`MEILI_DB_PATH = /meili_data`) :

1. **Cloud Run** et **GKE sans PVC** montent le bucket Cloud Storage `storage`
   sur `/meili_data` via **GCS FUSE** (`enable_gcs_storage_volume = true`).
2. **GKE avec `stateful_pvc_enabled = true`** monte à la place un PVC Persistent Disk ;
   la couche Common définit `enable_gcs_storage_volume = false` afin que les deux ne soient
   pas montés en double. Le PVC ne sert de support à `/meili_data` que si
   `stateful_pvc_mount_path` de `Meilisearch_GKE` est explicitement surchargé à `/meili_data` — sa
   valeur par défaut est `/meilisearch/storage`, un chemin différent du `MEILI_DB_PATH` fixe, de sorte
   qu'avec les paramètres par défaut le PVC ne reçoit pas les données d'index (voir
   les pièges de configuration de [Meilisearch_GKE](Meilisearch_GKE.md)).

Le bucket est déclaré ici (suffixe `storage`, classe `STANDARD`,
`public_access_prevention = enforced`, `force_destroy = true`) et provisionné par le
socle, qui accorde aussi l'accès au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 4. Image de conteneur {#4-container-image}

L'image personnalisée encapsule l'image amont officielle afin que le socle puisse la mettre
en miroir dans Artifact Registry :

```dockerfile
ARG MEILI_VERSION=v1.11
FROM getmeili/meilisearch:${MEILI_VERSION}
```

- **`MEILI_VERSION` est un argument de build propre à l'application** — volontairement *pas* le
  `APP_VERSION` générique qu'injectent `App_CloudRun`/`App_GKE`. Le socle force
  `APP_VERSION` à la valeur par défaut de campagne `"latest"` et l'emporte lors de cette fusion, mais
  `getmeili/meilisearch:latest` n'est pas une bonne version figée pour la production ; `Meilisearch_Common`
  convertit donc `application_version == "latest"` en l'étiquette éprouvée `v1.11` et la transmet
  sous forme de `MEILI_VERSION`. Figez `application_version` sur une version précise pour la production.
- **Pas de point d'entrée personnalisé.** Le binaire amont `meilisearch` démarre directement et
  lit toute sa configuration depuis les variables d'environnement injectées — il n'y a rien
  à intégrer au-delà de l'image de base, si bien que les modifications d'image sont rares.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Meilisearch_Common` établit l'environnement de base de Meilisearch afin que
l'application démarre correctement dès le premier lancement :

- **Chemin des données** — `MEILI_DB_PATH = "/meili_data"`, aligné sur le point de montage
  GCS FUSE (Cloud Run, et GKE sans PVC) afin que les index persistent entre les redémarrages et
  les redéploiements. Sur GKE avec `stateful_pvc_enabled = true`, il ne s'aligne sur le
  PVC que si `stateful_pvc_mount_path` est explicitement défini à `/meili_data` — sa valeur par défaut
  est un chemin différent (`/meilisearch/storage`).
- **Adresse d'écoute** — `MEILI_HTTP_ADDR = "0.0.0.0:7700"`, afin que Cloud Run et le Service GKE
  puissent joindre le moteur sur le port 7700.
- **Environnement** — `MEILI_ENV = "production"`. Cela rend `MEILI_MASTER_KEY`
  obligatoire (voir §2) et désactive le mini-tableau de bord web intégré.
- **Télémétrie** — `MEILI_NO_ANALYTICS = "true"` (désactivée par défaut ; aucune donnée envoyée à
  Meilisearch).

Toutes les `environment_variables` supplémentaires fournies par l'utilisateur de la plateforme sont fusionnées
par-dessus ces valeurs par défaut, de sorte que les opérateurs peuvent définir d'autres options `MEILI_*` (niveau de
journalisation, répertoires de snapshots/dumps, taille maximale de la file de tâches, etc.) sans modifier le module.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/health`** — le point de terminaison de vivacité public et sans
authentification de Meilisearch, qui renvoie `{"status":"available"}` (HTTP 200) une fois que le serveur
a fini de se charger et est prêt à servir. Les deux variantes de plateforme utilisent le même
point de terminaison pour le démarrage et la vivacité :

- **Cloud Run et GKE** utilisent des sondes HTTP ciblant `/health` — la sonde de démarrage
  accorde une fenêtre généreuse (délai initial de 15 secondes, période de 10 secondes, 10 tentatives)
  pour tenir compte du chargement des index lors d'un démarrage à froid, et la sonde de vivacité le
  revérifie (délai initial de 30 secondes, période de 30 secondes, seuil de 3 tentatives).

Comme `/health` ne requiert aucune authentification, le front-end Cloud Run et le kubelet GKE
peuvent le sonder directement même lorsque la clé maître est définie sur l'API.

---

## 7. Jobs d'initialisation et stockage d'objets {#7-initialization-jobs-and-object-storage}

Meilisearch gère son propre stockage et ne nécessite **aucune initialisation de base de données** ;
`Meilisearch_Common` n'injecte donc aucun job `db-init` par défaut. L'entrée `initialization_jobs`
est transmise telle quelle pour les opérateurs qui souhaitent exécuter des tâches ponctuelles personnalisées
— par exemple alimenter un index depuis un système source ou restaurer un dump avant le
démarrage du service.

Le bucket **Cloud Storage** dédié déclaré ici (§3) est l'endroit où réside tout l'état
persistant ; il n'existe pas de bucket de stockage de fichiers distinct pour Meilisearch. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Meilisearch destinée aux utilisateurs (variables par groupe, sorties,
et comment explorer chaque service depuis la console et la CLI), consultez le guide de plateforme :
**[Meilisearch_GKE](Meilisearch_GKE.md)**.

> **Meilisearch_CloudRun a été retiré en septembre 2026.** Meilisearch stocke son
> index dans LMDB, qui conserve un `flock` exclusif pendant toute la durée de vie du processus.
> Cloud Run maintient en vie une révision chaude après que le trafic l'a quittée, si bien que
> l'instance sortante ne libère jamais ce verrou et que chaque révision ultérieure échoue à sa
> sonde de démarrage avec `Resource temporarily unavailable (os error 11)` — le
> service pouvait être déployé une fois mais jamais mis à jour de façon fiable, tout en paraissant
> sain. `min_instance_count = 0` permet une mise à jour sur un service inactif
> mais pas sur un service recevant du trafic. GKE n'est pas concerné : un StatefulSet arrête
> complètement l'ancien pod avant de démarrer le nouveau.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) — cette configuration déployée sur GKE.
