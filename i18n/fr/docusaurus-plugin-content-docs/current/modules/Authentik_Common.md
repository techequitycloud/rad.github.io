---
title: "Authentik Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Authentik — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Authentik_Common.md @ 3055034 sha256:5927a3d119d7 -->

# Authentik Common — Configuration applicative partagée {#authentik-common--shared-application-configuration}

`Authentik_Common` est la **couche applicative partagée** d'[authentik](https://goauthentik.io/) —
le fournisseur d'identité open source (SSO via OIDC/SAML, LDAP, SCIM, MFA et authentification
par proxy ; une alternative auto-hébergée à Okta, Auth0 et Keycloak). Elle n'est pas
déployée seule ; elle fournit plutôt la configuration propre à authentik sur laquelle
reposent [Authentik_GKE](Authentik_GKE.md) et [Authentik_CloudRun](Authentik_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux
ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement authentik, consultez les guides
de plateforme ([Authentik_GKE](Authentik_GKE.md), [Authentik_CloudRun](Authentik_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Authentik_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère une `AUTHENTIK_SECRET_KEY` stable (64 caractères) et le mot de passe d'amorçage `akadmin` (24 caractères), et les stocke tous deux dans **Secret Manager** | Injectés automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Build personnalisé léger `FROM ghcr.io/goauthentik/server` avec un point d'entrée cloud ; construit via Cloud Build. `application_version = "latest"` est épinglé sur une version éprouvée (authentik ne publie aucun tag `latest`) | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge (authentik exige PostgreSQL ≥ 14) | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit l'unique job de premier déploiement (`db-init`) qui crée le rôle et la base de données et accorde `cloudsqlsuperuser` par précaution | Sortie `initialization_jobs` |
| Pas de Redis | authentik ≥ 2025.10 conserve le cache, les sessions, la file de tâches et la couche de canaux WebSocket dans **PostgreSQL** — aucun service de cache n'est provisionné | §Vue d'ensemble dans les guides de plateforme |
| Stockage des médias | Déclare un **bucket GCS** monté sur `/media` via GCS Fuse pour les icônes téléversées et les arrière-plans de flux | Sortie `storage_buckets` |
| Co-localisation du worker | Le point d'entrée lance `ak worker` en arrière-plan à côté du serveur dans le même conteneur, sur des ports d'écoute loopback dédiés afin que le serveur détienne `:9000` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Sonde de démarrage par défaut `GET /-/health/ready/` (seuil de premier démarrage généreux) et sonde de vivacité `GET /-/health/live/` — toutes deux non authentifiées | §Observabilité dans les guides de plateforme |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager sous
`secret-<tenant-prefix>-<application-name>-*` :

- **`AUTHENTIK_SECRET_KEY`** (`...-secret-key`) — l'équivalent de la `SECRET_KEY` de Django.
  authentik l'utilise pour signer les sessions et les cookies et en dérive son chiffrement interne.
  Elle est générée une seule fois (64 caractères aléatoires) et doit rester **stable pendant toute
  la durée de vie du déploiement** — la renouveler invalide toutes les sessions actives et rend
  illisibles les champs chiffrés (identifiants stockés, jetons).
- **`AUTHENTIK_BOOTSTRAP_PASSWORD`** (`...-bootstrap-password`) — le mot de passe initial
  de l'utilisateur administrateur intégré `akadmin`. authentik l'applique **uniquement au premier
  démarrage** (avec `AUTHENTIK_BOOTSTRAP_EMAIL`, par défaut `admin@techequity.cloud`) ;
  les changements de mot de passe ultérieurs se font dans l'application. Fournir une entrée
  `bootstrap_password` explicite remplace la valeur générée automatiquement.

Récupérez les secrets après le déploiement :

```bash
# List secrets for this deployment (names include the tenant prefix):
gcloud secrets list --project "$PROJECT" --filter="name~authentik"

# Read the bootstrap password (first login as akadmin):
gcloud secrets versions access latest \
  --secret=<secret-...-bootstrap-password> --project "$PROJECT"

# Read the secret key (do NOT rotate it):
gcloud secrets versions access latest \
  --secret=<secret-...-secret-key> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom
de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets
et de Workload Identity.

---

## 3. Image personnalisée légère et mappage du point d'entrée {#3-thin-custom-image-and-entrypoint-mapping}

L'image est une enveloppe minimale autour de l'image officielle du serveur authentik — aucun
code applicatif n'est modifié :

- **ARG de build `AUTHENTIK_VERSION` propre à l'application.** Le socle injecte `APP_VERSION`
  dans `build_args` et l'emporte lors de la fusion ; le Dockerfile dérive donc son tag `FROM`
  de l'ARG propre à l'application `AUTHENTIK_VERSION`. authentik ne publie que des tags de
  version sur GHCR (pas de `latest`) ; `application_version = "latest"` est donc épinglé sur une
  version éprouvée (`2026.5.4`) au moment du build.
- **`cloud-entrypoint.sh` mappe `DB_*` → `AUTHENTIK_POSTGRESQL__*` à l'exécution.** La
  plateforme injecte les variables standard `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ;
  le point d'entrée les reporte sur la convention d'authentik
  `AUTHENTIK_POSTGRESQL__HOST/PORT/NAME/USER/PASSWORD`. Cela se fait dans le
  point d'entrée (et non de manière déclarative) pour deux raisons liées à la plateforme : Cloud Run n'interpole pas
  les références d'environnement `$(VAR)`, et une clé de secret synchronisé nommée
  `AUTHENTIK_POSTGRESQL__PASSWORD` serait rejetée par la CRD SecretSync de GKE (`__`
  enfreint son expression régulière `targetKey`). Les valeurs déjà définies explicitement ne sont jamais écrasées.
- **Mode SSL selon le type de connexion.** Lorsque l'hôte de la base de données est un répertoire de socket Unix (le
  Cloud SQL Auth Proxy sur Cloud Run) **ou l'interface loopback** (`127.0.0.1` / `localhost` — le
  sidecar Auth Proxy sur GKE), `AUTHENTIK_POSTGRESQL__SSLMODE` vaut `disable` par défaut :
  le proxy dessert ces deux formes, termine le TLS et ne parle pas SSL lui-même —
  exiger SSL sur `127.0.0.1` échoue avec « server does not support SSL, but SSL was
  required ». Seule une connexion TCP directe vers tout autre hôte vaut `require` par défaut (les connexions directes
  par IP privée à Cloud SQL rejettent le trafic non chiffré).
- **Worker co-localisé.** Dans docker-compose, authentik exécute `ak worker` dans un second
  conteneur. Sur Cloud Run / GKE à pod unique, le point d'entrée le démarre en arrière-plan
  avant d'exécuter (`exec`) le serveur (le même schéma que le worker Sidekiq co-localisé de
  Chatwoot). Les deux processus partagent `AUTHENTIK_SECRET_KEY` et la file de tâches adossée à Postgres.
  Le worker est démarré avec des **ports d'écoute loopback dédiés**
  (`AUTHENTIK_LISTEN__HTTP=127.0.0.1:9001`, `AUTHENTIK_LISTEN__HTTPS=127.0.0.1:9444`,
  `AUTHENTIK_LISTEN__METRICS=127.0.0.1:9301`) : le binaire du worker démarre lui aussi un écouteur
  HTTP et hérite du `0.0.0.0:9000` par défaut du serveur ; co-localisé dans un même
  conteneur, il peut remporter la course au bind et répondre à toutes les routes — y compris les points de terminaison
  de santé — par des 200 vides (une interface vide avec des sondes faussement saines). Épingler le
  worker sur des ports loopback garantit que le serveur détient `:9000`. C'est pourquoi la variante Cloud
  Run utilise par défaut `cpu_always_allocated = true` et `min_instance_count = 1`
  — le worker doit continuer à s'exécuter entre les requêtes.
- **Aucune étape de migration dans le point d'entrée** — le serveur authentik exécute ses propres
  migrations protégées par un verrou consultatif à chaque démarrage (voir ci-dessous).

Environnement de base défini par cette couche (modifiable via `environment_variables`) :
`AUTHENTIK_BOOTSTRAP_EMAIL` (par défaut `admin@techequity.cloud`),
`AUTHENTIK_ERROR_REPORTING__ENABLED = "false"`,
`AUTHENTIK_DISABLE_UPDATE_CHECK = "true"` et `AUTHENTIK_LOG_LEVEL = "info"`.
Le conteneur écoute sur le **port 9000**.

Notez que les modifications du point d'entrée et du Dockerfile sont intégrées à l'image personnalisée et nécessitent
une reconstruction ; le script `db-init` est monté au moment de l'apply et ses modifications prennent effet au
prochain apply sans reconstruction.

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

authentik exige **PostgreSQL 15** (≥ 14) ; le moteur est fixe et MySQL n'est pas
pris en charge. Lors du premier déploiement, un job ponctuel unique (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Attend que PostgreSQL soit joignable (répertoire de socket de l'Auth Proxy sur Cloud Run,
   TCP du proxy sur GKE),
2. Crée (ou met à jour) le rôle applicatif propre au locataire avec le mot de passe
   généré,
3. Crée la base de données applicative si elle est absente — détenue par `postgres`, car le
   compte `postgres` de Cloud SQL ne peut pas faire `SET ROLE` vers les rôles applicatifs — et accorde tous les
   privilèges sur la base de données et le schéma `public`,
4. Accorde `cloudsqlsuperuser` au rôle applicatif par précaution, afin que tout futur
   `CREATE EXTENSION IF NOT EXISTS` dans les migrations amont soit sans effet plutôt qu'un
   échec « must be superuser »,
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter pour que le job se termine.

Il n'existe **aucun job distinct de schéma ou de migration** : le serveur authentik applique ses propres
migrations Django à chaque démarrage, protégées par un verrou consultatif PostgreSQL afin que
des instances concurrentes n'entrent pas en collision. Les montées de version ne nécessitent donc aucune étape de
migration supplémentaire — la première instance de la nouvelle révision migre le schéma pendant que
le seuil généreux de la sonde de démarrage fait patienter le déploiement progressif.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme
(notez que les noms de la base de données et de l'utilisateur sont préfixés par le locataire).

---

## 5. Volume de médias GCS {#5-gcs-media-volume}

authentik stocke les médias téléversés — icônes d'applications et arrière-plans de flux — sous
`/media`. Cette couche déclare un bucket **Cloud Storage** dédié
(`name_suffix = "storage"`) et le monte sur `/media` via GCS Fuse avec
`uid=1000,gid=1000` (correspondant à l'utilisateur d'exécution amont `authentik`). Les médias sont de simples
fichiers sans exigence de verrouillage ; GCSFuse est donc sûr, et les téléversements survivent au
remplacement des instances et aux événements de mise à l'échelle sur les deux plateformes.

Le nom du bucket suit la formule du socle
`gcs-<application_name><tenant-prefix>-storage` (propre à l'application). Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://gcs-<service-name>-storage/
```

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les deux points de terminaison de santé d'authentik sont **non authentifiés**, ce qui est une exigence stricte
pour les sondes de la plateforme (le front-end de Cloud Run et le kubelet de GKE sondent sans
identifiants) :

- **Démarrage :** `GET /-/health/ready/` renvoie 200 une fois les migrations terminées et
  la base de données joignable. Le premier démarrage exécute la suite complète de migrations d'authentik ; le
  seuil par défaut est donc généreux — 60 s de délai initial plus 40 × 15 s de tentatives
  (environ 11 minutes) avant que le déploiement progressif ne soit déclaré en échec.
- **Vivacité :** `GET /-/health/live/` est une vérification légère que le processus est vivant (60 s
  de délai, 3 × 30 s).

Ne redirigez pas les sondes vers des pages authentifiées — un point de terminaison qui renvoie 401/403
à la sonde non authentifiée maintient la révision/le pod indéfiniment non prêt, alors même que
l'application a démarré correctement.

---

Pour la configuration propre à authentik destinée aux utilisateurs (variables par groupe, sorties,
et comment explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Authentik_GKE](Authentik_GKE.md)** et
**[Authentik_CloudRun](Authentik_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Authentik sur Google Cloud Run](Authentik_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Authentik sur GKE Autopilot](Authentik_GKE.md) — cette configuration déployée sur GKE.
