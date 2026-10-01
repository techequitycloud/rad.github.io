---
title: "Firefly III Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Firefly III — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/FireflyIII_Common.md @ 3055034 sha256:e92be620ea57 -->

# Firefly III Common — Configuration applicative partagée {#firefly-iii-common--shared-application-configuration}

`FireflyIII_Common` est la **couche applicative partagée** de Firefly III. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Firefly III sur
laquelle s'appuient à la fois [FireflyIII_GKE](FireflyIII_GKE.md) et
[FireflyIII_CloudRun](FireflyIII_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Firefly III, consultez
les guides des plateformes ([FireflyIII_GKE](FireflyIII_GKE.md),
[FireflyIII_CloudRun](FireflyIII_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par FireflyIII_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère l'`APP_KEY` Laravel (`base64:<44-char base64>`) et un `STATIC_CRON_TOKEN` de 32 caractères, et les stocke dans **Secret Manager** | Injectés automatiquement en tant que `APP_KEY` / `STATIC_CRON_TOKEN` ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Utilise directement l'image officielle préconstruite `fireflyiii/core:<version>` — sans Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (`DB_CONNECTION = pgsql`) comme seul moteur | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée le rôle et la base de données et accorde les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** des téléversements | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de Firefly III : connexion, mode SSL, proxys de confiance, URL de l'application, environnement | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage (TCP) / d'activité (`/health`) par défaut | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en clair et ne doivent jamais être modifiés après le premier
déploiement :

- **`APP_KEY`** — la clé d'application Laravel, générée sous la forme
  `"base64:${base64encode(<32 random bytes>)}"` (une chaîne base64 de 44 caractères
  après le préfixe `base64:`), ce qui correspond exactement à ce qu'attend le
  chiffrement AES-256-CBC de Laravel. Firefly III l'utilise pour chiffrer les champs
  sensibles au repos. **Sa rotation après le premier démarrage rend illisibles les
  données chiffrées auparavant** — elle est générée une seule fois et laissée
  intacte.
- **`STATIC_CRON_TOKEN`** — une chaîne alphanumérique aléatoire de 32 caractères.
  Elle authentifie le point de terminaison cron de Firefly III
  (`GET /api/v1/cron/<STATIC_CRON_TOKEN>`), qui pilote les transactions récurrentes,
  les rappels de factures et les budgets automatiques. Le jeton **doit comporter
  exactement 32 caractères**, sinon Firefly III rejette la requête.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~app-key OR name~cron-token"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Firefly III nécessite **PostgreSQL 15** ; le moteur est imposé
(`database_type = "POSTGRES_15"`, `DB_CONNECTION = "pgsql"`) et MySQL ou les autres
moteurs ne sont pas utilisés par ce module. Lors du premier déploiement, une tâche
ponctuelle (`db-init`) s'exécute avec `postgres:15-alpine` et, de manière
idempotente :

1. Résout l'hôte de la base de données — une IP privée Cloud SQL (Cloud Run) ou
   `127.0.0.1` (le sidecar Auth Proxy sur GKE), avec repli sur `DB_IP`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif avec `LOGIN CREATEDB` et le mot de passe
   généré,
4. Crée la base de données de l'application si elle n'existe pas (propriété de
   `postgres`, car la connexion `postgres` de Cloud SQL ne peut pas faire `SET ROLE`
   vers les rôles applicatifs),
5. Accorde `ALL PRIVILEGES` sur la base de données et `ALL ON SCHEMA public` au
   rôle applicatif, et transfère la propriété du schéma `public` (Postgres 15
   n'accorde plus `CREATE` sur `public` par défaut).

Il n'existe **aucune tâche de migration séparée**. L'image `fireflyiii/core`
exécute `php artisan migrate --force` et `firefly-iii:upgrade-database` au démarrage
du conteneur ; le schéma est donc créé et mis à niveau au premier démarrage, une
fois que `db-init` a provisionné la base de données et le rôle. La tâche `db-init`
peut être réexécutée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

Firefly III exécute directement l'image officielle préconstruite
**`fireflyiii/core:<application_version>`** — `image_source = "prebuilt"`, sans étape
Cloud Build ni Dockerfile personnalisé. Le conteneur sert l'application Laravel via
**Apache sur le port 8080**. Les modules applicatifs transmettent
`container_image_source` et `container_image` afin que le socle déploie cette image,
plutôt que de faire pointer le service vers un chemin Artifact Registry jamais
construit.

L'image effectue elle-même ses migrations au démarrage
(`php artisan migrate --force` + `firefly-iii:upgrade-database`) ; la mise à niveau
d'`application_version` applique donc les modifications de schéma au démarrage
suivant, sans étape de migration séparée.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`FireflyIII_Common` établit l'environnement de base de Firefly III (Laravel) afin
que l'application démarre correctement dès le premier lancement. Firefly III lit les
variables de base de données natives de Laravel ; le module applicatif définit donc
`db_name_env_var_name = "DB_DATABASE"`, `db_user_env_var_name = "DB_USERNAME"` et
`db_password_env_var_name = "DB_PASSWORD"`, et le socle les renseigne avec les noms
de rôle/base de données propres au déploiement, en plus de `DB_HOST` et `DB_PORT` :

- **`DB_CONNECTION = "pgsql"`**, **`DB_PORT = "5432"`**.
- **`PGSQL_SSL_MODE`** — le sslmode de libpq/PDO. `"require"` sur **Cloud Run**
  (TCP sur IP privée vers Cloud SQL, qui refuse le texte en clair) ; `"prefer"` sur
  **GKE** (la boucle locale du sidecar Cloud SQL Auth Proxy est en clair ; TLS est
  donc négocié mais pas exigé).
- **`DB_HOST`** — l'IP privée Cloud SQL sur Cloud Run ; `127.0.0.1` sur GKE (le
  sidecar du proxy).
- **`TRUSTED_PROXIES = "**"`** — Firefly s'exécute derrière le proxy inverse de
  Cloud Run / GKE Gateway ; il fait donc confiance à tous les proxys afin de
  construire des URL absolues correctes et de respecter `X-Forwarded-*`.
- **`APP_ENV = "production"`**.
- **`APP_URL`** — défini sur l'URL prévue du service sur Cloud Run (via
  `service_url`) ; sur GKE, il revient à l'opérateur de définir le véritable hôte
  utilisé par le navigateur via `application_domains` / `APP_URL`.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** définit `APP_URL` à partir de l'URL de service `run.app` prévue au
  moment du plan et se connecte à Cloud SQL en TCP sur IP privée avec
  `sslmode=require`.
- **GKE** remplace `DB_HOST = 127.0.0.1` (le sidecar Auth Proxy) et conserve
  `sslmode=prefer` ; l'opérateur définit `APP_URL` sur l'URL du LoadBalancer ou du
  domaine personnalisé une fois l'IP externe connue.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

- **La sonde de démarrage** est une sonde **TCP** sur le port 8080 (l'application
  est prête dès qu'Apache se lie à son port), ce qui évite les problèmes de
  redirection/d'authentification sur un chemin HTTP pendant le démarrage.
- **La sonde de vivacité** cible le point de terminaison non authentifié
  **`/health`** de Firefly III, qui renvoie HTTP 200 sans connexion — un signal de
  santé qui ne nécessite pas de session. Un délai initial généreux absorbe les
  migrations de schéma exécutées au premier démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié aux téléversements (`fireflyiii-uploads`) est
déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de
service de la charge de travail. Sur GKE comme sur Cloud Run, le répertoire des
pièces jointes et des données d'exécution de Firefly III est également adossé au
montage NFS (Filestore) facultatif sur `/var/lib/fireflyiii`. Listez le bucket
avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

## 8. Première exécution {#8-first-run}

Aucun identifiant administrateur n'est créé à l'avance dans Secret Manager. Lors de
la première visite, Firefly III présente un formulaire **`/register`** ; le
**premier compte créé devient propriétaire/administrateur du site**. Une fois ce
compte créé, désactivez l'inscription ouverte dans **Administration → Settings**
pour empêcher toute création de compte non autorisée. Les jetons d'accès personnels
(Personal Access Tokens) propres à Firefly III (pour son API REST et l'outil
compagnon Data Importer) sont créés depuis l'application en cours d'exécution — ils
sont distincts du `STATIC_CRON_TOKEN` de la plateforme.

---

Pour la configuration propre à Firefly III visible par l'utilisateur (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[FireflyIII_GKE](FireflyIII_GKE.md)** et
**[FireflyIII_CloudRun](FireflyIII_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Firefly III sur GKE Autopilot](FireflyIII_GKE.md) — cette configuration déployée sur GKE.
