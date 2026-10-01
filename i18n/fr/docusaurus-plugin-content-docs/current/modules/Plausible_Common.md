---
title: "Plausible Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Plausible — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Plausible_Common.md @ 3055034 sha256:3b1e3865ec3f -->

# Plausible Common — Configuration applicative partagée {#plausible-common--shared-application-configuration}

`Plausible_Common` est la **couche applicative partagée** de Plausible Analytics
Community Edition — la principale plateforme d'analyse web open source, sous
licence AGPL-3.0, respectueuse de la vie privée et sans cookies, et l'alternative
à Google Analytics la plus largement auto-hébergée. Elle n'est pas déployée
seule ; elle fournit la configuration propre à Plausible sur laquelle s'appuie
[Plausible_GKE](Plausible_GKE.md). Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de
déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut
que vous voyez dans la documentation des plateformes.

Il n'existe délibérément **aucune variante Plausible_CloudRun** : le magasin
d'événements obligatoire de Plausible est ClickHouse (fourni par
[ClickHouse_GKE](ClickHouse_GKE.md)), et ClickHouse ne peut pas s'exécuter sur
Cloud Run — Plausible suit donc le modèle « Common + GKE uniquement » (comme
Supabase et Temporal).

Pour l'infrastructure qui provisionne et exécute réellement Plausible, consultez
le guide de plateforme ([Plausible_GKE](Plausible_GKE.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Plausible_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY_BASE` (64 caractères) et `TOTP_VAULT_KEY` (exactement 32 octets, en base64) et les stocke dans **Secret Manager** sous des noms propres au service | Injectés automatiquement ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger `FROM ghcr.io/plausible/community-edition` avec un point d'entrée cloud ; construit via Cloud Build. `"latest"` est épinglé sur la version `v3.2.1` via l'ARG de build propre à l'application `PLAUSIBLE_VERSION` | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** — UNIQUEMENT pour la configuration des comptes/sites ; tous les événements d'analyse résident dans ClickHouse | Section Base de données du guide de plateforme |
| Amorçage de la base de données | Définit le job `db-init` du premier déploiement (`postgres:15-alpine` + `create-db-and-user.sh`) qui crée le rôle et la base de données Postgres | Sortie `initialization_jobs` |
| Raccordement à ClickHouse | Expose `clickhouse_url`/`clickhouse_db`/`clickhouse_user` sous forme de variables d'environnement `PLATFORM_CLICKHOUSE_*` afin que le point d'entrée compose `CLICKHOUSE_DATABASE_URL` | Comportement de l'application dans le guide de plateforme |
| Paramètres de base | `HTTP_PORT = 8000`, 1 vCPU / 1Gi de mémoire (valeur par défaut propre à ce module ; `Plausible_GKE` ramène la mémoire à 512Mi — voir ci-dessous), min 1 / max 10 réplicas, sidecar Cloud SQL Auth Proxy activé | Valeurs par défaut dans le guide de plateforme |
| Contrôles de santé | Sondes de démarrage/vivacité par défaut ciblant HTTP `GET /api/health` (non authentifié) | Section Observabilité du guide de plateforme |
| Stockage d'objets | Aucun — `storage_buckets` est vide ; aucun NFS n'est nécessaire | Sortie `storage_buckets` |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager sous des
noms propres au service (`secret-<prefix>-<app>-secret-key-base`,
`secret-<prefix>-<app>-totp-vault-key`). Ils ne sont jamais définis en texte
clair et **ne doivent jamais être modifiés après le premier déploiement** :

- **`SECRET_KEY_BASE`** — une chaîne aléatoire de 64 caractères utilisée par
  Phoenix (le framework web de Plausible) pour signer et chiffrer les sessions et
  les cookies. Sa rotation invalide toutes les sessions actives et
  **déconnecte tous les utilisateurs d'un coup**.
- **`TOTP_VAULT_KEY`** — exactement 32 octets aléatoires, encodés en base64.
  Chiffre au repos les secrets TOTP de 2FA des utilisateurs. Sa rotation
  **casse tous les appareils 2FA enregistrés** — les utilisateurs concernés ne
  peuvent plus effectuer la connexion à deux facteurs.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~plausible"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret figure dans les outputs du déploiement de la
plateforme (`database_password_secret`). Le secret du **mot de passe
ClickHouse** appartient à [ClickHouse_GKE](ClickHouse_GKE.md) : `Plausible_GKE`
transmet l'ID de son secret (`clickhouse_password_secret`), le socle accorde au
compte de service de la charge de travail de Plausible le rôle `secretAccessor`
sur celui-ci, et il est injecté en tant que `CLICKHOUSE_PASSWORD`. Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Plausible nécessite **PostgreSQL 15** pour son magasin de configuration (comptes,
sites, objectifs, paramètres). MySQL et les autres moteurs ne sont pas pris en
charge. Les événements d'analyse ne touchent jamais PostgreSQL — chaque page vue
et chaque événement personnalisé est écrit dans **ClickHouse**, obligatoire et
déployé séparément.

Au premier déploiement, un job ponctuel (`db-init`) exécute
`create-db-and-user.sh` avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et le mappe pour l'accès
   `psql`,
2. Attend (jusqu'à 60 tentatives) que PostgreSQL soit joignable,
3. Crée le rôle de l'application avec le mot de passe généré, ou met à jour le
   mot de passe si le rôle existe,
4. Crée la base de données de l'application avec ce rôle comme propriétaire
   (ignoré si elle existe),
5. Accorde tous les privilèges sur la base de données,
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement.

Le job peut être réexécuté sans risque. Les propres migrations de schéma de
Plausible — pour PostgreSQL **et** ClickHouse — s'exécutent au démarrage du
conteneur (voir ci-dessous), et non dans ce job. Inspectez directement la base de
configuration avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une enveloppe légère au-dessus de
`ghcr.io/plausible/community-edition:<tag>` :

- **Épinglage de version.** CE ne publie **aucun tag `latest`** — uniquement des
  tags de version comme `v3.2.1`. Le Dockerfile utilise donc un ARG de build
  propre à l'application, `PLAUSIBLE_VERSION`, et délibérément **non** le
  générique `APP_VERSION` : le socle injecte `APP_VERSION = application_version`
  dans `build_args` et l'emporte lors de cette fusion, ce qui aboutirait au tag
  inexistant `latest`. Lorsque `application_version = "latest"` (la valeur par
  défaut de la plateforme), `Plausible_Common` épingle
  `PLAUSIBLE_VERSION = v3.2.1`.

- **`plausible-entrypoint.sh`** s'exécute avant le démarrage du serveur Elixir.
  Il est écrit en **pur POSIX `sh`** — l'image CE ne fournit ni bash, ni node, ni
  python — l'encodage en URL des identifiants utilise donc un encodeur par
  pourcentage en pur shell (les caractères non réservés de la RFC 3986 passent
  tels quels). Ses responsabilités :

  1. **Compose `DATABASE_URL`** à partir des variables `DB_*` injectées par la
     plateforme, sous la forme
     `postgresql://<user>:<encoded-pass>@127.0.0.1:5432/<db>`. Il se connecte
     toujours en **TCP via le sidecar Cloud SQL Auth Proxy** — les hôtes de type
     chemin de socket (`/cloudsql/...`) sont ramenés à `127.0.0.1`, car les URL
     `postgresql://` ne peuvent pas contenir de chemin de socket.
  2. **Compose `CLICKHOUSE_DATABASE_URL`** à partir de `PLATFORM_CLICKHOUSE_URL`,
     `PLATFORM_CLICKHOUSE_DB`, `PLATFORM_CLICKHOUSE_USER` et du secret
     `CLICKHOUSE_PASSWORD` injecté (encodé en URL). Si `PLATFORM_CLICKHOUSE_URL`
     est vide, il **se termine avec le code 1** et une erreur claire : déployez
     d'abord ClickHouse_GKE et définissez `clickhouse_url`.
  3. **Attribue par défaut à `BASE_URL`** l'URL de service prévue par la
     plateforme (`GKE_SERVICE_URL`, avec repli sur `CLOUDRUN_SERVICE_URL`)
     lorsqu'elle n'est pas définie — `BASE_URL` pilote l'extrait du script de
     suivi et les liens des e-mails.
  4. **Amorce puis exécute** via le propre point d'entrée de CE :
     `/entrypoint.sh db createdb` (crée la base d'événements ClickHouse si elle
     est absente), `/entrypoint.sh db migrate` (migrations PostgreSQL +
     ClickHouse, protégées par un verrou consultatif pour que des réplicas
     concurrents n'entrent pas en conflit), puis `exec /entrypoint.sh run`.

Comme le point d'entrée est intégré à l'image personnalisée, le modifier exige un
nouveau build + un redéploiement ; le script du job `db-init` est monté au moment
de l'apply et ne nécessite aucun nouveau build.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Plausible_Common` établit l'environnement de base afin que l'application
démarre correctement dès le premier lancement :

- **Port** — `HTTP_PORT = "8000"` ; le port du conteneur est 8000.
- **Ressources** — la valeur par défaut propre à ce module est
  `cpu_limit = "1000m"`, `memory_limit = "1Gi"`. `Plausible_Common` n'est
  toutefois jamais déployé seul — `Plausible_GKE` transmet toujours
  `var.container_resources`, dont la valeur par défaut est `512Mi` (voir
  [Plausible_GKE](Plausible_GKE.md) § Variables de configuration du groupe 4) ;
  **la valeur par défaut effectivement déployée est donc 512Mi**, et non 1Gi.
  1Gi est un minimum recommandé, que les opérateurs devraient atteindre pour
  disposer de marge — l'environnement d'exécution Elixir/BEAM et la file de jobs
  Oban intégrée au processus de Plausible peuvent en avoir besoin — et non ce qui
  est livré par défaut.
- **Mise à l'échelle** — `min_instance_count = 1`, `max_instance_count = 10`.
  Plausible est sans état au niveau du pod (tout l'état réside dans Cloud SQL +
  ClickHouse) ; il se met donc à l'échelle horizontalement.
- **Cloud SQL** — `enable_cloudsql_volume = true` ; le point d'entrée utilise
  l'écouteur TCP de l'Auth Proxy plutôt que le socket Unix.
- **Inscription** — ouverte par défaut. Créez le premier compte sur
  `<service URL>/register`, puis définissez `DISABLE_REGISTRATION = "true"` (ou
  `"invite_only"`) via `environment_variables` pour bloquer les inscriptions
  suivantes.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `GET /api/health` — le point de terminaison de
santé public de Plausible, qui répond **sans authentification** ; les sondes ne
reçoivent donc jamais de 401/403 (le piège classique de la page de santé
authentifiée) :

- **Sonde de démarrage** — délai initial de 30s, période de 10s,
  `failure_threshold = 30` (jusqu'à ~5 minutes de marge pour les migrations
  PostgreSQL + ClickHouse du premier démarrage).
- **Sonde de vivacité** — période de 30s, `failure_threshold = 3`.

---

## 7. Sorties {#7-outputs}

| Sortie | Type | Description |
|---|---|---|
| `config` | `object` | Configuration complète de l'application (image, configuration de build, variables d'environnement, paramètres de base de données, sondes, job `db-init`) utilisée par le module socle. |
| `secret_ids` | `map(string)` | `{ SECRET_KEY_BASE = <secret_id>, TOTP_VAULT_KEY = <secret_id> }`. |
| `secret_values` | `object` | Valeurs sensibles en texte clair pour une injection directe dans un Secret Kubernetes. |
| `storage_buckets` | `list` | Vide — Plausible n'a besoin d'aucun stockage de fichiers. |
| `path` | `string` | Chemin du répertoire du module, utilisé pour résoudre `scripts_dir`. |

---

Pour la configuration propre à Plausible destinée aux utilisateurs (variables par
groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez le guide de plateforme : **[Plausible_GKE](Plausible_GKE.md)**. Le
magasin d'événements obligatoire est documenté dans
**[ClickHouse_GKE](ClickHouse_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Plausible Analytics sur GKE Autopilot](Plausible_GKE.md) — cette configuration déployée sur GKE.
