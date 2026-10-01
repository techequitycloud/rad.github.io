---
title: "Tandoor Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Tandoor — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Tandoor_Common.md @ 3055034 sha256:3d1c6f53b4b8 -->

# Tandoor Common — Configuration applicative partagée {#tandoor-common--shared-application-configuration}

`Tandoor_Common` est la **couche applicative partagée** de Tandoor. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Tandoor sur laquelle s'appuient
à la fois [Tandoor_GKE](Tandoor_GKE.md) et [Tandoor_CloudRun](Tandoor_CloudRun.md), afin
que les deux variantes de plateforme se comportent de manière identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Tandoor, consultez les guides
des plateformes ([Tandoor_GKE](Tandoor_GKE.md), [Tandoor_CloudRun](Tandoor_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Tandoor_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère une `SECRET_KEY` Django (50 caractères) et le mot de passe initial du superutilisateur (20 caractères), et les stocke tous deux dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Déploie directement l'image officielle `vabene1111/recipes` — pas de build personnalisé, pas de wrapper de point d'entrée | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job `db-init` du premier déploiement, qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Création du superutilisateur | Définit le job `create-superuser` (qui dépend de `db-init`), qui applique les migrations et crée le compte superutilisateur Django initial | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `data` (pour les images des recettes) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Tandoor de base : `DB_ENGINE`, `ALLOWED_HOSTS`, `PGSSLMODE`, nom d'utilisateur/e-mail du superutilisateur | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde par défaut de démarrage (`/accounts/login/`) / de liveness (TCP) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :

- **`SECRET_KEY`** — une chaîne aléatoire de 50 caractères. Utilisée par Django pour
  signer les sessions, les jetons CSRF et les liens de réinitialisation de mot de passe.
  Sa rotation après le premier démarrage invalide toutes les sessions actives et tous les
  jetons signés en cours de validité. Tandoor n'a pas de valeur par défaut définissable
  par variable d'environnement en amont ; ce module en génère donc une (sur le modèle de
  `Django_Common`).
- **`DJANGO_SUPERUSER_PASSWORD`** — une chaîne aléatoire de 20 caractères. Utilisée
  uniquement par le job d'initialisation `create-superuser` pour créer le compte
  administrateur initial. Contrairement à Mealie (livré avec un identifiant fixe et non
  documenté `changeme@example.com`/
  `MyPassword` sans mécanisme de surcharge), Tandoor obtient un identifiant réel et
  unique à chaque déploiement.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~superuser-password"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Tandoor exige **PostgreSQL 15** ; le moteur est imposé et aucun autre moteur n'est pris
en charge. Le `boot.sh` propre à Tandoor interroge `pg_isready` avant de poursuivre —
pas de connexion différée — de sorte que la base de données doit être joignable au
démarrage du conteneur.

Deux Jobs d'initialisation s'exécutent au premier déploiement, dans l'ordre des
dépendances :

1. **`db-init`** (`postgres:15-alpine`), de manière idempotente :
   - détecte le socket Unix du Cloud SQL Auth Proxy et l'associe pour l'accès `psql`,
   - attend que PostgreSQL soit joignable,
   - crée (ou met à jour) le rôle de l'application avec le mot de passe généré,
   - crée (ou reconfigure) la base de données de l'application, dont ce rôle est
     propriétaire,
   - accorde tous les privilèges,
   - signale au Cloud SQL Auth Proxy de s'arrêter proprement.
2. **`create-superuser`** (dépend de `db-init`, utilise l'image Tandoor principale), de
   manière idempotente :
   - réexporte les variables standard de la plateforme `DB_HOST`/`DB_PORT`/`DB_NAME`/
     `DB_USER`/`DB_PASSWORD` sous les noms `POSTGRES_*` que lisent réellement les
     paramètres Django de Tandoor (l'association `db_*_env_var_name` ne s'applique qu'au
     conteneur du service principal, pas aux Jobs d'initialisation),
   - applique les migrations Django (`manage.py migrate --noinput`) comme filet de
     sécurité — le job d'initialisation peut s'exécuter avant le tout premier démarrage
     du conteneur principal,
   - vérifie si le nom d'utilisateur du superutilisateur configuré existe déjà,
   - sinon, exécute `python manage.py createsuperuser --noinput`, qui lit
     `DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL` /
     `DJANGO_SUPERUSER_PASSWORD` depuis l'environnement.

Les deux jobs peuvent être relancés sans risque. Inspectez directement la base de données
avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

`Tandoor_Common` déploie directement `vabene1111/recipes` — `image_source =
"prebuilt"`, aucune étape Cloud Build, aucun wrapper de point d'entrée. Tandoor est
véritablement un conteneur unique tout-en-un : nginx s'exécute *à l'intérieur* et sert
de proxy vers gunicorn via un socket Unix (confirmé par le `boot.sh` propre à l'image),
de sorte qu'aucun sidecar nginx ni aucune entrée `additional_services` n'est nécessaire —
plus simple que certaines applications multiprocessus de ce catalogue. Tandoor publie un
véritable tag `latest`, de sorte que `application_version` est transmis tel quel comme
tag de l'image.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Tandoor_Common` établit l'environnement Tandoor de base afin que l'application démarre
correctement dès le premier démarrage :

- **`DB_ENGINE = "django.db.backends.postgresql"`** — sélectionne le véritable backend
  Postgres.
- **`ALLOWED_HOSTS = "*"`** — nécessaire car le nom d'hôte attribué par Cloud Run/GKE
  n'est connu qu'après le déploiement ; correspond au modèle établi pour les images Django
  préconstruites de ce catalogue (Netbox, Paperless, Saleor).
- **`PGSSLMODE`** — défini via la variable `db_ssl_mode` : `"require"` sur Cloud Run
  (l'alias `db_host_env_var_name` se résout en l'IP privée brute de Cloud SQL, qui refuse
  le TCP non chiffré), `"prefer"` sur GKE (la boucle locale du sidecar Cloud SQL Auth
  Proxy est déjà en clair).
- **`DJANGO_SUPERUSER_USERNAME` / `DJANGO_SUPERUSER_EMAIL`** — paramètres simples et non
  sensibles utilisés par le job `create-superuser` (par défaut
  `admin` / `admin@techequity.cloud`).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/accounts/login/` (démarrage) et un contrôle TCP d'écoute
du port (liveness) :

- **Démarrage** — HTTP `/accounts/login/`, la vue de connexion publique et non
  authentifiée de Django. Elle ne renvoie 200 qu'une fois que l'application s'est
  connectée à Postgres et a appliqué les migrations, ce qui en fait un véritable signal
  de disponibilité. Tandoor n'a pas de point de terminaison de santé ou d'information
  dédié ; celle-ci en tient lieu.
- **Liveness** — TCP (écoute du port uniquement). Un incident passager de la base de
  données ne doit pas faire osciller une instance qui a déjà réussi la sonde de
  démarrage, en revérifiant une page proche de l'authentification.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** `data` dédié (pour les images des recettes) est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail. Il **est** monté automatiquement : `Tandoor_Common` déclare une entrée
`gcs_volumes` qui monte `gcs-<app><prefix>-data` sur
`/opt/recipes/mediafiles` (le `MEDIA_ROOT` de Tandoor) avec
`implicit-dirs,uid=0,gid=0,file-mode=0644,dir-mode=0755` — sans cela, les images de
recettes téléversées résidaient sur le disque éphémère du conteneur et étaient perdues à
chaque redémarrage. Une valeur `gcs_volumes` fournie par l'opérateur reste prioritaire
(le socle la privilégie). `STATIC_ROOT` est régénéré à chaque démarrage et ne
nécessite aucune persistance.

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Tandoor destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[Tandoor_GKE](Tandoor_GKE.md)** et
**[Tandoor_CloudRun](Tandoor_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Tandoor sur Google Cloud Run](Tandoor_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Tandoor sur GKE Autopilot](Tandoor_GKE.md) — cette configuration déployée sur GKE.
