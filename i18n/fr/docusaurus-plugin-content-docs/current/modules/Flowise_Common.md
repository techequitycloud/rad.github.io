---
title: "Flowise Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Flowise — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Flowise_Common.md @ 15fd4c7 sha256:7a3c03d3f147 -->

# Flowise Common — Configuration d'application partagée {#flowise-common--shared-application-configuration}

`Flowise_Common` est la **couche d'application partagée** pour Flowise. Elle n'est pas
déployée seule ; elle fournit plutôt la configuration spécifique à Flowise sur
laquelle s'appuient [Flowise_GKE](Flowise_GKE.md) et [Flowise_CloudRun](Flowise_CloudRun.md),
de sorte que les deux variantes de plateforme se comportent de manière identique
là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a pas d'entrées d'interface utilisateur de déploiement
propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que
vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Flowise, consultez les guides
de la plateforme ([Flowise_GKE](Flowise_GKE.md), [Flowise_CloudRun](Flowise_CloudRun.md))
et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Flowise_Common | Où cela apparaît |
|---|---|---|
| Identifiant administrateur | Génère le mot de passe administrateur Flowise et le stocke dans **Secret Manager** sous le nom `FLOWISE_PASSWORD` | Récupérer via Secret Manager (voir ci-dessous) |
| Clé de chiffrement des identifiants | Génère la clé avec laquelle Flowise chiffre les identifiants stockés et l'injecte sous le nom `FLOWISE_SECRETKEY_OVERWRITE`, afin que les identifiants enregistrés restent lisibles après le remplacement d'un conteneur | Secret Manager (`secret-<resource_prefix>-flowise-encryption-key`) |
| Image de conteneur | Épingle l'image de base `flowiseai/flowise` et le Dockerfile personnalisé qui l'étend avec `flowise-entrypoint.sh` | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Par défaut **Cloud SQL pour PostgreSQL 15** ; définit `DATABASE_TYPE=postgres` et `DATABASE_PORT=5432` | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement qui crée la base de données, l'utilisateur et accorde les privilèges à l'aide de `postgres:15-alpine` | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de téléchargement **Cloud Storage** (suffixe de nom `-uploads`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Flowise de base : `FLOWISE_USERNAME`, `APIKEY_STORAGE_TYPE=db`, `STORAGE_TYPE=gcs`, `GCLOUD_PROJECT` | Comportement de l'application dans les guides de la plateforme |
| Tests de santé | Fournit le comportement par défaut de la sonde de démarrage et de vivacité ciblant `/api/v1/ping` | §Observabilité dans les guides de la plateforme |

---

## 2. Identifiant administrateur dans Secret Manager {#2-admin-credential-in-secret-manager}

Le mot de passe administrateur Flowise est généré automatiquement sous la forme
d'une chaîne aléatoire de 32 caractères et stocké en tant que secret Secret
Manager — il n'est jamais défini en texte clair. Récupérez-le après le
déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~password"
gcloud secrets versions access latest --secret=<admin-password-secret> --project "$PROJECT"
```

L'ID du secret est formaté comme `secret-<resource_prefix>-flowise-password`. Le mot de passe de la base de données
est généré et géré séparément par la fondation ; son nom de secret est
rapporté dans les sorties de déploiement de la plateforme (`database_password_secret`). Voir
[App_Common](App_Common.md) pour le secret partagé et le modèle Workload Identity.

Un deuxième secret, `secret-<resource_prefix>-flowise-encryption-key`, contient la clé que Flowise
utilise pour chiffrer les clés API et autres identifiants qu'il stocke. Il est
injecté sous le nom `FLOWISE_SECRETKEY_OVERWRITE` ; sans cela, Flowise générerait une nouvelle clé à
chaque remplacement de conteneur et ne pourrait plus déchiffrer les identifiants
enregistrés précédemment.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Flowise nécessite **PostgreSQL** ; le moteur par défaut est PostgreSQL 15. MySQL
n'est pas pris en charge. Lors du premier déploiement, un job unique se connecte
à Cloud SQL via le proxy d'authentification et de manière idempotente :

1. crée la base de données Flowise (si absente),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. accorde à l'utilisateur tous les privilèges sur cette base de données.

Le job exécute `create-db-and-user.sh` depuis le répertoire `scripts/` du module en
utilisant l'image `postgres:15-alpine`. Il peut être relancé en toute sécurité.
Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les
sorties de déploiement de la plateforme.

---

## 4. Paramètres d'application de base {#4-core-application-settings}

`Flowise_Common` établit l'environnement Flowise de base afin que l'application
démarre correctement au premier lancement :

- **Identité administrateur** — le nom d'utilisateur administrateur initial
  (configurable sous le nom `flowise_username` dans le module de la plateforme, Groupe 3).
  Le mot de passe est auto-généré.
- **Câblage de la base de données** — `DATABASE_TYPE=postgres` et `DATABASE_PORT=5432` sont
  toujours injectés. Les valeurs `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_NAME` et
  `DATABASE_PASSWORD` ne sont **pas** définies comme des variables d'environnement
  statiques ; elles sont plutôt mappées au démarrage du conteneur par `flowise-entrypoint.sh`
  à partir des variables `DB_*` injectées par la plateforme. Ceci est
  nécessaire pour gérer l'ordre alphabétique des variables d'environnement de GKE,
  où Kubernetes ne résoudrait pas `$(DB_HOST)` dans `DATABASE_HOST` si `DATABASE_*`
  était déclaré avant `DB_*`.
- **Stockage de fichiers GCS** — `STORAGE_TYPE=gcs`, `APIKEY_STORAGE_TYPE=db` et
  `GCLOUD_PROJECT` sont toujours injectés. Flowise écrit tous les fichiers
  téléchargés par l'utilisateur dans le bucket GCS auto-provisionné dont le nom
  est passé en tant que `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Ne remplacez pas `STORAGE_TYPE` — cela
  entraînerait un retour au disque local éphémère et toutes les
  téléchargements seraient perdus à chaque redémarrage ou nouvelle révision.

---

## 5. Comportement de la sonde de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison de santé dédié de Flowise
`/api/v1/ping`, qui renvoie HTTP 200 lorsque l'application est prête et connectée à
la base de données. Un budget de démarrage généreux permet l'initialisation de la
base de données au premier démarrage :

- **Sonde de démarrage** — HTTP GET `/api/v1/ping`, délai initial de 30 secondes,
  période de 10 secondes, seuil d'échec de 30 (= budget total de 5 minutes).
- **Sonde de vivacité** — HTTP GET `/api/v1/ping`, délai initial de 15 secondes,
  période de 30 secondes, seuil d'échec de 3.

Les variantes GKE et Cloud Run utilisent toutes deux des sondes HTTP pour ces
points de terminaison. Contrairement à certaines applications PHP/Apache qui
émettent des redirections vers le trafic de vérification de santé, Flowise
répond directement sur `/api/v1/ping` sans redirections, de sorte que les sondes HTTP
fonctionnent sur les deux plateformes.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket de téléchargement **Cloud Storage** dédié (suffixe de nom `-uploads`)
est déclaré ici et provisionné par la fondation, qui accorde également l'accès
au compte de service de la charge de travail. Flowise utilise ce bucket comme
backend de stockage de fichiers pour les documents, les images et autres
téléchargements d'utilisateurs. Le nom du bucket est automatiquement injecté
sous le nom `GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Le bucket utilise `STORAGE_CLASS=STANDARD` dans la région de déploiement, avec la
prévention de l'accès public définie sur `inherited`. Des buckets
supplémentaires peuvent être ajoutés via la variable `storage_buckets` dans le module
de la plateforme.

---

Pour la configuration spécifique à Flowise et destinée à l'utilisateur (variables
par groupe, sorties et comment explorer chaque service depuis la Console et la
CLI), consultez les guides de la plateforme : **[Flowise_GKE](Flowise_GKE.md)**
et **[Flowise_CloudRun](Flowise_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Flowise sur Google Cloud Run](Flowise_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Flowise sur GKE Autopilot](Flowise_GKE.md) — cette configuration déployée sur GKE.
