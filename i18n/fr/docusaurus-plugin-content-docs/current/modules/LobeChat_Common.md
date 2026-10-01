---
title: "LobeChat Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module LobeChat — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LobeChat_Common.md @ 3055034 sha256:0617160b4836 -->

# LobeChat Common — Configuration applicative partagée {#lobechat-common--shared-application-configuration}

`LobeChat_Common` est la **couche applicative partagée** de LobeChat. Elle n'est pas
déployée seule ; elle fournit la configuration propre à LobeChat sur laquelle
s'appuie [LobeChat_GKE](LobeChat_GKE.md). Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement LobeChat, consultez le guide
de la plateforme ([LobeChat_GKE](LobeChat_GKE.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

> **Remarque :** LobeChat n'est pris en charge que sur GKE. La variante Cloud Run a été supprimée —
> l'application Next.js de LobeChat se heurte, sur certains chemins de fragments de routes parallèles, à une lacune
> de routage Cloud Run/GFE qui ne peut pas être corrigée au niveau du module.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par LobeChat_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build **personnalisé** minimal `FROM lobehub/lobe-chat` ; version épinglée et mise en miroir dans Artifact Registry via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Port | Fixe `container_port = 3210` — le serveur Next.js de LobeChat (épingle aussi `PORT=3210` dans l'image) | §Réseau dans les guides des plateformes |
| Moteur de base de données | `database_type = "NONE"` — le mode par défaut de LobeChat, **stocké côté client**, conserve tout l'état dans le navigateur ; aucun Cloud SQL n'est provisionné | §Vue d'ensemble dans les guides des plateformes |
| Secrets | **Aucun.** `secret_ids` et `secret_values` sont des maps vides | — |
| Stockage objet | **Aucun.** `storage_buckets` est vide — l'application est sans état | — |
| Amorçage de la base de données | **Aucun.** `initialization_jobs` est vide — il n'y a aucun schéma à créer | Sortie `initialization_jobs` (vide) |
| Paramètres principaux | Aucune variable d'environnement injectée par le module ; toutes les redéfinitions à l'exécution passent par `environment_variables` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage / vivacité / disponibilité (readiness) par défaut, qui ciblent `/` (HTTP 200, sans authentification) | §Observabilité dans les guides des plateformes |

---

## 2. Sans état par conception — ni secrets, ni base de données, ni stockage {#2-stateless-by-design--no-secrets-no-database-no-storage}

Dans son mode par défaut **stocké côté client**, LobeChat ne nécessite aucun service de
stockage côté serveur. Les utilisateurs ajoutent leurs propres clés d'API de fournisseurs de modèles (OpenAI, Anthropic, Google,
…) côté client, conservées dans le `localStorage` du navigateur ; les conversations et les paramètres
résident eux aussi dans le navigateur. Par conséquent :

- **Aucun secret** n'est généré. `secret_ids` / `secret_values` sont vides, et il n'y a
  aucune clé cryptographique à protéger ou à renouveler.
- **Aucune base de données** n'est provisionnée. `database_type = "NONE"` : aucune instance Cloud SQL,
  aucun job `db-init` et aucune migration ne s'exécutent au moment du déploiement.
- **Aucun stockage persistant** n'est déclaré. `storage_buckets` est vide — il n'y a ni bucket
  GCS, ni montage NFS, ni PVC de type bloc par défaut.

LobeChat propose également un **mode base de données serveur** facultatif, adossé à Postgres, pour
la synchronisation entre appareils et un historique centralisé ; ce mode n'est **pas** branché par ce module.
L'activer nécessiterait de provisionner Cloud SQL et d'injecter l'ensemble complet des variables
`DATABASE_URL` / `KEY_VAULTS_SECRET` / d'authentification — ce qui sort du périmètre de la configuration
par défaut sans état.

Comme il n'existe aucun secret côté serveur, le seul contrôle d'accès disponible est la
variable d'environnement facultative `ACCESS_CODE` (voir ci-dessous).

---

## 3. Image de conteneur et build {#3-container-image-and-build}

L'image standard `lobehub/lobe-chat` fournit déjà un point d'entrée serveur qui démarre
le serveur Next.js sur `$PORT` (3210 par défaut) et sert l'interface sur `/`. Comme
l'application n'a besoin d'aucune injection de configuration à l'exécution en mode stocké côté client, le Dockerfile est une
**enveloppe minimale** qui se contente d'épingler la version et de définir `PORT=3210` — il ne
redéfinit **pas** le point d'entrée de l'image de base :

```dockerfile
ARG LOBECHAT_VERSION=latest
FROM lobehub/lobe-chat:${LOBECHAT_VERSION}
ENV PORT=3210
EXPOSE 3210
```

`LOBECHAT_VERSION` est un ARG de build **propre à l'application** (et non l'`APP_VERSION` générique,
que le socle injecte dans `build_args` et remplacerait par `latest`).
`LobeChat_Common` le définit à partir de `application_version`, en transmettant `"latest"` tel quel
vers le véritable tag glissant `lobehub/lobe-chat:latest` — une image dotée d'un shell,
de sorte que `latest` se déploie sans problème.

L'image est construite via Cloud Build (`image_source = "custom"`,
`container_build_config.enabled = true`) et, lorsque `enable_image_mirroring = true`
(valeur par défaut), mise en miroir dans l'Artifact Registry du projet afin que les téléchargements à l'exécution restent
à l'intérieur du projet. Inspectez l'image construite après le déploiement :

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo> --project "$PROJECT"
```

Les valeurs `container_image` et `container_registry` figurent dans les
[sorties](LobeChat_GKE.md#5-outputs) du déploiement de la plateforme.

---

## 4. Sondes de santé {#4-health-probes}

Les trois sondes ciblent le chemin racine `/`, que le serveur Next.js de LobeChat sert
sous forme de réponse HTTP 200 non authentifiée une fois démarré :

- **Sonde de démarrage** — HTTP `GET /`, délai initial de 10 s, période de 10 s, 6 échecs
  tolérés. Cette fenêtre généreuse laisse le temps au démarrage à froid du `next-server` de Next.js.
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 15 s, période de 30 s, 3 échecs.
- **Sonde de disponibilité** — HTTP `GET /`, délai initial de 10 s, période de 10 s, 3 échecs.

Le module de variante ([LobeChat_GKE](LobeChat_GKE.md)) peut redéfinir les objets des sondes de démarrage et de
vivacité, mais la valeur par défaut `/` fonctionne d'emblée, car elle ne nécessite
ni authentification ni connectivité à une base de données.

---

## 5. Redéfinitions facultatives à l'exécution {#5-optional-runtime-overrides}

`LobeChat_Common` n'injecte aucune variable d'environnement qui lui soit propre — tout ce que
l'opérateur souhaite passe par la map `environment_variables` de la variante. Les deux plus
utiles :

- **`ACCESS_CODE`** — une phrase secrète partagée qui protège l'ensemble de l'interface. Définissez-la sur tout
  déploiement accessible publiquement pour empêcher l'utilisation anonyme de l'interface de chat (et
  des clés de fournisseurs qu'un utilisateur y colle).
- **Valeurs par défaut des fournisseurs de modèles** — par ex. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou
  `OPENAI_PROXY_URL` pour préconfigurer un fournisseur côté serveur au lieu de dépendre de
  la clé stockée dans le navigateur de chaque utilisateur. Traitez toute clé de fournisseur que vous injectez comme sensible et
  fournissez-la via `secret_environment_variables` plutôt que via
  `environment_variables` en clair.

Redis est facultatif et désactivé par défaut ; lorsqu'il est activé, il sert uniquement à la limitation de débit
et à la détection des bots sur les déploiements publics (voir le §Redis des guides des plateformes).

---

Pour la configuration propre à LobeChat exposée aux utilisateurs (variables par groupe, sorties
et exploration du service depuis la console et la CLI), consultez le guide de la plateforme :
**[LobeChat_GKE](LobeChat_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LobeChat sur GKE Autopilot](LobeChat_GKE.md) — cette configuration déployée sur GKE.
