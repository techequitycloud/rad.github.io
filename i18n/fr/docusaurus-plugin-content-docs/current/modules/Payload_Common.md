---
title: "Payload Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module Payload CMS — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Payload_Common.md @ 3055034 sha256:ef777815c59b -->

# Payload Common — Configuration applicative partagée {#payload-common--shared-application-configuration}

`Payload_Common` est la **couche applicative partagée** de Payload CMS. Elle
n'est pas déployée seule ; elle fournit la configuration propre à Payload sur laquelle s'appuient
[Payload_GKE](Payload_GKE.md) et
[Payload_CloudRun](Payload_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais
cette couche directement — elle ne possède aucun champ de saisie propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Payload, consultez les
guides de plateforme ([Payload_GKE](Payload_GKE.md),
[Payload_CloudRun](Payload_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Payload_Common | Où cela apparaît |
|---|---|---|
| Secret | Génère `PAYLOAD_SECRET` (chaîne aléatoire de 32 caractères) et le stocke dans **Secret Manager** | Injecté automatiquement ; récupérable via Secret Manager (voir ci-dessous) |
| Image de conteneur | Construit une véritable application de démarrage Payload à partir des sources via Cloud Build — il n'existe **aucune image upstream** à encapsuler | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Initialisation de la base de données | Définit deux jobs séquentiels de premier déploiement : `db-init` (création du rôle et de la base) et `payload-migrate` (migration du schéma via la CLI `payload`) | Sortie `initialization_jobs` |
| Stockage d'objets | Aucun — la sortie `storage_buckets` est une liste vide statique | N/A |
| Paramètres de base | Définit le port du conteneur (3000), le nom et l'utilisateur de la base, les limites de ressources | Comportement de l'application dans les guides de plateforme |
| Vérifications d'état | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/admin` | §Observabilité dans les guides de plateforme |

---

## 2. Image de conteneur : construction à partir des sources, sans encapsuler une image fournisseur {#2-container-image-building-from-source-not-wrapping-a-vendor-image}

Payload n'a **aucune image Docker officielle upstream** — ce que confirme la propre
documentation de Payload, qui ne fournit que des exemples de Dockerfile destinés à être adaptés dans un vrai projet.
Toutes les autres couches applicatives de ce catalogue encapsulent une image fournisseur téléchargeable ; `Payload_Common`
construit à la place une véritable application, vérifiée localement, à partir des sources
(`image_source = "custom"`, `container_image = ""`) :

- **`scripts/`** est une véritable application Next.js/Payload compilable — un modèle vierge
  généré avec la CLI officielle `create-payload-app`, configuré avec l'**adaptateur
  PostgreSQL** (`@payloadcms/db-postgres`) au lieu de l'adaptateur MongoDB par défaut de Payload, afin de correspondre
  au provisionnement Cloud SQL Postgres standard de ce catalogue. Elle embarque **Next.js 16, Payload
  3.86.0, React 19, sur Node 22**.
- **`scripts/Dockerfile`** est un build multi-étapes (`deps` → `builder` → `runner`) qui corrige deux
  vrais bugs découverts dans le modèle/Dockerfile officiel lors de la construction de ce module :
  1. Le fichier `next.config.ts` généré ne définit pas `output: 'standalone'` par défaut, alors que le
     Dockerfile officiel suppose que la sortie de build standalone existe.
  2. `npm ci` échoue avec des erreurs de cohérence du fichier de verrouillage lorsque celui-ci a été généré sous macOS mais
     que le build s'exécute sous Linux/alpine — le Dockerfile utilise `npm install` à la place.
  Troisième correctif : le modèle vierge ne contient aucun répertoire `public/`, mais l'instruction `COPY
  --from=builder /app/public` de l'étape runner en attend un sans condition — l'étape builder exécute d'abord `mkdir -p
  public`.
- L'étape runner conserve **deux copies** de l'application : la sortie **standalone** allégée de Next.js
  (suffisante pour servir le trafic HTTP) et une seconde copie complète de `node_modules` + `src/` sous
  `/app/cli`, utilisée exclusivement par le job d'initialisation `payload-migrate`, qui a besoin de la CLI Payload et
  de son chargeur TypeScript (`tsx`) — aucun des deux n'étant inclus dans la trace standalone.

Inspecter les builds récents :

```bash
gcloud builds list --project "$PROJECT" --limit=10
gcloud builds log <build-id> --project "$PROJECT"
```

---

## 3. Secret dans Secret Manager {#3-secret-in-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager — il n'est jamais défini en texte
clair et ne doit pas faire l'objet d'une rotation à la légère :

- **`PAYLOAD_SECRET`** — une chaîne alphanumérique aléatoire de 32 caractères. Payload la lit sous la forme
  `process.env.PAYLOAD_SECRET` dans `payload.config.ts` pour signer ses propres jetons de session/d'authentification.
  Effectuer sa rotation après le premier démarrage invalide toutes les sessions actives et oblige tous les utilisateurs à se reconnecter.

Récupérer le secret après le déploiement :

```bash
# List the secret for this deployment (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~-secret"

# Read the secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret est
indiqué dans les sorties du déploiement de plateforme (`database_password_secret`). Consultez
[App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity.

Une ressource `time_sleep` de 30 secondes garantit que la réplication Secret Manager est terminée avant que le service
ou les pods ne tentent de lire `PAYLOAD_SECRET`.

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Payload nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15`. Contrairement à de nombreuses applications de ce
catalogue, l'adaptateur Postgres de Payload ne crée **pas** son schéma au démarrage en production —
ce qui a été confirmé localement : démarrer le serveur compilé sur une base de données neuve et vide n'a créé aucune table.
Le schéma n'apparaît que via `payload migrate`, qui requiert un fichier de migration déjà généré et intégré
à l'image (`src/migrations/*.ts`, généré une fois via `payload migrate:create` puis
commité).

Deux jobs séquentiels s'exécutent par défaut :

1. **`db-init`** (`postgres:15-alpine`) — se connecte via le socket Unix du Cloud SQL Auth Proxy
   et crée de manière idempotente le rôle et la base de données de l'application.
2. **`payload-migrate`** (`depends_on_jobs = ["db-init"]`, utilise l'image de l'application déployée
   elle-même) — exécute `./node_modules/.bin/payload migrate` depuis la copie `/app/cli` de l'arborescence complète
   des dépendances et des sources. Une fois les migrations terminées, il signale au sidecar Cloud SQL Auth Proxy
   de s'arrêter (`quitquitquit` sur Cloud Run, `http://localhost:9091/quitquitquit` sur le
   sidecar natif de GKE).

Le job peut être réexécuté sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de plateforme.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes par défaut ciblent **`/admin`** — la route de l'interface d'administration de Payload, qui renvoie un
`200` sans authentification (elle sert le formulaire de connexion/de création du premier utilisateur) dès que le serveur Node.js et
la connexion à la base de données sont prêts. Les véritables routes d'API REST/GraphQL de Payload exigent une authentification et
renverraient 401/403 à une sonde ; la racine `/` renvoie aussi `200` mais dépend du contenu de l'application, ce qui fait de `/admin` le
choix le plus stable.

- Sonde de démarrage **Cloud Run** : HTTP `/admin`, délai initial de 20 s, période de 10 s, 10 tentatives (valeurs par défaut de
  `Payload_CloudRun` — consultez son guide de configuration pour les valeurs exactes en vigueur).
- Sonde de démarrage **GKE** : HTTP `/admin`, délai initial de 30 s (valeurs par défaut de `Payload_GKE`).

Prévoyez plusieurs minutes au premier démarrage pour que le job `payload-migrate` termine la mise en place du schéma avant
que le service ne soit censé servir du contenu réel.

---

## 6. Stockage d'objets {#6-object-storage}

`Payload_Common` ne provisionne **aucun bucket de stockage**. La sortie `storage_buckets` est une liste vide
statique, quelle que soit l'entrée du module applicatif ; les médias téléversés dans l'application de démarrage fournie
sont donc écrits sur le disque local du conteneur et ne sont **pas** conservés lors d'un redémarrage de pod ou d'un redéploiement :

```bash
gcloud storage buckets list --project "$PROJECT"   # no Payload-specific bucket will be listed
```

Pour rendre les téléversements de médias durables, ajoutez un adaptateur de stockage (par exemple un adaptateur compatible S3 pointant vers un
bucket GCS) à l'application dans `scripts/`.

---

Pour la configuration propre à Payload et destinée aux utilisateurs (variables par groupe, sorties, et comment
explorer chaque service depuis la Console et la CLI), consultez les guides de plateforme :
**[Payload_GKE](Payload_GKE.md)** et **[Payload_CloudRun](Payload_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Payload CMS sur Google Cloud Run](Payload_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Payload CMS sur GKE Autopilot](Payload_GKE.md) — cette configuration déployée sur GKE.
