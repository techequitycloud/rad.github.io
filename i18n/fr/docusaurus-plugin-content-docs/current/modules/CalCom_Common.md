---
title: "CalCom Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module CalCom — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/CalCom_Common.md @ 3055034 sha256:41bfb12e970b -->

# CalCom Common — Configuration applicative partagée {#calcom-common--shared-application-configuration}

`CalCom_Common` est la **couche applicative partagée** de Cal.com. Elle n'est pas déployée
seule ; elle fournit la configuration propre à Cal.com sur laquelle s'appuient
[CalCom_GKE](CalCom_GKE.md) et [CalCom_CloudRun](CalCom_CloudRun.md), afin que
les deux variantes de plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Cal.com est une plateforme de planification open source sous licence AGPL (l'alternative
auto-hébergée à Calendly), construite avec **Next.js** et **Prisma** sur **PostgreSQL**. Pour
l'infrastructure qui provisionne et exécute réellement Cal.com, consultez les guides
de plateforme ([CalCom_GKE](CalCom_GKE.md), [CalCom_CloudRun](CalCom_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par CalCom_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` (chacun étant une chaîne aléatoire de 32 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes du conteneur ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe l'image officielle `calcom/cal.com` avec un point d'entrée personnalisé léger ; build via Cloud Build | Output `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** (`POSTGRES_15`) comme base de données | §Base de données dans les guides de plateforme |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée le rôle, la base de données et les droits | Output `initialization_jobs` |
| Migrations de schéma | Délègue la création du schéma au script de démarrage propre à l'image, qui exécute `prisma migrate deploy` à chaque démarrage | Comportement de l'application dans les guides de plateforme |
| Paramètres essentiels | Assemble `DATABASE_URL`/`DATABASE_DIRECT_URL` à l'exécution et définit par défaut `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL` sur l'URL publique du service | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/` | §Observabilité dans les guides de plateforme |

Cal.com stocke toutes les données applicatives — utilisateurs, types d'événements, réservations et identifiants
de calendrier/OAuth connectés — dans PostgreSQL ; **aucun bucket GCS de téléversement dédié n'est donc
déclaré** (`storage_buckets` est vide).

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en clair et ne doivent jamais être modifiés après le premier déploiement :

- **`CALENDSO_ENCRYPTION_KEY`** — une chaîne aléatoire de 32 caractères. Cal.com l'utilise pour
  chiffrer les données sensibles stockées, en particulier les jetons OAuth et les clés d'API des
  calendriers connectés et des intégrations d'applications. Sa rotation après le premier démarrage rend indéchiffrables tous
  les identifiants chiffrés auparavant — chaque connexion de calendrier et
  intégration doit être réautorisée.
- **`NEXTAUTH_SECRET`** — une chaîne aléatoire de 32 caractères. Utilisée par NextAuth.js pour signer
  et chiffrer les jetons de session/JWT. Sa rotation invalide immédiatement toutes les sessions
  actives et oblige chaque utilisateur à se reconnecter.

Tous deux sont consommés comme **variables d'environnement secrètes du conteneur** via l'output `secret_ids` (que
la variante raccorde à `module_secret_env_vars`).

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~nextauth-secret OR name~encryption-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les outputs du déploiement de plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

Cal.com nécessite **PostgreSQL** (Prisma avec le client `pg`) ; cette couche fixe le
moteur sur **Cloud SQL pour PostgreSQL 15**. Lors du premier déploiement, un job ponctuel
(`db-init`) s'exécute à l'aide de `postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte de la base de données — en privilégiant `DB_IP`, ou `127.0.0.1` lorsque le sidecar Cloud SQL
   Auth Proxy est utilisé (loopback sans SSL),
2. Attend que PostgreSQL soit joignable,
3. Crée le rôle de l'application (ou en met à jour le mot de passe) avec `LOGIN` et
   `CREATEDB`,
4. Crée la base de données de l'application (ou en réattribue le propriétaire),
5. Accorde tous les privilèges sur la base de données et le schéma `public` (PG15+),
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement (`POST /quitquitquit`).

Le job ne provisionne que le rôle et la base de données vide ; **le schéma applicatif lui-même
est créé par la commande `prisma migrate deploy` propre à Cal.com**, que le script de démarrage de l'image
exécute à chaque démarrage du conteneur (voir §4). Les deux étapes sont idempotentes et peuvent être relancées sans risque.

Le provisionnement d'extensions (`enable_postgres_extensions`) est disponible mais **désactivé par
défaut** — le schéma de base de Cal.com ne nécessite aucune extension réservée au superutilisateur.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les outputs du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une **enveloppe légère** autour de l'image officielle `calcom/cal.com:<version>`.
Le tag de base est déterminé par un ARG de build propre à l'application, **`CALCOM_VERSION`** —
*et non* par l'`APP_VERSION` générique que le socle injecte et qui l'écraserait sinon
avec `latest`. L'enveloppe ajoute `curl`/`bash`/`psql` dans la mesure du possible et installe un
petit point d'entrée shell (`docker-entrypoint.sh`) qui s'exécute avant le script de démarrage
propre à l'image :

- **Assemble `DATABASE_URL` / `DATABASE_DIRECT_URL`** — construit la chaîne de connexion
  Prisma à partir des variables `DB_*` injectées par la plateforme, selon la façon dont Cloud SQL est
  fourni :
  - un chemin de répertoire de socket (`/cloudsql/...`, intégration native de Cloud Run) → libpq
    `?host=<socket>&sslmode=disable`,
  - `127.0.0.1`/`localhost` (sidecar Auth Proxy sur GKE) → loopback, `sslmode=disable`,
  - une véritable IP privée → `sslmode=require`.
  Le nom d'utilisateur et le mot de passe sont encodés pour URL (via `node`).
- **Définit par défaut `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`** — lorsqu'elles sont encore à la valeur
  par défaut de l'image (`http://localhost:3000`), les remplace toutes deux par l'URL du service
  injectée par la plateforme (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`), afin que les callbacks NextAuth et
  la base de la SPA utilisent toujours la véritable adresse publique.
- **Exécute le script de démarrage de l'image** (`/calcom/scripts/start.sh` via `CMD`), qui
  exécute `prisma migrate deploy` puis démarre le serveur Next.js sur le port
  `${PORT:-3000}`.

`PORT` est une variable d'environnement réservée de Cloud Run (la plateforme l'injecte automatiquement) ; la
couche ne la définit donc jamais explicitement.

---

## 5. Paramètres applicatifs essentiels et gestion des URL {#5-core-application-settings-and-url-handling}

Cal.com **valide son URL publique au démarrage** et refuse de démarrer avec la valeur par défaut de l'image,
`http://localhost:3000` (« Invalid environment variables » → le serveur renvoie 500
et ne passe jamais à l'état Ready). Pour l'éviter, le module (via `webapp_url`) et le
point d'entrée définissent tous deux par défaut `NEXT_PUBLIC_WEBAPP_URL` et `NEXTAUTH_URL` sur l'URL
publique déterministe du service :

- **Cloud Run** — la variante calcule l'URL `run.app` prévue
  (`https://<service>-<projnum>.<region>.run.app`) au moment du plan et la transmet comme
  `webapp_url`. Cloud Run n'interpole pas `$(CLOUDRUN_SERVICE_URL)` dans la valeur d'une
  variable d'environnement ; une chaîne calculée est donc nécessaire ; le point d'entrée la corrige en outre à
  l'exécution à partir de la variable `CLOUDRUN_SERVICE_URL` injectée.
- **GKE** — le point d'entrée définit les URL à partir de `GKE_SERVICE_URL` à l'exécution. Définissez
  `webapp_url` sur l'adresse du LoadBalancer externe ou sur un domaine personnalisé dès qu'elle est connue.

Fixez `webapp_url` sur un domaine personnalisé (p. ex. `https://scheduling.example.com`) avant de
partager des liens de réservation — la valeur est intégrée à chaque URL de réservation/OAuth générée.

Redis est **facultatif et désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, il
sert de backend de cache / de limitation de débit à Cal.com ; si aucun `redis_host` n'est défini, le module
utilise l'IP de la VM du serveur NFS (ce qui nécessite `enable_nfs = true`).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut sont en **HTTP GET `/`** — le front-end Next.js de Cal.com
y répond une fois que le serveur a démarré et s'est connecté à PostgreSQL. La
sonde de démarrage utilise une fenêtre généreuse (délai initial de 30 secondes, période de 15 secondes, jusqu'à
30 échecs — environ 8 minutes) pour absorber le `prisma migrate deploy` du premier démarrage,
qui peut prendre plusieurs minutes sur une instance Cloud SQL fraîchement créée.

---

## 7. Stockage d'objets {#7-object-storage}

Cal.com conserve tout son état dans PostgreSQL et ne nécessite aucun bucket de téléversement dédié ;
**`CalCom_Common` ne déclare donc aucun bucket GCS** (`storage_buckets` est vide). `enable_nfs`
vaut `true` par défaut afin de fournir un volume persistant partagé facultatif (et d'héberger
le Redis colocalisé lorsqu'il est activé) ; il n'est pas nécessaire aux fonctionnalités de planification essentielles.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Cal.com destinée aux utilisateurs (variables par groupe, outputs et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[CalCom_GKE](CalCom_GKE.md)** et **[CalCom_CloudRun](CalCom_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Cal.com sur Google Cloud Run](CalCom_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Cal.com sur GKE Autopilot](CalCom_GKE.md) — cette configuration déployée sur GKE.
