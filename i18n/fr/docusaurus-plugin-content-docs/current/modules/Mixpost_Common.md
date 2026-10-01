---
title: "Mixpost Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Mixpost — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Mixpost_Common.md @ 3055034 sha256:367a0c89d622 -->

# Mixpost Common — Configuration applicative partagée {#mixpost-common--shared-application-configuration}

`Mixpost_Common` est la **couche applicative partagée** de Mixpost. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Mixpost sur laquelle
s'appuient [Mixpost_GKE](Mixpost_GKE.md) et [Mixpost_CloudRun](Mixpost_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où cela
compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle
n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Mixpost, consultez les
guides des plateformes ([Mixpost_GKE](Mixpost_GKE.md), [Mixpost_CloudRun](Mixpost_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Mixpost_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère l'`APP_KEY` de Laravel (32 octets aléatoires, stockés sous la forme `base64:<value>`) et la stocke dans **Secret Manager** | Injectée automatiquement comme variable d'environnement secrète `APP_KEY` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Déploie **directement** l'image officielle `inovector/mixpost:<version>` — `image_source = "prebuilt"`, sans build personnalisé ; `enable_image_mirroring = true` la duplique dans Artifact Registry | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour MySQL 8.0** (`database_type = "MYSQL_8_0"`) comme unique moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données (`utf8mb4`), l'utilisateur et les droits — pas de job de migration séparé, puisque l'image effectue ses propres migrations au démarrage | Output `initialization_jobs` |
| Stockage objet | Déclare un bucket **Cloud Storage** suffixé `storage` | Output `storage_buckets` |
| Paramètres de base | Définit l'environnement Laravel/Mixpost de référence : nom/environnement/débogage de l'application, `DB_CONNECTION=mysql`, `TRUSTED_PROXIES`, expéditeur des e-mails sortants | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les valeurs par défaut des sondes de démarrage/vivacité (toutes deux HTTP sur `/`) ; remplacées par plateforme dans le `main.tf`/`variables.tf` de la variante | §Comportement des sondes de santé ci-dessous et guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié par rotation après le premier
déploiement :

- **`APP_KEY`** (`secret-<resource_prefix>-<application_name>-app-key`) — 32 octets
  aléatoires (`random_password`, `special = false`) écrits dans Secret Manager sous la
  forme `base64:<base64-encoded-value>`, conformément au format natif de l'`APP_KEY`
  de Laravel. Les applications Laravel ont besoin de cette clé pour chiffrer et
  déchiffrer les données de session, les cookies et les éventuels champs chiffrés de
  la base de données. La faire tourner après le premier démarrage invalide toutes les
  données de session/cookies chiffrées existantes ainsi que toutes les colonnes
  chiffrées — il n'existe aucun moyen de rechiffrement.

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~mixpost-app-key"

# Read the secret version (Laravel's native base64: format):
gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
```

`Mixpost_Common` exécute également un sous-module `cleanup_orphaned_secrets` avant la
création des secrets, et conditionne la version du secret `APP_KEY` à un `time_sleep`
de 30 secondes afin que les ressources dépendantes (jobs d'initialisation,
configuration du conteneur) n'entrent pas en concurrence avec la propagation du
secret dans Secret Manager.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

Mixpost requiert **MySQL 8.0** ; le moteur est fixe
(`database_type = "MYSQL_8_0"`, `DB_CONNECTION = "mysql"`) et les autres moteurs ne
sont pas pris en charge. Au premier déploiement, un job ponctuel (`db-init`, image
`mysql:8.0-debian`) exécute `scripts/db-init.sh` et, de manière idempotente :

1. Résout l'hôte cible — privilégie `DB_HOST` (l'adresse loopback du Cloud SQL Auth
   Proxy sur GKE) et se replie sur `DB_IP` (IP privée directe) — et détecte s'il
   s'agit d'un chemin de socket Unix (`-S`, Cloud Run) ou d'un hôte TCP
   (`-h ... --get-server-public-key`, GKE via le sidecar Auth Proxy ; l'option de clé
   publique est requise car `caching_sha2_password` de MySQL 8 refuse d'envoyer un
   mot de passe sur ce qui ressemble à une connexion non chiffrée),
2. Attend que MySQL soit joignable (jusqu'à 30 tentatives, espacées de 2s), en
   utilisant les identifiants root si `ROOT_PASSWORD` est défini, ou sinon les propres
   identifiants de l'utilisateur applicatif,
3. Crée la base de données applicative avec `utf8mb4` / `utf8mb4_0900_ai_ci`
   (collation par défaut de MySQL 8.0),
4. Supprime puis recrée l'utilisateur applicatif (`DROP USER IF EXISTS` puis
   `CREATE USER ... IDENTIFIED BY`, en s'appuyant sur le plugin d'authentification
   par défaut du serveur plutôt que d'épingler `mysql_native_password`, que MySQL 8.4
   a supprimé),
5. Accorde tous les privilèges sur la base de données, plus `CREATE, ALTER, DROP, INDEX,
   REFERENCES`,
6. Vérifie que l'utilisateur applicatif peut se connecter et affiche le jeu de
   caractères, la collation et la version de la base de données,
7. Sur le chemin TCP (GKE) uniquement, envoie une requête POST d'arrêt
   `quitquitquit` au sidecar Cloud SQL Auth Proxy sur `127.0.0.1:9091` (via `curl` ou
   un repli brut sur `/dev/tcp`, car la présence de `curl` ou de `wget` n'est pas
   garantie dans `mysql:8.0-debian`) afin que le sidecar se termine une fois le job
   achevé ; sur le chemin par socket Unix (Cloud Run), il n'y a pas de sidecar proxy,
   cette étape est donc ignorée.

Il n'y a **pas de job de migration séparé** — le point d'entrée supervisord propre à
l'image préconstruite `inovector/mixpost` exécute `php artisan migrate --force` et
crée le compte administrateur à chaque démarrage du conteneur, de sorte que les mises
à niveau de schéma s'appliquent automatiquement au prochain démarrage de
l'application après un changement de `application_version`. Le job `db-init` peut
être relancé sans risque (`execute_on_apply = true`, `max_retries = 1`).

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Contrairement à la plupart des modules applicatifs construits sur mesure,
`Mixpost_Common` ne construit **pas** d'image et n'en enveloppe aucune —
`image_source = "prebuilt"` et `container_build_config.enabled = false`. La
configuration du conteneur pointe directement vers
`inovector/mixpost:<application_version>` (Mixpost Lite), que Google duplique dans
Artifact Registry lorsque `enable_image_mirroring = true` (valeur par défaut). Il n'y
a ni `entrypoint.sh` ni `Dockerfile` personnalisé dans
`modules/Mixpost_Common/scripts/` — le seul script livré par cette couche est
`db-init.sh`, pour le job d'initialisation.

Toutes les responsabilités du point d'entrée — lecture des variables
d'environnement, exécution de `php artisan migrate --force`, création du compte
administrateur par défaut et démarrage de nginx + PHP-FPM sous supervisord — sont
entièrement prises en charge par le processus de démarrage propre à l'image
officielle `inovector/mixpost`. Cela signifie :

- Il n'y a **aucune couche de traduction des variables d'environnement** dans ce
  module (contrairement à des applications comme Activepieces, qui associent les
  variables `DB_*` de la plateforme à un préfixe natif de l'application dans un point
  d'entrée personnalisé) — Mixpost lit directement les variables natives de Laravel
  `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_PASSWORD`, ainsi que
  `DB_USERNAME` / `DB_DATABASE`, que les fichiers `main.tf` des variantes associent
  aux `DB_USER`/`DB_NAME` propres au tenant fournis par le socle via les
  remplacements `db_user_env_var_name` / `db_name_env_var_name` (absents de
  `Mixpost_Common` lui-même).
- Il n'y a **aucune étape de correction d'URL à l'exécution** —
  `service_url_env_var_name =
  "APP_URL"` est défini dans le `main.tf` de la variante, de sorte que le socle
  injecte l'URL prévue/réelle du service directement dans la variable native
  `APP_URL` de Laravel ; l'image la consomme telle quelle au démarrage sans aucune
  réécriture côté point d'entrée.
- Le compte administrateur initial (par défaut `admin@example.com` / `changeme`) est
  créé par l'image elle-même et n'est **pas** influencé par la variable
  `mixpost_admin_email` de ce module, déclarée par souci de cohérence avec la
  convention et la transmission, mais actuellement reliée à aucune variable
  d'environnement lue par l'image.

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`Mixpost_Common` établit l'environnement Mixpost/Laravel de référence afin que
l'application démarre correctement dès le premier lancement :

- **Identité de l'application** — `APP_NAME` (issu de `display_name`, par défaut
  `Mixpost`), `APP_ENV = "production"`, `APP_DEBUG = "false"`.
- **Connexion à la base de données** — `DB_CONNECTION = "mysql"` sans condition ; le
  socle injecte les valeurs réelles de `DB_HOST` / `DB_PORT` / `DB_PASSWORD` (et le
  câblage de la variante associe `DB_USER` → `DB_USERNAME`, `DB_NAME` → `DB_DATABASE`).
- **Proxys** — `TRUSTED_PROXIES = "*"` afin que Laravel fasse confiance à
  l'équilibreur de charge / au frontal Cloud Run pour les en-têtes `X-Forwarded-*`.
- **E-mails sortants** — `MAIL_MAILER = "smtp"`, `MAIL_FROM_NAME` (issu de
  `var.mail_from_name`, par défaut `Mixpost`), `MAIL_FROM_ADDRESS` (issu de
  `var.mail_from_address`, par défaut `mixpost@example.com`).
- **Points d'extension des plugins MySQL** — `enable_mysql_plugins = false`,
  `mysql_plugins = []` (aucun flag de plugin Cloud SQL demandé par ce module).

Les pilotes de file d'attente, de cache et de session (`QUEUE_CONNECTION`,
`CACHE_DRIVER`, `SESSION_DRIVER`) ne sont **pas** définis par `Mixpost_Common` — les
locals du `main.tf` propre à chaque variante les orientent vers `redis` lorsque
`enable_redis = true` (la valeur par défaut partagée), avec repli sur `sync`/`file`
lorsque Redis est désactivé.

Les ajustements propres à chaque plateforme ont lieu entièrement dans les modules de
variante, et non ici :

- **Cloud Run** définit par défaut `min_instance_count = 0` et
  `cpu_always_allocated = false` — démarrage à froid, facturation à la requête. Cela
  signifie que le planificateur et le worker de file d'attente Laravel du conteneur
  (exécutés par le supervisord de l'image) ne s'exécutent que lorsqu'une instance se
  trouve active ou sert une requête ; la **publication planifiée des posts sociaux
  n'est donc pas fiable telle quelle**. Aucune ressource Cloud Scheduler n'est câblée
  automatiquement par `Mixpost_Common` ou par le module CloudRun — la solution
  documentée est un job Cloud Scheduler configuré par l'opérateur qui appelle un point
  de terminaison cron toutes les minutes (via la variable générique du socle
  `cron_jobs`, ou un planificateur externe), ou le remplacement par
  `cpu_always_allocated = true` avec `min_instance_count >= 1` pour maintenir le
  planificateur en fonctionnement continu.
- **GKE** définit par défaut `min_instance_count = 1`, de sorte qu'au moins un pod
  est toujours en cours d'exécution et que le planificateur/worker de file d'attente
  géré par supervisord fonctionne sans aucun câblage cron externe.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les variables `startup_probe` / `liveness_probe` propres à `Mixpost_Common` ont
toutes deux pour valeur par défaut **HTTP sur `/`** (démarrage : délai initial de
90s, période de 15s, seuil de 30 tentatives ; vivacité : délai initial de 120s,
période de 30s, seuil de 3 tentatives), mais chaque variante de plateforme remplace
la sonde réellement appliquée à la charge de travail :

- **Cloud Run** remplace la sonde de démarrage par une sonde **TCP** sur le port 80
  dans son propre `main.tf` (les contrôles de santé Cloud Run arrivent en HTTP simple
  depuis une adresse interne à Google, et il suffit de confirmer que le port écoute) ;
  la sonde de vivacité reste **HTTP** sur `/`, auquel Mixpost/nginx répond
  directement `200`.
- **GKE** remplace **les deux** sondes par des sondes **TCP** sur le port 80
  (`startup_probe_config` / `health_check_config`, les variables que le socle câble
  réellement sur les sondes du Deployment) — Mixpost répond à `/` par une redirection
  `302` vers l'URL externe de l'application, et la sonde HTTP du kubelet suit cette
  redirection vers `https://<pod-ip>:443`, où rien n'écoute, ce qui provoque une
  boucle de redémarrages alors que l'application est saine sur `:80`. Les variables
  `startup_probe` / `liveness_probe` héritées de `Mixpost_Common` (toujours en HTTP)
  sont donc purement cosmétiques sur GKE — elles alimentent l'objet de configuration
  de l'application mais sont supplantées par les sondes TCP `startup_probe_config` /
  `health_check_config` pour les sondes réelles des pods.

---

## 7. Stockage objet {#7-object-storage}

Un bucket **Cloud Storage** dédié (`name_suffix = "storage"`,
`force_destroy = true`) est déclaré ici et provisionné par le socle, qui accorde
également l'accès au compte de service de la charge de travail. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

Pour la configuration propre à Mixpost destinée aux utilisateurs (variables par
groupe, outputs, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Mixpost_GKE](Mixpost_GKE.md)** et
**[Mixpost_CloudRun](Mixpost_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Mixpost sur GKE Autopilot](Mixpost_GKE.md) — cette configuration déployée sur GKE.
