---
title: "Zammad Common — configuration applicative partagée"
description: "Référence de configuration partagée pour le module Zammad — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Zammad_Common.md @ 3055034 sha256:e46c127df74f -->

# Zammad Common — configuration applicative partagée {#zammad-common--shared-application-configuration}

`Zammad_Common` est la **couche applicative partagée** de Zammad. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Zammad sur laquelle
s'appuient [Zammad_GKE](Zammad_GKE.md) et [Zammad_CloudRun](Zammad_CloudRun.md), de
sorte que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche —
elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Zammad, consultez les
guides des plateformes ([Zammad_GKE](Zammad_GKE.md), [Zammad_CloudRun](Zammad_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Zammad_Common | Où cela apparaît |
|---|---|---|
| Image du conteneur | Épingle `zammad/zammad` et le build Cloud Build qui l'étend avec le point d'entrée GCP | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | Section Base de données des guides des plateformes |
| Amorçage de la base de données | Définit le job du premier déploiement qui crée la base de données, l'utilisateur et les privilèges | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `zammad-attachments` | Sortie `storage_buckets` |
| Paramètres principaux | Définit les variables d'environnement de base de Zammad (`RAILS_ENV`, `POSTGRESQL_PORT`, `ZAMMAD_RAILSSERVER_*`, `RAILS_TRUSTED_PROXIES`) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les configurations par défaut des sondes de démarrage, de vivacité et de disponibilité (readiness) (HTTP, chemin `/`) | Section Observabilité des guides des plateformes |
| Aucun secret généré automatiquement | Renvoie `secret_ids = {}` — Zammad gère ses propres clés de signature internes à l'exécution | Section des secrets de la plateforme |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

L'image officielle `zammad/zammad` attend directement des variables d'environnement
`POSTGRESQL_*`. Les modules socles GCP injectent les identifiants de la base de
données sous la forme `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` et `DB_NAME`. Le
`scripts/Dockerfile` personnalisé étend l'image officielle et remplace le point
d'entrée par un `entrypoint.sh` spécifique à GCP qui comble cet écart au démarrage
du conteneur.

À chaque démarrage du conteneur, `entrypoint.sh` effectue les étapes suivantes :

1. **Correspondance des variables** — traduit les variables `DB_*` du socle vers la
   convention `POSTGRESQL_*` de Zammad. L'utilisateur et le mot de passe sont encodés
   pour URL afin que les caractères spéciaux ne cassent pas l'URI `postgres://`.

2. **Contournement TCP pour Cloud Run** — le `docker-entrypoint.sh` de Zammad vérifie
   que PostgreSQL est prêt au moyen d'un socket TCP bash. Sur **Cloud Run**, `DB_HOST`
   est un chemin de socket Unix et n'est pas adressable en TCP ; le point d'entrée
   remplace `POSTGRESQL_HOST` par `DB_IP` (adresse IP privée de Cloud SQL). Sur
   **GKE**, `DB_HOST = 127.0.0.1` (le sidecar cloud-sql-proxy), qui est adressable en
   TCP — aucune substitution n'est nécessaire.

3. **Construction de l'URL Redis** — si `REDIS_URL` n'est pas déjà défini et que
   `REDIS_HOST` est présent, construit `REDIS_URL` à partir de `REDIS_HOST`,
   `REDIS_PORT` et, le cas échéant, `REDIS_AUTH`.

4. **`zammad-init`** — exécute de manière idempotente l'étape de migration et de seed
   de la base de données propre à Zammad avant le démarrage du railsserver. Les
   migrations en attente sont appliquées ; celles déjà exécutées sont ignorées.

Récupérez le tag de l'image déployée à partir de la sortie `container_image` :

```bash
gcloud artifacts docker images list <registry-url> --project "$PROJECT"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Zammad 6.x requiert **PostgreSQL 15 ou une version ultérieure** ; cette couche fixe
`POSTGRES_15` comme valeur par défaut et les modules de plateforme rejettent tout
autre moteur lors du plan. Lors du premier déploiement, un job ponctuel `db-init` se
connecte à Cloud SQL via l'Auth Proxy et, de manière idempotente :

1. crée l'utilisateur de base de données Zammad avec le mot de passe généré,
2. crée la base de données de l'application (si elle est absente),
3. accorde à l'utilisateur tous les privilèges sur la base de données et le schéma.

Le job `db-init` utilise l'image `postgres:15-alpine` et exécute le script
`scripts/db-init.sh`. Il peut être relancé sans risque. Inspectez directement la base
de données :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Paramètres principaux de l'application {#4-core-application-settings}

`Zammad_Common` établit l'environnement de base afin que l'application démarre
correctement au premier lancement :

- **`RAILS_ENV = "production"` / `NODE_ENV = "production"`** — le mode production
  active la mise en cache des ressources et désactive la sortie de débogage verbeuse.
- **`POSTGRESQL_PORT = "5432"`** — port de connexion PostgreSQL.
- **`ZAMMAD_RAILSSERVER_HOST = "0.0.0.0"` / `ZAMMAD_RAILSSERVER_PORT = "3000"`** —
  lie le serveur Rails à toutes les interfaces afin que Cloud Run et GKE puissent lui
  acheminer le trafic.
- **`RAILS_SERVE_STATIC_FILES = "true"`** — sert les ressources statiques directement
  depuis Rails ; requis sur Cloud Run, où nginx ne se trouve pas sur le chemin des
  requêtes.
- **`RAILS_TRUSTED_PROXIES`** — fait confiance au Google Front End de Cloud Run et aux
  plages CGNAT internes afin que les adresses IP des clients soient correctement
  journalisées.
- **`ELASTICSEARCH_ENABLED = "false"` (par défaut)** — le point d'entrée officiel
  attend indéfiniment un hôte Elasticsearch joignable lorsque cette valeur est
  `true`. Définissez `elasticsearch_url` dans le module de plateforme pour activer
  Elasticsearch et remplacer cette valeur par défaut.
- **`ZAMMAD_WEBSOCKET_HOST = "0.0.0.0"` / `ZAMMAD_WEBSOCKET_PORT = "6042"`** — lie le
  serveur WebSocket ActionCable à toutes les interfaces.

Les `environment_variables` supplémentaires transmises par le module de plateforme
sont fusionnées par-dessus ces valeurs par défaut.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Toutes les sondes utilisent par défaut HTTP sur `/` (la page racine / de connexion de
Zammad), qui ne renvoie HTTP 200 qu'une fois l'application entièrement initialisée (y
compris la migration du schéma au premier démarrage). Si vous le préférez, remplacez
le `path` de `startup_probe`/`liveness_probe` pour cibler plutôt le point de
terminaison de santé dédié de Zammad, `/api/v1/ping`.

- **Sonde de démarrage** — délai initial de 60 secondes, période de 15 secondes,
  seuil de 30 échecs. Laisse à Zammad jusqu'à ~510 secondes de tolérance totale au
  démarrage pour les bases de données volumineuses comportant de nombreuses migrations
  en attente.
- **Sonde de vivacité** — délai initial de 60 secondes, période de 30 secondes, seuil
  de 3 échecs. Redémarre le conteneur après 3 échecs consécutifs une fois stabilisé.
- **Sonde de disponibilité (GKE)** — délai initial de 30 secondes, période de
  10 secondes, seuil de 3 échecs.

Les deux variantes de plateforme utilisent les mêmes sondes HTTP. Contrairement à
certaines applications (par exemple Mautic), Zammad ne nécessite pas de contournement
par sonde TCP — le chemin racine répond en HTTP simple sans émettre de redirections.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** dédié, `zammad-attachments`, est déclaré ici et
provisionné par le socle, qui accorde également l'accès au compte de service de la
charge de travail. Ce bucket contient les fichiers de pièces jointes de Zammad qui ne
sont pas servis via NFS.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~attachments"
gcloud storage ls gs://<attachments-bucket>/
```

Le partage NFS (`/opt/zammad/storage` par défaut) et ce bucket se complètent : NFS
fournit le système de fichiers partagé en temps réel pour les E/S actives sur les
pièces jointes ; le bucket GCS fournit un stockage d'objets durable.

---

## 7. Aucun secret applicatif généré automatiquement {#7-no-auto-generated-application-secrets}

Contrairement à des modules comme Directus ou Django, Zammad gère ses propres clés de
signature internes à l'exécution. `Zammad_Common` renvoie `secret_ids = {}`. Les seuls
secrets provisionnés automatiquement sont le mot de passe de la base de données et le
mot de passe root de PostgreSQL, tous deux gérés par le module socle et exposés via la
sortie `database_password_secret`. Récupérez le mot de passe de la base de données
avec :

```bash
gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
```

---

Pour la configuration propre à Zammad destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Zammad_GKE](Zammad_GKE.md)** et
**[Zammad_CloudRun](Zammad_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Zammad sur Google Cloud Run](Zammad_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Zammad sur GKE Autopilot](Zammad_GKE.md) — cette configuration déployée sur GKE.
