---
title: "Vikunja Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Vikunja — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Vikunja_Common.md @ 15fd4c7 sha256:ba90bf37219d -->

# Vikunja Common — Configuration d'application partagée {#vikunja-common--shared-application-configuration}

`Vikunja_Common` est la **couche d'application partagée** pour Vikunja. Elle n'est
pas déployée seule ; elle fournit plutôt la configuration spécifique à Vikunja
sur laquelle s'appuient [Vikunja_GKE](Vikunja_GKE.md) et
[Vikunja_CloudRun](Vikunja_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a pas ses propres
entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation de la
plateforme.

Pour l'infrastructure qui provisionne et exécute Vikunja, consultez les guides de
plateforme ([Vikunja_GKE](Vikunja_GKE.md),
[Vikunja_CloudRun](Vikunja_CloudRun.md)) et les guides de fondation
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Vikunja_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `VIKUNJA_SERVICE_JWTSECRET` (aléatoire de 32 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image `vikunja/vikunja` basée sur `scratch` avec une busybox greffée et un point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Câblage de la base de données d'exécution | Mappe les variables `DB_*` de la plateforme sur la configuration `VIKUNJA_DATABASE_*` de Vikunja et choisit l'hôte de connexion/le mode SSL appropriés | Comportement de l'application dans les guides de plateforme |
| Port et vérifications de santé | Définit le port du conteneur à 3456 et la sonde de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides de plateforme |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est
jamais défini en clair et ne doit jamais être modifié après le premier
déploiement :

- **`VIKUNJA_SERVICE_JWTSECRET`** — une chaîne aléatoire de 32 caractères. Vikunja signe
  tous les JWT de session utilisateur avec elle. S'il n'était pas défini, Vikunja
  le randomiserait à chaque démarrage de conteneur, ce qui invaliderait toutes les
  sessions et déconnecterait chaque utilisateur à chaque redémarrage. `Vikunja_Common`
  provisionne donc un secret stable. Le faire pivoter après le premier démarrage
  invalide immédiatement toutes les sessions actives, forçant chaque utilisateur à
  se reconnecter.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la
fondation ; son nom de secret est indiqué dans les sorties de déploiement de la
plateforme (`database_password_secret`). Voir [App_Common](App_Common.md) pour le secret
partagé et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Vikunja nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job unique
(`db-init`) s'exécute en utilisant `postgres:15-alpine` et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL et le lie
   symboliquement dans `/tmp` pour l'accès `psql`,
2. Attend que PostgreSQL soit accessible (jusqu'à 60 tentatives),
3. Crée (ou met à jour le mot de passe de) le rôle de l'application,
4. Crée la base de données de l'application avec ce rôle comme propriétaire (si elle
   n'existe pas),
5. Accorde tous les privilèges sur la base de données au rôle,
6. Signale au proxy d'authentification Cloud SQL de s'arrêter gracieusement
   (`/quitquitquit`).

Vikunja exécute ses migrations de schéma lors du **premier démarrage de
l'application** — le job `db-init` ne provisionne que la base de données et le
rôle vides. Le job peut être réexécuté en toute sécurité. Inspectez la base de
données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les
sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image amont `vikunja/vikunja` est basée sur **`scratch`** : elle ne contient
que le binaire statique `/app/vikunja/vikunja`, sans shell ni `/etc/passwd`. Pour
exécuter un point d'entrée shell qui mappe l'environnement de la plateforme sur la
configuration native de Vikunja, le Dockerfile personnalisé est multi-étapes :

- **Greffe une busybox statique** (`COPY --from=busybox /bin/busybox`) et utilise `busybox sh`
  comme interpréteur de point d'entrée — une build fine `FROM … + RUN` simple est
  impossible car il n'y a pas de shell ou de base de données utilisateur à
  résoudre.
- **Pré-crée le répertoire des pièces jointes** `/app/vikunja/files` appartenant à
  l'uid 1000 (`COPY --chown=1000:0`), car l'application s'exécute en tant qu'uid 1000
  sous un WORKDIR appartenant à root et ne peut pas `mkdir` au démarrage.
  Ce n'est que la solution de repli de Vikunja : le module définit `VIKUNJA_FILES_BASEPATH`
  (`files_basepath`) sur le montage durable de la variante à la place.
- Build avec un ARG de build `VIKUNJA_VERSION` spécifique à l'application — **pas**
  le générique `APP_VERSION`, que la fondation injecte dans `build_args` et qui
  gagnerait autrement la fusion et résoudrait `vikunja:latest` (une balise
  inexistante). `"latest"` correspond à une version récente épinglée
  (`2.3.0`).

Le script de point d'entrée (`vikunja-entrypoint.sh`) s'exécute avant le démarrage du
serveur Go :

- **Mappe `DB_*` à `VIKUNJA_DATABASE_*`** — traduit les variables
  `DB_USER`, `DB_PASSWORD`, `DB_NAME` injectées par la
  plateforme en `VIKUNJA_DATABASE_USER`, `VIKUNJA_DATABASE_PASSWORD`, `VIKUNJA_DATABASE_DATABASE`, et
  définit `VIKUNJA_DATABASE_TYPE = postgres`. Les valeurs d'environnement discrètes n'ont pas besoin
  d'être encodées en URL — Vikunja les encode lui-même.
- **Se connecte via l'IP privée, pas le socket.** Vikunja construit une URL
  `postgres://` en interne, il ne peut donc pas utiliser le répertoire de socket
  Cloud SQL comme hôte — le chemin `/cloudsql/<project>:<region>:<instance>` contient des deux-points que le
  constructeur d'URL interprète comme un port erroné (`invalid port after host`). Le point
  d'entrée se connecte via l'**IP privée** de Cloud SQL (`DB_IP`) avec
  `sslmode=require` sur Cloud Run (Cloud SQL rejette le TCP IP privée non chiffré),
  et via le **bouclage** du proxy (`127.0.0.1`) avec `sslmode=disable` sur GKE.
  Il se ramifie selon que l'hôte résolu est en bouclage — et non selon que
  `DB_IP` est défini — car `DB_IP` est `127.0.0.1` sur GKE.
- **Définit `VIKUNJA_SERVICE_PUBLICURL`** à partir de `CLOUDRUN_SERVICE_URL` (Cloud Run) ou
  `GKE_SERVICE_URL` (GKE) afin que les liens et le frontend utilisent la véritable
  adresse du service.
- **Lance le serveur** avec `exec /app/vikunja/vikunja` comme PID 1.

---

## 5. Paramètres d'application principaux {#5-core-application-settings}

`Vikunja_Common` établit l'environnement Vikunja de base afin que l'application
démarre correctement au premier boot :

- **Port** — Vikunja écoute sur `3456`.
- **Type de base de données** — `VIKUNJA_DATABASE_TYPE = postgres`.
- **URL publique** — dérivée au moment de l'exécution de l'URL de service
  injectée par la plateforme.
- **Secret JWT** — `VIKUNJA_SERVICE_JWTSECRET` injecté depuis Secret Manager.
- **Propriété au premier démarrage** — Vikunja ne fournit pas d'administrateur
  pré-initialisé ; le **premier compte enregistré devient le propriétaire**. Après
  l'avoir créé, désactivez l'enregistrement ouvert en définissant `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"`
  via `environment_variables`.

Ajustements spécifiques à la plateforme gérés ici :

- **Cloud Run** se connecte à Cloud SQL via l'IP privée (`sslmode=require`) et lit
  son URL publique depuis `CLOUDRUN_SERVICE_URL`.
- **GKE** se connecte via le bouclage du sidecar cloud-sql-proxy (`sslmode=disable`)
  et lit son URL publique depuis `GKE_SERVICE_URL`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent `/health` — le
point de terminaison de vivacité public et non authentifié de Vikunja qui renvoie
200 dès que le serveur lie son port. Une fenêtre de démarrage généreuse permet de
gérer les migrations de schéma que Vikunja exécute au premier démarrage.

- **Cloud Run** et **GKE** utilisent tous deux des sondes HTTP sur `/health`
  avec un délai initial de 30 secondes ; la sonde de démarrage permet une large
  fenêtre de réessai (seuil d'échec par défaut 30) pour les migrations au premier
  démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Vikunja stocke ses données dans PostgreSQL et ses pièces jointes sur le système
de fichiers local. `Vikunja_Common` ne déclare **aucun** bucket Cloud Storage
dédié (`storage_buckets = []`) ; au lieu de cela, il exporte `VIKUNJA_FILES_BASEPATH` depuis
`files_basepath` (par défaut `/data`), et chaque variante passe son propre
montage durable — le NFS `nfs_mount_path` sur Cloud Run, le PVC `stateful_pvc_mount_path` sur
GKE. Sans cela, Vikunja écrirait dans le répertoire éphémère `/app/vikunja/files`.

---

Pour la configuration spécifique à Vikunja et destinée à l'utilisateur (variables
par groupe, sorties et comment explorer chaque service depuis la Console et la
CLI), consultez les guides de plateforme : **[Vikunja_GKE](Vikunja_GKE.md)** et
**[Vikunja_CloudRun](Vikunja_CloudRun.md)**.

## Guides associés {#related-guides}

- [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Vikunja sur GKE Autopilot](Vikunja_GKE.md) — cette configuration déployée sur GKE.
