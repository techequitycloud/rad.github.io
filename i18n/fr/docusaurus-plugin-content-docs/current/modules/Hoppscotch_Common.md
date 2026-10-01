---
title: "Hoppscotch Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Hoppscotch — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Hoppscotch_Common.md @ 3055034 sha256:8102e9aa5d35 -->

# Hoppscotch Common — Configuration applicative partagée {#hoppscotch-common--shared-application-configuration}

`Hoppscotch_Common` est la **couche applicative partagée** de Hoppscotch. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Hoppscotch sur laquelle
s'appuient à la fois [Hoppscotch_GKE](Hoppscotch_GKE.md) et
[Hoppscotch_CloudRun](Hoppscotch_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux
ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Hoppscotch, consultez les
guides de plateforme ([Hoppscotch_GKE](Hoppscotch_GKE.md),
[Hoppscotch_CloudRun](Hoppscotch_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

Hoppscotch est une plateforme open source de développement d'API dans l'esprit de
Postman. Ce module déploie **uniquement l'application monopage frontend
auto-hébergée** — une interface sans état servie sur le port 3000 par Caddy — **sans
base de données, sans Redis, sans secrets et sans stockage persistant**. Ce périmètre
délibéré est la caractéristique déterminante de la couche.

| Domaine | Fourni par Hoppscotch_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Un **build personnalisé** minimal `FROM hoppscotch/hoppscotch-frontend`, construit via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Épinglage du tag d'image | Associe `application_version` à un ARG de build `HOPPSCOTCH_VERSION` propre à l'application (une demande `"latest"` se résout en un tag figé et éprouvé) | `container_build_config.build_args` dans la sortie `config` |
| Moteur de base de données | Fixe **`database_type = "NONE"`** — aucune instance Cloud SQL n'est provisionnée | §Comportement de la base de données dans les guides de plateforme |
| Stockage d'objets | **Aucun** — `storage_buckets` est vide ; la démo est sans état | Sortie `storage_buckets` (liste vide) |
| Secrets | **Aucun** — `secret_ids` / `secret_values` sont des maps vides | Secret Manager (rien de propre à l'application) |
| Paramètres principaux | Port `3000`, aucune injection de configuration à l'exécution, bornes d'autoscaling, limites de ressources | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Sondes de démarrage / de vivacité / de disponibilité ciblant le chemin racine `/` | §Observabilité dans les guides de plateforme |

---

## 2. Image de conteneur et build {#2-container-image-and-build}

`config.container_image` vaut `hoppscotch/hoppscotch-frontend` et `image_source` vaut
`"custom"` ; le socle construit donc une image minimale via Cloud Build (Kaniko) au
lieu d'exécuter directement l'image amont. Le Dockerfile (`scripts/Dockerfile`) est
volontairement minimal :

```dockerfile
ARG HOPPSCOTCH_VERSION=latest
FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}
EXPOSE 3000
```

Deux choix de conception y sont intégrés et méritent d'être compris :

- **L'image frontend seule est utilisée à dessein.** L'image tout-en-un
  `hoppscotch/hoppscotch` embarque le backend NestJS, qui exige impérativement
  `DATABASE_URL` et appelle `exit(1)` en son absence — ce qui arrête tout le
  conteneur. Comme ce déploiement est une démo SPA sans état (`database_type =
  "NONE"`), `hoppscotch/hoppscotch-frontend` est la bonne base. Elle sert
  l'application web monopage sur le port 3000 via Caddy à l'aide de ses propres
  `ENTRYPOINT`/`CMD` hérités ; aucune injection de configuration à l'exécution n'est
  nécessaire.
- **`HOPPSCOTCH_VERSION` est un ARG de build propre à l'application, et non le
  `APP_VERSION` générique.** Le socle injecte `APP_VERSION = application_version`
  dans chaque build et l'emporte lors de la fusion ; il écraserait donc un ARG
  générique avec `"latest"`. Hoppscotch_Common nomme par conséquent son ARG
  `HOPPSCOTCH_VERSION` et associe une `application_version` valant `"latest"` à un tag
  figé et éprouvé avant de le définir — ainsi le build ne référence jamais un tag
  inexistant.

Inspectez l'image construite après le déploiement :

```bash
# The image URI is reported in the platform deployment output `container_image`.
gcloud artifacts docker images list \
  "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
  --include-tags --filter="package~hoppscotch"

# Review the Cloud Build that produced it:
gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
```

---

## 3. Moteur de base de données {#3-database-engine}

Il n'y a **aucune base de données**. `config.database_type = "NONE"`,
`enable_cloudsql_volume = false` et `initialization_jobs = []`. Aucune instance Cloud
SQL, aucun Auth Proxy, aucun utilisateur de base de données ni job d'amorçage n'est
créé. Le frontend Hoppscotch conserve l'ensemble des collections, environnements et
historiques d'un utilisateur dans le **stockage local du navigateur** ; il n'y a donc
aucun état côté serveur à persister.

Les deux variantes de plateforme l'imposent en outre : `Hoppscotch_GKE` comporte une
précondition au moment du plan (`validation.tf`) qui fait échouer le plan si
`database_type` vaut autre chose que `NONE`, et `Hoppscotch_CloudRun` laisse le volume
Cloud SQL désactivé. Cela empêche un opérateur de provisionner par erreur — et de
payer — une instance Cloud SQL inutilisée.

---

## 4. Secrets {#4-secrets}

`secret_ids` et `secret_values` sont tous deux des **maps vides** — la démo frontend
statique ne requiert aucun élément cryptographique, jeton d'API ni mot de passe de
base de données. Rien de propre à l'application n'est écrit dans Secret Manager. (Le
socle continue de gérer indépendamment ses propres secrets de niveau plateforme ;
consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.)

Il n'y a donc rien à faire pivoter et aucun risque lié à une clé immuable pour ce
module.

---

## 5. Stockage d'objets {#5-object-storage}

`storage_buckets` est une **liste vide** et `gcs_volumes` est vide. La démo est sans
état et ne provisionne aucun bucket Cloud Storage ni montage GCS Fuse. Si vous devez
rattacher un bucket à des fins annexes, déclarez-le via l'entrée `storage_buckets` de
la variante de plateforme — le socle le créera et en accordera l'accès — mais
l'application Hoppscotch elle-même n'en attend ni n'en utilise aucun.

---

## 6. Paramètres principaux de l'application {#6-core-application-settings}

`Hoppscotch_Common` établit une base minimale pour que la SPA démarre correctement dès
le premier lancement :

- **Port** — `container_port = 3000` ; le port de la SPA frontend intégré à l'image
  amont et servi par Caddy.
- **Aucune injection de configuration à l'exécution** — `environment_variables` vaut
  `{}` par défaut et `secret_environment_variables` vaut `{}`. Des surcharges
  supplémentaires peuvent être fournies via l'entrée `environment_variables` de la
  variante de plateforme.
- **Bornes d'autoscaling** — `min_instance_count` / `max_instance_count` sont transmis
  depuis la variante (Cloud Run descend à zéro par défaut ; GKE conserve un plancher
  d'un réplica).
- **Limites de ressources** — `cpu_limit` / `memory_limit` adoptent par défaut une
  empreinte réduite adaptée à une SPA statique (`512Mi` recommandé ; un vCPU complet
  sur Cloud Run, car le plancher de facturation en allocation permanente exige un CPU
  entier lorsqu'il est activé — consultez le guide de plateforme).

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les trois sondes — démarrage, vivacité et disponibilité — ciblent le **chemin racine
`/`** en HTTP. Un `GET /` sur le conteneur en cours d'exécution renvoie l'interface de
l'application avec un HTTP 200 dès que Caddy écoute sur son port ; les sondes
réussissent donc presque immédiatement : il n'y a ni migration au premier lancement ni
connexion à une base de données à attendre.

- **Sonde de démarrage** — HTTP `/`, délai initial de 10s, période de 10s, 6 échecs tolérés.
- **Sonde de vivacité** — HTTP `/`, délai initial de 15s, période de 30s, 3 échecs tolérés.
- **Sonde de disponibilité** — HTTP `/`, délai initial de 10s, période de 10s, 3 échecs tolérés.

Comme l'application n'a aucune dépendance externe, un échec de sonde indique presque
toujours que le conteneur ne parvient pas à démarrer (un tag d'image incorrect) plutôt
qu'un backend injoignable.

---

## 8. Sorties {#8-outputs}

`Hoppscotch_Common` expose le contrat standard de quatre sorties consommé par les
variantes de plateforme, plus un utilitaire `path` :

| Sortie | Description |
|---|---|
| `config` | L'objet complet de configuration de l'application (image, port, `database_type = "NONE"`, limites de ressources, sondes) fusionné dans l'appel au socle. |
| `secret_ids` | Map variable d'environnement → ID de secret Secret Manager. **Vide** — aucun secret. |
| `secret_values` | Map variable d'environnement → valeur brute du secret (sensible). **Vide** — aucun secret. |
| `storage_buckets` | Buckets GCS à provisionner. **Vide** — la démo est sans état. |
| `path` | Chemin absolu de ce répertoire de module, utilisé pour résoudre `scripts_dir` dans les variantes de plateforme. |

---

Pour la configuration propre à Hoppscotch exposée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme :
**[Hoppscotch_GKE](Hoppscotch_GKE.md)** et
**[Hoppscotch_CloudRun](Hoppscotch_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Hoppscotch sur GKE Autopilot](Hoppscotch_GKE.md) — cette configuration déployée sur GKE.
