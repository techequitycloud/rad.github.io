---
title: "BookStack Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module BookStack — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/BookStack_Common.md @ 15fd4c7 sha256:21cb136722de -->

# BookStack Common — Configuration d'application partagée {#bookstack-common--shared-application-configuration}

`BookStack_Common` est la **couche d'application partagée** pour BookStack. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à BookStack que
[BookStack_GKE](BookStack_GKE.md) et
[BookStack_CloudRun](BookStack_CloudRun.md) utilisent, de sorte que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute BookStack, consultez les guides de plateforme
([BookStack_GKE](BookStack_GKE.md),
[BookStack_CloudRun](BookStack_CloudRun.md)) et les guides de socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par BookStack_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère la clé Laravel `APP_KEY` (`base64:<44-char base64>`) et la stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète `APP_KEY` |
| Image de conteneur | Fixe l'image pré-construite **`linuxserver/bookstack`** (pas de build personnalisé) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** comme seul moteur supporté | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `bookstack-uploads` | Sortie `storage_buckets` |
| Fichiers persistants | Déclare le montage **NFS** à `/var/lib/bookstack` pour les images et pièces jointes téléchargées | §Stockage dans les guides de plateforme |
| Paramètres de base | Définit `DB_CONNECTION = mysql`, `DB_PORT = 3306`, `APP_URL`, et les noms des variables d'environnement de base de données natives Laravel | Comportement de l'application dans les guides de plateforme |
| Sondes de santé | Fournit les sondes de démarrage (TCP) / de vivacité (HTTP `/status`) par défaut | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini
en texte clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_KEY`** — la clé d'application Laravel, au format `base64:<44-char base64>`
  (32 octets aléatoires, encodés en base64). Générée par `random_password` dans
  `BookStack_Common`, stockée comme secret `secret-<resource_prefix>-bookstack-app-key`,
  et injectée comme variable d'environnement secrète `APP_KEY`. BookStack l'utilise pour chiffrer toutes
  les données d'application stockées chiffrées (secrets à deux facteurs et certains paramètres). La rotation
  après le premier démarrage rend ces valeurs chiffrées indéchiffrables de manière permanente — elle est
  effectivement immuable pendant toute la durée de vie du déploiement.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; son
nom de secret est indiqué dans les sorties de déploiement de la plateforme (`database_password_secret`)
et il est injecté comme `DB_PASSWORD`. Voir [App_Common](App_Common.md) pour le secret partagé
et le modèle d'identité de charge de travail.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

BookStack nécessite **MySQL 8.0** (`database_type = "MYSQL_8_0"`) ; le moteur est fixe
et PostgreSQL ou d'autres moteurs ne sont pas supportés. Lors du premier déploiement, un job unique
(`db-init`) s'exécute en utilisant `mysql:8.0-debian` et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL ou le point de terminaison TCP et sélectionne la
   forme de connexion appropriée pour le client `mysql`,
2. Attend que MySQL soit accessible,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée la base de données de l'application,
5. Accorde tous les privilèges sur la base de données à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut se connecter,
7. Signale au sidecar du proxy d'authentification Cloud SQL de s'arrêter gracieusement
   (`POST /quitquitquit`).

Le job peut être relancé en toute sécurité (`max_retries = 3`). Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

**Note :** `db-init` provisionne uniquement la base de données, l'utilisateur et les autorisations — le schéma lui-même
est créé par l'automatique `php artisan migrate --force` de l'image lors du **premier
démarrage du conteneur** (et réappliqué lors des démarrages ultérieurs pour les mises à niveau). Il n'y a pas de
job de migration séparé.

---

## 4. Image de conteneur {#4-container-image}

BookStack est déployé à partir de l'image pré-construite officielle **LinuxServer.io**,
`linuxserver/bookstack:<version>` — il n'y a **pas de Cloud Build personnalisé**. Les modules d'application
transmettent `container_image_source = "prebuilt"` (et
`container_build_config.enabled = false`), de sorte que la plateforme met en miroir l'image dans
Artifact Registry (`enable_image_mirroring = true`) et la déploie directement.

Parce que BookStack est une application Laravel, elle lit les variables d'environnement de base de données
**natives Laravel** plutôt que les génériques `DB_USER`/`DB_PASS` de l'image. Les
modules d'application mappent les valeurs de base de données injectées par la plateforme sur les noms Laravel via
`db_*_env_var_name` :

- `db_user_env_var_name = "DB_USERNAME"`,
- `db_password_env_var_name = "DB_PASSWORD"`,
- `db_name_env_var_name = "DB_DATABASE"`.

`BookStack_Common` définit en outre les statiques `DB_CONNECTION = "mysql"` et
`DB_PORT = "3306"`. `DB_HOST` diffère selon la plateforme :

- **Cloud Run** se connecte via l'**IP privée** de Cloud SQL (`enable_cloudsql_volume = false`),
  donc `DB_HOST` est l'IP privée de l'instance ; MySQL sur TCP via IP privée n'a pas besoin de SSL.
- **GKE** se connecte via le **sidecar du proxy d'authentification** Cloud SQL
  (`enable_cloudsql_volume = true`), donc le câblage GKE remplace `DB_HOST = "127.0.0.1"`.

L'image LinuxServer exécute `php artisan migrate --force` au démarrage (voir §3), donc aucun
point d'entrée personnalisé n'est nécessaire pour créer le schéma.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`BookStack_Common` établit l'environnement BookStack de base afin que l'application
démarre correctement au premier démarrage :

- **Connexion à la base de données** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"` ; les
  variables natives Laravel `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` et `DB_HOST` sont
  injectées par le socle (voir §4).
- **URL de l'application** — `APP_URL` est l'URL publique du service afin que les liens, les ressources et
  les redirections de connexion se résolvent à l'adresse réelle : l'URL `run.app` prédite sur Cloud
  Run, et sur GKE le placeholder `$(GKE_SERVICE_URL)`, que le socle résout
  à l'adresse de l'équilibreur de charge au moment du déploiement (jamais le nom DNS intra-cluster).
- **Redis (facultatif)** — lorsque Redis est activé via les paramètres de déploiement de la plateforme,
  `REDIS_HOST` et `REDIS_PORT` sont injectés afin que BookStack puisse utiliser Redis pour le cache et
  les sessions ; sinon, BookStack utilise ses pilotes locaux.
- **Administrateur de première exécution** — l'image LinuxServer amorce un compte administrateur par défaut,
  `admin@admin.com` / `password`. Changez-le immédiatement après la première connexion.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut s'appuient sur la surface de santé publique de BookStack :

- **Démarrage** — une vérification TCP sur le port `80`, qui réussit dès que le serveur web PHP
  lie son port.
- **Vivacité** — un `GET /status` HTTP, le **point de terminaison de santé JSON non authentifié** de BookStack
  qui rapporte l'état de l'application/base de données/cache/session. Une fenêtre généreuse de premier démarrage
  (délai initial de 300 secondes) prend en charge l'automatique
  `php artisan migrate --force` qui s'exécute au premier démarrage du conteneur.

> Sur la variante GKE, la valeur par défaut `liveness_probe` fournie pointe déjà vers
> `/status` — aucune surcharge n'est nécessaire pour une signalisation de santé BookStack précise.

---

## 7. Stockage d'objets et fichiers persistants {#7-object-storage--persistent-files}

Deux surfaces de stockage sont déclarées ici et provisionnées par le socle :

- **Cloud Storage** — un bucket `bookstack-uploads` dédié (dans la région de déploiement,
  `force_destroy = true`) ; le compte de service de la charge de travail est autorisé à y accéder.
- **NFS** — activé par défaut (`enable_nfs = true`) et monté à
  `/var/lib/bookstack`, où BookStack stocke les images, les pièces jointes et
  les fichiers téléchargés afin qu'ils persistent après les redémarrages, les redéploiements et les événements de mise à l'échelle.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à BookStack et destinée à l'utilisateur (variables par groupe, sorties,
et comment explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[BookStack_GKE](BookStack_GKE.md)** et
**[BookStack_CloudRun](BookStack_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [BookStack sur Google Cloud Run](BookStack_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [BookStack sur GKE Autopilot](BookStack_GKE.md) — cette configuration déployée sur GKE.
