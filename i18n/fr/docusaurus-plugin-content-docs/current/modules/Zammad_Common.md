---
title: "Zammad Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Zammad — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Zammad_Common.md @ 15fd4c7 sha256:4b17bfa7dd2f -->

# Zammad Common — Configuration d'application partagée {#zammad-common--shared-application-configuration}

`Zammad_Common` est la **couche d'application partagée** pour Zammad. Elle n'est pas déployée
seule ; elle fournit plutôt la configuration spécifique à Zammad sur laquelle
[Zammad_GKE](Zammad_GKE.md) et [Zammad_CloudRun](Zammad_CloudRun.md) s'appuient,
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a pas d'entrées d'interface utilisateur de déploiement
propres — mais comprendre ce qu'elle fournit explique les valeurs par défaut que
vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Zammad, consultez les guides
de la plateforme ([Zammad_GKE](Zammad_GKE.md), [Zammad_CloudRun](Zammad_CloudRun.md))
et les guides de la fondation ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Zammad_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle `zammad/zammad` et le Cloud Build qui l'étend avec le point d'entrée GCP | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Définit le job de premier déploiement qui crée la base de données, l'utilisateur et les autorisations | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `zammad-attachments` | Sortie `storage_buckets` |
| Paramètres de base | Définit les variables d'environnement Zammad de base (`RAILS_ENV`, `POSTGRESQL_PORT`, `ZAMMAD_RAILSSERVER_*`, `RAILS_TRUSTED_PROXIES`) | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit les configurations par défaut des sondes de démarrage, de vivacité et de disponibilité (HTTP, chemin `/`) | §Observabilité dans les guides de la plateforme |
| Pas de secrets auto-générés | Retourne `secret_ids = {}` — Zammad gère ses propres clés de signature internes à l'exécution | Section des secrets de la plateforme |

---

## 2. Image de conteneur et point d'entrée personnalisé {#2-container-image-and-custom-entrypoint}

L'image officielle `zammad/zammad` attend directement les variables d'environnement
`POSTGRESQL_*`. Les modules de fondation GCP injectent les identifiants de base de
données sous forme de `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_PORT` et `DB_NAME`. Le
`scripts/Dockerfile` personnalisé étend l'image officielle et remplace le point d'entrée par
un `entrypoint.sh` spécifique à GCP qui comble cette lacune au démarrage du conteneur.

À chaque démarrage de conteneur, `entrypoint.sh` effectue les étapes suivantes :

1. **Mappage de variables** — traduit les variables de la fondation `DB_*`
   vers la convention `POSTGRESQL_*` de Zammad. L'utilisateur et le mot de passe sont
   encodés en URL afin que les caractères spéciaux ne cassent pas l'URI `postgres://`.

2. **Solution de contournement TCP Cloud Run** — `docker-entrypoint.sh` de Zammad vérifie la
   disponibilité de PostgreSQL à l'aide d'un socket bash TCP. Sur **Cloud Run**,
   `DB_HOST` est un chemin de socket Unix et n'est pas adressable par TCP ; le
   point d'entrée substitue `DB_IP` (IP privée Cloud SQL) à `POSTGRESQL_HOST`. Sur
   **GKE**, `DB_HOST = 127.0.0.1` (le sidecar cloud-sql-proxy) est adressable par TCP — aucune
   substitution n'est nécessaire.

3. **Construction d'URL Redis** — si `REDIS_URL` n'est pas déjà défini et que
   `REDIS_HOST` est présent, construit `REDIS_URL` à partir de `REDIS_HOST`, `REDIS_PORT` et
   éventuellement `REDIS_AUTH`.

4. **`zammad-init`** — exécute la migration de base de données et l'étape d'amorçage
   de Zammad de manière idempotente avant le démarrage du serveur Rails. Les
   migrations en attente sont appliquées ; celles déjà exécutées sont ignorées.

5. **Processus d'arrière-plan** — démarre `zammad-scheduler` (récupération d'e-mails,
   escalade de tickets, événements temporisés) et `zammad-websocket` (ActionCable sur le
   port 6042) en arrière-plan, puis exécute le serveur Rails. Le planificateur
   obtient son propre pool de connexions de base de données plus grand
   (`?pool=20`, remplaçable par `ZAMMAD_SCHEDULER_DB_POOL`), car ses threads de travail épuisent
   le pool par défaut de Rails de 5 et le planificateur mourrait sinon quelques
   minutes après le démarrage tandis que l'interface utilisateur web continuerait
   à servir.

Récupérez le tag de l'image déployée à partir de la sortie `container_image` :

```bash
gcloud artifacts docker images list <registry-url> --project "$PROJECT"
```

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Zammad 6.x nécessite **PostgreSQL 15 ou ultérieur** ; cette couche fixe `POSTGRES_15`
comme valeur par défaut et les modules de la plateforme rejettent tout autre
moteur au moment de la planification. Lors du premier déploiement, un job
`db-init` ponctuel se connecte à Cloud SQL via le proxy d'authentification et, de
manière idempotente :

1. crée l'utilisateur de la base de données Zammad avec le mot de passe généré,
2. crée la base de données de l'application (si absente),
3. accorde à l'utilisateur tous les privilèges sur la base de données et le
   schéma.

Le job `db-init` utilise l'image `postgres:15-alpine` et exécute le script `scripts/db-init.sh`. Il
peut être réexécuté en toute sécurité. Inspectez la base de données directement :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur se trouvent
dans les sorties de déploiement de la plateforme.

---

## 4. Paramètres d'application de base {#4-core-application-settings}

`Zammad_Common` établit l'environnement de base afin que l'application démarre
correctement au premier démarrage :

- **`RAILS_ENV = "production"` / `NODE_ENV = "production"`** — le mode production
  active la mise en cache des actifs et désactive la sortie de débogage
  détaillée.
- **`POSTGRESQL_PORT = "5432"`** — port de connexion PostgreSQL.
- **`ZAMMAD_RAILSSERVER_HOST = "0.0.0.0"` / `ZAMMAD_RAILSSERVER_PORT = "3000"`** —
  lie le serveur Rails sur toutes les interfaces afin que Cloud Run et GKE
  puissent y acheminer le trafic.
- **`RAILS_SERVE_STATIC_FILES = "true"`** — sert les actifs statiques directement depuis
  Rails ; requis sur Cloud Run où nginx n'est pas dans le chemin de requête.
- **`RAILS_TRUSTED_PROXIES`** — fait confiance au Google Front End de Cloud Run et aux
  plages CGNAT internes afin que les adresses IP des clients soient
  correctement enregistrées.
- **`ELASTICSEARCH_ENABLED = "false"` (par défaut)** — le point d'entrée officiel attend
  indéfiniment un hôte Elasticsearch accessible lorsque celui-ci est `true`.
  Définissez `elasticsearch_url` dans le module de la plateforme pour activer
  Elasticsearch et remplacer cette valeur par défaut.
- **`ZAMMAD_WEBSOCKET_HOST = "0.0.0.0"` / `ZAMMAD_WEBSOCKET_PORT = "6042"`** — lient
  le serveur WebSocket ActionCable sur toutes les interfaces.

Des `environment_variables` supplémentaires passés depuis le module de la plateforme sont
fusionnés par-dessus ces valeurs par défaut.

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Toutes les sondes utilisent par défaut HTTP vers `/` (la page racine/de
connexion de Zammad), qui renvoie HTTP 200 uniquement une fois que
l'application est entièrement initialisée (y compris la migration de schéma au
premier démarrage). Remplacez le `path` sur `startup_probe`/`liveness_probe` pour
cibler le point de terminaison de santé dédié `/api/v1/ping` de Zammad, si
préféré.

- **Sonde de démarrage** — délai initial de 60 secondes, période de 15
  secondes, seuil d'échec de 30. Donne à Zammad jusqu'à ~510 secondes de
  tolérance de démarrage totale pour les grandes bases de données avec de
  nombreuses migrations en attente.
- **Sonde de vivacité** — délai initial de 60 secondes, période de 30
  secondes, seuil d'échec de 3. Redémarre le conteneur après 3 échecs
  consécutifs une fois stable.
- **Sonde de disponibilité (GKE)** — délai initial de 30 secondes, période
  de 10 secondes, seuil d'échec de 3.

Les deux variantes de plateforme utilisent les mêmes sondes HTTP. Contrairement
à certaines applications (par exemple Mautic), Zammad ne nécessite pas de
solution de contournement de sonde TCP — le chemin racine répond via HTTP simple
sans émettre de redirections.

---

## 6. Stockage d'objets {#6-object-storage}

Un bucket **Cloud Storage** `zammad-attachments` dédié est déclaré ici et
provisionné par la fondation, qui accorde également l'accès au compte de
service de la charge de travail. Ce bucket contient les fichiers joints de
Zammad qui ne sont pas servis via NFS.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~attachments"
gcloud storage ls gs://<attachments-bucket>/
```

Le partage NFS (`/opt/zammad/storage` par défaut) et ce bucket se complètent : NFS
fournit le système de fichiers partagé en temps réel pour les E/S actives des
pièces jointes ; le bucket GCS fournit un stockage d'objets durable.

---

## 7. Pas de secrets d'application auto-générés {#7-no-auto-generated-application-secrets}

Contrairement à des modules tels que Directus ou Django, Zammad gère ses
propres clés de signature internes à l'exécution. `Zammad_Common` renvoie
`secret_ids = {}`. Les seuls secrets provisionnés automatiquement sont le mot de
passe de la base de données et le mot de passe root de PostgreSQL, tous deux
gérés par le module de fondation et affichés via la sortie `database_password_secret`.
Récupérez le mot de passe de la base de données avec :

```bash
gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
```

---

Pour la configuration spécifique à Zammad, orientée utilisateur (variables par
groupe, sorties et comment explorer chaque service depuis la Console et la
CLI), consultez les guides de la plateforme : **[Zammad_GKE](Zammad_GKE.md)**
et **[Zammad_CloudRun](Zammad_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Zammad sur Google Cloud Run](Zammad_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Zammad sur GKE Autopilot](Zammad_GKE.md) — cette configuration déployée sur GKE.
