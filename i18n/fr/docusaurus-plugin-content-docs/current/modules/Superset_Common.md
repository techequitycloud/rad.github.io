---
title: "Superset Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Superset — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Superset_Common.md @ 3055034 sha256:4ce478da410f -->

# Superset Common — Configuration applicative partagée {#superset-common--shared-application-configuration}

`Superset_Common` est la **couche applicative partagée** d'Apache Superset. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Superset sur laquelle
s'appuient à la fois [Superset_GKE](Superset_GKE.md) et
[Superset_CloudRun](Superset_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Superset, consultez les
guides des plateformes ([Superset_GKE](Superset_GKE.md),
[Superset_CloudRun](Superset_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Superset_Common | Où cela apparaît |
|---|---|---|
| Clé secrète Flask | Génère `SUPERSET_SECRET_KEY` (aléatoire, 50 caractères) et la stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Fixe `apache/superset:latest` et la configuration Cloud Build qui l'étend | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job `db-init` (création de la base et de l'utilisateur) et le job `app-init` (migration du schéma et création de l'administrateur) | Output `initialization_jobs` |
| Stockage objet | Déclare le bucket de données **Cloud Storage** | Output `storage_buckets` |
| Paramètres de base | Définit le port de conteneur de référence de Superset (8088), les ressources par défaut et la configuration des sondes de santé | Comportement de l'application dans les guides des plateformes |
| Sondes de santé | HTTP GET `/health`, démarrage : délai de 60 s / 12 échecs, vivacité : délai de 30 s / 3 échecs | §Observabilité dans les guides des plateformes |

---

## 2. Clé secrète Flask dans Secret Manager {#2-flask-secret-key-in-secret-manager}

`SUPERSET_SECRET_KEY` est générée automatiquement et stockée sous forme de secret
Secret Manager — elle n'est jamais définie en clair. Récupérez-la après le
déploiement :

```bash
# The secret name includes the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<prefix>-<appname>-key --project "$PROJECT"
```

**Avertissement sur la rotation.** Modifier `SUPERSET_SECRET_KEY` après le premier
déploiement invalide immédiatement toutes les sessions utilisateur actives et rend
définitivement illisibles tous les identifiants de connexion aux bases de données
stockés dans les métadonnées de Superset. Considérez le secret comme immuable après le
premier déploiement, ou planifiez la rotation dans une fenêtre de maintenance prévue
et ressaisissez ensuite manuellement tous les mots de passe des sources de données dans
l'interface de Superset.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Superset nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en
charge. Au premier déploiement, un pipeline d'initialisation en deux phases s'exécute
automatiquement.

**Phase 1 — `db-init`** (utilise `postgres:15-alpine`) :
- Attend que l'instance Cloud SQL soit prête.
- Crée l'utilisateur et la base de données de l'application Superset de façon
  idempotente.
- Accorde tous les privilèges sur la base de données à l'utilisateur de l'application.
- Signale au sidecar Cloud SQL Auth Proxy de s'arrêter pour que le pod du job puisse
  se terminer.

**Phase 2 — `app-init`** (utilise l'image de l'application Superset) :
- Dépend de la réussite de `db-init`.
- Exécute `superset db upgrade` pour appliquer toutes les migrations de schéma de
  Flask-AppBuilder et de Superset.
- Exécute `superset fab create-admin` pour créer ou mettre à jour l'utilisateur
  administrateur.
- Exécute `superset init` pour charger les rôles et permissions par défaut.
- Dispose d'un délai d'expiration de 30 minutes pour absorber les migrations de la
  première exécution sur des schémas complexes.

Les deux jobs sont idempotents et peuvent être réexécutés sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur et configuration Cloud Build {#4-container-image-and-cloud-build-configuration}

L'image allégée `apache/superset:latest` n'inclut pas les pilotes PostgreSQL.
`Superset_Common` fournit un `Dockerfile` (dans `scripts/`) qui étend l'image
officielle en installant `psycopg2-binary`, qui nécessite une compilation native et
doit être intégré au moment du build. Cloud Build exécute ce build automatiquement
lorsque `container_image_source = "custom"` (la valeur par défaut).

L'image personnalisée est poussée dans Artifact Registry et taguée avec
l'`application_version` du déploiement. Explorez-la avec :

```bash
gcloud artifacts repositories list --project "$PROJECT"
gcloud artifacts docker images list <registry-path> --project "$PROJECT"
```

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`Superset_Common` établit l'environnement de référence de Superset :

- **Port du conteneur** — Superset/Gunicorn écoute sur le port **8088**.
- **Ressources par défaut** — 2 vCPU et 2 GiB de mémoire par instance de conteneur. En
  dessous de 1 GiB, les workers Gunicorn sont arrêtés pour manque de mémoire (OOM)
  pendant l'exécution des requêtes.
- **Connexion à la base de données** — l'application utilise le chemin du socket Unix
  du Cloud SQL Auth Proxy pour toutes les connexions PostgreSQL. Le chemin du socket
  est injecté via `DB_HOST` à l'exécution.
- **Sondes de santé** — les sondes de démarrage et de vivacité ciblent toutes deux le
  point de terminaison `/health` de Superset (HTTP GET). La sonde de démarrage utilise
  un délai initial de 60 secondes et un seuil de 12 échecs (soit jusqu'à
  180 secondes) pour absorber l'initialisation du pool de workers Gunicorn et les
  migrations de la base de données au premier démarrage.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échecs |
|---|---|---|---|---|---|
| Démarrage | HTTP GET | `/health` | 60 s | 10 s | 12 |
| Vivacité | HTTP GET | `/health` | 30 s | 30 s | 3 |

Le point de terminaison `/health` renvoie HTTP 200 lorsque le pool de workers Gunicorn
de Superset est entièrement initialisé et connecté à PostgreSQL. GKE et Cloud Run
utilisent tous deux des sondes HTTP — contrairement à certaines applications PHP,
Superset n'émet pas de redirections HTTP→HTTPS qui casseraient les sondes HTTP.

---

## 7. Stockage objet {#7-object-storage}

Un bucket de données **Cloud Storage** dédié est déclaré ici et provisionné par le
socle. L'accès est accordé automatiquement au compte de service de la charge de
travail. Ce bucket sert aux exports de données des graphiques, aux sorties des
rapports planifiés et à toute intégration basée sur des fichiers. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Superset exposée aux utilisateurs (variables par
groupe, outputs, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Superset_GKE](Superset_GKE.md)** et
**[Superset_CloudRun](Superset_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Apache Superset sur Google Cloud Run](Superset_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Apache Superset sur GKE Autopilot](Superset_GKE.md) — cette configuration déployée sur GKE.
