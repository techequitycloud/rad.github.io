---
title: "AnythingLLM Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module AnythingLLM — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/AnythingLLM_Common.md @ 3055034 sha256:cf8b4927d5ee -->

# AnythingLLM Common — Configuration applicative partagée {#anythingllm-common--shared-application-configuration}

`AnythingLLM_Common` est la **couche applicative partagée** d'AnythingLLM. Elle n'est pas
déployée seule ; elle fournit la configuration propre à AnythingLLM sur laquelle
s'appuient à la fois [AnythingLLM_GKE](AnythingLLM_GKE.md) et
[AnythingLLM_CloudRun](AnythingLLM_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle ne possède aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement AnythingLLM, consultez les
guides des plateformes ([AnythingLLM_GKE](AnythingLLM_GKE.md),
[AnythingLLM_CloudRun](AnythingLLM_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par AnythingLLM_Common | Où cela apparaît |
|---|---|---|
| Secrets applicatifs | Génère et stocke quatre secrets — `JWT_SECRET`, `AUTH_TOKEN`, `SIG_KEY`, `SIG_SALT` — dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image Node.js d'AnythingLLM et le pipeline Cloud Build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Amorçage de la base de données | Définit le job `db-init` qui crée la base de données et l'utilisateur avant le démarrage de l'application | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de documents **Cloud Storage** `anythingllm-docs` ; injecte son nom sous `GOOGLE_CLOUD_STORAGE_BUCKET_NAME` | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement d'exécution de référence d'AnythingLLM (`SERVER_PORT`, `STORAGE_DIR`, `UID`, `GID`) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les valeurs par défaut des sondes de démarrage et de liveness HTTP `/api/ping`, avec un délai initial étendu pour le chargement des modèles d'IA | Section Observabilité des guides des plateformes |

---

## 2. Secrets applicatifs dans Secret Manager {#2-application-secrets-in-secret-manager}

Quatre secrets applicatifs d'AnythingLLM sont générés automatiquement lors du premier
déploiement et stockés dans Secret Manager — leur valeur en clair n'apparaît jamais dans
la configuration ni dans l'état Terraform.

| Secret | Variable d'environnement | Rôle |
|---|---|---|
| `<prefix>-jwt-secret` | `JWT_SECRET` | Signe tous les jetons d'authentification d'AnythingLLM. À considérer comme immuable après la première connexion d'un utilisateur — sa rotation déconnecte immédiatement tous les utilisateurs. |
| `<prefix>-auth-token` | `AUTH_TOKEN` | Jeton bearer d'API facultatif pour l'accès REST programmatique. Laissez-le vide pour vous appuyer uniquement sur l'authentification au niveau de l'application. |
| `<prefix>-sig-key` | `SIG_KEY` | Clé de signature HMAC pour les signatures de requêtes (32 caractères alphanumériques). |
| `<prefix>-sig-salt` | `SIG_SALT` | Sel utilisé avec `SIG_KEY` pour les signatures HMAC (32 caractères alphanumériques). |

Récupérez n'importe quel secret après le déploiement :

```bash
# List all secrets associated with the deployment:
gcloud secrets list --project "$PROJECT" --filter="name~anythingllm"
# Read a specific secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Le mot de passe de base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les sorties du déploiement de la plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le modèle partagé de
secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

AnythingLLM nécessite **PostgreSQL 15** via son ORM Prisma ; le moteur est fixe et MySQL
n'est pas pris en charge. Lors du premier déploiement, un job ponctuel `db-init` se
connecte à Cloud SQL via l'Auth Proxy et, de façon idempotente :

1. crée l'utilisateur de base de données d'AnythingLLM avec le mot de passe généré,
2. crée la base de données de l'application (si elle n'existe pas),
3. accorde à l'utilisateur tous les privilèges sur cette base de données.

Le script de point d'entrée construit ensuite la chaîne de connexion Prisma
`DATABASE_URL` à partir des variables d'environnement `DB_*` au démarrage du conteneur,
et fonctionne correctement aussi bien avec un socket Unix (Cloud Run) qu'avec une
connexion TCP (GKE).

Le job peut être réexécuté sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`AnythingLLM_Common` établit l'environnement d'exécution de référence d'AnythingLLM afin
que l'application démarre correctement dès le premier lancement :

- **`SERVER_PORT = 3001`** — port HTTP natif d'AnythingLLM. Doit correspondre à
  `container_port`.
- **`STORAGE_DIR = /app/server/storage`** — valeur par défaut propre à
  `AnythingLLM_Common` pour le répertoire où AnythingLLM stocke tous les documents de
  l'espace de travail, les index vectoriels et les pièces jointes des conversations.
  **Les deux modules de plateforme appelants remplacent cette valeur**, non pas via
  `environment_variables` mais via leurs propres `module_env_vars`, par le chemin de
  montage NFS (`nfs_mount_path`, par défaut `/mnt/nfs`) dès que `enable_nfs = true` — ce
  qui est la valeur par défaut à la fois sur `AnythingLLM_CloudRun` et sur
  `AnythingLLM_GKE`. Le `STORAGE_DIR` effectif d'un déploiement est donc le chemin NFS,
  sauf si `enable_nfs` est explicitement défini sur `false` ; cela maintient l'index
  vectoriel LanceDB d'AnythingLLM hors du disque éphémère, où il serait sinon effacé
  silencieusement à chaque démarrage à froid / redémarrage de pod / redéploiement.
- **`UID = 1000` / `GID = 1000`** — identifiants d'utilisateur et de groupe du
  conteneur. La valeur par défaut `fsGroup = 1000` de la configuration StatefulSet de GKE
  correspond à ces identifiants, afin que le volume soit accessible en écriture dès son
  rattachement.
- **`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`** — définie automatiquement à partir du bucket
  `anythingllm-docs` provisionné, afin qu'AnythingLLM puisse utiliser GCS comme backend
  de stockage des documents.

Ne remplacez pas `SERVER_PORT`, `UID` ni `GID` via `environment_variables` dans le
module de plateforme — ils sont définis ici et fusionnés avant d'être transmis au socle. `STORAGE_DIR` est la seule exception : il EST remplacé, par les propres
`module_env_vars` des modules de plateforme et non par `environment_variables`, dès que
`enable_nfs = true` (voir ci-dessus).

### Processus collector (téléversement de fichiers) {#collector-process-file-uploads}

`anythingllm-entrypoint.sh` démarre le processus **collector** distinct d'AnythingLLM —
qui gère les téléversements de fichiers (PDF/HTML/docx via
`POST /api/v1/document/upload`) — avec `( cd /app/collector && exec node index.js )`. Le
collector résout son `hotdir` (où le serveur dépose un fichier téléversé pour analyse)
par rapport à son propre répertoire de travail ; il doit donc démarrer depuis
`/app/collector`, comme le fait le `docker-entrypoint.sh` amont. Le démarrer depuis
`/app/server` (le répertoire courant laissé par les étapes de migration Prisma
précédentes) fait échouer chaque téléversement de fichier avec
`ENOENT: .../collector/hotdir/<file>` alors même que le service se déclare en bonne
santé — les téléversements de texte brut (`/document/raw-text`) passent directement par
le serveur et ne sont pas concernés.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes de démarrage et de liveness ciblent toutes deux `/api/ping` en HTTP.
Contrairement aux applications PHP/Apache qui redirigent le trafic de santé HTTP, le
serveur Node.js d'AnythingLLM répond directement aux sondes HTTP sur ce chemin ; aucun
repli TCP n'est donc nécessaire, quelle que soit la plateforme.

- **GKE et Cloud Run** utilisent tous deux des sondes HTTP ciblant `/api/ping`.
- La **sonde de démarrage** utilise un délai initial de 60 secondes et jusqu'à 30
  périodes d'échec (×10 secondes chacune = 5 minutes au total) pour tenir compte du
  chargement des modèles d'IA et de la migration Prisma d'AnythingLLM au premier
  démarrage.
- La **sonde de liveness** utilise un délai initial de 30 secondes et un seuil de 3
  échecs, ce qui permet un redémarrage rapide si l'application cesse de répondre après
  son démarrage.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket de documents **Cloud Storage** dédié (avec le suffixe `anythingllm-docs`) est
déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de
service de la charge de travail. Le nom du bucket est injecté automatiquement sous
`GOOGLE_CLOUD_STORAGE_BUCKET_NAME`. Associé aux PVC de StatefulSet ou à un volume NFS
Filestore, cela offre à AnythingLLM un stockage durable des documents qui survit aux
redémarrages d'instances. Listez les buckets avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration d'AnythingLLM destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[AnythingLLM_GKE](AnythingLLM_GKE.md)** et
**[AnythingLLM_CloudRun](AnythingLLM_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [AnythingLLM sur Google Cloud Run](AnythingLLM_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [AnythingLLM sur GKE Autopilot](AnythingLLM_GKE.md) — cette configuration déployée sur GKE.
