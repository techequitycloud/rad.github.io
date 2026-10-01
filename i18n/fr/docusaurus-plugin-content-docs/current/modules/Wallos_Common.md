---
title: "Wallos Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Wallos — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Wallos_Common.md @ 3055034 sha256:c2bb532b9772 -->

# Wallos Common — Configuration applicative partagée {#wallos-common--shared-application-configuration}

`Wallos_Common` est la **couche applicative partagée** de Wallos. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Wallos sur laquelle
s'appuient à la fois [Wallos_GKE](Wallos_GKE.md) et [Wallos_CloudRun](Wallos_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
c'est important. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans
la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Wallos, consultez
les guides des plateformes ([Wallos_GKE](Wallos_GKE.md), [Wallos_CloudRun](Wallos_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Wallos_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | **Aucun.** Wallos stocke ses utilisateurs dans sa propre base SQLite embarquée ; aucune variable d'environnement Secret Manager n'est générée | Les outputs `secret_ids` / `secret_values` sont volontairement vides |
| Image de conteneur | Récupère `bellamy/wallos` **directement** — une véritable image tierce précompilée, sans Dockerfile ni étape Cloud Build | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe `database_type = "NONE"` — Wallos utilise un fichier **SQLite embarqué** ; il est confirmé qu'aucune prise en charge de MySQL/Postgres n'existe dans l'application | §Persistance dans les guides des plateformes |
| Amorçage de la base de données | **Aucun.** Aucune tâche `db-init` n'est injectée ; `initialization_jobs` reste vide sauf si l'opérateur fournit des tâches personnalisées | Output `initialization_jobs` |
| Stockage objet | Déclare **deux** buckets Cloud Storage : `db` (le fichier SQLite) et `uploads` (logos de fournisseurs téléversés par les utilisateurs) | Output `storage_buckets` |
| Paramètres principaux | Fixe le conteneur sur le port 80 ; aucune variable d'environnement ne permet de déplacer l'un ou l'autre répertoire persistant | Comportement de l'application dans les guides des plateformes |
| Travail en arrière-plan | Un **véritable démon cron toujours actif** dans le conteneur (8 tâches planifiées intégrées) | §Contraintes de mise à l'échelle dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde par défaut de démarrage/d'activité ciblant `/` (aucun point de terminaison `/health` dédié n'est documenté pour cette image) | §Observabilité dans les guides des plateformes |

---

## 2. Secrets — aucun {#2-secrets--none}

Wallos n'a besoin d'**aucune variable d'environnement secrète**. Contrairement aux
applications reposant sur une base de données, il conserve sa table des
utilisateurs, ses abonnements et ses paramètres dans sa propre base SQLite
embarquée. L'identifiant initial est le célèbre **`admin` / `admin`**, que
l'opérateur doit modifier via l'interface web lors du premier accès.

Par conséquent, les outputs `secret_ids` et `secret_values` de la couche Common
sont volontairement des maps vides, et les deux variantes les transmettent sans
modification (`module_secret_env_vars = secret_ids`, `module_explicit_secret_values =
secret_values`). Il n'y a ni clé de chiffrement ni secret JWT à préserver d'un
redéploiement à l'autre — le seul état durable est constitué des deux répertoires
SQLite/logos sur leurs volumes respectifs (voir §5).

---

## 3. Image de conteneur {#3-container-image}

Wallos est déployé sous la forme d'une image véritablement **précompilée** — sans
Dockerfile ni étape Cloud Build :

- **`image_source = "prebuilt"`**, `container_image = "bellamy/wallos"`.
- `bellamy/wallos` est une véritable image étiquetée « latest », maintenue par un
  tiers — il n'existe pas d'image officielle publiée par le projet Wallos lui-même.
- **`enable_image_mirroring`** (par défaut `true`) copie l'image dans Artifact
  Registry pour éviter les limites de débit de Docker Hub ; cela est indépendant de
  la distinction précompilé/personnalisé — l'image est rehébergée avec le même
  digest, rien n'est construit.
- **Pas de point d'entrée personnalisé.** Le démarrage propre à l'image amont lance
  Wallos directement ; il n'y a pas de script enveloppe pour remapper les variables.

---

## 4. Initialisation de la base de données — aucune {#4-database-initialization--none}

Wallos gère son propre stockage et ne nécessite **aucune initialisation de base de
données**. Aucune tâche `db-init` n'est injectée, et `database_type` est fixé à
`NONE`. L'entrée `initialization_jobs` n'est prise en compte que si l'opérateur
fournit des tâches personnalisées — sinon elle reste vide.

Au premier démarrage, Wallos crée sa base SQLite dans
`/var/www/html/db/wallos.db` si le fichier n'existe pas encore et crée l'utilisateur
par défaut `admin`/`admin`.

---

## 5. Stockage objet et persistance {#5-object-storage-and-persistence}

**Deux** buckets Cloud Storage sont déclarés ici et provisionnés par le socle, qui
accorde également l'accès au compte de service de la charge de travail :

- **`db`** — monté sur `/var/www/html/db`, contient le fichier de la base SQLite
  (`wallos.db`).
- **`uploads`** — monté sur `/var/www/html/images/uploads/logos`, contient les
  logos de fournisseurs personnalisés téléversés par les utilisateurs.

Ces deux chemins n'ont aucun ancêtre commun autre que `/var/www/html` lui-même (la
racine de l'application PHP) ; ils ne peuvent donc pas être regroupés en un seul
montage sans masquer le code de l'application — chacun dispose de son propre bucket.

- **Cloud Run** ne monte que le bucket `uploads` en tant que volume **GCS FUSE**
  (`enable_gcs_uploads_volume = true`) — de simples écritures de fichiers entiers,
  sans besoin de verrouillage. Le répertoire de la base de données est plutôt servi
  depuis **NFS** (`enable_nfs = true`, `nfs_mount_path = "/var/www/html/db"`, avec
  `enable_gcs_db_volume = false`) : GCS FUSE ne peut pas fournir les verrous
  consultatifs POSIX dont SQLite a besoin, et chaque chargement de page échoue avec
  `SQLite3::query(): Unable to execute statement: database is locked` lorsque la
  base de données est placée sur un volume GCS.
- **GKE** monte le bucket `db` en GCS FUSE **sauf** si un PVC bloc de StatefulSet
  est utilisé sur le même chemin (`stateful_pvc_enabled = true`, la valeur par
  défaut recommandée), auquel cas Common définit `enable_gcs_db_volume = false` pour
  éviter un conflit de double montage. Le bucket `uploads` utilise **toujours** GCS
  FUSE sur GKE quoi qu'il arrive — un PVC de StatefulSet ne prend en charge qu'un
  seul `mount_path`, et celui-ci est consacré au répertoire de la base de données
  pour garantir un verrouillage en écriture correct.

Les emplacements des deux buckets sont laissés vides afin que le socle les résolve
vers la région de déploiement découverte automatiquement
(`coalesce(bucket.location, region)`), ce qui évite de forcer le remplacement des
buckets à emplacement immuable lors d'une réapplication dans une autre région.

Listez-les avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~wallos"
```

**À vérifier au premier déploiement :** si `bellamy/wallos` place des ressources
par défaut dans `/var/www/html/db` ou `/var/www/html/images/uploads/logos`, monter
un nouveau bucket vide exactement sur ce chemin les masquera au premier démarrage
(la classe de défaillance générale de « masquage par volume » documentée ailleurs
dans ce catalogue). Ce point n'a été confirmé dans aucun sens lors des recherches.

---

## 6. Paramètres principaux de l'application et contraintes de mise à l'échelle {#6-core-application-settings-and-scaling-constraints}

`Wallos_Common` établit l'environnement de base afin que l'application démarre
correctement au premier lancement — mais contrairement à la plupart des modules de
ce catalogue, plusieurs valeurs par défaut sont ici des **contraintes
structurantes, et pas seulement un réglage des coûts** :

- **Port du conteneur 80** — l'écouteur HTTP/1.1 par défaut de Wallos (correspond à
  `container_port`).
- **Première connexion** — `admin` / `admin` ; modifiez-le immédiatement dans
  l'interface web.
- **`min_instance_count = max_instance_count = 1`, toujours.** Wallos exécute un
  véritable démon cron toujours actif (8 tâches planifiées intégrées —
  actualisation des taux de change, notifications de renouvellement, une
  interrogation de vérification d'e-mail toutes les 2 minutes, entre autres) qui ne
  s'exécute que lorsqu'une instance/un pod tourne effectivement (min=1), et sa base
  SQLite ne prend pas en charge plusieurs écrivains (max=1). La mise à zéro ou le
  passage à plus d'un réplica casse l'application silencieusement, sans aucune
  erreur.
- **Cloud Run nécessite en outre `cpu_always_allocated = true`** afin que le
  travail en arrière-plan du démon cron dans le processus obtienne réellement des
  cycles CPU entre les requêtes — avec une facturation à la requête, le CPU serait
  réduit à presque zéro.

Les variables supplémentaires non secrètes fournies via `environment_variables`
sont fusionnées par-dessus ces valeurs par défaut.

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut de démarrage et d'activité ciblent **`/`** — la page de
connexion non authentifiée de Wallos. `bellamy/wallos` ne documente aucun point de
terminaison de contrôle de santé dédié ; il s'agit donc d'un signal de
disponibilité grossier plutôt que d'un signal conçu à cet effet : la sonde de
démarrage utilise un délai initial de 15 secondes avec une fenêtre de 10 tentatives,
et la sonde d'activité un délai de 30 secondes.

---

Pour la configuration propre à Wallos destinée aux utilisateurs (variables par
groupe, outputs, et comment explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Wallos_GKE](Wallos_GKE.md)** et
**[Wallos_CloudRun](Wallos_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Wallos sur Google Cloud Run](Wallos_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Wallos sur GKE Autopilot](Wallos_GKE.md) — cette configuration déployée sur GKE.
