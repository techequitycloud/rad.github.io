---
title: "Fider Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Fider — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Fider_Common.md @ 3055034 sha256:ff44bf481770 -->

# Fider Common — Configuration applicative partagée {#fider-common--shared-application-configuration}

`Fider_Common` est la **couche applicative partagée** de Fider. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Fider sur laquelle
s'appuient à la fois [Fider_GKE](Fider_GKE.md) et [Fider_CloudRun](Fider_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement
— elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

Fider (https://fider.io) est un tableau léger de retours et de vote sur les
fonctionnalités, écrit en Go sous forme d'un binaire unique et adossé à PostgreSQL :
les clients publient des idées, votent et commentent, et vous priorisez selon la
demande. Un seul conteneur sert toute l'application — il n'existe **aucun processus
worker ni de file d'attente** — et il exécute ses migrations de schéma au démarrage.
La première visite guide un opérateur dans la création du site et de son
propriétaire administrateur.

Pour l'infrastructure qui provisionne et exécute réellement Fider, consultez les
guides des plateformes ([Fider_GKE](Fider_GKE.md), [Fider_CloudRun](Fider_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Fider_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère un `JWT_SECRET` stable de 64 caractères et le stocke dans **Secret Manager** | Injecté automatiquement en tant que `JWT_SECRET` ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une fine surcouche `FROM getfider/fider` avec un point d'entrée cloud personnalisé via Cloud Build (Kaniko) ; la met en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** (`POSTGRES_15`) comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée le rôle et la base de données, accorde les droits et transfère la propriété du schéma `public` | Sortie `initialization_jobs` |
| Migrations de schéma | Exécutées par le point d'entrée (`./fider migrate`) à chaque démarrage du conteneur — aucune tâche de migration séparée | Comportement de l'application dans les guides des plateformes |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (suffixe `storage`) | Sortie `storage_buckets` |
| Paramètres principaux | Compose `DATABASE_URL` à l'exécution, dérive `BASE_URL`, définit `PORT = 3000` et fournit des valeurs fictives pour l'e-mail | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage / d'activité / de disponibilité par défaut ciblant `/_health` | §Observabilité dans les guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et **ne doit jamais être modifié après le premier déploiement** :

- **`JWT_SECRET`** — une chaîne aléatoire de 64 caractères
  (`secret-<prefix>-<app>-jwt-secret`). Fider signe avec elle tous les jetons
  d'authentification et de session (y compris les liens de connexion magiques qu'il
  envoie par e-mail). Si elle changeait à chaque déploiement, toutes les sessions en
  cours et les liens de connexion en attente seraient cassés ; la valeur est donc
  générée une seule fois et épinglée dans Secret Manager (sur le modèle du
  `SECRET_KEY_BASE` de Chatwoot). Elle survit aux redémarrages et aux
  redéploiements.

Récupérez le secret après le déploiement :

```bash
# List the JWT secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Fider nécessite **PostgreSQL 15** ; le moteur est imposé (`POSTGRES_15`) et MySQL
ou les autres moteurs ne sont pas pris en charge. Lors du premier déploiement, une
tâche ponctuelle (`db-init`) s'exécute avec `postgres:15-alpine` et, de manière
idempotente :

1. Résout l'hôte de la base de données — un répertoire de socket Unix du Cloud SQL
   Auth Proxy (Cloud Run), `127.0.0.1` (le sidecar Auth Proxy sur GKE) ou une IP
   privée,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou reconfigure) le rôle `fider` avec `LOGIN CREATEDB` et le mot de passe
   généré,
4. Crée la base de données `fider` si elle n'existe pas (propriété de `postgres`,
   car la connexion `postgres` de Cloud SQL ne peut pas faire `SET ROLE` vers les
   rôles applicatifs),
5. Accorde tous les privilèges sur la base de données et le schéma `public`, et
   transfère la propriété de `public` au rôle `fider` — nécessaire car
   PostgreSQL 15 n'accorde plus `CREATE` sur `public` par défaut et Fider exécute
   ses propres migrations en tant que rôle applicatif,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement afin que le pod de la
   tâche GKE puisse se terminer.

La tâche peut être réexécutée sans risque. Il n'existe **aucune tâche séparée de
migration ou de superutilisateur** — Fider applique ses propres migrations de schéma
au démarrage (voir §5). Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée est une **fine surcouche** construite
`FROM getfider/fider:<FIDER_VERSION>` via Cloud Build (Kaniko) et mise en miroir dans
Artifact Registry. `getfider/fider` est une image Alpine (`sh` de busybox, pas de
`python3`) ; le point d'entrée est donc du pur shell POSIX et effectue lui-même
l'encodage des URL. Un point d'entrée cloud (`cloud-entrypoint.sh`) s'exécute avant
le binaire `./fider` d'origine :

- **Compose `DATABASE_URL`** — Fider (Go / `lib/pq`) lit une unique `DATABASE_URL`,
  et le mot de passe de la base de données est une valeur Secret Manager disponible
  à l'exécution, qui ne peut pas être interpolée dans une URL au moment du plan. Le
  point d'entrée choisit selon le `DB_HOST` injecté pour construire le bon DSN :
  - un **répertoire de socket** `/…` (Cloud Run) → forme socket de libpq
    `postgres://u:p@/db?host=<socketdir>&sslmode=disable`,
  - `127.0.0.1` / `localhost` (**boucle locale de l'Auth Proxy sur GKE**) → TCP
    simple, `sslmode=disable`,
  - sinon une **IP privée** → TCP avec `sslmode=require` (Cloud SQL refuse le TCP
    non chiffré sur IP privée).
- **Dérive `BASE_URL`** — à partir de `CLOUDRUN_SERVICE_URL` / `GKE_SERVICE_URL` ;
  les opérateurs peuvent la remplacer pour un domaine personnalisé.
- **Exécute les migrations** — la commande par défaut d'origine est
  `./fider migrate && ./fider` ; ce Dockerfile remplace `CMD` par `./fider` seul, le
  point d'entrée exécute donc explicitement `./fider migrate` avant de passer la
  main (le serveur de Fider ne crée **pas** son schéma au démarrage et paniquerait
  sinon sur une table `blobs` manquante). L'étape est idempotente — Fider suit les
  migrations appliquées.
- **Définit `PORT = 3000`** — Cloud Run injecte automatiquement `PORT` ; GKE ne le
  fait pas, le point d'entrée le fixe donc par défaut à 3000 (en cohérence avec
  `container_port`).
- **Désactive l'envoi d'e-mails pour la démonstration** — `EMAIL_NOEMAIL = true`,
  de sorte que Fider écrit les liens d'inscription et d'invitation dans le journal du
  conteneur au lieu d'envoyer des e-mails.
- **Exécute `./fider`** (exec) en tant que PID 1.

Comme le point d'entrée et le Dockerfile sont intégrés à l'image, toute
modification les concernant nécessite une reconstruction de l'image ; le script de
tâche `db-init.sh` est monté au moment de l'apply et prend effet sans
reconstruction.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Fider_Common` établit l'environnement de base de Fider afin que l'application
démarre correctement dès le premier lancement :

- **Port** — `container_port = 3000` ; le point d'entrée exporte `PORT = 3000` sur
  GKE.
- **Pas de Redis** — Fider utilise une file d'attente et un cache adossés à
  PostgreSQL (`VALKEY_URL` vide) ; aucun `REDIS_URL` n'est donc injecté et
  `enable_redis` vaut `false` par défaut.
- **Valeurs fictives pour l'e-mail** — Fider n'a pas de véritable mode « sans
  e-mail » : si ni Mailgun ni SES n'est configuré, son analyseur d'environnement
  choisit par défaut le type d'e-mail `smtp` et exige impérativement
  `EMAIL_SMTP_HOST` + `EMAIL_SMTP_PORT` (et `EMAIL_NOREPLY`) au démarrage, faute de
  quoi il panique (`exit(2)`). Des valeurs fictives
  (`EMAIL_NOREPLY = noreply@fider.local`, `EMAIL_SMTP_HOST = localhost`,
  `EMAIL_SMTP_PORT = 25`) permettent à la démonstration de démarrer ; elles ne sont
  contactées que lorsqu'un e-mail est réellement envoyé. Les opérateurs configurent
  un vrai SMTP via `environment_variables` pour activer l'envoi d'e-mails.
- **Migrations de schéma au démarrage** — exécutées par le point d'entrée
  (`./fider migrate`), idempotentes.
- **Configuration initiale** — la première visite web guide un opérateur, de
  manière interactive, dans la création du site et de son propriétaire
  administrateur ; il n'existe aucun identifiant par défaut.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage, d'activité et de disponibilité par défaut ciblent
**`/_health`** — un point de terminaison non authentifié qui renvoie `200` dès que
Fider sert les requêtes. Une fenêtre de démarrage généreuse absorbe les migrations
exécutées au premier démarrage.

- **Sonde de démarrage** — HTTP `/_health`, délai initial de 30 secondes, période
  de 15 secondes, 30 échecs tolérés (environ 7.5 minutes de marge pour les
  migrations du premier démarrage).
- **Sonde de vivacité** — HTTP `/_health`, période de 30 secondes.
- **Sonde de disponibilité** — HTTP `/_health`, période de 10 secondes.

Le `container_port` et le port de la sonde doivent tous deux valoir **3000** — sur
GKE, la variable d'environnement `PORT` n'est pas injectée automatiquement ; un port
incorrect fait donc que les sondes visent un port inactif et le pod ne devient
jamais Ready, alors même que l'application est saine.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** (suffixe de nom `storage`, classe `STANDARD`,
prévention de l'accès public appliquée) est déclaré ici et provisionné par le socle,
qui accorde également l'accès au compte de service de la charge de travail.
Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Notez que les variantes de plateforme définissent en plus `enable_nfs = true` par
défaut afin de fournir un montage Cloud Filestore pour le stockage des pièces
jointes de Fider — consultez les guides des plateformes.

---

Pour la configuration propre à Fider visible par l'utilisateur (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Fider_GKE](Fider_GKE.md)** et
**[Fider_CloudRun](Fider_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Fider sur Google Cloud Run](Fider_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Fider sur GKE Autopilot](Fider_GKE.md) — cette configuration déployée sur GKE.
