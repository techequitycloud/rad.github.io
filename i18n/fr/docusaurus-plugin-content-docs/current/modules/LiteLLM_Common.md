---
title: "LiteLLM Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module LiteLLM — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LiteLLM_Common.md @ 3055034 sha256:0bad335ab998 -->

# LiteLLM Common — Configuration applicative partagée {#litellm-common--shared-application-configuration}

`LiteLLM_Common` est la **couche applicative partagée** de LiteLLM. Elle n'est pas
déployée seule ; elle fournit la configuration propre à LiteLLM sur laquelle
s'appuient à la fois [LiteLLM_GKE](LiteLLM_GKE.md) et [LiteLLM_CloudRun](LiteLLM_CloudRun.md),
de sorte que les deux variantes de plateforme se comportent de façon identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface
de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans
la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement LiteLLM, consultez les
guides des plateformes ([LiteLLM_GKE](LiteLLM_GKE.md),
[LiteLLM_CloudRun](LiteLLM_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par LiteLLM_Common | Où cela apparaît |
|---|---|---|
| Identifiant d'administration | Génère `LITELLM_MASTER_KEY` (préfixée `sk-`) et `LITELLM_SALT_KEY`, et les stocke toutes deux dans **Secret Manager** | Récupération via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image officielle de LiteLLM (`ghcr.io/berriai/litellm`) et construit une image Cloud Build personnalisée avec un `entrypoint.sh` | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`postgres:15-alpine`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Paramètres principaux | Définit l'environnement LiteLLM de base (`HOST`, `STORE_MODEL_IN_DB`, `PROXY_BASE_URL`, paramètres Redis) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage (`/health/readiness`) et la sonde de vivacité (`/health/liveliness`) par défaut | §Observabilité dans les guides des plateformes |

---

## 2. Clé maîtresse et clé de salage dans Secret Manager {#2-master-key-and-salt-key-in-secret-manager}

Deux secrets sont générés automatiquement lors du premier déploiement et stockés dans Secret
Manager — ils ne sont jamais définis en clair.

| Secret | Variable d'environnement | Rôle |
|---|---|---|
| `secret-<resource-prefix>-<app-name>-master-key` | `LITELLM_MASTER_KEY` | Clé d'API d'administration principale, préfixée `sk-` pour la compatibilité OpenAI. Requise pour `/key/generate` et toutes les opérations d'administration. |
| `secret-<resource-prefix>-<app-name>-salt-key` | `LITELLM_SALT_KEY` | Sel utilisé pour hacher les clés virtuelles. **Ne jamais la renouveler une fois des clés virtuelles émises** — toutes les clés existantes deviennent définitivement invalides. |

Récupérez la clé maîtresse après le déploiement :

```bash
# List secrets to find the right name, then access it:
gcloud secrets list --project "$PROJECT" --filter="name~master-key"
gcloud secrets versions access latest --secret=<master-key-secret> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

LiteLLM nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas
pris en charge. Lors du premier déploiement, un job ponctuel exécute `postgres:15-alpine` et
se connecte à Cloud SQL via Auth Proxy pour, de manière idempotente :

1. créer la base de données LiteLLM (si elle est absente),
2. créer l'utilisateur de l'application avec le mot de passe généré,
3. accorder à cet utilisateur tous les privilèges sur cette base de données.

Le job peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=litellm_db --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`LiteLLM_Common` établit l'environnement LiteLLM de base afin que l'application
démarre correctement dès le premier lancement :

- **`STORE_MODEL_IN_DB = "true"`** — la configuration du routage des modèles est stockée dans
  PostgreSQL, ce qui permet à l'interface d'administration de gérer les modèles et les clés virtuelles à l'exécution
  sans redémarrer le conteneur. La valeur `"False"` désactive la gestion des clés
  adossée à la base de données.
- **`PROXY_BASE_URL`** — définie sur l'URL prévue du service afin que LiteLLM génère
  des URL de redirection correctes ainsi que l'URL de base compatible OpenAI annoncée aux clients.
- **`HOST = "0.0.0.0"`** — fait écouter le proxy sur toutes les interfaces du conteneur.
- **`LITELLM_LOG = "INFO"`** — niveau de journalisation par défaut ; redéfinissez-le via
  `environment_variables` pour obtenir plus ou moins de détails.
- **Paramètres Redis** — `REDIS_HOST`, `REDIS_PORT` et `REDIS_PASSWORD` sont
  injectées lorsque `enable_redis = true` et qu'un hôte est fourni. Redis permet la
  mise en cache des réponses et le partage des compteurs de limites de débit entre les réplicas.

---

## 5. Image de conteneur et build {#5-container-image-and-build}

LiteLLM utilise `image_source = "custom"` avec un Dockerfile Cloud Build. L'image
personnalisée étend l'image officielle `ghcr.io/berriai/litellm-database:main-stable`
et intègre un script `entrypoint.sh` qui assemble `DATABASE_URL` au démarrage
du conteneur à partir des variables d'environnement `DB_HOST`, `DB_USER`, `DB_NAME`, `DB_PASSWORD` et `DB_PORT`
injectées par le socle. Cela est nécessaire, car le chemin du socket de Cloud SQL Auth
Proxy n'est connu qu'à l'exécution.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent les points de terminaison de santé dédiés de LiteLLM :

- **Sonde de démarrage** — HTTP GET `/health/readiness`, qui valide la connectivité
  à la base de données et confirme que les migrations de l'ORM Prisma sont terminées avant que le trafic
  soit acheminé vers l'instance. Un seuil d'échec généreux laisse le temps nécessaire aux
  migrations Prisma du premier démarrage.
- **Sonde de vivacité** — HTTP GET `/health/liveliness`, qui confirme que le processus du proxy
  est en cours d'exécution sans revérifier la base de données.

GKE comme Cloud Run conservent des sondes HTTP pour ces points de terminaison — aucun ajustement
vers une sonde TCP n'est nécessaire, car LiteLLM n'émet pas de redirections HTTP→HTTPS qui
casseraient les contrôles de santé.

---

Pour la configuration propre à LiteLLM exposée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[LiteLLM_GKE](LiteLLM_GKE.md)** et
**[LiteLLM_CloudRun](LiteLLM_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LiteLLM sur GKE Autopilot](LiteLLM_GKE.md) — cette configuration déployée sur GKE.
