---
title: "SparkyFitness Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module SparkyFitness — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/SparkyFitness_Common.md @ 3055034 sha256:ad42a9a08651 -->

# SparkyFitness Common — Configuration applicative partagée {#sparkyfitness-common--shared-application-configuration}

`SparkyFitness_Common` est la **couche applicative partagée** de SparkyFitness. Elle
n'est pas déployée seule ; elle fournit la configuration propre à SparkyFitness sur
laquelle s'appuient à la fois [SparkyFitness_GKE](SparkyFitness_GKE.md) et
[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée
propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique
les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement SparkyFitness, consultez
les guides des plateformes ([SparkyFitness_GKE](SparkyFitness_GKE.md),
[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par SparkyFitness_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère `SPARKY_FITNESS_API_ENCRYPTION_KEY` (64 caractères hexadécimaux), `BETTER_AUTH_SECRET` et `SPARKY_FITNESS_APP_DB_PASSWORD`, tous stockés dans **Secret Manager** | Injectés automatiquement ; récupérables via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé minimal (`image_source = "custom"`) FROM l'image officielle `codewithcj/sparkyfitness_server`, qui modifie ses trois constructeurs `pg.Pool` pour activer SSL — sans wrapper de point d'entrée | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme unique moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`), qui crée uniquement le rôle d'administration et la base de données | Sortie `initialization_jobs` |
| Paramètres principaux | Définit l'environnement de base du backend : niveau de journalisation, fuseau horaire, CORS, amorçage de l'administrateur, désactivation de l'inscription, SMTP | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant HTTP `GET /api/health` sur le port 3010 | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager — ils ne
sont jamais définis en clair et (pour deux des trois) ne doivent jamais être modifiés
après la première utilisation :

- **`SPARKY_FITNESS_API_ENCRYPTION_KEY`** — une chaîne hexadécimale de 64 caractères
  (`random_id`, 32 octets) correspondant au format `openssl rand -hex 32` documenté en
  amont. Chiffre les identifiants stockés des sources de données externes. Sa rotation
  après la première connexion les invalide définitivement.
- **`BETTER_AUTH_SECRET`** — signe les sessions et chiffre les données 2FA/TOTP. Sa
  rotation une fois que des utilisateurs ont activé l'authentification à deux facteurs
  les bloque.
- **`SPARKY_FITNESS_APP_DB_PASSWORD`** — le mot de passe du rôle de base de données
  d'exécution à privilèges limités (`app_db_user`). Contrairement aux deux secrets
  ci-dessus, celui-ci peut être renouvelé à tout moment sans risque — le backend
  resynchronise le mot de passe du rôle à partir de ce secret lors de son prochain
  redémarrage, puisqu'il répare automatiquement le rôle à chaque démarrage.

Récupérez les secrets après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de base de données du rôle d'**administration** (`db_user`) est généré
et géré séparément par le socle ; le nom de son secret figure dans les sorties du
déploiement de la plateforme (`database_password_secret`). Consultez
[App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

SparkyFitness requiert **PostgreSQL 15** ; le moteur est fixe et aucun autre moteur
n'est pris en charge. Lors du premier déploiement, un job ponctuel (`db-init`)
s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Attend que PostgreSQL soit joignable (via le Cloud SQL Auth Proxy),
2. Crée (ou met à jour) le rôle d'**administration** (`db_user`) avec le mot de passe généré,
3. Crée (ou reconfigure) la base de données (`db_name`) avec ce rôle comme propriétaire,
4. Accorde tous les privilèges sur la base de données et le schéma public,
5. Signale au Cloud SQL Auth Proxy de s'arrêter proprement (GKE uniquement).

Contrairement à la plupart des modules Common de ce catalogue, il n'existe **pas de
second job de migration**. Le backend de SparkyFitness exécute lui-même ses
migrations de schéma et, séparément, **répare automatiquement un second rôle
PostgreSQL à privilèges limités** (`app_db_user`) à l'aide des identifiants du rôle
d'administration — à chaque démarrage du conteneur, et pas seulement au premier. Il
s'agit du modèle de moindre privilège documenté par l'amont lui-même : `db_user` y est
décrit comme le « super user for DB initialization and migrations », tandis
qu'`app_db_user` est l'« application database user with limited privileges ».

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur (correctif SSL minimal, sans wrapper de point d'entrée) {#4-container-image-thin-ssl-patch-no-entrypoint-wrapper}

L'image frontend (`codewithcj/sparkyfitness`) est utilisée **exactement telle que
publiée** en amont. Le backend (`codewithcj/sparkyfitness_server`) est un **build
personnalisé minimal** (`image_source = "custom"`, argument de build
`SPARKYFITNESS_SERVER_VERSION`) dont la seule modification est un correctif `sed`
ajoutant une option `ssl` aux trois constructeurs `pg.Pool` de `db/poolManager.ts` et
`auth.ts` — l'application ne propose aucune variable d'environnement pour activer SSL,
et Cloud SQL refuse la connexion TCP non chiffrée sur adresse IP privée que Cloud Run
fournit au backend. SSL n'est appliqué que lorsque l'hôte résolu n'est pas la boucle
locale ; la connexion via le sidecar cloud-sql-proxy de GKE, dont le TLS est déjà
terminé, n'est donc pas affectée. Aucune des deux images n'a besoin d'un **wrapper de
point d'entrée**, car :

- Le backend lit déjà des variables d'environnement distinctes au format standard
  (`SPARKY_FITNESS_DB_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD`), que le socle peut
  injecter directement grâce à son mécanisme de renommage `db_*_env_var_name` — aucune
  couche de traduction par script shell n'est nécessaire, contrairement aux applications
  dont les noms de variables d'environnement natifs diffèrent de la convention `DB_*`
  du socle.
- Le point d'entrée nginx du frontend lit directement `SPARKY_FITNESS_SERVER_HOST` /
  `SPARKY_FITNESS_SERVER_PORT` pour appliquer `envsubst` à sa propre configuration
  nginx — là encore, aucun wrapper n'est nécessaire, seulement les bonnes valeurs
  fournies par le fichier de câblage de chaque variante de plateforme (consultez
  [SparkyFitness_CloudRun](SparkyFitness_CloudRun.md) et
  [SparkyFitness_GKE](SparkyFitness_GKE.md) pour voir en quoi ces valeurs diffèrent
  selon la plateforme).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`SparkyFitness_Common` établit l'environnement de base du backend afin que
l'application démarre correctement dès le premier lancement :

- **Environnement** — `NODE_ENV = "production"`.
- **Journalisation** — `SPARKY_FITNESS_LOG_LEVEL` (par défaut `ERROR`).
- **Fuseau horaire** — `TZ` (par défaut `Etc/UTC`).
- **CORS** — `ALLOW_PRIVATE_NETWORK_CORS = "false"` par défaut ; `SPARKY_FITNESS_FRONTEND_URL`
  est défini pour chaque plateforme sur l'URL frontend calculée (jamais un espace
  réservé résolu à l'exécution — Cloud Run/GKE n'interpolent pas `$(VAR)` dans les
  valeurs des variables d'environnement, il doit donc s'agir d'une véritable chaîne
  connue au moment du plan).
- **Contrôle de l'inscription** — `SPARKY_FITNESS_DISABLE_SIGNUP` (par défaut `false`).
- **Amorçage de l'administrateur** — `SPARKY_FITNESS_ADMIN_EMAIL` (vide par défaut ;
  élève un utilisateur EXISTANT, n'en crée pas).
- **SMTP** — désactivé par défaut ; lorsque `smtp_enabled = true`, tous les champs
  `SPARKY_FITNESS_EMAIL_*` sont définis ensemble (host/port/secure/user/from) — le mot
  de passe (`SPARKY_FITNESS_EMAIL_PASS`) n'est volontairement PAS défini ici ;
  fournissez-le via les `secret_environment_variables` de la variante de plateforme.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `GET /api/health` sur le port 3010 — confirmé directement
à partir de la propre directive `HEALTHCHECK` du Dockerfile du backend
(`CMD curl -f http://127.0.0.1:3010/api/health`), et non déduit ni deviné.

- **Cloud Run** applique cette sonde au sidecar `additional_containers` du backend via
  son câblage `startup_tcp_port`/`inherit_app_env` ; le conteneur principal (frontend)
  reçoit une sonde TCP simple distincte.
- **GKE** applique cette sonde directement au backend, puisqu'il y est l'application
  principale.

---

Pour la configuration propre à SparkyFitness destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[SparkyFitness_GKE](SparkyFitness_GKE.md)** et
**[SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [SparkyFitness sur Google Cloud Run](SparkyFitness_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [SparkyFitness sur GKE Autopilot](SparkyFitness_GKE.md) — cette configuration déployée sur GKE.
