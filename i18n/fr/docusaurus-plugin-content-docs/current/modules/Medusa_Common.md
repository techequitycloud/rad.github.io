---
title: "Medusa Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Medusa — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Medusa_Common.md @ 3055034 sha256:bc4f6dcaa949 -->

# Medusa Common — Configuration applicative partagée {#medusa-common--shared-application-configuration}

`Medusa_Common` est la **couche applicative partagée** de Medusa. Elle n'est pas déployée
seule ; elle fournit la configuration propre à Medusa sur laquelle s'appuient à la fois
[Medusa_GKE](Medusa_GKE.md) et [Medusa_CloudRun](Medusa_CloudRun.md), afin que
les deux variantes de plateforme se comportent de manière identique là où cela compte.
Comme Medusa n'a **aucune image Docker officielle**, cette couche porte aussi la recette
de build à partir des sources — une responsabilité que la plupart des modules `*_Common`
de ce catalogue n'assument pas, puisqu'ils encapsulent généralement une image amont
préconstruite. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Medusa, consultez les guides
de plateforme ([Medusa_GKE](Medusa_GKE.md), [Medusa_CloudRun](Medusa_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Medusa_Common | Où cela apparaît |
|---|---|---|
| Build d'image à partir des sources | Porte le Dockerfile multi-étapes qui clone `medusajs/dtc-starter` et exécute `medusa build` — il n'existe aucune image amont à encapsuler | Sortie `container_image` ; `container_build_config` |
| Secrets cryptographiques | Génère `JWT_SECRET`, `COOKIE_SECRET` (tous deux obligatoires en production) et un mot de passe administrateur initial, tous dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données + chaîne d'initialisation en 4 étapes | Définit `db-init` → `medusa-migrate` → `medusa-verify` → `medusa-admin-create`, chacune dépendant de la précédente | Sortie `initialization_jobs` |
| Stockage d'objets (facultatif) | Lorsque `enable_gcs_storage = true`, provisionne un bucket GCS **ainsi qu'**un compte de service dédié et une clé HMAC générée automatiquement pour le fournisseur de fichiers compatible S3 de Medusa | Sorties `storage_buckets` / `storage_sa_email` |
| Paramètres principaux | Définit `MEDUSA_WORKER_MODE = "shared"`, `STORAGE_PROVIDER` et, selon les cas, `REDIS_URL` / `S3_*` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage et de vivacité par défaut ciblant `/health` | §Observabilité dans les guides de plateforme |

---

## 2. Le build à partir des sources {#2-the-from-source-build}

Medusa ne publie aucune image Docker officielle. `Medusa_Common` définit `image_source =
"custom"` et oriente Cloud Build vers un Dockerfile situé dans `scripts/` avec l'argument de build
`MEDUSA_STARTER_REF = "main"` — la branche du modèle de monorepo `medusajs/dtc-starter`
à cloner. Seul `apps/backend` (le serveur Medusa + l'Admin UI intégrée, même
processus et même port) est construit ; `apps/storefront`, une application storefront Next.js séparée,
est explicitement hors du périmètre de ce module.

Le build est un Dockerfile en deux étapes :

1. **Builder** (`node:20-alpine` + git/python3/make/g++ + `pnpm@10`) : clone
   `dtc-starter` à `$MEDUSA_STARTER_REF`, exécute `pnpm install --frozen-lockfile` à la
   racine du monorepo, puis `pnpm build` dans `apps/backend`. Cela produit une
   application autonome **autosuffisante** dans `.medusa/server`, avec son propre
   `package.json`.
2. `.medusa/server` est copié dans `/server-build` — un répertoire neuf sans
   `pnpm-workspace.yaml` ancêtre — avant que `pnpm install --prod` y soit exécuté.
3. **Runtime** (`node:20-alpine`, `NODE_ENV=production`) : copie la sortie de build
   installée et `entrypoint.sh`, et expose le port 9000.

### Pourquoi l'étape de copie vers `/server-build` existe {#why-the-copy-to-server-build-step-exists}

`.medusa/server` est produit *à l'intérieur* de `/build`, qui — étant la racine du
monorepo cloné — est lui-même une racine d'espace de travail pnpm (il contient un
`pnpm-workspace.yaml`). pnpm détecte automatiquement les racines d'espace de travail en
remontant l'arborescence des répertoires, si bien qu'un `pnpm install --prod` naïf exécuté
directement dans `.medusa/server` alors qu'il est encore imbriqué sous `/build` traite
silencieusement la sortie de build autonome comme une partie de l'espace de travail
*englobant* (les journaux de build affichent `"Scope: all 3
workspace projects"` et une invite « reinstall from scratch? » à réponse automatique) et
n'écrit **aucun `node_modules`**. L'image d'exécution obtenue ne contenait aucun
`node_modules` ni de binaire CLI `medusa` — confirmé localement via `docker run` :
`sh: medusa: not found`. Copier vers un répertoire sans
`pnpm-workspace.yaml` ancêtre force une véritable installation autonome. Ce problème a été
entièrement détecté par des tests Docker locaux avant toute tentative de déploiement dans le
cloud, et constitue une leçon durable pour tout futur Dockerfile à partir des sources construit
sur un monorepo à espace de travail pnpm/npm.

`application_version` ne sélectionne **pas** ce qui est construit — le Dockerfile ne contient
aucun `ARG` qui l'utilise. Seul `MEDUSA_STARTER_REF` (codé en dur à `main`) détermine la
branche clonée, de sorte que chaque build récupère l'état courant de cette branche ; un build
entièrement figé et reproductible nécessite de surcharger `container_build_config.build_args`
avec une étiquette ou un commit précis.

---

## 3. Secrets cryptographiques dans Secret Manager {#3-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager :

- **`JWT_SECRET`** — une chaîne alphanumérique aléatoire de 32 caractères. Obligatoire en
  production ; Medusa lève une erreur au démarrage s'il n'est pas défini.
- **`COOKIE_SECRET`** — une chaîne alphanumérique aléatoire de 32 caractères, tout aussi
  obligatoire que `JWT_SECRET`.
- **Mot de passe administrateur** — une chaîne alphanumérique aléatoire de 20 caractères,
  utilisée directement par le job d'initialisation `medusa-admin-create` (et non injectée
  comme variable d'environnement d'exécution dans le conteneur principal). Récupérez-le avec :

```bash
gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
```

L'ID du secret est exposé via la sortie `admin_password_secret_id` de
`Medusa_Common` (et accessible indirectement via le déploiement de plateforme). Le
mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son
secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé
de secrets et de Workload Identity.

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret OR name~cookie-secret OR name~admin-password"
```

---

## 4. Moteur de base de données et chaîne d'initialisation en quatre étapes {#4-database-engine-and-the-four-stage-initialization-chain}

Medusa nécessite **PostgreSQL 15** ; le moteur est imposé et les autres moteurs ne sont pas
pris en charge. Contrairement aux modules dont l'application migre son propre schéma au démarrage,
les migrations de Medusa sont volontairement tenues à l'écart du chemin de démarrage du conteneur
principal — quatre tâches séquentielles s'exécutent à la place, chacune dépendant de la précédente :

1. **`db-init`** (`postgres:15-alpine`) — attend la base de données, crée le
   rôle applicatif (`LOGIN`, `CREATEDB`) et une base de données appartenant à ce rôle, accorde
   les privilèges sur la base de données et le schéma `public`, et installe, dans la mesure du
   possible, les extensions `uuid-ossp` et `postgis` (`postgis` est ignorée avec un avertissement
   si elle est indisponible). Signale au sidecar Cloud SQL Auth Proxy de s'arrêter une fois
   terminé.
2. **`medusa-migrate`** — exécute `npx medusa db:migrate` directement via la CLI, sur
   l'image Medusa déjà construite (2 vCPU / 2Gi, délai d'expiration de 30 minutes, 3 nouvelles tentatives).
   **Cette tâche exécutait à l'origine `npm run predeploy`**, conformément à la convention
   mentionnée dans la documentation de déploiement de Medusa — mais le `package.json` construit du
   modèle `dtc-starter` ne définit que les scripts `build`, `start`, `dev`, `lint` et `test:*` ;
   il n'existe aucun script `predeploy`. `npm run predeploy` échouait avec `Missing
   script: predeploy`, ce qui n'a pu être découvert que lors d'une véritable exécution Cloud Build + Job
   Cloud Run/GKE (les tests locaux avec de faux identifiants de base de données n'allaient jamais aussi loin).
   Corrigé en invoquant directement la CLI `medusa`.
3. **`medusa-verify`** (`postgres:15-alpine`) — une tâche de garde. Un échec de job
   d'initialisation ne fait **pas** échouer à lui seul l'apply du module dans ce socle, si bien
   qu'une `medusa-migrate` en concurrence ou en échec pourrait sinon laisser un service apparemment
   sain pointer vers une base de données **vide**. `medusa-verify` se connecte après `medusa-migrate`,
   compte les tables du schéma `public` et **fait échouer l'apply** (bruyamment, pas silencieusement)
   s'il n'en trouve aucune. Vérifié en production : `"public schema has 146
   table(s)"` journalisé lors d'un déploiement réussi.
4. **`medusa-admin-create`** — exécute `npx medusa user -e <email> -p <password>` sur
   l'image construite pour créer le premier compte administrateur, à l'aide du secret de mot de
   passe administrateur généré automatiquement et de `var.admin_email` (par défaut `admin@techequity.cloud`).
   Vérifié en conditions réelles : `"User created successfully."` journalisé.

Les quatre peuvent être réexécutées sans risque ; inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 5. `entrypoint.sh` {#5-entrypointsh}

L'`ENTRYPOINT` de l'image d'exécution s'exécute avant que `exec "$@"` ne passe la main à `CMD` (ou
aux `args` d'un job d'initialisation) :

- **Construit `DATABASE_URL`** à partir de `DB_HOST` / `DB_IP` /
  `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` injectés par la plateforme. Un `DB_HOST`
  de type socket Unix (`enable_cloudsql_volume = true`, Cloud Run) se rabat sur TCP via `DB_IP` avec
  `sslmode=require`, car le client Postgres de Medusa a besoin d'un DSN avec autorité d'URL et les
  deux-points d'un chemin de socket cassent l'analyse de l'URL. Sur GKE, un `DB_HOST`
  `127.0.0.1`/`localhost` (le sidecar Cloud SQL Auth Proxy) utilise `sslmode=disable`, car le
  proxy termine déjà le TLS.
- **Construit `REDIS_URL`** à partir de `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` lorsqu'elle n'est
  pas déjà définie par la configuration propre de `Medusa_Common` — c'est le chemin emprunté lorsque
  `redis_host` a été laissé vide et que la plateforme a injecté l'IP de la VM NFS comme
  `REDIS_HOST` à la place.
- **Définit `MEDUSA_BACKEND_URL`** à partir de `CLOUDRUN_SERVICE_URL` (Cloud Run) ou de
  `GKE_SERVICE_URL` (GKE) si elle n'est pas déjà configurée.
- **Définit `MEDUSA_WORKER_MODE=shared`** comme valeur par défaut finale.

---

## 6. Paramètres principaux de l'application {#6-core-application-settings}

- **`MEDUSA_WORKER_MODE = "shared"`** (fixe) — une seule instance traite à la fois les
  requêtes API et les tâches/abonnés/workflows en arrière-plan de Medusa. La topologie
  serveur/worker séparée officiellement recommandée par Medusa ne se transpose pas proprement
  sur un service Cloud Run/GKE unique, de sorte que ce module exécute toujours les deux dans un seul processus.
- **`STORAGE_PROVIDER`** — `"s3"` lorsque `enable_gcs_storage = true`, sinon
  `"local"` (système de fichiers éphémère du conteneur — les fichiers téléversés ne survivent pas
  à un redémarrage ni à un redéploiement).
- **Redis est obligatoire en production.** Medusa journalise `"redisUrl not found. A fake
  redis instance will be used."` et démarre quand même si Redis est injoignable — il s'agit
  d'une solution de repli pour le développement et les tests, pas d'un mode de production pris en
  charge ; aucune dégradation progressive n'est documentée pour un déploiement durable sans Redis.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent `/health` — un point de terminaison sans authentification. La
valeur par défaut au niveau de `Medusa_Common` est un délai initial de 60 secondes avec un seuil
de 20 échecs ; `Medusa_CloudRun` et `Medusa_GKE` la remplacent tous deux par un délai initial
de 120 secondes avec un seuil de 40 échecs (≈12 minutes au total), qui est la valeur par défaut
effective que voient les opérateurs. Vérifié en conditions réelles : `curl /health` renvoie `OK` (200),
et le serveur en cours d'exécution journalise `"Server is ready on port: 9000"`.

---

## 8. Stockage d'objets (facultatif) {#8-object-storage-optional}

Lorsque `enable_gcs_storage = true`, un bucket **Cloud Storage** dédié
(`gcs-<service_name>-storage`, avec CORS activé pour `GET`/`PUT`/`POST`/`DELETE`/`HEAD`)
est déclaré ici et provisionné par le socle. Contrairement à d'autres applications de ce
catalogue, aucune configuration manuelle de secret n'est nécessaire : `Medusa_Common` crée aussi
automatiquement un compte de service dédié et une paire clé d'accès/clé secrète HMAC,
stockées comme secrets `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` et raccordées directement
au conteneur en cours d'exécution. Cette architecture est plausible (API XML d'interopérabilité S3 de GCS
+ `forcePathStyle`) au regard de la forme du fournisseur de stockage de fichiers S3 de Medusa, mais elle
n'a **pas été vérifiée face à un trafic de téléversement Medusa réel** — testez un téléversement de
fichier via l'Admin UI après l'avoir activée.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Medusa destinée aux utilisateurs (variables par groupe, sorties,
et comment explorer chaque service depuis la console et la CLI), consultez les guides de
plateforme : **[Medusa_GKE](Medusa_GKE.md)** et **[Medusa_CloudRun](Medusa_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Medusa sur Google Cloud Run](Medusa_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Medusa sur GKE Autopilot](Medusa_GKE.md) — cette configuration déployée sur GKE.
