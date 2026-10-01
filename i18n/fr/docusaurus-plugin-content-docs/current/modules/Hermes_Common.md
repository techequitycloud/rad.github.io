---
title: "Hermes Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Hermes — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Hermes_Common.md @ 3055034 sha256:2e4195227e2d -->

# Hermes Common — Configuration applicative partagée {#hermes-common--shared-application-configuration}

`Hermes_Common` est la **couche applicative partagée** de Hermes Agent — l'agent
d'IA personnel open source (sous licence MIT), auto-hébergé et auto-améliorant de
Nous Research ([documentation](https://hermes-agent.nousresearch.com/docs/)). Elle
n'est pas déployée seule ; elle fournit la configuration propre à Hermes sur
laquelle reposent à la fois [Hermes_GKE](Hermes_GKE.md) et
[Hermes_CloudRun](Hermes_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Hermes, consultez les
guides de plateforme ([Hermes_GKE](Hermes_GKE.md), [Hermes_CloudRun](Hermes_CloudRun.md))
et les guides de fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Hermes_Common | Où cela apparaît |
|---|---|---|
| Identifiants des fournisseurs de modèles | Stocke `ANTHROPIC_API_KEY` (principal) et, en option, `OPENAI_API_KEY` dans **Secret Manager**, avec un avertissement au moment du plan si aucune clé de fournisseur n'est fournie | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Authentification de l'API de la passerelle | Génère automatiquement `API_SERVER_KEY` (hexadécimal de 64 caractères) — le jeton bearer du serveur d'API compatible OpenAI de la passerelle, sur le port 8642 | À récupérer via Secret Manager |
| Authentification du tableau de bord | Génère automatiquement `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` pour le tableau de bord web sur le port 9119 | À récupérer via Secret Manager |
| Identifiants des connecteurs | Secret `TELEGRAM_BOT_TOKEN` facultatif — Hermes interroge Telegram en long polling sortant, aucun webhook n'est donc nécessaire | Injecté lorsque `enable_telegram = true` |
| Image de conteneur | Référence l'image **préconstruite** officielle `nousresearch/hermes-agent` avec les arguments `["gateway", "run"]` — aucun build personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Conception sans base de données | Fixe `database_type` à none et désactive le volume Cloud SQL — tout l'état est en SQLite + fichiers plats sous `/opt/data` | §Base de données dans les guides de plateforme |
| Socle d'environnement | Lie le serveur d'API (`0.0.0.0:8642`) et le tableau de bord (`0.0.0.0:9119`) afin que les frontaux de la plateforme et `kubectl port-forward` puissent les atteindre | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit des sondes de démarrage et de vivacité **TCP** par défaut (écoute du port) | §Observabilité dans les guides de plateforme |
| Stockage objet / jobs d'initialisation | N'en déclare **aucun** — pas de buckets gérés par le module, pas de jobs d'initialisation | Sorties `storage_buckets` / `initialization_jobs` |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Tous les identifiants de Hermes sont stockés sous la forme
`secret-<tenant-prefix>-<application-name>-<suffix>` et injectés comme variables
d'environnement à l'exécution :

| Suffixe du secret | Variable d'environnement | Source |
|---|---|---|
| `anthropic-api-key` | `ANTHROPIC_API_KEY` | Fourni par l'opérateur (fournisseur de modèles principal) |
| `openai-api-key` | `OPENAI_API_KEY` | Fourni par l'opérateur ; uniquement lorsque `enable_openai = true` |
| `api-server-key` | `API_SERVER_KEY` | **Généré automatiquement** (hexadécimal de 64 caractères) s'il est laissé vide |
| `dashboard-password` | `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` | **Généré automatiquement** s'il est laissé vide ; uniquement lorsque `enable_dashboard = true` |
| `telegram-bot-token` | `TELEGRAM_BOT_TOKEN` | Fourni par l'opérateur ; uniquement lorsque `enable_telegram = true` |

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~hermes"

# Read the gateway API key (needed to call the OpenAI-compatible endpoint):
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project "$PROJECT" \
    --filter='name~hermes AND name~api-server-key' \
    --format='value(name)' --limit=1)" --project "$PROJECT"

# Read the dashboard basic-auth password:
gcloud secrets versions access latest \
  --secret="$(gcloud secrets list --project "$PROJECT" \
    --filter='name~hermes AND name~dashboard-password' \
    --format='value(name)' --limit=1)" --project "$PROJECT"
```

Points à connaître sur la sémantique des mises à jour :

- **Une nouvelle version de secret n'est créée que lorsqu'une valeur non vide est
  fournie.** Lors des déploiements de mise à jour où une variable d'identifiant est
  laissée vide, la version `latest` existante est conservée automatiquement —
  `anthropic_api_key` n'a jamais besoin d'être ressaisie après le premier
  déploiement. Pour faire tourner une clé, fournissez la nouvelle valeur et
  redéployez.
- **Un `check` au moment du plan avertit lorsqu'aucune clé de fournisseur de
  modèles n'est fournie.** Hermes est agnostique vis-à-vis du modèle, mais sans au
  moins une clé de fournisseur, l'agent ne peut pas exécuter un seul tour ; sur
  Cloud Run, un secret Anthropic vide fait en outre échouer le déploiement avec une
  erreur obscure « Secret was not found », si bien que le check fait apparaître le
  problème plus tôt.
- **Sur GKE, `API_SERVER_KEY` contourne SecretSync** et est injecté sous forme de
  Secret Kubernetes explicite, car SecretSync peut matérialiser une valeur vide au
  premier déploiement, avant la fin de la réplication de Secret Manager. Tous les
  autres secrets restent adossés à Secret Manager.

---

## 3. Image de conteneur préconstruite {#3-prebuilt-container-image}

Hermes déploie directement l'image officielle
**`nousresearch/hermes-agent:<application_version>`** — `image_source = "prebuilt"`,
la configuration de build est désactivée, et ce dépôt ne contient ni Dockerfile ni
wrapper de point d'entrée :

- **Initialisation s6-overlay.** L'ENTRYPOINT de l'image est `/init` de
  s6-overlay, qui s'exécute en tant que root afin de pouvoir appliquer `chown` au
  volume de données au premier démarrage, puis bascule vers l'utilisateur non root
  `hermes` avant de lancer l'application.
- **Arguments explicites de la passerelle.** Le CMD par défaut de l'image est la
  CLI interactive `hermes` ; cette couche définit donc
  `container_args = ["gateway", "run"]` pour démarrer à la place le processus de
  passerelle (connecteurs de messagerie + serveur d'API compatible OpenAI).
- **Port 8642.** Le serveur d'API se lie à `0.0.0.0:8642` (`API_SERVER_ENABLED=1`,
  `API_SERVER_HOST=0.0.0.0`, `API_SERVER_PORT=8642`) afin que le frontal Cloud Run
  ou le Service GKE puisse l'atteindre.
- **Mise en miroir dans Artifact Registry** par défaut
  (`enable_image_mirroring = true`) pour éviter les limites de débit de Docker Hub ;
  le miroir tient compte des digests.

```bash
gcloud artifacts docker images list \
  "$REGION-docker.pkg.dev/$PROJECT/<repo>" --filter="package~hermes"
```

---

## 4. Conception sans base de données, avec état sur NFS {#4-no-database-nfs-backed-state-design}

Hermes ne nécessite **ni Cloud SQL ni Redis** — un contraste délibéré avec la
plupart des modules de ce catalogue. L'agent conserve tout (base de configuration
SQLite, clés d'API, sessions, compétences apprises, mémoires) dans des fichiers
plats sous le **répertoire fixe `/opt/data`** de l'image, qui ne peut pas être
modifié par variable d'environnement. Cette couche :

1. Fixe `database_type` à none, `enable_cloudsql_volume = false`, et ne déclare
   aucun job `db-init` — il n'y a rien à initialiser,
2. Ne déclare aucun bucket GCS géré par le module (`storage_buckets = []`),
3. S'appuie sur les variantes de plateforme pour monter le **NFS partagé de la
   plateforme directement sur `/opt/data`** — `enable_nfs = true` est imposé par une
   validation au moment du plan au niveau de la variante, et `nfs_mount_path` vaut
   `/opt/data` par défaut.

Deux règles strictes découlent de la sémantique de SQLite :

- **Ne jamais dépasser une instance/un réplica** — SQLite n'accepte qu'un seul
  écrivain ; les deux variantes valident `max_instance_count = 1`.
- **Ne jamais remplacer le montage NFS par GCSFuse** — SQLite exige un verrouillage
  POSIX et des renommages atomiques que GCSFuse ne peut pas fournir. La variable
  `gcs_volumes` est réservée aux montages auxiliaires.

Inspectez le répertoire d'état sur GKE :

```bash
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /opt/data
```

---

## 5. Socle d'environnement et tableau de bord {#5-environment-baseline-and-dashboard}

Variables d'environnement gérées par le module (toujours définies ; les
`environment_variables` de l'opérateur sont fusionnées en dessous) :

- `API_SERVER_ENABLED = "1"`, `API_SERVER_HOST = "0.0.0.0"`,
  `API_SERVER_PORT = "8642"` — le serveur d'API compatible OpenAI.
- `HERMES_DASHBOARD = "1"` / `"0"` (à partir de `enable_dashboard`),
  `HERMES_DASHBOARD_HOST = "0.0.0.0"`, `HERMES_DASHBOARD_PORT = "9119"`,
  `HERMES_DASHBOARD_BASIC_AUTH_USERNAME = <dashboard_username>` — le tableau de
  bord web intégré au processus, pour la gestion des clés d'API et la configuration
  des profils. Il se lie à toutes les interfaces afin que `kubectl port-forward`
  fonctionne sur GKE ; sur Cloud Run, il n'est pas routé (un seul port d'entrée).

Utilisez la map `environment_variables` de l'opérateur pour les identifiants de
connecteurs facultatifs non couverts par les variables du module (Discord, Slack,
WhatsApp, Signal) ou pour d'autres points de terminaison de fournisseurs (par
exemple OpenRouter).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les deux sondes par défaut de cette couche sont des sondes **TCP d'écoute de
port** sur le port du conteneur (8642) — délibérément pas HTTP : le serveur d'API
authentifie chaque requête avec le jeton bearer `API_SERVER_KEY`, si bien qu'une
sonde HTTP recevrait indéfiniment des 401/403 et bloquerait le déploiement alors
même que la passerelle a démarré correctement. La fenêtre de démarrage (délai de
20s + 24 × 5s sur Cloud Run ; 10s + 36 × 5s sur GKE) couvre le montage NFS et
l'initialisation du répertoire de données au premier démarrage.

Les variantes divergent sur la **sonde de vivacité** : [Hermes_GKE](Hermes_GKE.md)
conserve la sonde de vivacité TCP activée (Kubernetes prend en charge les sondes de
vivacité TCP), tandis que [Hermes_CloudRun](Hermes_CloudRun.md) **la désactive par
défaut** — Cloud Run ne prend pas en charge les sondes de vivacité TCP (TCP est
réservé au démarrage), et le comportement de `/health` de Hermes derrière
l'authentification du serveur d'API n'est pas vérifié ; la sonde de démarrage TCP
et la gestion des instances propre à Cloud Run y couvrent la santé. Ne l'activez
avec un chemin HTTP qu'après avoir vérifié que le point de terminaison n'exige pas
d'authentification.

---

Pour la configuration propre à Hermes destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Hermes_GKE](Hermes_GKE.md)** et
**[Hermes_CloudRun](Hermes_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Hermes Agent sur Google Cloud Run](Hermes_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Hermes Agent sur GKE Autopilot](Hermes_GKE.md) — cette configuration déployée sur GKE.
