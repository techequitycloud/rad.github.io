---
title: "Zitadel Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Zitadel — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Zitadel_Common.md @ 944fee5 sha256:6017b292c575 -->

# Zitadel Common — Configuration applicative partagée {#zitadel-common--shared-application-configuration}

`Zitadel_Common` est la **couche applicative partagée** de Zitadel. Elle n'est pas déployée seule ; elle fournit la configuration propre à Zitadel sur laquelle s'appuient à la fois [Zitadel_GKE](Zitadel_GKE.md) et [Zitadel_CloudRun](Zitadel_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle ne possède aucune entrée d'interface de déploiement qui lui soit propre — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Zitadel, consultez les guides de plateforme ([Zitadel_GKE](Zitadel_GKE.md), [Zitadel_CloudRun](Zitadel_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Zitadel_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `ZITADEL_MASTERKEY` (exactement 32 octets) et le mot de passe administrateur initial, et les stocke dans **Secret Manager** | Injectés automatiquement dans le conteneur du service ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit un wrapper léger **FROM `ghcr.io/zitadel/zitadel`** avec un point d'entrée cloud, via Cloud Build ; répliqué dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge (`database_type = POSTGRES_15`) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données et le rôle avec `CREATEDB`/`CREATEROLE` et accorde les privilèges sur le schéma | Sortie `initialization_jobs` |
| Stockage objet | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement Zitadel de base : domaine externe/mode TLS, port, amorçage de l'organisation de la première instance et de l'administrateur humain | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage / de vivacité / de disponibilité par défaut ciblant `/debug/healthz` | §Observabilité dans les guides de plateforme |

Zitadel stocke **la totalité** de son état — organisations, utilisateurs, projets, applications, sessions, clés — dans PostgreSQL. Il n'y a ni Redis, ni file d'attente, ni persistance sur fichiers pour les données applicatives ; cette couche ne câble donc ni cache ni montage NFS.

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager. Ils sont nommés `secret-<resource_prefix>-zitadel-masterkey` et `secret-<resource_prefix>-zitadel-admin-password`.

- **`ZITADEL_MASTERKEY`** — une chaîne alphanumérique aléatoire de 32 caractères (exactement 32 octets). Zitadel l'utilise pour chiffrer les données sensibles **au repos** dans PostgreSQL (secrets clients, éléments de clés, codes à usage unique). Elle est transmise au binaire avec `--masterkeyFromEnv` et **doit faire exactement 32 octets et rester stable d'un redémarrage à l'autre**. La faire tourner après le premier démarrage rend illisibles toutes les données chiffrées auparavant — considérez-la comme immuable.
- **`ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD`** — un mot de passe aléatoire de 20 caractères (majuscules + minuscules + chiffres + symboles, issus de l'ensemble `!@#%^*-_=+`, sans risque pour les URL et la CLI). Zitadel attribue ce mot de passe à l'administrateur humain de la première organisation au premier démarrage, afin que l'instance ait un propriétaire connu. `PASSWORDCHANGEREQUIRED` est défini à `false`, vous pouvez donc vous connecter directement avec l'identifiant généré.

Récupérez les secrets après le déploiement :

```bash
# List this deployment's Zitadel secrets (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~zitadel-masterkey OR name~zitadel-admin-password"

# Read the initial admin password to log in the first time:
gcloud secrets versions access latest \
  --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Zitadel nécessite **PostgreSQL** (v13, v14 ou v15) ; le moteur par défaut et recommandé est **PostgreSQL 15**, et MySQL n'est pas pris en charge (une validation au moment du plan rejette tout `database_type` autre que Postgres). Au premier déploiement, un job ponctuel (`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte Cloud SQL — un répertoire de socket Unix (Cloud Run), `127.0.0.1` (sidecar Auth Proxy sur GKE) ou une IP privée — et attend que PostgreSQL accepte les connexions,
2. Crée (ou réconcilie via `ALTER ROLE`) le rôle de l'application avec **`LOGIN`, `CREATEDB` et `CREATEROLE`** — ces droits élevés sont nécessaires, car Zitadel exécute sa propre phase de configuration en tant qu'utilisateur « admin » de Postgres et crée/gère ses propres objets de schéma et rôles,
3. Crée la base de données de l'application si elle n'existe pas,
4. Accorde tous les privilèges sur la base de données et accorde le schéma `public` au rôle de l'application (en lui en transférant la propriété) (PostgreSQL 15 n'accorde plus `CREATE` sur `public` par défaut),
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin que le pod du Job GKE puisse se terminer.

Le job peut être réexécuté sans risque. **Zitadel exécute lui-même la création effective du schéma et les migrations** — `db-init` se contente de préparer la base de données vide et un rôle disposant de privilèges suffisants ; voir §5. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée cloud {#4-container-image-and-cloud-entrypoint}

L'image amont `ghcr.io/zitadel/zitadel` est **basée sur scratch** — seulement le binaire Go statique et les certificats d'autorité, sans `/bin/sh`, `/etc/passwd` ni `/etc/group`. Le module construit un wrapper léger qui greffe un `busybox` statique dans l'image afin qu'un point d'entrée shell puisse s'exécuter (conformément à la convention du dépôt pour les images scratch/distroless) :

- Le tag de base provient d'un **ARG de build propre à l'application, `ZITADEL_VERSION`** (et non de l'`APP_VERSION` générique, que le socle injecte et écrase avec `latest` — un tag que Zitadel ne publie pas toujours). `Zitadel_Common` convertit `application_version = "latest"` en un tag épinglé reconnu fiable (`v2.71.0`).
- Le point d'entrée est installé avec `COPY --chmod` (sans `RUN`, qui nécessiterait `/etc/group`) et invoqué via le `sh` de busybox greffé.
- Le `CMD` de l'image est `["/app/zitadel", "start-from-init", "--masterkeyFromEnv"]` — il ne fixe **pas** `--tlsMode` en dur. Zitadel considère ce flag CLI (et pas seulement la variable d'environnement `ZITADEL_EXTERNALSECURE`) comme faisant autorité pour déterminer s'il est joignable en HTTPS ; le flag est donc volontairement omis du `CMD` et ajouté dynamiquement par le point d'entrée (voir ci-dessous) — un `--tlsMode external` codé en dur déclarerait toujours HTTPS, même sur un déploiement en HTTP simple (GKE sans domaine personnalisé), inscrivant silencieusement des URL `https://` injoignables dans le `environment.json` de la Console.

Le point d'entrée cloud (`entrypoint.sh`) s'exécute avant le binaire et, en utilisant uniquement l'expansion de paramètres POSIX (sans `sed` — busybox ne dispose d'aucun lien symbolique `sed` dans le PATH) :

- **Mappe `DB_*` vers les variables distinctes `ZITADEL_DATABASE_POSTGRES_*` de Zitadel** — Zitadel lit des variables Postgres séparées, et non une unique `DATABASE_URL`. Le mode SSL dépend de l'hôte : un **répertoire de socket** `/…` → `disable` ; un **proxy en bouclage** `127.0.0.1`/`localhost` → `disable` ; sinon une **IP privée** → `require` (Cloud SQL rejette le TCP non chiffré sur IP privée). Le même rôle est utilisé à la fois pour la connexion `USER` et pour la connexion `ADMIN` de Zitadel (db-init lui a accordé `CREATEDB`/`CREATEROLE`).
- **Dérive `ZITADEL_EXTERNALDOMAIN`** — supprime le schéma et le chemin de `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` injectés pour obtenir l'hôte seul. Les opérateurs peuvent remplacer `ZITADEL_EXTERNALDOMAIN` pour un domaine personnalisé.
- **Définit `ZITADEL_PORT` à partir de `$PORT`** — Cloud Run réserve et injecte `PORT` (= `container_port`) ; le point d'entrée le lit (avec repli sur `8080` sur GKE, où `PORT` n'est pas défini) afin que le binaire écoute sur le bon port.
- **Calcule `--tlsMode` à partir de `ZITADEL_EXTERNALSECURE`** (`external` lorsqu'il vaut `"true"`, `disabled` sinon) et exécute `zitadel start-from-init --masterkeyFromEnv --tlsMode <mode>` en tant que PID 1 — c'est ce mécanisme qui permet au flag de suivre la variable d'environnement au lieu d'être fixé par le `CMD` de l'image.

---

## 5. Paramètres principaux de l'application et comportement au premier lancement {#5-core-application-settings-and-first-run-behaviour}

`Zitadel_Common` établit l'environnement Zitadel de base afin que la plateforme démarre correctement et dispose d'un propriétaire connu dès le premier lancement :

- **`start-from-init`** — Zitadel exécute **sa propre configuration et ses propres migrations de schéma (idempotentes)** avant de commencer à servir. Il n'existe pas de job de migration distinct ; la base de données vide créée par `db-init` est alimentée par Zitadel lui-même au premier démarrage.
- **Accès externe** — `ZITADEL_EXTERNALSECURE = "true"`, `ZITADEL_EXTERNALPORT = "443"`, `ZITADEL_TLS_ENABLED = "false"` : Zitadel sert du HTTP/2 en clair en interne et s'en remet au LoadBalancer Cloud Run / GKE en amont pour terminer le TLS sur `:443`.
- **Port** — le conteneur écoute sur le port **8080** et sert à la fois les API gRPC et REST ainsi que l'interface de la Console en HTTP/2.
- **Amorçage de la première instance** — au premier démarrage, Zitadel crée l'organisation initiale (`ZITADEL_FIRSTINSTANCE_ORG_NAME`, par défaut `ZITADEL`) et un administrateur humain (`ZITADEL_FIRSTINSTANCE_ORG_HUMAN_USERNAME`, par défaut `zitadel-admin`) dont le mot de passe est la valeur générée dans Secret Manager. `PASSWORDCHANGEREQUIRED = "false"` vous permet de vous connecter immédiatement avec l'identifiant généré.

`ZITADEL_MASTERKEY` et le mot de passe administrateur sont tous deux exposés via la sortie `secret_ids`, afin que la variante les câble sur le conteneur du **service** (start-from-init les consomme à cet endroit, et non dans un job distinct).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage, de vivacité et de disponibilité par défaut ciblent **`/debug/healthz`** — un point de terminaison sans authentification qui renvoie `200` dès que le serveur HTTP de Zitadel est démarré. Une fenêtre de démarrage généreuse laisse le temps à la configuration et aux migrations que Zitadel exécute au premier démarrage :

- **Sonde de démarrage** — HTTP `/debug/healthz`, délai initial de 60 secondes, période de 15 secondes, 30 échecs autorisés (~7.5 minutes après le délai) — suffisamment de temps pour la configuration du premier démarrage sur une instance Cloud SQL neuve.
- **Sonde de vivacité** — HTTP `/debug/healthz`, délai initial de 60 secondes, période de 30 secondes.
- **Sonde de disponibilité** — HTTP `/debug/healthz`, délai initial de 30 secondes, période de 10 secondes.

Comme les sondes interrogent un chemin public et sans authentification, elles réussissent dès que le serveur écoute sur son port — elles ne nécessitent pas d'authentification à la Console.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (déclaré avec le suffixe de nom `storage`, classe `STANDARD`, prévention de l'accès public appliquée) est provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Zitadel conserve son état principal dans PostgreSQL ; le bucket est à la disposition de l'opérateur (par exemple pour des exports ou le stockage de ressources). Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Zitadel destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Zitadel_GKE](Zitadel_GKE.md)** et **[Zitadel_CloudRun](Zitadel_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Zitadel sur Google Cloud Run](Zitadel_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Zitadel sur GKE Autopilot](Zitadel_GKE.md) — cette configuration déployée sur GKE.
