---
title: "Synapse Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Synapse — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Synapse_Common.md @ 3055034 sha256:dc13f2a88cab -->

# Synapse Common — Configuration applicative partagée {#synapse-common--shared-application-configuration}

`Synapse_Common` est la **couche applicative partagée** de Synapse, le homeserver
[Matrix](https://matrix.org/) de référence. Elle n'est pas déployée seule ; elle
fournit la configuration propre à Synapse sur laquelle s'appuient à la fois
[Synapse_GKE](Synapse_GKE.md) et [Synapse_CloudRun](Synapse_CloudRun.md), de sorte
que les deux variantes de plateforme se comportent de manière identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Synapse, consultez les
guides des plateformes ([Synapse_GKE](Synapse_GKE.md),
[Synapse_CloudRun](Synapse_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Synapse_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère un `registration_shared_secret` stable (injecté sous le nom `REGISTRATION_SHARED_SECRET` via l'output `secret_ids`) et un mot de passe de superutilisateur, tous deux stockés dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe l'image officielle `matrixdotorg/synapse` avec un point d'entrée cloud qui génère `homeserver.yaml` et une clé de signature persistante, et raccorde le PostgreSQL de la plateforme ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit les jobs du premier déploiement : `db-init` (crée la base de données avec la **collation `C` obligatoire** et le rôle de l'application) et `create-admin` (enregistre le superutilisateur initial) | Sortie `initialization_jobs` |
| Stockage objet | Déclare le bucket de données **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement de référence de Synapse : `server_name`, port de l'écouteur HTTP (`8008`), répertoire de données, envoi de statistiques, enregistrement | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage, de vivacité et de disponibilité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques et clé de signature {#2-cryptographic-secrets-and-the-signing-key}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en clair :

- **`registration_shared_secret`** — une chaîne aléatoire stable injectée comme
  variable d'environnement secrète `REGISTRATION_SHARED_SECRET` (la seule clé de
  l'output `secret_ids`, que `Synapse_CloudRun` et `Synapse_GKE` transmettent tous
  deux) et écrite dans un fragment `conf.d` au démarrage. Elle autorise la création
  hors bande d'administrateurs et d'utilisateurs avec l'outil
  `register_new_matrix_user` (l'enregistrement libre en libre-service est
  **désactivé** par défaut). La faire tourner après le premier démarrage invalide tout
  script d'enregistrement qui code en dur l'ancienne valeur.
- **Mot de passe du superutilisateur** — un secret est généré et stocké dans Secret
  Manager (`secret-<prefix>-synapse-superuser-password`) et utilisé par le job
  d'initialisation `create-admin`, qui exécute `register_new_matrix_user` (fourni dans
  l'image Synapse) avec le `registration_shared_secret` pour enregistrer le compte
  administrateur (nom d'utilisateur `admin`). Le job interroge d'abord `/health` et
  tolère une réexécution (« User ID already taken » n'est pas un échec). Il
  **s'ignore lui-même (code de sortie 0) lorsque `internal_service_url` est vide** —
  seul `Synapse_GKE` renseigne cette valeur ; sur Cloud Run, aucun administrateur n'est
  donc enregistré et vous devez créer le premier compte hors bande avec
  `register_new_matrix_user` (en utilisant le `registration_shared_secret` ci-dessus)
  ou en activant temporairement l'enregistrement libre.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`).

**La clé de signature n'est pas un secret Secret Manager — c'est un fichier.** Au
premier démarrage, le point d'entrée cloud génère une clé de signature dans le
répertoire de données (`SYNAPSE_DATA_DIR = /data`). Cette clé constitue l'identité
cryptographique du homeserver :

> La clé de signature **doit persister indéfiniment**. La régénérer casse la fédération
> avec tous les autres homeservers et invalide tout l'état des appareils et des
> sessions. Adossez le répertoire de données à un stockage persistant (le module active
> NFS par défaut) afin que la clé survive aux redémarrages et aux redéploiements. Le
> point d'entrée ne génère une clé que lorsqu'il n'en existe pas déjà une.

Récupérez les secrets Secret Manager après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~synapse"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Synapse nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres moteurs
ne sont pas pris en charge. Synapse exige en outre impérativement que sa base de
données soit créée avec **`LC_COLLATE='C'` et `LC_CTYPE='C'`** — il refuse de démarrer
avec toute autre collation (`Database has incorrect values for … collation`). Le job
générique `db-create` du socle ne définit pas cela ; `Synapse_Common` fournit donc un
job `db-init` dédié qui exécute `postgres:15-alpine` et, de façon idempotente :

1. Attend que PostgreSQL soit joignable via le Cloud SQL Auth Proxy,
2. Crée le rôle de l'application (ou met à jour son mot de passe),
3. Crée la base de données de l'application avec `ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C'
   TEMPLATE template0`, appartenant au rôle de l'application — en recréant une base
   vide à la mauvaise collation si le socle en a créé une auparavant (aucune perte de
   données sur une base vide),
4. Accorde tous les privilèges sur la base de données au rôle de l'application,
5. Signale au Cloud SQL Auth Proxy de s'arrêter proprement pour que le Job se termine.

**Il n'y a pas de job de migration.** Contrairement aux applications de type Django,
Synapse crée et met à niveau son propre schéma automatiquement à chaque démarrage —
`db-init` se contente de préparer la base de données en collation C et le rôle.
Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
# Verify the collation:
#   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée enveloppe `matrixdotorg/synapse:<version>` avec un point d'entrée
shell léger (`entrypoint.sh`) qui s'exécute avant le démarrage de Synapse. Synapse est
configuré par un fichier YAML et une clé de signature — **et non** par des variables
d'environnement — si bien qu'au premier démarrage, le point d'entrée :

- **Génère une seule fois la configuration de base et la clé de signature** — exécute
  `python3 -m synapse.app.homeserver --generate-config` dans `SYNAPSE_DATA_DIR`, en se
  fondant sur le fichier de clé de signature pour qu'il ne soit jamais régénéré lors
  des démarrages suivants.
- **Remplace la section base de données** — la configuration générée par Synapse
  utilise SQLite par défaut ; le point d'entrée écrit un fragment
  `conf.d/00-cloud.yaml` qui pointe `psycopg2` vers le PostgreSQL de la plateforme, en
  résolvant l'hôte selon la règle socket ou TCP de Cloud SQL (répertoire de socket Unix
  sur Cloud Run avec `sslmode=disable` ; `127.0.0.1` via le sidecar Auth Proxy sur
  GKE ; le TCP via IP privée se rabat sur `sslmode=require`).
- **Configure l'écouteur HTTP** — se lie à `0.0.0.0:8008` avec les ressources
  `client` et `federation`, définit `public_baseurl` à partir de l'URL du service
  injectée et écrit le fragment `registration_shared_secret`.
- **Lance Synapse** — `python3 -m synapse.app.homeserver -c homeserver.yaml -c conf.d`,
  en fusionnant la configuration générée avec les surcharges cloud (la dernière
  l'emporte).

L'image est construite avec un ARG de build propre à l'application, `SYNAPSE_VERSION`
(qui prend par défaut la version fixée `v1.119.0` lorsque
`application_version = "latest"`), de sorte que l'`APP_VERSION` générique injecté par
le socle ne puisse pas imposer un tag d'image de base `latest` invalide.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Synapse_Common` établit l'environnement de référence de Synapse afin que le
homeserver démarre correctement dès le premier démarrage :

- **`SYNAPSE_SERVER_NAME`** — le `server_name` Matrix, le domaine intégré à chaque
  identifiant utilisateur (`@user:server_name`) et à la fédération. Il prend par défaut
  une valeur provisoire (`matrix.local`). Il est **IMMUABLE après le premier
  démarrage** — le modifier invalide tous les identifiants utilisateur, les sessions
  des appareils et la fédération. Remplacez-le par votre vrai domaine **avant** de
  passer en production.
- **`SYNAPSE_PORT = "8008"`** — le port de l'écouteur HTTP. C'est une simple variable
  d'environnement (Synapse écoute sur un port défini dans le fichier de configuration,
  pas sur `$PORT`) ; il n'y a donc pas de conflit avec le port réservé de Cloud Run.
- **`SYNAPSE_DATA_DIR = "/data"`** — l'emplacement de `homeserver.yaml`, des
  surcharges `conf.d` et de la clé de signature. Doit se trouver sur un stockage
  persistant (voir §2).
- **`SYNAPSE_REPORT_STATS = "no"`** — désactive l'envoi de statistiques d'utilisation
  anonymes.
- **Enregistrement** — l'enregistrement libre en libre-service est désactivé par
  défaut ; les utilisateurs sont créés hors bande avec `register_new_matrix_user` à
  l'aide du secret partagé.

Redis n'est volontairement **pas** utilisé — Synapse s'exécute comme un seul processus
principal ; aucun `REDIS_URL` n'est donc injecté.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage, de vivacité et de disponibilité par défaut ciblent
**`/health`** — un point de terminaison sans authentification qui renvoie un simple
`200 OK` dès que Synapse écoute. Comme Synapse exécute ses propres migrations de schéma
au démarrage, le premier démarrage peut prendre un peu plus de temps qu'un redémarrage
en régime établi ; la sonde de démarrage laisse donc une fenêtre généreuse.

- **Cloud Run / GKE** utilisent des sondes HTTP sur `/health` au port `8008`. Le
  chemin de la sonde doit rester sur ce point de terminaison public et sans
  authentification — le pointer vers un chemin d'API Matrix authentifié renverrait
  401/403, et la révision ou le pod ne deviendrait jamais Ready, même si le homeserver
  a démarré correctement.
- La sonde de version de l'API client Matrix **`GET /_matrix/client/versions`** (qui
  renvoie au format JSON les versions de la spécification prises en charge) constitue
  un bon contrôle de disponibilité après déploiement, qui confirme que l'API client
  complète — et pas seulement l'écouteur de santé — répond.

Les valeurs par défaut des variables `startup_probe`/`liveness_probe` de
`Synapse_Common` lui-même ciblent `/health` (la sonde de disponibilité, codée en dur
dans `Synapse_Common`, le fait toujours). `Synapse_CloudRun` et `Synapse_GKE`
surchargent actuellement tous deux le chemin des sondes de démarrage et de vivacité
par un simple `/` dans leur propre `variables.tf` — vérifiez le chemin de sonde
réellement appliqué à la révision déployée (`gcloud run revisions describe` /
`kubectl get pod -o yaml`) avant de supposer que `/health` est celui qui est actif.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de travail. Le
dépôt de médias de Synapse (fichiers téléversés, avatars, miniatures) est stocké dans
le répertoire de données persistant ; le bucket est disponible pour les sauvegardes et
le stockage auxiliaire. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Synapse exposée aux utilisateurs (variables par groupe,
outputs, et comment explorer chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[Synapse_GKE](Synapse_GKE.md)** et
**[Synapse_CloudRun](Synapse_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Synapse sur Google Cloud Run](Synapse_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Synapse sur GKE Autopilot](Synapse_GKE.md) — cette configuration déployée sur GKE.
