---
title: "BookStack Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module BookStack — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/BookStack_Common.md @ 3055034 sha256:5bf2a8aa6802 -->

# BookStack Common — Configuration applicative partagée {#bookstack-common--shared-application-configuration}

`BookStack_Common` est la **couche applicative partagée** de BookStack. Elle n'est
pas déployée seule ; elle fournit la configuration propre à BookStack sur laquelle
s'appuient à la fois [BookStack_GKE](BookStack_GKE.md) et
[BookStack_CloudRun](BookStack_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où c'est important. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune
entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement BookStack, consultez
les guides des plateformes ([BookStack_GKE](BookStack_GKE.md),
[BookStack_CloudRun](BookStack_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par BookStack_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère l'`APP_KEY` Laravel (`base64:<44-char base64>`) et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète `APP_KEY` |
| Image de conteneur | Fixe l'image précompilée **`linuxserver/bookstack`** (pas de build personnalisé) | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Output `initialization_jobs` |
| Stockage objet | Déclare le bucket **Cloud Storage** `bookstack-uploads` | Output `storage_buckets` |
| Fichiers persistants | Déclare le montage **NFS** sur `/var/lib/bookstack` pour les images et pièces jointes téléversées | §Stockage dans les guides des plateformes |
| Paramètres principaux | Définit `DB_CONNECTION = mysql`, `DB_PORT = 3306`, `APP_URL` et les noms de variables d'environnement de base de données natifs de Laravel | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes par défaut de démarrage (TCP) / de vivacité (HTTP `/status`) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_KEY`** — la clé d'application Laravel, au format `base64:<44-char base64>`
  (32 octets aléatoires encodés en base64). Générée par `random_password` dans
  `BookStack_Common`, stockée comme secret `secret-<resource_prefix>-bookstack-app-key`
  et injectée comme variable d'environnement secrète `APP_KEY`. BookStack l'utilise
  pour chiffrer toutes les données d'application stockées sous forme chiffrée
  (secrets d'authentification à deux facteurs et certains paramètres). La faire
  tourner après le premier démarrage rend ces valeurs chiffrées définitivement
  indéchiffrables — elle est de fait immuable pendant toute la durée de vie du
  déploiement.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`) et il est injecté comme `DB_PASSWORD`. Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

BookStack nécessite **MySQL 8.0** (`database_type = "MYSQL_8_0"`) ; le moteur est
fixe et PostgreSQL ou d'autres moteurs ne sont pas pris en charge. Lors du premier
déploiement, un job ponctuel (`db-init`) s'exécute avec `mysql:8.0-debian` et, de
manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy ou le point de terminaison TCP et
   choisit la forme de connexion appropriée pour le client `mysql`,
2. Attend que MySQL soit joignable,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée la base de données de l'application,
5. Accorde tous les privilèges sur la base à l'utilisateur de l'application,
6. Vérifie que l'utilisateur de l'application peut se connecter,
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement
   (`POST /quitquitquit`).

Le job peut être relancé sans risque (`max_retries = 3`). Inspectez directement la
base de données avec :

```bash
gcloud sql connect <instance-name> --user=bookstack --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

**Remarque :** `db-init` ne provisionne que la base de données, l'utilisateur et les
droits — le schéma lui-même est créé par l'exécution automatique de
`php artisan migrate --force` par l'image au **premier démarrage du conteneur** (puis
réappliqué lors des démarrages suivants pour les mises à niveau). Il n'y a pas de job
de migration distinct.

---

## 4. Image de conteneur {#4-container-image}

BookStack est déployé à partir de l'image précompilée officielle de
**LinuxServer.io**, `linuxserver/bookstack:<version>` — il n'y a **pas de Cloud Build
personnalisé**. Les modules applicatifs transmettent
`container_image_source = "prebuilt"` (et `container_build_config.enabled = false`),
si bien que la plateforme duplique l'image dans Artifact Registry
(`enable_image_mirroring = true`) et la déploie directement.

Comme BookStack est une application Laravel, il lit les variables d'environnement de
base de données **natives de Laravel** plutôt que les variables génériques
`DB_USER`/`DB_PASS` de l'image. Les modules applicatifs associent les valeurs de base
de données injectées par la plateforme aux noms Laravel via `db_*_env_var_name` :

- `db_user_env_var_name = "DB_USERNAME"`,
- `db_password_env_var_name = "DB_PASSWORD"`,
- `db_name_env_var_name = "DB_DATABASE"`.

`BookStack_Common` définit en outre les valeurs statiques `DB_CONNECTION = "mysql"` et
`DB_PORT = "3306"`. `DB_HOST` diffère selon la plateforme :

- **Cloud Run** se connecte via l'**IP privée** de Cloud SQL (`enable_cloudsql_volume = false`),
  donc `DB_HOST` est l'IP privée de l'instance ; MySQL en TCP via l'IP privée ne
  nécessite pas SSL.
- **GKE** se connecte via le **sidecar Auth Proxy** de Cloud SQL
  (`enable_cloudsql_volume = true`), donc le câblage GKE remplace `DB_HOST = "127.0.0.1"`.

L'image LinuxServer exécute `php artisan migrate --force` au démarrage (voir §3), si
bien qu'aucun point d'entrée personnalisé n'est nécessaire pour créer le schéma.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`BookStack_Common` établit l'environnement BookStack de base afin que l'application
démarre correctement dès le premier démarrage :

- **Connexion à la base de données** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"` ;
  les variables natives de Laravel `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` et
  `DB_HOST` sont injectées par le socle (voir §4).
- **URL de l'application** — `APP_URL` est défini à partir de l'URL prévue du service,
  afin que les liens, les ressources et les redirections de connexion pointent vers
  la véritable adresse.
- **Redis (facultatif)** — lorsque Redis est activé via les paramètres de déploiement
  de la plateforme, `REDIS_HOST` et `REDIS_PORT` sont injectés afin que BookStack
  puisse utiliser Redis pour le cache et les sessions ; sinon, BookStack utilise ses
  pilotes locaux.
- **Administrateur au premier lancement** — l'image LinuxServer crée un compte
  administrateur par défaut, `admin@admin.com` / `password`. Modifiez-le
  immédiatement après la première connexion.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut s'appuient sur la surface de santé publique de BookStack :

- **Démarrage** — un contrôle TCP sur le port `80`, qui réussit dès que le serveur
  web PHP s'attache à son port.
- **Vivacité** — un HTTP `GET /status`, le **point de terminaison de santé JSON non
  authentifié** de BookStack, qui indique l'état de l'application, de la base de
  données, du cache et des sessions. Une fenêtre généreuse au premier démarrage (délai
  initial de 300 secondes) laisse le temps à l'exécution automatique de
  `php artisan migrate --force` au premier démarrage du conteneur.

> Sur la variante GKE, la valeur par défaut livrée de `liveness_probe` pointe déjà
> vers `/status` — aucune surcharge n'est nécessaire pour un signalement précis de la
> santé de BookStack.

---

## 7. Stockage objet et fichiers persistants {#7-object-storage--persistent-files}

Deux surfaces de stockage sont déclarées ici et provisionnées par le socle :

- **Cloud Storage** — un bucket `bookstack-uploads` dédié (dans la région du
  déploiement, `force_destroy = true`) ; le compte de service de la charge de travail
  y reçoit l'accès.
- **NFS** — activé par défaut (`enable_nfs = true`) et monté sur
  `/var/lib/bookstack`, où BookStack stocke les images, pièces jointes et fichiers
  téléversés, afin qu'ils persistent après les redémarrages, les redéploiements et
  les événements de mise à l'échelle.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration de BookStack destinée aux utilisateurs (variables par groupe,
outputs, et comment explorer chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[BookStack_GKE](BookStack_GKE.md)** et
**[BookStack_CloudRun](BookStack_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [BookStack sur Google Cloud Run](BookStack_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [BookStack sur GKE Autopilot](BookStack_GKE.md) — cette configuration déployée sur GKE.
