---
title: "Kestra Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Kestra — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Kestra_Common.md @ 3055034 sha256:bbed75ebc610 -->

# Kestra Common — Configuration applicative partagée {#kestra-common--shared-application-configuration}

`Kestra_Common` est la **couche applicative partagée** de Kestra. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Kestra sur laquelle
s'appuient à la fois [Kestra_GKE](Kestra_GKE.md) et
[Kestra_CloudRun](Kestra_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Kestra, consultez les
guides des plateformes ([Kestra_GKE](Kestra_GKE.md),
[Kestra_CloudRun](Kestra_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Kestra_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur de Kestra et le stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une image personnalisée qui encapsule `kestra/kestra` — ajoute `socat` et un point d'entrée personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme unique moteur pris en charge | Section Base de données des guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement qui crée la base de données, l'utilisateur, le schéma et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket d'artefacts **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de Kestra : file d'attente/référentiel PostgreSQL, stockage GCS, authentification basique, baseline Flyway, port du serveur Micronaut | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage et d'activité (HTTP `/health`, fenêtre de démarrage généreuse) | Section Observabilité des guides des plateformes |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le mot de passe administrateur de Kestra est généré automatiquement
(24 caractères, sans caractères spéciaux) et stocké comme secret Secret Manager —
il n'est jamais défini en clair. Récupérez-le après le déploiement :

```bash
# List secrets and find the admin password:
gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
gcloud secrets versions access latest --secret=secret-<resource_prefix>-kestra-admin-password --project "$PROJECT"
```

Le nom d'utilisateur administrateur par défaut est `admin`. Connectez-vous à
l'interface de Kestra avec ce nom d'utilisateur et le mot de passe récupéré.

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret est indiqué dans les sorties du déploiement de la
plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md)
pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Kestra nécessite **PostgreSQL 15** à la fois pour sa file d'attente interne des
tâches (`KESTRA_QUEUE_TYPE=postgres`) et pour son référentiel de flux
(`KESTRA_REPOSITORY_TYPE=postgres`). MySQL n'est pas pris en charge.

Lors du premier déploiement, un job ponctuel `db-init` s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Attend que PostgreSQL soit prêt, via `pg_isready`.
2. Crée l'utilisateur de base de données Kestra avec le mot de passe généré (ou
   met à jour le mot de passe si l'utilisateur existe déjà).
3. Crée la base de données Kestra avec le bon propriétaire (ou la réattribue si
   elle existe déjà).
4. Accorde tous les privilèges requis sur la base de données et le schéma public.
5. Réinitialise le schéma public lors des nouveaux déploiements qui n'ont aucun
   historique Flyway — Cloud SQL préinstalle des objets d'extension PostgreSQL
   dans le schéma public, ce qui amène Flyway à refuser la migration sur un
   « schéma non vide ». La réinitialisation permet à Flyway d'appliquer
   proprement toutes les migrations.
6. Signale au Cloud SQL Auth Proxy de s'arrêter via le point de terminaison
   `quitquitquit`.

Kestra exécute lui-même des migrations de schéma Flyway à chaque démarrage (`FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true`) ;
la mise à niveau d'`application_version` applique donc automatiquement les
modifications de schéma.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Kestra_Common` établit l'environnement de base de Kestra afin que l'application
démarre correctement la première fois :

- **Backends PostgreSQL** — `KESTRA_QUEUE_TYPE=postgres` et
  `KESTRA_REPOSITORY_TYPE=postgres` sont toujours définis. Ils ne peuvent pas être
  modifiés sans provisionner un autre backend.
- **Stockage d'artefacts GCS** — `KESTRA_STORAGE_TYPE=gcs` et
  `KESTRA_STORAGE_GCS_BUCKET` pointent vers le bucket provisionné
  automatiquement. Toutes les entrées et sorties des exécutions de flux ainsi que
  les objets de stockage internes y sont écrits.
- **Authentification basique** — `KESTRA_BASICAUTH_ENABLED=true` et
  `KESTRA_BASICAUTH_USERNAME=admin` sont toujours définis. Le mot de passe est
  injecté depuis Secret Manager. Désactiver l'authentification basique sans
  couche d'authentification de remplacement expose publiquement l'interface de
  Kestra et l'intégralité de son API REST.
- **Serveur Micronaut** — `MICRONAUT_SERVER_PORT=8080` et `ENDPOINTS_ALL_PORT=8080`
  garantissent que le serveur HTTP de Kestra et ses points de terminaison de
  santé sont tous deux accessibles sur le port 8080 pour les sondes de santé de
  la plateforme.
- **Baseline Flyway** — `FLYWAY_DATASOURCES_POSTGRES_BASELINE_ON_MIGRATE=true` et
  `FLYWAY_DATASOURCES_POSTGRES_BASELINE_VERSION=0` évitent les échecs de
  migration sur les instances Cloud SQL dont le schéma public contient déjà des
  objets d'extension.

Ajustements propres à chaque plateforme, gérés au niveau des surcouches :

- **Cloud Run** utilise `entrypoint.sh` pour relier le socket Unix de Cloud SQL
  à TCP `127.0.0.1:5432` au moyen de `socat`, avant d'assembler l'URL de
  connexion JDBC et de lancer `kestra server standalone`. C'est nécessaire, car
  Java JDBC ne sait pas se connecter nativement via des sockets Unix.
- **GKE** utilise le conteneur annexe Cloud SQL Auth Proxy, qui écoute déjà sur
  TCP `127.0.0.1:5432`. La logique de pont de socket de `entrypoint.sh` détecte
  un hôte TCP et ignore la configuration de `socat`.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes de démarrage et d'activité ciblent toutes deux le point de
terminaison `GET /health` de Kestra sur le port 8080, qui renvoie HTTP 200 une
fois le serveur Micronaut entièrement initialisé. Kestra (JVM Java) démarre
nettement plus lentement que les environnements d'exécution de langages
interprétés — la sonde par défaut est délibérément généreuse :

- **Sonde de démarrage** — HTTP `/health`, délai initial de 30 s, période de
  20 s, seuil de 40 échecs. Cela accorde jusqu'à environ 14 minutes au premier
  démarrage (préchauffage de la JVM, migrations Flyway, chargement des plugins).
- **Sonde de vivacité** — HTTP `/health`, délai initial de 180 s, période de
  30 s, seuil de 5 échecs. Cela réduit les faux positifs lors des pics
  d'exécution intensifs habituels.

Sur Cloud Run, la sonde de démarrage au niveau de l'infrastructure
(`startup_probe_config`) est par défaut de type TCP plutôt que HTTP. Cela fournit
à la couche de routage de Cloud Run un simple signal d'ouverture du port, sans
risquer un faux négatif dû à une réponse HTTP lente au tout début du démarrage
de la JVM.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié est déclaré ici (nommé
`gcs-<application_name><resource_prefix>-storage`) et
provisionné par le socle, qui accorde également l'accès au compte de service de
la charge de travail. Kestra dispose ainsi d'un backend de stockage d'artefacts
durable et partagé, qui persiste d'un redémarrage et d'un remplacement de
conteneur à l'autre. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~kestra.*-storage"
```

Des volumes GCS Fuse peuvent éventuellement être configurés dans les modules de
plateforme pour monter des buckets supplémentaires directement dans le système
de fichiers du conteneur, ce qui permet aux scripts des flux de lire et d'écrire
le contenu des buckets comme s'il s'agissait de fichiers locaux.

---

Pour la configuration propre à Kestra destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la
CLI), consultez les guides des plateformes :
**[Kestra_GKE](Kestra_GKE.md)** et **[Kestra_CloudRun](Kestra_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Kestra sur Google Cloud Run](Kestra_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Kestra sur GKE Autopilot](Kestra_GKE.md) — cette configuration déployée sur GKE.
