---
title: "Gotify Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Gotify — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Gotify_Common.md @ 15fd4c7 sha256:f62abef9cd80 -->

# Gotify Common — Configuration d'application partagée {#gotify-common--shared-application-configuration}

`Gotify_Common` est la **couche d'application partagée** pour Gotify. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration spécifique à Gotify sur laquelle
[Gotify_GKE](Gotify_GKE.md) et [Gotify_CloudRun](Gotify_CloudRun.md) s'appuient, afin que
les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Gotify, consultez les guides de plateforme
([Gotify_GKE](Gotify_GKE.md), [Gotify_CloudRun](Gotify_CloudRun.md)) et les
guides de socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Gotify_Common | Où cela apparaît |
|---|---|---|
| Secret d'amorçage administrateur | Génère un mot de passe administrateur de 24 caractères et le stocke dans **Secret Manager** | Injecté en tant que `GOTIFY_DEFAULTUSER_PASS` ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `ghcr.io/gotify/server` avec un point d'entrée personnalisé ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme moteur (le mode SQLite de Gotify n'est pas utilisé) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, le rôle et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare **aucun** bucket — Gotify conserve tous les messages dans PostgreSQL | Sortie `storage_buckets` (vide) |
| Paramètres de base | Définit l'environnement Gotify de base : dialecte/connexion de la base de données, port du serveur, utilisateur administrateur par défaut | Comportement de l'application dans les guides de plateforme |
| Sondes de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides de plateforme |

---

## 2. Le secret administrateur dans Secret Manager {#2-the-admin-secret-in-secret-manager}

Un seul secret est généré automatiquement et stocké dans Secret Manager :

- **Mot de passe administrateur** — un mot de passe aléatoire de 24 caractères (sans caractères spéciaux, donc
  compatible avec le shell et les URL). Il est écrit dans un secret nommé
  `secret-<resource-prefix>-gotify-admin-password` et injecté dans le conteneur
  en tant que **`GOTIFY_DEFAULTUSER_PASS`**. Avec `GOTIFY_DEFAULTUSER_NAME=admin`
  (défini par le point d'entrée), Gotify crée le compte administrateur initial **uniquement lors de la
  première initialisation de la base de données**. Modifier le secret après le premier démarrage ne
  réinitialise pas le mot de passe administrateur — cela doit être fait dans l'interface utilisateur de Gotify ou via l'API.

Récupérez le secret après le déploiement :

```bash
# List the admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~gotify-admin-password"

# Read it:
gcloud secrets versions access latest \
  --secret="secret-<resource-prefix>-gotify-admin-password" --project "$PROJECT"
```

Gotify n'a pas de clé de chiffrement séparée ou de secret JWT — il authentifie les appelants avec
des **jetons d'application** et des **jetons client** qu'il génère et stocke dans ses propres
tables `users`/`applications`/`clients`. Ces jetons sont créés via l'interface utilisateur ou
l'API REST après la première connexion, et non injectés par cette couche.

Le mot de passe de la base de données est généré et géré séparément par le socle ; son
nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`).
Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Gotify prend en charge un fichier SQLite intégré ou un serveur PostgreSQL externe. Ce
module utilise toujours **PostgreSQL 15** sur Cloud SQL géré — le mode SQLite intégré
n'est jamais utilisé, donc aucun disque persistant n'est requis pour la base de données. Lors du premier
déploiement, un job ponctuel (`db-init`) s'exécute en utilisant `postgres:15-alpine` et
de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL et le lie symboliquement pour l'accès `psql`,
2. Attend que PostgreSQL soit accessible (jusqu'à 60 tentatives),
3. Crée (ou met à jour le mot de passe de) le rôle de l'application,
4. Crée la base de données de l'application avec ce rôle comme propriétaire,
5. Accorde tous les privilèges sur la base de données au rôle,
6. Signale au proxy d'authentification Cloud SQL de s'arrêter gracieusement.

Gotify applique ensuite son **propre schéma** via l'auto-migration GORM lors du premier démarrage de l'application
— il n'y a pas de job de migration séparé. Le job `db-init` peut être réexécuté en toute sécurité.
Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `ghcr.io/gotify/server:<version>` avec un point d'entrée shell léger
(`gotify-entrypoint.sh`) qui s'exécute avant le démarrage du serveur Go. Parce que Gotify
publie des tags numériques (par exemple `2.9.1`) et que le socle injecte `APP_VERSION` dans
les arguments de build, le Dockerfile utilise un ARG de build **`GOTIFY_VERSION`** spécifique à l'application
(que le socle n'injecte pas) ; `application_version = "latest"` correspond à la
base épinglée `2.9.1` afin qu'un nouveau build ne résolve jamais un mauvais tag.

Le point d'entrée :

- **Mappe `DB_*` sur `GOTIFY_DATABASE_*`** — la plateforme injecte les variables standard `DB_HOST`,
  `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` ; le point d'entrée définit
  `GOTIFY_DATABASE_DIALECT=postgres` et construit `GOTIFY_DATABASE_CONNECTION` comme un
  DSN GORM `key=value` (`host=… port=… user=… password='…' dbname=… sslmode=disable`).
  Le pilote `lib/pq` accepte le **répertoire** du socket du proxy d'authentification Cloud SQL comme
  valeur `host=`, de sorte que le même mappage fonctionne sur Cloud Run (répertoire du socket) et GKE
  (`127.0.0.1` via le sidecar du proxy).
- **Attend le point de terminaison de la base de données** — Gotify panique lors de sa première connexion refusée,
  donc sur un hôte TCP (le sidecar du proxy de GKE), le point d'entrée attend que le port s'ouvre avant de démarrer le serveur ;
  sur le chemin du socket de Cloud Run, il ignore l'attente.
- **Définit le port du serveur** — `GOTIFY_SERVER_PORT=80`.
- **Définit l'utilisateur administrateur par défaut** — `GOTIFY_DEFAULTUSER_NAME=admin` (le mot de passe
  provient du secret injecté `GOTIFY_DEFAULTUSER_PASS`).
- **Lance le serveur** — `exec /app/gotify-app` en tant que PID 1.

Les valeurs d'environnement discrètes n'ont pas besoin d'encodage URL (seuls les DSN au format URL en ont besoin), donc le mot de passe est
passé textuellement entre guillemets simples ; `sslmode=disable` est correct car le socket
est local et le proxy d'authentification termine le TLS en amont.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`Gotify_Common` établit l'environnement Gotify de base afin que l'application démarre
correctement lors du premier démarrage :

- **Base de données** — `GOTIFY_DATABASE_DIALECT = "postgres"` ; connexion assemblée à partir des
  variables injectées `DB_*` au moment de l'exécution.
- **Port** — `GOTIFY_SERVER_PORT = "80"` ; le conteneur écoute sur le port 80.
- **Administrateur par défaut** — `GOTIFY_DEFAULTUSER_NAME = "admin"` avec le
  `GOTIFY_DEFAULTUSER_PASS` généré, appliqué uniquement lors de la première initialisation.

Tout paramètre `GOTIFY_*` supplémentaire (période de ping du flux, limites de téléchargement, CORS, etc.)
peut être fourni via l'entrée `environment_variables` de la plateforme sans
toucher à cette couche.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/health`** — le point de terminaison de santé public et non authentifié de Gotify,
qui renvoie `{"health":"green","database":"green"}` une fois que le serveur est
opérationnel et connecté à PostgreSQL. Une fenêtre de démarrage généreuse (`initial_delay_seconds =
30`, `failure_threshold = 30`, `period_seconds = 10`)
permet l'auto-migration GORM qui s'exécute au premier démarrage sur une base de données vierge.

- **Cloud Run** utilise des sondes de démarrage et de vivacité HTTP contre `/health`.
- **GKE** utilise des sondes de démarrage et de vivacité HTTP contre `/health` avec la même
  marge.

L'API d'envoi REST (`/message`) et le WebSocket de réception (`/stream`) nécessitent tous deux un
jeton, ils ne sont donc pas utilisés pour les vérifications de santé.

---

## 7. Stockage d'objets {#7-object-storage}

Gotify stocke les messages, les applications et les jetons client dans PostgreSQL, donc
**aucun bucket Cloud Storage n'est déclaré** ici (`storage_buckets` est vide). Le
stockage sur disque de Gotify pour les images d'application et les plugins téléchargés (`/app/data`) est persisté
par les variantes de plateforme : un PVC de bloc sur GKE et NFS sur Cloud Run, tous deux montés à
`/app/data` par défaut.

---

Pour la configuration spécifique à Gotify et destinée aux utilisateurs (variables par groupe, sorties et
comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[Gotify_GKE](Gotify_GKE.md)** et **[Gotify_CloudRun](Gotify_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Gotify sur Google Cloud Run](Gotify_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Gotify sur GKE Autopilot](Gotify_GKE.md) — cette configuration déployée sur GKE.
