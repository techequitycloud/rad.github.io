---
title: "Ollama Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Ollama — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Ollama_Common.md @ 15fd4c7 sha256:369d8b61bf9e -->

# Ollama Common — Configuration d'application partagée {#ollama-common--shared-application-configuration}

`Ollama_Common` est la **couche d'application partagée** pour Ollama. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration spécifique à Ollama sur laquelle
[Ollama_GKE](Ollama_GKE.md) et [Ollama_CloudRun](Ollama_CloudRun.md) s'appuient, de sorte que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas
d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation de la
plateforme.

Pour l'infrastructure qui provisionne et exécute Ollama, consultez les guides de
plateforme ([Ollama_GKE](Ollama_GKE.md), [Ollama_CloudRun](Ollama_CloudRun.md)) et les
guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Ollama_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image pré-construite `ollama/ollama` et active la mise en miroir d'images | Sortie `container_image` du déploiement de la plateforme |
| Pas de justificatifs | Produit des cartes `secret_ids` et `secret_values` vides — Ollama ne nécessite pas de justificatifs de base de données ni de mots de passe | Aucune entrée Secret Manager n'est créée |
| Stockage de modèles | Déclare le bucket **Cloud Storage** `<prefix>-models` et ajoute le montage de volume GCS Fuse `ollama-models` | Sorties `models_bucket` et `storage_buckets` |
| Paramètres de base | Fixe `container_port = 11434`, `database_type = "NONE"`, `enable_cloudsql_volume = false`, et injecte les trois variables d'environnement Ollama obligatoires | Comportement de l'application dans les guides de plateforme |
| Job de pull de modèle | Génère automatiquement un job d'initialisation `model-pull` lorsque `default_model` est défini et qu'aucun job personnalisé n'est fourni | Sortie `initialization_jobs` |
| Sondes de santé | Fournit la configuration par défaut des sondes de démarrage (délai de 30 s, 20 tentatives) et de vivacité (délai de 60 s, 3 tentatives) ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Pas de justificatifs — pas d'entrées Secret Manager {#2-no-credentials--no-secret-manager-entries}

Contrairement à la plupart des modules d'application, Ollama ne nécessite **aucun secret
géré par l'application**. Il n'y a pas de mot de passe administrateur ni de mot de passe
de base de données. Les sorties `secret_ids` et `secret_values` sont toujours des cartes
vides.

Si vous avez besoin d'injecter une clé API ou une autre valeur sensible (par exemple, pour
protéger un point de terminaison exposé `LoadBalancer`), utilisez `secret_environment_variables` dans le
module de plateforme pour référencer un secret que vous créez indépendamment :

```bash
gcloud secrets list --project "$PROJECT"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Voir [App_Common](App_Common.md) pour le modèle de secret partagé et d'identité de
charge de travail.

---

## 3. Stockage de modèles dans Cloud Storage {#3-model-storage-in-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `-models`) est déclaré ici et
provisionné par le socle. Le compte de service de la charge de travail se voit accorder un
accès en lecture/écriture automatiquement via Workload Identity. Le bucket est monté dans
chaque conteneur via le pilote **GCS Fuse** (Cloud Run gen2) ou le **pilote CSI GCS
Fuse** (GKE Autopilot) à `/mnt/gcs`.

La variable d'environnement `OLLAMA_MODELS` est définie sur `/mnt/gcs/ollama/models` afin
qu'Ollama découvre et stocke les poids des modèles dans un emplacement persistant et
partagé qui survit aux redémarrages de conteneurs et aux nouvelles révisions.

Disposition du bucket GCS :

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

## 4. Paramètres d'application de base {#4-core-application-settings}

`Ollama_Common` établit la configuration de base d'Ollama afin que le service démarre
correctement au premier boot :

- **Port de conteneur fixé à 11434** — le port d'API REST natif d'Ollama.
- **Pas de base de données, pas de Redis** — `database_type = "NONE"` et `enable_cloudsql_volume = false`
  sont codés en dur. Aucune instance Cloud SQL n'est provisionnée.
- **Variables d'environnement injectées automatiquement** — celles-ci sont toujours
  définies et ne doivent pas être remplacées (sauf `OLLAMA_KEEP_ALIVE`) :

  | Variable | Valeur | Objectif |
  |---|---|---|
  | `OLLAMA_MODELS` | `/mnt/gcs/ollama/models` | Pointe Ollama vers le sous-répertoire GCS Fuse pour la persistance du modèle. |
  | `OLLAMA_HOST` | `0.0.0.0:11434` | Se lie à toutes les interfaces afin que l'entrée Cloud Run ou le proxy de service Kubernetes puisse acheminer le trafic. |
  | `OLLAMA_KEEP_ALIVE` | `24h` | Maintient le modèle chargé en mémoire entre les requêtes, éliminant la latence de chargement du modèle par requête. Remplacer en définissant `OLLAMA_KEEP_ALIVE` dans `environment_variables`. |

- **Image pré-construite** — `ollama/ollama` est utilisée directement (`image_source = "prebuilt"`).
  La mise en miroir d'images vers Artifact Registry est activée par défaut pour éviter les
  limites de débit de Docker Hub.
- **Pas de services compagnons** — Ollama n'a pas de conteneurs compagnons (pas de proxy
  sidecar, pas de processus worker). La liste `additional_services` est toujours vide à partir
  de cette couche.

---

## 5. Job d'initialisation de pull de modèle {#5-model-pull-initialization-job}

Lorsque `default_model` est défini dans le module de plateforme et qu'aucun `initialization_jobs`
personnalisé n'est fourni, `Ollama_Common` génère automatiquement un job unique nommé
`model-pull` qui :

1. Démarre un serveur Ollama local en arrière-plan.
2. Interroge le serveur local avec `ollama list` jusqu'à 30 fois (intervalle de 3
   secondes) jusqu'à ce qu'il soit prêt. (L'image `ollama/ollama` ne contient pas de
   `curl` ou `wget`, et le script est exécuté par le `/bin/sh` de
   l'image, qui est `dash` — il est donc écrit en POSIX-sh pur.)
3. Exécute `ollama pull $OLLAMA_MODEL` en utilisant le répertoire de modèles monté sur GCS.
4. Arrête le serveur en arrière-plan et se termine proprement.

Le job s'exécute au moment du déploiement (`execute_on_apply = true`), monte le volume GCS
`ollama-models` et hérite des limites de CPU et de mémoire du module de plateforme. Son
délai d'expiration est contrôlé par `model_pull_timeout_seconds` (par défaut 3600 secondes ; les
grands modèles peuvent prendre 20 à 30 minutes). Fournir n'importe quelle entrée dans
`initialization_jobs` désactive entièrement le job auto-généré.

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

Les sondes de démarrage et de vivacité ciblent toutes deux le chemin racine d'Ollama
(`/`), qui répond avec `"Ollama is running"` une fois que le serveur est
entièrement initialisé et que le modèle est chargé.

- **Sonde de démarrage** — délai initial de 30 s avec 20 tentatives d'échec (environ 5
  minutes au total). Cela tient compte du temps de montage de GCS Fuse et du chargement du
  modèle depuis GCS lors d'un démarrage à froid.
- **Sonde de vivacité** — délai initial de 60 s avec 3 tentatives d'échec. Le délai
  initial plus long évite les faux redémarrages pendant la phase de chargement du modèle.

Les deux variantes (GKE et Cloud Run) utilisent des sondes HTTP ciblant `/` —
Ollama ne redirige pas ce chemin, donc aucun ajustement de sonde TCP n'est nécessaire
(contrairement aux applications PHP/Apache).

---

Pour la configuration spécifique à Ollama et destinée à l'utilisateur (variables par
groupe, sorties et comment explorer chaque service depuis la Console et la CLI),
consultez les guides de plateforme : **[Ollama_GKE](Ollama_GKE.md)** et
**[Ollama_CloudRun](Ollama_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Ollama sur Google Cloud Run](Ollama_CloudRun.md) — cette configuration déployée sur
  Cloud Run.
- [Ollama sur GKE Autopilot](Ollama_GKE.md) — cette configuration déployée sur GKE.
