---
title: "Shlink Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Shlink — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Shlink_Common.md @ 3055034 sha256:a51b531201ad -->

# Shlink Common — Configuration applicative partagée {#shlink-common--shared-application-configuration}

`Shlink_Common` est la **couche applicative partagée** de Shlink. Elle n'est pas déployée seule ; elle fournit la configuration propre à Shlink sur laquelle s'appuient à la fois [Shlink_CloudRun](Shlink_CloudRun.md) et la variante GKE, afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Shlink, consultez le guide de la plateforme ([Shlink_CloudRun](Shlink_CloudRun.md)) et les guides du socle ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Shlink_Common | Où cela apparaît |
|---|---|---|
| Clé d'API initiale | Génère une clé d'API aléatoire de 32 caractères, la stocke dans Secret Manager et l'injecte sous le nom `INITIAL_API_KEY` afin que Shlink amorce sa première clé d'API REST au premier démarrage | Sorties `secret_ids` / `secret_values` ; §Accès au premier lancement dans le guide de la plateforme |
| Image de conteneur | Fine surcouche Cloud Build `FROM shlinkio/shlink:stable` — le point d'entrée officiel est conservé tel quel | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (`DB_DRIVER = postgres`, `DB_PORT = 5432`) | §Base de données dans le guide de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` (`postgres:15-alpine`) qui crée de manière idempotente l'utilisateur et la base de données via le socket de l'Auth Proxy | Sortie `initialization_jobs` |
| Environnement de base | `IS_HTTPS_ENABLED=true` ; laisse volontairement `DB_USER` / `DB_NAME` non définis pour que les valeurs propres au tenant du socle l'emportent | Comportement de l'application dans le guide de la plateforme |
| Stockage d'objets | Aucun — Shlink stocke tout son état dans PostgreSQL (`storage_buckets = []`) | Sortie `storage_buckets` (vide) |
| Tests de santé | Sondes de démarrage et de vivacité sur `/rest/health` (HTTP 200 non authentifié) | §Observabilité dans le guide de la plateforme |

---

## 2. Secret de la clé d'API initiale {#2-initial-api-key-secret}

Shlink n'a pas de comptes utilisateur administrateur — tout se pilote via son API REST avec un en-tête `X-Api-Key`. `Shlink_Common` génère une clé aléatoire de 32 caractères, la stocke sous le nom `secret-<prefix>-shlink-initial-api-key` dans Secret Manager et l'injecte dans le conteneur comme variable d'environnement secrète `INITIAL_API_KEY`. Shlink lit cette variable au premier démarrage et l'enregistre comme sa première clé d'API ; le déploiement est donc utilisable immédiatement, sans étape manuelle de création de clé.

Récupérez-la après le déploiement :

```bash
API_SECRET=$(gcloud secrets list --project "$PROJECT" \
  --filter="name~shlink AND name~initial-api-key" --format="value(name)" --limit=1)
API_KEY=$(gcloud secrets versions access latest --secret="$API_SECRET" --project "$PROJECT")
```

Le nom de clé `INITIAL_API_KEY` utilise des tirets bas simples comme séparateurs ; c'est donc aussi une clé de données de Secret Kubernetes valide pour le chemin SecretSync de GKE. Le secret du mot de passe de la base de données est géré par le socle, et non par cette couche, et il est injecté sous le nom `DB_PASSWORD` (que Shlink lit directement — aucun remappage dans le point d'entrée n'est nécessaire).

---

## 3. Image de conteneur — pas de point d'entrée personnalisé {#3-container-image--no-custom-entrypoint}

L'image officielle de Shlink lit toute sa configuration (`DB_*`, `DEFAULT_DOMAIN`, `IS_HTTPS_ENABLED`, `INITIAL_API_KEY`, …) directement depuis les variables d'environnement et **exécute automatiquement ses migrations de base de données au démarrage du conteneur** ; `Shlink_Common` utilise donc l'image telle quelle : le Dockerfile est une fine surcouche `FROM shlinkio/shlink:stable` qui n'existe que pour donner quelque chose à construire au pipeline Cloud Build de la plateforme, et l'image est mise en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub.

Le tag `stable` suit la dernière version stable de Shlink ; épinglez une version précise en remplaçant `application_version` (p. ex. `4.4.0`) pour des builds reproductibles.

```bash
# Confirm the deployed image
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
```

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Shlink s'exécute sur **PostgreSQL 15** (`database_type = "POSTGRES_15"`). À chaque apply, un job ponctuel `db-init` (image `postgres:15-alpine`) se connecte à Cloud SQL — en associant le socket Unix de l'Auth Proxy à un chemin de socket PostgreSQL standard lorsqu'il est présent — et, de manière idempotente :

1. Crée l'utilisateur de l'application (ou réinitialise son mot de passe s'il existe).
2. Accorde le rôle de l'utilisateur à `postgres` afin que la propriété de la base de données puisse être attribuée.
3. Crée la base de données de l'application, dont cet utilisateur est propriétaire (ou corrige la propriété).
4. Accorde tous les privilèges sur la base de données et sur le schéma `public`.
5. Envoie un signal d'arrêt `POST /quitquitquit` au sidecar Cloud SQL Proxy pour que le job se termine proprement.

**Nommage propre au tenant :** le socle crée le véritable utilisateur et la véritable base de données sous des noms propres au tenant et les injecte sous les noms `DB_USER` / `DB_NAME` ; comme Shlink lit directement ces variables, `Shlink_Common` ne les définit volontairement **pas** — les prédéfinir avec les noms de base courts `shlink` ferait s'authentifier l'application avec un rôle qui n'est jamais créé (`password authentication failed for user "shlink"`).

Inspectez directement la base de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 5. Valeurs par défaut de l'environnement de base {#5-core-environment-defaults}

- **`DB_DRIVER = postgres`, `DB_PORT = 5432`** — la configuration native de Shlink par variables d'environnement ; le socket/l'hôte provient de `DB_HOST`, injecté par le socle.
- **`IS_HTTPS_ENABLED = true`** — la plateforme place toujours le service derrière HTTPS (URL `run.app`, équilibreur de charge ou Ingress) ; Shlink génère donc des URL courtes en `https://`.
- **`DEFAULT_DOMAIN` volontairement non défini** — l'URL publique du service n'est connue qu'après le déploiement ; définissez-la après le déploiement (ou via `environment_variables`) pour que les URL courtes générées portent le bon hôte.
- **Migrations au démarrage** — l'installation et les mises à niveau du schéma ont lieu automatiquement à chaque démarrage du conteneur ; il n'existe pas de job de migration distinct.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Shlink expose `/rest/health` — un point de terminaison public et non authentifié qui renvoie HTTP 200 avec `application/health+json` `{"status":"pass"}` une fois l'application démarrée — de sorte que de simples sondes HTTP fonctionnent sur les deux plateformes (contrairement aux applications dont les points de terminaison de santé exigent une authentification et imposent une sonde de vivacité désactivée).

- **Sonde de démarrage** — HTTP `/rest/health`, délai initial de 30 s, période de 10 s, seuil d'échec de 30 (jusqu'à ~300 s pour les migrations du premier démarrage).
- **Sonde de vivacité** — HTTP `/rest/health`, délai initial de 30 s, période de 30 s, seuil d'échec de 3.

Notez que Shlink n'a **pas de page d'accueil web** — `/` renvoie 404 par conception — ne pointez donc jamais une sonde ou un test de disponibilité vers le chemin racine.

---

## 7. Stockage d'objets {#7-object-storage}

Aucun. Shlink conserve tout son état — URL courtes, visites, tags, domaines, clés d'API — dans PostgreSQL ; `storage_buckets` est donc vide et aucun partage NFS ni bucket GCS n'est provisionné. La durabilité est assurée par les sauvegardes automatiques de Cloud SQL.

---

Pour la configuration propre à Shlink destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez le guide de la plateforme :
**[Shlink_CloudRun](Shlink_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Shlink sur Google Cloud Run](Shlink_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Shlink sur GKE Autopilot](Shlink_GKE.md) — cette configuration déployée sur GKE.
