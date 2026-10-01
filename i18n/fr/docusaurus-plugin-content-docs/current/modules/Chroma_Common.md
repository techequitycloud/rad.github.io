---
title: "Chroma Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Chroma — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Chroma_Common.md @ 3055034 sha256:77223ad0ee15 -->

# Chroma Common — Configuration applicative partagée {#chroma-common--shared-application-configuration}

`Chroma_Common` est la **couche applicative partagée** de Chroma. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Chroma sur laquelle
s'appuient [Chroma_GKE](Chroma_GKE.md) et [Chroma_CloudRun](Chroma_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là
où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Chroma, consultez les
guides des plateformes ([Chroma_GKE](Chroma_GKE.md), [Chroma_CloudRun](Chroma_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Chroma_Common | Où cela apparaît |
|---|---|---|
| Jeton d'authentification | Génère en option un jeton aléatoire de 32 caractères et le stocke dans **Secret Manager** sous `CHROMA_SERVER_AUTHN_CREDENTIALS` | Récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image officielle `chromadb/chroma` de Docker Hub et le build qui la duplique | Sortie `container_image` du déploiement de la plateforme |
| Déclaration sans base de données | Fixe `database_type = "NONE"` — Chroma gère son propre stockage intégré sans dépendance SQL | Aucune instance Cloud SQL n'est créée |
| Variables d'environnement fixes | Injecte toujours `ANONYMIZED_TELEMETRY=false` et `CHROMA_SERVER_HTTP_PORT=8000` ; ajoute `CHROMA_SERVER_AUTHN_PROVIDER` lorsque l'authentification est activée | Comportement de l'application dans les guides des plateformes |
| Bucket de données GCS | Déclare le bucket Cloud Storage `<prefix>-data` monté sur `/data` via GCS FUSE | Sortie `storage_buckets` |
| Prévention des conflits PVC/GCS | Se transmet `enable_gcs_storage_volume = false` lorsque Chroma_GKE utilise un PVC de StatefulSet, ce qui évite un double montage sur `/data` | Section StatefulSet du guide Chroma_GKE |
| Contrôles de santé | Fournit les chemins par défaut des sondes de démarrage et d'activité, tous deux fixés sur `/api/v2/heartbeat` | Section Observabilité des guides des plateformes |
| Jobs d'initialisation | Accepte des jobs d'initialisation facultatifs fournies par l'utilisateur ; n'injecte aucune tâche par défaut — Chroma n'a besoin d'aucun amorçage de base de données | Sortie `initialization_jobs` |

---

## 2. Jeton d'authentification dans Secret Manager {#2-auth-token-in-secret-manager}

Lorsque `enable_auth_token = true` dans le module de plateforme, Chroma_Common
génère un jeton alphanumérique de 32 caractères, le stocke dans Secret Manager et
attend 30 secondes pour la propagation avant que les ressources dépendantes ne
poursuivent. Tous les appels d'API vers Chroma doivent alors inclure
`Authorization: Bearer <token>`. Récupérez le jeton après le déploiement :

```bash
# List secrets and identify the auth token:
gcloud secrets list --project "$PROJECT" --filter="name~auth-token"
# Retrieve the token value:
gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
```

L'ID du secret est indiqué par l'entrée `CHROMA_SERVER_AUTHN_CREDENTIALS` dans les
sorties de secrets du déploiement de la plateforme. Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Aucune base de données — le stockage intégré de Chroma {#3-no-database--chromas-embedded-storage}

Chroma gère son propre moteur de stockage intégré : une base de métadonnées
SQLite, les fichiers d'index HNSW et les données des collections sont tous écrits
dans le répertoire `/data` du conteneur. Il n'existe aucune dépendance SQL
externe. `database_type = "NONE"` est fixé et ne peut pas être remplacé — aucune
instance Cloud SQL n'est créée et aucune tâche `db-init` n'est injectée.

Inspectez l'organisation sur disque dans Cloud Storage (Cloud Run) ou sur le PVC
(GKE) :

```bash
# Cloud Run — GCS FUSE-backed storage:
gcloud storage ls gs://<prefix>-data/chroma/

# GKE — access data directly from a pod:
kubectl exec -n "$NAMESPACE" <pod-name> -- ls /data
```

---

## 4. Variables d'environnement fixes {#4-fixed-environment-variables}

Les variables d'environnement suivantes sont toujours injectées dans chaque
conteneur Chroma, quelle que soit la variante de plateforme :

| Variable | Valeur | Rôle |
|---|---|---|
| `ANONYMIZED_TELEMETRY` | `false` | Désactive la télémétrie Docker Hub pour la confidentialité et la reproductibilité |
| `CHROMA_SERVER_HTTP_PORT` | `8000` | Correspond au `container_port = 8000` défini par Chroma_Common |
| `CHROMA_SERVER_AUTHN_PROVIDER` | `chromadb.auth.token_authn.TokenAuthenticationServerProvider` | Injectée uniquement lorsque `enable_auth_token = true` ; active l'authentification par jeton sur l'API |
| `CHROMA_SERVER_AUTHN_CREDENTIALS` | Secret Secret Manager | Injectée comme variable d'environnement adossée à Secret Manager, uniquement lorsque `enable_auth_token = true` |

Les variables d'environnement supplémentaires transmises via
`environment_variables` depuis le module de plateforme sont fusionnées avec ces
valeurs fixes.

---

## 5. Bucket de données GCS et prévention des conflits avec le PVC {#5-gcs-data-bucket-and-pvc-conflict-prevention}

Un unique bucket Cloud Storage est déclaré avec le suffixe de nom `data` et monté
sur `/data` via GCS FUSE. Ce bucket est le backend de persistance principal sur
Cloud Run.

Sur GKE, lorsque `stateful_pvc_enabled = true`, Chroma_GKE transmet
`enable_gcs_storage_volume = false` à Chroma_Common. Cela supprime la définition
du volume GCS FUSE afin que le PVC du StatefulSet sur `/data` et le volume GCS
FUSE n'entrent pas en conflit. Dans ce cas, la sortie `storage_buckets` est une
liste vide et aucun bucket de données n'est monté (le bucket peut néanmoins être
provisionné séparément pour les sauvegardes).

Explorez le bucket :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-data/
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et d'activité de chaque déploiement Chroma ciblent, de
manière codée en dur, `/api/v2/heartbeat` — le seul point de terminaison de santé
qu'expose Chroma. Le chemin de la sonde est imposé par Chroma_Common, quelle que
soit la valeur transmise par le module de plateforme :

```
startup_probe  = merge(var.startup_probe,  { path = "/api/v2/heartbeat" })
liveness_probe = merge(var.liveness_probe, { path = "/api/v2/heartbeat" })
```

Seuls les paramètres de temporisation (`initial_delay_seconds`, `timeout_seconds`,
`period_seconds`, `failure_threshold`) peuvent être ajustés depuis le module de
plateforme. La sonde de démarrage par défaut prévoit un délai initial de 15
secondes et un seuil de 10 échecs pour laisser le temps au montage GCS FUSE et au
chargement des index HNSW lors du premier démarrage.

Les deux variantes (GKE et Cloud Run) utilisent une sonde HTTP sur
`/api/v2/heartbeat`, qui renvoie HTTP 200 dès que Chroma est entièrement
initialisé et prêt à traiter les requêtes.

---

## 7. Image de conteneur {#7-container-image}

Chroma_Common définit `container_image = "chromadb/chroma"` avec `image_source = "custom"`,
ce qui demande à Cloud Build de mettre en miroir l'image Docker Hub dans le dépôt
Artifact Registry du déploiement avant le démarrage de la charge de travail.
L'étiquette de version exacte est contrôlée par `application_version` dans le
module de plateforme (`latest` par défaut).

Épinglez une étiquette de version précise en production :

```bash
# List available tags mirrored to Artifact Registry:
gcloud artifacts docker tags list <region>-docker.pkg.dev/<project>/<repo>/chroma \
  --project "$PROJECT"
```

---

Pour la configuration de Chroma visible par l'utilisateur (variables par groupe,
sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Chroma_GKE](Chroma_GKE.md)** et
**[Chroma_CloudRun](Chroma_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Chroma sur Google Cloud Run](Chroma_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Chroma sur GKE Autopilot](Chroma_GKE.md) — cette configuration déployée sur GKE.
