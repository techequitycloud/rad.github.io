---
title: "Unleash Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Unleash — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Unleash_Common.md @ 3055034 sha256:29f99abec649 -->

# Unleash Common — Configuration applicative partagée {#unleash-common--shared-application-configuration}

`Unleash_Common` est la **couche applicative partagée** d'Unleash. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Unleash sur laquelle
s'appuient à la fois [Unleash_GKE](Unleash_GKE.md) et
[Unleash_CloudRun](Unleash_CloudRun.md), afin que les deux variantes de plateforme se
comportent de la même manière là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle ne possède aucune entrée propre
dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Unleash, consultez les
guides des plateformes ([Unleash_GKE](Unleash_GKE.md),
[Unleash_CloudRun](Unleash_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Unleash_Common | Où cela apparaît |
|---|---|---|
| Identifiant d'amorçage | Génère un jeton d'API administrateur d'amorçage et le stocke dans **Secret Manager** | Injecté sous le nom `INIT_ADMIN_API_TOKENS` ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Encapsule l'image officielle `unleashorg/unleash-server` avec un script de point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement (`db-init`) qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Chaîne de connexion | Compose `DATABASE_URL` au démarrage du conteneur à partir des variables `DB_*` injectées par la plateforme, avec un SSL sécurisé par défaut pour les connexions TCP directes par IP privée | Section Comportement de l'application des guides des plateformes |
| Paramètres principaux | Définit l'environnement Unleash de base : port d'écoute 4242, gestion du TLS de la base de données | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/health` | Section Observabilité des guides des plateformes |

---

## 2. Le jeton d'API administrateur d'amorçage dans Secret Manager {#2-the-bootstrap-admin-api-token-in-secret-manager}

Un unique jeton d'API administrateur d'amorçage est généré automatiquement et stocké
dans Secret Manager — il n'est jamais défini en clair :

- **`INIT_ADMIN_API_TOKENS`** — un jeton au format des jetons d'administration
  d'Unleash, `*:*.<48-char-random>`, où le préfixe `*:*` donne accès à **tous les
  projets et tous les environnements**. Unleash lit cette variable d'environnement au
  premier démarrage et enregistre le jeton dans sa base de données, afin que
  l'automatisation (pipelines de CI, la CLI, les fournisseurs Terraform) puisse appeler
  l'Admin API d'Unleash immédiatement, sans qu'une personne ait d'abord à se connecter
  à l'interface. Le secret est nommé `secret-<resource-prefix>-<app>-admin-token`.

Récupérez le jeton après le déploiement :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~admin-token"

# Read the token value:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Utilisez-le avec l'Admin API :

```bash
curl -s -H "Authorization: <token>" "$SERVICE_URL/api/admin/projects"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le modèle partagé
des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Unleash nécessite **PostgreSQL 15** ; le moteur est fixe, et ni MySQL ni d'autres
moteurs ne sont pris en charge. Lors du premier déploiement, un job ponctuel
(`db-init`) s'exécute avec `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy et le rend accessible à `psql`,
2. Attend que PostgreSQL soit joignable,
3. Crée (ou met à jour) le rôle applicatif avec le mot de passe généré,
4. Crée la base de données de l'application avec ce rôle comme propriétaire,
5. Accorde à l'utilisateur applicatif tous les privilèges sur la base de données,
6. Signale au Cloud SQL Auth Proxy de s'arrêter proprement.

Unleash applique ses **propres migrations de schéma** à chaque démarrage de
l'application — le job `db-init` se contente de provisionner la base de données vide et
le rôle ; il ne crée pas de tables. Le job peut être relancé sans risque. Inspectez
directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `unleashorg/unleash-server:<version>` avec un
point d'entrée shell léger (`unleash-entrypoint.sh`) qui s'exécute avant le démarrage
du serveur Node.js. Sa tâche principale est de composer l'unique chaîne de connexion
`DATABASE_URL` attendue par Unleash à partir des variables `DB_*` distinctes injectées
par la plateforme — Cloud Run n'interpole pas `$(VAR)` dans les valeurs des variables
d'environnement, si bien que l'URL est assemblée à l'exécution. Le point d'entrée
s'adapte à l'hôte de base de données résolu :

- **Socket Unix** (`/cloudsql/<instance>`, Cloud SQL natif de Cloud Run) : construit
  `postgres://user:pass@/db?host=/cloudsql/<instance>` — le chemin du socket ne peut
  pas figurer dans la partie autorité d'une URL, il est donc placé dans le paramètre de
  requête `host`. Le TLS ne s'applique pas à un socket local, donc `DATABASE_SSL` est
  désactivé.
- **Proxy en boucle locale** (`127.0.0.1`, sidecar cloud-sql-proxy de GKE) : le sidecar
  a déjà terminé le TLS vers Cloud SQL, si bien que le saut vers l'interface de boucle
  locale n'est pas chiffré et la vérification des certificats est désactivée.
- **IP privée directe** (repli) : se connecte avec `?ssl=true` et conserve
  `DATABASE_SSL_REJECT_UNAUTHORIZED=true` — **sécurisé par défaut**. Un opérateur doit
  le remplacer explicitement pour désactiver la vérification des certificats.

Le mot de passe est encodé pour URL avant d'être placé dans le DSN, afin que les
caractères spéciaux (`@ : / ? # % & +`) du secret généré par la plateforme ne puissent
pas corrompre la chaîne de connexion. L'ARG de build de l'image est `UNLEASH_VERSION`
(et non l'`APP_VERSION` générique injecté par le socle), et `latest` est remplacé par
un tag figé (`5.7.0`) pour des builds reproductibles. Enfin, le point d'entrée localise
et lance le serveur Unleash avec `exec node <entry>` en tant que PID 1.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Unleash_Common` établit l'environnement Unleash de base afin que l'application
démarre correctement dès le premier démarrage :

- **Port d'écoute** — Unleash sert sur le port **4242** (`container_port = 4242`).
- **URL de la base de données** — `DATABASE_URL` est composée au démarrage du conteneur
  (voir §4) ; elle n'est jamais stockée en clair dans l'état Terraform.
- **TLS de la base de données** — `DATABASE_SSL_REJECT_UNAUTHORIZED` vaut `true` pour
  les connexions TCP directes par IP privée (sécurisé par défaut) et `false` uniquement
  sur les chemins socket / proxy en boucle locale, où le TLS est absent ou déjà
  terminé.
- **Jeton d'amorçage** — `INIT_ADMIN_API_TOKENS` est injecté depuis Secret Manager, de
  sorte qu'un jeton d'API administrateur valide à accès total existe dès le premier
  démarrage.

Unleash est également livré avec un identifiant de premier lancement bien connu pour
l'interface : connectez-vous avec `admin` / `unleash4all` et changez le mot de passe
immédiatement après le premier déploiement.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/health` — le point de terminaison de santé dédié
d'Unleash, sans authentification, qui ne renvoie 200 qu'une fois le serveur initialisé
et connecté à PostgreSQL. Une fenêtre de démarrage généreuse
(`failure_threshold = 30`, `period_seconds = 10`) tient compte des migrations de schéma
exécutées au premier démarrage sur une base de données neuve.

- **Cloud Run** utilise des sondes HTTP de démarrage et de vivacité ciblant `/health`,
  avec un délai initial de 30 secondes et une fenêtre de démarrage de 30 tentatives.
- **GKE** utilise le même chemin `/health` pour les sondes de démarrage et de vivacité,
  avec la même marge pour les migrations du premier démarrage.

Les chemins des sondes doivent rester sur `/health` (public, sans authentification).
Diriger une sonde vers un chemin authentifié de l'Admin API (`/api/admin/*`) renvoie
401/403, et la révision ou le pod ne devient jamais Ready.

---

## 7. Stockage d'objets {#7-object-storage}

Unleash est **sans état** — toutes les données de flags, de bascules, de stratégies et
d'audit résident dans PostgreSQL. `Unleash_Common` ne déclare donc **aucun** bucket
Cloud Storage (`storage_buckets = []`) et n'active pas NFS. Il n'y a aucun stockage
objet à gérer pour cette application.

---

Pour la configuration propre à Unleash destinée aux utilisateurs (variables par groupe,
sorties, et comment explorer chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[Unleash_GKE](Unleash_GKE.md)** et
**[Unleash_CloudRun](Unleash_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Unleash sur Google Cloud Run](Unleash_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Unleash sur GKE Autopilot](Unleash_GKE.md) — cette configuration déployée sur GKE.
