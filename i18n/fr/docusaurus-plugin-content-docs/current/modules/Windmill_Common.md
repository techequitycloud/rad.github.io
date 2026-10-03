---
title: "Windmill Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Windmill — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Windmill_Common.md @ 15fd4c7 sha256:01f0036348d9 -->

# Windmill Common — Configuration d'application partagée {#windmill-common--shared-application-configuration}

`Windmill_Common` est la **couche d'application partagée** pour Windmill. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à Windmill sur laquelle s'appuient [Windmill_GKE](Windmill_GKE.md) et [Windmill_CloudRun](Windmill_CloudRun.md), de sorte que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas ses propres entrées d'interface utilisateur de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Windmill, consultez les guides de la plateforme ([Windmill_GKE](Windmill_GKE.md), [Windmill_CloudRun](Windmill_CloudRun.md)) et les guides de base ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Windmill_Common | Où cela apparaît |
|---|---|---|
| Identifiant SMTP | Génère un mot de passe SMTP de remplacement et le stocke dans **Secret Manager** | Récupérer et remplacer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Épingle l'image officielle `ghcr.io/windmill-labs/windmill` et construit un wrapper personnalisé avec un shim de démarrage | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 16** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement qui crée la base de données, l'utilisateur, les rôles et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `data` (`gcs-<app><tenant-prefix>-data`) pour les sorties et les artefacts de workflow | Sortie `storage_buckets` |
| Paramètres de base | Définit l'environnement Windmill de base (mode serveur+worker combiné, isolation des espaces de noms désactivée, journalisation structurée, métriques Prometheus, URL de service) | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit la configuration par défaut de la sonde de démarrage, de vivacité et de disponibilité ciblant `/api/version` | §Observabilité dans les guides de la plateforme |

---

## 2. Identifiant SMTP dans Secret Manager {#2-smtp-credential-in-secret-manager}

Le mot de passe SMTP de Windmill est généré comme un espace réservé de 16 caractères et stocké comme un secret Secret Manager — il n'est jamais défini en texte clair. Le nom du secret suit le préfixe de ressource du déploiement. Avant d'activer les notifications par e-mail, remplacez l'espace réservé par votre mot de passe SMTP réel :

```bash
# List and identify the SMTP secret:
gcloud secrets list --project "$PROJECT" --filter="name~smtp-password"
# Replace the placeholder with your real SMTP password:
echo -n "your-real-smtp-password" | gcloud secrets versions add \
  <smtp-secret-name> --data-file=- --project "$PROJECT"
```

Après avoir mis à jour le secret, redéployez ou redémarrez le service pour prendre en compte la nouvelle valeur. Fournissez également les autres paramètres SMTP via `environment_variables` dans le module de la plateforme :

```bash
# Variables to add: WINDMILL_SMTP_HOST, WINDMILL_SMTP_PORT, WINDMILL_SMTP_FROM
gcloud run services update <service-name> \
  --update-env-vars "WINDMILL_SMTP_HOST=smtp.example.com,WINDMILL_SMTP_PORT=587,WINDMILL_SMTP_FROM=noreply@example.com" \
  --region "$REGION" --project "$PROJECT"
```

Le mot de passe de la base de données est généré et géré séparément par la fondation ; son nom de secret est indiqué dans les sorties du déploiement de la plateforme (`database_password_secret`). Voir [App_Common](App_Common.md) pour le modèle de secret partagé et d'identité de charge de travail.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Windmill nécessite **PostgreSQL 16** ; le moteur est fixe et aucun autre type de base de données n'est pris en charge. Lors du premier déploiement, un job unique (`db-init`) se connecte à Cloud SQL via le proxy d'authentification et de manière idempotente :

1. crée les rôles PostgreSQL `windmill_admin` et `windmill_user` (s'ils sont absents),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. crée la base de données de l'application appartenant à l'utilisateur,
4. accorde à l'utilisateur tous les privilèges sur la base de données et le schéma `public`, et
5. accorde à l'utilisateur l'adhésion à `windmill_admin` et `windmill_user` — Windmill émet `SET ROLE windmill_admin` sur les requêtes privilégiées, ce qu'un utilisateur Cloud SQL non superutilisateur ne peut faire qu'en tant que membre de ce rôle.

Le job utilise `postgres:16-alpine` et peut être réexécuté en toute sécurité. Inspectez la base de données directement avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur se trouvent dans les sorties du déploiement de la plateforme.

---

## 4. Image de conteneur et shim de démarrage {#4-container-image-and-startup-shim}

`Windmill_Common` construit une image de conteneur personnalisée étendant l'image officielle `ghcr.io/windmill-labs/windmill`. Le wrapper personnalisé ajoute `entrypoint.sh`, qui :

- Construit `DATABASE_URL` à partir des variables `DB_*` injectées par la plateforme au démarrage, gérant à la fois le chemin du socket Unix du proxy d'authentification Cloud SQL et les connexions TCP simples.
- Définit `BASE_URL` et `BASE_INTERNAL_URL` à partir de `GKE_SERVICE_URL` (lorsqu'il s'exécute sur GKE et que l'adresse IP du LoadBalancer est disponible) ou à partir de la variable d'environnement `BASE_URL` fournie par la plateforme.
- Démarre le processus du serveur Windmill avec l'appel `exec windmill`.

Ce shim garantit que Windmill se configure correctement, qu'il s'exécute sur Cloud Run ou GKE Autopilot, et que la connexion à la base de données utilise un socket ou TCP.

---

## 5. Paramètres d'application de base {#5-core-application-settings}

`Windmill_Common` établit l'environnement Windmill de base afin que l'application démarre correctement au premier lancement :

- **Mode serveur+worker combiné** — `MODE=server,worker` et `NUM_WORKERS=3` exécutent le serveur API et les workers d'exécution de scripts dans un seul processus. Ceci est approprié pour Cloud Run et les déploiements GKE à pod unique ; pour une mise à l'échelle dédiée des workers, définissez des déploiements Kubernetes supplémentaires ou augmentez `max_instance_count`.
- **Isolation des espaces de noms Linux désactivée** — `DISABLE_NSJAIL=true` est toujours injecté. Cloud Run et GKE Autopilot n'ont pas `CAP_SYS_ADMIN` et d'espaces de noms utilisateur ; le bac à sable de Windmill nécessite ce drapeau.
- **Groupe de workers** — `WORKER_GROUP=default` signifie que tous les scripts et flux sont acheminés vers le pool de workers par défaut, sauf indication contraire.
- **Journalisation JSON structurée** — `JSON_FMT=true` et `RUST_LOG=windmill=info` garantissent que les journaux sont structurés et analysables par Cloud Logging.
- **Point de terminaison des métriques Prometheus** — `METRICS_ADDR=:9001` expose les métriques internes de Windmill pour le scraping au sein du VPC.
- **URL du service** — `BASE_URL` et `BASE_INTERNAL_URL` sont définis à partir de l'URL du service injectée par la plateforme afin que les redirections OAuth, les rappels de webhook et les liens profonds de l'interface utilisateur de Windmill se résolvent correctement.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

Les trois types de sondes ciblent `GET /api/version`, qui renvoie HTTP 200 avec la chaîne de version de Windmill lorsque le service est sain et entièrement connecté à PostgreSQL.

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/api/version` | 60 s | 10 s | 10 |
| Vivacité | HTTP | `/api/version` | 60 s | 30 s | 3 |
| Disponibilité | HTTP | `/api/version` | 30 s | 10 s | 3 |

La sonde de démarrage permet jusqu'à 160 secondes (60 s de délai + 10 × 10 s) à Windmill pour se connecter à la base de données et exécuter toutes les migrations en attente au premier démarrage. Contrairement aux applications basées sur PHP qui nécessitent des sondes TCP pour éviter les boucles de redirection, le point de terminaison `/api/version` de Windmill répond avec un corps JSON simple via HTTP — aucune gestion de redirection n'est requise sur Cloud Run ou GKE.

---

## 7. Stockage d'objets {#7-object-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `data`, c'est-à-dire `gcs-<app><tenant-prefix>-data`) est déclaré ici et provisionné par la fondation, qui accorde également l'accès au compte de service de la charge de travail. Ce bucket contient les sorties de workflow, les artefacts de job et tous les fichiers produits par l'exécution de scripts. Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

Des buckets supplémentaires peuvent être définis dans le module de la plateforme via `storage_buckets`, et des montages GCS Fuse peuvent être configurés via `gcs_volumes` pour rendre les buckets directement accessibles en tant que chemin de système de fichiers à l'intérieur du conteneur.

---

Pour la configuration spécifique à Windmill, destinée à l'utilisateur (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez les guides de la plateforme : **[Windmill_GKE](Windmill_GKE.md)** et **[Windmill_CloudRun](Windmill_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Windmill sur Google Cloud Run](Windmill_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Windmill sur GKE Autopilot](Windmill_GKE.md) — cette configuration déployée sur GKE.
