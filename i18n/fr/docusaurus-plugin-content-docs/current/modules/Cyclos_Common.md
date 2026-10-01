---
title: "Cyclos Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Cyclos — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Cyclos_Common.md @ 3055034 sha256:2807052fd31b -->

# Cyclos Common — Configuration applicative partagée {#cyclos-common--shared-application-configuration}

`Cyclos_Common` est la **couche applicative partagée** de Cyclos. Elle n'est pas déployée
seule ; elle fournit la configuration propre à Cyclos sur laquelle s'appuient à la fois
[Cyclos_GKE](Cyclos_GKE.md) et [Cyclos_CloudRun](Cyclos_CloudRun.md), afin que les
deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais
cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Cyclos, consultez les guides des plateformes
([Cyclos_GKE](Cyclos_GKE.md), [Cyclos_CloudRun](Cyclos_CloudRun.md)) et les guides du
socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Cyclos_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Épingle l'image officielle `cyclos/cyclos` et la configuration de build qui l'encapsule | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL for PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Extensions PostgreSQL | Déclare les six extensions requises installées par `db-init` | Output `initialization_jobs` |
| Amorçage de la base de données | Définit la tâche `db-init` du premier déploiement qui crée l'utilisateur, la base de données et installe les extensions | Output `initialization_jobs` |
| Stockage de fichiers GCS | Définit `cyclos.storedFileContentManager = gcs` et dérive le nom du bucket du préfixe de ressource | Output `storage_buckets` ; variables d'environnement injectées automatiquement |
| Environnement principal | Injecte `DB_HOST`, `DB_PORT`, `CYCLOS_HOME` et le nom du bucket GCS | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la configuration par défaut des sondes de démarrage et de vivacité (HTTP `/api` avec des délais JVM étendus) | §Observabilité dans les guides des plateformes |

---

## 2. Moteur de base de données et amorçage {#2-database-engine-and-bootstrap}

Cyclos exige **PostgreSQL 15** ; le moteur est fixe et MySQL n'est pas pris en charge.
Lors du premier déploiement, une tâche ponctuelle `db-init` se connecte à Cloud SQL avec le
superutilisateur `postgres` et, de manière idempotente :

1. Crée l'utilisateur de base de données Cyclos (`cyclos`) avec le mot de passe généré depuis Secret
   Manager.
2. Crée la base de données de l'application Cyclos si elle est absente.
3. Installe les six extensions PostgreSQL requises en tant que superutilisateur.
4. Accorde à l'utilisateur de l'application tous les privilèges sur la base de données et définit les valeurs par défaut pour les futurs
   objets.
5. Signale au Cloud SQL Proxy (lorsqu'il est présent) de s'arrêter proprement.

La tâche peut être relancée sans risque. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=cyclos --database=cyclos --project "$PROJECT"
# Inside psql — confirm extensions:
# \dx
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les outputs du déploiement de la plateforme.

---

## 3. Extensions PostgreSQL {#3-postgresql-extensions}

Les extensions suivantes sont installées automatiquement avant le démarrage de Cyclos :

| Extension | Rôle |
|---|---|
| `pg_trgm` | Recherche textuelle par trigrammes et correspondance par similarité pour la recherche de membres et de transactions |
| `uuid-ossp` | Fonctions de génération d'UUID utilisées pour les identifiants des entités Cyclos |
| `cube` | Type de données cube multidimensionnel — prérequis pour `earthdistance` |
| `earthdistance` | Calculs de distances géographiques pour les fonctionnalités fondées sur la localisation |
| `postgis` | Prise en charge complète des requêtes géospatiales |
| `unaccent` | Recherche textuelle insensible aux accents Unicode |

Ces extensions doivent être créées par le superutilisateur PostgreSQL — la tâche `db-init` s'en charge
automatiquement. Vous n'avez pas besoin de définir `enable_postgres_extensions = true` dans le
module de la plateforme.

---

## 4. Stockage de fichiers GCS {#4-gcs-file-storage}

Un bucket **Cloud Storage** dédié est déclaré ici avec le suffixe `storage` ; le
socle le nomme et le provisionne. Le bucket stocke tous les fichiers téléversés dans Cyclos, les photos
de profil et les pièces jointes de transactions. Deux variables d'environnement sont injectées automatiquement :

- `cyclos.storedFileContentManager` → `gcs`
- `cyclos.storedFileContentManager.bucketName` → `gcs-<application_name><resource_prefix>-storage`, conformément au nommage `gcs-${service_name}-${name_suffix}` propre au socle

NFS est désactivé pour le conteneur Cyclos — GCS est le seul backend de fichiers pris en charge pour
les déploiements Cyclos conteneurisés.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name:cyclos"
```

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Cyclos_Common` établit l'environnement d'exécution de base de Cyclos :

- **Connexion à la base de données** — `DB_HOST` est défini sur `/var/run/postgresql` (chemin du socket
  PostgreSQL) comme base ; les modules de plateforme le remplacent par l'adresse IP réelle de Cloud SQL ou le chemin
  du socket. `DB_PORT` est défini sur `5432`.
- **Répertoire Cyclos** — `CYCLOS_HOME` est défini sur `/usr/local/cyclos` dans le conteneur.
- **Gestion du schéma** — `cyclos.db.managed = true` et `cyclos.db.skipLock = true` sont
  intégrés à `cyclos.properties`, ce qui permet la création et l'évolution automatiques du schéma au
  démarrage sans verrouillage distribué (requis pour les déploiements serverless/Autopilot).
- **Clustering** — vaut `none` par défaut (instance unique). Définissez `cyclos.clusterHandler =
  hazelcast` via `environment_variables` pour activer la découverte DNS Kubernetes du `hazelcast.xml`
  fourni, pour les déploiements multi-pods.

Ajustements propres à chaque plateforme gérés ici :

- **Cloud Run** — `DB_HOST` est remplacé par l'adresse IP privée de Cloud SQL pour une connexion TCP
  directe (`enable_cloudsql_volume = false` par défaut).
- **GKE** — `DB_HOST` pointe par défaut vers l'adresse IP privée de Cloud SQL en TCP direct.
  `enable_cloudsql_volume` vaut `true` par défaut sur GKE et y est obligatoire ; le sidecar Auth Proxy
  s'ajoute sans changer la manière dont Cyclos se connecte.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent le point de terminaison `/api` de Cyclos, qui ne renvoie HTTP 200 qu'une fois
l'application entièrement initialisée et le schéma validé. Des délais généreux tiennent compte
du démarrage de la JVM et de la phase de création du schéma au premier déploiement (2 à 5 minutes).

- **GKE** utilise des sondes HTTP pour le démarrage et la vivacité — le trafic des sondes internes au cluster
  atteint directement le conteneur sans problème de routage.
- **Cloud Run** utilise une sonde de démarrage **TCP**. Lors d'une mise à jour progressive, une nouvelle instance
  Cloud Run doit acquérir le verrou d'initialisation de la base de données Cyclos, que l'ancienne instance
  détient encore. Une sonde HTTP sur `/api` ne réussirait jamais avant l'initialisation complète de Cyclos,
  ce qui créerait un interblocage. Une sonde TCP réussit dès que Tomcat écoute (~32 secondes),
  ce qui permet au trafic de basculer vers la nouvelle révision, laquelle envoie SIGTERM à l'ancienne instance
  et libère le verrou. La sonde de vivacité utilise ensuite HTTP `/api` pour détecter tout
  contexte Spring non initialisé et déclencher un redémarrage propre.

---

## 7. Image de conteneur et Dockerfile {#7-container-image-and-dockerfile}

`Cyclos_Common` utilise `container_image = "cyclos/cyclos"` avec `image_source = "prebuilt"`.
Un `Dockerfile` est fourni dans le répertoire `scripts/` ; il encapsule l'image officielle
`cyclos/cyclos:<version>` en copiant `cyclos.properties` et `hazelcast.xml` dans
le conteneur. Cela permet d'intégrer des fichiers de propriétés personnalisés à l'image sans
modifier l'image amont.

Fichiers pertinents dans `scripts/` :

| Fichier | Rôle |
|---|---|
| `Dockerfile` | Encapsule `cyclos/cyclos:<version>` ; copie `cyclos.properties` et `hazelcast.xml` |
| `db-init.sh` | Script de configuration PostgreSQL idempotent — crée l'utilisateur, la base de données et installe les six extensions |
| `cyclos.properties` | Configuration principale de Cyclos — pool de base de données, gestion du schéma, stockage de fichiers GCS, clustering, journalisation |
| `hazelcast.xml` | Configuration facultative du cluster Hazelcast pour les déploiements Kubernetes multi-pods |

---

Pour la configuration propre à Cyclos destinée aux utilisateurs (variables par groupe, outputs et manière
d'explorer chaque service depuis la console et la CLI), consultez les guides des plateformes :
**[Cyclos_GKE](Cyclos_GKE.md)** et **[Cyclos_CloudRun](Cyclos_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Cyclos sur Google Cloud Run](Cyclos_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Cyclos sur GKE Autopilot](Cyclos_GKE.md) — cette configuration déployée sur GKE.
