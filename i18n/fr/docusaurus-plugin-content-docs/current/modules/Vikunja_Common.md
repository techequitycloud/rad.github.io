---
title: "Vikunja Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Vikunja — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Vikunja_Common.md @ 3055034 sha256:78f8b65015b5 -->

# Vikunja Common — Configuration applicative partagée {#vikunja-common--shared-application-configuration}

`Vikunja_Common` est la **couche applicative partagée** de Vikunja. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Vikunja
sur laquelle s'appuient à la fois [Vikunja_GKE](Vikunja_GKE.md) et
[Vikunja_CloudRun](Vikunja_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Vikunja, consultez les
guides des plateformes ([Vikunja_GKE](Vikunja_GKE.md),
[Vikunja_CloudRun](Vikunja_CloudRun.md)) et les guides des fondations
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Vikunja_Common | Où cela apparaît |
|---|---|---|
| Secret cryptographique | Génère `VIKUNJA_SERVICE_JWTSECRET` (32 caractères aléatoires) et le stocke dans **Secret Manager** | Injecté automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image du conteneur | Enveloppe l'image `vikunja/vikunja` basée sur `scratch` avec un busybox greffé et un point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Raccordement de la base à l'exécution | Fait correspondre les variables `DB_*` de la plateforme à la configuration `VIKUNJA_DATABASE_*` de Vikunja et choisit l'hôte de connexion et le mode SSL appropriés | Comportement de l'application dans les guides des plateformes |
| Port et contrôles de santé | Fixe le port du conteneur à 3456 et les sondes de démarrage/vivacité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Secret cryptographique dans Secret Manager {#2-cryptographic-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais
défini en clair et ne doit jamais être modifié après le premier déploiement :

- **`VIKUNJA_SERVICE_JWTSECRET`** — une chaîne aléatoire de 32 caractères. Vikunja signe tous
  les JWT de session des utilisateurs avec elle. S'il n'était pas défini, Vikunja le générerait aléatoirement à chaque
  démarrage du conteneur, ce qui invaliderait toutes les sessions et déconnecterait chaque utilisateur à chaque
  redémarrage. `Vikunja_Common` provisionne donc un secret stable. Le renouveler après le
  premier démarrage invalide immédiatement toutes les sessions actives et oblige chaque utilisateur à se
  reconnecter.

Récupérez le secret après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~jwt-secret"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ; le nom de son
secret figure dans les sorties du déploiement de la plateforme (`database_password_secret`).
Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

Vikunja nécessite **PostgreSQL 15** ; le moteur est fixe et MySQL ou d'autres
moteurs ne sont pas pris en charge. Lors du premier déploiement, un job ponctuel (`db-init`) s'exécute
avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et crée un lien symbolique vers celui-ci dans `/tmp` pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable (jusqu'à 60 tentatives),
3. Crée le rôle de l'application (ou met à jour son mot de passe),
4. Crée la base de données de l'application avec ce rôle comme propriétaire (si elle n'existe pas),
5. Accorde tous les privilèges sur la base de données au rôle,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement (`/quitquitquit`).

Vikunja exécute lui-même ses migrations de schéma au **premier démarrage de l'application** — le
job `db-init` ne provisionne que la base de données vide et le rôle. Le job peut être
relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image du conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image amont `vikunja/vikunja` est **basée sur `scratch`** : elle ne contient que le
binaire statique `/app/vikunja/vikunja`, sans shell ni `/etc/passwd`. Pour exécuter un
point d'entrée shell qui fait correspondre l'environnement de la plateforme à la configuration native de Vikunja,
le Dockerfile personnalisé est multi-étapes :

- **Greffe un busybox statique** (`COPY --from=busybox /bin/busybox`) et utilise
  `busybox sh` comme interpréteur du point d'entrée — un build léger simple `FROM … + RUN` est
  impossible, car il n'existe ni shell ni base d'utilisateurs à résoudre.
- **Crée à l'avance le répertoire des pièces jointes** `/app/vikunja/files`, appartenant à l'uid 1000
  (`COPY --chown=1000:0`), car l'application s'exécute sous l'uid 1000 dans un WORKDIR
  appartenant à root et ne peut pas le créer avec `mkdir` au démarrage. Pour des pièces jointes durables, montez NFS sur
  ce chemin.
- Construit avec un ARG de build propre à l'application, `VIKUNJA_VERSION` — **et non** le générique
  `APP_VERSION`, que la fondation injecte dans `build_args` et qui l'emporterait sinon
  lors de la fusion en résolvant `vikunja:latest` (un tag inexistant). `"latest"` correspond
  à une version récente épinglée (`2.3.0`).

Le script de point d'entrée (`vikunja-entrypoint.sh`) s'exécute avant le démarrage du serveur Go :

- **Fait correspondre `DB_*` à `VIKUNJA_DATABASE_*`** — transpose les variables injectées par la plateforme
  `DB_USER`, `DB_PASSWORD`, `DB_NAME` en `VIKUNJA_DATABASE_USER`,
  `VIKUNJA_DATABASE_PASSWORD`, `VIKUNJA_DATABASE_DATABASE`, et définit
  `VIKUNJA_DATABASE_TYPE = postgres`. Les valeurs d'environnement distinctes ne nécessitent aucun encodage d'URL —
  Vikunja les encode lui-même.
- **Se connecte via l'IP privée, pas via le socket.** Vikunja construit en interne une URL `postgres://`
  et ne peut donc pas utiliser le répertoire du socket Cloud SQL comme hôte — le
  chemin `/cloudsql/<project>:<region>:<instance>` contient des deux-points que le constructeur d'URL
  interprète comme un port invalide (`invalid port after host`). Le point d'entrée se connecte via
  l'**IP privée** Cloud SQL (`DB_IP`) avec `sslmode=require` sur Cloud Run
  (Cloud SQL refuse le TCP non chiffré sur IP privée), et via la **boucle locale** du proxy
  (`127.0.0.1`) avec `sslmode=disable` sur GKE. Il choisit selon que l'hôte résolu
  est la boucle locale — et non selon que `DB_IP` est défini — car `DB_IP` vaut `127.0.0.1`
  sur GKE.
- **Définit `VIKUNJA_SERVICE_PUBLICURL`** à partir de `CLOUDRUN_SERVICE_URL` (Cloud Run) ou de
  `GKE_SERVICE_URL` (GKE), afin que les liens et le frontend utilisent la véritable adresse du service.
- **Lance le serveur** avec `exec /app/vikunja/vikunja` en tant que PID 1.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Vikunja_Common` établit l'environnement Vikunja de base afin que l'application
démarre correctement dès le premier lancement :

- **Port** — Vikunja écoute sur `3456`.
- **Type de base de données** — `VIKUNJA_DATABASE_TYPE = postgres`.
- **URL publique** — dérivée à l'exécution de l'URL du service injectée par la plateforme.
- **Secret JWT** — `VIKUNJA_SERVICE_JWTSECRET` injecté depuis Secret Manager.
- **Propriété au premier lancement** — Vikunja ne fournit aucun administrateur pré-créé ; le **premier
  compte enregistré devient le propriétaire**. Après l'avoir créé, désactivez l'inscription
  ouverte en définissant `VIKUNJA_SERVICE_ENABLEREGISTRATION = "false"` via
  `environment_variables`.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** se connecte à Cloud SQL via l'IP privée (`sslmode=require`) et
  lit son URL publique dans `CLOUDRUN_SERVICE_URL`.
- **GKE** se connecte via la boucle locale du sidecar cloud-sql-proxy (`sslmode=disable`)
  et lit son URL publique dans `GKE_SERVICE_URL`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent `/health` — le point de terminaison de vivacité
public et non authentifié de Vikunja, qui renvoie 200 dès que le serveur s'est lié à son
port. Une fenêtre de démarrage généreuse laisse le temps aux migrations de schéma que Vikunja exécute au
premier démarrage.

- **Cloud Run** et **GKE** utilisent tous deux des sondes HTTP sur `/health` avec un délai
  initial de 30 secondes ; la sonde de démarrage autorise une large fenêtre de nouvelles tentatives (seuil d'échec
  par défaut de 30) pour les migrations du premier démarrage.

---

## 7. Stockage d'objets {#7-object-storage}

Vikunja stocke ses données dans PostgreSQL et ses pièces jointes sur le système de fichiers
local (`/app/vikunja/files`). `Vikunja_Common` ne déclare donc **aucun**
bucket Cloud Storage dédié (`storage_buckets = []`). Pour des pièces jointes durables,
activez NFS dans la variante de plateforme et montez-le sur le chemin des pièces jointes.

---

Pour la configuration propre à Vikunja exposée aux utilisateurs (variables par groupe, sorties,
et manière d'explorer chaque service depuis la Console et la CLI), consultez les guides
des plateformes : **[Vikunja_GKE](Vikunja_GKE.md)** et
**[Vikunja_CloudRun](Vikunja_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Vikunja sur GKE Autopilot](Vikunja_GKE.md) — cette configuration déployée sur GKE.
