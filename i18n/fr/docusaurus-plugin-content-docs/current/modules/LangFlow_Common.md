---
title: "LangFlow Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module LangFlow — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LangFlow_Common.md @ 3055034 sha256:e9d543fa4b10 -->

# LangFlow Common — Configuration applicative partagée {#langflow-common--shared-application-configuration}

`LangFlow_Common` est la **couche applicative partagée** de LangFlow. Elle n'est pas
déployée seule ; elle fournit la configuration propre à LangFlow sur laquelle
s'appuient à la fois [LangFlow_GKE](LangFlow_GKE.md) et
[LangFlow_CloudRun](LangFlow_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement LangFlow, consultez les
guides de plateforme ([LangFlow_GKE](LangFlow_GKE.md),
[LangFlow_CloudRun](LangFlow_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par LangFlow_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `LANGFLOW_SECRET_KEY` (32 octets aléatoires, base64url) et `LANGFLOW_SUPERUSER_PASSWORD` (mot de passe de 32 caractères) et les stocke dans **Secret Manager** | Injectés automatiquement comme variables d'environnement secrètes du conteneur ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `langflowai/langflow` avec un point d'entrée shell léger ; construite via Cloud Build (`image_source = "custom"`, tag de base épinglé sur `1.10.2` lorsque `application_version = "latest"`) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (`database_type = "POSTGRES_15"`) comme seul moteur pris en charge | Section base de données des guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, le rôle et les droits à l'aide de `postgres:15-alpine` | Sortie `initialization_jobs` |
| Stockage d'objets | **Aucun** — LangFlow conserve les flux et les identifiants dans Postgres ; `storage_buckets` est donc vide | Sortie `storage_buckets` (`[]`) |
| Paramètres de base | Définit l'environnement LangFlow de référence : port `7860`, hôte `0.0.0.0`, `LANGFLOW_AUTO_LOGIN = "false"`, nom d'utilisateur du superutilisateur | Comportement de l'application dans les guides de plateforme |
| Vérifications de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/health` | Section observabilité des guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en texte clair. Leurs ID Secret Manager deviennent les **noms**
des variables d'environnement secrètes du conteneur SERVICE (la variante de
plateforme câble `module_secret_env_vars = secret_ids`) :

- **`LANGFLOW_SECRET_KEY`** — 32 octets aléatoires encodés en base64url. LangFlow
  l'utilise pour chiffrer chaque identifiant stocké (clés d'API, secrets de connexion
  intégrés dans les flux). S'il n'est pas défini, LangFlow génère une clé éphémère
  propre à chaque instance ; une clé stable est donc épinglée ici. **Sa rotation
  après le premier démarrage casse définitivement tous les identifiants stockés** —
  ceux-ci ne peuvent plus être déchiffrés et doivent être ressaisis dans chaque flux.
- **`LANGFLOW_SUPERUSER_PASSWORD`** — un mot de passe généré de 32 caractères (sans
  caractères spéciaux). Comme `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow provisionne
  son compte administrateur initial au premier démarrage à partir de
  `LANGFLOW_SUPERUSER` (le nom d'utilisateur, `admin` par défaut) et de ce mot de
  passe. C'est le mot de passe avec lequel vous vous connectez.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~-password"

# Read the admin login password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

LangFlow requiert **PostgreSQL 15** ; le moteur est imposé, et MySQL ou d'autres
moteurs ne sont pas pris en charge. Au premier déploiement, un job ponctuel
(`db-init`) s'exécute avec `postgres:15-alpine` (`create-db-and-user.sh`) et, de
manière idempotente :

1. Résout l'hôte Cloud SQL (`DB_HOST`, ou `DB_IP` en repli),
2. Attend que PostgreSQL soit joignable,
3. Crée le rôle applicatif (ou met à jour son mot de passe),
4. Lui accorde `CREATEDB` et crée la base de données applicative (ou en réattribue
   le propriétaire),
5. Accorde tous les privilèges sur la base de données et sur le schéma `public`,
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement
   (`POST /quitquitquit`) afin que le job puisse se terminer correctement sur GKE.

Le job peut être relancé sans risque. LangFlow exécute lui-même ses **migrations
de schéma Alembic à chaque démarrage du conteneur** ; le job `db-init` ne gère donc
que le rôle, la base et les droits — les tables sont créées et mises à niveau par
l'application. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `langflowai/langflow:<version>` avec un point
d'entrée shell léger (`langflow-entrypoint.sh`) qui s'exécute avant le lancement de
`langflow run` :

- **Compose `LANGFLOW_DATABASE_URL`** — LangFlow lit un DSN unique sous forme d'URL
  SQLAlchemy, et un DSN de type autorité d'URL ne peut pas intégrer le chemin du
  socket Unix de Cloud SQL (ses deux-points cassent l'analyse de l'URL). Le point
  d'entrée construit donc le DSN via **TCP** à partir des variables `DB_*` injectées
  par la plateforme, selon l'hôte résolu :
  - **GKE** — `DB_HOST = 127.0.0.1` (le sidecar Cloud SQL Auth Proxy, qui termine le
    TLS) → `sslmode=disable`.
  - **Cloud Run** — `DB_HOST` est le répertoire du socket (`/cloudsql/...`) ; le
    point d'entrée se rabat sur `DB_IP` (l'IP privée de l'instance) →
    `sslmode=require`.
  - Le mot de passe est encodé pour URL avant d'être placé dans le DSN.
  - La composition est ignorée si l'opérateur a fourni un `LANGFLOW_DATABASE_URL`
    explicite.
- **Définit l'adresse d'écoute** — `LANGFLOW_PORT = 7860` et
  `LANGFLOW_HOST = 0.0.0.0` sont exportés (avec ces valeurs par défaut) afin que
  LangFlow écoute là où la plateforme l'attend.
- **Lance le serveur** — `exec "$@"` exécute le `langflow run` par défaut de l'image
  en tant que PID 1.

Le tag de l'image de base provient d'un ARG de build propre à l'application
(`LANGFLOW_VERSION`), afin que l'injection générique de l'argument de build
`APP_VERSION` par le socle ne puisse pas l'écraser par `latest` ; lorsque
`application_version = "latest"`, le build épingle `1.10.2` pour garantir la
reproductibilité.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`LangFlow_Common` établit l'environnement LangFlow de référence afin que
l'application démarre correctement dès le premier démarrage :

- **Port** — `LANGFLOW_PORT = "7860"` ; le conteneur écoute sur `7860`.
- **Hôte** — `LANGFLOW_HOST = "0.0.0.0"`.
- **Authentification** — `LANGFLOW_AUTO_LOGIN = "false"`, qui active
  l'authentification multi-utilisateur et fait provisionner par LangFlow le compte
  administrateur initial à partir de `LANGFLOW_SUPERUSER` +
  `LANGFLOW_SUPERUSER_PASSWORD`.
- **Superutilisateur** — `LANGFLOW_SUPERUSER = <langflow_username>` (`admin` par
  défaut).
- **URL de la base de données** — volontairement *non* définie ici ; le point
  d'entrée compose `LANGFLOW_DATABASE_URL` à l'exécution à partir des variables
  `DB_*` injectées (voir §4).

Des paramètres non secrets supplémentaires peuvent être fournis via l'entrée
`environment_variables` de la plateforme ; ils sont fusionnés par-dessus ces valeurs
par défaut.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/health`** — le point de
terminaison de vivacité public et non authentifié de LangFlow, qui renvoie `200 OK`
dès que le serveur est en cours d'exécution. Une fenêtre de démarrage généreuse
(délai initial de 30 s, 30 tentatives en échec à 10 s d'intervalle sur Cloud Run)
laisse le temps aux migrations Alembic qui s'exécutent au premier démarrage.

- **Sonde de démarrage** — HTTP `GET /health`, délai initial de 30 s, période de
  10 s, seuil d'échec de 30.
- **Sonde de vivacité** — HTTP `GET /health`, délai initial de 15 s, période de
  30 s, seuil d'échec de 3.

---

## 7. Stockage d'objets {#7-object-storage}

LangFlow stocke tout son état — flux, composants, identifiants et historique
d'exécution — dans PostgreSQL ; **aucun bucket Cloud Storage n'est donc déclaré**
(`storage_buckets` vaut `[]`) et NFS est désactivé par défaut. N'activez NFS ou des
volumes GCS que si vous avez besoin d'un stockage de fichiers partagé pour un
composant personnalisé particulier.

---

Pour la configuration de LangFlow destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[LangFlow_GKE](LangFlow_GKE.md)** et
**[LangFlow_CloudRun](LangFlow_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LangFlow sur Google Cloud Run](LangFlow_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LangFlow sur GKE Autopilot](LangFlow_GKE.md) — cette configuration déployée sur GKE.
