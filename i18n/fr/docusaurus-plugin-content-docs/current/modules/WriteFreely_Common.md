---
title: "WriteFreely Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module WriteFreely — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/WriteFreely_Common.md @ 944fee5 sha256:f3955ce111b2 -->

# WriteFreely Common — Configuration applicative partagée {#writefreely-common--shared-application-configuration}

`WriteFreely_Common` est la **couche applicative partagée** de WriteFreely. Elle n'est pas déployée seule ; elle fournit la configuration propre à WriteFreely sur laquelle s'appuient à la fois [WriteFreely_GKE](WriteFreely_GKE.md) et [WriteFreely_CloudRun](WriteFreely_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle ne possède aucune entrée d'interface de déploiement qui lui soit propre — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement WriteFreely, consultez les guides de plateforme ([WriteFreely_GKE](WriteFreely_GKE.md), [WriteFreely_CloudRun](WriteFreely_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par WriteFreely_Common | Où cela apparaît |
|---|---|---|
| Clés cryptographiques | Génère trois fichiers de clés **AES-256 (32 octets)** — `cookies_auth`, `cookies_enc`, `email` — et les stocke dans **Secret Manager** en base64 | Injectées sous forme de `WF_KEY_COOKIES_AUTH` / `WF_KEY_COOKIES_ENC` / `WF_KEY_EMAIL` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit un **wrapper personnalisé léger** au-dessus de l'image officielle `writeas/writefreely`, en ajoutant un point d'entrée de génération de configuration ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** (`database_type = MYSQL_8_0`) comme moteur | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Initialisation du schéma | Le point d'entrée exécute `writefreely db init` à chaque démarrage pour créer les tables | §Comportement de l'application dans les guides de plateforme |
| Stockage objet | Déclare un bucket de données **Cloud Storage** (`writefreely-uploads`) | Sortie `storage_buckets` |
| Paramètres principaux | Génère `config.ini` à partir des variables `DB_*` injectées ; définit l'adresse d'écoute, le port, l'hôte public et l'état des inscriptions | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP `/` par défaut | §Observabilité dans les guides de plateforme |

---

## 2. Clés cryptographiques dans Secret Manager {#2-cryptographic-keys-in-secret-manager}

WriteFreely refuse de démarrer sans ses trois fichiers de clés AES-256 (32 octets bruts chacun, écrits dans `keys/cookies_auth.aes256`, `keys/cookies_enc.aes256` et `keys/email.aes256`). Si l'on laissait l'application exécuter `writefreely keys generate`, elle produirait *de nouvelles clés aléatoires à chaque démarrage du conteneur* — ce qui invalide toutes les sessions au redémarrage et, pire encore, casse tout déploiement multi-instances (chaque instance signerait les cookies avec une clé différente, de sorte qu'un cookie émis par l'instance A serait rejeté par l'instance B, provoquant une boucle de connexion).

`WriteFreely_Common` génère donc les trois clés **une seule fois** au moment du plan (sous forme de ressources `random_id` avec `byte_length = 32`, encodées en base64), les stocke dans Secret Manager et les injecte comme variables d'environnement secrètes. Le point d'entrée décode chacune d'elles depuis le base64 dans le répertoire `keys/` avant de démarrer le serveur :

- **`WF_KEY_COOKIES_AUTH`** → `keys/cookies_auth.aes256` — authentifie (signe) les cookies de session.
- **`WF_KEY_COOKIES_ENC`** → `keys/cookies_enc.aes256` — chiffre le contenu des cookies de session.
- **`WF_KEY_EMAIL`** → `keys/email.aes256` — chiffre les adresses e-mail stockées.

Les trois secrets Secret Manager sont nommés :

```
secret-<resource-prefix>-writefreely-cookies-auth
secret-<resource-prefix>-writefreely-cookies-enc
secret-<resource-prefix>-writefreely-email-key
```

Ces clés ne doivent **jamais** faire l'objet d'une rotation après le premier déploiement — leur rotation déconnecte tous les utilisateurs et rend indéchiffrables les adresses e-mail chiffrées auparavant. Un sous-module `cleanup_orphaned_secrets` supprime les éventuels secrets obsolètes de même nom avant leur (re)création, et un `time_sleep` de 30 secondes protège contre les problèmes de cohérence lecture-après-écriture lorsque les valeurs sont consommées.

Récupérez les clés après le déploiement :

```bash
# List the WriteFreely key secrets (names include the resource prefix):
gcloud secrets list --project "$PROJECT" \
  --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"

# Read a secret version (base64 of the raw 32-byte key):
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

L'image standard `writeas/writefreely` attend un fichier `config.ini` et des fichiers de clés pré-générés, et ne dispose d'**aucun mécanisme pour obtenir les coordonnées de sa base de données depuis l'environnement**. Comme Cloud Run et GKE ne peuvent pas monter un fichier de configuration fourni par l'hôte, `WriteFreely_Common` intègre un wrapper léger (`Dockerfile` + `entrypoint.sh`) au-dessus de l'image officielle et le construit avec Cloud Build (`image_source = "custom"`).

Le Dockerfile dérive son tag de base d'un ARG de build **propre à l'application**, `WRITEFREELY_VERSION` (par défaut `0.12.0`) — *et non* de l'`APP_VERSION` générique, que le socle injecte dans `build_args` et qui l'écraserait sinon avec `latest`. `WriteFreely_Common` convertit une `application_version` valant `latest` en tag épinglé reconnu fiable avant de définir l'ARG, ce qui garantit une résolution déterministe de l'image de base.

Le point d'entrée de génération de configuration (`entrypoint.sh`, un script Alpine `/bin/sh`) s'exécute avant le binaire WriteFreely et :

1. **Localise le binaire et la racine des ressources** — résout le binaire `writefreely` et le répertoire de travail qui contient réellement `templates/` (WriteFreely résout `templates/`, `static/`, `pages/`, `keys/` et `config.ini` relativement au répertoire courant).
2. **Génère `config.ini`** — écrit les sections `[server]`, `[database]` et `[app]` à partir des variables `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` injectées par le socle et des paramètres `WF_*` (`WF_BIND`, `WF_PORT`, `WF_PUBLIC_URL`, `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_OPEN_REGISTRATION`). `[database] type = mysql` est fixé.
3. **Installe les clés de chiffrement stables** — décode depuis le base64 les variables d'environnement secrètes `WF_KEY_*` dans `keys/*.aes256` ; ne génère des clés éphémères qu'en leur absence.
4. **Initialise le schéma** — exécute `writefreely db init` (en tolérant « tables already exist » afin que les redémarrages n'échouent pas).
5. **Sert l'application** — `exec writefreely serve` en tant que PID 1, à l'écoute sur `0.0.0.0:8080`.

L'hôte public utilisé pour les liens générés provient de `WF_PUBLIC_URL`, avec repli sur `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injectés par le socle.

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

WriteFreely est provisionné sur **Cloud SQL for MySQL 8.0** (`database_type =
MYSQL_8_0`) ; les noms par défaut de la base de données et de l'utilisateur sont tous deux `writefreely`. Au premier déploiement, un job ponctuel (`db-init`) s'exécute avec `mysql:8.0-debian` et, de manière idempotente :

1. Résout la connexion — privilégie le socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` lorsqu'il est monté, sinon se rabat sur TCP via `DB_IP` (IP privée),
2. Attend que le port MySQL 3306 soit joignable,
3. Crée (ou met à jour) l'utilisateur de l'application avec le mot de passe généré,
4. Crée la base de données de l'application si elle n'existe pas,
5. Accorde `ALL PRIVILEGES` sur la base de données à l'utilisateur de l'application (ce qui permet au propre `writefreely db init` de l'application de créer les tables au démarrage),
6. Vérifie que l'utilisateur de l'application peut s'authentifier (ce qui alimente le cache serveur `caching_sha2_password` de MySQL 8), puis arrête proprement le sidecar Cloud SQL Proxy via `quitquitquit`.

Le job peut être réexécuté sans risque (`CREATE ... IF NOT EXISTS`, `max_retries = 3`). Le schéma des *tables* lui-même est créé par le point d'entrée de l'application (`writefreely db init`), et non par ce job. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`WriteFreely_Common` établit l'environnement WriteFreely de base afin que l'application démarre correctement dès le premier lancement :

- **Adresse d'écoute et port** — `WF_BIND = "0.0.0.0"`, `WF_PORT = "8080"` ; `DB_PORT = "3306"`.
- **Hôte public** — `WF_PUBLIC_URL` est défini sur l'URL prévue du service lorsqu'elle est connue, et le point d'entrée se rabat à l'exécution sur `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injectés par le socle — ainsi, les liens de fédération et les redirections utilisent l'hôte réel.
- **Inscriptions** — `open_registration = false` par défaut (à remplacer avec `WF_OPEN_REGISTRATION`), `single_user = false`, `max_blogs = 1`, `federation =
  false`, `public_stats = true`. Aucun compte administrateur n'est créé automatiquement — consultez les étapes du premier lancement dans les guides de plateforme.
- **Métadonnées du site** — `WF_SITE_NAME` (par défaut `WriteFreely`) et `WF_SITE_DESCRIPTION` (vide) peuvent être fournis via `environment_variables`.

Ajustements propres à chaque plateforme, gérés par les wrappers de variante :

- **Cloud Run** se connecte à MySQL en **TCP sur IP privée** (`enable_cloudsql_volume =
  false`) ; Cloud SQL MySQL accepte le TCP non chiffré sur IP privée, donc `DB_HOST` est l'IP privée de l'instance.
- **GKE** se connecte via le **sidecar Cloud SQL Auth Proxy** et remplace `DB_HOST = 127.0.0.1` (`enable_cloudsql_volume = true`).

> **Remarque — reliquats du gabarit WordPress.** WriteFreely est une application **Go** et
> n'utilise **ni** PHP **ni** Redis. Les variables `php_memory_limit`, `upload_max_filesize`,
> `post_max_size`, `enable_redis`, `redis_host` et `redis_port` sont
> héritées du gabarit du module et **ne sont pas utilisées** par WriteFreely ; leurs
> valeurs par défaut sont inertes pour cette application.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

WriteFreely sert sa page d'accueil sur `/` et y renvoie un `200` dès que le serveur est démarré et connecté à MySQL — il n'existe pas de point de terminaison `/health` dédié. Les valeurs par défaut en tiennent compte :

- **Sonde de démarrage** — **TCP** sur le port du conteneur (`type = "TCP"`, délai initial de 30 secondes, période de 15 secondes, seuil de 20 échecs ≈ 5 minutes) — la charge de travail devient Ready dès qu'elle écoute sur le port 8080, indépendamment de la latence de la base de données au premier démarrage.
- **Sonde de vivacité** — **HTTP** `GET /` (délai initial de 300 secondes, période de 60 secondes, seuil de 3 échecs) — redémarre le conteneur si la page d'accueil cesse de répondre.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket de données **Cloud Storage** dédié (suffixe de nom `writefreely-uploads`) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à WriteFreely destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[WriteFreely_GKE](WriteFreely_GKE.md)** et
**[WriteFreely_CloudRun](WriteFreely_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [WriteFreely sur GKE Autopilot](WriteFreely_GKE.md) — cette configuration déployée sur GKE.
