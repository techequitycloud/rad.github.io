---
title: "OpenClaw Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module OpenClaw — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/OpenClaw_Common.md @ 3055034 sha256:635e2f9ed2a1 -->

# OpenClaw Common — Configuration applicative partagée {#openclaw-common--shared-application-configuration}

`OpenClaw_Common` est la **couche applicative partagée** d'OpenClaw. Elle n'est pas déployée
seule ; elle fournit la configuration propre à OpenClaw sur laquelle s'appuient à la fois
[OpenClaw_GKE](OpenClaw_GKE.md) et [OpenClaw_CloudRun](OpenClaw_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement OpenClaw, consultez les guides des plateformes
([OpenClaw_GKE](OpenClaw_GKE.md), [OpenClaw_CloudRun](OpenClaw_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par OpenClaw_Common | Où cela apparaît |
|---|---|---|
| Identifiants IA | Stocke la clé API Anthropic et le jeton de passerelle dans **Secret Manager** ; secrets Telegram et Slack facultatifs | Injectés à l'exécution — à récupérer dans Secret Manager (voir ci-dessous) |
| Image de conteneur | Fige `ghcr.io/openclaw/openclaw` comme image de base et construit une image personnalisée en ajoutant `entrypoint.sh` par-dessus | Sortie `container_image` du déploiement sur la plateforme |
| Aucune base de données | Définit `database_type = null` — Cloud SQL et Redis ne sont jamais provisionnés | Aucune instance Cloud SQL ni tâche d'initialisation n'apparaît dans le déploiement |
| Espace de travail GCS | Déclare le bucket `<prefix>-storage` et le volume GCS Fuse `openclaw-data`, toujours monté sur `/data` | Sortie `storage_buckets` ; à vérifier avec `gcloud storage ls` |
| Paramètres de base | Définit les variables d'environnement de référence (`OPENCLAW_STATE_DIR`, `NODE_ENV`, `NODE_OPTIONS`, `NPM_CONFIG_CACHE`, `SKILLS_REPO_URL`, `SKILLS_REPO_REF`) | Comportement de l'application dans les guides des plateformes |
| Comportement au démarrage | Pilote `entrypoint.sh` — écrit `openclaw.json` à partir des variables d'environnement, synchronise éventuellement le dépôt de skills, puis démarre la passerelle | §Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit des sondes HTTP ciblant `GET /health` sur le port 8080 avec un délai initial suffisant pour le montage GCS Fuse et le démarrage de Node.js | §Observabilité dans les guides des plateformes |

---

## 2. Identifiants dans Secret Manager {#2-credentials-in-secret-manager}

Les secrets suivants sont gérés par `OpenClaw_Common`. Ils sont créés dans Secret Manager
pendant le déploiement et n'apparaissent jamais en clair dans les fichiers de configuration ni dans l'état Terraform.

| Suffixe de l'ID du secret | Injecté sous la forme | Moment de création |
|---|---|---|
| `<prefix>-anthropic-api-key` | `ANTHROPIC_API_KEY` | Toujours (le conteneur du secret est toujours créé ; la version n'est écrite que lorsque `anthropic_api_key` n'est pas vide) |
| `<prefix>-gateway-token` | `OPENCLAW_GATEWAY_TOKEN` | Toujours ; généré automatiquement sous la forme d'un jeton hexadécimal de 64 caractères lorsque `gateway_token` est laissé vide |
| `<prefix>-telegram-bot-token` | `TELEGRAM_BOT_TOKEN` | Lorsque `enable_telegram = true` |
| `<prefix>-telegram-webhook-secret` | Non injecté dans l'agent — usage par le routeur uniquement | Lorsque `enable_telegram = true` |
| `<prefix>-slack-bot-token` | `SLACK_BOT_TOKEN` | Lorsque `enable_slack = true` |
| `<prefix>-slack-signing-secret` | Non injecté dans l'agent — usage par le routeur uniquement | Lorsque `enable_slack = true` |

Récupérez n'importe quel identifiant après le déploiement :

```bash
# List all secrets for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<prefix>"

# Read the Anthropic API key (use only on initial setup; manage via Secret Manager thereafter):
gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"

# Read the gateway token (required to register API clients):
gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
```

Un délai de propagation de 30 secondes est appliqué après l'écriture des versions de secrets, avant que la
sortie `secret_ids` ne soit résolue, afin que la réplication de Secret Manager soit terminée avant le
démarrage du conteneur.

---

## 3. Image de conteneur et build {#3-container-image-and-build}

`OpenClaw_Common` déclenche toujours le build d'une image personnalisée. Le Dockerfile de `scripts/` ajoute
`git` (pour le clonage du dépôt de skills) et `entrypoint.sh` par-dessus l'image amont de la passerelle :

```
ARG BASE_IMAGE=ghcr.io/openclaw/openclaw:<application_version>
FROM ${BASE_IMAGE}
# adds git, ca-certificates, and entrypoint.sh
```

L'argument de build `BASE_IMAGE` est défini au moment du Cloud Build sur
`ghcr.io/openclaw/openclaw:<application_version>`, ce qui fige la version amont. Utilisez un
tag de version précis dans `application_version` pour des builds reproductibles.

---

## 4. Espace de travail GCS — aucune base de données {#4-gcs-workspace--no-database}

OpenClaw ne nécessite ni instance Cloud SQL ni tâche d'initialisation de base de données. Tout l'état
durable des agents est stocké dans un bucket GCS monté par GCS Fuse :

```
<prefix>-storage/               ← GCS bucket (mounted at /data)
├── workspace/                  ← agent workspace (/data/workspace)
│   └── skill-library/          ← shared skills repo (when SKILLS_REPO_URL is set)
├── agents/main/agent/          ← agent state directory
└── ...
```

Le montage est toujours ajouté à `gcs_volumes` avec les options `uid=1000,gid=1000`, qui correspondent
à l'utilisateur du conteneur de l'image OpenClaw amont. Inspectez le bucket :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<prefix>-storage/
```

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`OpenClaw_Common` établit l'environnement de référence afin que la passerelle démarre correctement :

- **`OPENCLAW_STATE_DIR = /tmp/openclaw`** — le staging des plugins npm et le répertoire de configuration XDG sont
  redirigés vers le disque local. GCS Fuse ne prend en charge ni les liens physiques ni les renommages à forte concurrence,
  ce qui provoque des échecs du staging npm lorsque ces opérations ont lieu sur le volume `/data`. L'espace de travail
  persistant des agents et l'état des agents sont toujours écrits sous les chemins `/data`.
- **`NODE_ENV = production`** — active le mode production de Node.js. Ne le remplacez pas par
  `development` dans un déploiement de production.
- **`NODE_OPTIONS = --max-old-space-size=1536`** — évite un OOM de Node.js sur les conteneurs de 2 GiB.
  Augmentez-le si vous utilisez une `memory_limit` plus élevée.
- **`NPM_CONFIG_CACHE = /tmp/.npm`** — redirige le cache npm vers un stockage local éphémère.
- **`SKILLS_REPO_URL` / `SKILLS_REPO_REF`** — transmis depuis le module de plateforme et
  utilisés par `entrypoint.sh` pour cloner ou mettre à jour le dépôt de skills à chaque démarrage.

---

## 6. Séquence de démarrage de `entrypoint.sh` {#6-entrypointsh-startup-sequence}

Chaque démarrage du conteneur exécute la séquence suivante avant de passer la main au processus
de la passerelle :

1. **Préparation des répertoires.** Crée `$OPENCLAW_STATE_DIR`, `/data/workspace` et le répertoire de l'agent
   (`$OPENCLAW_AGENT_DIR`, par défaut `$OPENCLAW_STATE_DIR/agents/main/agent`) s'ils sont absents — le
   montage GCS Fuse est vide lors de la première exécution.
2. **Régénération de la configuration.** Écrit un nouveau `openclaw.json` dans `$OPENCLAW_STATE_DIR`. Cela
   garantit que les variables d'environnement gérées par Terraform l'emportent toujours sur les valeurs obsolètes précédemment
   persistées sur le volume GCS. Construit le bloc `channels` de Telegram, le modèle et
   l'identité de l'agent, le flag `approvals.exec.enabled` (à partir de `OPENCLAW_EXEC_APPROVALS`, par défaut
   `true`) et `skills.load.extraDirs`.
3. **Synchronisation du dépôt de skills (facultative).** Lorsque `SKILLS_REPO_URL` est défini, effectue un clonage
   superficiel ou une mise à jour dans un répertoire local sous `$OPENCLAW_STATE_DIR/skill-library` — tenu à l'écart
   du volume GCS Fuse, car les appels `link()` de git ne sont pas implémentés sous GCSFuse et
   corrompraient le clone. `SKILLS_REPO_SUBDIR` limite `skills.load.extraDirs` à un sous-répertoire
   du dépôt cloné, de sorte qu'un dépôt à usage général puisse héberger des skills OpenClaw sans que des
   fichiers sans rapport ne se retrouvent dans l'agent. Les échecs de synchronisation ne sont pas bloquants — la passerelle démarre même si le
   clonage échoue.
4. **Installation du plugin fournisseur DeepSeek (facultative).** Lorsque `DEEPSEEK_API_KEY` est défini, installe
   `@openclaw/deepseek-provider` (`node dist/index.js plugins install @openclaw/deepseek-provider`,
   exécuté depuis `/app`) afin que `OPENCLAW_AGENT_MODEL=deepseek/deepseek-v4-flash` soit résolu au moment
   du tour de l'agent — le runtime d'agent embarqué d'OpenClaw ne résout que les fournisseurs intégrés et les plugins
   installés, pas les entrées de configuration ad hoc `models.providers`. L'URL de base du plugin est fixée à
   `api.deepseek.com` et ne peut pas être acheminée via LiteLLM. Idempotente ; un échec d'installation n'est
   pas bloquant (repli sur un modèle intégré).
5. **`bin/` des skills dans le PATH.** Ajoute en tête du `PATH` le répertoire `bin/` facultatif du dépôt de skills
   cloné et de `OPENCLAW_SKILLS_BAKED_DIR` (par défaut `/opt/openclaw-skills` — des skills intégrés directement
   dans l'image, chargés en plus de tout dépôt cloné, sans clonage git ni
   jeton à l'exécution), de sorte que l'outil d'exécution d'un skill (par ex. `agent-bridge`, qui publie vers les webhooks
   d'approbation agent-core de n8n) puisse être invoqué par son nom via l'outil `exec` d'OpenClaw.
6. **Démarrage de la passerelle.** Exécute `node dist/index.js gateway --bind lan --port ${PORT:-8080}
   --allow-unconfigured`. Le flag `--bind lan` est requis pour Cloud Run — le runtime associe
   le port externe à l'interface LAN du conteneur.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent `GET /health` sur le port 8080, qui ne répond qu'une fois la passerelle
entièrement initialisée.

- Sonde de démarrage **GKE** : HTTP `/health`, 36 tentatives × 5 s + 10 s de délai initial ≈ 3 minutes —
  ce qui laisse suffisamment de marge à npm pour préparer les plus de 35 paquets de plugins embarqués avant le démarrage
  de la passerelle.
- Sonde de démarrage **Cloud Run** : HTTP `/health`, 24 tentatives × 5 s + 20 s de délai initial ≈ 2
  minutes — légèrement plus courte, car le démarrage d'un conteneur Cloud Run est plus rapide que l'initialisation
  d'un pod Kubernetes.

Les deux plateformes utilisent la même sonde de vivacité : HTTP `/health`, seuil de 3 échecs avec une période
de 30 s.

---

## 8. Stockage d'objets {#8-object-storage}

Le bucket GCS `<prefix>-storage` est déclaré ici et provisionné par le socle, qui
accorde également `roles/storage.objectAdmin` au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à OpenClaw destinée aux utilisateurs (variables par groupe, sorties et manière
d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[OpenClaw_GKE](OpenClaw_GKE.md)** et **[OpenClaw_CloudRun](OpenClaw_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [OpenClaw sur Google Cloud Run](OpenClaw_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [OpenClaw sur GKE Autopilot](OpenClaw_GKE.md) — cette configuration déployée sur GKE.
