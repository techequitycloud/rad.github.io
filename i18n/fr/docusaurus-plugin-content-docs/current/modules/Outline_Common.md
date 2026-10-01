---
title: "Outline Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Outline — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Outline_Common.md @ 3055034 sha256:69920b956486 -->

# Outline Common — Configuration applicative partagée {#outline-common--shared-application-configuration}

`Outline_Common` est la **couche applicative partagée** d'Outline. Elle n'est pas déployée seule ; elle fournit la configuration propre à Outline sur laquelle s'appuient à la fois [Outline_GKE](Outline_GKE.md) et [Outline_CloudRun](Outline_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Outline, consultez les guides des plateformes ([Outline_GKE](Outline_GKE.md), [Outline_CloudRun](Outline_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Outline_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Build personnalisé à partir de `outlinewiki/outline`, qui ajoute `bash`, `postgresql-client`, un yarn 4 épinglé via Corepack et le point d'entrée de la plateforme | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Assemble `DATABASE_URL`, `REDIS_URL` et `URL` à partir des variables injectées par la plateforme, attend PostgreSQL, exécute les migrations Sequelize, puis démarre le serveur | Comportement de l'application dans les guides des plateformes |
| Secrets de l'application | Crée `SECRET_KEY` et `UTILS_SECRET` (64 caractères hexadécimaux chacun) dans **Secret Manager** | Sorties `secret_ids` / `secret_values`, injectées dans le conteneur |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** avec l'extension `pg_trgm` activée | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job `db-init` (`postgres:15-alpine`) qui crée de manière idempotente la base de données et l'utilisateur | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Environnement de base | `FILE_STORAGE=local` sur le chemin NFS, `FORCE_HTTPS=false`, `PGSSLMODE=disable` et des espaces réservés d'authentification `OIDC_*` vides | Environnement du conteneur en cours d'exécution |
| Contrôles de santé | Transmet les valeurs par défaut des sondes de démarrage et de vivacité HTTP `/` des variantes | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Outline nécessite deux secrets aléatoires, générés exactement de la manière recommandée en amont (`openssl rand -hex 32` — 32 octets, 64 caractères hexadécimaux) :

- `secret-<prefix>-<app>-secret-key` → **`SECRET_KEY`** — chiffre les cookies et les données sensibles au repos.
- `secret-<prefix>-<app>-utils-secret` → **`UTILS_SECRET`** — authentification de l'API interne / des utilitaires.

Tous deux sont créés ici et exposés via la sortie `secret_ids`, que les variantes de plateforme fusionnent dans le `module_secret_env_vars` du socle afin que les valeurs soient injectées sous forme de variables d'environnement adossées à des secrets (références de secrets Cloud Run ; Secret Kubernetes matérialisé sur GKE via `secret_values`). Le mot de passe de la base de données est un troisième secret, créé par le socle lui-même.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~outline"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Ces valeurs sont de fait immuables — régénérer `SECRET_KEY` invalide les sessions existantes et les données chiffrées.

---

## 3. Image de conteneur et point d'entrée personnalisé {#3-container-image-and-custom-entrypoint}

`Outline_Common` construit une image personnalisée à partir de l'image officielle `outlinewiki/outline` de Docker Hub via Cloud Build (`image_source = "custom"`). Le Dockerfile installe `bash` et `postgresql-client` (nécessaires au point d'entrée), intègre un **yarn 4** activé par Corepack dans un `COREPACK_HOME` lisible par tous (le yarn 1.x global de l'image de base refuse de s'exécuter dans le projet yarn-4 d'Outline), crée à l'avance le répertoire persistant des téléversements `/var/lib/outline/data` et installe `/scripts/entrypoint.sh` avant de revenir à l'utilisateur non privilégié `nodejs`.

Le point d'entrée effectue ces actions à chaque démarrage du conteneur :

1. **Assemblage de `DATABASE_URL`.** Construit la chaîne de connexion Sequelize à partir de `DB_USER`, `DB_PASSWORD` (encodé pour URL), `DB_HOST`, `DB_NAME` et `DB_PORT` injectés par la plateforme. Lorsque `DB_HOST` commence par `/`, il utilise la forme socket de node-pg (`?host=/cloudsql/…&sslmode=disable` — le socket du Cloud SQL Auth Proxy sur Cloud Run) ; `127.0.0.1` (le sidecar proxy sur GKE) et les formes à IP privée directe sont également gérés. Une `DATABASE_URL` explicite est prioritaire, mais ne devrait jamais être nécessaire.
2. **Assemblage de `REDIS_URL`.** Utilise la `REDIS_URL` injectée par le socle lorsqu'elle est présente ; sinon en construit une à partir de `REDIS_HOST`/`REDIS_PORT`, avec repli sur l'IP du serveur NFS (la plateforme y héberge aussi Redis).
3. **`URL` (adresse publique).** Privilégie une `URL` fournie explicitement ; sinon exporte l'URL du service injectée par la plateforme (`CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL`).
4. **Attente de la base de données.** Interroge `pg_isready` (jusqu'à 60 × 3 s) avant de poursuivre.
5. **Migrations.** Exécute `sequelize db:migrate --env=production-ssl-disabled` en appelant directement le binaire sequelize-cli (la vérification préalable de l'espace de travail de yarn échoue dans l'image élaguée pour la production). Comme sequelize-cli ne prend pas en charge l'astuce d'URL `?host=<socket>` de node-pg, la migration reçoit des variables `DATABASE_*` distinctes, avec `DATABASE_HOST` défini sur le répertoire du socket.
6. **Lancement.** `exec node build/server/index.js`.

Pour voir ce que le point d'entrée a résolu :

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 30 \
  | grep -E "Assembled DATABASE_URL|Set URL|Database is ready|migrations"

# GKE
kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=50 | grep -E "URL|Database|migrat"
```

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Outline nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` dans `Outline_Common` (avec `pg_trgm` activé pour la recherche) et ne peut pas être remplacé par MySQL. À chaque apply, un job ponctuel `db-init` (`postgres:15-alpine`, `execute_on_apply = true`) se connecte à Cloud SQL et, de manière idempotente :

1. Mappe le socket du Cloud SQL Auth Proxy lorsqu'il est présent (Cloud Run) et choisit le `PGSSLMODE` adapté à la topologie de connexion (disable sur le socket/la boucle locale, require en TCP direct).
2. Crée l'utilisateur de l'application (ou réinitialise son mot de passe s'il existe).
3. Attribue le rôle de l'utilisateur à `postgres` afin que la propriété puisse être assignée.
4. Crée la base de données appartenant à l'utilisateur de l'application (ou en transfère la propriété), accorde tous les privilèges ainsi que `ALL ON SCHEMA public`.
5. Envoie `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le job se termine proprement sur GKE.

Inspectez directement la base de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

---

## 5. Valeurs par défaut de l'environnement de base {#5-core-environment-defaults}

`Outline_Common` établit l'environnement de référence afin que l'application démarre correctement dès le premier démarrage :

- **`FILE_STORAGE = local`**, `FILE_STORAGE_LOCAL_ROOT_DIR = /var/lib/outline/data` (plafond de 25 MiB par téléversement) — le répertoire est adossé au volume NFS partagé, de sorte que les téléversements persistent et sont partagés entre les instances.
- **`FORCE_HTTPS = false`** — la redirection HTTPS par défaut d'Outline enverrait les sondes de santé en HTTP simple vers un port sans écouteur et ferait redémarrer le conteneur en boucle ; TLS est terminé en amont (frontal de Cloud Run, ou équilibreur de charge/certificat fourni par l'opérateur sur GKE).
- **`PGSSLMODE = disable`** — le Cloud SQL Auth Proxy termine lui-même TLS.
- **Espaces réservés `OIDC_*`** — `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI` sont livrées **volontairement vides** (`OIDC_DISPLAY_NAME`/`OIDC_SCOPES` sont préremplies). Outline a besoin d'un fournisseur d'identité fonctionnel pour permettre la moindre connexion ; tant qu'elles sont vides, la page de connexion n'affiche **aucun fournisseur**. La configuration d'un IdP est une étape obligatoire à la charge de l'opérateur après le déploiement — consultez la procédure OIDC dans [Outline_CloudRun](Outline_CloudRun.md) §3, y compris le piège « supprimer puis lier en tant que secret » pour les identifiants du client.

Les remplacements fournis par l'opérateur via les `environment_variables` des variantes sont fusionnés par-dessus ces valeurs par défaut.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`, classe `STANDARD`, régional) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~outline"
```

Combiné au volume Filestore (NFS) partagé, il offre à Outline un stockage durable pour les téléversements, cohérent entre toutes les instances.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les deux variantes font pointer par défaut leurs sondes vers le chemin racine d'Outline (`/`), qui ne répond qu'une fois les migrations terminées et Redis connecté :

- **Sonde de démarrage** — HTTP `/`, délai initial de 60 s, période de 10 s, seuil d'échec de 6 (jusqu'à ~2 minutes à partir du démarrage du conteneur).
- **Sonde de vivacité** — HTTP `/`, délai initial de 60 s, période de 30 s, seuil d'échec de 3.

Ne réduisez pas le délai de démarrage : au premier démarrage, le point d'entrée attend PostgreSQL et exécute toutes les migrations Sequelize en attente avant que le serveur n'ouvre son port. Notez que les sondes prouvent seulement que le *service* est sain — la connexion nécessite toujours le fournisseur OIDC configuré par l'opérateur.

---

Pour la configuration propre à Outline destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Outline_GKE](Outline_GKE.md)** et **[Outline_CloudRun](Outline_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Outline sur Google Cloud Run](Outline_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Outline sur GKE Autopilot](Outline_GKE.md) — cette configuration déployée sur GKE.
