---
title: "Qdrant Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Qdrant — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Qdrant_Common.md @ 3055034 sha256:e754cb8923e9 -->

# Qdrant Common — Configuration applicative partagée {#qdrant-common--shared-application-configuration}

`Qdrant_Common` est la **couche applicative partagée** de Qdrant. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Qdrant sur laquelle
s'appuient à la fois [Qdrant_GKE](Qdrant_GKE.md) et [Qdrant_CloudRun](Qdrant_CloudRun.md),
de sorte que les deux variantes de plateforme se comportent de façon identique là
où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle ne possède aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Qdrant, consultez les
guides de plateforme ([Qdrant_GKE](Qdrant_GKE.md), [Qdrant_CloudRun](Qdrant_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Qdrant_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle `qdrant/qdrant` et le build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Aucune base de données SQL | Fixe `database_type = "NONE"` — Qdrant est un stockage autonome | Aucune instance Cloud SQL ni aucun identifiant de base de données n'est créé |
| Aucun Redis | Aucune dépendance de cache — Qdrant gère ses propres structures en mémoire | `enable_redis` est codé en dur à `false` dans les modules wrapper |
| Chemin de stockage | Définit `QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage`, aligné sur le montage GCS FUSE ou PVC | Environnement du conteneur ; montage du bucket GCS / du PVC dans les guides de plateforme |
| Port HTTP | Définit explicitement `QDRANT__SERVICE__HTTP_PORT=6333` | Environnement du conteneur |
| Clé d'API (facultative) | Génère une clé d'API de 32 caractères, la stocke dans **Secret Manager** et l'injecte sous la forme `QDRANT__SERVICE__API_KEY` | À récupérer via Secret Manager (voir ci-dessous) |
| Stockage objet | Déclare le bucket de stockage **Cloud Storage** (`<prefix>-storage`) sur `/qdrant/storage` | Sortie `storage_buckets` |
| Sondes de santé | Fournit la configuration par défaut des sondes de démarrage (`/readyz`) et de vivacité (`/livez`), avec des points de terminaison distincts | §Observabilité dans les guides de plateforme |

---

## 2. Clé d'API dans Secret Manager {#2-api-key-in-secret-manager}

Lorsque `enable_api_key = true`, une clé d'API alphanumérique de 32 caractères est
générée et stockée sous forme de secret Secret Manager. Elle n'est jamais définie
en clair. Récupérez-la après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~api-key"
gcloud secrets versions access latest --secret=<api-key-secret> --project "$PROJECT"
```

Une fois récupérée, transmettez-la dans tous les appels REST et gRPC :

```bash
# REST example:
curl -H "api-key: <key>" https://<qdrant-url>/collections

# Python client:
# qdrant_client.QdrantClient(host="...", api_key="<key>")
```

L'ID du secret de la clé d'API est indiqué sous `qdrant_api_key_secret_id` dans les
outputs du déploiement de la plateforme GKE. Consultez [App_Common](App_Common.md)
pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Stockage — pas de base de données SQL, GCS FUSE ou PVC {#3-storage--no-sql-database-gcs-fuse-or-pvc}

Qdrant gère son propre moteur de stockage intégré. Il n'y a **aucune base de
données Cloud SQL** ni aucun job d'amorçage de base de données. Au premier
démarrage, Qdrant initialise automatiquement son répertoire de stockage sur
`/qdrant/storage`.

Deux backends de stockage persistant sont disponibles :

**Cloud Storage via GCS FUSE (par défaut) :** `Qdrant_Common` déclare toujours un
bucket `<prefix>-storage`. Lorsque `enable_gcs_storage_volume = true` (valeur par
défaut), le bucket est monté sur `/qdrant/storage` via le pilote CSI GCS FUSE.
C'est la valeur par défaut pour `Qdrant_CloudRun` et pour `Qdrant_GKE` sans PVC de
StatefulSet.

**PVC de StatefulSet (GKE uniquement, recommandé en production) :** lorsque
`Qdrant_GKE` est déployé avec `stateful_pvc_enabled = true`, il transmet
`enable_gcs_storage_volume = false` à `Qdrant_Common`. Cela évite un conflit de
double montage sur `/qdrant/storage` entre le PVC et le volume GCS FUSE. Le bucket
est toujours provisionné (pour les sauvegardes), mais il n'est pas monté comme
chemin de données actif.

Explorer les ressources de stockage :

```bash
# GCS FUSE storage bucket
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/collections/

# PVC status (GKE only)
kubectl get pvc -n "$NAMESPACE"
```

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Qdrant_Common` établit l'environnement de référence de Qdrant afin que
l'application démarre correctement dès le premier lancement :

- **Chemin de stockage** — `QDRANT__STORAGE__STORAGE_PATH=/qdrant/storage` est
  toujours injecté et aligné sur le point de montage GCS FUSE ou sur le chemin de
  montage du PVC du StatefulSet.
- **Port HTTP** — `QDRANT__SERVICE__HTTP_PORT=6333` est toujours injecté
  explicitement.
- **gRPC désactivé par défaut** — `QDRANT__SERVICE__GRPC_PORT` n'est
  volontairement pas défini. Ni le Service GKE ClusterIP/LoadBalancer par défaut ni
  Cloud Run n'exposent le port 6334. Activez-le via `environment_variables =
  { QDRANT__SERVICE__GRPC_PORT = "6334" }` dans le wrapper GKE et configurez
  manuellement un second port de Service si vous avez besoin de gRPC.
- **Aucun job d'initialisation** — Qdrant ne nécessite aucun amorçage de base de
  données. Si `initialization_jobs` n'est pas vide dans le wrapper, ces jobs sont
  transmis ; sinon, aucun job n'est créé.
- **Source de l'image** — `Qdrant_Common` utilise `image_source = "custom"` afin
  que le socle exécute un pipeline Cloud Build qui met en miroir l'image `qdrant/qdrant`
  dans Artifact Registry avant le déploiement.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Qdrant expose deux points de terminaison de santé dédiés, aux finalités distinctes :

| Point de terminaison | Finalité | Utilisé par |
|---|---|---|
| `/readyz` | Disponibilité — renvoie 200 uniquement lorsque toutes les collections sont entièrement chargées et que Qdrant est prêt à servir le trafic | Sonde de démarrage |
| `/livez` | Vivacité — renvoie toujours 200 tant que le processus Qdrant est actif, quel que soit l'état de chargement des collections | Sonde de vivacité |

**Distinction essentielle :** Qdrant se déclare temporairement non prêt pendant le
chargement de grandes collections depuis le stockage. Si `/readyz` était la cible
de vivacité, Kubernetes et Cloud Run interpréteraient le 503 temporaire comme une
défaillance du conteneur et redémarreraient le pod ou l'instance — ce qui
déclencherait à son tour un nouveau rechargement complet des collections, créant
une boucle de redémarrage. Utilisez toujours `/livez` pour la vivacité.

`Qdrant_GKE` et `Qdrant_CloudRun` utilisent tous deux des sondes HTTP (et non TCP),
car Qdrant n'émet pas de redirections HTTP→HTTPS et le trafic des sondes n'est pas
affecté par les paramètres TLS.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket de stockage **Cloud Storage** dédié (`<prefix>-storage`) est déclaré ici
et provisionné par le socle. Le bucket utilise la classe de stockage `STANDARD`
avec `public_access_prevention = "enforced"`. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/
```

Le compte de service de la charge de travail se voit accorder un accès en lecture
et en écriture via Workload Identity par le module socle. Pour le
fonctionnement de GCS FUSE, les rôles IAM supplémentaires sont gérés
automatiquement.

---

Pour la configuration propre à Qdrant exposée aux utilisateurs (variables par
groupe, outputs, et comment explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Qdrant_GKE](Qdrant_GKE.md)** et
**[Qdrant_CloudRun](Qdrant_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Qdrant sur GKE Autopilot](Qdrant_GKE.md) — cette configuration déployée sur GKE.
