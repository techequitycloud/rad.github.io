---
title: "Saleor Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Saleor — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Saleor_Common.md @ 3055034 sha256:0c35f4938991 -->

# Saleor Common — Configuration applicative partagée {#saleor-common--shared-application-configuration}

`Saleor_Common` est la **couche applicative partagée** de Saleor. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Saleor sur laquelle s'appuient
[Saleor_GKE](Saleor_GKE.md) et [Saleor_CloudRun](Saleor_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune
entrée d'interface de déploiement propre — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement Saleor, consultez les guides
de plateforme ([Saleor_GKE](Saleor_GKE.md), [Saleor_CloudRun](Saleor_CloudRun.md)) et
les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Saleor_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SECRET_KEY` (clé de signature Django), `RSA_PRIVATE_KEY` (paire de clés de signature JWT) et `DJANGO_SUPERUSER_PASSWORD`, tous dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `ghcr.io/saleor/saleor` avec un point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge, quelle que soit la variable `database_type` propre au module appelant | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la paire de tâches du premier déploiement `db-init` → `db-migrate` (création du rôle/de la base de données, puis migrations Django) | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `media` | Sortie `storage_buckets` |
| Traitement en arrière-plan | Démarre un worker Celery + planificateur beat colocalisés comme processus d'arrière-plan dans le conteneur principal | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/d'activité par défaut ciblant `/health/` | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager — ils ne sont
jamais définis en texte clair :

- **`SECRET_KEY`** — une chaîne aléatoire de 50 caractères. La clé de signature
  cryptographique de Django, utilisée pour signer les sessions/cookies et pour d'autres
  opérations cryptographiques.
- **`RSA_PRIVATE_KEY`** — une clé privée RSA de 2048 bits (PEM), générée une seule fois
  via la ressource Terraform `tls_private_key`. Saleor la lit directement sous la forme
  `settings.RSA_PRIVATE_KEY` (confirmé dans `saleor/core/jwt_manager.py`) pour signer
  chaque jeton JWT d'accès/d'actualisation qu'il émet. **Ne doit jamais faire l'objet
  d'une rotation à la légère** — sans clé stable, Saleor se rabat sur la génération d'une
  clé temporaire à chaque redémarrage, ce qui invalide tous les jetons émis et oblige
  chaque session à se réauthentifier.
- **`DJANGO_SUPERUSER_PASSWORD`** — une chaîne aléatoire de 24 caractères. Mot de passe
  du compte superutilisateur d'amorçage, garanti de manière idempotente à chaque
  démarrage du conteneur via
  `manage.py createsuperuser --email <SALEOR_SUPERUSER_EMAIL> --noinput` (sans effet si
  l'utilisateur existe déjà).

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~saleor-key OR name~saleor-rsa-key OR name~saleor-admin-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle de
secrets partagé.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Saleor exige **PostgreSQL 15** ; le moteur est fixé par `Saleor_Common` et MySQL ou les
autres moteurs ne sont pas pris en charge, quelle que soit la valeur de la variable
`database_type` propre au module appelant `Saleor_CloudRun`/`Saleor_GKE`. Au premier
déploiement, deux tâches séquentielles s'exécutent :

1. **`db-init`** (`postgres:15-alpine`, `db-init.sh`) — se connecte via le Cloud SQL
   Auth Proxy et crée de manière idempotente la base de données et le rôle de
   l'application.
2. **`db-migrate`** (image de l'application, `depends_on_jobs = ["db-init"]`,
   `migrate.sh`) — exécute `python3 manage.py migrate --noinput` sur le schéma
   nouvellement créé.

Les deux tâches sont idempotentes et peuvent être relancées sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme. Les extensions `pg_trgm`, `unaccent`, `hstore` et
`citext` sont déclarées comme toujours activées dans l'objet `config` assemblé
(`enable_postgres_extensions = true`,
`postgres_extensions = ["pg_trgm", "unaccent", "hstore", "citext"]`), indépendamment
des variables `enable_postgres_extensions`/`postgres_extensions` propres au module
appelant.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche `FROM ghcr.io/saleor/saleor:${SALEOR_VERSION}`
(par défaut `3.23`), qui n'ajoute qu'un script de point d'entrée cloud :

- **ARG de version propre à l'application.** L'ARG de build `SALEOR_VERSION` du
  Dockerfile est volontairement distinct de l'`APP_VERSION` générique du socle (que le
  socle injecte dans `build_args` et qui forcerait sinon le tag invalide
  `saleor:latest`) ; `Saleor_Common` associe `application_version == "latest"` à la
  valeur par défaut épinglée `3.23`.
- **Compose `DATABASE_URL` au démarrage du conteneur.** Comme le mot de passe de la base
  de données est un secret d'exécution inconnu au moment du plan et que Cloud Run
  n'interpole pas les références d'environnement `$(VAR)` comme le fait Kubernetes, le
  point d'entrée construit un DSN `postgres://` encodé en URL à partir des variables
  `DB_*` injectées par le socle, selon que `DB_HOST` est un répertoire de socket Unix
  (Cloud Run) ou un hôte TCP (`DB_IP` sur Cloud Run / bouclage du Cloud SQL Auth Proxy
  sur GKE).
- **Compose `CACHE_URL`/`CELERY_BROKER_URL`** à partir de `REDIS_HOST`/`REDIS_PORT`
  lorsque Redis est activé (bases Redis logiques distinctes : `/0` pour le cache, `/1`
  pour le broker Celery).
- **Amorce éventuellement le superutilisateur** — de manière idempotente, à condition
  que `SALEOR_SUPERUSER_EMAIL` et `DJANGO_SUPERUSER_PASSWORD` soient tous deux définis.
- **Démarre le worker Celery + le planificateur beat en arrière-plan** chaque fois que
  la commande du conteneur est le `uvicorn` par défaut (c'est-à-dire le serveur d'API
  principal, et non une tâche d'initialisation invoquant directement son propre
  script) — `celery -A saleor
  --app=saleor.celeryconf:app worker --loglevel=info -B &`, avec un piège `TERM`/`INT`
  qui arrête proprement le worker à l'arrêt.
- **Redéclare à l'identique le `CMD` de l'image de base** dans le Dockerfile de
  surcouche — Docker ne reporte le `CMD` que lorsqu'un Dockerfile enfant laisse
  `ENTRYPOINT` inchangé ; déclarer un nouvel `ENTRYPOINT` (le script de point d'entrée
  cloud) supprime donc silencieusement le `CMD` hérité, sauf s'il est redéclaré
  exactement
  (`uvicorn saleor.asgi:application --host=0.0.0.0 --port=8000 --workers=2 ...`,
  confirmé via `docker inspect` de l'image amont).

**Pourquoi le worker Celery est colocalisé plutôt qu'en sidecar ou en entrée
`additional_services` :** `additional_services` n'accepte qu'une référence `image`
précompilée, alors que le worker a besoin exactement de la même image de surcouche
construite sur mesure, dont le chemin Artifact Registry n'est connu *qu'à l'intérieur*
du module socle (y faire référence dans `additional_services` depuis le module appelant
créerait un cycle au moment du plan). Sur GKE, un Deployment distinct s'exécuterait en
outre sous son propre ServiceAccount plutôt que sous celui de l'application principale.
C'est pourquoi `cpu_always_allocated` vaut `true` par défaut sur les deux plateformes —
le worker a besoin de CPU en continu entre les requêtes, et pas seulement pendant leur
traitement.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Saleor_Common` établit l'environnement de base afin que l'application démarre
correctement dès le premier démarrage :

- **`ALLOWED_HOSTS = "*"`** — protection standard de Django sur l'en-tête Host,
  assouplie car la plateforme se trouve déjà derrière la périphérie propre à Cloud
  Run/GKE.
- **`SALEOR_SUPERUSER_EMAIL`** — injectée à partir de la variable `admin_email` propre à
  `Saleor_Common` (par défaut `admin@example.com`), uniquement lorsqu'elle n'est pas
  vide. Ni `Saleor_CloudRun` ni `Saleor_GKE` ne l'exposent comme variable destinée aux
  utilisateurs — c'est toujours la valeur par défaut propre au module Common, sauf si le
  fichier de câblage est modifié directement.
- **Port de conteneur `8000`** — le port d'écoute par défaut d'uvicorn, confirmé via
  `docker inspect` de l'image de base.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/health/` — le point de terminaison de santé non
authentifié de Saleor, dont il a été confirmé qu'il renvoie `200` dès que le serveur
ASGI accepte les connexions (à la fois lors des tests de conteneur en local et en
conditions réelles sur les deux plateformes déployées).

- **Cloud Run** utilise des sondes HTTP ciblant `/health/` avec un délai initial de
  20 secondes et un seuil de 20 échecs (période de 15 secondes) pour le démarrage, et un
  délai initial de 30 secondes / un seuil de 3 échecs pour l'activité.
- **GKE** utilise le même chemin `/health/` avec un délai initial de démarrage de
  90 secondes (pour laisser à `db-migrate` le temps de se terminer) et un délai initial
  d'activité de 60 secondes.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket Cloud Storage dédié (`name_suffix = "media"`) est déclaré ici et provisionné
par le socle, qui accorde également au compte de service de la charge de travail un
accès en lecture/écriture. Le bucket est provisionné dans la région du déploiement avec
`public_access_prevention = "inherited"`. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Aucun autre volume GCS ni stockage NFS n'est configuré pour Saleor au-delà de cette
valeur par défaut.

---

Pour la configuration propre à Saleor destinée aux utilisateurs (variables par groupe,
sorties et manière d'explorer chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Saleor_GKE](Saleor_GKE.md)** et
**[Saleor_CloudRun](Saleor_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Saleor sur Google Cloud Run](Saleor_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Saleor sur GKE Autopilot](Saleor_GKE.md) — cette configuration déployée sur GKE.
