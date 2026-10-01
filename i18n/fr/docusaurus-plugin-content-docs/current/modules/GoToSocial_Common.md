---
title: "GoToSocial Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module GoToSocial — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/GoToSocial_Common.md @ 3055034 sha256:d4098c9637d0 -->

# GoToSocial Common — Configuration applicative partagée {#gotosocial-common--shared-application-configuration}

`GoToSocial_Common` est la **couche applicative partagée** de GoToSocial, un
serveur ActivityPub/Fediverse léger et auto-hébergé — une petite alternative
à Mastodon, écrite sous la forme d'un unique binaire Go statique. Elle n'est
pas déployée seule ; elle fournit la configuration propre à GoToSocial sur
laquelle reposent à la fois [GoToSocial_GKE](GoToSocial_GKE.md) et
[GoToSocial_CloudRun](GoToSocial_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement GoToSocial,
consultez les guides de plateforme ([GoToSocial_GKE](GoToSocial_GKE.md),
[GoToSocial_CloudRun](GoToSocial_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par GoToSocial_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Déploie directement l'image officielle `docker.io/superseriousbusiness/gotosocial` — **aucun build personnalisé**. Le projet amont de GoToSocial a migré vers Codeberg, mais le registre de conteneurs reste Docker Hub | Sortie `container_image` ; `image_source = "prebuilt"` |
| Secrets cryptographiques | Génère `SUPERUSER_PASSWORD` (24 caractères aléatoires), ainsi qu'une paire de clés HMAC d'accès/secrète pour le stockage GCS en interopérabilité S3. Tous sont stockés dans **Secret Manager** | Injectés via le chemin `secret_ids` → `module_secret_env_vars` (voir §2) |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge, avec la collation `C` obligatoire | §3 ci-dessous |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` et le rôle applicatif | Sortie `initialization_jobs` |
| Amorçage du compte administrateur | Définit le job `admin-create`, délibérément **non** exécuté automatiquement — GoToSocial n'a pas de parcours d'inscription web | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` et un compte de service de stockage dédié doté d'une paire de clés HMAC pour le client natif compatible S3 de GoToSocial | Sorties `storage_buckets` / `storage_sa_email` |
| Paramètres de base | Définit `GTS_HOST`, `GTS_PROTOCOL=https`, `GTS_PORT=8080`, `GTS_LETSENCRYPT_ENABLED=false`, `GTS_STORAGE_*`, `GTS_TRUSTED_PROXIES`, `GTS_ACCOUNTS_REGISTRATION_OPEN` | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Déclare des valeurs par défaut **TCP** pour `startup_probe`/`liveness_probe` — le HTTP ne fonctionne jamais sur les points de terminaison de GoToSocial (voir §6) | §Observabilité dans les guides de plateforme |

---

## 2. Secrets : comment `SUPERUSER_PASSWORD` et les clés S3 atteignent réellement le conteneur {#2-secrets-how-superuser_password-and-the-s3-keys-actually-reach-the-container}

Trois secrets sont générés automatiquement et stockés dans Secret Manager :

- **`SUPERUSER_PASSWORD`** — une chaîne aléatoire de 24 caractères
  (`random_password`, `special = false`). Utilisé uniquement par le job
  d'initialisation `admin-create`, qui le transmet à
  `gotosocial admin account create --password`. C'est le mot de passe du
  premier compte (propriétaire) de l'instance.
- **`GTS_STORAGE_S3_ACCESS_KEY`** / **`GTS_STORAGE_S3_SECRET_KEY`** — une
  paire de clés HMAC GCS (`google_storage_hmac_key`) émise sur un compte de
  service dédié (`gotosocial_storage`, ID de compte `gts-store-<hex_suffix>`).
  Utilisées par le client `GTS_STORAGE_BACKEND=s3` du conteneur principal.

**Un piège réel qui mérite d'être signalé en évidence.** L'objet `config` de
`GoToSocial_Common` définit `secret_environment_variables = var.secret_environment_variables`
— un passage direct destiné à l'opérateur — et ce champ est une **opération
sans effet du socle**. Vérifié dans le code source
d'`App_CloudRun`/`App_GKE` : `secret_environment_variables` ne fait jamais
que fusionner la variable de premier niveau `var.secret_environment_variables`
avec les préréglages propres au socle ; il ne lit **jamais**
`local.selected_module.secret_environment_variables` (le champ de l'objet de
configuration propre à l'application) — bien que des générations antérieures
de l'échafaudage de ce module (héritées de Synapse, lui-même cloné de Zammad)
aient écrit exactement ce champ mort. Faire transiter un secret par ce champ
le supprime silencieusement : il n'atteint jamais le conteneur déployé.

Le mécanisme qui fonctionne réellement — et celui qu'utilisent à la fois
`SUPERUSER_PASSWORD` et les clés S3 — est le suivant :

```
GoToSocial_Common.secret_ids  →  module_secret_env_vars local (Application module)  →  Foundation module_secret_env_vars input
```

`GoToSocial_CloudRun/gotosocial.tf` et `GoToSocial_GKE/main.tf` définissent
tous deux `module_secret_env_vars = module.gotosocial_app.secret_ids`. Pendant
le développement, cette distinction a coûté un réel temps de débogage : les
variables d'environnement des clés d'accès/secrète S3 étaient silencieusement
absentes de la révision déployée, ce qui produisait des erreurs « Access
Denied » de GCS à chaque opération de stockage, jusqu'à ce que le câblage soit
remonté jusqu'au champ de configuration mort `secret_environment_variables`.

Récupérez les secrets après le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~superuser-password OR name~s3-access-key OR name~s3-secret-key"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret est indiqué dans les sorties du déploiement
de la plateforme (`database_password_secret`).

---

## 3. Moteur de base de données et collation C obligatoire {#3-database-engine-and-the-mandatory-c-collation}

GoToSocial exige **PostgreSQL** (`database_type = "POSTGRES_15"`) et impose
une contrainte d'exécution stricte que la plupart des applications de ce
catalogue reposant sur Postgres n'ont pas : la base de données doit être créée
avec **`LC_COLLATE='C'` et `LC_CTYPE='C'`** — il refuse de démarrer avec toute
autre collation (« Database has incorrect collation ... GoToSocial now
requires 'C' collation »). L'étape générique `db-create` du socle ne
définit pas ce paramètre ; `GoToSocial_Common` fournit donc un job
`db-init` dédié (`scripts/db-init.sh`, image `postgres:15-alpine`) qui, de
manière idempotente :

1. Attend que PostgreSQL accepte les connexions,
2. Crée le rôle applicatif (ou met à jour son mot de passe),
3. Crée la base de données de l'application avec
   `ENCODING 'UTF8' LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`, détenue
   par le rôle applicatif — en recréant une base vide à la mauvaise collation
   si le socle en a créé une d'abord (aucun risque de perte de données,
   puisque cela ne se produit que lors d'un déploiement réellement neuf),
4. Accorde tous les privilèges sur la base de données au rôle applicatif,
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`POST
   http://127.0.0.1:9091/quitquitquit`) afin que le job se termine sur GKE.

**Il n'y a pas de job de migration.** GoToSocial crée et met à niveau son
propre schéma automatiquement à chaque démarrage — `db-init` ne fait que
préparer une base de données vide, avec la bonne collation, et un rôle.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
-- Verify the collation:
SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
```

---

## 4. Image de conteneur — aucun wrapper nécessaire {#4-container-image--no-wrapper-needed}

Contrairement à la plupart des modules Common de ce catalogue,
`GoToSocial_Common` ne construit **pas** d'image personnalisée. Il définit :

```hcl
image_source    = "prebuilt"
container_image = "docker.io/superseriousbusiness/gotosocial:${var.application_version}"
```

Le propre `ENTRYPOINT` de l'image officielle Docker Hub
(`/gotosocial/gotosocial server start`) lit nativement des variables
d'environnement `GTS_*` distinctes — vérifié dans le Dockerfile amont (base
`alpine:3.21`, utilisateur non root `1000:1000`). Aucun wrapper de point
d'entrée n'est nécessaire pour traduire les noms génériques `DB_*` du socle, car le module Application appelant les associe directement à
`GTS_DB_*` via `db_host_env_var_name`/`db_user_env_var_name`/etc. dans son
propre `main.tf` (voir §Base de données dans les guides de plateforme pour
l'asymétrie de mode TLS entre Cloud Run et GKE à laquelle se heurte cet
alias).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`GoToSocial_Common` établit l'environnement GoToSocial de référence
(`local.environment_variables` dans `main.tf`) :

- **`GTS_HOST`** — le domaine public, inscrit dans chaque URI d'acteur/objet
  ActivityPub créé localement au moment de sa création. **Immuable après le
  premier démarrage** — même catégorie de risque que le `server_name` de
  Synapse ou l'`URL` d'Outline.
- **`GTS_ACCOUNT_DOMAIN`** — domaine de vitrine distinct facultatif pour les
  identifiants de compte ; prend par défaut la valeur de `GTS_HOST` lorsqu'il
  est vide. Même risque d'immuabilité.
- **`GTS_PROTOCOL = "https"`** — doit rester `https` même si le conteneur ne
  parle jamais que du HTTP simple en interne ; Cloud Run/GKE terminent la
  véritable connexion HTTPS publique à leur propre périphérie. La
  documentation de GoToSocial avertit que modifier cette valeur par la suite
  casse définitivement les URI déjà générés.
- **`GTS_PORT = "8080"`**, **`GTS_BIND_ADDRESS = "0.0.0.0"`**.
- **`GTS_LETSENCRYPT_ENABLED = "false"`** — obligatoire ; la périphérie de la
  plateforme termine déjà le TLS, et le client ACME intégré de GoToSocial
  tenterait sinon (et échouerait, bruyamment mais sans conséquence) de se
  lier lui-même aux ports 80/443.
- **`GTS_DB_TYPE = "postgres"`**, **`GTS_DB_TLS_MODE = "disable"`** — correct
  pour GKE (le loopback `127.0.0.1` du sidecar cloud-sql-proxy) ; **remplacé
  par `"enable"` dans `GoToSocial_CloudRun`**, car le
  `db_host_env_var_name` de Cloud Run pointe vers l'IP privée brute de Cloud
  SQL, et non vers un socket Unix — consultez le tableau des pièges du guide
  de la plateforme CloudRun pour l'explication complète des modes TLS
  (`enable`, `require` et `disable` ne signifient **pas** ce que leurs noms
  suggèrent).
- **`GTS_STORAGE_BACKEND = "s3"`**, **`GTS_STORAGE_S3_ENDPOINT =
  "storage.googleapis.com"`**, **`GTS_STORAGE_S3_USE_SSL = "true"`**,
  **`GTS_STORAGE_S3_PROXY = "true"`** (la sémantique des URL présignées de
  GCS diffère de celle d'AWS S3 ; les médias sont donc servis via GtS
  lui-même),
  **`GTS_STORAGE_S3_BUCKET_LOOKUP = "path"`**,
  **`GTS_STORAGE_S3_BUCKET = "gcs-<service_name>-storage"`**.
- **`GTS_TRUSTED_PROXIES = "0.0.0.0/0,::/0"`** — le conteneur n'est jamais
  atteint que via l'ingress propre de Cloud Run/GKE (aucun chemin client
  direct n'existe) ; le saut immédiat est donc intrinsèquement fiable pour le
  regroupement des IP par limitation de débit basé sur `X-Forwarded-For`, et
  il ne s'agit pas d'une décision d'authentification.
- **`GTS_ACCOUNTS_REGISTRATION_OPEN`** — piloté par `var.enable_open_registration`
  (par défaut `false`). Le propriétaire de l'instance est le superutilisateur
  provisionné par `admin-create`.

Redis n'est volontairement **pas** utilisé — le cache de GoToSocial est
entièrement en mémoire du processus ; `enable_redis` vaut `false` par défaut
et doit le rester.

---

## 6. Comportement des sondes de santé — TCP uniquement, et pourquoi {#6-health-probe-behaviour--tcp-only-and-why}

`GoToSocial_Common` déclare `startup_probe` et `liveness_probe` en **TCP**
sur le port d'écoute :

- `startup_probe` : `type = "TCP"`, `path = "/readyz"` (purement informatif
  pour une sonde TCP), `initial_delay_seconds = 15`, `period_seconds = 10`,
  `failure_threshold = 10`.
- `liveness_probe` : `type = "TCP"`, `path = "/livez"`,
  `initial_delay_seconds = 30`, `period_seconds = 30`,
  `failure_threshold = 3`.

GoToSocial sert bel et bien des points de terminaison réels, documentés et
non authentifiés `/readyz` (exécute un `SELECT` sur la base, renvoie `500` en
cas d'échec) et `/livez` (`200` peu coûteux) — mais, **vérifié en
conditions réelles**, tous deux rejettent toute requête dépourvue d'en-tête
`User-Agent` par une réponse anti-scraping délibérée `418 I'm a teapot` :
`{"error": "I'm a teapot: no user-agent sent with request"}`. Ni la sonde
HTTP intégrée de Cloud Run ni celle de GKE n'envoient jamais d'en-tête
`User-Agent` ; aucune sonde de type HTTP sur aucun chemin — y compris ces
points de terminaison de santé « non authentifiés » — ne peut donc jamais
réussir. Le TCP sur le port est le seul type de sonde qui fonctionne
réellement.

Cela vaut **à la fois** pour cette couche Common et pour la couche du module
Application (variables `startup_probe`/`liveness_probe` dans
`GoToSocial_CloudRun`/`GoToSocial_GKE`) — les deux variantes de plateforme
conservent les valeurs par défaut de Common au lieu de les remplacer par un
type HTTP, contrairement à un précédent documenté pour Planka ailleurs dans ce
catalogue, où une valeur par défaut HTTP obsolète au niveau Application
remplaçait silencieusement une valeur par défaut Common déjà correcte. Sur
Cloud Run, la sonde de vivacité est en outre entièrement **désactivée** —
l'API de Cloud Run rejette purement et simplement une sonde de vivacité de
type socket TCP (vérifié ailleurs dans ce catalogue, par exemple pour
Kopia) — la sonde de démarrage seule y suffit.

L'objet `config` de `GoToSocial_Common` déclare également un `readiness_probe`
distinct et codé en dur (`type = "HTTP"`, `path = "/readyz"`) — une
construction de niveau du socle distincte de `startup_probe`/`liveness_probe` ;
les sondes qui conditionnent réellement le trafic sur les deux plateformes
déployées sont la paire TCP ci-dessus.

**Conséquence pratique pour quiconque teste cette application
manuellement :** chaque `curl`/outil utilisé contre une instance GoToSocial
doit envoyer un en-tête `User-Agent` explicite, sous peine de recevoir un
`418` — `curl -A "some-agent/1.0" ...`.

---

## 7. Stockage d'objets — le client S3 natif de GoToSocial, sans montage FUSE {#7-object-storage--gotosocials-native-s3-client-no-fuse-mount}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`, classe
`STANDARD`, `force_destroy = true`, sans gestion des versions, `public_access_prevention =
"enforced"`) est déclaré ici et provisionné par le
socle. Un compte de service associé (`gotosocial_storage`, ID de compte
`gts-store-<hex_suffix>`) détient une paire de clés HMAC
(`GTS_STORAGE_S3_ACCESS_KEY` / `GTS_STORAGE_S3_SECRET_KEY`, §2) et reçoit le
rôle `roles/storage.objectAdmin` sur le bucket de la part du module
Application appelant.

Contrairement au stockage S3 facultatif de type Documenso/Formbricks, ce
bucket est une **infrastructure obligatoire et toujours active** pour
GoToSocial — `GTS_STORAGE_BACKEND
= "s3"` est inconditionnel ; l'application
y écrit donc les médias, avatars et pièces jointes dès le tout premier
démarrage. Aucun montage GCS FUSE n'intervient ; le propre client compatible
S3 de GoToSocial communique directement avec le point de terminaison
XML/interopérabilité S3 de GCS (`storage.googleapis.com`).

**L'attribution IAM doit exister avant le démarrage du premier pod/de la
première révision.** GoToSocial **panique** au démarrage s'il ne peut pas
joindre son backend S3 (`error opening storage backend: ... Access Denied`) ;
le module Application câble donc l'attribution `roles/storage.objectAdmin`
sur `module.app_cloudrun.storage_buckets["storage"]` /
`module.app_gke.storage_buckets["storage"]` (une sortie du propre sous-module
de stockage du socle) plutôt que sur `depends_on = [module.app_cloudrun]` /
`depends_on = [module.app_gke]` (le module entier, y compris le
Deployment/Service). Cette dernière option provoquerait un interblocage : le
Deployment attend un pod sain, qui a besoin de l'attribution IAM, laquelle
attendrait elle-même que ce même Deployment se termine. Même avec cette
dépendance plus étroite, un **tout premier déploiement** peut encore subir le
délai de propagation IAM (~1–2 minutes) en concurrence avec le tout premier
démarrage du conteneur — il s'agit d'une nouvelle tentative ponctuelle,
attendue et occasionnelle, et non d'un bug.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
gcloud iam service-accounts list --project "$PROJECT" --filter="email~gts-store"
```

---

## 8. Amorçage du compte administrateur — délibérément manuel/au mieux {#8-admin-account-bootstrap--deliberately-manualbest-effort}

GoToSocial n'a **ni parcours d'inscription web ni point de terminaison REST**
pour le tout premier compte — tout passe par la CLI
(`gotosocial admin account create` / `admin account promote`, vérifié dans
docs.gotosocial.org/admin/cli). Point crucial, vérifié en conditions
réelles : la CLI refuse de créer le moindre compte tant que le processus
**serveur** principal n'a pas terminé son propre amorçage de premier
démarrage (création des lignes « instance account »/« instance application »
de la base) — sinon elle panique avec
`NewSignup: instance application not yet created, run the server at least
once before creating users`.

`GoToSocial_Common` définit le job `admin-create` avec `execute_on_apply =
false`. C'est délibéré, et non un oubli :

- **Sur Cloud Run**, les jobs d'initialisation s'exécutent toujours
  strictement avant même que la première révision du service n'existe —
  `admin-create` ne peut donc structurellement pas réussir pendant le même
  `apply` qui crée le service. La ressource de job est tout de même créée
  (afin que la plateforme puisse le déclencher à la demande), mais un
  opérateur doit l'exécuter manuellement une fois le service confirmé sain —
  consultez le guide de la plateforme CloudRun pour la commande exacte.
- **Sur GKE**, l'ordonnancement est plus souple : `execute_on_apply` dans
  `App_GKE` contrôle uniquement si **Terraform attend** le job
  (`wait_for_completion = try(execute_on_apply, true)`, vérifié dans
  `App_GKE/jobs.tf`) — le pod du Job Kubernetes sous-jacent est malgré
  tout planifié immédiatement, en concurrence avec le premier pod du
  Deployment principal. `scripts/admin-create.sh` effectue jusqu'à 20
  nouvelles tentatives à 15 secondes d'intervalle, précisément pour laisser
  au pod principal une réelle chance de terminer son démarrage d'abord ; le
  job a donc une véritable chance de réussir automatiquement pendant le même
  `apply` — mais il n'est pas assuré de gagner cette course à chaque fois.

Une tentative `admin-create` partiellement échouée peut laisser une **ligne
de compte orpheline** : le flux `NewSignup` de GoToSocial insère d'abord la
ligne du compte, puis recherche l'ID de l'application de l'instance pour la
ligne `users` correspondante, et panique entre ces deux étapes si l'amorçage
du serveur n'était pas encore terminé. La ligne orpheline amène
`IsUsernameAvailable` à signaler « already in use » lors d'une nouvelle
tentative, tandis que les recherches effectuées par une tentative
`create`/`promote` ultérieure ne trouvent rien — une panique
`sql: no rows in result set` déroutante, qui ressemble à un bug sans rapport.
Consultez le tableau des pièges du guide de la plateforme GKE et la tâche 5
du lab pour les étapes exactes de récupération en SQL.

---

Pour la configuration propre à GoToSocial et destinée aux utilisateurs
(variables par groupe, sorties, et comment explorer chaque service depuis la
console et la CLI), consultez les guides de plateforme :
**[GoToSocial_GKE](GoToSocial_GKE.md)** et
**[GoToSocial_CloudRun](GoToSocial_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [GoToSocial sur GKE Autopilot](GoToSocial_GKE.md) — cette configuration déployée sur GKE.
