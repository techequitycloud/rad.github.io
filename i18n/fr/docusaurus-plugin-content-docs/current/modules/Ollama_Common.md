---
title: "Ollama Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Ollama — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Ollama_Common.md @ 3055034 sha256:1648223978f2 -->

# Ollama Common — Configuration applicative partagée {#ollama-common--shared-application-configuration}

`Ollama_Common` est la **couche applicative partagée** d'Ollama. Elle n'est pas déployée
seule ; elle fournit la configuration propre à Ollama sur laquelle s'appuient
[Ollama_GKE](Ollama_GKE.md) et [Ollama_CloudRun](Ollama_CloudRun.md), de sorte que les
deux variantes de plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Ollama, consultez les guides des plateformes
([Ollama_GKE](Ollama_GKE.md), [Ollama_CloudRun](Ollama_CloudRun.md)) et les guides
du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Ollama_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image préconstruite `ollama/ollama` et active la mise en miroir des images | Sortie `container_image` du déploiement de la plateforme |
| Aucun identifiant | Produit des maps `secret_ids` et `secret_values` vides — Ollama ne requiert ni identifiants de base de données ni mots de passe | Aucune entrée Secret Manager n'est créée |
| Stockage des modèles | Déclare le bucket **Cloud Storage** `<prefix>-models` et ajoute le montage de volume GCS Fuse `ollama-models` | Sorties `models_bucket` et `storage_buckets` |
| Paramètres de base | Fixe `container_port = 11434`, `database_type = "NONE"`, `enable_cloudsql_volume = false` et injecte les trois variables d'environnement Ollama obligatoires | Comportement de l'application dans les guides des plateformes |
| Job de téléchargement du modèle | Génère automatiquement un job d'initialisation `model-pull` lorsque `default_model` est défini et qu'aucun job personnalisé n'est fourni | Sortie `initialization_jobs` |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage (délai de 30 s, 20 tentatives) et de vivacité (délai de 60 s, 3 tentatives) ciblant `/` | §Observabilité dans les guides des plateformes |

---

## 2. Aucun identifiant — aucune entrée Secret Manager {#2-no-credentials--no-secret-manager-entries}

Contrairement à la plupart des modules applicatifs, Ollama ne requiert **aucun secret géré par l'application**. Il n'y a
ni mot de passe administrateur ni mot de passe de base de données. Les sorties `secret_ids` et `secret_values`
sont toujours des maps vides.

Si vous devez injecter une clé d'API ou une autre valeur sensible (par exemple pour protéger un
point de terminaison exposé via `LoadBalancer`), utilisez `secret_environment_variables` dans le module de plateforme
pour référencer un secret que vous créez indépendamment :

```bash
gcloud secrets list --project "$PROJECT"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Stockage des modèles dans Cloud Storage {#3-model-storage-in-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `-models`) est déclaré ici et provisionné par
le socle. Le compte de service de la charge de travail reçoit automatiquement un accès en lecture/écriture via
Workload Identity. Le bucket est monté dans chaque conteneur via le pilote **GCS Fuse**
(Cloud Run gen2) ou le **pilote CSI GCS Fuse** (GKE Autopilot) sur `/mnt/gcs`.

La variable d'environnement `OLLAMA_MODELS` vaut `/mnt/gcs/ollama/models`, de sorte qu'Ollama
découvre et stocke les poids des modèles dans un emplacement partagé et persistant qui survit aux redémarrages
de conteneur et aux nouvelles révisions.

Organisation du bucket GCS :

```
<resource_prefix>-models/          ← GCS bucket root
└── ollama/
    └── models/                    ← /mnt/gcs/ollama/models (OLLAMA_MODELS)
        ├── llama3.2:3b/
        ├── mistral/
        └── ...
```

Explorez le bucket :

```bash
gcloud storage ls gs://<models-bucket>/ollama/models/
gcloud storage buckets describe gs://<models-bucket> --project "$PROJECT"
```

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Ollama_Common` établit la configuration de base d'Ollama afin que le service démarre
correctement dès le premier lancement :

- **Port du conteneur fixé à 11434** — le port natif de l'API REST d'Ollama.
- **Pas de base de données, pas de Redis** — `database_type = "NONE"` et `enable_cloudsql_volume = false`
  sont codés en dur. Aucune instance Cloud SQL n'est provisionnée.
- **Variables d'environnement injectées automatiquement** — elles sont toujours définies et ne doivent pas être
  remplacées (sauf `OLLAMA_KEEP_ALIVE`) :

  | Variable | Valeur | Rôle |
  |---|---|---|
  | `OLLAMA_MODELS` | `/mnt/gcs/ollama/models` | Fait pointer Ollama vers le sous-répertoire GCS Fuse pour la persistance des modèles. |
  | `OLLAMA_HOST` | `0.0.0.0:11434` | Écoute sur toutes les interfaces afin que l'entrée Cloud Run ou le proxy de service Kubernetes puisse acheminer le trafic. |
  | `OLLAMA_KEEP_ALIVE` | `24h` | Maintient le modèle chargé en mémoire entre les requêtes, supprimant la latence de chargement du modèle à chaque requête. Remplacez-la en définissant `OLLAMA_KEEP_ALIVE` dans `environment_variables`. |

- **Image préconstruite** — `ollama/ollama` est utilisée directement (`image_source = "prebuilt"`).
  La duplication de l'image vers Artifact Registry est activée par défaut pour éviter les limites de débit
  de Docker Hub.
- **Aucun service compagnon** — Ollama n'a pas de conteneur compagnon (pas de proxy sidecar, pas de
  processus worker). La liste `additional_services` est toujours vide depuis cette couche.

---

## 5. Job d'initialisation de téléchargement du modèle {#5-model-pull-initialization-job}

Lorsque `default_model` est défini dans le module de plateforme et qu'aucun `initialization_jobs` personnalisé n'est
fourni, `Ollama_Common` génère automatiquement un job ponctuel nommé `model-pull` qui :

1. Démarre un serveur Ollama local en arrière-plan.
2. Interroge `http://localhost:11434/` jusqu'à 30 fois (intervalle de 3 secondes) jusqu'à ce que le serveur soit
   prêt.
3. Exécute `ollama pull $OLLAMA_MODEL` en utilisant le répertoire des modèles monté depuis GCS.
4. Arrête le serveur d'arrière-plan et se termine proprement.

Le job s'exécute au moment du déploiement (`execute_on_apply = true`), monte le volume GCS `ollama-models`
et hérite des limites de CPU et de mémoire du module de plateforme. Son délai d'expiration est
contrôlé par `model_pull_timeout_seconds` (3600 secondes par défaut ; les grands modèles peuvent prendre
20–30 minutes). Fournir une entrée quelconque dans `initialization_jobs` désactive entièrement le job
généré automatiquement.

Inspectez le job :

```bash
# GKE:
kubectl get jobs -n "$NAMESPACE"
kubectl logs -n "$NAMESPACE" job/model-pull

# Cloud Run:
gcloud run jobs list --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité ciblent toutes deux le chemin racine d'Ollama (`/`), qui répond
`"Ollama is running"` une fois le serveur entièrement initialisé et le modèle chargé.

- **Sonde de démarrage** — délai initial de 30 s avec 20 tentatives en échec (environ 5 minutes au total).
  Cela laisse le temps du montage GCS Fuse et du chargement du modèle depuis GCS au démarrage à froid.
- **Sonde de vivacité** — délai initial de 60 s avec 3 tentatives en échec. Ce délai initial plus long
  évite des redémarrages intempestifs pendant la phase de chargement du modèle.

Les deux variantes (GKE et Cloud Run) utilisent des sondes HTTP ciblant `/` — Ollama ne redirige pas
ce chemin, aucun ajustement en sonde TCP n'est donc nécessaire (contrairement aux applications PHP/Apache).

---

Pour la configuration propre à Ollama destinée aux utilisateurs (variables par groupe, sorties et manière
d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Ollama_GKE](Ollama_GKE.md)** et **[Ollama_CloudRun](Ollama_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Ollama sur Google Cloud Run](Ollama_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Ollama sur GKE Autopilot](Ollama_GKE.md) — cette configuration déployée sur GKE.
