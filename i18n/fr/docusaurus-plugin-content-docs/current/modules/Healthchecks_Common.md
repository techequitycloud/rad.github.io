---
title: "Healthchecks Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Healthchecks — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Healthchecks_Common.md @ 3055034 sha256:49707f54c8ef -->

# Healthchecks Common — Configuration applicative partagée {#healthchecks-common--shared-application-configuration}

`Healthchecks_Common` est la **couche applicative partagée** de Healthchecks. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Healthchecks sur
laquelle s'appuient à la fois [Healthchecks_GKE](Healthchecks_GKE.md) et
[Healthchecks_CloudRun](Healthchecks_CloudRun.md), de sorte que les deux variantes
de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais directement cette couche — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Healthchecks,
consultez les guides des plateformes ([Healthchecks_GKE](Healthchecks_GKE.md),
[Healthchecks_CloudRun](Healthchecks_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Healthchecks_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère la `SECRET_KEY` de Django (chaîne aléatoire de 50 caractères) et la stocke dans **Secret Manager** | Injectée automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Mot de passe administrateur initial | Génère un mot de passe aléatoire de 24 caractères, défini une seule fois par le job `admin-bootstrap` | Injecté automatiquement ; récupérable via Secret Manager |
| Image de conteneur | Image officielle préconstruite `healthchecks/healthchecks` — aucun build personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** et définit explicitement `DB = "postgres"` | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit `db-init` (création de la base + du rôle) et `admin-bootstrap` (migration + création du superutilisateur) | Sortie `initialization_jobs` |
| Stockage objet | Aucun — Healthchecks stocke tout son état dans PostgreSQL | Sortie `storage_buckets` (`[]`) |
| Paramètres de base | Définit l'environnement de base de Healthchecks : `DB`, `DEBUG=False`, `SITE_ROOT`, `SITE_NAME`, `ALLOWED_HOSTS="*"`, `DEFAULT_FROM_EMAIL` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :

- **`SECRET_KEY`** — une chaîne aléatoire de 50 caractères. Utilisée par Django
  pour signer les sessions et les jetons CSRF. La changer après le premier
  démarrage invalide toutes les sessions actives.
- **`ADMIN_PASSWORD`** — un mot de passe aléatoire de 24 caractères pour le
  superutilisateur initial, défini **une seule fois** par le job d'initialisation
  `admin-bootstrap` via la commande Django standard `createsuperuser --noinput`.
  Il n'y a pas de réinitialisation auto-réparatrice à chaque démarrage
  (contrairement à Listmonk/Miniflux) — un changement de mot de passe après le
  premier démarrage doit passer par l'interface de Healthchecks ou par
  `manage.py changepassword`.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Healthchecks exige **PostgreSQL 15** ; le moteur est fixé et la variable
d'environnement `DB` est explicitement définie à `"postgres"`. Sinon, l'image
amont se rabat silencieusement sur une base SQLite jetable, locale au conteneur,
sans aucune erreur — la même catégorie de piège de mauvais moteur silencieux que
celle déjà documentée dans ce catalogue pour Wallabag.

Lors du premier déploiement, deux jobs d'initialisation s'exécutent :

1. **`db-init`** (`postgres:15-alpine`) — crée de manière idempotente le rôle et la
   base de données de l'application. Contrairement à certaines applications, le
   provisionnement automatique de base de données propre au socle ne couvre pas ce
   point pour Healthchecks ; chaque application Postgres de ce catalogue exécute
   donc son propre `db-init.sh` éprouvé.
2. **`admin-bootstrap`** (l'image Healthchecks elle-même, `depends_on_jobs =
   ["db-init"]`) — exécute `manage.py migrate --noinput`, puis `manage.py
   createsuperuser --noinput --username admin --email <admin_email>` avec le mot de
   passe issu du secret `ADMIN_PASSWORD`, protégé par `|| true` afin qu'une
   nouvelle exécution (qui échoue parce que l'utilisateur existe déjà) ne fasse
   pas échouer le job. Il reproduit lui-même l'étape de migration parce que les
   jobs d'initialisation Cloud Run/GKE invoquent directement la commande et les
   arguments du conteneur, en contournant la chaîne de démarrage `uwsgi.ini` propre
   à l'image du fournisseur (où `hook-pre-app = exec:./manage.py migrate`
   s'exécute normalement automatiquement) — et sur Cloud Run, les jobs
   d'initialisation se terminent strictement avant même la création du Service
   principal, si bien que le schéma n'existerait pas encore sinon.

Les deux jobs peuvent être relancés sans risque. Inspectez directement la base de
données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans
les outputs du déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

L'image officielle préconstruite `healthchecks/healthchecks:<version>` est
utilisée directement (`image_source = "prebuilt"`) — aucun Dockerfile
personnalisé ni étape Cloud Build, ce qui a été vérifié par rapport aux fichiers
amont `docker/Dockerfile` et `docker/uwsgi.ini`
(github.com/healthchecks/healthchecks) :

- Écoute sur **0.0.0.0:8000** (`uwsgi.ini` : `http-socket = :8000`).
- `hook-pre-app = exec:./manage.py migrate` exécute automatiquement les
  migrations de schéma à chaque démarrage normal du conteneur du service
  principal.
- `attach-daemon = ./manage.py sendalerts --skip-checks` et `sendreports
  --loop --skip-checks` démarrent automatiquement la boucle d'alerte
  d'arrière-plan dans le MÊME conteneur — la boucle qui repère réellement les
  signalements manqués et déclenche les alertes. Elle s'exécute en continu,
  indépendamment des requêtes HTTP entrantes (même schéma que n8n/Kestra) —
  consultez les valeurs par défaut `cpu_always_allocated`/
  `min_instance_count` de la variante CloudRun.
- Le moteur, l'hôte et les identifiants de la base de données sont des variables
  d'environnement distinctes (`DB`, `DB_HOST`, `DB_PORT`,
  `DB_NAME`, `DB_USER`, `DB_PASSWORD`) qui correspondent déjà mot pour mot aux
  noms injectés par le socle de ce dépôt — aucune composition de DSN ni aucun
  renommage n'est nécessaire, contrairement à la plupart des autres modules
  Common à image préconstruite de ce catalogue.
- L'image de base est une simple image `python:slim` (Debian) — un vrai shell est
  présent (contrairement à plusieurs images préconstruites distroless de ce
  catalogue), ce qui explique pourquoi le job `admin-bootstrap` peut invoquer
  directement `/bin/sh -c` sans avoir besoin de greffer busybox.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Healthchecks_Common` établit l'environnement de base afin que l'application
démarre correctement et en toute sécurité au premier démarrage :

- **`DB = "postgres"`** — sélectionne explicitement le moteur Postgres.
- **`DEBUG = "False"`** — l'image amont utilise par défaut `DEBUG=True`, ce que sa
  propre documentation déconseille en production.
- **`SITE_ROOT`** — défini à partir de l'URL prévue/réelle du service ; sert à
  construire les liens absolus dans les e-mails d'alerte.
- **`ALLOWED_HOSTS = "*"`** — défini explicitement, car une validation d'hôte
  dérivée de SITE_ROOT rejetterait sinon l'en-tête Host des sondes de santé
  internes de la plateforme (les sondes atteignent le conteneur via une IP ou un
  nom d'hôte internes, et non via l'URL publique) — la même catégorie de panne
  que celle déjà documentée dans ce catalogue pour les trusted-hosts de
  Nextcloud/OpenProject. Healthchecks n'a pas d'autre modèle de sécurité fondé
  sur le Host ; c'est donc une valeur par défaut acceptable.
- **`DEFAULT_FROM_EMAIL`** — une valeur provisoire (`healthchecks@example.org`)
  jusqu'à ce que l'opérateur configure un vrai SMTP sortant (`EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` via `environment_variables`/`secret_environment_variables`).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/` — Healthchecks n'a pas d'endpoint de santé
dédié ; la page de connexion racine est toujours publique, non authentifiée, et
constitue un signal de disponibilité fiable (une connexion à la base de données
rompue renverrait une erreur 500 au lieu de l'afficher).

- **Cloud Run** utilise des sondes HTTP ciblant `/`, avec un délai de démarrage de
  60 secondes et un délai de vivacité de 30 secondes.
- **GKE** utilise des sondes HTTP ciblant `/`, avec un délai de démarrage de
  90 secondes et un délai de vivacité de 60 secondes.

---

## 7. Stockage d'objets {#7-object-storage}

Aucun. Healthchecks stocke tout son état (vérifications, pings, utilisateurs,
configuration des alertes) dans PostgreSQL — il n'existe pas de répertoire de
médias/de fichiers téléversés ; `storage_buckets` renvoie donc une liste vide et
aucun bucket GCS n'est provisionné pour l'application elle-même (un bucket
générique `data` du socle peut néanmoins exister selon la variable standard
`storage_buckets`, sans lien avec les besoins propres de Healthchecks).

---

Pour la configuration propre à Healthchecks et destinée aux utilisateurs
(variables par groupe, outputs et manière d'explorer chaque service depuis la
console et la CLI), consultez les guides des plateformes :
**[Healthchecks_GKE](Healthchecks_GKE.md)** et
**[Healthchecks_CloudRun](Healthchecks_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Healthchecks sur GKE Autopilot](Healthchecks_GKE.md) — cette configuration déployée sur GKE.
