---
title: "AFFiNE Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module AFFiNE — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Affine_Common.md @ 3055034 sha256:2430b4def53e -->

# AFFiNE Common — Configuration applicative partagée {#affine-common--shared-application-configuration}

`Affine_Common` est la **couche applicative partagée** d'AFFiNE. Elle n'est pas déployée seule ; elle fournit la configuration propre à AFFiNE sur laquelle reposent à la fois [Affine_GKE](Affine_GKE.md) et [Affine_CloudRun](Affine_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement AFFiNE, consultez les guides de plateforme ([Affine_GKE](Affine_GKE.md), [Affine_CloudRun](Affine_CloudRun.md)) et les guides de fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Affine_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé léger `FROM ghcr.io/toeverything/affine:<tag>` ajoutant un point d'entrée cloud | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée cloud | Assemble `DATABASE_URL` / `REDIS_SERVER_*` à partir des variables `DB_*` / `REDIS_*` injectées par la fondation et définit la valeur par défaut de `AFFINE_SERVER_EXTERNAL_URL` | Comportement de l'application dans les guides de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | `db-init` (rôle + base de données + privilèges) suivi de `affine-migrate` (schéma + génération de la clé de signature) | Sortie `initialization_jobs` |
| Secrets | **Aucun, par conception** — la clé de signature est conservée dans PostgreSQL ; `secret_ids` est vide | Seul le secret du mot de passe de la base de données de la fondation existe |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Environnement de base | `NODE_ENV=production`, `AFFINE_SERVER_HOST/PORT`, `AFFINE_CONFIG_PATH`, `AFFINE_INDEXER_ENABLED=false` | Environnement du conteneur du service en cours d'exécution |
| Contrôles de santé | Démarrage (`/`, délai de 60 s, 30 échecs), vivacité (`/`, délai de 60 s), disponibilité (`/`, délai de 30 s) | §Observabilité dans les guides de plateforme |

---

## 2. Image de conteneur et point d'entrée cloud {#2-container-image-and-cloud-entrypoint}

`Affine_Common` construit via Cloud Build une encapsulation légère de l'image auto-hébergée amont `ghcr.io/toeverything/affine`. Le tag est sélectionné par l'ARG de build spécifique à l'application `AFFINE_VERSION` — et non par l'`APP_VERSION` générique, que la fondation injecte et qui l'écraserait — et `application_version = "latest"` correspond à `stable` (AFFiNE ne publie pas de tag `latest`). Le Dockerfile installe `/usr/local/bin/cloud-entrypoint.sh` et crée à l'avance `/root/.affine/storage` et `/root/.affine/config` ; le `CMD` reste le `node ./dist/main.js` amont.

Le point d'entrée effectue ces actions à chaque démarrage du conteneur :

1. **Assemblage de `DATABASE_URL`.** Construit `postgresql://user:pass@host:port/db?sslmode=…` à partir des variables `DB_*` injectées par la fondation, en encodant les identifiants pour l'URL. Sur Cloud Run, `DB_HOST` est un répertoire de socket Cloud SQL dont les deux-points cassent l'analyse de l'URL ; il se connecte donc à `DB_IP` (l'IP privée de l'instance) avec `sslmode=require` ; sur GKE, l'adresse de bouclage du proxy `127.0.0.1` reçoit `sslmode=disable`. Un `DATABASE_URL` prédéfini est prioritaire.
2. **Correspondance Redis.** Associe `REDIS_HOST` / `REDIS_PORT` / `REDIS_AUTH` aux `REDIS_SERVER_HOST` / `REDIS_SERVER_PORT` / `REDIS_SERVER_PASSWORD` d'AFFiNE.
3. **URL externe.** Définit par défaut `AFFINE_SERVER_EXTERNAL_URL` sur l'URL du service injectée par la plateforme (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`) afin que les invitations et les liens de partage se résolvent.
4. **Lancement du serveur.** Exécute (`exec`) le serveur AFFiNE.

Pour inspecter ce que le point d'entrée a résolu :

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 | grep "cloud-entrypoint"

# GKE
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep "cloud-entrypoint"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

AFFiNE nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` dans `Affine_Common` et les variantes de plateforme rejettent MySQL au moment du plan. Deux jobs d'initialisation s'exécutent à chaque application (tous deux idempotents) :

1. **`db-init`** (`postgres:15-alpine`, timeout de 600 s) — crée le rôle et la base de données AFFiNE s'ils n'existent pas, accorde les privilèges sur la base de données et le schéma `public`, et tente d'accorder `cloudsqlsuperuser` afin que les migrations puissent exécuter `CREATE EXTENSION`.
2. **`affine-migrate`** (l'image applicative AFFiNE construite, 2Gi, timeout de 1200 s, `max_retries = 3`) — exécute `node ./scripts/self-host-predeploy` d'AFFiNE : migration idempotente du schéma **et génération de la clé de signature**. S'exécute après `db-init` et avant le démarrage du serveur, de sorte que le conteneur d'exécution n'effectue jamais de migration à la volée.

Les deux scripts signalent au sidecar Cloud SQL Auth Proxy (`POST /quitquitquit`) qu'il doit s'arrêter, afin que les pods de Job GKE se terminent proprement. Inspectez les jobs et la base de données :

```bash
gcloud run jobs executions list --job="<service>-affine-migrate" --project "$PROJECT" --region "$REGION"
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 4. Secrets — volontairement aucun {#4-secrets--intentionally-none}

La sortie `secret_ids` d'`Affine_Common` est **vide par conception**. AFFiNE génère sa clé de signature/clé privée pendant `self-host-predeploy` et la conserve dans PostgreSQL ; il n'existe donc aucun secret applicatif fourni par l'opérateur à créer, injecter ou faire tourner. Le seul secret d'un déploiement est le **mot de passe de la base de données**, généré et géré par la fondation :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~affine"
```

---

## 5. Paramètres applicatifs de base {#5-core-application-settings}

- **Adresse d'écoute** — `AFFINE_SERVER_HOST = "0.0.0.0"` et `AFFINE_SERVER_PORT = "3010"`. La variable d'environnement `PORT`, réservée par Cloud Run, n'est jamais définie explicitement (cela ferait échouer chaque création de Job Cloud Run avec une erreur HTTP 400).
- **Chemin de configuration** — `AFFINE_CONFIG_PATH = /root/.affine/config`, la valeur par défaut de l'image, afin que les chargeurs de configuration intégrés d'AFFiNE se résolvent.
- **Indexeur désactivé** — `AFFINE_INDEXER_ENABLED = "false"` : l'indexeur plein texte nécessite un backend de recherche reposant sur pgvector qui n'est pas provisionné ; le serveur démarre avec un simple PostgreSQL + Redis. Les opérateurs peuvent l'activer après avoir raccordé une base de données vectorielle.
- **Redis est structurel** — le pub/sub de synchronisation des documents Yjs et la file de jobs en arrière-plan passent par Redis ; les variantes de plateforme l'imposent au moment du plan.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent le chemin racine d'AFFiNE (`/`), qui renvoie HTTP 200 une fois le serveur prêt et ne nécessite aucune authentification.

- **Sonde de démarrage** — HTTP `/`, délai initial de 60 s, période de 15 s, seuil d'échec de 30 (jusqu'à 60 + 30 × 15 = 510 s à partir du démarrage du conteneur).
- **Sonde de vivacité** — HTTP `/`, délai initial de 60 s, période de 30 s, seuil d'échec de 3.
- **Sonde de disponibilité** — HTTP `/`, délai initial de 30 s, période de 10 s, seuil d'échec de 3.

La migration du schéma a lieu dans le job `affine-migrate` plutôt qu'à la volée au démarrage ; la fenêtre de démarrage couvre donc essentiellement le chargement du bundle Node.js et l'établissement des connexions Redis/PostgreSQL.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** (suffixe de nom `storage`, classe STANDARD, prévention de l'accès public appliquée) est déclaré ici et provisionné par la fondation sous le nom `gcs-<service-name>-storage`, l'accès du compte de service de la charge de travail étant accordé automatiquement. Les blobs téléversés eux-mêmes résident sur le montage NFS `/root/.affine/storage` ; le bucket sert aux sauvegardes et au stockage auxiliaire.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~affine"
```

---

Pour la configuration propre à AFFiNE destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Affine_GKE](Affine_GKE.md)** et **[Affine_CloudRun](Affine_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [AFFiNE sur GKE Autopilot](Affine_GKE.md) — cette configuration déployée sur GKE.
