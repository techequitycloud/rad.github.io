---
title: "Snipe-IT Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Snipe-IT — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/SnipeIT_Common.md @ 3055034 sha256:b0179bf3c9bc -->

# Snipe-IT Common — Configuration applicative partagée {#snipe-it-common--shared-application-configuration}

`SnipeIT_Common` est la **couche applicative partagée** de Snipe-IT. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Snipe-IT sur
laquelle s'appuient à la fois [SnipeIT_GKE](SnipeIT_GKE.md) et
[SnipeIT_CloudRun](SnipeIT_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a
aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Snipe-IT, consultez
les guides des plateformes ([SnipeIT_GKE](SnipeIT_GKE.md), [SnipeIT_CloudRun](SnipeIT_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par SnipeIT_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | Génère l'`APP_KEY` Laravel (`base64:` + 32 octets aléatoires encodés en base64) et le stocke dans **Secret Manager** | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Déploie directement l'image officielle `snipe/snipe-it:<application_version>` — pas de build personnalisé, pas de point d'entrée personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la chaîne ordonnée de tâches d'initialisation (`db-init` → `migrate`) qui crée la base de données/l'utilisateur et exécute les migrations Laravel | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `snipeit-uploads` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement de référence de Snipe-IT (Laravel) : `APP_ENV`, `DB_CONNECTION`, pilotes de sessions/de cache/de file d'attente, `APP_URL`, raccordement à Redis | Comportement de l'application dans les guides des plateformes |
| Tests de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP par défaut, identiques dans les deux variantes de plateforme | §Observabilité dans les guides des plateformes |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

Un **seul** secret est généré automatiquement et stocké dans Secret Manager —
contrairement à certains modules Common qui en créent deux ou trois, Snipe-IT
n'a besoin que de la clé d'application Laravel. Il n'est jamais défini en texte
clair et ne doit jamais être modifié après le premier déploiement :

- **`APP_KEY`** — Laravel l'exige sous la forme `"base64:<base64 of 32
  random bytes>"`. `SnipeIT_Common` génère un mot de passe ASCII de 32 caractères
  `random_password` (32 octets), l'encode en base64 et le préfixe par `base64:` —
  exactement ce qu'attend le chiffrement AES-256-CBC de Laravel une fois le
  préfixe retiré. Il est stocké sous
  `secret-<resource_prefix>-snipeit-app-key` et injecté comme variable
  d'environnement secrète `APP_KEY` via la sortie `secret_ids`. En effectuer la
  rotation après le premier démarrage invalide toutes les sessions actives et
  rend irrécupérables toutes les données que Snipe-IT a chiffrées avec
  l'ancienne clé (p. ex. des identifiants tiers stockés).

Un sous-module `cleanup_orphaned_secrets` s'exécute avant la création des
secrets pour supprimer les versions de secrets obsolètes laissées par un
déploiement renommé ou recréé, et un `time_sleep` de 30 secondes
(`wait_for_secrets`) conditionne la sortie `secret_ids` afin que les ressources
dépendantes n'entrent pas en concurrence avec la propagation de la version du
secret.

Le mot de passe de la base de données est généré et géré séparément par le
socle ; le nom de son secret est indiqué dans les sorties du déploiement de la
plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md)
pour le modèle partagé des secrets et de Workload Identity.

Récupérez le secret après le déploiement :

```bash
# List the Snipe-IT secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~snipeit-app-key"

# Read the secret version (returns the full "base64:..." value):
gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Snipe-IT nécessite **MySQL 8.0** ; `SnipeIT_Common` code en dur
`database_type = "MYSQL_8_0"` dans sa sortie `config`, quelle que soit la
valeur transmise par le module Application ou par l'utilisateur — aucun autre
moteur n'est pris en charge. Sauf si un module Application remplace
`initialization_jobs`, deux tâches ordonnées s'exécutent à chaque apply :

1. **`db-init`** (image `mysql:8.0-debian`, `execute_on_apply = true`,
   `max_retries = 3`, délai d'expiration de 600 s) — exécute
   `scripts/db-init.sh`, qui :
   - installe `nc`/`curl`/`mysql-client` quelle que soit l'image de base sur
     laquelle il s'exécute,
   - sur GKE, privilégie les fichiers montés par Secret Store CSI sous
     `/mnt/secrets-store/` (`root-password`, `db-password`) plutôt que les
     variables d'environnement injectées, car les fichiers montés font
     toujours autorité,
   - recherche un socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` (en
     attendant jusqu'à 30 s qu'il apparaisse) et le privilégie ; si aucun
     n'est monté ou n'apparaît, se rabat sur TCP vers `DB_IP` (ou un
     `DB_HOST` qui n'est pas un socket),
   - attend la connectivité TCP sur le port 3306 lorsqu'il utilise TCP,
   - détecte si le client `mysql` local prend en charge
     `--get-server-public-key` et l'utilise pour les connexions TCP, car le
     `caching_sha2_password` de Cloud SQL MySQL 8 nécessite un échange de clés
     RSA sur un canal TCP en clair (terminé par le proxy),
   - écrit un `~/.my.cnf` temporaire (identifiants root, correctement
     échappés) plutôt que de transmettre le mot de passe sur la ligne de
     commande,
   - crée de manière idempotente l'utilisateur de l'application (ou en
     redéfinit le mot de passe), crée la base de données si elle est absente et
     lui accorde tous les privilèges sur celle-ci,
   - **vérifie que l'utilisateur de l'application peut réellement se
     connecter** — ce qui permet à la fois de détecter les problèmes de mot de
     passe ou d'autorisations au moment de la tâche plutôt qu'au démarrage du
     pod, et de préchauffer le cache d'authentification
     `caching_sha2_password` côté serveur de MySQL 8, afin que les connexions
     ultérieures de PHP/des clients n'aient pas besoin de l'échange RSA,
   - arrête proprement le sidecar Cloud SQL Auth Proxy via le point de
     terminaison d'administration `quitquitquit` (en se rabattant sur
     `SIGKILL`, jamais `SIGTERM`, car `SIGTERM` se termine avec le code 143 et
     déclenche un redémarrage `OnFailure`).
2. **`migrate`** (image `snipe/snipe-it:<application_version>`,
   `depends_on_jobs = ["db-init"]`, `max_retries = 2`, délai d'expiration de
   1200 s) — exécute `php /var/www/html/artisan migrate --force` afin que le
   schéma existe avant que la première révision de l'application ne serve du
   trafic. Le socle fusionne automatiquement l'environnement complet et les
   secrets de l'application (`APP_ENV`, `DB_CONNECTION`, `DB_HOST`,
   `DB_DATABASE`, `DB_USERNAME`, `DB_PORT`, `APP_KEY`, `DB_PASSWORD`,
   `ROOT_PASSWORD`) dans cette tâche ; aucun raccordement de variables
   d'environnement propre à la tâche n'est donc défini ici. La migration
   automatique au démarrage de l'image officielle, si elle existe, constitue un
   filet de sécurité secondaire, et non le chemin principal de création du
   schéma.

Les deux tâches peuvent être relancées sans risque. Inspectez directement la
base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans
les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

`SnipeIT_Common` déploie l'image **officielle et non modifiée** `snipe/snipe-it:<application_version>`
(tag par défaut `v8-latest`) directement depuis Docker Hub :

- `image_source = "prebuilt"` et `container_build_config.enabled = false` —
  il n'y a pas d'étape Cloud Build ni de Dockerfile appartenant à ce module.
  Les champs `dockerfile_path`/`context_path`/`base_image` de
  `container_build_config` sont déclarés pour la parité de structure avec les
  modules Common à build personnalisé, mais restent inertes tant que
  `enabled = false`.
- **Pas de script de point d'entrée personnalisé.** Contrairement aux modules
  Common qui encapsulent leur image de base dans un point d'entrée shell pour
  traduire des variables d'environnement ou corriger des URL à l'exécution, le
  répertoire `scripts/` de `SnipeIT_Common` ne contient que `db-init.sh` (un
  script de tâche d'initialisation, et non un point d'entrée de conteneur) — il
  n'y a ici ni `entrypoint.sh` ni `Dockerfile`. Tout le comportement au
  démarrage (lancement d'Apache, corrections de permissions, vérifications de
  la clé et de la configuration Laravel) correspond à ce que fait déjà en
  interne l'image officielle `snipe/snipe-it` ; ce dépôt ne l'intercepte ni ne
  le modifie.
- Faute de couche de traduction, les variables
  `DB_HOST`/`DB_IP`/`DB_PASSWORD`/`APP_KEY` injectées par le socle doivent déjà
  correspondre aux noms qu'attend la configuration `env()` de Laravel. Les
  commentaires du code de `SnipeIT_Common` précisent que cela est obtenu une
  couche plus haut : le `main.tf` du module Application définit
  `db_user_env_var_name = "DB_USERNAME"` et
  `db_name_env_var_name = "DB_DATABASE"` afin que le socle renseigne
  directement `DB_USERNAME`/`DB_DATABASE`, et injecte le mot de passe via
  `db_password_env_var_name = "DB_PASSWORD"`. `SnipeIT_Common` lui-même ne
  définit par-dessus que la configuration statique, non dérivée
  (`DB_CONNECTION`, `DB_PORT`, etc.).
- `enable_mysql_plugins = false` et `mysql_plugins = []` sont fixés dans la
  sortie `config` — Snipe-IT n'a besoin d'aucun plugin MySQL.

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`SnipeIT_Common` établit l'environnement de référence de Snipe-IT (Laravel)
afin que l'application démarre correctement dès le premier démarrage, en
fusionnant (dans l'ordre) les valeurs par défaut statiques, un `APP_URL`
conditionnel, des paramètres Redis conditionnels et enfin les
`environment_variables` fournies par l'appelant (qui l'emportent en cas de
conflit de clés) :

- **Environnement** — `APP_ENV = "production"`, `APP_DEBUG = "false"`.
- **Connexion à la base de données** — `DB_CONNECTION = "mysql"`, `DB_PORT = "3306"`.
  (`DB_HOST`, `DB_USERNAME`, `DB_DATABASE`, `DB_PASSWORD` sont injectés par le
  socle sous les noms natifs de Laravel configurés une couche plus haut — voir
  §4.)
- **Persistance des sessions, du cache et de la file d'attente** — `SESSION_DRIVER = "database"`,
  `CACHE_DRIVER = "file"`, `QUEUE_DRIVER = "database"` — les sessions et les
  tâches en file d'attente sont persistées afin de survivre aux redémarrages de
  conteneurs/de pods, même avec une seule instance en cours d'exécution.
- **`APP_URL`** — défini à partir de `var.service_url` dès qu'il n'est pas vide
  (le socle exporte toujours une URL de service prévue — `CLOUDRUN_SERVICE_URL`
  sur Cloud Run, l'URL du service GKE sur GKE — que le module Application
  transmet comme `service_url`). Une erreur sur cette valeur casse la
  redirection `/` → `/setup` de Snipe-IT vers l'assistant d'installation.
- **Redis** — lorsque `var.enable_redis` vaut true, définit `REDIS_HOST` (sur
  `var.redis_host` s'il n'est pas vide, sinon sur la référence d'exécution
  `$(REDIS_HOST)` du socle) et `REDIS_PORT`. Ce module transmet toujours
  `enable_redis` sans condition plutôt que de le subordonner à la définition de
  `redis_host`, conformément à la convention d'injection de Redis du dépôt.

Les ajustements propres à chaque plateforme ne sont **pas** effectués dans
`SnipeIT_Common` lui-même — la variable `enable_cloudsql_volume` déclarée ici
vaut `true` par défaut (une valeur par défaut générique de la couche Common),
mais chaque module Application la remplace indépendamment pour correspondre au
modèle de connexion de sa plateforme : `SnipeIT_CloudRun` la fixe par défaut à
**`false`** (accès à Cloud SQL par le chemin TCP sur l'IP privée — la
convention éprouvée pour cette application Laravel/MySQL, à l'image de
Matomo), tandis que `SnipeIT_GKE` la fixe par défaut à **`true`** (le sidecar
Cloud SQL Auth Proxy à l'écoute sur `127.0.0.1`, requis sur GKE). Les deux
variantes s'appuient sur la même logique de repli socket-ou-TCP de `db-init.sh`
décrite au §3.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut sont déclarées une seule fois dans le `variables.tf` de
`SnipeIT_Common` et sont **identiques dans les deux variantes de plateforme** —
ni `SnipeIT_CloudRun` ni `SnipeIT_GKE` ne les remplacent :

- **Sonde de démarrage** — **TCP** sur le port du conteneur, délai initial de
  30 s, délai d'expiration de 10 s, période de 15 s, seuil d'échec de 20 (une
  fenêtre d'environ 5 minutes) — assez généreux pour couvrir la chaîne de
  tâches `db-init` → `migrate` et la séquence de démarrage PHP/Apache lors du
  premier déploiement.
- **Sonde de vivacité** — **HTTP** `GET /`, délai initial de 300 s, délai
  d'expiration de 60 s, période de 60 s, seuil d'échec de 3. Snipe-IT sert sa
  page de connexion/d'installation sur `/` sans authentification ; une réponse
  200 confirme donc que l'application PHP et sa connexion à la base de données
  sont saines, sans nécessiter d'identifiants.

Contrairement aux modules Common dont les variantes GKE et Cloud Run divergent
(p. ex. une plateforme dépourvue par défaut d'un point de terminaison de santé
fiable), le comportement des sondes de Snipe-IT est identique sur les deux, car
les deux variantes héritent de ces valeurs par défaut sans modification.

---

## 7. Stockage d'objets {#7-object-storage}

Un seul bucket **Cloud Storage** dédié est déclaré ici et provisionné par le
socle, qui accorde également l'accès au compte de service de la charge de
travail :

- **`snipeit-uploads`** (`name_suffix = "snipeit-uploads"`, `location =
  var.region`, `force_destroy = true`).

Ce bucket est distinct du montage NFS (Cloud Filestore) de Snipe-IT —
l'arborescence des fichiers téléversés à l'exécution pour les images d'actifs,
les signatures et les codes-barres (`/var/lib/snipeit` par défaut) est
provisionnée et montée par les paramètres `enable_nfs`/`nfs_mount_path` du
module Application dans [App_GKE](App_GKE.md)/[App_CloudRun](App_CloudRun.md),
et non par `SnipeIT_Common`.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
```

---

**Remarque sur les variables déclarées mais inutilisées.** Le `variables.tf` de
`SnipeIT_Common` déclare `php_memory_limit`, `upload_max_filesize` et
`post_max_size` (hérités, sous un commentaire résiduel `# Wordpress Specific
Variables`, du modèle de module à partir duquel celui-ci a été cloné). Aucune
des trois n'est référencée dans `local.config` — elles sont acceptées pour la
parité d'interface et de conventions avec les modules frères d'applications
PHP, mais n'ont aucun effet sur le conteneur Snipe-IT déployé, qui conserve les
paramètres PHP intégrés à l'image officielle.

---

Pour la configuration propre à Snipe-IT destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[SnipeIT_GKE](SnipeIT_GKE.md)** et
**[SnipeIT_CloudRun](SnipeIT_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Snipe-IT sur Google Cloud Run](SnipeIT_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Snipe-IT sur GKE Autopilot](SnipeIT_GKE.md) — cette configuration déployée sur GKE.
