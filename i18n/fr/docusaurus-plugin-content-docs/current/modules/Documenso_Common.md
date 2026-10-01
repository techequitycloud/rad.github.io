---
title: "Documenso Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Documenso — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Documenso_Common.md @ 3055034 sha256:475e785d8129 -->

# Documenso Common — Configuration applicative partagée {#documenso-common--shared-application-configuration}

`Documenso_Common` est la **couche applicative partagée** de Documenso. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Documenso sur laquelle
s'appuient à la fois [Documenso_GKE](Documenso_GKE.md) et
[Documenso_CloudRun](Documenso_CloudRun.md), afin que les deux variantes de plateforme
se comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Documenso, consultez les
guides de plateforme ([Documenso_GKE](Documenso_GKE.md),
[Documenso_CloudRun](Documenso_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Documenso_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY` et `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` (chacun une chaîne aléatoire de 40 caractères), ainsi que — uniquement lorsque `smtp_host` est défini — `NEXT_PRIVATE_SMTP_PASSWORD`, et une paire de clés d'accès/secrète HMAC pour le transport de téléversement S3 facultatif. Tous stockés dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `documenso/documenso` avec un point d'entrée personnalisé (`docker-entrypoint.sh`) ; construite via Cloud Build (Kaniko) | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Déclare `POSTGRES` comme sa propre valeur par défaut de `database_type` ; non imposé par une précondition au moment du plan, ni à ce niveau ni à aucun autre | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée le rôle applicatif et la base de données, définit la propriété et accorde les droits sur le schéma | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `uploads` (CORS activé) et un compte de service de stockage dédié doté d'une paire de clés HMAC | Sorties `storage_buckets` / `storage_sa_email` |
| Paramètres principaux | Définit les valeurs provisoires `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL`, `NEXT_PRIVATE_SIGNING_TRANSPORT=local`, `NEXT_PUBLIC_UPLOAD_TRANSPORT=database` et (lorsque `smtp_host` est défini) les variables d'environnement `NEXT_PRIVATE_SMTP_*` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Déclare des valeurs par défaut pour `startup_probe`/`liveness_probe`, bien que les deux variantes de plateforme fournissent et transmettent plutôt les leurs (voir §6) | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Cinq secrets peuvent être générés automatiquement et stockés dans Secret Manager — les
trois premiers sont inconditionnels, les deux derniers dépendent de la configuration :

- **`NEXTAUTH_SECRET`** — une chaîne alphanumérique aléatoire de 40 caractères
  (`random_password`, `length = 40`, `special = false`). Utilisé par NextAuth.js pour
  signer et chiffrer les jetons de session. L'application Next.js de Documenso valide
  son environnement avec Zod au démarrage et ne démarre pas sans lui. Le faire tourner
  invalide immédiatement toutes les sessions actives et oblige tous les utilisateurs à se
  reconnecter.
- **`NEXT_PRIVATE_ENCRYPTION_KEY`** — une chaîne aléatoire de 40 caractères (bien
  au-delà du minimum documenté de 32 caractères de Documenso). La clé principale utilisée
  pour chiffrer les données sensibles que Documenso stocke dans Postgres. **Ne la
  régénérez jamais sur place** — cela rendrait illisibles les données chiffrées
  auparavant. Ne la faites tourner qu'en promouvant une nouvelle valeur via l'emplacement
  de la clé secondaire ci-dessous.
- **`NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`** — une chaîne aléatoire de 40 caractères,
  réservée à la rotation de `NEXT_PRIVATE_ENCRYPTION_KEY` sans interruption de service.
- **`NEXT_PRIVATE_SMTP_PASSWORD`** — créé uniquement lorsque `var.smtp_host != ""`
  (`count = var.smtp_host != "" ? 1 : 0`). Un mot de passe aléatoire de 32 caractères,
  sauf si un opérateur fournit explicitement `smtp_password`, auquel cas c'est cette
  valeur qui est stockée. Utilisé pour l'authentification SMTP lors de l'envoi des
  e-mails d'invitation et de notification de signature.
- **`S3_ACCESS_KEY`** / **`S3_SECRET_KEY`** — une paire de clés HMAC
  (`google_storage_hmac_key`) émise sur un compte de service dédié
  (`documenso_storage`, ID de compte `dc-store-<deployment_id_suffix>`). Provisionnée
  inconditionnellement, mais utilisée par l'application uniquement si un opérateur choisit
  le transport de téléversement compatible S3 (voir §7).

Un utilitaire exécuté lors de la destruction, `cleanup_orphaned_secrets`, suit les six
ID de secret possibles (y compris celui, conditionnel, du SMTP) afin que les entrées
Secret Manager obsolètes soient supprimées même si `smtp_host` change d'un déploiement à
l'autre.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~nextauth-secret OR name~encryption-key OR name~encryption-secondary-key OR name~smtp-password OR name~s3-access-key OR name~s3-secret-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

La propre variable `database_type` de `Documenso_Common` vaut par défaut `"POSTGRES"`,
mais ni ce module ni aucune des deux variantes de plateforme ne l'impose par une
précondition au moment du plan — `Documenso_CloudRun` comme `Documenso_GKE` remplacent
cette valeur par défaut par `"POSTGRES_15"` dans leur propre `variables.tf`, si bien
qu'un nouveau déploiement de l'une ou l'autre application demande Postgres 15 par
défaut ; mais passer `database_type` à MySQL ou SQL Server franchit `tofu plan` sans
erreur et ne casse l'application qu'à l'exécution — le schéma Prisma de Documenso et
l'assemblage de l'URL `postgresql://` par le point d'entrée supposent tous deux Postgres.

Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`postgres:15-alpine` (`scripts/documenso/db-init.sh`) et, de façon idempotente :

1. Installe `curl` s'il est absent (au mieux, sans être bloquant),
2. Si `DB_SSL=false` et que `DB_HOST` n'est pas déjà un chemin de socket Unix, force
   `DB_HOST=127.0.0.1` et supprime `DB_IP` — faisant passer le job par le sidecar
   Cloud SQL Auth Proxy plutôt que par une IP directe,
3. Attend que PostgreSQL accepte les connexions, en s'authentifiant en tant que
   superutilisateur `postgres` via la variable d'environnement secrète `ROOT_PASSWORD`,
4. Crée le rôle applicatif (`DB_USER`) s'il n'existe pas, ou met à jour son mot de passe
   s'il existe ; lui accorde `CREATEDB`, accorde le rôle à `postgres` et lui accorde tous
   les privilèges sur la base de données `postgres`,
5. Crée la base de données applicative (`DB_NAME`) appartenant à `DB_USER` si elle
   n'existe pas, ou en réattribue la propriété à `DB_USER` si elle existe,
6. Accorde à `DB_USER` tous les privilèges sur `DB_NAME` et sur son schéma `public`,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (`POST
   http://localhost:9091/quitquitquit`, avec nouvelles tentatives pendant 60 secondes au
   maximum) afin que le job puisse se terminer.

Le job peut être relancé sans risque (`execute_on_apply = true`, `max_retries = 3`,
`timeout_seconds = 600`). Contrairement au `db-init` d'Activepieces, ce job
n'installe **aucune** extension Postgres — `enable_postgres_extensions` vaut `false` par
défaut, car le schéma Prisma de Documenso n'en a besoin d'aucune — et il n'exécute
**pas** les migrations de schéma ; celles-ci ont lieu à chaque démarrage du conteneur
(voir §4).

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée (`scripts/documenso/Dockerfile`) est `FROM
docker.io/documenso/documenso:${DOCUMENSO_VERSION}` (l'argument de build propre à
l'application `DOCUMENSO_VERSION`, défini à partir d'`application_version` — jamais la
variable générique `APP_VERSION` injectée par le socle, qui l'emporterait sinon lors de
la fusion et imposerait `latest`). En tant que `root`, elle installe `bash`, `curl`,
`postgresql-client` (pour `pg_isready`) et `openssl` (pour le certificat autosigné de
repli décrit ci-dessous) via `apk` ou `apt-get` selon le gestionnaire de paquets de
l'image de base, copie `docker-entrypoint.sh` en tant que `ENTRYPOINT`, et conserve le
`CMD ["sh", "start.sh"]` et le `WORKDIR /app/apps/remix` propres à l'image amont — ce qui
signifie que **les migrations Prisma s'exécutent toujours dans le script de démarrage
propre à l'image officielle**, et non dans ce point d'entrée.

`docker-entrypoint.sh` s'exécute avant `start.sh` et se charge de :

- **Assembler `NEXT_PRIVATE_DATABASE_URL`.** Documenso (Next.js + Prisma) a besoin d'une
  chaîne de connexion PostgreSQL complète, mais la plateforme n'injecte que les valeurs
  distinctes `DB_USER`/`DB_PASSWORD`/`DB_HOST`/`DB_NAME`/`DB_PORT`. Le point d'entrée
  encode l'utilisateur et le mot de passe pour l'URL (via `node -e`, en se rabattant sur
  la valeur brute si Node n'est pas disponible) et bifurque selon la forme de `DB_HOST` :
  - `DB_HOST` commence par `/` (un répertoire de socket Unix) → `postgresql://user:pass@localhost/db?host=<socket_dir>&sslmode=disable`.
  - `DB_SSL=false`, ou `DB_HOST` vaut `127.0.0.1`/`localhost` (le cas du sidecar Auth
    Proxy sur GKE) → `postgresql://user:pass@127.0.0.1:<port>/db?sslmode=disable`.
  - Sinon (une connexion directe à l'IP privée Cloud SQL, sans proxy) → utilise `DB_IP`
    (en se rabattant sur `DB_HOST`) avec `sslmode=require`, car une instance Cloud SQL
    sans Auth Proxy rejette les connexions en clair.

  Si `NEXT_PRIVATE_DATABASE_URL` est déjà définie, cette étape est ignorée.
  `NEXT_PRIVATE_DIRECT_DATABASE_URL` (que Documenso lit également, pour les migrations)
  reçoit la même valeur si elle n'est pas définie.

  **C'est ici que l'écart de valeur par défaut de la variante CloudRun a de
  l'importance :** la propre variable `enable_cloudsql_volume` de `Documenso_Common` vaut
  `true` par défaut, ce qui correspond à la première branche (chemin de socket) du point
  d'entrée. Cependant, `Documenso_CloudRun` remplace cette valeur par défaut par
  **`false`** dans son propre `variables.tf`. Avec la valeur par défaut inchangée sur
  Cloud Run, `DB_HOST` n'est **pas** un chemin de socket ; le point d'entrée bascule donc
  dans la branche IP directe `sslmode=require` (ou dans la branche de boucle locale si
  `DB_SSL=false` est également défini) plutôt que dans le chemin par socket Unix pour
  lequel ce point d'entrée a principalement été écrit. `Documenso_GKE`, en revanche,
  conserve `enable_cloudsql_volume = true`, si bien que les déploiements GKE passent
  systématiquement par la branche de boucle locale (`127.0.0.1`) via le sidecar
  cloud-sql-proxy. Les opérateurs qui s'appuient sur le chemin de connexion par socket
  sur Cloud Run doivent définir explicitement `enable_cloudsql_volume =
  true`.

- **Résoudre l'URL publique.** Si `NEXT_PUBLIC_WEBAPP_URL` a toujours sa valeur par défaut
  `http://localhost:3000` (ou est vide) au démarrage du conteneur, le point d'entrée
  remplace `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` par celle des variables
  `CLOUDRUN_SERVICE_URL` (Cloud Run) ou `GKE_SERVICE_URL` (GKE) qui est présente.
  `NEXT_PRIVATE_INTERNAL_WEBAPP_URL` (utilisée par les jobs en arrière-plan) reçoit par
  défaut la même valeur résolue si elle n'est pas définie.
- **Provisionner un certificat de signature.** Lorsque
  `NEXT_PRIVATE_SIGNING_TRANSPORT=local` (la valeur par défaut), le point d'entrée
  matérialise d'abord un `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` encodé en base64 (s'il
  est fourni) dans `/opt/documenso/cert.p12`. Si aucun certificat n'est fourni et
  qu'`openssl` est disponible, il génère lui-même un `.p12` RSA-2048 autosigné jetable
  (validité de 365 jours, phrase secrète par défaut `"documenso"`) afin que l'application
  démarre quand même — en journalisant un avertissement bien visible indiquant que le
  certificat n'est **pas adapté à la production** et doit être remplacé pour une
  véritable signature de documents.
- **Attendre PostgreSQL.** Interroge `pg_isready` sur la `NEXT_PRIVATE_DATABASE_URL`
  assemblée jusqu'à 60 fois (à 3s d'intervalle, environ 3 minutes), et se termine avec le
  code `1` en cas d'expiration du délai.
- **Passer la main à la commande amont.** `exec "$@"` — qui exécute le `sh start.sh` de
  l'image officielle, l'étape qui exécute réellement les migrations Prisma et lance le
  serveur Next.js autonome.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Documenso_Common` établit l'environnement de base de Documenso
(`local.environment_variables`) afin que l'application démarre correctement dès le
premier lancement :

- **`NEXTAUTH_URL`** / **`NEXT_PUBLIC_WEBAPP_URL`** — définies à `var.webapp_url` si elle
  est fournie, sinon à `"http://localhost:3000"`, valeur provisoire que le point d'entrée
  corrige à l'exécution (voir §4).
- **`NEXT_PRIVATE_SIGNING_TRANSPORT = "local"`** — Documenso signe les documents avec un
  certificat `.p12`/`.pfx` fourni localement plutôt qu'avec un service de signature distant.
- **`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`** — les documents sont stockés par défaut
  sous forme de blobs dans PostgreSQL ; aucune écriture dans un bucket n'est nécessaire au
  fonctionnement de l'application (voir §7 pour l'alternative S3).
- **Bloc SMTP conditionnel** — injecté uniquement lorsque `var.smtp_host != ""` :
  `NEXT_PRIVATE_SMTP_TRANSPORT = "smtp-auth"`, `NEXT_PRIVATE_SMTP_HOST`,
  `NEXT_PRIVATE_SMTP_PORT` (converti en chaîne), `NEXT_PRIVATE_SMTP_USERNAME`,
  `NEXT_PRIVATE_SMTP_SECURE` (`"true"`/`"false"` d'après `smtp_secure_enabled`),
  `NEXT_PRIVATE_SMTP_FROM_ADDRESS` (se rabat sur `noreply@documenso.local` si `mail_from`
  est vide) et `NEXT_PRIVATE_SMTP_FROM_NAME = "Documenso"`. Le **mot de passe** SMTP
  lui-même est fourni séparément sous forme de variable d'environnement secrète
  (`NEXT_PRIVATE_SMTP_PASSWORD`, §2), et n'est pas inscrit ici en clair.
- **`var.environment_variables`** est fusionnée en dernier, de sorte que les opérateurs
  ou le module Application appelant peuvent ajouter ou remplacer n'importe laquelle des
  valeurs ci-dessus.

Les ajustements propres à chaque plateforme ne sont **pas** effectués dans
`Documenso_Common` lui-même — le module ne contient aucune logique conditionnelle
CloudRun/GKE en dehors de la branche `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` du point
d'entrée (§4). Toutes les autres valeurs par défaut propres à une plateforme
(dimensionnement CPU/mémoire, `min`/`max_instance_count`, `enable_cloudsql_volume`,
temporisation des sondes) sont déclarées indépendamment dans le propre `variables.tf` de
chaque module Application et simplement transmises à cette couche comme entrée, puis
renvoyées telles quelles dans la sortie `config`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`Documenso_Common` déclare ses propres variables `startup_probe` et `liveness_probe` avec
les valeurs par défaut de base suivantes :

- `startup_probe` : `enabled = true`, `type = "TCP"`, `path = "/"`,
  `initial_delay_seconds = 30`, `timeout_seconds = 10`,
  `period_seconds = 15`, `failure_threshold = 20`.
- `liveness_probe` : `enabled = false`, `path = "/"`,
  `initial_delay_seconds = 60`, `timeout_seconds = 5`,
  `period_seconds = 30`, `failure_threshold = 3`.

En pratique, cependant, **les deux variantes de plateforme redéclarent ces mêmes
variables avec leurs propres valeurs par défaut adaptées à la plateforme** et les
transmettent directement aux entrées de ce module (`main.tf` : `startup_probe = var.startup_probe`,
`liveness_probe = var.liveness_probe`), si bien que les valeurs qui parviennent réellement
au socle sont celles du module App, et non ces valeurs par défaut de base :

- **Cloud Run** (`Documenso_CloudRun`) utilise une sonde de démarrage **TCP** sur le port
  3000 (`initial_delay_seconds = 30`, `failure_threshold = 10`) et désactive entièrement
  la sonde de vivacité — Documenso n'a pas de point de terminaison de santé dédié, et une
  sonde HTTP sur `/` risque d'échouer avant que l'application et la base de données soient
  toutes deux prêtes.
- **GKE** (`Documenso_GKE`) utilise une sonde de démarrage **HTTP** `GET /` avec une marge
  bien plus longue (`period_seconds = 30`, `failure_threshold = 20`, soit environ 10
  minutes au total) pour absorber le démarrage à froid et les migrations Prisma du premier
  démarrage, ainsi qu'une sonde de vivacité **HTTP** `GET /` (`initial_delay_seconds = 60`,
  `failure_threshold = 3`).

Comme Documenso ne dispose d'aucun point de terminaison dédié de type `/health`, aucune de
ces sondes ne cible quoi que ce soit de plus précis que le chemin racine ou une simple
vérification du port.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `uploads`, classe `STANDARD`,
`force_destroy = true`, accès uniforme au niveau du bucket, CORS activé pour
`GET`/`PUT`/`POST`/`DELETE`/`HEAD` depuis n'importe quelle origine) est déclaré ici et
provisionné par le socle. Un compte de service associé (`documenso_storage`, ID de compte
`dc-store-<deployment_id_suffix>`) détient une paire de clés HMAC (`S3_ACCESS_KEY` /
`S3_SECRET_KEY`, §2) et reçoit `roles/storage.objectAdmin` sur le bucket de la part du
module Application appelant.

Ce bucket est une **infrastructure à activer explicitement** : Documenso stocke les
documents dans PostgreSQL par défaut (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`, §5) et
n'écrit jamais dans le bucket, sauf si un opérateur définit explicitement
`NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` et câble les variables d'environnement secrètes
`S3_ACCESS_KEY`/`S3_SECRET_KEY` dans le service en cours d'exécution. D'ici là, le bucket
et sa clé HMAC existent mais restent inutilisés.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
```

---

Pour la configuration propre à Documenso exposée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Documenso_GKE](Documenso_GKE.md)** et
**[Documenso_CloudRun](Documenso_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Documenso sur Google Cloud Run](Documenso_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Documenso sur GKE Autopilot](Documenso_GKE.md) — cette configuration déployée sur GKE.
