---
title: "LangFlow Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module LangFlow — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LangFlow_Common.md @ 15fd4c7 sha256:ea851c4fc99a -->

# LangFlow Common — Configuration d'application partagée {#langflow-common--shared-application-configuration}

`LangFlow_Common` est la **couche d'application partagée** pour LangFlow. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à LangFlow sur
laquelle [LangFlow_GKE](LangFlow_GKE.md) et
[LangFlow_CloudRun](LangFlow_CloudRun.md) s'appuient, de sorte que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas
ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement LangFlow, consultez
les guides de la plateforme ([LangFlow_GKE](LangFlow_GKE.md),
[LangFlow_CloudRun](LangFlow_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par LangFlow_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `LANGFLOW_SECRET_KEY` (32 octets aléatoires, base64url) et `LANGFLOW_SUPERUSER_PASSWORD` (mot de passe de 32 caractères) et les stocke dans **Secret Manager** | Injecté automatiquement comme variables d'environnement secrètes du conteneur ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `langflowai/langflow` avec un point d'entrée shell léger ; build via Cloud Build (`image_source = "custom"`, tag de base épinglé à `1.10.2` quand `application_version = "latest"`) | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** (`database_type = "POSTGRES_15"`) comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, le rôle et les autorisations en utilisant `postgres:15-alpine` | Sortie `initialization_jobs` |
| Stockage d'objets | **Aucun** — LangFlow persiste les flux et les identifiants dans Postgres, donc `storage_buckets` est vide | Sortie `storage_buckets` (`[]`) |
| Paramètres de base | Définit l'environnement LangFlow de base : port `7860`, hôte `0.0.0.0`, `LANGFLOW_AUTO_LOGIN = "false"`, nom d'utilisateur superutilisateur et `LANGFLOW_CONFIG_DIR` (le chemin de montage de l'appelant, pour que les fichiers téléchargés persistent) | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en texte clair. Leurs ID Secret Manager deviennent les
**noms** des variables d'environnement secrètes du conteneur SERVICE (la variante
de la plateforme câble `module_secret_env_vars = secret_ids`) :

- **`LANGFLOW_SECRET_KEY`** — 32 octets aléatoires encodés en base64url. LangFlow
  l'utilise pour chiffrer toutes les informations d'identification stockées (clés
  API, secrets de connexion intégrés dans les flux). S'il n'est pas défini,
  LangFlow génère une clé éphémère par instance, donc une clé stable est épinglée
  ici. **La faire pivoter après le premier démarrage rompt définitivement toutes
  les informations d'identification stockées** — elles ne peuvent plus être
  déchiffrées et doivent être ressaisies dans chaque flux.
- **`LANGFLOW_SUPERUSER_PASSWORD`** — un mot de passe généré de 32 caractères (sans
  caractères spéciaux). Parce que `LANGFLOW_AUTO_LOGIN = "false"`, LangFlow provisionne son
  compte administrateur initial au premier démarrage à partir de `LANGFLOW_SUPERUSER` (le
  nom d'utilisateur, par défaut `admin`) et de ce mot de passe. C'est le mot
  de passe avec lequel vous vous connectez.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~secret-key OR name~-password"

# Read the admin login password:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la
fondation ; son nom de secret est indiqué dans les sorties de déploiement de la
plateforme (`database_password_secret`). Voir [App_Common](App_Common.md) pour le secret partagé et
le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

LangFlow nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job unique
(`db-init`) s'exécute en utilisant `postgres:15-alpine` (`create-db-and-user.sh`) et de manière
idempotente :

1. Résout l'hôte Cloud SQL (`DB_HOST`, ou `DB_IP` en cas de
   repli),
2. Attend que PostgreSQL soit accessible,
3. Crée (ou met à jour le mot de passe de) le rôle de l'application,
4. Lui accorde `CREATEDB` et crée (ou réaffecte le propriétaire de) la base de
   données de l'application,
5. Accorde tous les privilèges sur la base de données et le schéma `public`,
6. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter gracieusement
   (`POST /quitquitquit`) afin que le Job puisse se terminer proprement sur GKE.

Le job peut être réexécuté en toute sécurité. LangFlow lui-même exécute ses
**migrations de schéma Alembic à chaque démarrage de conteneur**, de sorte que le
job `db-init` ne gère que le rôle/la base de données/les autorisations — les tables
sont créées et mises à niveau par l'application. Inspectez la base de données
directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les
sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `langflowai/langflow:<version>` avec un point d'entrée shell léger
(`langflow-entrypoint.sh`) qui s'exécute avant le démarrage de `langflow run` :

- **Compose `LANGFLOW_DATABASE_URL`** — LangFlow lit un seul DSN d'URL SQLAlchemy, et un
  DSN d'autorité d'URL ne peut pas intégrer le chemin du socket Unix Cloud SQL
  (ses deux-points interrompent l'analyse d'URL). Le point d'entrée construit
  donc le DSN sur **TCP** à partir des variables `DB_*` injectées par la
  plateforme, en se basant sur l'hôte résolu :
  - **GKE** — `DB_HOST = 127.0.0.1` (le sidecar Cloud SQL Auth Proxy, TLS-terminé) →
    `sslmode=disable`.
  - **Cloud Run** — `DB_HOST` est le répertoire du socket (`/cloudsql/...`) ; le
    point d'entrée se replie sur `DB_IP` (l'IP privée de l'instance) →
    `sslmode=require`.
  - Le mot de passe est encodé en URL avant d'être placé dans le DSN.
  - La composition est ignorée si l'opérateur a fourni un `LANGFLOW_DATABASE_URL` explicite.
- **Définit l'adresse d'écoute** — `LANGFLOW_PORT = 7860` et `LANGFLOW_HOST = 0.0.0.0` sont
  exportés (par défaut) afin que LangFlow se lie là où la plateforme l'attend.
- **Lance le serveur** — `exec "$@"` exécute le `langflow run` par défaut de
  l'image en tant que PID 1.

Le tag de l'image de base provient d'un ARG de build spécifique à l'application
(`LANGFLOW_VERSION`) afin que l'injection générique d'ARG de build `APP_VERSION` de la
Fondation ne puisse pas le remplacer par `latest` ; lorsque `application_version = "latest"`, le
build épingle `1.10.2` pour la reproductibilité.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`LangFlow_Common` établit l'environnement LangFlow de base afin que l'application
démarre correctement au premier démarrage :

- **Port** — `LANGFLOW_PORT = "7860"` ; le conteneur écoute sur `7860`.
- **Hôte** — `LANGFLOW_HOST = "0.0.0.0"`.
- **Authentification** — `LANGFLOW_AUTO_LOGIN = "false"`, ce qui active
  l'authentification multi-utilisateur et fait en sorte que LangFlow provisionne
  le compte administrateur initial à partir de `LANGFLOW_SUPERUSER` + `LANGFLOW_SUPERUSER_PASSWORD`.
- **Superutilisateur** — `LANGFLOW_SUPERUSER = <langflow_username>` (par défaut `admin`).
- **URL de la base de données** — intentionnellement *non* définie ici ; le
  point d'entrée compose `LANGFLOW_DATABASE_URL` au moment de l'exécution à partir des
  variables `DB_*` injectées (voir §4).

Des paramètres non secrets supplémentaires peuvent être fournis via l'entrée
`environment_variables` de la plateforme et sont fusionnés en plus de ces valeurs par défaut.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/health`** — le
point de terminaison de vivacité public et non authentifié de LangFlow qui
renvoie `200 OK` une fois le serveur en cours d'exécution. Une fenêtre de
démarrage généreuse (délai initial de 30 s, 30 tentatives de défaillance de 10 s
chacune sur Cloud Run) tient compte des migrations Alembic qui s'exécutent au
premier démarrage.

- **Sonde de démarrage** — HTTP `GET /health`, délai initial de 30 s, période de
  10 s, seuil de défaillance de 30.
- **Sonde de vivacité** — HTTP `GET /health`, délai initial de 15 s, période de
  30 s, seuil de défaillance de 3.

---

## 7. Stockage d'objets {#7-object-storage}

LangFlow stocke tout l'état — flux, composants, identifiants et historique
d'exécution — dans PostgreSQL, donc **aucun bucket Cloud Storage n'est
déclaré** (`storage_buckets` est `[]`) et NFS est désactivé par défaut.
N'activez les volumes NFS ou GCS que si vous avez besoin d'un stockage de
fichiers partagé pour un composant personnalisé spécifique.

---

Pour la configuration spécifique à LangFlow et destinée à l'utilisateur (variables
par groupe, sorties et comment explorer chaque service depuis la Console et la
CLI), consultez les guides de la plateforme : **[LangFlow_GKE](LangFlow_GKE.md)**
et **[LangFlow_CloudRun](LangFlow_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LangFlow sur Google Cloud Run](LangFlow_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LangFlow sur GKE Autopilot](LangFlow_GKE.md) — cette configuration déployée sur GKE.
