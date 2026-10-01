---
title: "Plane Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Plane — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Plane_Common.md @ 3055034 sha256:4d88771985df -->

# Plane Common — Configuration applicative partagée {#plane-common--shared-application-configuration}

`Plane_Common` est la **couche applicative partagée** de Plane. Elle n'est pas déployée seule ; elle fournit la configuration propre à Plane sur laquelle s'appuient [Plane_CloudRun](Plane_CloudRun.md) et la variante GKE, afin que les deux variantes de plateforme se comportent de façon identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Plane, consultez le guide de la plateforme ([Plane_CloudRun](Plane_CloudRun.md)) et les guides du socle ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Plane_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Dockerfile wrapper minimal `FROM makeplane/plane-aio-community:<version>` — l'image tout-en-un qui regroupe api + worker + beat + web/space/admin + live + migrator derrière un proxy Caddy interne sur :80 | Output `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Compose `DATABASE_URL` / `REDIS_URL` / `AMQP_URL` à partir des valeurs distinctes `DB_*` / `REDIS_*` / `RABBITMQ_*` injectées par le socle, puis exécute le `/app/start.sh` intégré de Plane | Comportement de l'application dans les guides des plateformes |
| Secrets | Génère automatiquement le `SECRET_KEY` Django (50 caractères) et `LIVE_SERVER_SECRET_KEY` (40 caractères) dans Secret Manager | Outputs `secret_ids` / `secret_values`, injectés en tant que variables d'environnement secrètes |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** (PostgreSQL standard, sans extension) | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | Définit le job `db-init` (`postgres:15-alpine`) qui crée de façon idempotente la base de données et l'utilisateur | Output `initialization_jobs` |
| Stockage objet | Déclare le bucket **Cloud Storage** `storage` (le câblage des téléversements S3 est un TODO documenté) | Output `storage_buckets` |
| Environnement principal | `WEB_URL` / `DOMAIN_NAME` / `CORS_ALLOWED_ORIGINS` à partir de l'URL de service prévue, `SITE_ADDRESS=:80`, `GUNICORN_WORKERS=2`, `DEBUG=0`, points de terminaison Redis et RabbitMQ, valeurs fictives de stockage `AWS_*` | Environnement du conteneur en cours d'exécution |
| Contrôles de santé | Sondes par défaut de démarrage (`/health`, délai de 30 s, 30 échecs × 10 s) et de vivacité (`/health`, délai de 30 s, période de 30 s) | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

Plutôt que de câbler séparément les sept services amont de Plane, `Plane_Common` utilise l'**image communautaire tout-en-un** publiée et y ajoute un point d'entrée de la plateforme via un Dockerfile wrapper minimal. L'argument de build `APPLICATION_VERSION` épingle le tag de base ; l'image amont n'ayant pas de tag `latest`, `latest` est converti en `stable` au moment du build.

Le point d'entrée effectue les actions suivantes à chaque démarrage du conteneur :

1. **URL de la base de données.** Privilégie l'IP privée TCP injectée (`DB_IP`) et compose `DATABASE_URL` avec `sslmode=require` pour les connexions directes sur IP privée (Cloud Run) ou `sslmode=disable` pour le Cloud SQL Auth Proxy en loopback (GKE). Exporte aussi les variables distinctes `POSTGRES_*` que lisent certains chemins de code de Plane.
2. **URL Redis.** Résout à l'exécution l'espace réservé `$(NFS_SERVER_IP)` (Cloud Run ne substitue pas les références `$(VAR)`) et compose `REDIS_URL`.
3. **URL AMQP.** Récupère l'hôte du sidecar RabbitMQ (injecté en tant que `PLANE_MQ_HOST` sur Cloud Run ; DNS interne au cluster sur GKE), retire tout schéma/port et compose `AMQP_URL`. Le `start.sh` de Plane se termine si cette valeur est vide — **RabbitMQ est obligatoire**.
4. **Domaine et valeurs fictives de stockage.** Dérive `DOMAIN_NAME` de `WEB_URL` lorsqu'il n'est pas défini et exporte des valeurs fictives `AWS_*` afin que la validation de `start.sh` réussisse (de vrais téléversements nécessitent de vrais identifiants S3 — voir §6).
5. **Correctif de redirection god-mode.** Modifie de façon idempotente le Caddyfile intégré avec une redirection 308 de `/god-mode` vers `/god-mode/` (le basename du routeur de la SPA d'administration exige la barre oblique finale — sans elle, le panneau d'administration tourne indéfiniment).
6. **Passage de relais.** Exécute le `/app/start.sh` intégré de Plane, qui lance supervisord : migrator → api / space / admin / live + worker / beat + le proxy Caddy.

Pour confirmer ce que le point d'entrée a composé :

```bash
# Cloud Run — the composed-URL log lines
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 100 \
  | grep -E "Composed (DATABASE|REDIS|AMQP)_URL|Starting Plane"
```

---

## 3. Secrets dans Secret Manager {#3-secrets-in-secret-manager}

Deux secrets applicatifs sont générés avec `random_password` et stockés dans Secret Manager :

| Secret | Variable d'environnement | Rôle |
|---|---|---|
| `secret-<prefix>-plane-key` | `SECRET_KEY` | Clé de signature cryptographique Django (50 caractères) |
| `secret-<prefix>-plane-live-key` | `LIVE_SERVER_SECRET_KEY` | Secret partagé authentifiant le serveur de collaboration en temps réel `live` (40 caractères) |

Le socle gère en outre le secret du mot de passe Cloud SQL. Pour les inspecter :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~plane"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Un `time_sleep` de 30 secondes après la création des versions de secrets absorbe le délai de réplication avant que le service ne les consomme.

---

## 4. Moteur de base de données et initialisation {#4-database-engine-and-bootstrap}

Plane exige **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` (aucune extension requise). À chaque apply, le job `db-init` (`postgres:15-alpine`), de façon idempotente :

1. Attend l'instance avec `pg_isready` (socket ou IP privée).
2. Crée l'utilisateur de l'application (ou réinitialise son mot de passe).
3. Accorde le rôle de l'utilisateur à `postgres` afin que la propriété puisse être attribuée.
4. Crée la base de données avec l'utilisateur de l'application comme propriétaire (ou en transfère la propriété).
5. Accorde tous les privilèges sur la base de données et sur `SCHEMA public`.
6. Envoie `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le job se termine proprement.

**Les migrations de schéma ne sont pas exécutées par le job d'initialisation** — l'étape `migrator` propre à l'image AIO (`manage.py migrate`) s'exécute dans supervisord à chaque démarrage du conteneur, avant le démarrage de l'api et des frontends.

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
gcloud run jobs executions list --project "$PROJECT" --region "$REGION"
```

---

## 5. Contrat du courtier de messages {#5-message-broker-contract}

Le worker et le beat Celery de Plane exigent un courtier AMQP, et `Plane_Common` encode ce contrat : `RABBITMQ_USER` / `RABBITMQ_PASSWORD` / `RABBITMQ_VHOST` valent `plane` par défaut, et l'hôte est fourni par la **variante de plateforme** — un sidecar `rabbitmq:3.13-management-alpine` dans le pod sur `127.0.0.1:5672` sur Cloud Run (AMQP est un protocole non HTTP que le réseau de service à service de Cloud Run ne peut pas acheminer). L'état du courtier est éphémère ; les files durables sont un TODO de durcissement documenté.

---

## 6. Stockage objet (TODO) {#6-object-storage-todo}

Un bucket **Cloud Storage** `storage` (`gcs-<service-name>-storage`) est déclaré ici et provisionné par le socle, et l'environnement pointe `AWS_S3_ENDPOINT_URL` vers `https://storage.googleapis.com` avec `USE_MINIO=0`. Cependant, Plane utilise l'**API S3**, et l'interopérabilité S3 de GCS exige des **clés HMAC qui ne sont pas encore provisionnées** — les téléversements de fichiers (pièces jointes, avatars) échouent donc tant que de vrais identifiants ne sont pas fournis via les `environment_variables` du module de plateforme (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`). Les tickets, projets, cycles et modules fonctionnent sans eux.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~plane"
```

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent `/health` via le proxy Caddy interne sur le port 80 :

- **Sonde de démarrage** — HTTP `/health`, délai initial de 30 s, période de 10 s, seuil d'échec de 30. Le conteneur AIO dispose ainsi de jusqu'à 30 + (30 × 10) = 330 secondes à partir du démarrage — une marge délibérée pour l'étape migrator du premier démarrage, qui doit se terminer avant que Caddy ne réponde.
- **Sonde de vivacité** — HTTP `/health`, délai initial de 30 s, période de 30 s, seuil d'échec de 3.

Ne resserrez pas le seuil d'échec de la sonde de démarrage : tuer le conteneur en pleine migration provoque une boucle de redémarrages.

---

Pour la configuration propre à Plane destinée aux utilisateurs (variables par groupe, outputs et exploration de chaque service depuis la console et la CLI), consultez le guide de la plateforme :
**[Plane_CloudRun](Plane_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Plane sur Google Cloud Run](Plane_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Plane sur GKE Autopilot](Plane_GKE.md) — cette configuration déployée sur GKE.
