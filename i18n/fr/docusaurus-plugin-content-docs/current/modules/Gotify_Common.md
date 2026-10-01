---
title: "Gotify Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Gotify — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Gotify_Common.md @ 3055034 sha256:07571f07bbe5 -->

# Gotify Common — Configuration applicative partagée {#gotify-common--shared-application-configuration}

`Gotify_Common` est la **couche applicative partagée** de Gotify. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Gotify sur laquelle
s'appuient [Gotify_GKE](Gotify_GKE.md) et [Gotify_CloudRun](Gotify_CloudRun.md), afin
que les deux variantes de plateforme se comportent de manière identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Gotify, consultez les
guides des plateformes ([Gotify_GKE](Gotify_GKE.md), [Gotify_CloudRun](Gotify_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Gotify_Common | Où cela apparaît |
|---|---|---|
| Secret d'initialisation de l'administrateur | Génère un mot de passe administrateur de 24 caractères et le stocke dans **Secret Manager** | Injecté sous la forme `GOTIFY_DEFAULTUSER_PASS` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image du conteneur | Encapsule l'image officielle `ghcr.io/gotify/server` avec un point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme moteur (le mode SQLite de Gotify n'est pas utilisé) | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, le rôle et les droits | Sortie `initialization_jobs` |
| Stockage objet | Ne déclare **aucun** bucket — Gotify conserve tous les messages dans PostgreSQL | Sortie `storage_buckets` (vide) |
| Paramètres principaux | Définit l'environnement Gotify de base : dialecte/connexion de la base de données, port du serveur, utilisateur administrateur par défaut | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Le secret administrateur dans Secret Manager {#2-the-admin-secret-in-secret-manager}

Un seul secret est généré automatiquement et stocké dans Secret Manager :

- **Mot de passe administrateur** — un mot de passe aléatoire de 24 caractères (sans
  caractères spéciaux, donc sûr pour le shell et les URL). Il est écrit dans un secret
  nommé `secret-<resource-prefix>-gotify-admin-password` et injecté dans le conteneur
  sous la forme **`GOTIFY_DEFAULTUSER_PASS`**. Avec `GOTIFY_DEFAULTUSER_NAME=admin`
  (défini par le point d'entrée), Gotify crée le compte administrateur initial
  **uniquement lors de la première initialisation de la base de données**. Modifier le
  secret après le premier démarrage ne réinitialise pas le mot de passe
  administrateur — cela doit se faire dans l'interface de Gotify ou via l'API.

Récupérez le secret après le déploiement :

```bash
# List the admin-password secret for this deployment:
gcloud secrets list --project "$PROJECT" --filter="name~gotify-admin-password"

# Read it:
gcloud secrets versions access latest \
  --secret="secret-<resource-prefix>-gotify-admin-password" --project "$PROJECT"
```

Gotify n'a ni clé de chiffrement distincte ni secret JWT — il authentifie les
appelants à l'aide de **jetons d'application** et de **jetons client** qu'il génère et
stocke dans ses propres tables `users`/`applications`/`clients`. Ces jetons sont créés
via l'interface ou l'API REST après la première connexion ; ils ne sont pas injectés
par cette couche.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Gotify prend en charge soit un fichier SQLite intégré, soit un serveur PostgreSQL
externe. Ce module utilise toujours **PostgreSQL 15** sur Cloud SQL géré — le mode
SQLite intégré n'est jamais utilisé, aucun disque persistant n'est donc nécessaire
pour la base de données. Lors du premier déploiement, un job ponctuel (`db-init`)
s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et crée un lien symbolique pour
   l'accès `psql`,
2. Attend que PostgreSQL soit joignable (jusqu'à 60 tentatives),
3. Crée le rôle de l'application (ou en met à jour le mot de passe),
4. Crée la base de données de l'application avec ce rôle comme propriétaire,
5. Accorde tous les privilèges sur la base de données à ce rôle,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Gotify applique ensuite son **propre schéma** par auto-migration GORM au premier
démarrage de l'application — il n'existe pas de job de migration distinct. Le
job `db-init` peut être relancé sans risque. Inspectez directement la base de
données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `ghcr.io/gotify/server:<version>` avec un point
d'entrée shell léger (`gotify-entrypoint.sh`) qui s'exécute avant le démarrage du
serveur Go. Comme Gotify publie des tags numériques (par ex. `2.9.1`) et que le socle
injecte `APP_VERSION` dans les arguments de build, le Dockerfile utilise un ARG de
build propre à l'application, **`GOTIFY_VERSION`** (que le socle n'injecte pas) ;
`application_version = "latest"` correspond à la base épinglée `2.9.1`, de sorte
qu'un nouveau build ne résout jamais un tag invalide.

Le point d'entrée :

- **Mappe `DB_*` vers `GOTIFY_DATABASE_*`** — la plateforme injecte les variables
  standard `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` ; le point
  d'entrée définit `GOTIFY_DATABASE_DIALECT=postgres` et construit
  `GOTIFY_DATABASE_CONNECTION` sous la forme d'un DSN GORM `key=value`
  (`host=… port=… user=… password='…' dbname=… sslmode=disable`). Le pilote `lib/pq`
  accepte le **répertoire** du socket du Cloud SQL Auth Proxy comme valeur `host=`, si
  bien que le même mappage fonctionne sur Cloud Run (répertoire du socket) et sur GKE
  (`127.0.0.1` via le sidecar du proxy).
- **Définit le port du serveur** — `GOTIFY_SERVER_PORT=80`.
- **Définit l'utilisateur administrateur par défaut** — `GOTIFY_DEFAULTUSER_NAME=admin`
  (le mot de passe provient du secret injecté `GOTIFY_DEFAULTUSER_PASS`).
- **Lance le serveur** — `exec /app/gotify-app` en tant que PID 1.

Les valeurs d'environnement distinctes n'ont pas besoin d'encodage URL (seuls les DSN
au format URL en ont besoin) ; le mot de passe est donc transmis tel quel entre
apostrophes ; `sslmode=disable` est correct car le socket est local et l'Auth Proxy
termine le TLS en amont.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Gotify_Common` établit l'environnement Gotify de base pour que l'application démarre
correctement dès le premier lancement :

- **Base de données** — `GOTIFY_DATABASE_DIALECT = "postgres"` ; la connexion est
  assemblée à l'exécution à partir des variables `DB_*` injectées.
- **Port** — `GOTIFY_SERVER_PORT = "80"` ; le conteneur écoute sur le port 80.
- **Administrateur par défaut** — `GOTIFY_DEFAULTUSER_NAME = "admin"` avec le
  `GOTIFY_DEFAULTUSER_PASS` généré, appliqué uniquement lors de la première
  initialisation.

Tout paramètre `GOTIFY_*` supplémentaire (période de ping des flux, limites
d'upload, CORS, etc.) peut être fourni via l'entrée `environment_variables` de la
plateforme sans toucher à cette couche.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/health`** — le point de terminaison de santé public
et non authentifié de Gotify, qui renvoie `{"health":"green","database":"green"}` dès
que le serveur est démarré et connecté à PostgreSQL. Une fenêtre de démarrage
généreuse (`initial_delay_seconds =
30`, `failure_threshold = 30`, `period_seconds = 10`) laisse le temps à
l'auto-migration GORM qui s'exécute au premier démarrage sur une base de données
vierge.

- **Cloud Run** utilise des sondes HTTP de démarrage et de vivacité sur `/health`.
- **GKE** utilise des sondes HTTP de démarrage et de vivacité sur `/health` avec la
  même marge.

L'API REST d'envoi (`/message`) et le WebSocket de réception (`/stream`) exigent tous
deux un jeton ; ils ne sont donc pas utilisés pour les contrôles de santé.

---

## 7. Stockage d'objets {#7-object-storage}

Gotify stocke les messages, les applications et les jetons client dans PostgreSQL ;
**aucun bucket Cloud Storage n'est donc déclaré** ici (`storage_buckets` est vide).
Le stockage sur disque facultatif de Gotify pour les images d'application et les
plugins téléversés n'est pas persistant par défaut ; activez NFS ou un volume GCS
Fuse au niveau de la plateforme si vous en dépendez.

---

Pour la configuration propre à Gotify destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Gotify_GKE](Gotify_GKE.md)** et
**[Gotify_CloudRun](Gotify_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Gotify sur Google Cloud Run](Gotify_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Gotify sur GKE Autopilot](Gotify_GKE.md) — cette configuration déployée sur GKE.
