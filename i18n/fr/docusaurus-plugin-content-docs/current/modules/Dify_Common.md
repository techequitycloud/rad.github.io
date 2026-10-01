---
title: "Dify Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Dify — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Dify_Common.md @ 3055034 sha256:d4f1cbfa3f19 -->

# Dify Common — Configuration applicative partagée {#dify-common--shared-application-configuration}

`Dify_Common` est la **couche applicative partagée** de Dify. Elle n'est pas déployée seule ; elle
fournit la configuration propre à Dify sur laquelle s'appuient [Dify_GKE](Dify_GKE.md) et
[Dify_CloudRun](Dify_CloudRun.md), afin que les deux variantes de plateforme se comportent de
manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle ne possède aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Dify, consultez les guides des
plateformes ([Dify_GKE](Dify_GKE.md), [Dify_CloudRun](Dify_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Dify_Common | Où cela apparaît |
|---|---|---|
| Secret applicatif | Génère un `SECRET_KEY` de 64 caractères et le stocke dans **Secret Manager** | Récupéré depuis Secret Manager ; injecté sous le nom `SECRET_KEY` dans chaque pod/instance |
| Image de conteneur | Définit `langgenius/dify-api` comme image de base et l'encapsule avec supervisord (API + Celery dans un seul conteneur) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Extension pgvector | Active l'extension PostgreSQL `vector` afin que l'instance Cloud SQL serve aussi de base vectorielle | `VECTOR_STORE=pgvector` sans base vectorielle distincte |
| Amorçage de la base de données | Définit la tâche du premier déploiement qui crée l'utilisateur et la base de données | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`, p. ex. `gcs-dify<resource-prefix>-storage`) | Sortie `storage_buckets` |
| Environnement de base | Définit toutes les variables d'environnement de base de Dify (adresse d'écoute, paramètres gunicorn, URL Redis, pilote de stockage, connexion pgvector, CORS, URL des services) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit le comportement par défaut des sondes HTTP de démarrage et de vivacité (toutes deux ciblent `/health`) | §Observabilité dans les guides des plateformes |

---

## 2. SECRET_KEY dans Secret Manager {#2-secret_key-in-secret-manager}

Un `SECRET_KEY` aléatoire de 64 caractères est généré automatiquement et stocké comme secret
Secret Manager — il n'est jamais défini en clair. Cette clé est utilisée par le serveur Flask de
Dify pour la signature des JWT, le chiffrement des sessions et les jetons CSRF. Récupérez-la après
le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

**N'effectuez pas de rotation de ce secret et ne le modifiez pas après le premier déploiement.** Toutes les
instances en cours d'exécution (API et worker Celery) doivent partager la même valeur ; une
divergence provoque des échecs d'authentification entre les services et déconnecte tous les
utilisateurs.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son
secret figure dans les sorties du déploiement de la plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données, pgvector et amorçage {#3-database-engine-pgvector-and-bootstrap}

Dify nécessite **PostgreSQL 15** ; le moteur est imposé et MySQL n'est pas pris en charge.
L'extension PostgreSQL `vector` est activée automatiquement sur l'instance Cloud SQL, ce qui
permet à Dify d'utiliser la même base de données à la fois comme magasin applicatif et comme base
vectorielle (`VECTOR_STORE=pgvector`) — aucun service Weaviate, Qdrant ou autre service vectoriel
distinct n'est nécessaire dans la configuration par défaut.

Lors du premier déploiement, une tâche ponctuelle `db-init` se connecte à Cloud SQL via l'Auth
Proxy et, de manière idempotente :

1. crée l'utilisateur de l'application (ou met à jour son mot de passe),
2. accorde ce rôle utilisateur à `postgres` afin qu'il puisse en prendre la propriété,
3. crée la base de données Dify (si elle est absente), détenue par cet utilisateur,
4. accorde à l'utilisateur tous les privilèges sur la base de données.

La tâche utilise l'image `postgres:15-alpine` et peut être relancée sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du
déploiement de la plateforme.

---

## 4. Image de conteneur et supervisord {#4-container-image-and-supervisord}

`Dify_Common` construit une image personnalisée qui étend `langgenius/dify-api:<version>` en
installant supervisord et en copiant un point d'entrée de plateforme (`/platform-entrypoint.sh`).
Au démarrage, ce point d'entrée applique plusieurs corrections avant de passer la main à
supervisord :

1. **Remappage de DB_HOST.** Si `DB_HOST` est un répertoire de socket Unix Cloud SQL (commençant
   par `/`), il est remplacé par `DB_IP` (l'adresse IP TCP privée de Cloud SQL) et
   `sslmode=require` est ajouté à `DB_EXTRAS`, afin que pgvector et SQLAlchemy atteignent la base
   de données en TCP avec TLS plutôt que par un socket.
2. **Espaces réservés `$(VAR)` résolus à nouveau.** `DB_USERNAME`, `DB_DATABASE`, `REDIS_HOST`,
   `CELERY_BROKER_URL`/`CELERY_BACKEND`, `EVENT_BUS_REDIS_URL` et `PGVECTOR_PASSWORD` sont tous
   réexportés explicitement depuis l'environnement du conteneur désormais entièrement résolu
   (voir §5) au lieu de s'appuyer sur leurs valeurs littérales `$(...)`.
3. **Remplacement de l'URL web.** Si `DIFY_WEB_URL` est présent (injecté par la variante
   CloudRun/GKE lorsqu'un service `web` distinct est déployé), `CONSOLE_WEB_URL`/`APP_WEB_URL`
   sont remplacés par cette valeur afin que les liens des e-mails et les redirections OAuth
   ciblent le frontal destiné au navigateur plutôt que le service d'API.
4. supervisord lance ensuite deux processus dans le même conteneur :
   - Le serveur d'API gunicorn (`MODE=api`) sur le port 5001.
   - Le worker Celery (`MODE=worker`), qui vide la file de tâches depuis Redis.

Ce modèle co-localisé signifie que l'API web et le worker d'arrière-plan sont régis par les mêmes
contrôles de mise à l'échelle Cloud Run ou GKE et partagent la même allocation de CPU et de
mémoire.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Dify_Common` définit toutes les variables d'environnement de base de Dify afin que l'application
démarre correctement dès le premier lancement :

- **Processus et écoute** — `DIFY_BIND_ADDRESS=0.0.0.0`, `DIFY_PORT=5001`,
  `SERVER_WORKER_AMOUNT=2`, `GUNICORN_TIMEOUT=360`.
- **Migrations** — `MIGRATION_ENABLED=true` fait exécuter Flask-Migrate à chaque démarrage,
  appliquant automatiquement les changements de schéma lors d'une mise à niveau de version.
- **Base de données** — `DB_TYPE=postgresql`, `DB_USERNAME=$(DB_USER)`, `DB_DATABASE=$(DB_NAME)`
  sont définis en configuration statique, mais **Cloud Run n'interpole pas les références
  `$(VAR)`** (il s'agit d'une fonctionnalité de référence d'environnement propre à Kubernetes) et,
  même sur GKE, la substitution dépend de l'ordre ; ces espaces réservés ne sont donc pas résolus
  de manière fiable par la plateforme elle-même. `entrypoint.sh` réexporte
  `DB_USERNAME`/`DB_DATABASE` à partir de `DB_USER`/`DB_NAME` déjà résolus, une fois que toutes
  les variables d'environnement sont disponibles dans le conteneur, et c'est ce qui rend
  réellement les valeurs correctes à l'exécution.
- **Redis et Celery** — Trois chemins de connexion Redis sont construits à partir de
  `redis_host`, `redis_port` et `redis_auth` :
  - `CELERY_BROKER_URL` et `CELERY_BACKEND` — `redis://...:<port>/1` (Celery utilise la db 1).
  - `EVENT_BUS_REDIS_URL` — `redis://...:<port>/0` (le streaming SSE/WebSocket utilise la db 0).
  - Lorsque `redis_host` est vide, l'espace réservé d'exécution `$(NFS_SERVER_IP)` est utilisé
    comme solution de repli ; comme Cloud Run ne le résout pas non plus, `entrypoint.sh`
    reconstruit `REDIS_HOST` et les trois URL dérivées de Redis une fois que `NFS_SERVER_IP` est
    disponible dans l'environnement du conteneur.
- **Stockage** — `STORAGE_TYPE=google-storage`, `GOOGLE_STORAGE_BUCKET_NAME=<prefix>-storage`.
  L'identité du service Cloud Run ou GKE (via Workload Identity / ADC) accorde l'accès ; aucun
  fichier de clé JSON n'est utilisé.
- **Base vectorielle** — `VECTOR_STORE=pgvector`, `PGVECTOR_HOST=$(DB_IP)`, toutes les autres
  variables de connexion pgvector étant définies à partir d'espaces réservés injectés par la
  plateforme. `PGVECTOR_PASSWORD` est lui aussi réexporté par `entrypoint.sh` à partir du secret
  `DB_PASSWORD` résolu, car l'espace réservé statique `$(DB_PASSWORD)` est déclaré avant le bloc
  des variables d'environnement secrètes et n'est jamais substitué par Cloud Run.
- **URL des services** — `CONSOLE_API_URL`, `CONSOLE_WEB_URL`, `SERVICE_API_URL`, `APP_API_URL`,
  `APP_WEB_URL` et `FILES_URL` valent tous par défaut `var.service_url` (l'URL transmise par le
  module wrapper). `entrypoint.sh` remplace `CONSOLE_WEB_URL`/`APP_WEB_URL` par `DIFY_WEB_URL`
  lorsque la variante CloudRun/GKE provisionne un service frontal `web` distinct.
- **CORS** — `WEB_API_CORS_ALLOW_ORIGINS="*"` et `CONSOLE_CORS_ALLOW_ORIGINS="*"`. Remplacez-les
  via `environment_variables` dans le module de plateforme pour les déploiements de production.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité ciblent toutes deux `/health`, de type HTTP, avec un délai
initial de 30 secondes.

- **GKE** conserve des sondes HTTP ciblant `/health` avec un délai initial de 30 secondes et un
  seuil d'échec de 30 tentatives (300 secondes au total), ce qui laisse suffisamment de temps à
  Flask-Migrate pour se terminer au premier démarrage.
- **Cloud Run** utilise la même cible HTTP `/health` avec le même délai initial. Contrairement aux
  applications PHP qui redirigent HTTP vers HTTPS, l'API Dify sert du HTTP simple sur le port 5001
  sans redirection, de sorte que les sondes HTTP fonctionnent correctement sur les deux
  plateformes.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`, p. ex. `gcs-dify<resource-prefix>-storage`,
défini comme `GOOGLE_STORAGE_BUCKET_NAME`) est déclaré ici et provisionné par le socle. Le compte
de service de la charge de travail reçoit automatiquement l'accès via Workload Identity. Dify
utilise ce bucket pour tous les fichiers téléversés (documents, images, audio) ; le bucket doit
donc exister avant le premier téléversement. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Dify destinée aux utilisateurs (variables par groupe, sorties et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides des
plateformes : **[Dify_GKE](Dify_GKE.md)** et **[Dify_CloudRun](Dify_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Dify sur Google Cloud Run](Dify_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Dify sur GKE Autopilot](Dify_GKE.md) — cette configuration déployée sur GKE.
