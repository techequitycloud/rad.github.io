---
title: "SearXNG Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module SearXNG — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/SearXNG_Common.md @ 3055034 sha256:f9c8a782afe1 -->

# SearXNG Common — Configuration applicative partagée {#searxng-common--shared-application-configuration}

`SearXNG_Common` est la **couche applicative partagée** de SearXNG. Elle n'est pas
déployée seule ; elle fournit la configuration propre à SearXNG sur laquelle s'appuient
[SearXNG_GKE](SearXNG_GKE.md) et [SearXNG_CloudRun](SearXNG_CloudRun.md), afin que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune
entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement SearXNG, consultez les guides
des plateformes ([SearXNG_GKE](SearXNG_GKE.md), [SearXNG_CloudRun](SearXNG_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par SearXNG_Common | Où cela apparaît |
|---|---|---|
| Secret de session | Génère `SEARXNG_SECRET` et le stocke dans **Secret Manager** | Injecté à l'exécution ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle `searxng/searxng` et l'indicateur de duplication de l'image | Sortie `container_image` du déploiement de la plateforme |
| Pas de base de données | Définit `database_type = "NONE"` et `enable_cloudsql_volume = false` | Aucune instance Cloud SQL n'est provisionnée |
| Pas de stockage | Renvoie une liste `storage_buckets` vide | Aucun bucket GCS n'est provisionné par défaut |
| Configuration du conteneur | Fixe le port du conteneur à `8080`, définit les chemins des sondes sur `/healthz` et définit `image_source = "custom"` pour le pipeline Cloud Build | §Conteneur et §Sonde de santé dans les guides des plateformes |
| Sondes de santé | Fournit les valeurs par défaut des sondes de démarrage et de vivacité HTTP `/healthz` | §Observabilité dans les guides des plateformes |

---

## 2. SEARXNG_SECRET dans Secret Manager {#2-searxng_secret-in-secret-manager}

`SEARXNG_Common` génère un secret aléatoire de 32 caractères et le stocke sous forme de
secret Secret Manager. Cette clé est la clé cryptographique de session de SearXNG — elle
signe les cookies et les paramètres de requête HMAC. Toutes les instances en cours
d'exécution doivent partager la même valeur.

Récupérez-la après le déploiement :

```bash
# List secrets and find the session key:
gcloud secrets list --project "$PROJECT" --filter="name~searxng.*key"
gcloud secrets versions access latest --secret=<session-key-secret> --project "$PROJECT"
```

**N'effectuez pas de rotation de ce secret en production sans tenir compte des sessions
actives.** La rotation de la clé invalide immédiatement tous les cookies de session
existants, ce qui déconnecte chaque utilisateur actif. Le déploiement de la plateforme
gère automatiquement le cycle de vie du secret.

Pour les déploiements GKE, la valeur explicite du secret est également renvoyée en sortie
afin que le pilote Kubernetes Secret Store CSI puisse l'injecter dès le premier apply,
sans délai de cohérence lecture-après-écriture.

---

## 3. Pas de base de données, pas de stockage {#3-no-database-no-storage}

SearXNG est entièrement sans état — il agrège les résultats de recherche de moteurs
externes au moment de la requête. Il n'y a ni base de données, ni téléversement de
fichiers, ni système de fichiers partagé.

- `database_type = "NONE"` — aucune instance Cloud SQL n'est provisionnée.
- `enable_cloudsql_volume = false` — aucun sidecar Cloud SQL Auth Proxy n'est injecté.
- `storage_buckets = []` — aucun bucket GCS n'est créé par défaut.

Si vous activez `create_cloud_storage` ou `enable_nfs` dans le module de plateforme, ces
ressources sont provisionnées par le socle mais ne sont pas utilisées par SearXNG
lui-même.

---

## 4. Image de conteneur et build {#4-container-image-and-build}

`SearXNG_Common` définit `container_image = "searxng/searxng"` avec
`image_source = "custom"` dans sa sortie `config`, ce qui ferait passer l'image par le
pipeline Cloud Build dans Artifact Registry. Le `Dockerfile` de `scripts/` étend l'image
officielle de SearXNG (avec `searxng-rad-entrypoint.sh`, qui active l'API JSON pour
l'intégration intent-radar de n8n et injecte `SEARXNG_SECRET` dans `settings.yml` au
démarrage), ce qui permet de transmettre des arguments de build personnalisés (tels que
`APP_VERSION`).

**Ce paramètre `"custom"` ne fait pas autorité par défaut.** `SearXNG_CloudRun` et
`SearXNG_GKE` déclarent chacun leur propre variable `container_image_source`, dont la
valeur par défaut est `"prebuilt"`, et la transmettent à `App_CloudRun`/
`App_GKE`. La logique de priorité du module socle
(`final_container_image_source = var.container_image_source != "" ?
var.container_image_source : local.module_container_image_source` —
`App_CloudRun/modules.tf`, équivalent dans `App_GKE/modules.tf`) fait que la variable de
niveau supérieur, non vide, l'emporte toujours sur la valeur `"custom"` de
`SearXNG_Common`. Avec les paramètres par défaut, le chemin d'image personnalisée Cloud
Build décrit ci-dessus n'est donc **pas utilisé** — SearXNG déploie à la place l'image
`searxng/searxng` standard, dupliquée, et le point d'entrée qui active l'API JSON ne
s'exécute jamais. Définissez `container_image_source = "custom"` sur le module
`SearXNG_CloudRun`/`SearXNG_GKE` appelant pour réellement choisir l'image personnalisée.

L'indicateur `enable_image_mirroring` (valeur par défaut `true`) met en miroir l'image amont
dans Artifact Registry avant le déploiement, ce qui évite les limites de débit de
Docker Hub.

Inspectez l'image dans Artifact Registry :

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/<project-id>/<repo-name> --project "$PROJECT"
```

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`SearXNG_Common` assemble l'environnement SearXNG de base :

- **Le port du conteneur** est fixé à `8080` — le port HTTP natif de SearXNG.
- **`SEARXNG_BIND_ADDRESS`** est injecté avec la valeur `0.0.0.0:8080` par le module de
  plateforme appelant, afin que SearXNG écoute sur toutes les interfaces.
- **`ENABLE_REDIS` et `REDIS_URL`** sont injectés par le module de plateforme lorsque
  `enable_redis = true`, et pointent vers le point de terminaison Redis configuré.
- Les `environment_variables` transmises par le module de plateforme (telles que
  `INSTANCE_NAME` et `AUTOCOMPLETE`) sont reportées telles quelles dans la configuration
  du conteneur.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison `/healthz` de SearXNG, qui répond
avec un code HTTP 200 lorsque l'application est entièrement initialisée.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/healthz` | 10s | 10s | 6 |
| Vivacité | HTTP | `/healthz` | 15s | 30s | 3 |

SearXNG démarre en moins de 5 secondes (aucune migration de base de données) ; les délais
initiaux courts sont donc voulus. Le chemin `/healthz` est servi sans authentification ni
redirection ; les sondes de type HTTP comme TCP fonctionnent donc sur les deux
plateformes.

---

Pour la configuration propre à SearXNG destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[SearXNG_GKE](SearXNG_GKE.md)** et
**[SearXNG_CloudRun](SearXNG_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [SearXNG sur GKE Autopilot](SearXNG_GKE.md) — cette configuration déployée sur GKE.
