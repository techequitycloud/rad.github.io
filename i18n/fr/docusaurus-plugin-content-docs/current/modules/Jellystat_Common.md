---
title: "Jellystat Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Jellystat — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Jellystat_Common.md @ 3055034 sha256:2c844577a1aa -->

# Jellystat Common — Configuration applicative partagée {#jellystat-common--shared-application-configuration}

`Jellystat_Common` est la **couche applicative partagée** de Jellystat. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Jellystat sur laquelle
s'appuient à la fois [Jellystat_GKE](Jellystat_GKE.md) et
[Jellystat_CloudRun](Jellystat_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée
propre dans l'interface de déploiement —, mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Jellystat, consultez les
guides de plateforme ([Jellystat_GKE](Jellystat_GKE.md),
[Jellystat_CloudRun](Jellystat_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Jellystat_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `JWT_SECRET` (50 caractères alphanumériques) et le stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Référence l'image officielle préconstruite `cyfershepard/jellystat` — aucun build personnalisé | Output `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base, l'utilisateur et les droits | Output `initialization_jobs` |
| Stockage objet | Déclare un petit bucket **Cloud Storage** `backups` | Output `storage_buckets` |
| Paramètres principaux | Fixe `container_port = 3000` (le port d'écoute codé en dur de Jellystat) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/auth/isConfigured` | §Observabilité dans les guides de plateforme |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :

- **`JWT_SECRET`** — une chaîne alphanumérique aléatoire de 50 caractères. Utilisée
  par Jellystat pour signer ses propres jetons de session/d'authentification (sur le
  modèle du `SECRET_KEY` de Django). Sa rotation invalide toutes les sessions
  utilisateur actives (les utilisateurs doivent se reconnecter), mais n'entraîne
  aucune perte de données.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les outputs du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données, variables d'environnement non standard et amorçage {#3-database-engine-non-standard-env-vars-and-bootstrap}

Jellystat exige **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres moteurs
ne sont pas pris en charge. Jellystat lit également des noms de variables
d'environnement **non standard** pour sa connexion à la base de données — c'est le
fait le plus important concernant le câblage de ce module :

| Nom standard (toujours injecté) | Alias propre à Jellystat (également injecté) |
|---|---|
| `DB_HOST` | `POSTGRES_IP` |
| `DB_PORT` | `POSTGRES_PORT` |
| `DB_USER` | `POSTGRES_USER` |
| `DB_NAME` | `POSTGRES_DATABASE` |
| `DB_PASSWORD` | `POSTGRES_PASSWORD` |

Confirmé par la communauté : `POSTGRES_DB` ne fonctionne **pas** pour Jellystat — il
faut utiliser `POSTGRES_DATABASE`. La correspondance des alias est codée en dur
directement dans le `main.tf` de chaque module applicatif
(`db_host_env_var_name = "POSTGRES_IP"`, etc.) plutôt qu'exposée comme variable
destinée à l'opérateur, car il s'agit d'une caractéristique fixe de l'application et
non de quelque chose qu'un opérateur devrait avoir à modifier.

Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy (Cloud Run) ou la boucle locale du
   sidecar (GKE) et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle de l'application avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données de l'application avec ce rôle comme
   propriétaire,
5. Accorde tous les privilèges sur la base de données et le schéma public,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Contrairement au modèle de clonage Django à partir duquel ce module a été généré,
**aucun job de migration distinct n'est défini** — Jellystat applique
automatiquement ses propres migrations de schéma au démarrage ; une étape
`db-migrate` serait donc redondante.

Le job peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de plateforme.

---

## 4. Image de conteneur {#4-container-image}

`Jellystat_Common` référence directement l'image officielle de Docker Hub
(`container_image = "cyfershepard/jellystat"`, `image_source = "prebuilt"`,
`container_build_config.enabled = false`) — pas de Dockerfile, pas de build
personnalisé, pas de wrapper de point d'entrée. `container_port = 3000` correspond au
port d'écoute codé en dur de Jellystat (non configurable par variable
d'environnement, selon l'issue amont #314).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Jellystat_Common` établit la configuration de base pour que l'application démarre
correctement dès le premier lancement :

- **Type de base de données** — `database_type = "POSTGRES_15"` (fixe).
- **Port** — `container_port = 3000` (fixe, correspond à la valeur codée en dur de
  l'application).
- **Pas d'intégration Redis.** Jellystat n'a aucune prise en charge native de Redis ;
  les variables `enable_redis`/`redis_host`/`redis_port` n'existent que comme
  reflets inertes du socle dans les modules applicatifs.
- **Pas de variable d'association à Jellyfin.** Il n'existe dans cette couche aucune
  variable d'environnement, aucun secret ni aucun champ de configuration pour l'URL
  ou la clé d'API du serveur Jellyfin associé — cette association s'effectue
  entièrement via l'interface web de Jellystat après le premier démarrage (voir la
  section Comportement de l'application des guides de plateforme).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/auth/isConfigured` — un point de terminaison public
et non authentifié qui renvoie 200 dès que le serveur Jellystat est démarré, sans
nécessiter de connexion.

- **Cloud Run** utilise des sondes HTTP ciblant `/auth/isConfigured`.
- **GKE** utilise des sondes HTTP ciblant `/auth/isConfigured` pour les contrôles de
  démarrage et de vivacité.

---

## 7. Stockage objet {#7-object-storage}

Un petit bucket **Cloud Storage** `backups` facultatif est déclaré ici et provisionné
par le socle, pour la fonctionnalité d'export/archivage de sauvegarde de la base de
données propre à Jellystat. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Jellystat et destinée aux utilisateurs (variables par
groupe, outputs et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Jellystat_GKE](Jellystat_GKE.md)** et
**[Jellystat_CloudRun](Jellystat_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Jellystat sur Google Cloud Run](Jellystat_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Jellystat sur GKE Autopilot](Jellystat_GKE.md) — cette configuration déployée sur GKE.
