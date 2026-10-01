---
title: "Miniflux Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Miniflux — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Miniflux_Common.md @ 3055034 sha256:25f02d304f3e -->

# Miniflux Common — Configuration applicative partagée {#miniflux-common--shared-application-configuration}

`Miniflux_Common` est la **couche applicative partagée** de Miniflux. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Miniflux sur laquelle
s'appuient [Miniflux_GKE](Miniflux_GKE.md) et [Miniflux_CloudRun](Miniflux_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Miniflux, consultez les
guides des plateformes ([Miniflux_GKE](Miniflux_GKE.md), [Miniflux_CloudRun](Miniflux_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un unique
binaire Go statique qui stocke **tout** son état (flux, entrées, utilisateurs,
sessions) dans PostgreSQL. Il n'y a ni répertoire de données local, ni Redis, ni
séparation worker/beat : un seul processus sert l'interface web et exécute le
collecteur de flux, de sorte qu'un unique conteneur Cloud Run / GKE constitue toute
l'application.

| Domaine | Fourni par Miniflux_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe du propriétaire initial `ADMIN_PASSWORD` (24 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une fine surcouche `FROM miniflux/miniflux` avec un point d'entrée cloud ; dupliquée/construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme unique moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, le rôle, les droits et l'extension `hstore` | Sortie `initialization_jobs` |
| Stockage objet | Aucun — Miniflux conserve chaque octet de son état dans PostgreSQL (l'output `storage_buckets` est vide) | s.o. |
| Paramètres de base | Définit l'environnement Miniflux de référence : migrations de schéma au démarrage, création de l'administrateur, adresse d'écoute, URL de base | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité/disponibilité (readiness) par défaut ciblant `/healthcheck` | §Observabilité dans les guides des plateformes |

---

## 2. Le mot de passe administrateur dans Secret Manager {#2-the-admin-password-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :

- **`ADMIN_PASSWORD`** — un mot de passe aléatoire de 24 caractères (lettres et
  chiffres, sans caractères spéciaux), nommé
  `secret-<resource-prefix>-miniflux-admin-password`. Au premier démarrage, le point
  d'entrée définit `CREATE_ADMIN=1` et crée le compte du propriétaire initial
  (`ADMIN_USERNAME`, par défaut `admin`) avec ce mot de passe. `CREATE_ADMIN` est
  idempotent — aux démarrages suivants, Miniflux journalise « user already exists » et
  poursuit, de sorte que le secret n'est consommé qu'une fois. Modifier le mot de passe
  du compte dans l'interface Miniflux ne met **pas** à jour ce secret (et
  inversement).

Récupérez le secret après le déploiement :

```bash
# List the admin password secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~miniflux-admin-password"

# Read the seeded owner password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Miniflux requiert **PostgreSQL** (fixé à `POSTGRES_15`) ; MySQL et les autres moteurs
ne sont pas pris en charge. Au premier déploiement, un job ponctuel (`db-init`)
s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte de la base de données — un répertoire de socket Unix du Cloud SQL
   Auth Proxy (Cloud Run), `127.0.0.1` (le sidecar Auth Proxy sur GKE) ou une IP
   privée — pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou reconfigure avec `ALTER ROLE`) le rôle applicatif `miniflux`
   `WITH LOGIN CREATEDB` avec le mot de passe généré,
4. Crée la base de données `miniflux` si elle n'existe pas,
5. Accorde tous les privilèges sur la base de données et sur le schéma `public`, et
   attribue la propriété du schéma au rôle applicatif (PostgreSQL 15 n'accorde plus
   `CREATE` sur `public` par défaut),
6. (Re)crée l'extension **`hstore`** **dont le rôle applicatif est propriétaire** —
   un détail important : Miniflux exécute ses propres migrations de schéma sous le
   rôle applicatif, et la migration `v119` exécute `DROP EXTENSION IF EXISTS hstore`,
   ce qui exige que l'appelant soit propriétaire de l'extension. Comme PostgreSQL ne
   dispose pas de `ALTER EXTENSION ... OWNER`, le job accorde à `postgres`
   l'appartenance au rôle applicatif, effectue un `SET ROLE` vers celui-ci et recrée
   `hstore` afin que le rôle applicatif en soit propriétaire,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin que le
   pod du Job GKE se termine.

Le job s'exécute à l'apply (`execute_on_apply = true`, `max_retries = 3`) et peut être
relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image amont `miniflux/miniflux` est une image Alpine minimale (elle fournit
`/bin/sh` + busybox, le binaire se trouve dans `/usr/bin/miniflux` et s'exécute sous
l'uid `65534`). Miniflux lit une seule `DATABASE_URL`, mais le mot de passe de la base
de données est une valeur Secret Manager disponible à l'exécution qui ne peut pas être
interpolée au moment du plan — `Miniflux_Common` construit donc une **fine surcouche**
avec un point d'entrée cloud (`cloud-entrypoint.sh`) qui compose la chaîne de
connexion à l'exécution avant de lancer le binaire :

- **Compose `DATABASE_URL`** sous la forme **mot-clé/valeur** de libpq (le format de
  connexion natif de Miniflux — pas une URL `postgres://`), de sorte que le mot de
  passe n'a pas besoin d'encodage URL et qu'un répertoire de socket Unix fonctionne
  tel quel sous la forme `host=/cloudsql/<inst>`. L'hôte est traité selon trois cas :
  - un répertoire de socket `/…` (Cloud Run, `enable_cloudsql_volume = true`) →
    `sslmode=disable`,
  - `127.0.0.1` / `localhost` (loopback du sidecar Auth Proxy sur GKE) →
    `sslmode=disable`,
  - sinon une IP privée → `sslmode=require` (Cloud SQL refuse le TCP non chiffré sur
    IP privée).
- **Définit `RUN_MIGRATIONS=1`** — Miniflux exécute ses migrations de schéma au
  démarrage, il n'y a donc **pas de job de migration séparé**.
- **Dérive `LISTEN_ADDR`** de la variable d'environnement réservée `PORT` de Cloud Run
  lorsqu'elle est présente, sinon `0.0.0.0:8080`. (Ne définissez jamais `PORT`
  vous-même — Cloud Run la réserve et rejette toute valeur fournie par l'utilisateur.)
- **Définit `BASE_URL`** à partir de `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` pour
  les liens absolus et le proxy de flux ; les opérateurs remplacent `BASE_URL` pour un
  domaine personnalisé.
- **Définit `CREATE_ADMIN=1`** et passe la main à la commande amont
  `/usr/bin/miniflux` avec `exec "$@"` en tant que PID 1.

Le tag de l'image de base provient d'un ARG de build **propre à l'application**
(`MINIFLUX_VERSION`), et non de l'`APP_VERSION` générique — le socle injecte
`APP_VERSION`, qui écraserait sinon un tag de base épinglé. `:latest` est un tag
Miniflux valide et maintenu.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Miniflux_Common` établit l'environnement Miniflux de référence afin que l'application
démarre correctement dès le premier lancement :

- **Migrations** — `RUN_MIGRATIONS = "1"` : le schéma est créé et mis à niveau dans le
  processus à chaque démarrage.
- **Création de l'administrateur** — `CREATE_ADMIN = "1"` avec `ADMIN_USERNAME` (par
  défaut `admin`) et `ADMIN_PASSWORD` provenant de Secret Manager. Le propriétaire
  existe dès le premier démarrage sans ouvrir l'inscription en libre-service.
- **Inscription** — `DISABLE_LOCAL_AUTH = "false"` (la connexion locale par nom
  d'utilisateur/mot de passe est activée ; l'inscription libre en libre-service reste
  désactivée par défaut).
- **Port** — le conteneur écoute sur `8080` (`LISTEN_ADDR`, dérivé de `PORT`).

Aucun Redis ni aucun bucket GCS n'est configuré — Miniflux stocke tous les flux,
entrées et sessions dans PostgreSQL.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Toutes les sondes par défaut ciblent **`/healthcheck`** — Miniflux y renvoie un
`200 OK` sans authentification dès que le processus est démarré. `Miniflux_Common`
fournit :

- **Sonde de démarrage** — HTTP `/healthcheck`, délai initial de 30 secondes, période
  de 15 secondes, seuil de 30 échecs (une fenêtre généreuse qui laisse le temps aux
  migrations de schéma du premier démarrage).
- **Sonde de vivacité** — HTTP `/healthcheck`, période de 30 secondes, seuil de
  3 échecs.
- **Sonde de disponibilité** — HTTP `/healthcheck`, période de 10 secondes, seuil de
  3 échecs.

Comme `/healthcheck` est public et non authentifié, c'est une cible de sonde valide
aussi bien sur Cloud Run (sonde frontale) que sur GKE (sonde kubelet).

---

## 7. Stockage d'objets {#7-object-storage}

**Aucun.** Miniflux conserve chaque octet de son état — flux, entrées, utilisateurs,
sessions et métadonnées des pièces jointes — dans PostgreSQL, de sorte que
`Miniflux_Common` ne déclare aucun bucket GCS (`storage_buckets` renvoie `[]`). Les
variantes de plateforme exposent néanmoins un montage NFS facultatif pour les
opérateurs qui souhaitent un stockage partagé des pièces jointes, mais Miniflux
lui-même n'en a pas besoin.

---

Pour la configuration propre à Miniflux destinée aux utilisateurs (variables par
groupe, outputs, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes :
**[Miniflux_GKE](Miniflux_GKE.md)** et **[Miniflux_CloudRun](Miniflux_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Miniflux sur Google Cloud Run](Miniflux_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Miniflux sur GKE Autopilot](Miniflux_GKE.md) — cette configuration déployée sur GKE.
