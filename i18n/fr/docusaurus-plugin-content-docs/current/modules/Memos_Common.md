---
title: "Memos Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Memos — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Memos_Common.md @ 3055034 sha256:aebe2b6961b2 -->

# Memos Common — Configuration applicative partagée {#memos-common--shared-application-configuration}

`Memos_Common` est la **couche applicative partagée** de Memos. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Memos sur laquelle
s'appuient à la fois [Memos_GKE](Memos_GKE.md) et [Memos_CloudRun](Memos_CloudRun.md),
afin que les deux variantes de plateforme se comportent de façon identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement —
elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation
des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Memos, consultez les
guides de plateforme ([Memos_GKE](Memos_GKE.md), [Memos_CloudRun](Memos_CloudRun.md)) et
les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Memos_Common | Où cela apparaît |
|---|---|---|
| Secrets applicatifs | **Aucun.** Memos n'a ni variable d'environnement d'amorçage administrateur, ni clé de chiffrement, ni secret JWT — le premier compte créé via l'interface web devient hôte/administrateur | sans objet |
| Image de conteneur | Encapsule l'image officielle `ghcr.io/usememos/memos` avec un script de point d'entrée personnalisé ; construite via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit la tâche du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Aucun — aucun bucket GCS n'est déclaré pour les pièces jointes | Sortie `storage_buckets` (vide) |
| Paramètres principaux | Calcule `MEMOS_DSN`/`MEMOS_DRIVER` au démarrage du conteneur à partir des variables `DB_*` de la plateforme ; définit le port 5230 et le mode prod | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/` | §Observabilité dans les guides de plateforme |

---

## 2. Aucun secret applicatif {#2-no-application-secrets}

Contrairement à la plupart des modules de ce catalogue, `Memos_Common` génère
**zéro** secret applicatif stocké dans Secret Manager. Il n'existe aucun équivalent
d'une clé de chiffrement, d'un secret de signature JWT ou d'un mot de passe
d'amorçage administrateur :

- **Aucun identifiant d'amorçage administrateur.** Memos n'a pas de variable
  d'environnement de type `DEFAULTUSER`. Le **premier compte créé via le formulaire
  d'inscription de l'interface web devient automatiquement l'hôte/administrateur** —
  il n'y a rien à récupérer dans Secret Manager avant la première connexion.
- **La signature des sessions est autogérée.** Memos génère ses propres éléments
  internes de signature de session et les conserve dans sa propre base de données
  PostgreSQL au premier démarrage, et non dans Secret Manager.

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Memos requiert **PostgreSQL** dans le câblage de ce module ; le moteur est fixé. Lors
du premier déploiement, une tâche ponctuelle (`db-init`) s'exécute avec
`postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et le mappe pour l'accès `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif avec le mot de passe généré,
4. Crée (ou reconfigure) la base de données applicative avec ce rôle comme propriétaire,
5. Accorde tous les privilèges sur la base de données,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Memos applique ensuite son **propre schéma interne** via l'auto-migration GORM à
chaque démarrage de l'application — aucune tâche de migration distincte ne
s'exécute au niveau de la plateforme.

La tâche peut être relancée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `ghcr.io/usememos/memos:<version>` (basée sur Alpine,
avec un vrai shell) en y ajoutant un paquet `python3` léger et un point d'entrée shell
(`memos-entrypoint.sh`) qui s'exécute avant le démarrage du binaire compilé :

- **Calcule `MEMOS_DSN`.** Memos lit une URL de connexion unique et combinée —
  contrairement à de nombreuses applications Go/GORM de ce catalogue qui acceptent
  des champs distincts `host=`/`user=`/`pass=`, Memos n'offre pas ce découpage. Le
  point d'entrée construit le DSN à partir des variables `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD`
  de la plateforme, avec un embranchement selon la forme de `DB_HOST` :
  - **Cloud Run** (`DB_HOST` est un répertoire de socket `/cloudsql/...`) : la forme
    libpq avec paramètre de requête pour le socket
    `postgres://user:pass@/db?host=<dir>&sslmode=disable` — l'autorité d'une URL ne
    peut pas contenir les deux-points du chemin du socket.
  - **GKE** (`DB_HOST` vaut `127.0.0.1`, le sidecar cloud-sql-proxy) : TCP simple en
    boucle locale, `sslmode=disable` (le proxy termine déjà le TLS).
  - **TCP direct sur IP privée** (tout autre hôte) : véritable TCP avec
    `sslmode=require` — Cloud SQL rejette les connexions non chiffrées sur IP privée.
- **Encode le mot de passe pour l'URL.** Le DSN étant une URL, le mot de passe passe
  par `python3 -c "import urllib.parse,os; print(urllib.parse.quote(...))"` avant
  d'être intégré — un mot de passe brut contenant `@`, `:`, `/` ou `%` casserait
  sinon l'analyse de l'URL.
- **Définit `MEMOS_DRIVER=postgres`, `MEMOS_MODE=prod`, `MEMOS_PORT=5230`.**
- **Enchaîne sur le point d'entrée propre de l'image amont** (`/usr/local/memos/entrypoint.sh`),
  qui abandonne les privilèges au profit de l'utilisateur `nonroot` (uid 10001) avant
  d'exécuter le binaire compilé `memos` — préservant ainsi la posture de sécurité de
  l'image de base au lieu de la remplacer purement et simplement.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Memos_Common` établit l'environnement Memos de base afin que l'application démarre
correctement dès le premier lancement :

- **Port** — `MEMOS_PORT = "5230"`, la valeur native par défaut de Memos ; aucun remappage.
- **Mode** — `MEMOS_MODE = "prod"`.
- **Pilote** — `MEMOS_DRIVER = "postgres"`, fixé.

Contrairement aux applications dotées d'une notion d'URL frontale ou de rappel de
webhook, Memos ne nécessite aucune correction d'URL propre à la plateforme à
l'exécution — aucun chemin de redirection OAuth ni d'ingestion de webhook n'est
intégré à la configuration par défaut de ce module.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/` — la page publique de connexion/d'accueil de Memos,
accessible sans authentification. Memos ne documente aucun point de terminaison
dédié `/health` ou `/healthz` ; sonder la racine évite donc le piège du point de
terminaison protégé par authentification documenté pour d'autres applications de ce
catalogue (un chemin de santé authentifié renvoie 403 à une sonde non authentifiée,
et la révision/le pod ne devient jamais Ready alors que l'application a démarré
correctement).

- **Cloud Run** utilise une sonde HTTP ciblant `/` avec un délai initial de
  30 secondes et un seuil d'échec généreux (30) pour tolérer la mise en place du
  schéma au premier démarrage.
- **GKE** utilise la même cible et le même calendrier de sonde HTTP.

---

## 7. Stockage d'objets {#7-object-storage}

Cette couche ne déclare aucun bucket GCS. Les notes texte de Memos sont entièrement
conservées dans PostgreSQL ; le module ne relie pas le stockage des pièces jointes à
Cloud Storage. Consultez le tableau des pièges dans les guides de plateforme pour la
conséquence d'un téléversement de pièces jointes binaires sans ajout d'une entrée
`gcs_volumes`.

---

Pour la configuration propre à Memos destinée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la console et la CLI), consultez les
guides de plateforme : **[Memos_GKE](Memos_GKE.md)** et **[Memos_CloudRun](Memos_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Memos sur Google Cloud Run](Memos_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Memos sur GKE Autopilot](Memos_GKE.md) — cette configuration déployée sur GKE.
