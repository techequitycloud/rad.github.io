---
title: "GoToSocial Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module GoToSocial — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/GoToSocial_Common.md @ 15fd4c7 sha256:feb5d0effe52 -->

# GoToSocial Common — Configuration d'application partagée {#gotosocial-common--shared-application-configuration}

`GoToSocial_Common` est la **couche d'application partagée** pour GoToSocial, un
serveur ActivityPub/Fediverse léger et auto-hébergé — une petite alternative
à Mastodon, écrit sous la forme d'un unique binaire Go statique. Il n'est pas déployé seul ;
il fournit plutôt la configuration spécifique à GoToSocial sur laquelle
[GoToSocial_GKE](GoToSocial_GKE.md) et
[GoToSocial_CloudRun](GoToSocial_CloudRun.md) s'appuient, de sorte que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette
couche directement — elle n'a pas d'interface utilisateur de déploiement propre — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute GoToSocial, consultez les
guides de la plateforme ([GoToSocial_GKE](GoToSocial_GKE.md),
[GoToSocial_CloudRun](GoToSocial_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par GoToSocial_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Déploie directement l'image officielle `docker.io/superseriousbusiness/gotosocial` — **pas de build personnalisé**. L'amont de GoToSocial est passé à Codeberg, mais le registre de conteneurs est toujours Docker Hub | Sortie `container_image` ; `image_source = "prebuilt"` |
| Secrets cryptographiques | Génère `SUPERUSER_PASSWORD` (24 caractères aléatoires), plus une paire de clés d'accès/secrètes HMAC pour le stockage interopérable S3 de GCS. Le tout est stocké dans **Secret Manager** | Injecté via le chemin `secret_ids` → `module_secret_env_vars` (voir §2) |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge, avec l'interclassement obligatoire `C` | §3 ci-dessous |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` et le rôle d'application | Sortie `initialization_jobs` |
| Amorçage du compte administrateur | Définit le job `admin-create`, délibérément **non** exécuté automatiquement — GoToSocial n'a pas de flux d'inscription web | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` et un compte de service de stockage dédié avec une paire de clés HMAC pour le client natif compatible S3 de GoToSocial | Sorties `storage_buckets` / `storage_sa_email` |
| Paramètres de base | Définit `GTS_HOST`, `GTS_PROTOCOL` (`https` lorsque le vrai TLS est terminé, sinon `http`), `GTS_PORT=8080`, `GTS_LETSENCRYPT_ENABLED=false`, `GTS_STORAGE_*`, `GTS_TRUSTED_PROXIES`, `GTS_ACCOUNTS_REGISTRATION_OPEN` | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Déclare les valeurs par défaut **TCP** `startup_probe`/`liveness_probe` — HTTP ne fonctionne jamais avec les points de terminaison de GoToSocial (voir §6) | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets : comment `SUPERUSER_PASSWORD` et les clés S3 atteignent réellement le conteneur {#2-secrets-how-superuser_password-and-the-s3-keys-actually-reach-the-container}

Trois secrets sont générés automatiquement et stockés dans Secret Manager :

- **`SUPERUSER_PASSWORD`** — une chaîne aléatoire de 24 caractères (`random_password`,
  `special = false`). Consommée uniquement par le job d'initialisation `admin-create`, passée à
  `gotosocial admin account create --password`. C'est le mot de passe du
  premier compte (propriétaire) de l'instance.
- **`GTS_STORAGE_S3_ACCESS_KEY`** / **`GTS_STORAGE_S3_SECRET_KEY`** — une paire de clés HMAC GCS
  (`google_storage_hmac_key`) créée sur un compte de service dédié
  (`gotosocial_storage`, ID de compte `gts-store-<hex_suffix>`).
  Consommée par le client `GTS_STORAGE_BACKEND=s3` du conteneur principal.

**Un piège réel qu'il convient de signaler de manière proéminente.** L'objet `GoToSocial_Common` de `config`
définit `secret_environment_variables = var.secret_environment_variables`
— un passthrough orienté opérateur — et ce champ est une **opération nulle de la Fondation**. Confirmé par la source `App_CloudRun`/`App_GKE` :
`secret_environment_variables` ne fusionne jamais que le `var.secret_environment_variables` de niveau supérieur
avec les préréglages de la Fondation ; il
**ne lit jamais** `local.selected_module.secret_environment_variables` (le
champ d'objet de configuration par application) — même si les générations d'échafaudages antérieures
de ce module (héritées de Synapse, lui-même cloné de Zammad) écrivaient exactement
ce champ mort. Le câblage d'un secret via ce champ le supprime silencieusement : il
n'atteint jamais le conteneur déployé.

Le mécanisme qui fonctionne réellement — et celui que `SUPERUSER_PASSWORD` et
les clés S3 utilisent — est :

```
GoToSocial_Common.secret_ids  →  module_secret_env_vars local (Application module)  →  Foundation module_secret_env_vars input
```

`GoToSocial_CloudRun/gotosocial.tf` et `GoToSocial_GKE/main.tf` définissent tous deux
`module_secret_env_vars = module.gotosocial_app.secret_ids`. Pendant
le développement, cette distinction a coûté un temps de débogage réel : les variables d'environnement des clés d'accès/secrètes S3
étaient silencieusement absentes de la révision déployée, produisant
des erreurs "Accès refusé" de GCS sur chaque opération de stockage, jusqu'à ce que le câblage
soit retracé jusqu'au champ de configuration mort `secret_environment_variables`.

Récupérez les secrets après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~superuser-password OR name~s3-access-key OR name~s3-secret-key"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ;
son nom de secret est indiqué dans les sorties de déploiement de la plateforme
(`database_password_secret`).

---

## 3. Moteur de base de données et l'interclassement C obligatoire {#3-database-engine-and-the-mandatory-c-collation}

GoToSocial nécessite **PostgreSQL** (`database_type = "POSTGRES_15"`), et a
une exigence d'exécution stricte que la plupart des applications basées sur Postgres de ce catalogue n'ont pas :
la base de données doit être créée avec **`LC_COLLATE='C'` et `LC_CTYPE='C'`** — elle
refuse de démarrer avec tout autre interclassement
("La base de données a un interclassement incorrect... GoToSocial nécessite maintenant l'interclassement 'C'"). L'étape générique de la Fondation `db-create` ne définit pas cela, donc
`GoToSocial_Common` livre un job `db-init` dédié
(`scripts/db-init.sh`, image `postgres:15-alpine`) qui, de manière idempotente :

1. Attend que PostgreSQL accepte les connexions,
2. Crée (ou met à jour le mot de passe de) le rôle d'application,
3. Crée la base de données d'application avec
   `ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`, appartenant au
   rôle d'application — recréant une base de données vide avec un interclassement incorrect si la
   Fondation en a créé une en premier (aucun risque de perte de données puisque cela ne
   se produit que lors d'un déploiement réellement nouveau),
4. Accorde tous les privilèges sur la base de données au rôle d'application,
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`POST
   http://127.0.0.1:9091/quitquitquit`) afin que le Job se termine sur GKE.

**Il n'y a pas de job de migration.** GoToSocial crée et met à jour son propre schéma
automatiquement à chaque démarrage — `db-init` ne fait que préparer une base de données et un rôle vides,
avec un interclassement correct.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
-- Verify the collation:
SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
```

---

## 4. Image de conteneur — aucun wrapper nécessaire {#4-container-image--no-wrapper-needed}

Contrairement à la plupart des modules Common de ce catalogue, `GoToSocial_Common` ne
construit **pas** une image personnalisée. Il définit :

```hcl
image_source    = "prebuilt"
container_image = "docker.io/superseriousbusiness/gotosocial:${var.application_version}"
```

Le propre `ENTRYPOINT` de l'image officielle de Dockerhub
(`/gotosocial/gotosocial server start`) lit nativement les variables d'environnement `GTS_*` discrètes
— confirmé par le Dockerfile amont
(base `alpine:3.21`, non-root `1000:1000`). Aucun wrapper d'entrée n'est nécessaire
pour traduire les noms génériques `DB_*` de la Fondation, car le module d'application appelant
les alias directement sur `GTS_DB_*` via
`db_host_env_var_name`/`db_user_env_var_name`/etc. dans son propre `main.tf` (voir
§Base de données dans les guides de la plateforme pour l'asymétrie du mode TLS Cloud Run vs GKE
que cet alias rencontre).

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`GoToSocial_Common` établit l'environnement GoToSocial de base
(`local.environment_variables` dans `main.tf`) :

- **`GTS_HOST`** — le domaine public, intégré à chaque URI d'acteur/objet ActivityPub créé localement au moment de la création. **Immuable après le premier démarrage** — même classe de risque que `server_name` de Synapse ou `URL` d'Outline.
- **`GTS_ACCOUNT_DOMAIN`** — domaine de vanité séparé facultatif pour les identifiants de compte ; par défaut `GTS_HOST` lorsqu'il est vide. Même risque d'immuabilité.
- **`GTS_PROTOCOL`** — `https` lorsque `enable_custom_domain = true` (la plateforme
  termine le vrai HTTPS à sa périphérie), `http` sinon. Cloud Run termine toujours
  le TLS, donc le wrapper Cloud Run conserve la valeur par défaut `true`. Sur GKE, le wrapper passe `true` uniquement
  lorsque `application_domains` est défini — un LoadBalancer IP nu n'a pas de certificat, et
  revendiquer `https` là-bas fait que GoToSocial émet des cookies de session `Secure` que le
  navigateur supprime, ce qui interrompt la connexion. La propre documentation de GoToSocial avertit que la modification de cette
  valeur après le premier démarrage rompt de manière permanente les URI déjà générés, alors définissez le
  domaine avant le premier déploiement.
- **`GTS_PORT = "8080"`**, **`GTS_BIND_ADDRESS = "0.0.0.0"`**.
- **`GTS_LETSENCRYPT_ENABLED = "false"`** — obligatoire ; la propre périphérie de la plateforme
  termine déjà le TLS, et le client ACME intégré de GoToSocial
  essaierait autrement (et échouerait, bruyamment mais sans danger) de lier les ports 80/443
  lui-même.
- **`GTS_DB_TYPE = "postgres"`**, **`GTS_DB_TLS_MODE = "disable"`** — corrects
  pour GKE (la boucle de rappel `127.0.0.1` du sidecar cloud-sql-proxy) ; **remplacés
  par `"enable"` par `GoToSocial_CloudRun`** car `db_host_env_var_name` de Cloud Run
  alias l'IP privée brute de Cloud SQL, pas un socket Unix — voir le tableau des pièges du guide de la plateforme CloudRun pour l'explication complète du mode TLS
  (`enable` vs `require` vs `disable` ne signifient **pas**
  ce que leurs noms suggèrent).
- **`GTS_STORAGE_BACKEND = "s3"`**, **`GTS_STORAGE_S3_ENDPOINT =
  "storage.googleapis.com"`**, **`GTS_STORAGE_S3_USE_SSL = "true"`**,
  **`GTS_STORAGE_S3_PROXY = "true"`** (la sémantique des URL pré-signées GCS diffère
  de AWS S3, donc les médias sont servis via GtS lui-même),
  **`GTS_STORAGE_S3_BUCKET_LOOKUP = "path"`**,
  **`GTS_STORAGE_S3_BUCKET = "gcs-<service_name>-storage"`**.
- **`GTS_TRUSTED_PROXIES = "0.0.0.0/0,::/0"`** — le conteneur n'est jamais
  atteint que par l'entrée de Cloud Run/GKE (aucun chemin client direct
  n'existe), donc le saut immédiat est intrinsèquement fiable pour
  le compartimentage IP de la limite de débit basé sur `X-Forwarded-For`, pas une décision
  d'authentification.
- **`GTS_ACCOUNTS_REGISTRATION_OPEN`** — piloté par `var.enable_open_registration`
  (par défaut `false`). Le propriétaire de l'instance est le super-utilisateur
  provisionné par `admin-create`.

Redis n'est intentionnellement **pas** utilisé — le cache de GoToSocial est entièrement
en cours de traitement ; `enable_redis` par défaut `false` et devrait le rester.

---

## 6. Comportement de la sonde de santé — TCP uniquement, et pourquoi {#6-health-probe-behaviour--tcp-only-and-why}

`GoToSocial_Common` déclare `startup_probe` et `liveness_probe` comme **TCP**
par rapport au port d'écoute :

- `startup_probe` : `type = "TCP"`, `path = "/readyz"` (à titre informatif uniquement pour
  une sonde TCP), `initial_delay_seconds = 15`, `period_seconds = 10`,
  `failure_threshold = 10`.
- `liveness_probe` : `type = "TCP"`, `path = "/livez"`,
  `initial_delay_seconds = 30`, `period_seconds = 30`,
  `failure_threshold = 3`.

GoToSocial sert réellement des points de terminaison `/readyz` (exécute
une `SELECT` de base de données, renvoie `500` en cas d'échec) et `/livez` (`200` bon marché) réels, documentés et non authentifiés
— mais **confirmé en direct**, les deux rejettent toute requête sans en-tête `User-Agent`
avec une réponse `418 I'm a teapot` anti-scraper délibérée :
`{"error": "I'm a teapot: no user-agent sent with request"}`. Ni le sondeur HTTP intégré de Cloud
Run ni celui de GKE n'envoie jamais d'en-tête `User-Agent`, donc aucune
sonde de type HTTP sur un chemin quelconque — y compris ces points de terminaison de santé "non authentifiés" — ne peut jamais réussir. La sonde TCP sur le port est le seul type de sonde
qui fonctionne réellement.

Ceci est valable à **la fois** pour cette couche Common et pour la couche du module d'application
(variables `startup_probe`/`liveness_probe` dans `GoToSocial_CloudRun`/
`GoToSocial_GKE`) — les deux variantes de plateforme conservent les valeurs par défaut de Common plutôt
que de les remplacer par un type HTTP, contrairement à un précédent documenté de Planka
ailleurs dans ce catalogue où une valeur par défaut HTTP de niveau application obsolète
remplaçait silencieusement une valeur par défaut Common déjà correcte. Sur Cloud Run, la
sonde de vivacité est en outre **désactivée** entièrement — l'API de Cloud Run
rejette purement et simplement une sonde de vivacité de socket TCP (confirmé ailleurs dans ce
catalogue, par exemple Kopia) — la sonde de démarrage seule est suffisante là-bas.

L'objet `GoToSocial_Common` de `config` déclare également un
`readiness_probe` (`type = "HTTP"`, `path = "/readyz"`) codé en dur et séparé — une construction de niveau Fondation
distincte de `startup_probe`/`liveness_probe` ; les sondes qui
régulent réellement le trafic sur les deux plateformes déployées sont la paire TCP ci-dessus.

**Implication pratique pour quiconque teste cette application manuellement :** chaque
`curl`/outil utilisé contre une instance GoToSocial a besoin d'un en-tête
`User-Agent` explicite, sinon il est `418` — `curl -A "some-agent/1.0" ...`.

---

## 7. Stockage d'objets — client S3 natif de GoToSocial, pas de montage FUSE {#7-object-storage--gotosocials-native-s3-client-no-fuse-mount}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`, classe `STANDARD`, `force_destroy = true`, pas de versioning, `public_access_prevention =
"enforced"`) est déclaré ici et provisionné par la fondation. Un compte de service compagnon (`gotosocial_storage`, ID de compte `gts-store-<hex_suffix>`) détient une paire de clés HMAC (`GTS_STORAGE_S3_ACCESS_KEY` / `GTS_STORAGE_S3_SECRET_KEY`, §2) et se voit accorder `roles/storage.objectAdmin` sur le bucket par le module d'application appelant.

Contrairement au stockage S3 opt-in de type Documenso/Formbricks, ce bucket est
une **infrastructure requise et toujours active** pour GoToSocial — `GTS_STORAGE_BACKEND
= "s3"` est inconditionnel, donc l'application y écrit les médias, les avatars et les pièces jointes
dès le premier démarrage. Il n'y a pas de montage FUSE GCS impliqué ;
le client compatible S3 de GoToSocial communique directement avec le point de terminaison XML/S3-interop de GCS
(`storage.googleapis.com`).

**L'octroi IAM doit exister avant le démarrage du premier pod/révision.** GoToSocial
**panique** au démarrage s'il ne peut pas atteindre son backend S3
(`error opening storage backend: ... Access Denied`), donc le module d'application
câble l'octroi `roles/storage.objectAdmin` contre
`module.app_cloudrun.storage_buckets["storage"]` /
`module.app_gke.storage_buckets["storage"]` (une sortie du sous-module de stockage de la Fondation) plutôt que
`depends_on = [module.app_cloudrun]` /
`depends_on = [module.app_gke]` (le module entier, y compris le
Déploiement/Service). Ce dernier provoquerait un blocage : le Déploiement attend un
pod sain, qui a besoin de l'octroi IAM, qui attendrait lui-même la fin du même Déploiement. Même avec la dépendance plus étroite, un **premier déploiement frais** peut toujours rencontrer un délai de propagation IAM (~1-2 minutes) en concurrence avec le tout premier démarrage du conteneur — il s'agit d'une nouvelle tentative ponctuelle attendue et occasionnelle, et non d'un bug.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
gcloud iam service-accounts list --project "$PROJECT" --filter="email~gts-store"
```

---

## 8. Amorçage du compte administrateur — délibérément manuel/au mieux {#8-admin-account-bootstrap--deliberately-manualbest-effort}

GoToSocial n'a **pas de flux d'inscription basé sur le web et pas de point de terminaison REST** pour le
tout premier compte — il est uniquement en ligne de commande
(`gotosocial admin account create` / `admin account promote`, confirmé
par docs.gotosocial.org/admin/cli). Fait critique, confirmé en direct : la CLI
refuse de créer un compte tant que le processus **serveur** principal n'a pas
terminé son propre amorçage de premier démarrage (création des lignes "instance
account"/"instance application" de la base de données) — il panique avec
`NewSignup: instance application not yet created, run the server at least
once before creating users` sinon.

`GoToSocial_Common` définit le job `admin-create` avec `execute_on_apply =
false`. C'est délibéré, pas une omission :

- **Sur Cloud Run**, les jobs d'initialisation s'exécutent toujours strictement avant que la
  première révision du service n'existe du tout — donc `admin-create` structurellement
  ne peut pas réussir pendant le même `apply` qui crée le service. La ressource de job est toujours créée (afin que la plateforme puisse la déclencher à la demande), mais
  un opérateur doit l'exécuter manuellement une fois que le service est confirmé sain —
  voir le guide de la plateforme CloudRun pour la commande exacte.
- **Sur GKE**, l'ordre est plus lâche : `execute_on_apply` sur `App_GKE` ne
  contrôle que si **Terraform attend** le job
  (`wait_for_completion = try(execute_on_apply, true)`, confirmé par
  `App_GKE/jobs.tf`) — le pod Kubernetes Job sous-jacent est toujours planifié
  immédiatement, quelle que soit la concurrence avec le premier pod du Déploiement principal.
  `scripts/admin-create.sh` réessaie jusqu'à 20 fois à intervalles de 15 secondes
  spécifiquement pour donner au pod principal une réelle chance de terminer son démarrage en premier,
  il a donc une réelle chance de réussir automatiquement pendant le même
  `apply` — mais il n'est pas garanti de gagner cette course à chaque fois. Avant sa
  première tentative `create`, il attend que les migrations de schéma se stabilisent (en sondant avec
  le `admin account list` en lecture seule), car un `create` interrompu par une
  migration concurrente peut laisser un compte à moitié créé que `create`
  signale ensuite comme "déjà utilisé" et que `promote` ne peut pas trouver — un état que les nouvelles tentatives ne peuvent pas réparer.

Une tentative `admin-create` partiellement échouée peut laisser une **ligne de compte orpheline** : le flux `NewSignup` de GoToSocial insère d'abord la ligne de compte, puis
recherche l'ID d'application de l'instance pour la ligne `users` correspondante,
paniquant entre ces deux étapes si l'amorçage du serveur n'était pas encore terminé. La ligne orpheline fait que `IsUsernameAvailable` signale "déjà utilisé" lors de la nouvelle tentative, tandis que les recherches utilisées par une tentative `create`/`promote` ultérieure ne trouvent rien
— une panique `sql: no rows in result set` déroutante qui ressemble à un
bug sans rapport. Voir le tableau des pièges du guide de la plateforme GKE et la tâche de laboratoire 5
pour les étapes exactes de récupération SQL.

---

Pour la configuration spécifique à GoToSocial, orientée utilisateur (variables par groupe,
sorties et comment explorer chaque service depuis la Console et la CLI), consultez les
guides de la plateforme : **[GoToSocial_GKE](GoToSocial_GKE.md)** et
**[GoToSocial_CloudRun](GoToSocial_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [GoToSocial sur GKE Autopilot](GoToSocial_GKE.md) — cette configuration déployée sur GKE.
