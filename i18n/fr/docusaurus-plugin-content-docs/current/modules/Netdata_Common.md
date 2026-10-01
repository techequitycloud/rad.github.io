---
title: "Netdata Common — Configuration applicative partagée"
description: "Référence de configuration partagée du module Netdata — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Netdata_Common.md @ 3055034 sha256:3bbd61ec3af9 -->

# Netdata Common — Configuration applicative partagée {#netdata-common--shared-application-configuration}

`Netdata_Common` est la **couche applicative partagée** de Netdata. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Netdata sur laquelle
s'appuient à la fois [Netdata_GKE](Netdata_GKE.md) et
[Netdata_CloudRun](Netdata_CloudRun.md), afin que les deux variantes de plateforme se
comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a pas d'entrées propres dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs
par défaut que vous voyez dans la documentation des plateformes.

Netdata est un agent open source de supervision en temps réel de l'infrastructure et
des applications. Il collecte des milliers de métriques par seconde et sert des
tableaux de bord d'une granularité d'une seconde ainsi qu'une API REST sur le port
**19999**. Il n'a **aucune base de données externe** — il stocke ses métriques, son
journal d'alarmes et son état de santé sur le disque local sous `/var/lib/netdata` —
et ne nécessite **ni assistant de premier lancement ni initialisation de schéma**.

Pour l'infrastructure qui provisionne et exécute réellement Netdata, consultez les
guides des plateformes ([Netdata_GKE](Netdata_GKE.md),
[Netdata_CloudRun](Netdata_CloudRun.md)) et les guides des fondations
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Netdata_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Wrapper léger `FROM netdata/netdata:<version>` construit via Cloud Build (Kaniko) et mis en miroir dans **Artifact Registry** | Output `container_image` du déploiement de la plateforme |
| Épinglage de la version de l'image | Argument de build propre à l'application `NETDATA_VERSION` (vaut `v2.2.6` par défaut lorsque `application_version = "latest"`) | Configuration du build |
| Moteur de base de données | **Aucun** — `database_type = "NONE"` ; Netdata conserve ses métriques dans son propre dbengine sur disque | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | **Aucune** — aucun job `db-init` n'est injecté ; seuls les `initialization_jobs` fournis par l'utilisateur s'exécutent | Output `initialization_jobs` |
| Stockage d'objets | Déclare un bucket de données **Cloud Storage** (suffixe `storage`) qui fait persister `/var/lib/netdata` sur Cloud Run | Output `storage_buckets` |
| Volume de persistance | Monte le bucket de stockage comme volume **GCS FUSE** sur `/var/lib/netdata` (`enable_gcs_storage_volume`), désactivé sur GKE lorsqu'un PVC en mode bloc est utilisé | §Persistance |
| Identifiant administrateur facultatif | Lorsque `enable_admin_password = true`, génère un mot de passe de 32 caractères dans **Secret Manager** et l'injecte en tant que `NETDATA_ADMIN_PASSWORD` | Outputs `secret_ids` / `secret_values` |
| Paramètres de base | Définit `NETDATA_LISTENER_PORT = "19999"` (correspond à `container_port`) | Comportement de l'application |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/v1/info` | §Observabilité dans les guides des plateformes |

---

## 2. Image de conteneur et build {#2-container-image-and-build}

Netdata est une **image amont préconstruite**, mais ce module la fait tout de même
passer par le chemin Cloud Build de la fondation afin que l'image soit mise en miroir
dans l'Artifact Registry du déploiement (ce qui évite un téléchargement depuis Docker
Hub à l'exécution). Le `Dockerfile` est un wrapper léger :

```dockerfile
ARG NETDATA_VERSION=v2.2.6
FROM netdata/netdata:${NETDATA_VERSION}
```

- **`image_source = "custom"`** avec `container_build_config.enabled = true`.
- **`NETDATA_VERSION` est un argument de build propre à l'application**, délibérément
  *distinct* du `APP_VERSION` générique que la fondation injecte. Lorsque
  `application_version = "latest"`, le wrapper épingle `v2.2.6` (un vrai tag) plutôt
  qu'un build de wrapper `netdata:latest` inexistant ; toute valeur explicite de
  `application_version` est respectée telle quelle.
- Aucun point d'entrée personnalisé n'est ajouté — le point d'entrée de l'image amont
  démarre l'agent.

Inspectez l'image construite/mise en miroir :

```bash
gcloud artifacts docker images list \
  <region>-docker.pkg.dev/$PROJECT/<repo>/netdata --project "$PROJECT"
```

---

## 3. Aucune base de données, aucun job d'initialisation {#3-no-database-no-bootstrap-job}

Netdata n'utilise **ni** Cloud SQL, ni MySQL, ni PostgreSQL, ni aucune base de
données gérée :

- `database_type = "NONE"`, `enable_cloudsql_volume = false`, `db_name`/`db_user`
  sont vides dans la configuration Common (les variables `db_name`/`db_user` des
  variantes n'existent que pour la compatibilité avec la fondation et ne sont pas
  référencées).
- **Aucun job `db-init` n'est injecté.** La liste `initialization_jobs` est vide,
  sauf si un opérateur fournit des jobs personnalisés (par exemple pour amorcer une
  configuration ou migrer des données) ; Netdata n'en a besoin d'aucun pour démarrer.
- Il n'y a **aucune migration de schéma** au démarrage — l'agent écrit sa base de
  métriques round-robin directement sur le disque.

---

## 4. Persistance et stockage d'objets {#4-persistence-and-object-storage}

Netdata fait persister sa base de métriques (dbengine), son journal d'alarmes et son
état de santé sous **`/var/lib/netdata`** ; `/var/cache/netdata` contient le cache
round-robin éphémère. La manière dont `/var/lib/netdata` est adossé diffère selon la
plateforme, et cette couche câble les deux :

- **Cloud Run** — le bucket Cloud Storage déclaré est monté comme volume **GCS FUSE**
  sur `/var/lib/netdata` (`enable_gcs_storage_volume = true`). Un bucket de données
  est déclaré dans l'output `storage_buckets` (suffixe `storage`, classe `STANDARD`,
  `force_destroy = true`, `public_access_prevention = enforced`). Son emplacement est
  laissé vide afin que la fondation le place dans la région de déploiement découverte
  automatiquement.
- **GKE** — un **PVC en mode bloc** par pod (StatefulSet) est monté sur le même
  `/var/lib/netdata` ; le wrapper définit alors `enable_gcs_storage_volume = false`
  pour éviter un double montage sur le même chemin. Le stockage en mode bloc est
  requis sur GKE, car GCS FUSE ne peut pas fournir la sémantique de système de
  fichiers dont ont besoin les fichiers SQLite/dbengine de Netdata.

Listez le bucket de données :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
```

---

## 5. Mot de passe administrateur facultatif dans Secret Manager {#5-optional-admin-password-in-secret-manager}

Le tableau de bord local de Netdata est **non authentifié par défaut**. Lorsque
`enable_admin_password = true`, cette couche :

1. Génère un mot de passe aléatoire de **32 caractères** (`random_password`, sans
   caractères spéciaux),
2. Le stocke dans Secret Manager sous le nom
   `secret-<wrapper_prefix>-netdata-admin-password`,
3. L'injecte dans le conteneur en tant que variable d'environnement
   **`NETDATA_ADMIN_PASSWORD`**, afin qu'une couche d'authentification côté opérateur
   (un reverse proxy faisant de l'authentification basique, ou un flux de
   rattachement à Netdata Cloud) puisse référencer un identifiant stable adossé à un
   secret plutôt qu'un identifiant géré à la main.

Le chemin d'injection diffère selon la plateforme : **Cloud Run** l'injecte via les
`module_secret_env_vars` de la fondation (Secret Manager → variable d'environnement
secrète), tandis que **GKE** l'injecte via `explicit_secret_values` (un Secret
Kubernetes natif), de sorte que les deux variantes fournissent la même valeur brute.
Lorsque `enable_admin_password = false`, aucun secret n'est créé et l'output
`secret_ids` est vide.

Récupérez-le après le déploiement :

```bash
# Find the secret (name includes the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"

# Read the current value:
gcloud secrets versions access latest \
  --secret=secret-<wrapper_prefix>-netdata-admin-password --project "$PROJECT"
```

Un sous-module de nettoyage des secrets orphelins s'exécute en premier, afin qu'un
redéploiement après une destruction antérieure n'entre pas en collision sur le nom du
secret.

---

## 6. Paramètres de base, port et sondes de santé {#6-core-settings-port-and-health-probes}

`Netdata_Common` établit l'environnement de base afin que l'agent démarre
correctement dès le premier lancement :

- **Port d'écoute** — `NETDATA_LISTENER_PORT = "19999"`, correspondant au
  `container_port` vers lequel la fondation achemine le trafic. Netdata sert à la
  fois le tableau de bord et l'API REST sur ce port unique.
- **Chemin de santé** — les sondes de démarrage et de vivacité par défaut ciblent
  **`/api/v1/info`**, qui renvoie un corps JSON `200` une fois l'agent entièrement
  initialisé, et continue de le faire tant qu'il s'exécute. La sonde de démarrage
  prévoit un délai initial de 15 secondes et une fenêtre de 10 tentatives ; la sonde
  de vivacité interroge toutes les 30 secondes après un délai de 30 secondes.
- **Mise à l'échelle** — `min_instance_count = 1` / `max_instance_count = 1` par
  défaut. Netdata est un agent de supervision **par instance** : chaque réplique
  conserve sa propre base de métriques locale ; il ne peut donc pas être étendu
  horizontalement avec un état partagé — exécuter une seule instance est la norme.
- **Les variables d'environnement supplémentaires** fournies via
  `environment_variables` sont fusionnées par-dessus la base ; il n'y a aucun autre
  paramètre applicatif obligatoire.

---

Pour la configuration propre à Netdata exposée aux utilisateurs (variables par
groupe, outputs, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Netdata_GKE](Netdata_GKE.md)** et
**[Netdata_CloudRun](Netdata_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Netdata sur Google Cloud Run](Netdata_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Netdata sur GKE Autopilot](Netdata_GKE.md) — cette configuration déployée sur GKE.
