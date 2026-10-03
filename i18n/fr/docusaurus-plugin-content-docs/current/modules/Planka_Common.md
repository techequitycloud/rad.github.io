---
title: "Planka Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Planka — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Planka_Common.md @ 15fd4c7 sha256:b6b746a1b78b -->

# Planka Common — Configuration d'application partagée {#planka-common--shared-application-configuration}

`Planka_Common` est la **couche d'application partagée** pour Planka. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Planka
sur laquelle [Planka_GKE](Planka_GKE.md) et [Planka_CloudRun](Planka_CloudRun.md)
s'appuient, de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte.
Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Planka, consultez les
guides de la plateforme ([Planka_GKE](Planka_GKE.md), [Planka_CloudRun](Planka_CloudRun.md))
et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Planka est une **application de tableau kanban** auto-hébergée et open source —
des tableaux, des listes, des cartes, des dates d'échéance, des étiquettes et des pièces jointes de type Trello pour la gestion de projets d'équipe et personnels. Ce n'est pas un fournisseur d'identité ou
un produit d'authentification.

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Planka_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Wrapper léger construit `FROM ghcr.io/plankanban/planka:<version>` (image officielle) via Cloud Build ; mis en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée Cloud | `entrypoint.sh` compose `DATABASE_URL` à partir des variables `DB_*` injectées et dérive `BASE_URL` de l'URL du service avant de passer la main au `start.sh` de l'image | Comportement d'exécution sur les deux plateformes |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données et le rôle | Sortie `initialization_jobs` |
| Secrets d'application | **Deux vrais secrets** — `SECRET_KEY` (signature de session/jeton) et `DEFAULT_ADMIN_PASSWORD` (initialise le compte administrateur initial) | Sortie `secret_ids` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (`storage`) pour les pièces jointes/avatars/arrière-plans et le monte à `/app/data` via `gcs_volumes` | Sortie `storage_buckets` |
| Vérifications de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/` — la cible de vérification de santé réelle et non authentifiée de Planka | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets d'application — réels et fonctionnels {#2-application-secrets--real-and-functional}

Contrairement au mécanisme trouvé dans certaines applications de ce catalogue qui s'avère être
une opération nulle (voir l'historique `Mealie_Common` de `DEFAULT_PASSWORD`), les deux
secrets de Planka sont confirmés en direct par rapport à la source réelle de Planka :

- **`SECRET_KEY`** — une valeur aléatoire de 64 caractères. Requise au démarrage pour
  la signature de session/jeton (`server/.env.sample`). Sans elle, Planka ne
  démarre pas.
- **`DEFAULT_ADMIN_PASSWORD`** — une valeur aléatoire de 24 caractères. Initialise véritablement
  le compte administrateur initial au premier démarrage (base de données vide)
  (`server/db/seeds/default.js`), associée aux variables d'environnement en texte clair
  `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_NAME` / `DEFAULT_ADMIN_USERNAME`
  (valeurs par défaut : `admin@example.com` / `Admin` / `admin`).

`Planka_Common` crée lui-même les deux ressources `google_secret_manager_secret`
(ainsi que les générateurs `random_password`, un délai de propagation `time_sleep`,
et le nettoyage des secrets orphelins) — contrairement à la plupart des modules Common de ce catalogue,
qui ne font qu'assembler un objet `config` et laissent la Fondation créer les secrets.

**Planka n'a pas d'invite de réinitialisation de mot de passe forcée lors de la première connexion.** Les opérateurs doivent
se connecter et changer le mot de passe administrateur initial rapidement via l'interface utilisateur de Planka —
traitez les identifiants comme sensibles dès l'initialisation de la base de données.
Récupérez-les avec :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~planka"
gcloud secrets versions access latest --secret=<default_admin_password_secret> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation.
Voir [App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity
utilisés ailleurs dans le catalogue.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Planka nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` — Knex
(le constructeur de requêtes de Planka) n'a pas d'autre backend pris en charge. Lors du premier déploiement,
un job ponctuel (`db-init`) s'exécute en utilisant `postgres:15-alpine` et de manière idempotente :

1. Résout l'hôte cible à partir de `DB_HOST` (en revenant à `DB_IP`, puis
   `127.0.0.1`) et attend que PostgreSQL accepte les connexions,
2. Crée (ou met à jour le mot de passe de) le rôle d'application — **aucun
   privilège `CREATEROLE`/`CREATEDB` n'est nécessaire** : les propres "rôles" de Planka (admin,
   membre, membre de projet, etc.) sont des lignes RBAC au niveau de l'application dans ses propres tables,
   pas des rôles Postgres,
3. Crée la base de données d'application si elle n'existe pas,
4. Accorde tous les privilèges sur la base de données et transfère la propriété du schéma `public`
   au rôle d'application (Postgres 15 n'accorde plus `CREATE`
   sur `public` par défaut),
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin
   que le pod GKE Job puisse se terminer.

Planka applique ensuite ses propres migrations Knex et son amorçage **à chaque démarrage** via
le `start.sh` → `node db/init.js` de l'image officielle — idempotent, de sorte que la
plateforme n'exécute pas de job de migration séparé. Le job `db-init` peut être réexécuté en toute sécurité.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. `DATABASE_URL` — deux chemins de connexion indépendants, chacun nécessitant une configuration SSL différente {#4-database_url--two-independent-connection-paths-each-needing-ssl-configured-differently}

Planka lit une variable d'environnement, `DATABASE_URL` — un DSN d'autorité d'URL
(`postgresql://user:pass@host:port/db`). Mais Planka ouvre cette connexion
à partir de **deux chemins de code indépendants**, chacun gérant SSL d'une manière différente.
Le traçage de cette chaîne de dépendances dans la source réelle de Planka — pas seulement son
`.env.sample` — a été ce qu'il a fallu pour faire fonctionner la connexion, après que deux
tentatives de déploiement en direct précédentes aient échoué :

1. **Le CLI de migration** (`server/db/knexfile.js`, invoqué via
   `node db/init.js` à chaque démarrage) construit explicitement `ssl: buildSSLConfig()`,
   qui renvoie `{ rejectUnauthorized: false }` uniquement lorsque la variable d'environnement
   `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` est la chaîne exacte `"false"`.
2. **L'ORM Sails du serveur en cours d'exécution** (`server/config/datastores.js`, via
   `sails-postgresql` → `machinepack-postgresql` de `createManager()`) passe
   `url: DATABASE_URL` sans autre configuration. `machinepack-postgresql` analyse
   cette URL en utilisant le `url.parse()` **hérité** de Node, qui extrait uniquement
   l'hôte/port/utilisateur/mot de passe/base de données et **supprime silencieusement chaque paramètre de requête**,
   y compris tout `?sslmode=...`. Ainsi, un sslmode intégré à l'URL ne fait
   rien pour ce chemin — il est ignoré avant que `pg.Pool` ne soit jamais
   construit. Sans clé `ssl` explicite atteignant `pg.Pool`,
   le `node-postgres` brut revient à lire la **variable d'environnement
   `PGSSLMODE`** elle-même (`readSSLConfigFromEnvironment` dans `pg` de
   `connection-parameters.js`) : `disable` → pas de SSL ; `prefer`/`require`/
   `verify-ca`/`verify-full` → `ssl: true` (chiffrer **avec** la vérification de certificat TLS Node par défaut — pas "chiffrer uniquement", contrairement à la sémantique classique de libpq) ; seulement `no-verify` → `{ rejectUnauthorized: false }`.

Cloud SQL présente un certificat auto-signé par instance qui n'est pas dans
le bundle CA par défaut de Node, donc tout autre que `PGSSLMODE=no-verify` échoue
au démarrage avec `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, et le hook `orm` de Sails ne
se charge jamais (`Failed to lift app: getConnection failed`) — le conteneur ne
devient jamais sain et la sonde de démarrage expire.

**La solution**, implémentée dans `entrypoint.sh` : pour les cas de connexion chiffrée
(le chemin du socket Cloud SQL de Cloud Run revenant au TCP IP privée, et
toute autre connexion TCP IP privée directe), définissez **à la fois**
`PGSSLMODE=no-verify` (corrige le runtime Sails — le chemin qui compte réellement
pour l'application en direct) **et**
`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` (corrige le chemin CLI de migration séparé). Pour le cas de bouclage GKE (`DB_HOST=127.0.0.1`, le
sidecar cloud-sql-proxy terminant lui-même le TLS), **aucune** variable n'est définie — le
proxy sert déjà du texte en clair localement, donc aucune configuration SSL n'est nécessaire.

Parce que le mot de passe de la base de données n'est disponible qu'en tant que valeur Secret Manager d'exécution
(pas quelque chose qui peut être interpolé dans une URL au moment de la planification), le
point d'entrée cloud (`entrypoint.sh`) compose `DATABASE_URL` au démarrage du conteneur,
en se basant sur le `DB_HOST` résolu :

| Forme `DB_HOST` | Plateforme | Connexion utilisée | Variables d'environnement SSL définies |
|---|---|---|---|
| `/…` (répertoire de socket Unix) | Cloud Run, `enable_cloudsql_volume=true` | Le chemin du socket est inutilisable par l'analyse d'URL de l'un ou l'autre chemin de connexion ; revient à l'IP privée injectée (`DB_IP`) via TCP | `PGSSLMODE=no-verify`, `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` |
| `127.0.0.1` / `localhost` | GKE (bouclage du sidecar Cloud SQL Auth Proxy) | TCP simple | Aucune variable définie — le proxy termine déjà le TLS vers Cloud SQL |
| une IP privée | L'un ou l'autre | TCP direct | Identique au cas du socket : `PGSSLMODE=no-verify`, `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` |

**N'ajoutez pas `?sslmode=...` (ou tout autre paramètre de requête) à `DATABASE_URL`
directement.** Il est ignoré pour deux raisons différentes selon le chemin de code
qui gère la connexion, ce n'est donc pas un comportement uniforme "les paramètres de requête sont
ignorés" : le **runtime Sails** l'ignore car
le `machinepack-postgresql` hérité de `url.parse()` supprime tous les paramètres de requête
avant que `pg.Pool` ne soit construit ; le **CLI de migration** l'ignore car
Knex lui-même ne parse pas du tout les paramètres de requête de sa chaîne de connexion
(un comportement séparé, non lié, documenté par Knex). Deux bibliothèques différentes,
deux raisons différentes — même résultat pratique : seules les variables d'environnement
`PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` contrôlent réellement
le comportement TLS. Le point d'entrée imprime une ligne `[cloud-entrypoint]`
indiquant la branche qu'il a prise — utile pour diagnostiquer les problèmes de connexion.

Aucune préoccupation d'encodage d'URL n'est propre à Planka au-delà de la règle standard pour tout
DSN d'autorité d'URL : le point d'entrée encode l'URL de l'utilisateur et du mot de passe de la base de données
en shell POSIX pur (l'image officielle est Node/Alpine avec `/bin/sh` mais pas
`python3`).

---

## 5. Image de conteneur et point d'entrée {#5-container-image-and-entrypoint}

L'image personnalisée est un **wrapper léger construit `FROM
ghcr.io/plankanban/planka:<version>`** (l'image officielle du mainteneur — pas
l'image `linuxserver/planka` de la communauté) avec un point d'entrée cloud
(`entrypoint.sh`) superposé. Le tag de l'image de base est piloté par un
ARG de build `PLANKA_VERSION` spécifique à l'application — **pas** le `APP_VERSION` générique,
que la fondation injecte dans `build_args` et qui écraserait autrement le
tag `FROM`. L'image est construite via Cloud Build et mise en miroir dans Artifact
Registry (`enable_image_mirroring = true`).

Le point d'entrée s'exécute avant le démarrage de Planka et :

- **Compose `DATABASE_URL`** comme décrit au §4.
- **Dérive `BASE_URL`** à partir des `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL` injectés. Planka construit toutes les URL absolues — liens de pièces jointes, notifications par e-mail et l'URI de redirection OIDC si l'authentification unique facultative est configurée —
  à partir de `BASE_URL`, il doit donc correspondre à l'hôte visible par le navigateur. Les opérateurs peuvent
  remplacer `BASE_URL` pour un domaine personnalisé.
- **Définit `TRUST_PROXY = "true"`** (le vrai nom de la variable d'environnement de Planka — pas
  `TRUST_PROXY_HEADER`, qui est une convention d'une autre application) afin que Planka
  respecte les en-têtes `X-Forwarded-*` derrière le frontal HTTPS de Cloud Run / GKE.
- **Ne définit pas `PORT`.** Cloud Run réserve la variable d'environnement `PORT` (il
  injecte automatiquement `PORT=1337`) et rejette toute valeur fournie par l'utilisateur ; Planka
  utilise par défaut 1337, correspondant à `container_port` sur les deux plateformes.
- **Passe la main** à la commande de démarrage de l'image (`./start.sh`, qui exécute
  `node db/init.js` pour les migrations/amorçage, puis démarre le serveur).

Le wrapper est un script POSIX-`sh` (l'image officielle est Node/Alpine sans
`python3`), donc l'encodage d'URL des identifiants de la base de données est effectué en shell pur.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

La valeur par défaut interne de `Planka_Common` pour `startup_probe`/`liveness_probe`
cible le **chemin racine `/`**, correspondant à la cible de vérification de santé réelle et non authentifiée de Planka — l'image officielle fournit `server/healthcheck.js`, qui
effectue un simple GET HTTP vers `localhost:1337` **sans chemin** et vérifie le code HTTP 200 :

- **Sonde de démarrage** — HTTP `GET /`, délai initial de 60 secondes, période de 15 secondes,
  seuil de 30 échecs (une large fenêtre de premier démarrage).
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 60 secondes, période de 30 secondes,
  seuil de 3 échecs.

**Note.** Les modules d'application (`Planka_CloudRun`/`Planka_GKE`) déclarent
leurs *propres* variables `startup_probe`/`liveness_probe` et les transmettent aux
entrées de ce module portant le même nom — qui remplacent la valeur par défaut ci-dessus.
Ces variables de module d'application sont maintenant correctement définies par défaut à `path = "/"`
également (cette incohérence, héritée de la source de clone Logto à partir de laquelle cet ensemble de modules
a été échafaudé, a été corrigée), de sorte que les deux couches s'accordent sur la cible de santé réelle et non authentifiée de Planka.

---

## 7. Stockage d'objets {#7-object-storage}

Un seul bucket **Cloud Storage** (suffixe `storage`, classe `STANDARD`, prévention d'accès public `enforced`, pas de versioning d'objets) est déclaré ici et
provisionné par la fondation, pour les pièces jointes, les avatars et les images de fond de carte, et monté via GCS FUSE à `/app/data` — le
chemin de base des téléchargements de Planka, sous lequel se trouvent tous les types de téléchargement — avec `uid=1000`/`gid=1000`
afin que l'utilisateur non-root de l'application puisse écrire. `enable_gcs_storage_volume = false` supprime le
montage (`Planka_GKE` le fait lorsqu'un PVC de bloc est activé au même chemin). Les *données* du tableau/carte/liste ne sont
pas affectées de toute façon — elles sont stockées dans PostgreSQL. Listez-les avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
```

---

Pour la configuration spécifique à Planka et destinée à l'utilisateur (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et le CLI), consultez les
guides de la plateforme : **[Planka_GKE](Planka_GKE.md)** et
**[Planka_CloudRun](Planka_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Planka sur Google Cloud Run](Planka_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Planka sur GKE Autopilot](Planka_GKE.md) — cette configuration déployée sur GKE.
