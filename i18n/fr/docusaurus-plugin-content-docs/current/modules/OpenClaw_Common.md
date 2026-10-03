---
title: "OpenClaw Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module OpenClaw — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OpenClaw_Common.md @ 15fd4c7 sha256:0a7ff623fb3a -->

# OpenClaw Common — Configuration d'application partagée {#openclaw-common--shared-application-configuration}

`OpenClaw_Common` est la **couche d'application partagée** pour OpenClaw. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à OpenClaw sur laquelle s'appuient [OpenClaw_GKE](OpenClaw_GKE.md) et [OpenClaw_CloudRun](OpenClaw_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement OpenClaw, consultez les guides de plateforme ([OpenClaw_GKE](OpenClaw_GKE.md), [OpenClaw_CloudRun](OpenClaw_CloudRun.md)) et les guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par OpenClaw_Common | Où cela apparaît |
|---|---|---|
| Identifiants IA | Stocke la clé API Anthropic et le jeton de passerelle dans **Secret Manager** ; secrets Telegram et Slack optionnels | Injecté à l'exécution — récupéré de Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle `ghcr.io/openclaw/openclaw` comme base et construit une image personnalisée avec `entrypoint.sh` superposé | Sortie `container_image` du déploiement de la plateforme |
| Pas de base de données | Définit `database_type = null` — Cloud SQL et Redis ne sont jamais provisionnés | Aucune instance Cloud SQL ou job d'initialisation n'apparaît dans le déploiement |
| Espace de travail GCS | Déclare le bucket `<prefix>-storage` et le volume GCS Fuse `openclaw-data` toujours monté à `/data` | Sortie `storage_buckets` ; confirmé via `gcloud storage ls` |
| Paramètres de base | Définit les variables d'environnement de base (`OPENCLAW_STATE_DIR`, `NODE_ENV`, `NODE_OPTIONS`, `NPM_CONFIG_CACHE`, `SKILLS_REPO_URL`, `SKILLS_REPO_REF`) | Comportement de l'application dans les guides de plateforme |
| Comportement au démarrage | Pilote `entrypoint.sh` — écrit `openclaw.json` à partir des variables d'environnement, synchronise éventuellement le dépôt de compétences, puis démarre la passerelle | §Comportement de l'application dans les guides de plateforme |
| Sondes de santé | Fournit des sondes HTTP ciblant `GET /health` sur le port 8080 avec un délai initial suffisant pour le montage GCS Fuse et le démarrage de Node.js | §Observabilité dans les guides de plateforme |

---

## 2. Identifiants dans Secret Manager {#2-credentials-in-secret-manager}

Les secrets suivants sont gérés par `OpenClaw_Common`. Ils sont créés dans Secret Manager lors du déploiement et n'apparaissent jamais en clair dans les fichiers de configuration ou l'état Terraform.

| Suffixe d'ID de secret | Injecté comme | Quand créé |
|---|---|---|
| `<prefix>-anthropic-api-key` | `ANTHROPIC_API_KEY` | Toujours (le conteneur de secret est toujours créé ; la version n'est écrite que lorsque `anthropic_api_key` n'est pas vide) |
| `<prefix>-gateway-token` | `OPENCLAW_GATEWAY_TOKEN` | Toujours ; auto-généré comme un jeton hexadécimal de 64 caractères lorsque `gateway_token` est laissé vide |
| `<prefix>-telegram-bot-token` | `TELEGRAM_BOT_TOKEN` | Lorsque `enable_telegram = true` |
| `<prefix>-telegram-webhook-secret` | Non injecté dans l'agent — utilisation par le routeur uniquement | Lorsque `enable_telegram = true` |
| `<prefix>-slack-bot-token` | `SLACK_BOT_TOKEN` | Lorsque `enable_slack = true` |
| `<prefix>-slack-signing-secret` | Non injecté dans l'agent — utilisation par le routeur uniquement | Lorsque `enable_slack = true` |

Récupérez tout identifiant après le déploiement :

```bash
# List all secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<prefix>"

# Read the Anthropic API key (use only on initial setup; manage via Secret Manager thereafter):
gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"

# Read the gateway token (required to register API clients):
gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
```

Un délai de propagation de 30 secondes est appliqué après l'écriture des versions de secret avant que la sortie `secret_ids` ne soit résolue, garantissant que la réplication de Secret Manager est terminée avant le démarrage du conteneur.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

`OpenClaw_Common` déclenche toujours un build d'image personnalisé. Le Dockerfile dans `scripts/` ajoute `git` (pour le clonage du dépôt de compétences) et `entrypoint.sh` par-dessus l'image de passerelle amont :

```
ARG BASE_IMAGE=ghcr.io/openclaw/openclaw:<application_version>
FROM ${BASE_IMAGE}
# adds git, ca-certificates, and entrypoint.sh
# ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/entrypoint.sh"]  (keeps the base image's tini as PID 1)
```

L'argument de build `BASE_IMAGE` est défini au moment du build Cloud Build sur `ghcr.io/openclaw/openclaw:<application_version>`, épinglant la version amont. Utilisez une balise de version spécifique dans `application_version` pour des builds reproductibles.

---

## 4. Espace de travail GCS — pas de base de données {#4-gcs-workspace--no-database}

OpenClaw ne nécessite aucune instance Cloud SQL et aucun job d'initialisation de base de données. Tout l'état durable de l'agent est stocké dans un bucket GCS monté par GCS Fuse :

```
<prefix>-storage/               ← GCS bucket (mounted at /data)
├── workspace/                  ← agent workspace (/data/workspace)
│   └── skill-library/          ← shared skills repo (when SKILLS_REPO_URL is set)
├── agents/main/agent/          ← agent state directory
└── ...
```

Le montage est toujours ajouté à `gcs_volumes` avec les options `uid=1000,gid=1000`, correspondant à l'utilisateur du conteneur de l'image OpenClaw amont. Inspectez le bucket :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/
```

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`OpenClaw_Common` établit l'environnement de base afin que la passerelle démarre correctement :

- **`OPENCLAW_STATE_DIR = /tmp/openclaw`** — la mise en scène des plugins npm et le répertoire de configuration XDG sont redirigés vers le disque local. GCS Fuse ne prend pas en charge les liens physiques ou les renommages à haute concurrence, ce qui provoque des échecs de mise en scène npm lorsque ces opérations se produisent sur le volume `/data`. L'espace de travail persistant de l'agent et l'état de l'agent sont toujours écrits dans les chemins `/data`.
- **`NODE_ENV = production`** — active le mode de production Node.js. Ne pas remplacer par `development` dans un déploiement de production.
- **`NODE_OPTIONS = --max-old-space-size=1536`** — empêche les OOM de Node.js sur les conteneurs de 2 GiB. Ajustez à la hausse lors de l'utilisation d'un `memory_limit` plus grand.
- **`NPM_CONFIG_CACHE = /tmp/.npm`** — redirige le cache npm vers le stockage local éphémère.
- **`SKILLS_REPO_URL` / `SKILLS_REPO_REF`** — transmis depuis le module de plateforme et consommés par `entrypoint.sh` pour cloner ou mettre à jour le dépôt de compétences à chaque démarrage.

---

## 6. Séquence de démarrage `entrypoint.sh` {#6-entrypointsh-startup-sequence}

Chaque démarrage de conteneur exécute la séquence suivante avant de passer au processus de passerelle :

1.  **Configuration des répertoires.** Crée `$OPENCLAW_STATE_DIR`, `/data/workspace` et le répertoire de l'agent (`$OPENCLAW_AGENT_DIR`, par défaut `$OPENCLAW_STATE_DIR/agents/main/agent`) s'ils sont absents — le montage GCS Fuse démarre vide lors de la première exécution.
2.  **Régénération de la configuration.** Écrit un nouveau `openclaw.json` dans `$OPENCLAW_STATE_DIR`. Cela garantit que les variables d'environnement gérées par Terraform l'emportent toujours sur les valeurs obsolètes précédemment persistantes sur le volume GCS. Construit le bloc Telegram `channels`, le modèle et l'identité de l'agent, `gateway.trustedProxies` (le frontend Cloud Run et les plages d'adresses IP du répartiteur de charge Google `169.254.0.0/16`, `35.191.0.0/16`, `130.211.0.0/22` — à remplacer par une liste séparée par des virgules `OPENCLAW_TRUSTED_PROXIES` dans `environment_variables` ; un caractère générique est rejeté par la passerelle et la fait refuser toute requête externe), le drapeau `approvals.exec.enabled` (à partir de `OPENCLAW_EXEC_APPROVALS`, par défaut `true`), et `skills.load.extraDirs`.
3.  **Synchronisation du dépôt de compétences (facultatif).** Lorsque `SKILLS_REPO_URL` est défini, effectue un clonage superficiel ou une mise à jour dans un répertoire local sous `$OPENCLAW_STATE_DIR/skill-library` — maintenu hors du volume GCS Fuse car les appels `link()` de git ne sont pas implémentés sous GCSFuse et corrompraient le clone. `SKILLS_REPO_SUBDIR` confine `skills.load.extraDirs` à un sous-répertoire du dépôt cloné, de sorte qu'un dépôt à usage général peut héberger des compétences OpenClaw sans que des fichiers non pertinents ne se retrouvent dans l'agent. Les échecs de synchronisation ne sont pas fatals — la passerelle démarre même si le clone échoue.
4.  **Installation du plugin du fournisseur DeepSeek (facultatif).** Lorsque `DEEPSEEK_API_KEY` est défini, installe `@openclaw/deepseek-provider` (`node dist/index.js plugins install @openclaw/deepseek-provider`, exécuté depuis `/app`) afin que `OPENCLAW_AGENT_MODEL=deepseek/deepseek-v4-flash` se résolve au moment du tour de l'agent — l'exécution de l'agent intégré d'OpenClaw ne résout que les fournisseurs intégrés et les plugins installés, pas les entrées de configuration `models.providers` ad hoc. L'URL de base du plugin est fixée à `api.deepseek.com` et ne peut pas être acheminée via LiteLLM. Idempotent ; une installation échouée n'est pas fatale (revient à un modèle intégré).
5.  **Compétences `bin/` sur PATH.** Ajoute le répertoire facultatif `bin/` du dépôt de compétences cloné et de `OPENCLAW_SKILLS_BAKED_DIR` (par défaut `/opt/openclaw-skills` — compétences intégrées directement dans l'image, chargées en plus de tout dépôt cloné, ne nécessitant pas de clone git ou de jeton à l'exécution) à `PATH`, de sorte que l'aide à l'exécution d'une compétence (par exemple `agent-bridge`, qui publie sur les webhooks d'approbation de l'agent-core n8n) est invocable par son nom via l'outil `exec` d'OpenClaw.
6.  **Démarrage de la passerelle.** Retourne au répertoire de travail de l'image et exécute `node openclaw.mjs gateway --bind lan --port ${PORT:-8080} --allow-unconfigured` — le lanceur propre à l'image de base, qui valide l'exécution de Node avant de démarrer la passerelle. Le PID 1 du conteneur est `tini` de l'image de base, chaîné devant `entrypoint.sh`, de sorte que les processus engendrés par l'outil `exec` d'OpenClaw sont récupérés plutôt que laissés comme des zombies. Le drapeau `--bind lan` est requis pour Cloud Run — l'exécution mappe le port externe à l'interface LAN du conteneur.

---

## 7. Comportement de la sonde de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent `GET /health` sur le port 8080, qui ne répond qu'une fois la passerelle entièrement initialisée.

-   Sonde de démarrage **GKE** : HTTP `/health`, 36 tentatives × 5 s + 10 s de délai initial ≈ 3 minutes — donne suffisamment de marge pour que npm mette en scène les plus de 35 paquets de plugins groupés avant le démarrage de la passerelle.
-   Sonde de démarrage **Cloud Run** : HTTP `/health`, 24 tentatives × 5 s + 20 s de délai initial ≈ 2 minutes — légèrement plus courte car le démarrage du conteneur Cloud Run est plus rapide que l'initialisation du pod Kubernetes.

Les deux plateformes utilisent la même sonde de vivacité : HTTP `/health`, seuil de 3 échecs avec une période de 30 s.

---

## 8. Stockage d'objets {#8-object-storage}

Le bucket GCS `<prefix>-storage` est déclaré ici et provisionné par le socle, qui accorde également au compte de service de la charge de travail `roles/storage.objectAdmin`. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à OpenClaw et destinée à l'utilisateur (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme : **[OpenClaw_GKE](OpenClaw_GKE.md)** et **[OpenClaw_CloudRun](OpenClaw_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [OpenClaw sur Google Cloud Run](OpenClaw_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [OpenClaw sur GKE Autopilot](OpenClaw_GKE.md) — cette configuration déployée sur GKE.
