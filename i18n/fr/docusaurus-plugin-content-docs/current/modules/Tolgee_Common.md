---
title: "Tolgee Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Tolgee — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Tolgee_Common.md @ 3055034 sha256:fcac4349124d -->

# Tolgee Common — Configuration applicative partagée {#tolgee-common--shared-application-configuration}

`Tolgee_Common` est la **couche applicative partagée** de Tolgee. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration propre à Tolgee sur laquelle s'appuient à la fois
[Tolgee_GKE](Tolgee_GKE.md) et [Tolgee_CloudRun](Tolgee_CloudRun.md), de sorte que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais
directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Tolgee, consultez les guides
des plateformes ([Tolgee_GKE](Tolgee_GKE.md), [Tolgee_CloudRun](Tolgee_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Tolgee_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère le mot de passe administrateur initial (24 caractères) et le secret de signature JWT (64 caractères), et les stocke dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit un wrapper personnalisé léger `FROM tolgee/tolgee:<version>` doté d'un point d'entrée cloud ; construit via Cloud Build et mis en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | S'appuie sur le `create-db-and-user.sh` du socle (pas de job d'initialisation distinct) ; Tolgee migre automatiquement son schéma avec Liquibase au premier démarrage | §Base de données dans les guides des plateformes |
| Stockage d'objets | Déclare un bucket **Cloud Storage** pour le stockage de fichiers facultatif (captures d'écran/imports) | Sortie `storage_buckets` |
| Paramètres essentiels | Définit `SERVER_PORT`, le nom d'utilisateur administrateur initial, l'authentification native, et désactive le PostgreSQL intégré de Tolgee | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de disponibilité, de démarrage et de vivacité par défaut ciblant `/actuator/health` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont jamais
définis en clair :

- **`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`** — un mot de passe aléatoire de 24 caractères pour le
  propriétaire de l'instance (compte `admin`) que Tolgee crée au premier démarrage à partir de
  `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` / `_PASSWORD`. Récupérez-le pour vous connecter la
  première fois. L'ID du secret est
  `secret-<resource-prefix>-<application_name>-admin-password`.
- **`TOLGEE_AUTHENTICATION_JWT_SECRET`** — une chaîne aléatoire de 64 caractères utilisée pour signer tous
  les jetons de session utilisateur (Tolgee exige au moins 32 caractères). Elle reste **stable**
  entre les redémarrages et les instances afin que les jetons émis restent valides. Sa rotation après le premier
  démarrage invalide immédiatement toutes les sessions actives et oblige tous les utilisateurs à se reconnecter.
  L'ID du secret est `secret-<resource-prefix>-<application_name>-jwt-secret`.

Les deux secrets sont exposés via la sortie `secret_ids`, que chaque variante de plateforme injecte
dans le conteneur en tant que `module_secret_env_vars`. Récupérez-les après le déploiement :

```bash
# List Tolgee secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"

# Read the initial admin password:
gcloud secrets versions access latest \
  --secret="secret-<resource-prefix>-<app>-admin-password" --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret
est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`). Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Tolgee exige **PostgreSQL 15** ; le moteur est fixé (`database_type = "POSTGRES_15"`)
et MySQL ou d'autres moteurs ne sont pas pris en charge. Contrairement à la plupart des modules applicatifs, Tolgee
ne fournit **pas** de job `db-init` par défaut. L'étape `create-db-and-user.sh` propre au socle
App_CloudRun / App_GKE effectue déjà les opérations suivantes :

1. Crée le rôle et la base de données PostgreSQL sous les `DB_USER` / `DB_NAME` propres au tenant,
2. Définit le rôle de l'application comme propriétaire de la base de données (ce qui en fait un membre de `pg_database_owner`,
   qui possède le schéma `public` sur Postgres 15+),
3. Exécute `GRANT ALL ON SCHEMA public TO <app_user>`.

Cela prépare entièrement la base de données ; les migrations **Liquibase** propres à Tolgee créent et
font évoluer l'intégralité du schéma automatiquement au premier démarrage — il n'y a aucun job de migration
distinct à exécuter. (Un script autonome `scripts/db-init.sh` est présent à titre de référence ou pour un usage manuel, mais
il n'est pas relié à `initialization_jobs` par défaut.)

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Tolgee est une application **Spring Boot (Java)**. Le module construit un **wrapper personnalisé
léger** `FROM tolgee/tolgee:<version>` (via Cloud Build ; `enable_image_mirroring = true`
met en miroir l'image de base dans Artifact Registry). Le wrapper ajoute un point d'entrée cloud
POSIX-`sh` (`entrypoint.sh`) qui s'exécute avant le lanceur `/app/cmd.sh` propre à Tolgee :

- **Assemble `SPRING_DATASOURCE_URL` en TCP.** Le pilote JDBC PostgreSQL intégré à Tolgee
  **ne peut pas** se connecter via un socket Unix Cloud SQL (la même contrainte que Keycloak) ;
  le point d'entrée construit donc toujours une URL JDBC TCP à partir des variables `DB_*` injectées par le socle :
  - `DB_HOST` est un répertoire de socket `/…` → repli sur `DB_IP` (l'IP privée de Cloud SQL)
    avec `sslmode=require`.
  - `DB_HOST` vaut `127.0.0.1` / `localhost` (boucle locale de l'Auth Proxy sur GKE) → TCP simple, sans SSL
    (le proxy termine le TLS).
  - sinon (une IP privée) → TCP avec `sslmode=require` (Cloud SQL rejette le TCP non chiffré
    sur IP privée).
- **Définit les identifiants séparément** — `SPRING_DATASOURCE_USERNAME` / `_PASSWORD` à partir de
  `DB_USER` / `DB_PASSWORD`, si bien qu'aucun encodage d'URL n'est nécessaire.
- **Exporte `SERVER_PORT`** — Tolgee lit `SERVER_PORT` (Cloud Run réserve `PORT` et
  rejette toute valeur fournie par l'utilisateur) ; le point d'entrée définit donc `SERVER_PORT=8080`.
- **Désactive le PostgreSQL intégré** — `TOLGEE_POSTGRES_AUTOSTART_ENABLED=false` oblige
  Tolgee à utiliser l'instance Cloud SQL externe plutôt que sa base de données intégrée.
- **Passe la main avec `exec`** — après avoir préparé l'environnement, il lance via `exec` le lanceur
  `/app/cmd.sh` propre à l'image, tel quel, en tant que PID 1.

Comme le point d'entrée et le Dockerfile sont intégrés à l'image personnalisée, les modifier
exige une reconstruction de l'image et un redéploiement.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Tolgee_Common` met en place l'environnement de base de Tolgee afin que l'application démarre
correctement dès le premier lancement :

- **Port** — `SERVER_PORT = "8080"` (l'écouteur HTTP Spring Boot de Tolgee).
- **Base de données intégrée** — `TOLGEE_POSTGRES_AUTOSTART_ENABLED = "false"` (utilisation de Cloud SQL externe).
- **Propriétaire initial** — `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (par défaut
  `admin@techequity.cloud`) ; le mot de passe correspondant est injecté depuis Secret Manager.
- **Authentification** — `TOLGEE_AUTHENTICATION_ENABLED = "true"` active l'authentification native par e-mail et mot de passe ;
  les opérateurs peuvent activer des fournisseurs supplémentaires (Google/OAuth2/SSO) après le déploiement.

Aucun Redis n'est configuré — Tolgee stocke tout l'état des traductions dans PostgreSQL.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent **`/actuator/health`** — le point de terminaison Spring Boot Actuator de Tolgee,
qui ne renvoie un `200` non authentifié qu'une fois les migrations Liquibase terminées et
l'application entièrement initialisée. Une fenêtre de démarrage généreuse (délai initial de 60 secondes, jusqu'à 30
échecs avec une période de 15 secondes) laisse le temps aux migrations de schéma du premier démarrage sur une
instance Cloud SQL neuve.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (`name_suffix = "storage"`) est déclaré ici et
provisionné par le socle, avec un accès accordé au compte de service de la charge de travail. Tolgee
conserve les traductions et les métadonnées dans PostgreSQL ; ce bucket sert au stockage de fichiers
**facultatif** (captures d'écran téléversées, artefacts d'import) — montez-le via `gcs_volumes` ou faites pointer
le stockage de fichiers compatible S3 de Tolgee vers lui. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Tolgee destinée aux utilisateurs (variables par groupe, sorties et manière
d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Tolgee_GKE](Tolgee_GKE.md)** et **[Tolgee_CloudRun](Tolgee_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Tolgee sur Google Cloud Run](Tolgee_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Tolgee sur GKE Autopilot](Tolgee_GKE.md) — cette configuration déployée sur GKE.
