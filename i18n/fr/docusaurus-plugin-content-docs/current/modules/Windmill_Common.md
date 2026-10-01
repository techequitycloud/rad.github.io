---
title: "Windmill Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Windmill — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Windmill_Common.md @ 3055034 sha256:a2c15d21f21b -->

# Windmill Common — Configuration applicative partagée {#windmill-common--shared-application-configuration}

`Windmill_Common` est la **couche applicative partagée** de Windmill. Elle n'est pas déployée seule ; elle fournit la configuration propre à Windmill sur laquelle s'appuient à la fois [Windmill_GKE](Windmill_GKE.md) et [Windmill_CloudRun](Windmill_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Windmill, consultez les guides des plateformes ([Windmill_GKE](Windmill_GKE.md), [Windmill_CloudRun](Windmill_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Windmill_Common | Où cela apparaît |
|---|---|---|
| Identifiant SMTP | Génère un mot de passe SMTP provisoire et le stocke dans **Secret Manager** | À récupérer et remplacer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image officielle `ghcr.io/windmill-labs/windmill` et construit une image wrapper personnalisée avec un shim de démarrage | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 16** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement qui crée la base de données, l'utilisateur, les rôles et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties de workflows et les artefacts | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement Windmill de base (mode combiné serveur+worker, isolation par espaces de noms désactivée, journalisation structurée, métriques Prometheus, URL du service) | Comportement de l'application dans les guides des plateformes |
| Vérifications de santé | Fournit la configuration par défaut des sondes de démarrage, d'activité et de disponibilité ciblant `/api/version` | §Observabilité dans les guides des plateformes |

---

## 2. Identifiant SMTP dans Secret Manager {#2-smtp-credential-in-secret-manager}

Le mot de passe SMTP de Windmill est généré sous forme de valeur provisoire de 16 caractères et stocké en tant que secret Secret Manager — il n'est jamais défini en texte clair. Le nom du secret suit le préfixe de ressources du déploiement. Avant d'activer les notifications par e-mail, remplacez la valeur provisoire par votre véritable mot de passe SMTP :

```bash
# List and identify the SMTP secret:
gcloud secrets list --project "$PROJECT" --filter="name~smtp-password"
# Replace the placeholder with your real SMTP password:
echo -n "your-real-smtp-password" | gcloud secrets versions add \
  <smtp-secret-name> --data-file=- --project "$PROJECT"
```

Après la mise à jour du secret, redéployez ou redémarrez le service pour qu'il prenne en compte la nouvelle valeur. Fournissez également les autres paramètres SMTP via `environment_variables` dans le module de la plateforme :

```bash
# Variables to add: WINDMILL_SMTP_HOST, WINDMILL_SMTP_PORT, WINDMILL_SMTP_FROM
gcloud run services update <service-name> \
  --update-env-vars "WINDMILL_SMTP_HOST=smtp.example.com,WINDMILL_SMTP_PORT=587,WINDMILL_SMTP_FROM=noreply@example.com" \
  --region "$REGION" --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par le socle ; le nom de son secret figure dans les sorties du déploiement de la plateforme (`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Windmill nécessite **PostgreSQL 16** ; le moteur est fixe et aucun autre type de base de données n'est pris en charge. Lors du premier déploiement, un job ponctuel (`db-init`) se connecte à Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée les rôles PostgreSQL `windmill_admin` et `windmill_user` (s'ils sont absents),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. crée la base de données de l'application, dont l'utilisateur est propriétaire,
4. accorde à l'utilisateur tous les privilèges sur la base de données et sur le schéma `public`.

Le job utilise `postgres:16-alpine` et peut être relancé sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et shim de démarrage {#4-container-image-and-startup-shim}

`Windmill_Common` construit une image de conteneur personnalisée qui étend l'image officielle `ghcr.io/windmill-labs/windmill`. Le wrapper personnalisé ajoute `entrypoint.sh`, qui :

- Construit `DATABASE_URL` au démarrage à partir des variables `DB_*` injectées par la plateforme, en gérant à la fois le chemin du socket Unix du Cloud SQL Auth Proxy et les connexions TCP classiques.
- Définit `BASE_URL` et `BASE_INTERNAL_URL` à partir de `GKE_SERVICE_URL` (lors d'une exécution sur GKE lorsque l'IP du LoadBalancer est disponible) ou à partir de la variable d'environnement `BASE_URL` fournie par la plateforme.
- Lance le processus serveur Windmill avec l'appel `exec windmill`.

Ce shim garantit que Windmill se configure correctement, qu'il s'exécute sur Cloud Run ou sur GKE Autopilot, et que la connexion à la base de données utilise un socket ou TCP.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Windmill_Common` établit l'environnement Windmill de base afin que l'application démarre correctement dès le premier lancement :

- **Mode combiné serveur+worker** — `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur d'API et les workers d'exécution de scripts dans un seul processus. Cela convient à Cloud Run et aux déploiements GKE à un seul pod ; pour une mise à l'échelle dédiée des workers, définissez des Deployments Kubernetes supplémentaires ou augmentez `max_instance_count`.
- **Isolation par espaces de noms Linux désactivée** — `DISABLE_NSJAIL=true` est toujours injecté. Cloud Run et GKE Autopilot ne disposent ni de `CAP_SYS_ADMIN` ni des espaces de noms utilisateur ; le bac à sable de Windmill nécessite ce flag.
- **Groupe de workers** — `WORKER_GROUP=default` signifie que tous les scripts et flux sont acheminés vers le pool de workers par défaut, sauf remplacement.
- **Journalisation JSON structurée** — `JSON_FMT=true` et `RUST_LOG=windmill=info` garantissent des journaux structurés et analysables par Cloud Logging.
- **Point de terminaison de métriques Prometheus** — `METRICS_ADDR=:9001` expose les métriques internes de Windmill pour une collecte au sein du VPC.
- **URL du service** — `BASE_URL` et `BASE_INTERNAL_URL` sont définies à partir de l'URL du service injectée par la plateforme, afin que les redirections OAuth, les callbacks de webhook et les liens profonds de l'interface Windmill soient tous résolus correctement.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les trois types de sondes ciblent `GET /api/version`, qui renvoie HTTP 200 avec la chaîne de version de Windmill lorsque le service est sain et entièrement connecté à PostgreSQL.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/api/version` | 60 s | 10 s | 10 |
| Activité | HTTP | `/api/version` | 60 s | 30 s | 3 |
| Disponibilité | HTTP | `/api/version` | 30 s | 10 s | 3 |

La sonde de démarrage laisse jusqu'à 160 secondes (délai de 60 s + 10 × 10 s) à Windmill pour se connecter à la base de données et exécuter les éventuelles migrations en attente lors du premier démarrage. Contrairement aux applications PHP qui nécessitent des sondes TCP pour éviter les boucles de redirection, le point de terminaison `/api/version` de Windmill répond avec un simple corps JSON sur HTTP — aucune gestion des redirections n'est nécessaire, ni sur Cloud Run ni sur GKE.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Ce bucket contient les sorties de workflows, les artefacts des jobs et tous les fichiers produits par l'exécution des scripts. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Des buckets supplémentaires peuvent être définis dans le module de la plateforme via `storage_buckets`, et des montages GCS Fuse peuvent être configurés via `gcs_volumes` pour rendre les buckets directement accessibles sous forme de chemin de système de fichiers dans le conteneur.

---

Pour la configuration propre à Windmill destinée aux utilisateurs (variables par groupe, sorties et exploration de chaque service depuis la console et la CLI), consultez les guides des plateformes : **[Windmill_GKE](Windmill_GKE.md)** et **[Windmill_CloudRun](Windmill_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Windmill sur Google Cloud Run](Windmill_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Windmill sur GKE Autopilot](Windmill_GKE.md) — cette configuration déployée sur GKE.
