---
title: "Flarum Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Flarum — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Flarum_Common.md @ 3055034 sha256:946057deee48 -->

# Flarum Common — Configuration applicative partagée {#flarum-common--shared-application-configuration}

`Flarum_Common` est la **couche applicative partagée** de Flarum. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Flarum sur laquelle
s'appuient à la fois [Flarum_GKE](Flarum_GKE.md) et [Flarum_CloudRun](Flarum_CloudRun.md),
de sorte que les deux variantes de plateforme se comportent de manière identique là
où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle ne possède aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans
la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Flarum, consultez les
guides des plateformes ([Flarum_GKE](Flarum_GKE.md), [Flarum_CloudRun](Flarum_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Flarum_Common | Où cela apparaît |
|---|---|---|
| Identifiant d'administration | Génère le mot de passe administrateur de premier lancement `FLARUM_ADMIN_PASS` (24 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement comme variable d'environnement secrète `FLARUM_ADMIN_PASS` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe minimale de l'image officielle `mondedie/flarum` (nginx + php-fpm), épinglée via l'ARG de build propre à l'application `FLARUM_VERSION` et construite via Cloud Build | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for MySQL 8.0** (`MYSQL_8_0`) comme moteur | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Output `initialization_jobs` |
| Stockage objet | Déclare le bucket **Cloud Storage** `flarum-assets` | Output `storage_buckets` |
| Paramètres de base | Définit l'environnement Flarum de référence utilisé par l'installateur mondedie : connexion à la base de données, préfixe des tables, identité de l'administrateur, URL du forum | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage TCP et la sonde de vivacité HTTP ciblant `/` par défaut | §Observabilité dans les guides des plateformes |

---

## 2. Identifiant d'administration dans Secret Manager {#2-admin-credential-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :

- **`FLARUM_ADMIN_PASS`** — un mot de passe aléatoire de 24 caractères (sans caractères
  spéciaux, de sorte qu'il respecte la règle des ≥8 caractères de l'installateur sans
  problème d'échappement). L'installateur `mondedie/flarum` crée le compte
  administrateur initial à partir de `FLARUM_ADMIN_USER` / `FLARUM_ADMIN_PASS` /
  `FLARUM_ADMIN_MAIL` **au premier démarrage uniquement**. Le secret est nommé
  `secret-<resource_prefix>-flarum-admin-pass` et exposé via `secret_ids` afin que le
  socle l'injecte comme variable d'environnement secrète `FLARUM_ADMIN_PASS` dans le
  conteneur du service.

Le mot de passe est généré une seule fois et jamais renouvelé par le module —
l'installateur ne s'exécute qu'une fois ; modifier ce secret après l'installation du
forum ne change donc **pas** l'identifiant de l'administrateur (modifiez-le plutôt
depuis l'interface d'administration de Flarum).

Récupérez le mot de passe administrateur après le déploiement :

```bash
# List the admin-password secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~flarum AND name~admin-pass"

# Read the current value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données et le mot de passe root de Cloud SQL sont
générés et gérés séparément par le socle ; le nom du secret du mot de passe de la base
de données est indiqué dans les outputs du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Flarum nécessite **MySQL** ; `Flarum_Common` fixe le moteur à **Cloud SQL for MySQL 8.0**
(`MYSQL_8_0`). Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute avec
`mysql:8.0-debian` et, de manière idempotente :

1. Localise le socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` (en attendant
   jusqu'à 30 s), ou se replie sur l'IP privée de l'instance en TCP (`DB_IP`) lorsqu'aucun
   socket n'apparaît,
2. Attend que le port MySQL `3306` soit joignable lors d'une connexion en TCP,
3. Crée (ou met à jour) l'utilisateur applicatif avec le mot de passe généré
   (`CREATE USER IF NOT EXISTS … ; ALTER USER …`),
4. Crée la base de données applicative (`CREATE DATABASE IF NOT EXISTS`),
5. Accorde tous les privilèges sur la base de données à l'utilisateur applicatif,
6. Vérifie que l'utilisateur applicatif peut se connecter — ce qui réchauffe aussi le
   cache d'authentification côté serveur `caching_sha2_password` de MySQL 8, afin que
   les connexions PHP/PDO ultérieures empruntent le chemin rapide (Cloud SQL MySQL 8
   exige `--get-server-public-key` pour l'échange de clés RSA en TCP simple, ce que le
   script détecte à l'exécution),
7. Signale au sidecar Cloud SQL Auth Proxy de s'arrêter proprement (POST
   `quitquitquit`, puis SIGKILL) afin que le Job se termine correctement avec
   `restartPolicy: OnFailure`.

Il n'y a **pas de job de migration distinct** — l'image `mondedie/flarum` exécute
automatiquement l'installateur Flarum au premier démarrage du conteneur, en créant le
schéma (avec le préfixe de table `flarum_`) une fois que `db-init` a provisionné la base
de données et l'utilisateur. Le job peut être relancé sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

L'image personnalisée est une **enveloppe minimale** construite `FROM mondedie/flarum:${FLARUM_VERSION}` :

- **Pas de remplacement du point d'entrée.** Le point d'entrée s6-overlay propre à
  l'image mondedie exécute l'installateur de premier démarrage de Flarum, en lisant
  `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`, `DB_PREF`, `FORUM_URL` et les
  variables `FLARUM_ADMIN_*`. Le Dockerfile se contente de réétiqueter via un ARG de
  build contrôlé et `EXPOSE 8888` — l'installateur reste intact.
- **ARG de version propre à l'application.** `mondedie/flarum` publie un tag mouvant
  `latest`/`stable` ainsi que quelques anciens tags de version. Comme le socle injecte
  `APP_VERSION = application_version` et *l'emporte* lors de la fusion des `build_args`,
  le tag de base est épinglé via l'ARG propre à l'application `FLARUM_VERSION` (que le
  socle n'injecte **pas**). `application_version = "latest"` correspond au tag `stable`
  de l'image, recommandé pour la production ; toute autre valeur est utilisée telle
  quelle.
- **Construite via Cloud Build, image de base dupliquée dans Artifact Registry.**
  `image_source = "custom"` et `enable_image_mirroring = true`, de sorte que l'image de
  base Docker Hub est dupliquée dans Artifact Registry pour que Cloud Build puisse la
  récupérer.

Flarum sert **nginx + php-fpm sur le port 8888** (`container_port = 8888`).

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`Flarum_Common` établit l'environnement de référence utilisé par l'installateur
mondedie afin que le forum démarre correctement dès le premier lancement :

- **Connexion à la base de données** — `DB_PORT = "3306"`, `DB_PREF = "flarum_"` (le
  préfixe des tables Flarum). Pour transmettre tels quels à l'image les identifiants
  propres au locataire, les Application Modules définissent
  `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name = "DB_PASS"` et
  `db_name_env_var_name = "DB_NAME"` dans `main.tf`, de sorte que le socle renseigne
  exactement les noms de variables d'environnement que lit l'image. `DB_HOST` est
  injecté par le socle — l'IP privée de Cloud SQL sur Cloud Run, ou `127.0.0.1` pour
  le sidecar Auth Proxy sur GKE.
- **Identité de l'administrateur** — `FLARUM_ADMIN_USER` (par défaut `admin`),
  `FLARUM_ADMIN_MAIL` (par défaut `admin@techequity.cloud`) et `FLARUM_ADMIN_PASS`
  (issu de Secret Manager).
- **URL du forum** — `FORUM_URL` est défini sur l'URL publique du service. Sur Cloud
  Run, la variante transmet l'URL `run.app` prédite de manière déterministe ; sur GKE,
  elle reste non définie au moment du plan et doit être définie sur l'URL du
  LoadBalancer externe/du domaine personnalisé une fois l'IP connue.
- **Débogage** — `DEBUG = "false"`.
- **Redis (facultatif)** — désactivé par défaut. Lorsqu'il est activé,
  `REDIS_HOST`/`REDIS_PORT` sont injectés (l'IP de la VM du serveur NFS est utilisée
  lorsque `redis_host` est vide et que NFS est activé).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Une fois installé, Flarum sert la page d'accueil publique de son forum à `/` (HTTP 200)
— un point de terminaison non authentifié adapté aux sondes.

- **Sonde de démarrage** — **TCP** sur le port du conteneur, avec un délai initial de
  30 secondes et une fenêtre de 20 échecs × 15 secondes (~5 minutes), de sorte qu'une
  instance réveillée ou en premier démarrage réussit la sonde dès que nginx se lie à
  son port, indépendamment de la fin de l'installation.
- **Sonde de vivacité** — **HTTP** `GET /` avec un délai initial de 300 secondes
  (généreux, pour couvrir l'installation du premier démarrage) et une période de
  60 secondes.

---

## 7. Stockage objet {#7-object-storage}

Un bucket **Cloud Storage** dédié (`flarum-assets`) est déclaré ici et provisionné par
le socle, qui accorde également l'accès au compte de service de la charge de travail.
Notez que le répertoire des avatars, téléversements et ressources de Flarum est servi
depuis **NFS** (monté sur `/flarum/app/public/assets` sur les deux plateformes — voir
les guides des plateformes) ; le bucket est donc disponible pour les sauvegardes et
exports plutôt que pour le montage des ressources en production. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Flarum et destinée aux utilisateurs (variables par
groupe, outputs, et façon d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Flarum_GKE](Flarum_GKE.md)** et
**[Flarum_CloudRun](Flarum_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Flarum sur Google Cloud Run](Flarum_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Flarum sur GKE Autopilot](Flarum_GKE.md) — cette configuration déployée sur GKE.
