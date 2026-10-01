---
title: "N8N AI Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module N8N AI — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/N8N_AI_Common.md @ 3055034 sha256:7be9ecb40cfd -->

# N8N AI Common — Configuration applicative partagée {#n8n-ai-common--shared-application-configuration}

`N8N_AI_Common` est la **couche applicative partagée** de n8n AI. Elle n'est pas
déployée seule ; elle fournit la configuration propre à n8n sur laquelle s'appuient
[N8N_AI_GKE](N8N_AI_GKE.md) et [N8N_AI_CloudRun](N8N_AI_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune
entrée propre dans l'interface de déploiement —, mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement n8n AI, consultez les guides
des plateformes ([N8N_AI_GKE](N8N_AI_GKE.md), [N8N_AI_CloudRun](N8N_AI_CloudRun.md)) et
les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par N8N_AI_Common | Où cela apparaît |
|---|---|---|
| Secrets | Génère automatiquement `N8N_ENCRYPTION_KEY` (32 caractères) et `N8N_SMTP_PASS` (16 caractères) dans **Secret Manager** | À récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Fixe `n8nio/n8n` et la configuration Cloud Build qui l'étend | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Port du conteneur | Code en dur le port **5678** | Transmis sous la forme `container_port` dans l'output `config` |
| Amorçage de la base de données | Définit le job `db-init` qui crée la base de données, l'utilisateur et les droits | `initialization_jobs` dans l'output `config` |
| Stockage d'objets | Déclare le bucket de données d'IA **Cloud Storage** (suffixe de nom `data`) | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement n8n de base (port, protocole, Redis, type de base de données, URL des webhooks, diagnostics) | Comportement de l'application dans les guides des plateformes |
| Services d'IA compagnons | Configure Qdrant et Ollama comme services supplémentaires dans l'output `config` | Transmis au module socle sous la forme `additional_services` |
| Volume GCS Fuse | Déclare le volume GCS `n8n-data` monté sur `/mnt/gcs`, partagé par n8n, Qdrant et Ollama | Visible dans la configuration des volumes du module socle |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Deux secrets sont générés automatiquement lors du premier déploiement :

| Suffixe de l'ID du secret | Longueur | Caractères spéciaux | Injecté comme variable d'environnement | Rôle |
|---|---|---|---|---|
| `<prefix>-n8nai-encryption-key` | 32 caractères | Oui | `N8N_ENCRYPTION_KEY` | Chiffre au repos tous les identifiants n8n |
| `<prefix>-n8nai-smtp-password` | 16 caractères | Non | `N8N_SMTP_PASS` | Mot de passe SMTP fictif |

**La clé de chiffrement est critique.** Tous les identifiants n8n — clés d'API, jetons
OAuth, mots de passe des workflows — sont chiffrés avec `N8N_ENCRYPTION_KEY`. Si le module
est détruit puis redéployé avec une clé différente, les identifiants existants deviennent
définitivement illisibles. Sauvegardez ce secret avant toute opération de destruction.

Récupérez les secrets après le déploiement :

```bash
# List all secrets to find the correct names
gcloud secrets list --project "$PROJECT" --filter="name~encryption-key"

# Read the encryption key (store securely — treat like a password)
gcloud secrets versions access latest \
  --secret=<prefix>-n8nai-encryption-key \
  --project "$PROJECT"

# Read the SMTP password (replace with real SMTP credentials before enabling email)
gcloud secrets versions access latest \
  --secret=<prefix>-n8nai-smtp-password \
  --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom
de son secret figure dans les outputs du déploiement de la plateforme
(`database_password_secret`).

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

n8n requiert **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en charge.
Lors du premier déploiement, un job ponctuel `db-init` se connecte à Cloud SQL via
l'Auth Proxy et, de manière idempotente :

1. crée la base de données n8n (par défaut : `n8n_db`),
2. crée l'utilisateur de l'application (par défaut : `n8n_user`) avec le mot de passe généré,
3. accorde à l'utilisateur tous les privilèges sur cette base de données.

Le job utilise l'image `postgres:15-alpine`, exécute `scripts/db-init.sh` et se termine
par un arrêt propre du proxy. Il peut être relancé sans risque.

Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=n8n_db --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`N8N_AI_Common` établit l'environnement n8n de base afin que l'application démarre
correctement dès le premier lancement :

- **Port et protocole.** `N8N_PORT = 5678` et `N8N_PROTOCOL = https` sont fixes afin que
  n8n écoute sur le bon port et génère des URL absolues correctes.
- **URL des webhooks et de l'éditeur.** `WEBHOOK_URL` et `N8N_EDITOR_BASE_URL` sont
  définies sur l'URL de service prévue avant la création du service, afin que les webhooks
  fonctionnent sans second apply une fois l'URL connue.
- **Mode file d'attente Redis.** `QUEUE_BULL_REDIS_HOST` et `QUEUE_BULL_REDIS_PORT` sont
  définies lorsque Redis est activé. Si `redis_host` est vide, l'adresse IP du serveur NFS
  est substituée automatiquement à l'exécution grâce au mécanisme `$(NFS_SERVER_IP)`.
- **Type de base de données.** `DB_TYPE = postgresdb` est toujours injecté ; le module socle fournit les autres variables de connexion `DB_POSTGRESDB_*` à partir des outputs
  Cloud SQL.
- **Mode des données binaires.** `N8N_DEFAULT_BINARY_DATA_MODE = filesystem` stocke les
  données binaires des workflows sur le volume persistant GCS Fuse plutôt que dans la base
  de données.
- **Diagnostics.** `N8N_DIAGNOSTICS_ENABLED = true` et `N8N_METRICS = true` exposent la
  santé et les métriques Prometheus sans configuration supplémentaire.

---

## 5. Services d'IA compagnons {#5-ai-companion-services}

Lorsque `enable_ai_components` vaut true, `N8N_AI_Common` injecte deux services
supplémentaires dans la liste `config.additional_services` utilisée par le module socle. Tous deux partagent le volume GCS `n8n-data` monté sur `/mnt/gcs`.

### Qdrant {#qdrant}

| Champ | Valeur |
|---|---|
| Image | `qdrant/qdrant:<qdrant_version>` |
| Port | 6333 |
| CPU | 1000m (1 vCPU) |
| Mémoire | 1Gi |
| Réplicas | 1 (fixe) |
| Entrée | Interne uniquement |
| Chemin de stockage | `/mnt/gcs/qdrant` (via `QDRANT__STORAGE__STORAGE_PATH`) |
| Contrôle de santé | HTTP `GET /readyz` — délai initial de 15s |
| Injecté dans n8n sous la forme | `QDRANT_URL` (renseigné automatiquement par le module socle) |

### Ollama {#ollama}

| Champ | Valeur |
|---|---|
| Image | `ollama/ollama:<ollama_version>` |
| Port | 11434 |
| CPU | Hérité de `cpu_limit` (par défaut : `2000m`) |
| Mémoire | Hérité de `memory_limit` (par défaut : `4Gi`) |
| Réplicas | 1 (fixe) |
| Entrée | Interne uniquement |
| Chemin des modèles | `/mnt/gcs/ollama/models` (via `OLLAMA_MODELS`) |
| Contrôle de santé | HTTP `GET /` — délai initial de 20s |
| Injecté dans n8n sous la forme | `OLLAMA_HOST` (renseigné automatiquement par le module socle) |

Les deux services sont supprimés lorsque `enable_ai_components = false` ou lorsque leur
interrupteur respectif (`enable_qdrant`, `enable_ollama`) est défini sur `false`.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié avec le suffixe de nom `data` est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la charge
de travail. Le bucket sert de stockage sous-jacent aux volumes GCS Fuse partagés par les
trois services. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~n8n"
```

---

Pour la configuration propre à n8n AI et destinée aux utilisateurs (variables par groupe,
outputs et manière d'explorer chaque service depuis la console et la CLI), consultez les
guides des plateformes :
**[N8N_AI_GKE](N8N_AI_GKE.md)** et **[N8N_AI_CloudRun](N8N_AI_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [N8N AI sur Cloud Run](N8N_AI_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [N8N AI sur GKE Autopilot](N8N_AI_GKE.md) — cette configuration déployée sur GKE.
