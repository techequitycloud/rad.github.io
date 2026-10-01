---
title: "Matomo Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Matomo — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Matomo_Common.md @ 3055034 sha256:4d78bd609624 -->

# Matomo Common — Configuration applicative partagée {#matomo-common--shared-application-configuration}

`Matomo_Common` est la **couche applicative partagée** de Matomo. Elle n'est pas déployée seule ; elle fournit la configuration propre à Matomo sur laquelle s'appuient à la fois [Matomo_GKE](Matomo_GKE.md) et [Matomo_CloudRun](Matomo_CloudRun.md), afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Matomo, consultez les guides de plateforme ([Matomo_GKE](Matomo_GKE.md), [Matomo_CloudRun](Matomo_CloudRun.md)) et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Matomo_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Fixe l'image **officielle précompilée** `matomo` (`image_source = "prebuilt"`, tag issu de `application_version`, `5-apache` par défaut) — aucun build de Dockerfile personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Impose **Cloud SQL for MySQL 8.0** comme seul moteur pris en charge | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Définit le job `db-init` (`mysql:8.0-debian`) qui crée la base de données et l'utilisateur et vérifie la connectivité | Sortie `initialization_jobs` |
| Environnement de base | Définit `MATOMO_DATABASE_ADAPTER = "mysql"` et `MATOMO_DATABASE_TABLES_PREFIX = "matomo_"` | Variables d'environnement du conteneur en cours d'exécution |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `matomo-data` | Sortie `storage_buckets` |
| Secrets | Aucun — `secret_ids` / `secret_values` sont volontairement vides ; le mot de passe de la base de données est géré par le socle | Secret Manager (socle) |
| Contrôles de santé | Transmet la configuration des sondes de démarrage et de vivacité de la variante (valeurs par défaut Cloud Run : démarrage TCP avec un seuil de 20 échecs ; vivacité HTTP sur `/` avec un délai initial de 300 s) | §Observabilité dans les guides de plateforme |

---

## 2. Image de conteneur — précompilée, sans point d'entrée personnalisé {#2-container-image--prebuilt-no-custom-entrypoint}

Contrairement aux applications à build personnalisé, `Matomo_Common` déploie l'**image officielle `matomo:<version>` de Docker Hub sans modification** (`container_build_config.enabled = false`). Il n'y a ni étape Cloud Build ni point d'entrée personnalisé ; le socle met l'image en miroir dans Artifact Registry avant le déploiement pour éviter les limites de débit de Docker Hub.

Le point d'entrée propre à l'image officielle gère la configuration au premier démarrage : il copie l'application Matomo depuis `/usr/src/matomo` vers le volume persistant monté sur `/var/www/html` lorsque ce volume est vide. Tout ce que Matomo écrit ensuite — `config.ini.php`, plugins installés, ressources générées — réside sur ce volume.

Les entrées de réglage PHP (`php_memory_limit`, `upload_max_filesize`, `post_max_size`) sont déclarées comme **arguments de build** Docker et ne prennent donc effet que lorsqu'un déploiement passe à `container_image_source = "custom"` ; avec l'image précompilée par défaut, elles sont inertes.

```bash
# Confirm the deployed image
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format='value(spec.template.spec.containers[0].image)'
```

---

## 3. Configuration de la base de données et variables d'environnement {#3-database-configuration-and-environment-variables}

Matomo lit les variables d'environnement `MATOMO_DATABASE_*` (via son plugin EnvironmentVariables) pour préremplir l'écran de base de données de l'installateur web, de sorte qu'un nouveau déploiement se connecte sans configuration manuelle :

| Variable d'environnement | Source |
|---|---|
| `MATOMO_DATABASE_HOST` | Injectée par le socle — l'**adresse IP privée** de Cloud SQL pour une connexion TCP sur Cloud Run (`enable_cloudsql_volume = false`) ; l'adresse de bouclage du proxy sur GKE |
| `MATOMO_DATABASE_USERNAME` / `MATOMO_DATABASE_DBNAME` | Noms d'utilisateur et de base de données propres au déploiement, injectés par le socle |
| `MATOMO_DATABASE_PASSWORD` | Référence Secret Manager injectée par le socle (`app_secrets`) |
| `MATOMO_DATABASE_ADAPTER` | `mysql` — défini ici |
| `MATOMO_DATABASE_TABLES_PREFIX` | `matomo_` — défini ici |

La correspondance hôte/utilisateur/nom/mot de passe est câblée dans le `main.tf` du module applicatif via le mécanisme `db_*_env_var_name` du socle — `Matomo_Common` ne les code délibérément pas en dur, ce qui évite une incohérence de préfixe avec les noms propres au déploiement.

```bash
# Inspect the injected database env vars on the deployed revision
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format="json(spec.template.spec.containers[0].env)" | grep -i MATOMO_DATABASE
```

---

## 4. Amorçage de la base de données — le job `db-init` {#4-database-bootstrap--the-db-init-job}

Lorsque la variante appelante ne transmet aucun `initialization_jobs`, `Matomo_Common` fournit un job `db-init` par défaut (image `mysql:8.0-debian`, `execute_on_apply = true`, 3 nouvelles tentatives) qui exécute `scripts/db-init.sh`, lequel, de manière idempotente :

1. Se connecte en tant qu'utilisateur root MySQL — en privilégiant le **socket Unix** de Cloud SQL Auth Proxy lorsqu'il est monté (en attendant jusqu'à 30 s son apparition), et sinon en se rabattant sur **TCP via l'adresse IP privée** (`DB_IP`), en ajoutant `--get-server-public-key` pour l'échange de clé RSA `caching_sha2_password` de MySQL 8 en TCP simple.
2. Crée l'utilisateur de l'application (`CREATE USER IF NOT EXISTS` + `ALTER USER` pour faire converger le mot de passe).
3. Crée la base de données (`CREATE DATABASE IF NOT EXISTS`) et accorde à l'utilisateur tous les privilèges sur celle-ci.
4. **Vérifie que l'utilisateur de l'application peut se connecter** — en faisant échouer le job de manière visible en cas de problème d'identifiants ou de droits, et en préchauffant le cache d'authentification `caching_sha2_password` côté serveur afin que le client PHP de Matomo emprunte le chemin d'authentification rapide.
5. Arrête proprement le sidecar Cloud SQL Proxy (`POST /quitquitquit`, avec SIGKILL en repli) afin que le job se termine correctement sur GKE.

Le job ne crée que la base de données **vide** — l'installateur web de Matomo se charge de la création du schéma et de la configuration du superutilisateur lors de la première visite.

```bash
gcloud run jobs executions list --project "$PROJECT" --region "$REGION" \
  --filter="metadata.name~matomo"
```

---

## 5. Secrets — volontairement aucun {#5-secrets--intentionally-none}

Matomo ne nécessite aucun secret propre à l'application (ni clés d'authentification ni sels comme WordPress). Le seul secret qu'il utilise — le mot de passe de la base de données — est généré et géré par le module `app_secrets` du socle et injecté sous la forme `MATOMO_DATABASE_PASSWORD`. Les sorties `secret_ids` et `secret_values` de `Matomo_Common` sont donc des maps vides, conservées uniquement pour respecter le contrat de câblage du socle.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~matomo"
```

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié `matomo-data` (situé dans la région, avec force-destroy) est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail. Combiné au volume Filestore (NFS) qui rend persistant `/var/www/html`, il offre à Matomo un stockage durable pour les exportations et les données auxiliaires.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~matomo-data"
```

---

Pour la configuration propre à Matomo et visible par l'utilisateur (variables par groupe, sorties, et manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Matomo_GKE](Matomo_GKE.md)** et **[Matomo_CloudRun](Matomo_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Matomo sur Google Cloud Run](Matomo_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Matomo sur GKE Autopilot](Matomo_GKE.md) — cette configuration déployée sur GKE.
