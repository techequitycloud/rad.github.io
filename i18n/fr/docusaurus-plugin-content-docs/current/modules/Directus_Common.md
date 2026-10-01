---
title: "Directus Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Directus — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Directus_Common.md @ 3055034 sha256:64a55e481fc2 -->

# Directus Common — Configuration applicative partagée {#directus-common--shared-application-configuration}

`Directus_Common` est la **couche applicative partagée** de Directus. Elle n'est pas déployée
seule ; elle fournit la configuration propre à Directus sur laquelle s'appuient
[Directus_GKE](Directus_GKE.md) et [Directus_CloudRun](Directus_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle ne possède aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut
que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Directus, consultez les guides des
plateformes ([Directus_GKE](Directus_GKE.md), [Directus_CloudRun](Directus_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Directus_Common | Où cela apparaît |
|---|---|---|
| Secrets de chiffrement | Génère automatiquement et stocke `KEY` (chiffrement des données) et `SECRET` (signature des JWT) dans **Secret Manager** | Injectés sous forme de variables d'environnement `KEY` et `SECRET` dans la charge de travail |
| Identifiant administrateur | Génère le mot de passe administrateur de Directus et le stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Secret Redis | Construit l'URL de connexion Redis et la stocke dans **Secret Manager** (lorsque Redis est activé) | Injecté sous forme de variable d'environnement `REDIS` |
| Image de conteneur | Fixe la version de l'image officielle de Directus et le Cloud Build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge et définit `DB_CLIENT = "pg"` | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la tâche du premier déploiement qui crée la base de données, l'utilisateur, les extensions et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Définit `STORAGE_LOCATIONS = "gcs"` et `STORAGE_GCS_DRIVER = "gcs"` afin que tous les téléversements aboutissent dans le bucket GCS | Nom du bucket dans la sortie `storage_buckets` |
| Indicateurs d'exécution | Injecte `BOOTSTRAP = "true"` et `AUTO_MIGRATE = "true"` afin que les migrations et l'initialisation au premier démarrage s'exécutent automatiquement | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage et de vivacité ciblant `/server/ping` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Quatre secrets sont générés automatiquement et stockés dans Secret Manager — aucun n'est jamais écrit en clair :

| Secret (suffixe de l'ID) | Contenu | Injecté sous le nom |
|---|---|---|
| `<prefix>-key` | Chaîne alphanumérique aléatoire de 32 caractères | `KEY` — utilisé pour le chiffrement des données Directus |
| `<prefix>-secret` | Chaîne alphanumérique aléatoire de 32 caractères | `SECRET` — utilisé pour la signature des JWT |
| `<prefix>-admin-password` | Mot de passe aléatoire de 16 caractères (avec caractères spéciaux) | `ADMIN_PASSWORD` — compte administrateur initial |
| `<prefix>-redis` | URL de connexion Redis complète | `REDIS` — backend de cache et de limitation de débit (lorsque Redis est activé) |

Récupérez n'importe lequel d'entre eux après le déploiement :

```bash
# List all secrets for the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~<resource-prefix>"

# Retrieve the admin password:
gcloud secrets versions access latest --secret=<prefix>-admin-password --project "$PROJECT"

# Retrieve the DB password (separate foundation-managed secret — name is in the Outputs):
gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
```

**Avertissement sur la rotation de KEY et SECRET.** La rotation de `KEY` rend immédiatement inexploitables toutes les données chiffrées stockées avec l'ancienne clé. La rotation de `SECRET` invalide tous les JWT émis et les sessions actives. N'effectuez l'une ou l'autre que pendant une fenêtre de maintenance planifiée.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Directus nécessite **PostgreSQL 15** ; le moteur est imposé et MySQL n'est pas pris en charge. `DB_CLIENT = "pg"` est injecté automatiquement — ne le définissez pas via `environment_variables`.

Lors du premier déploiement, une tâche ponctuelle `db-init` s'exécute sur Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée l'utilisateur de base de données `directus` avec le mot de passe généré,
2. crée la base de données `directus`,
3. installe l'extension `uuid-ossp` (requise pour les identifiants internes de Directus),
4. tente d'installer l'extension `postgis` pour la prise en charge géospatiale (sans erreur bloquante si elle n'est pas disponible),
5. accorde tous les privilèges à l'utilisateur de l'application.

La tâche s'exécute à chaque apply (`execute_on_apply = true`) et peut être relancée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=directus --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Directus_Common` définit l'environnement de base de Directus afin que l'application démarre correctement dès le premier lancement :

- **Amorçage au premier démarrage** — `BOOTSTRAP = "true"` crée l'utilisateur administrateur initial et les collections système de Directus. L'adresse e-mail de l'administrateur vaut par défaut `admin@example.com`. **Remplacez-la via `environment_variables = { ADMIN_EMAIL = "you@example.com" }` avant le premier déploiement.**
- **Migrations à chaque démarrage** — `AUTO_MIGRATE = "true"` fait exécuter `database migrate:latest` par Directus à chaque démarrage du conteneur, de sorte que la mise à niveau de `application_version` applique automatiquement les changements de schéma.
- **Stockage des fichiers dans GCS** — `STORAGE_LOCATIONS = "gcs"` et `STORAGE_GCS_DRIVER = "gcs"` sont injectés automatiquement. Le nom du bucket GCS est dérivé du préfixe de ressources du déploiement et défini dans `STORAGE_GCS_BUCKET`. Tous les téléversements de ressources aboutissent dans ce bucket.
- **Connexion Redis** — lorsque Redis est activé, l'URL Redis est construite à partir de `redis_host`, `redis_port` et `redis_auth`, puis stockée en tant que secret `REDIS`. Lorsqu'aucun hôte explicite n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS (résolue à l'exécution à partir de la variable d'environnement `NFS_SERVER_IP`) est utilisée comme hôte Redis. Redis est donc, par défaut, co-localisé sur le même nœud que le montage NFS.
- **Client de base de données** — `DB_CLIENT = "pg"` est injecté ; `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USER` et `DB_PASSWORD` sont tous fournis par la couche du socle. Le script `docker-entrypoint.sh` associe le `DB_NAME` du socle à `DB_DATABASE` afin que Directus reçoive le bon nom de variable.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison `/server/ping` de Directus (un contrôle de vivacité léger et non authentifié qui renvoie `pong`/200 — contrairement à `/server/health`, qui exige une session administrateur authentifiée et renvoie une erreur 403 à une sonde non authentifiée) :

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage (Cloud Run) | HTTP | `/server/ping` | 30 s | 20 s | 10 |
| Démarrage (GKE) | HTTP | `/server/ping` | 0 s | 30 s | 10 |
| Vivacité (Cloud Run) | HTTP | `/server/ping` | 15 s | 30 s | 3 |
| Vivacité (GKE) | HTTP | `/server/ping` | 60 s | 30 s | 3 |

La sonde de démarrage accorde jusqu'à environ 230 secondes sur Cloud Run (30 s de délai initial + 20 s × 10 tentatives) et 300 secondes sur GKE (30 s × 10 tentatives, sans délai initial) pour laisser le temps à la configuration de la base de données et à l'installation des extensions au premier démarrage, qui peuvent être lentes sur une instance Cloud SQL vierge.

Contrairement à Mautic, Directus répond directement avec un HTTP 200 — sans redirection — de sorte que la même sonde HTTP fonctionne sur Cloud Run comme sur GKE sans modification.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié aux téléversements est déclaré ici et provisionné par le socle, qui accorde également au compte de service de la charge de travail l'accès au stockage. Associé au volume Filestore (NFS) partagé, il offre à Directus un stockage de fichiers durable et multi-réplicas. Directus est configuré pour utiliser GCS comme pilote de stockage principal, de sorte que les médias téléversés sont écrits dans le bucket plutôt que dans le système de fichiers du conteneur.

Listez et inspectez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://<uploads-bucket>/
```

Le nom du bucket figure dans la sortie `storage_buckets` du déploiement de la plateforme.

---

Pour la configuration propre à Directus destinée aux utilisateurs (variables par groupe, sorties
et manière d'explorer chaque service depuis la console et la CLI), consultez les guides des
plateformes : **[Directus_GKE](Directus_GKE.md)** et **[Directus_CloudRun](Directus_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Directus sur Cloud Run](Directus_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Directus sur GKE Autopilot](Directus_GKE.md) — cette configuration déployée sur GKE.
