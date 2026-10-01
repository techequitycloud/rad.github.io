---
title: "N8N Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module N8N — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/N8N_Common.md @ 3055034 sha256:1309a61d7ca8 -->

# N8N Common — Configuration applicative partagée {#n8n-common--shared-application-configuration}

`N8N_Common` est la **couche applicative partagée** de n8n. Elle n'est pas déployée seule ;
elle fournit la configuration propre à n8n sur laquelle s'appuient à la fois
[N8N_GKE](N8N_GKE.md) et [N8N_CloudRun](N8N_CloudRun.md), afin que les deux variantes de
plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de
déploiement —, mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement n8n, consultez les guides des
plateformes ([N8N_GKE](N8N_GKE.md), [N8N_CloudRun](N8N_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par N8N_Common | Où cela apparaît |
|---|---|---|
| Clé de chiffrement | Génère `N8N_ENCRYPTION_KEY` (32 caractères) et la stocke dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Valeur provisoire SMTP | Génère un `N8N_SMTP_PASS` factice (16 caractères) pour initialiser l'emplacement du secret | À mettre à jour dans Secret Manager avec le vrai mot de passe avant d'envoyer des e-mails |
| Image de conteneur | Épingle l'image officielle de n8n et la configuration Cloud Build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | § Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket de données **Cloud Storage** | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement de base de n8n (port, protocole, mode des données binaires, URL des webhooks, câblage de la file d'attente Redis) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit le comportement par défaut des sondes de démarrage et de vivacité | § Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager — aucun n'est jamais
défini en clair.

**Clé de chiffrement** (`N8N_ENCRYPTION_KEY`) : une clé aléatoire de 32 caractères qui chiffre
tous les identifiants des workflows (clés d'API, mots de passe, jetons OAuth) stockés dans la
base de données. Récupérez-la après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key"
gcloud secrets versions access latest --secret=<encryption-key-secret> --project "$PROJECT"
```

**Mot de passe SMTP** (`N8N_SMTP_PASS`) : initialisé avec une valeur factice de 16 caractères
au moment du provisionnement. Remplacez-le par le véritable identifiant avant de configurer n8n
pour envoyer des e-mails :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~smtp-password"
echo -n "my-real-smtp-password" | \
  gcloud secrets versions add <smtp-secret-name> --data-file=- --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de
son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé des
secrets et de Workload Identity.

> **Important :** `N8N_ENCRYPTION_KEY` ne doit jamais faire l'objet d'une rotation ni être
> modifiée après le premier déploiement. Tous les identifiants des workflows sont chiffrés avec
> cette clé — la modifier supprime l'accès à chaque identifiant enregistré.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

n8n requiert **PostgreSQL 15** ; le moteur est imposé et aucun autre type de base de données
n'est pris en charge. Lors du premier déploiement, un job ponctuel (`db-init`) se connecte à
Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée la base de données n8n (si elle n'existe pas),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. accorde à cet utilisateur tous les privilèges sur cette base de données.

Le job peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du
déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`N8N_Common` établit l'environnement de base de n8n afin que l'application démarre
correctement dès le premier lancement :

- **Port et protocole** — n8n écoute sur le port `5678` ; `N8N_PROTOCOL` est défini à
  `https` pour correspondre au frontal équilibré.
- **Mode des données binaires** — `N8N_DEFAULT_BINARY_DATA_MODE=filesystem` stocke les
  fichiers binaires (pièces jointes, sorties de workflows) sur le système de fichiers monté en
  NFS plutôt que dans la base de données, ce qui est requis pour les déploiements
  multi-réplicas.
- **URL des webhooks** — `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont définis sur l'URL prévue
  du service au moment du déploiement. Les webhooks enregistrés dans n8n utilisent cette URL
  comme base ; si l'URL change (ajout d'un domaine personnalisé, service recréé), la charge de
  travail doit être redéployée pour mettre à jour ces valeurs.
- **Câblage de la file d'attente Redis** — lorsque Redis est activé, `QUEUE_BULL_REDIS_HOST`
  est défini sur le `redis_host` explicite s'il est fourni, ou sinon sur la valeur provisoire
  d'exécution `$(NFS_SERVER_IP)`. Le script `entrypoint.sh` remplace cette valeur provisoire
  par l'IP réelle du serveur NFS au démarrage du conteneur.

Ajustements propres à chaque plateforme gérés ici :

- **GKE** définit `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sur l'URL du service GKE connue au
  moment du plan ; `entrypoint.sh` les remplace par `GKE_SERVICE_URL` à l'exécution si cette
  variable est présente.
- **Cloud Run** définit ces valeurs à partir de l'URL prévue du service `run.app`, calculée
  avant l'apply.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les variables `startup_probe`/`liveness_probe` propres à `N8N_Common` ciblent par défaut le
point de terminaison de contrôle de santé non authentifié de n8n, `/healthz`, avec un délai
initial de démarrage de 10 secondes et un délai initial de vivacité de 15 secondes (voir le
tableau « Health Probe Defaults » dans `N8N_Common/README.md`).

Les modules de variante `N8N_CloudRun` et `N8N_GKE` remplacent ces valeurs par défaut dans
leur propre `variables.tf` et ciblent plutôt le chemin racine de n8n (`/`), avec un délai
initial de démarrage de 120 secondes et un délai initial de vivacité de 30 secondes — assez
long pour que la configuration de la base de données au premier démarrage et la migration du
schéma se terminent avant l'évaluation de la sonde. `/` ne renvoie HTTP 200 qu'une fois
l'application entièrement initialisée et la connexion à la base de données établie.

n8n n'effectue aucune redirection HTTP→HTTPS sur l'un ou l'autre chemin de sonde de santé.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket de données **Cloud Storage** dédié est déclaré ici et provisionné par le socle, qui
accorde également l'accès au compte de service de la charge de travail. Combiné au volume
Filestore (NFS) (lorsque `enable_nfs = true`), il offre à n8n un stockage durable des données
des workflows, cohérent entre toutes les instances. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à n8n destinée aux utilisateurs (variables par groupe, sorties et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides des
plateformes : **[N8N_GKE](N8N_GKE.md)** et **[N8N_CloudRun](N8N_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [n8n sur Google Cloud Run](N8N_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [n8n sur GKE Autopilot](N8N_GKE.md) — cette configuration déployée sur GKE.
