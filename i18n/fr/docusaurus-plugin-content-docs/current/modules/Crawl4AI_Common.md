---
title: "Crawl4AI Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Crawl4AI — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Crawl4AI_Common.md @ 3055034 sha256:d0454aafc256 -->

# Crawl4AI Common — Configuration applicative partagée {#crawl4ai-common--shared-application-configuration}

`Crawl4AI_Common` est la **couche applicative partagée** de Crawl4AI. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Crawl4AI sur
laquelle s'appuient [Crawl4AI_GKE](Crawl4AI_GKE.md) et
[Crawl4AI_CloudRun](Crawl4AI_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle ne
possède aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Crawl4AI, consultez
les guides des plateformes ([Crawl4AI_GKE](Crawl4AI_GKE.md),
[Crawl4AI_CloudRun](Crawl4AI_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Crawl4AI_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image préconstruite officielle `unclecode/crawl4ai` et active la mise en miroir de l'image dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Aucune base de données | Fixe `database_type = "NONE"` — Cloud SQL n'est pas provisionné ; pas de side-car Auth Proxy | Aucune sortie `database_*` — Crawl4AI est entièrement sans état |
| Redis intégré | Déclare `REDIS_TASK_TTL` pour contrôler le TTL des résultats des tâches dans le conteneur | §Redis intégré dans les guides des plateformes |
| Secrets générés automatiquement | Crée `CRAWL4AI_API_TOKEN` et `SECRET_KEY` dans Secret Manager et les renvoie dans la map `secret_ids` | Injectez les clés des LLM via `secret_environment_variables` |
| Aucun bucket de stockage | Renvoie une liste `storage_buckets` vide — aucun bucket GCS n'est provisionné automatiquement | Ajoutez des buckets de résultats facultatifs via `storage_buckets` dans le module de la plateforme |
| Variables d'environnement de base | Définit `PYTHONUNBUFFERED=1` et `REDIS_TASK_TTL` | Comportement de l'application dans les guides des plateformes |
| Sondes de santé | Fournit la sonde HTTP de démarrage/vivacité par défaut sur `/health` avec un délai initial de 40 s | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur et mise en miroir {#2-container-image-and-mirroring}

`Crawl4AI_Common` définit `image_source = "prebuilt"` et
`container_image = "unclecode/crawl4ai"`. Aucune étape Cloud Build n'est
utilisée par défaut. La mise en miroir de l'image est activée
(`enable_image_mirroring = true`) pour copier l'image Docker Hub en amont dans
Artifact Registry avant le déploiement, ce qui évite les échecs dus aux limites
de débit de Docker Hub sur des images volumineuses (~3–4 GiB compressées).

Pour afficher l'image mise en miroir dans Artifact Registry :

```bash
gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
```

Le nom du dépôt Artifact Registry figure dans la sortie `container_registry` du
déploiement de la plateforme.

---

## 3. Architecture sans état — ni base de données, ni stockage persistant {#3-stateless-architecture--no-database-no-persistent-storage}

Crawl4AI ne dépend d'aucune base de données externe. `Crawl4AI_Common` fixe les
éléments suivants pour éviter un provisionnement accidentel de Cloud SQL :

- `database_type = "NONE"` — aucune instance Cloud SQL n'est créée.
- `enable_cloudsql_volume = false` — aucun side-car Cloud SQL Auth Proxy n'est
  injecté dans le conteneur.
- `storage_buckets = []` — aucun bucket GCS n'est provisionné automatiquement.

L'état des tâches est entièrement conservé dans l'instance Redis intégrée qui
s'exécute dans le conteneur. Les résultats sont éphémères — ils sont perdus au
redémarrage du conteneur ou du pod. C'est le comportement attendu pour une API
d'exploration sans état.

---

## 4. Redis intégré et architecture des processus {#4-embedded-redis-and-process-architecture}

L'image `unclecode/crawl4ai` exécute deux processus gérés par supervisord
(PID 1) :

| Priorité | Processus | Port | Rôle |
|---|---|---|---|
| 10 | Serveur Redis | localhost:6379 | File d'attente des tâches et stockage des résultats |
| 20 | Gunicorn (1 worker × 4 threads) | 0.0.0.0:11235 | Serveur ASGI FastAPI |

**Ne remplacez pas `REDIS_HOST` ni `REDIS_PORT`** par des variables
d'environnement — le Redis intégré n'est accessible que sur `localhost:6379` et
ne doit pas être redirigé vers un point de terminaison externe.

Le `config.yml` par défaut fourni dans l'image définit
`crawler.pool.max_pages = 40` (nombre maximal de pages de navigateur simultanées
par instance de conteneur) et inclut `--disable-dev-shm-usage` dans les
arguments de lancement supplémentaires de Chromium. Sur Cloud Run, cela redirige
le travail en mémoire partagée de Chromium vers `/tmp` ; sur GKE, le socle
`App_GKE` monte un véritable volume emptyDir sur `/dev/shm`, si bien que ce
contournement n'est pas nécessaire.

---

## 5. Variables d'environnement de base {#5-core-environment-variables}

`Crawl4AI_Common` injecte automatiquement deux variables d'environnement dans
chaque déploiement :

| Variable | Valeur | Objectif |
|---|---|---|
| `PYTHONUNBUFFERED` | `1` | Garantit que la sortie des journaux Python est diffusée immédiatement vers Cloud Logging, sans mise en mémoire tampon |
| `REDIS_TASK_TTL` | `<redis_task_ttl_seconds>` | Contrôle la durée pendant laquelle les résultats des tâches terminées sont conservés dans le Redis intégré avant expiration |

Les variables d'environnement supplémentaires provenant de
`environment_variables` dans le module de plateforme appelant sont fusionnées
après celles-ci. Variables reconnues par Crawl4AI à l'exécution :

| Variable | Comment l'injecter | Objectif |
|---|---|---|
| `LLM_PROVIDER` | `environment_variables` | Remplacer le backend LLM (par ex. `"anthropic/claude-3-haiku"`, `"openai/gpt-4o-mini"`) |
| `LLM_BASE_URL` | `environment_variables` | Remplacer l'URL de base de l'API LLM (pour Ollama ou des proxys personnalisés) |
| `LLM_TEMPERATURE` | `environment_variables` | Remplacer la température d'échantillonnage du LLM |
| `CRAWL4AI_HOOKS_ENABLED` | `environment_variables` | Activer les hooks de webhook — **risque d'exécution de code à distance (RCE) ; à n'utiliser que dans des environnements de confiance** |
| `CRAWL4AI_API_TOKEN` | généré automatiquement | Jeton Bearer pour les appels d'API. Obligatoire — s'il n'est pas défini, l'image lie Gunicorn à l'interface de bouclage uniquement, et la sonde de santé ne réussit jamais |
| `SECRET_KEY` | généré automatiquement | Secret de signature JWT, épinglé afin que les jetons émis survivent aux redémarrages |
| `OPENAI_API_KEY` | `secret_environment_variables` | Clé d'API OpenAI pour l'extraction basée sur les LLM |
| `ANTHROPIC_API_KEY` | `secret_environment_variables` | Clé d'API Anthropic pour l'extraction basée sur les LLM |
| `DEEPSEEK_API_KEY` | `secret_environment_variables` | Clé d'API DeepSeek |
| `GROQ_API_KEY` | `secret_environment_variables` | Clé d'API Groq |
| `GEMINI_API_KEY` | `secret_environment_variables` | Clé d'API Google Gemini |
| `LLM_API_KEY` | `secret_environment_variables` | Clé d'API LLM générique pour le fournisseur configuré |

Pour accéder à la valeur d'un secret existant après le déploiement :

```bash
gcloud secrets list --project "$PROJECT"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`Crawl4AI_Common` fournit les sondes par défaut des deux variantes de
plateforme. La sonde de démarrage par défaut utilise un HTTP GET sur `/health`
avec un **délai initial de 40 secondes** — cela laisse à supervisord le temps de
démarrer Redis (priorité 10) puis Gunicorn (priorité 20) avant que le point de
terminaison ne devienne accessible. Cela correspond au `start_period: 40s` du
`docker-compose.yml` en amont.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/health` | 40 s | 10 s | 12 |
| Vivacité | HTTP | `/health` | 60 s | 30 s | 3 |

Les deux variantes de plateforme utilisent la même configuration de sonde HTTP.
Cloud Run n'a pas besoin du contournement par sonde TCP utilisé par certaines
autres applications (comme Mautic), car le Gunicorn de Crawl4AI sert du HTTP
simple sur le port 11235 sans interférence de redirection HTTPS.

---

Pour la configuration propre à Crawl4AI exposée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la
CLI), consultez les guides des plateformes : **[Crawl4AI_GKE](Crawl4AI_GKE.md)**
et **[Crawl4AI_CloudRun](Crawl4AI_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Crawl4AI sur Google Cloud Run](Crawl4AI_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Crawl4AI sur GKE Autopilot](Crawl4AI_GKE.md) — cette configuration déployée sur GKE.
