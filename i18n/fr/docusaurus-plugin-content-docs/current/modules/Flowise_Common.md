---
title: "Flowise Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Flowise — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Flowise_Common.md @ 3055034 sha256:dbc4e8b4a35f -->

# Flowise Common — Configuration applicative partagée {#flowise-common--shared-application-configuration}

`Flowise_Common` est la **couche applicative partagée** de Flowise. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Flowise sur laquelle
s'appuient à la fois [Flowise_GKE](Flowise_GKE.md) et [Flowise_CloudRun](Flowise_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Flowise, consultez les
guides de plateforme ([Flowise_GKE](Flowise_GKE.md), [Flowise_CloudRun](Flowise_CloudRun.md)) et les
guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Flowise_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur de Flowise et le stocke dans **Secret Manager** sous `FLOWISE_PASSWORD` | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Fige l'image de base `flowiseai/flowise` et le Dockerfile personnalisé qui l'étend avec `flowise-entrypoint.sh` | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Utilise par défaut **Cloud SQL for PostgreSQL 15** ; définit `DATABASE_TYPE=postgres` et `DATABASE_PORT=5432` | §Base de données dans les guides de plateforme |
| Initialisation de la base de données | Définit le job du premier déploiement qui crée la base de données et l'utilisateur, et accorde les privilèges, à l'aide de `postgres:15-alpine` | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** des fichiers téléversés (suffixe de nom `-uploads`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Flowise de référence : `FLOWISE_USERNAME`, `APIKEY_STORAGE_TYPE=db`, `STORAGE_TYPE=gcs`, `GCLOUD_PROJECT` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage et de vivacité ciblant `/api/v1/ping` | §Observabilité dans les guides de plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le mot de passe de l'administrateur Flowise est généré automatiquement sous forme
d'une chaîne aléatoire de 32 caractères et stocké en tant que secret Secret Manager —
il n'est jamais défini en clair. Récupérez-le après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~password"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

L'ID du secret a la forme `secret-<resource_prefix>-flowise-password`. Le mot de
passe de la base de données est généré et géré séparément par le socle ; le nom de
son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Flowise nécessite **PostgreSQL** ; le moteur par défaut est PostgreSQL 15. MySQL
n'est pas pris en charge. Lors du premier déploiement, un job ponctuel se
connecte à Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée la base de données Flowise (si elle n'existe pas),
2. crée l'utilisateur applicatif avec le mot de passe généré,
3. accorde à cet utilisateur tous les privilèges sur cette base de données.

Le job exécute `create-db-and-user.sh` depuis le répertoire `scripts/` du module
avec l'image `postgres:15-alpine`. Il peut être relancé sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Flowise_Common` établit l'environnement Flowise de référence afin que l'application
démarre correctement dès le premier lancement :

- **Identité administrateur** — le nom d'utilisateur administrateur initial
  (configurable via `flowise_username` dans le module de plateforme, groupe 3). Le
  mot de passe est généré automatiquement.
- **Raccordement à la base de données** — `DATABASE_TYPE=postgres` et
  `DATABASE_PORT=5432` sont toujours injectés. Les valeurs `DATABASE_HOST`,
  `DATABASE_USER`, `DATABASE_NAME` et `DATABASE_PASSWORD` ne sont **pas** définies
  comme variables d'environnement statiques ; elles sont mises en correspondance au
  démarrage du conteneur par `flowise-entrypoint.sh` à partir des variables `DB_*`
  injectées par la plateforme. Cela est nécessaire pour gérer l'ordre alphabétique
  des variables d'environnement de GKE, avec lequel Kubernetes ne résoudrait pas
  `$(DB_HOST)` dans `DATABASE_HOST` si `DATABASE_*` était déclaré avant `DB_*`.
- **Stockage de fichiers GCS** — `STORAGE_TYPE=gcs`, `APIKEY_STORAGE_TYPE=db` et
  `GCLOUD_PROJECT` sont toujours injectés. Flowise écrit tous les fichiers
  téléversés par les utilisateurs dans le bucket GCS provisionné automatiquement,
  dont le nom est transmis via `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Ne remplacez pas
  `STORAGE_TYPE` — cela ferait basculer sur un disque local éphémère, et tous les
  fichiers téléversés seraient perdus à chaque redémarrage ou nouvelle révision.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison de santé dédié de Flowise,
`/api/v1/ping`, qui renvoie HTTP 200 lorsque l'application est prête et connectée à
la base de données. Un budget de démarrage généreux laisse le temps à
l'initialisation de la base de données au premier lancement :

- **Sonde de démarrage** — HTTP GET `/api/v1/ping`, délai initial de 30 secondes,
  période de 10 secondes, seuil d'échec de 30 (= budget total de 5 minutes).
- **Sonde de vivacité** — HTTP GET `/api/v1/ping`, délai initial de 15 secondes,
  période de 30 secondes, seuil d'échec de 3.

Les variantes GKE et Cloud Run utilisent toutes deux des sondes HTTP pour ces points
de terminaison. Contrairement à certaines applications PHP/Apache qui redirigent le
trafic des contrôles de santé, Flowise répond directement sur `/api/v1/ping` sans
redirection, de sorte que les sondes HTTP fonctionnent sur les deux plateformes.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié aux fichiers téléversés (suffixe de nom `-uploads`)
est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte
de service de la charge de travail. Flowise utilise ce bucket comme backend de
stockage de fichiers pour les documents, les images et les autres fichiers téléversés
par les utilisateurs. Le nom du bucket est injecté automatiquement sous
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Le bucket utilise `STORAGE_CLASS=STANDARD` dans la région du déploiement, avec la
prévention de l'accès public définie sur `inherited`. Des buckets supplémentaires
peuvent être ajoutés via la variable `storage_buckets` du module de plateforme.

---

Pour la configuration propre à Flowise et visible par l'utilisateur (variables par
groupe, sorties, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides de plateforme :
**[Flowise_GKE](Flowise_GKE.md)** et **[Flowise_CloudRun](Flowise_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Flowise sur Google Cloud Run](Flowise_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Flowise sur GKE Autopilot](Flowise_GKE.md) — cette configuration déployée sur GKE.
