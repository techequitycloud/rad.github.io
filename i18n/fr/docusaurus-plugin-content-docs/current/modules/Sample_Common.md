---
title: "Sample Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Sample — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Sample_Common.md @ 15fd4c7 sha256:d915d49296b7 -->

# Sample Common — Configuration d'application partagée {#sample-common--shared-application-configuration}

`Sample_Common` est la **couche d'application partagée** pour le module Sample. Il n'est
pas déployé seul ; il fournit plutôt la configuration spécifique à Sample sur laquelle
[Sample_GKE](Sample_GKE.md) et [Sample_CloudRun](Sample_CloudRun.md) se basent, afin que
les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent
jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce
qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement l'application Sample, consultez les
guides de la plateforme ([Sample_GKE](Sample_GKE.md), [Sample_CloudRun](Sample_CloudRun.md))
et les guides de la fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Sample_Common | Où cela apparaît |
|---|---|---|
| Clé secrète Flask | Génère une `SECRET_KEY` aléatoire de 32 caractères et la stocke dans **Secret Manager** | Injectée comme variable d'environnement `SECRET_KEY` à l'exécution |
| Image de conteneur | Construit une image personnalisée **Python 3.11-slim / Gunicorn** à partir du Dockerfile fourni via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` de premier déploiement qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare aucun bucket GCS supplémentaire (`storage_buckets = []`) | Aucun bucket supplémentaire au-delà de ce que vous configurez dans le module de la plateforme |
| Paramètres de base | Définit `container_port = 8080`, `FLASK_ENV = production`, les sondes de démarrage et de vivacité pointant vers `/healthz` | Comportement de l'application dans les guides de la plateforme |
| Sidecar Redis | Lorsque `enable_redis = true`, ajoute un service `redis:alpine` à `additional_services` | Un service Redis interne déployé aux côtés de l'application Flask |

---

## 2. Clé secrète Flask `SECRET_KEY` dans Secret Manager {#2-flask-secret_key-in-secret-manager}

La clé secrète Flask `SECRET_KEY` est générée automatiquement (32 caractères, alphanumériques, sans
caractères spéciaux) et stockée en tant que secret Secret Manager. Elle n'est jamais définie en texte clair.
Récupérez-la après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

Le secret est directement câblé dans le conteneur de l'application au démarrage via la
variable d'environnement `SECRET_KEY`. Le mot de passe de la base de données est généré et géré
séparément par la fondation ; son nom de secret est indiqué dans les sorties de déploiement de la plateforme
(`database_password_secret`). Voir [App_Common](App_Common.md) pour le secret partagé
et le modèle Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

L'application Sample nécessite **PostgreSQL 15** ; le moteur est fixé à `POSTGRES_15`
et MySQL n'est pas pris en charge. Lors du premier déploiement, un job `db-init` unique exécute
`db-init.sh` en utilisant l'image `postgres:15-alpine` et de manière idempotente :

1. Détecte le socket Unix du proxy d'authentification Cloud SQL sous `/cloudsql` et le mappe à
   `/tmp/.s.PGSQL.5432`.
2. Attend que PostgreSQL accepte les connexions via `pg_isready`.
3. Crée l'utilisateur de l'application (ou met à jour le mot de passe s'il existe déjà).
4. Accorde le rôle d'utilisateur à `postgres` (requis pour Cloud SQL où `postgres` n'est pas un
   véritable superutilisateur).
5. Crée la base de données de l'application avec l'utilisateur comme propriétaire, ou met à jour le propriétaire si la
   base de données existe déjà.
6. Accorde tous les privilèges sur la base de données à l'utilisateur de l'application.
7. Signale au proxy d'authentification Cloud SQL de s'arrêter via `POST http://127.0.0.1:9091/quitquitquit`.

Le job peut être relancé en toute sécurité. Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms d'instance, de base de données et d'utilisateur se trouvent dans les sorties de déploiement de la plateforme.

---

## 4. Image de conteneur et application Flask {#4-container-image-and-flask-application}

`Sample_Common` construit une image personnalisée à partir de `scripts/Dockerfile` en utilisant `python:3.11-slim`
comme base. L'image s'exécute en tant qu'utilisateur non-root (`appuser`) et démarre Gunicorn lié au
port `8080` avec 1 worker et 8 threads.

L'application Flask fournie (`app.py`) démontre tous les modèles d'intégration :

- **`GET /`** — incrémente un compteur de visiteurs PostgreSQL et suit éventuellement les
  visites par session via Redis si `enable_redis = true` et `REDIS_HOST` sont définis.
- **`GET /healthz`** — renvoie `{"status": "healthy"}` immédiatement sans requête de base de données.
  Utilisé par les sondes de démarrage et de vivacité.
- **`GET /whoami`** — renvoie la requête telle que le conteneur la voit : `remote_addr`,
  `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto`, `Forwarded`, et les *noms*
  d'en-tête (jamais les valeurs) que le frontal de la plateforme fournit. Non authentifié et
  en lecture seule ; utile pour vérifier si une liste d'adresses IP autorisées au niveau de l'application ou un limiteur de débit peut
  voir l'adresse IP réelle du client.
- **`GET /db`** — exécute `SELECT version()` et renvoie la chaîne de version PostgreSQL.
  Utile pour vérifier la connectivité de la base de données de bout en bout après le déploiement.

L'application lit les détails de connexion à partir des variables d'environnement standard
(`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`) et prend en charge les
connexions par socket Unix (Auth Proxy) et les connexions TCP.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les deux sondes ciblent le point de terminaison `/healthz`, qui est léger et ne touche pas la
base de données :

| Sonde | Type | Chemin / Port | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `GET /healthz` | 10 s | 10 s | 3 |
| Vivacité | HTTP | `GET /healthz` | 15 s | 30 s | 3 |

**Ajustements spécifiques à la plateforme :**

- **GKE** utilise des sondes HTTP — le trafic de sonde intra-cluster atteint directement le conteneur.
- **Cloud Run** remplace la sonde de démarrage par TCP (port 8080) car le trafic de santé de Cloud Run
  peut être soumis à des restrictions d'entrée ; la sonde TCP vérifie uniquement que le port
  est ouvert, ce qui est suffisant pour autoriser le trafic au démarrage.

---

## 6. Sidecar Redis {#6-redis-sidecar}

Lorsque `enable_redis = true`, un service interne `redis:alpine` est ajouté à
`additional_services`. L'application Flask utilise `Flask-Session` avec un backend Redis lorsque
`ENABLE_REDIS=true` et `REDIS_HOST` ne sont pas vides. Lorsque `REDIS_HOST` est vide, un
avertissement est enregistré et l'application revient aux sessions basées sur les cookies.

**Le comportement diffère entre les plateformes :**

- **GKE** — lorsque `redis_host` est vide, `REDIS_HOST` est automatiquement défini sur `127.0.0.1`
  (le sidecar Redis s'exécute dans le même réseau de pods). Pour une instance Redis externe
  telle que Cloud Memorystore, définissez `redis_host` explicitement sur l'adresse IP privée de l'instance.
- **Cloud Run** — il n'y a pas de repli automatique. `redis_host` doit toujours être défini
  explicitement sur l'URL interne du service Redis Cloud Run ou une adresse IP Memorystore.

Inspectez le sidecar Redis :

```bash
# GKE
kubectl get deployments -n "$NAMESPACE"
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- redis-cli -h 127.0.0.1 ping

# Cloud Run
gcloud run services list --project "$PROJECT" --region "$REGION"
```

---

## 7. Stockage d'objets {#7-object-storage}

`Sample_Common` ne déclare aucun bucket GCS supplémentaire (`storage_buckets = []`). Tous les
buckets provisionnés pour un déploiement Sample proviennent de la variable `storage_buckets`
que vous configurez dans le module de la plateforme (par défaut : un bucket avec `name_suffix = "data"`).
Listez les buckets déployés avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration spécifique à Sample et destinée à l'utilisateur (variables par groupe, sorties, et comment
explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme :
**[Sample_GKE](Sample_GKE.md)** et **[Sample_CloudRun](Sample_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Application Sample sur Google Cloud Run](Sample_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Application Sample sur GKE Autopilot](Sample_GKE.md) — cette configuration déployée sur GKE.
