---
title: "Plane Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Plane — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Plane_Common.md @ 15fd4c7 sha256:4c7b762c4629 -->

# Plane Common — Configuration d'application partagée {#plane-common--shared-application-configuration}

`Plane_Common` est la **couche d'application partagée** pour Plane. Elle n'est pas déployée seule ; elle fournit plutôt la configuration spécifique à Plane sur laquelle s'appuient [Plane_CloudRun](Plane_CloudRun.md) et la variante GKE, afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute réellement Plane, consultez le guide de la plateforme ([Plane_CloudRun](Plane_CloudRun.md)) et les guides de base ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Plane_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Dockerfile d'encapsulation mince `FROM makeplane/plane-aio-community:<version>` — l'image tout-en-un regroupant api + worker + beat + web/space/admin + live + migrator derrière un proxy Caddy interne sur :80 | Sortie `container_image` du déploiement de la plateforme |
| Point d'entrée personnalisé | Compose `DATABASE_URL` / `REDIS_URL` / `AMQP_URL` à partir des valeurs discrètes `DB_*` / `REDIS_*` / `RABBITMQ_*` que la fondation injecte, puis exécute `/app/start.sh` de Plane | Comportement de l'application dans les guides de la plateforme |
| Secrets | Génère automatiquement le `SECRET_KEY` (50 caractères) et le `LIVE_SERVER_SECRET_KEY` (40 caractères) de Django dans Secret Manager | Sorties `secret_ids` / `secret_values`, injectées comme variables d'environnement secrètes |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** (PostgreSQL pur, sans extensions) | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job `db-init` (`postgres:15-alpine`) qui crée la base de données et l'utilisateur de manière idempotente | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` (le câblage de téléchargement S3 est un TODO documenté) | Sortie `storage_buckets` |
| Environnement de base | `WEB_URL` / `DOMAIN_NAME` / `CORS_ALLOWED_ORIGINS` à partir de l'URL de service prédite, `SITE_ADDRESS=:80`, `GUNICORN_WORKERS=2`, `DEBUG=0`, points de terminaison Redis et RabbitMQ, espaces réservés de stockage `AWS_*` | Environnement du conteneur en cours d'exécution |
| Vérifications de santé | Sondes de démarrage par défaut (`/health`, délai de 30 s, 30 échecs × 10 s) et de vivacité (`/health`, délai de 30 s, période de 30 s) | §Observabilité dans les guides de la plateforme |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

Plutôt que de câbler séparément les sept services amont de Plane, `Plane_Common` utilise l'**image communautaire tout-en-un** publiée et superpose un point d'entrée de plateforme via un Dockerfile d'encapsulation mince. L'argument de build `APPLICATION_VERSION` épingle le tag de base ; comme l'image amont n'a pas de tag `latest`, `latest` est mappé à `stable` au moment de la construction.

Le point d'entrée effectue ces actions à chaque démarrage de conteneur :

1. **URL de la base de données.** Préfère l'IP TCP privée injectée (`DB_IP`) et compose `DATABASE_URL` avec `sslmode=require` pour les connexions IP privées directes (Cloud Run) ou `sslmode=disable` pour le proxy d'authentification Cloud SQL en boucle locale (GKE). Exporte également les variables discrètes `POSTGRES_*` que certains chemins de code Plane lisent.
2. **URL Redis.** Résout l'espace réservé `$(NFS_SERVER_IP)` à l'exécution (Cloud Run ne substitue pas les références `$(VAR)`) et compose `REDIS_URL`.
3. **URL AMQP.** Récupère l'hôte du sidecar RabbitMQ (injecté comme `PLANE_MQ_HOST` sur Cloud Run ; DNS intra-cluster sur GKE), supprime tout schéma/port, et compose `AMQP_URL`. Le `start.sh` de Plane se termine si cette valeur est vide — **RabbitMQ est obligatoire**.
4. **Espaces réservés de domaine et de stockage.** Dérive `DOMAIN_NAME` de `WEB_URL` lorsqu'il n'est pas défini et exporte les valeurs d'espace réservé `AWS_*` afin que la validation de `start.sh` réussisse (les téléchargements réels nécessitent de vraies informations d'identification S3 — voir §6).
5. **Patch de redirection en mode Dieu.** Patche de manière idempotente le Caddyfile fourni avec une redirection 308 de `/god-mode` vers `/god-mode/` (le nom de base du routeur de l'admin SPA nécessite la barre oblique finale — sans elle, le panneau d'administration tourne en boucle indéfiniment).
6. **Transfert.** Exécute le `/app/start.sh` fourni par Plane, qui lance supervisord : migrator → api / space / admin / live + worker / beat + le proxy Caddy.

Pour confirmer ce que le point d'entrée a composé :

```bash
# Cloud Run — the composed-URL log lines
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 100 \
  | grep -E "Composed (DATABASE|REDIS|AMQP)_URL|Starting Plane"
```

---

## 3. Secrets dans Secret Manager {#3-secrets-in-secret-manager}

Deux secrets d'application sont générés avec `random_password` et stockés dans Secret Manager :

| Secret | Variable d'environnement | Objectif |
|---|---|---|
| `secret-<prefix>-plane-key` | `SECRET_KEY` | Clé de signature cryptographique Django (50 caractères) |
| `secret-<prefix>-plane-live-key` | `LIVE_SERVER_SECRET_KEY` | Secret partagé authentifiant le serveur de collaboration en temps réel `live` (40 caractères) |

La fondation gère également le secret du mot de passe Cloud SQL. Inspectez-les :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~plane"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Un délai de `time_sleep` de 30 secondes après la création de la version du secret absorbe le décalage de réplication avant que le service ne les consomme.

---

## 4. Moteur de base de données et amorçage {#4-database-engine-and-bootstrap}

Plane nécessite **PostgreSQL** ; le moteur est fixé à `POSTGRES_15` (aucune extension n'est nécessaire). À chaque apply, le job `db-init` (`postgres:15-alpine`) de manière idempotente :

1. Attend l'instance avec `pg_isready` (socket ou IP privée).
2. Crée l'utilisateur de l'application (ou réinitialise son mot de passe).
3. Accorde le rôle d'utilisateur à `postgres` afin que la propriété puisse être attribuée.
4. Crée la base de données avec l'utilisateur de l'application comme propriétaire (ou transfère la propriété).
5. Accorde tous les privilèges sur la base de données et sur `SCHEMA public`.
6. Envoie `POST /quitquitquit` au sidecar Cloud SQL Proxy afin que le job se termine proprement.

**Les migrations de schéma ne sont pas exécutées par le job d'initialisation** — l'étape `migrator` de l'image AIO (`manage.py migrate`) s'exécute à l'intérieur de supervisord à chaque démarrage de conteneur, avant que l'API et les frontends ne démarrent.

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
gcloud run jobs executions list --project "$PROJECT" --region "$REGION"
```

---

## 5. Contrat de courtier de messages {#5-message-broker-contract}

Le worker Celery et le beat de Plane nécessitent un courtier AMQP, et `Plane_Common` encode le contrat : `RABBITMQ_USER` et `RABBITMQ_VHOST` sont `plane`, `RABBITMQ_PASSWORD` est une valeur aléatoire par déploiement dans Secret Manager (`secret-<prefix>-<app>-rabbitmq-password`) que l'encapsuleur transmet également au courtier comme `RABBITMQ_DEFAULT_PASS`, et l'hôte est fourni par la **variante de plateforme** — un sidecar `rabbitmq:3.13-management-alpine` dans le pod à `127.0.0.1:5672` sur Cloud Run (AMQP est un protocole non-HTTP que la mise en réseau de service à service de Cloud Run ne peut pas transporter). L'état du courtier est éphémère ; les files d'attente durables sont un TODO de renforcement documenté.

---

## 6. Stockage d'objets (TODO) {#6-object-storage-todo}

Un bucket **Cloud Storage** `storage` (`gcs-<service-name>-storage`) est déclaré ici et provisionné par la fondation, et l'environnement pointe `AWS_S3_ENDPOINT_URL` vers `https://storage.googleapis.com` avec `USE_MINIO=0`. Cependant, Plane parle l'**API S3**, et l'interopérabilité S3 de GCS nécessite des **clés HMAC qui ne sont pas encore provisionnées** — les téléchargements de fichiers (pièces jointes, avatars) échouent donc jusqu'à ce que de vraies informations d'identification soient fournies via le module de plateforme `environment_variables` (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`). Les problèmes, projets, cycles et modules fonctionnent sans cela.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~plane"
```

---

## 7. Comportement de la sonde de santé {#7-health-probe-behaviour}

Les sondes par défaut ciblent `/health` via le proxy Caddy interne sur le port 80 :

- **Sonde de démarrage** — HTTP `/health`, délai initial 30 s, période 10 s, seuil d'échec 30. Cela donne au conteneur AIO jusqu'à 30 + (30 × 10) = 330 secondes à partir du démarrage — une marge délibérée pour l'étape de migration du premier démarrage, qui doit se terminer avant que Caddy ne réponde.
- **Sonde de vivacité** — HTTP `/health`, délai initial 30 s, période 30 s, seuil d'échec 3.

Ne pas réduire le seuil d'échec du démarrage : tuer le conteneur en pleine migration produit une boucle de redémarrage.

---

Pour la configuration spécifique à Plane et destinée à l'utilisateur (variables par groupe, sorties et comment explorer chaque service depuis la Console et la CLI), consultez le guide de la plateforme :
**[Plane_CloudRun](Plane_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Plane sur Google Cloud Run](Plane_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Plane sur GKE Autopilot](Plane_GKE.md) — cette configuration déployée sur GKE.
