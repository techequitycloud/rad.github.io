---
title: "Sample Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Sample — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Sample_Common.md @ 3055034 sha256:4d90982a440f -->

# Sample Common — Configuration applicative partagée {#sample-common--shared-application-configuration}

`Sample_Common` est la **couche applicative partagée** du module Sample. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Sample sur laquelle s'appuient
[Sample_GKE](Sample_GKE.md) et [Sample_CloudRun](Sample_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune
entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement l'application Sample,
consultez les guides des plateformes ([Sample_GKE](Sample_GKE.md),
[Sample_CloudRun](Sample_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md),
[App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Sample_Common | Où cela apparaît |
|---|---|---|
| Clé secrète Flask | Génère un `SECRET_KEY` aléatoire de 32 caractères et le stocke dans **Secret Manager** | Injecté en tant que variable d'environnement `SECRET_KEY` à l'exécution |
| Image de conteneur | Construit une image personnalisée **Python 3.11-slim / Gunicorn** à partir du Dockerfile fourni, via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit la tâche `db-init` du premier déploiement, qui crée la base de données, l'utilisateur et les droits | Sortie `initialization_jobs` |
| Stockage d'objets | Ne déclare aucun bucket GCS supplémentaire (`storage_buckets = []`) | Aucun bucket supplémentaire au-delà de ceux que vous configurez dans le module de plateforme |
| Paramètres de base | Définit `container_port = 8080`, `FLASK_ENV = production`, ainsi que des sondes de démarrage et de vivacité pointant vers `/healthz` | Comportement de l'application dans les guides des plateformes |
| Sidecar Redis | Lorsque `enable_redis = true`, ajoute un service `redis:alpine` à `additional_services` | Un service Redis interne déployé aux côtés de l'application Flask |

---

## 2. `SECRET_KEY` Flask dans Secret Manager {#2-flask-secret_key-in-secret-manager}

Le `SECRET_KEY` Flask est généré automatiquement (32 caractères alphanumériques, sans
caractères spéciaux) et stocké sous forme de secret Secret Manager. Il n'est jamais défini
en clair. Récupérez-le après le déploiement :

```bash
# The secret name follows the deployment's resource prefix; list and read it:
gcloud secrets list --project "$PROJECT" --filter="name~secret-key"
gcloud secrets versions access latest --secret=<secret-key-secret> --project "$PROJECT"
```

Le secret est transmis directement au conteneur de l'application au démarrage via la
variable d'environnement `SECRET_KEY`. Le mot de passe de la base de données est généré et
géré séparément par le socle ; le nom de son secret figure dans les sorties du déploiement
de la plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour
le modèle partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et initialisation {#3-database-engine-and-bootstrap}

L'application Sample nécessite **PostgreSQL 15** ; le moteur est fixé à `POSTGRES_15` et
MySQL n'est pas pris en charge. Au premier déploiement, une tâche ponctuelle `db-init`
exécute `db-init.sh` avec l'image `postgres:15-alpine` et, de manière idempotente :

1. Détecte le socket Unix du Cloud SQL Auth Proxy sous `/cloudsql` et le fait
   correspondre à `/tmp/.s.PGSQL.5432`.
2. Attend que PostgreSQL accepte les connexions via `pg_isready`.
3. Crée l'utilisateur de l'application (ou met à jour son mot de passe s'il existe déjà).
4. Accorde le rôle de l'utilisateur à `postgres` (nécessaire sur Cloud SQL, où `postgres`
   n'est pas un véritable superutilisateur).
5. Crée la base de données de l'application avec l'utilisateur comme propriétaire, ou met
   à jour le propriétaire si la base de données existe déjà.
6. Accorde tous les privilèges sur la base de données à l'utilisateur de l'application.
7. Signale au Cloud SQL Auth Proxy de s'arrêter via `POST http://127.0.0.1:9091/quitquitquit`.

La tâche peut être relancée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties
du déploiement de la plateforme.

---

## 4. Image de conteneur et application Flask {#4-container-image-and-flask-application}

`Sample_Common` construit une image personnalisée à partir de `scripts/Dockerfile` en
utilisant `python:3.11-slim` comme base. L'image s'exécute sous un utilisateur non root
(`appuser`) et démarre Gunicorn sur le port `8080` avec 1 worker et 8 threads.

L'application Flask fournie (`app.py`) illustre tous les modèles d'intégration :

- **`GET /`** — incrémente un compteur de visiteurs PostgreSQL et suit éventuellement les
  visites par session via Redis si `enable_redis = true` et que `REDIS_HOST` est défini.
- **`GET /healthz`** — renvoie `{"status": "healthy"}` immédiatement, sans requête à la
  base de données. Utilisé par les sondes de démarrage et de vivacité.
- **`GET /db`** — exécute `SELECT version()` et renvoie la chaîne de version de
  PostgreSQL. Pratique pour vérifier de bout en bout la connectivité à la base de données
  après le déploiement.

L'application lit les informations de connexion dans les variables d'environnement
standard (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`) et prend en charge
à la fois les connexions par socket Unix (Auth Proxy) et les connexions TCP.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les deux sondes ciblent le point de terminaison `/healthz`, qui est léger et ne sollicite
pas la base de données :

| Sonde | Type | Chemin / port | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `GET /healthz` | 10 s | 10 s | 3 |
| Vivacité | HTTP | `GET /healthz` | 15 s | 30 s | 3 |

**Ajustements propres à chaque plateforme :**

- **GKE** utilise des sondes HTTP — le trafic des sondes interne au cluster atteint
  directement le conteneur.
- **Cloud Run** remplace la sonde de démarrage par une sonde TCP (port 8080), car le
  trafic de santé de Cloud Run peut être soumis aux restrictions d'entrée ; la sonde TCP
  vérifie seulement que le port est ouvert, ce qui suffit pour conditionner l'arrivée du
  trafic au démarrage.

---

## 6. Sidecar Redis {#6-redis-sidecar}

Lorsque `enable_redis = true`, un service interne `redis:alpine` est ajouté à
`additional_services`. L'application Flask utilise `Flask-Session` avec un backend Redis
lorsque `ENABLE_REDIS=true` et que `REDIS_HOST` n'est pas vide. Lorsque `REDIS_HOST` est
vide, un avertissement est journalisé et l'application se rabat sur des sessions basées
sur des cookies.

**Le comportement diffère selon la plateforme :**

- **GKE** — lorsque `redis_host` est vide, `REDIS_HOST` est automatiquement défini à
  `127.0.0.1` (le sidecar Redis s'exécute dans le même réseau de pod). Pour une instance
  Redis externe telle que Cloud Memorystore, définissez explicitement `redis_host` avec
  l'adresse IP privée de l'instance.
- **Cloud Run** — il n'existe pas de repli automatique. `redis_host` doit toujours être
  défini explicitement avec l'URL interne du service Cloud Run Redis ou l'adresse IP d'une
  instance Memorystore.

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

`Sample_Common` ne déclare aucun bucket GCS supplémentaire (`storage_buckets = []`). Tous
les buckets provisionnés pour un déploiement Sample proviennent de la variable
`storage_buckets` que vous configurez dans le module de plateforme (par défaut : un bucket
avec `name_suffix = "data"`). Listez les buckets déployés avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Sample destinée aux utilisateurs (variables par groupe,
sorties et exploration de chaque service depuis la console et la CLI), consultez les
guides des plateformes : **[Sample_GKE](Sample_GKE.md)** et
**[Sample_CloudRun](Sample_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Application Sample sur Google Cloud Run](Sample_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Application Sample sur GKE Autopilot](Sample_GKE.md) — cette configuration déployée sur GKE.
