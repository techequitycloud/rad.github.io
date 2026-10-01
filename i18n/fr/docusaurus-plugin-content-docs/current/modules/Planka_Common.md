---
title: "Planka Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Planka — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Planka_Common.md @ 3055034 sha256:4a0f27be6b65 -->

# Planka Common — Configuration applicative partagée {#planka-common--shared-application-configuration}

`Planka_Common` est la **couche applicative partagée** de Planka. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Planka sur laquelle
s'appuient [Planka_GKE](Planka_GKE.md) et [Planka_CloudRun](Planka_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là
où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous
voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Planka, consultez les
guides de plateforme ([Planka_GKE](Planka_GKE.md), [Planka_CloudRun](Planka_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

Planka est une **application de tableaux kanban** open source et auto-hébergée
— tableaux, listes, cartes, échéances, étiquettes et pièces jointes de type
Trello pour la gestion de projets d'équipe et personnels. Ce n'est ni un
fournisseur d'identité ni un produit d'authentification.

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Planka_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Enveloppe légère construite `FROM ghcr.io/plankanban/planka:<version>` (image officielle) via Cloud Build ; mise en miroir dans Artifact Registry | Output `container_image` du déploiement de la plateforme |
| Point d'entrée cloud | `entrypoint.sh` compose `DATABASE_URL` à partir des variables `DB_*` injectées et dérive `BASE_URL` de l'URL du service avant de passer la main au `start.sh` de l'image | Comportement à l'exécution sur les deux plateformes |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données et le rôle | Output `initialization_jobs` |
| Secrets applicatifs | **Deux secrets réels** — `SECRET_KEY` (signature des sessions/jetons) et `DEFAULT_ADMIN_PASSWORD` (crée le compte administrateur initial) | Output `secret_ids` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (`storage`) pour les pièces jointes, avatars et arrière-plans | Output `storage_buckets` |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/` — la cible de contrôle de santé réelle et non authentifiée de Planka | §Observabilité dans les guides de plateforme |

---

## 2. Secrets applicatifs — réels et fonctionnels {#2-application-secrets--real-and-functional}

Contrairement au mécanisme présent dans certaines applications de ce catalogue
qui s'avère être une opération sans effet (voir l'historique de
`DEFAULT_PASSWORD` dans `Mealie_Common`), les deux secrets de Planka ont été
confirmés actifs dans le code source réel de Planka :

- **`SECRET_KEY`** — une valeur aléatoire de 64 caractères. Requise au démarrage
  pour la signature des sessions/jetons (`server/.env.sample`). Sans elle,
  Planka ne démarre pas.
- **`DEFAULT_ADMIN_PASSWORD`** — une valeur aléatoire de 24 caractères. Crée
  réellement le compte administrateur initial au premier démarrage (sur une base
  vide) (`server/db/seeds/default.js`), associée aux variables d'environnement
  en texte clair `DEFAULT_ADMIN_EMAIL` / `DEFAULT_ADMIN_NAME` /
  `DEFAULT_ADMIN_USERNAME` (valeurs par défaut : `admin@example.com` / `Admin` /
  `admin`).

`Planka_Common` crée lui-même les deux ressources `google_secret_manager_secret`
(ainsi que des générateurs `random_password`, un délai de propagation
`time_sleep` et le nettoyage des secrets orphelins) — contrairement à la plupart
des modules Common de ce catalogue, qui se contentent d'assembler un objet
`config` et laissent le socle créer les secrets.

**Planka n'impose aucune réinitialisation du mot de passe à la première
connexion.** Les opérateurs doivent se connecter et changer rapidement le mot de
passe administrateur initial depuis l'interface de Planka — considérez cet
identifiant comme sensible dès l'initialisation de la base de données.
Récupérez-le avec :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~planka"
gcloud secrets versions access latest --secret=<default_admin_password_secret> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le
socle. Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets
et de Workload Identity utilisé ailleurs dans le catalogue.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Planka nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` — Knex (le
générateur de requêtes de Planka) ne prend en charge aucun autre backend. Au
premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Résout l'hôte cible à partir de `DB_HOST` (avec repli sur `DB_IP`, puis
   `127.0.0.1`) et attend que PostgreSQL accepte les connexions,
2. Crée le rôle de l'application (ou met à jour son mot de passe) — **aucun
   privilège `CREATEROLE`/`CREATEDB` n'est nécessaire** : les « rôles » propres à
   Planka (administrateur, membre, membre de projet, etc.) sont des lignes RBAC
   applicatives dans ses propres tables, et non des rôles Postgres,
3. Crée la base de données de l'application si elle n'existe pas,
4. Accorde tous les privilèges sur la base de données et transfère la propriété
   du schéma `public` au rôle de l'application (Postgres 15 n'accorde plus
   `CREATE` sur `public` par défaut),
5. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter (`/quitquitquit`) afin
   que le pod du Job GKE puisse se terminer.

Planka applique ensuite ses propres migrations Knex et son seed **à chaque
démarrage** via le `start.sh` de l'image officielle → `node db/init.js` — de
manière idempotente ; la plateforme n'exécute donc aucun job de migration
distinct. Le job `db-init` peut être réexécuté sans risque.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

---

## 4. `DATABASE_URL` — deux chemins de connexion indépendants, chacun nécessitant une configuration SSL différente {#4-database_url--two-independent-connection-paths-each-needing-ssl-configured-differently}

Planka lit une seule variable d'environnement, `DATABASE_URL` — un DSN de type
autorité d'URL (`postgresql://user:pass@host:port/db`). Mais Planka ouvre cette
connexion depuis **deux chemins de code indépendants**, qui gèrent chacun le SSL
différemment. Il a fallu suivre cette chaîne de dépendances dans le code source
réel de Planka — et pas seulement dans son `.env.sample` — pour faire
fonctionner la connexion, après l'échec de deux tentatives de déploiement
antérieures en conditions réelles :

1. **La CLI de migration** (`server/db/knexfile.js`, invoquée via
   `node db/init.js` à chaque démarrage) construit explicitement
   `ssl: buildSSLConfig()`, qui renvoie `{ rejectUnauthorized: false }`
   uniquement lorsque la variable d'environnement
   `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` vaut exactement la chaîne
   `"false"`.
2. **L'ORM Sails du serveur en cours d'exécution** (`server/config/datastores.js`,
   via `sails-postgresql` → `createManager()` de `machinepack-postgresql`)
   transmet `url: DATABASE_URL` sans aucune autre configuration.
   `machinepack-postgresql` analyse cette URL avec l'**ancien** `url.parse()` de
   Node, qui n'extrait que l'hôte, le port, l'utilisateur, le mot de passe et la
   base de données, et **supprime silencieusement tous les paramètres de
   requête**, y compris tout `?sslmode=...`. Un sslmode intégré à l'URL n'a donc
   aucun effet sur ce chemin — il est écarté avant même la construction de
   `pg.Pool`. Faute de clé `ssl` explicite parvenant à `pg.Pool`,
   `node-postgres` brut se rabat sur la lecture de la **variable
   d'environnement `PGSSLMODE`** elle-même (`readSSLConfigFromEnvironment` dans
   le `connection-parameters.js` de `pg`) : `disable` → pas de SSL ;
   `prefer`/`require`/
   `verify-ca`/`verify-full` → `ssl: true` (chiffrement **avec** la
   vérification de certificat TLS par défaut de Node — et non « chiffrement
   seul », contrairement à la sémantique classique de libpq) ; seul
   `no-verify` → `{ rejectUnauthorized: false }`.

Cloud SQL présente un certificat auto-signé propre à chaque instance, absent du
bundle d'autorités par défaut de Node ; toute valeur autre que
`PGSSLMODE=no-verify` échoue donc au démarrage avec
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, et le hook `orm` de Sails ne se charge jamais
(`Failed to lift app: getConnection failed`) — le conteneur ne devient jamais
sain et la sonde de démarrage expire.

**Le correctif**, implémenté dans `entrypoint.sh` : pour les cas de connexion
chiffrée (le chemin de socket Cloud SQL de Cloud Run qui se rabat sur TCP via IP
privée, et toute autre connexion TCP directe via IP privée), définir **à la
fois** `PGSSLMODE=no-verify` (corrige l'exécution Sails — le chemin qui compte
réellement pour l'application en production) **et**
`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` (corrige le chemin distinct de
la CLI de migration). Pour le cas loopback sur GKE (`DB_HOST=127.0.0.1`, le
sidecar cloud-sql-proxy terminant lui-même le TLS), **aucune** des deux
variables n'est définie — le proxy sert déjà du texte clair en local, donc aucune
configuration SSL n'est nécessaire.

Comme le mot de passe de la base de données n'est disponible que sous forme de
valeur Secret Manager à l'exécution (et ne peut pas être interpolé dans une URL
au moment du plan), le point d'entrée cloud (`entrypoint.sh`) compose
`DATABASE_URL` au démarrage du conteneur, en se branchant sur le `DB_HOST`
résolu :

| Forme de `DB_HOST` | Plateforme | Connexion utilisée | Variables d'environnement SSL définies |
|---|---|---|---|
| `/…` (répertoire de socket Unix) | Cloud Run, `enable_cloudsql_volume=true` | Le chemin de socket est inutilisable par l'analyse d'URL des deux chemins de connexion ; repli sur l'IP privée injectée (`DB_IP`) via TCP | `PGSSLMODE=no-verify`, `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` |
| `127.0.0.1` / `localhost` | GKE (loopback du sidecar Cloud SQL Auth Proxy) | TCP simple | Aucune des deux variables — le proxy termine déjà le TLS vers Cloud SQL |
| une IP privée | Les deux | TCP direct | Comme pour le cas du socket : `PGSSLMODE=no-verify`, `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE=false` |

**N'ajoutez pas `?sslmode=...` (ni aucun paramètre de requête) directement à
`DATABASE_URL`.** Il est ignoré pour deux raisons différentes selon le chemin de
code qui gère la connexion ; il ne s'agit donc pas d'un comportement uniforme du
type « les paramètres de requête sont ignorés » : l'**exécution Sails** l'ignore
parce que l'ancien `url.parse()` de `machinepack-postgresql` supprime tous les
paramètres de requête avant la construction de `pg.Pool` ; la **CLI de
migration** l'ignore parce que Knex lui-même n'analyse aucun paramètre de
requête de sa chaîne de connexion (un comportement distinct, sans rapport, et
documenté par Knex). Deux bibliothèques différentes, deux raisons différentes —
même résultat pratique : seules les variables d'environnement
`PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` contrôlent réellement le
comportement TLS. Le point d'entrée affiche une ligne `[cloud-entrypoint]`
indiquant la branche suivie — utile pour diagnostiquer les problèmes de
connexion.

Aucune contrainte d'encodage d'URL n'est propre à Planka au-delà de la règle
standard de tout DSN de type autorité d'URL : le point d'entrée encode en URL
l'utilisateur et le mot de passe de la base de données en pur shell POSIX
(l'image officielle est basée sur Node/Alpine avec `/bin/sh` mais sans
`python3`).

---

## 5. Image de conteneur et point d'entrée {#5-container-image-and-entrypoint}

L'image personnalisée est une **enveloppe légère construite `FROM
ghcr.io/plankanban/planka:<version>`** (l'image officielle du mainteneur — et non
l'image communautaire `linuxserver/planka`), à laquelle s'ajoute un point
d'entrée cloud (`entrypoint.sh`). Le tag de l'image de base est piloté par un
ARG de build propre à l'application, `PLANKA_VERSION` — et **non** par le
générique `APP_VERSION`, que le socle injecte dans `build_args` et qui écraserait
sinon le tag `FROM`. L'image est construite via Cloud Build et mise en miroir
dans Artifact Registry (`enable_image_mirroring = true`).

Le point d'entrée s'exécute avant le démarrage de Planka et :

- **Compose `DATABASE_URL`** comme décrit au §4.
- **Dérive `BASE_URL`** de `CLOUDRUN_SERVICE_URL` /
  `GKE_SERVICE_URL` injectées. Planka construit toutes les URL absolues — liens
  des pièces jointes, notifications par e-mail et URI de redirection OIDC si le
  SSO facultatif est configuré — à partir de `BASE_URL`, qui doit donc
  correspondre à l'hôte vu par le navigateur. Les opérateurs peuvent remplacer
  `BASE_URL` pour un domaine personnalisé.
- **Définit `TRUST_PROXY = "true"`** (le vrai nom de variable d'environnement de
  Planka — et non `TRUST_PROXY_HEADER`, qui est la convention d'une autre
  application) afin que Planka prenne en compte les en-têtes `X-Forwarded-*`
  derrière le frontal HTTPS de Cloud Run / GKE.
- **Ne définit pas `PORT`.** Cloud Run réserve la variable d'environnement
  `PORT` (il injecte automatiquement `PORT=1337`) et rejette toute valeur
  fournie par l'utilisateur ; Planka utilise 1337 par défaut, ce qui correspond
  à `container_port` sur les deux plateformes.
- **Passe la main** à la commande de démarrage de l'image (`./start.sh`, qui
  exécute `node db/init.js` pour les migrations/le seed, puis démarre le
  serveur).

L'enveloppe est un script POSIX-`sh` (l'image officielle est basée sur
Node/Alpine sans `python3`) ; l'encodage en URL des identifiants de la base de
données se fait donc en pur shell.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

La valeur par défaut interne de `Planka_Common` pour
`startup_probe`/`liveness_probe` cible le **chemin racine `/`**, ce qui
correspond à la cible de contrôle de santé réelle et non authentifiée de Planka
— l'image officielle fournit `server/healthcheck.js`, qui effectue un simple GET
HTTP sur `localhost:1337` **sans chemin** et vérifie un HTTP 200 :

- **Sonde de démarrage** — HTTP `GET /`, délai initial de 60 secondes, période
  de 15 secondes, seuil de 30 échecs (une large fenêtre pour le premier
  démarrage).
- **Sonde de vivacité** — HTTP `GET /`, délai initial de 60 secondes, période de
  30 secondes, seuil de 3 échecs.

**Remarque.** Les modules applicatifs (`Planka_CloudRun`/`Planka_GKE`)
déclarent leurs *propres* variables `startup_probe`/`liveness_probe` et les
transmettent aux entrées homonymes de ce module — qui remplacent la valeur par
défaut ci-dessus. Ces variables des modules applicatifs utilisent désormais
correctement `path = "/"` par défaut elles aussi (ce décalage, hérité de la
source Logto à partir de laquelle cet ensemble de modules a été généré, a été
corrigé) ; les deux couches s'accordent donc sur la cible de santé réelle et non
authentifiée de Planka.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (suffixe `storage`, classe `STANDARD`,
prévention de l'accès public `enforced`, sans gestion des versions des objets)
est déclaré ici et provisionné par le socle, pour les pièces jointes, les avatars
et les images d'arrière-plan des cartes — mais il n'est **pas** monté
automatiquement dans le conteneur. Les opérateurs qui ont besoin que les pièces
jointes téléversées persistent entre les révisions/redémarrages doivent ajouter
une entrée `gcs_volumes` (au niveau du module applicatif) montée sur le chemin
`/app/data` de Planka. Les *données* des tableaux, cartes et listes ne sont pas
concernées dans un cas comme dans l'autre — elles sont stockées dans
PostgreSQL. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
```

---

Pour la configuration propre à Planka destinée aux utilisateurs (variables par
groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez les guides de plateforme : **[Planka_GKE](Planka_GKE.md)** et
**[Planka_CloudRun](Planka_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Planka sur Google Cloud Run](Planka_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Planka sur GKE Autopilot](Planka_GKE.md) — cette configuration déployée sur GKE.
