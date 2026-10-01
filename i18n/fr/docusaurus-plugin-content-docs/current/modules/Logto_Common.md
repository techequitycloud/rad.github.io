---
title: "Logto Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Logto — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Logto_Common.md @ 3055034 sha256:c6276dd817b9 -->

# Logto Common — Configuration applicative partagée {#logto-common--shared-application-configuration}

`Logto_Common` est la **couche applicative partagée** de Logto. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration propre à Logto sur laquelle s'appuient à la fois
[Logto_GKE](Logto_GKE.md) et [Logto_CloudRun](Logto_CloudRun.md), de sorte que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Logto, consultez les guides
des plateformes ([Logto_GKE](Logto_GKE.md), [Logto_CloudRun](Logto_CloudRun.md)) et les
guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Logto_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Fine surcouche construite `FROM svhd/logto:<version>` (cœur communautaire + console d'administration) via Cloud Build ; mise en miroir dans Artifact Registry | Sortie `container_image` du déploiement de plateforme |
| Point d'entrée cloud | `entrypoint.sh` compose `DB_URL` à partir des variables `DB_*` injectées et dérive `ENDPOINT` / `ADMIN_ENDPOINT` de l'URL du service avant de passer la main à la commande d'amorçage puis de démarrage de l'image | Comportement à l'exécution sur les deux plateformes |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme unique moteur pris en charge | Section Base de données des guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données et le rôle avec `CREATEDB CREATEROLE` et accorde la propriété du schéma | Sortie `initialization_jobs` |
| Secrets applicatifs | **Aucun** — Logto génère et stocke ses clés de signature OIDC dans la base de données (amorcées au premier démarrage), si bien qu'aucun secret applicatif externe n'est créé | La sortie `secret_ids` est vide `{}` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (`storage`) | Sortie `storage_buckets` |
| Paramètres principaux | Définit `TRUST_PROXY_HEADER = "1"` et dérive `ENDPOINT` / `ADMIN_ENDPOINT` de l'URL du service injectée | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage / de vivacité / de disponibilité par défaut ciblant `/api/status` | Section Observabilité des guides de plateforme |

---

## 2. Secrets applicatifs — il n'y en a aucun à gérer {#2-application-secrets--there-are-none-to-manage}

Contrairement à la plupart des produits d'identité, Logto n'a besoin d'**aucun secret applicatif externe**. Ses
clés privées de signature OIDC sont générées par l'étape `db seed` au premier démarrage et stockées
**dans la base de données PostgreSQL**. Par conséquent :

- `Logto_Common` ne crée **aucune** ressource `random_password` et expose une table
  `secret_ids = {}` **vide**. Il n'y a ni clé de chiffrement ni secret JWT à protéger ou à renouveler.
- Le seul secret en jeu est le **mot de passe de la base de données**, qui est généré et géré
  par le socle (son nom dans Secret Manager est indiqué par `database_password_secret`
  dans les sorties de la plateforme).

Comme les clés de signature résident dans la base de données, c'est la base elle-même qui est l'unique
dépositaire du matériel cryptographique de Logto — protéger et sauvegarder Cloud SQL, c'est
protéger les clés d'identité de Logto. Récupérez le secret du mot de passe de la base avec :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~logto"
gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Logto exige **PostgreSQL** (le module fixe `POSTGRES_15`) ; MySQL et les autres
moteurs sont rejetés par une garde de validation au moment du plan. Lors du premier déploiement, un
job ponctuel (`db-init`) s'exécute avec `postgres:15-alpine` et, de façon idempotente :

1. Se connecte en tant que superutilisateur Cloud SQL (`postgres`) — via le socket Auth Proxy /
   loopback sur GKE, ou via l'IP privée sur Cloud Run,
2. Attend que PostgreSQL accepte les connexions,
3. Crée (ou reconfigure) le rôle applicatif **avec `LOGIN CREATEDB CREATEROLE`** —
   `CREATEROLE` est obligatoire car le `db seed` de Logto crée des rôles Postgres par locataire
   pour l'isolation des locataires par sécurité au niveau des lignes ; sans lui, l'amorçage échoue avec
   `permission denied to create role` (SQLSTATE 42501),
4. Crée la base de données applicative si elle n'existe pas,
5. Accorde tous les privilèges sur la base de données et sur le schéma `public`, et transfère
   la propriété du schéma `public` au rôle applicatif (Postgres 15 n'accorde plus
   `CREATE` sur `public` par défaut),
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin que le pod
   du Job GKE puisse se terminer.

Logto **amorce ensuite son propre schéma et ses clés de signature OIDC au démarrage** via
`npm run cli db seed -- --swe` (`--swe` = seed-when-empty — idempotent ; il n'écrit
que lorsque la base ne contient aucune table Logto). Le job `db-init` peut être relancé sans risque. Inspectez
la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données (`logto`) et de l'utilisateur (`logto`) figurent dans les sorties
du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une **fine surcouche construite `FROM svhd/logto:<version>`** (l'image
Logto communautaire qui regroupe le cœur et la console d'administration) à laquelle s'ajoute un point d'entrée cloud
(`entrypoint.sh`). Le tag de l'image de base est piloté par un ARG de build propre à l'application,
`LOGTO_VERSION` — **et non** par l'`APP_VERSION` générique, que le socle
injecte dans `build_args` et qui écraserait sinon le tag du `FROM`. L'image est
construite via Cloud Build et mise en miroir dans Artifact Registry (`enable_image_mirroring = true`).

Le point d'entrée s'exécute avant le démarrage de Logto et :

- **Compose `DB_URL`** à partir des variables `DB_*` injectées par le socle. Le pilote de Logto
  (`@silverhand/slonik`) analyse `DB_URL` avec le `new URL()` WHATWG, qui **rejette
  la forme socket Unix de libpq** (hôte d'autorité vide → `Invalid URL`). Logto est
  donc une application à DSN de type autorité d'URL qui **ne peut pas utiliser le socket Cloud SQL** — le
  point d'entrée bifurque selon `DB_HOST` :
  - un répertoire de socket `/…` (Cloud Run) → connexion via l'IP privée injectée
    (`DB_IP`) avec `sslmode=no-verify` (chiffré ; la vérification de l'AC est ignorée pour le seul
    saut vers la base, car Cloud SQL présente un certificat autosigné absent du magasin d'AC de Node) ;
  - `127.0.0.1` / `localhost` (sidecar Auth Proxy sur GKE) → TCP simple, sans SSL (le proxy
    termine TLS) ;
  - une IP privée → TCP avec `sslmode=no-verify`.
- **Dérive `ENDPOINT` / `ADMIN_ENDPOINT`** de `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL` injectées. Logto construit son émetteur OIDC et toutes ses URL absolues à partir
  d'`ENDPOINT`, qui doit donc correspondre à l'hôte vu par le navigateur. Les opérateurs peuvent surcharger
  `ENDPOINT` pour un domaine personnalisé.
- **Définit `TRUST_PROXY_HEADER = "1"`** afin que Logto respecte les en-têtes `X-Forwarded-*`
  derrière le frontal HTTPS de Cloud Run / GKE.
- **Passe la main** à la commande de démarrage propre à l'image
  (`npm run cli db seed -- --swe && npm start`).

La surcouche est un script POSIX `sh` (la base `svhd/logto` est Node/Alpine sans
`python3`) ; l'encodage URL des identifiants de la base est donc réalisé en pur shell.

---

## 5. Paramètres principaux de l'application et ports {#5-core-application-settings-and-ports}

`Logto_Common` établit l'environnement de base pour que Logto démarre correctement :

- **Ports.** Le cœur de Logto (le point de terminaison API / OIDC) écoute sur **3001**, et c'est le port
  publié sur les deux plateformes (`container_port = 3001`). La **console d'administration écoute sur
  3002** et n'est **pas accessible** via l'unique port Cloud Run / l'unique port du Service GKE
  — voir la mise en garde ci-dessous.
- **`PORT` n'est jamais défini.** Cloud Run réserve la variable d'environnement `PORT` (il injecte automatiquement
  `PORT=3001`) et rejette toute valeur fournie par l'utilisateur ; le cœur de Logto utilise 3001 par défaut,
  ce qui correspond à `container_port`.
- **Pas de Redis.** Logto utilise PostgreSQL pour toute la persistance ; `enable_redis` vaut donc
  `false` par défaut et aucun `REDIS_URL` n'est injecté.
- **`TRUST_PROXY_HEADER = "1"`** et `ENDPOINT` / `ADMIN_ENDPOINT` dérivés à l'exécution
  (voir §4).

> **Mise en garde sur la console d'administration.** Comme Cloud Run et un Service GKE unique ne publient qu'un
> seul port, seul le cœur (3001) est accessible. La console d'administration (3002) — où sont créés le premier
> compte administrateur et les enregistrements d'applications — n'est pas exposée
> via le port publié. Pour effectuer la configuration initiale, atteignez la console sur 3002
> directement (par exemple `kubectl port-forward` sur GKE, ou une seconde exposition), ou placez devant
> Logto un proxy qui route vers les deux ports. Consultez les guides de plateforme pour plus de détails.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/api/status`** — un point de terminaison non authentifié du cœur
de Logto qui renvoie `200` dès que le serveur est opérationnel. Une fenêtre de démarrage généreuse absorbe
l'amorçage ponctuel du schéma et des clés OIDC qui s'exécute au premier démarrage.

- **Sonde de démarrage** — HTTP `GET /api/status`, délai initial de 60 secondes, période de 15 secondes,
  seuil de 30 échecs (une large fenêtre au premier démarrage pour l'étape d'amorçage).
- **Sonde de vivacité** — HTTP `GET /api/status`, période de 30 secondes.
- **Sonde de disponibilité** — HTTP `GET /api/status`, délai initial de 30 secondes, période de 10 secondes.

Toutes trois renvoient des 200 non authentifiés ; elles ne déclenchent donc jamais le contrôle d'authentification qui protège
les routes `/api/*` de modification.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (suffixe `storage`, classe `STANDARD`, prévention de l'accès
public `enforced`, sans gestion des versions des objets) est déclaré ici et provisionné par le
socle, qui accorde l'accès au compte de service de la charge de travail. Logto conserve tout son état
principal dans PostgreSQL ; ce bucket est donc disponible pour des ressources facultatives plutôt que comme
stockage d'exécution requis. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Logto destinée aux utilisateurs (variables par groupe, sorties, et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Logto_GKE](Logto_GKE.md)** et **[Logto_CloudRun](Logto_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Logto sur Google Cloud Run](Logto_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Logto sur GKE Autopilot](Logto_GKE.md) — cette configuration déployée sur GKE.
