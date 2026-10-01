---
title: "NocoDB Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module NocoDB — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/NocoDB_Common.md @ 3055034 sha256:7ae65283bc68 -->

# NocoDB Common — Configuration applicative partagée {#nocodb-common--shared-application-configuration}

`NocoDB_Common` est la **couche applicative partagée** de NocoDB. Elle n'est pas
déployée seule ; elle fournit la configuration propre à NocoDB sur laquelle
s'appuient à la fois [NocoDB_GKE](NocoDB_GKE.md) et [NocoDB_CloudRun](NocoDB_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette
couche — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans
la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement NocoDB, consultez les
guides des plateformes ([NocoDB_GKE](NocoDB_GKE.md), [NocoDB_CloudRun](NocoDB_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par NocoDB_Common | Où cela apparaît |
|---|---|---|
| Identifiant JWT | Génère `NC_AUTH_JWT_SECRET` et le stocke dans **Secret Manager** | Injecté à l'exécution ; récupérable via Secret Manager |
| Image de conteneur | Épingle l'image officielle `nocodb/nocodb` et le Dockerfile personnalisé | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Par défaut **Cloud SQL for PostgreSQL 15** ; `NocoDB_Common` code lui-même en dur `POSTGRES_15` | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Définit la tâche `db-init` du premier déploiement, qui crée la base de données et l'utilisateur | Sortie `initialization_jobs` |
| Stockage d'objets | Déclare un bucket **Cloud Storage** (non relié au stockage des pièces jointes de NocoDB) | Sortie `storage_buckets` |
| Paramètres principaux | Correspondance des variables d'environnement NC_DB_*, port de conteneur 8080, injection de `GCS_BUCKET_NAME` (non utilisée par le point d'entrée) | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Sonde de démarrage/d'activité par défaut pointant vers `/api/v1/health` | §Observabilité dans les guides des plateformes |

---

## 2. Identifiant JWT dans Secret Manager {#2-jwt-credential-in-secret-manager}

Le secret JWT de NocoDB (`NC_AUTH_JWT_SECRET`) est généré automatiquement et stocké
sous forme de secret Secret Manager — il n'est jamais défini en clair. Récupérez-le
après le déploiement :

```bash
# List secrets and read the JWT secret:
gcloud secrets list --project "$PROJECT" --filter="name~jwt"
gcloud secrets versions access latest --secret=<jwt-secret-name> --project "$PROJECT"
```

> **N'effectuez pas la rotation de ce secret après le premier déploiement.** NocoDB
> l'utilise pour signer toutes les sessions utilisateur et tous les jetons d'API. Sa
> rotation invalide immédiatement chaque session et chaque jeton actifs ; tous les
> utilisateurs sont déconnectés de force.

Le mot de passe de la base de données est généré et géré séparément par le socle ;
le nom de son secret figure dans les sorties du déploiement de la plateforme
(`database_password_secret`). Consultez [App_Common](App_Common.md) pour le modèle
partagé de secrets et de Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

NocoDB utilise par défaut **PostgreSQL 15** — `NocoDB_Common/main.tf` code en dur
`database_type = "POSTGRES_15"` dans la configuration qu'il renvoie. **Cette valeur
n'est surchargeable que sur `NocoDB_GKE`**, dont le fichier `nocodb.tf` réinjecte
`var.database_type` dans la configuration du module lorsqu'elle est définie ;
`MYSQL_8_0` y fonctionne donc. Le fichier `nocodb.tf` de `NocoDB_CloudRun` ne
comporte pas la surcharge équivalente : sur Cloud Run, la variable `database_type`
du module de plateforme est donc ignorée sans aucun message, et Postgres 15 est
toujours provisionné, quelle que soit la valeur définie par l'opérateur. Au premier
déploiement, une tâche ponctuelle `db-init` se connecte à Cloud SQL et, de manière
idempotente :

1. crée la base de données NocoDB (si elle n'existe pas),
2. crée l'utilisateur de l'application avec le mot de passe généré,
3. accorde à cet utilisateur tous les privilèges sur cette base de données.

La tâche peut être réexécutée sans risque. NocoDB exécute ensuite ses propres
migrations de schéma au démarrage — aucune étape de migration externe n'est
nécessaire. Inspectez directement la base de données avec :

```bash
gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
sorties du déploiement de la plateforme.

---

## 4. Correspondance des variables d'environnement NC_DB_* {#4-nc_db_-environment-variable-mapping}

NocoDB attend les informations de connexion sous forme de variables
d'environnement `NC_DB_*`, et non sous les noms standard `DB_*` injectés par le
socle. `NocoDB_Common` gère cela de deux manières :

- **Image personnalisée (par défaut, `container_image_source = "custom"`).** Un
  Dockerfile enveloppe situé dans `scripts/` s'appuie sur l'image officielle
  `nocodb/nocodb`. Un script de point d'entrée lit les variables standard `DB_*`
  injectées par le socle et les réexporte sous la forme `NC_DB_*` avant de démarrer
  NocoDB. Aucune configuration manuelle n'est nécessaire.
- **Image préconstruite (`container_image_source = "prebuilt"`).** La
  correspondance n'est pas appliquée. Configurez manuellement les variables
  `NC_DB_*` via `environment_variables` dans le module de plateforme.

Les noms de variables d'environnement supplémentaires exposés par le module de
plateforme — `db_host_env_var_name`, `db_port_env_var_name`,
`db_name_env_var_name`, `db_user_env_var_name`, `db_password_env_var_name` et
`service_url_env_var_name` — valent par défaut respectivement `NC_DB_HOST`,
`NC_DB_PORT`, `NC_DB_NAME`, `NC_DB_USER`, `NC_DB_PASSWORD` et `NC_PUBLIC_URL`.

---

## 5. Modèle de connexion Cloud SQL {#5-cloud-sql-connection-model}

Le constructeur d'URL interne de NocoDB n'accepte pas les chemins de socket Unix ;
le socket standard du Cloud SQL Auth Proxy ne peut donc pas être utilisé. Les
valeurs par défaut du module de plateforme diffèrent selon la variante :

- **Cloud Run :** `enable_cloudsql_volume = false` (par défaut). NocoDB se connecte
  à Cloud SQL via son **adresse IP privée** par Direct VPC Egress. L'IP privée est
  injectée sous la forme `DB_HOST` (et `NC_DB_HOST`).
- **GKE :** `enable_cloudsql_volume = true` (par défaut) — le sidecar est injecté,
  mais NocoDB utilise tout de même la **connexion TCP sur IP privée** plutôt que le
  chemin du socket.

Ne forcez le chemin du socket de l'Auth Proxy avec aucune des deux variantes —
NocoDB ne parviendrait pas à analyser l'URL de connexion.

---

## 6. Stockage d'objets — provisionné, non relié aux pièces jointes {#6-object-storage--provisioned-not-wired-to-attachments}

Un bucket **Cloud Storage** (`storage_buckets`, par défaut `name_suffix = "data"`)
est déclaré ici et provisionné par le socle, qui accorde également l'accès au
compte de service de la charge de travail. `NocoDB_CloudRun` et `NocoDB_GKE`
calculent tous deux une valeur `GCS_BUCKET_NAME` et l'injectent dans le conteneur,
mais cela ne fournit **pas** à NocoDB un stockage de pièces jointes fonctionnel
adossé à GCS :

- `NocoDB_Common/scripts/nocodb-entrypoint.sh` ne lit jamais `GCS_BUCKET_NAME` (ni
  aucune autre variable S3/GCS) — NocoDB n'a aucun backend de stockage des pièces
  jointes configuré par ce module et se rabat sur le disque local/éphémère du
  conteneur.
- Indépendamment, la chaîne `GCS_BUCKET_NAME` que chaque variante calcule dans son
  `nocodb.tf` ne correspond au nom d'aucun bucket réellement créé par le socle ; même
  une future correction du point d'entrée nécessiterait donc d'abord de corriger le
  calcul du nom du bucket.

Pour conserver les pièces jointes dans GCS, configurez manuellement les paramètres
de stockage compatible S3 propres à NocoDB (via son interface d'administration ou
`environment_variables`) en les faisant pointer vers un bucket auquel le compte de
service peut accéder. Listez le bucket provisionné avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~uploads"
```

---

## 7. Comportement des sondes de santé {#7-health-probe-behaviour}

Les deux sondes ciblent le point de terminaison de santé dédié de NocoDB, qui
renvoie HTTP 200 lorsque l'application est entièrement initialisée :

| Sonde | Type | Chemin | Délai initial | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage | HTTP | `/api/v1/health` | 30 s | 10 s | 30 |
| Activité | HTTP | `/api/v1/health` | 30 s | 30 s | 3 |

Contrairement à certaines applications PHP qui nécessitent des ajustements de sonde
entre Cloud Run et GKE (par exemple TCP ou HTTP), le point de terminaison de santé
de NocoDB n'émet pas de redirections et fonctionne comme sonde HTTP sur les deux
plateformes.

---

Pour la configuration propre à NocoDB destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[NocoDB_GKE](NocoDB_GKE.md)** et
**[NocoDB_CloudRun](NocoDB_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [NocoDB sur Google Cloud Run](NocoDB_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [NocoDB sur GKE Autopilot](NocoDB_GKE.md) — cette configuration déployée sur GKE.
