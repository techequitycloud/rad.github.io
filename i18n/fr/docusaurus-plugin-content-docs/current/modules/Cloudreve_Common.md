---
title: "Cloudreve Common — Configuration d'application partagée"
description: "Référence de configuration partagée pour le module Cloudreve — paramètres de la couche application consommés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Cloudreve_Common.md @ 15fd4c7 sha256:4e6d8bbbac4a -->

# Cloudreve Common — Configuration d'application partagée {#cloudreve-common--shared-application-configuration}

`Cloudreve_Common` est la **couche d'application partagée** pour Cloudreve. Il n'est pas
déployé seul ; il fournit plutôt la configuration spécifique à Cloudreve
sur laquelle s'appuient à la fois [Cloudreve_GKE](Cloudreve_GKE.md) et
[Cloudreve_CloudRun](Cloudreve_CloudRun.md), de sorte que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette
couche directement — elle n'a pas d'entrées d'interface utilisateur de déploiement propres — mais comprendre
ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation de la plateforme.

Pour l'infrastructure qui provisionne et exécute Cloudreve, consultez les
guides de la plateforme ([Cloudreve_GKE](Cloudreve_GKE.md),
[Cloudreve_CloudRun](Cloudreve_CloudRun.md)) et les guides de base
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que cette couche fournit {#1-what-this-layer-provides}

| Domaine | Fourni par Cloudreve_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | **Aucun généré.** Cloudreve génère son propre mot de passe administrateur initial en interne lors du premier démarrage et l'imprime dans les journaux du conteneur | Journaux du conteneur uniquement — les sorties `secret_ids` / `secret_values` sont toutes deux des cartes vides |
| Image de conteneur | Encapsule l'image officielle `cloudreve/cloudreve` dans un Dockerfile multi-étapes qui déplace le binaire `cloudreve` hors du répertoire de données monté ; construit via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Corrige `database_type = "NONE"` — Cloudreve utilise une base de données SQLite embarquée sur son volume persistant, jamais Cloud SQL | §Base de données dans les guides de la plateforme |
| Amorçage de la base de données | Aucun. Aucun job `db-init`/`db-create` par défaut n'est injecté ; `initialization_jobs` n'exécute que les jobs fournis explicitement par l'opérateur | Sortie `initialization_jobs` (vide par défaut) |
| Stockage d'objets | Déclare un seul bucket Cloud Storage `storage`, monté conditionnellement à `/cloudreve` via GCS FUSE | Sortie `storage_buckets` |
| Paramètres de base | Minimal — `environment_variables` est transmis directement sans valeurs par défaut injectées ; `container_port` est fixé à `5212`, `database_type`/`db_name`/`db_user`/`enable_cloudsql_volume` sont codés en dur sur off | Comportement de l'application dans les guides de la plateforme |
| Vérifications de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/` — Cloudreve n'a pas de point de terminaison de santé dédié | §Observabilité dans les guides de la plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager. Cloudreve v3 n'a pas
de credential administrateur injectable et pas de variable d'environnement de clé API côté serveur :
il génère son propre compte administrateur initial et son mot de passe en interne lors du premier
démarrage et imprime le mot de passe dans la sortie standard/erreur du conteneur. Il n'y a
rien à générer, stocker ou faire pivoter pour cette couche.

Les sorties `secret_ids` et `secret_values` sont toutes deux des **cartes
intentionnellement vides** — conservées uniquement pour que `Cloudreve_CloudRun` et `Cloudreve_GKE` puissent câbler
`module_secret_env_vars` / `explicit_secret_values` uniformément avec tous les autres
modules d'application, comme si un vrai secret existait.

Parce que le mot de passe n'est jamais stocké dans Secret Manager, il n'y a pas de
commande `gcloud secrets` qui le récupère. Capturez-le des journaux
immédiatement après le premier déploiement, avant que le tampon de journal ne tourne :

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 200 \
  | grep -i "admin\|password"

# GKE
kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
```

Une fois récupéré, changez le mot de passe via l'interface web de Cloudreve — il n'y a pas
d'autre chemin de récupération s'il est perdu.

Si l'opérateur fournit `secret_environment_variables` sur le déploiement de la plateforme
(pour un cas d'utilisation sans rapport avec les propres credentials de Cloudreve), ceux-ci
sont toujours injectés via le mécanisme standard de Secret Manager géré par
la fondation — voir [App_Common](App_Common.md).

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Cloudreve ne nécessite **aucune base de données externe**. `database_type` est fixé à
`"NONE"` dans la sortie `config` du module (avec `db_name = ""` et
`db_user = ""`), et `enable_cloudsql_volume` est codé en dur à `false` — aucune
instance Cloud SQL, base de données ou utilisateur n'est jamais provisionné pour cette
application, quelle que soit la valeur de toute variable `database_*`/`db_*`/`sql_*`
sur le déploiement de la plateforme (ces variables sont transmises uniquement pour
la compatibilité de l'interface de la Fondation et sont des no-ops ici).

Cloudreve utilise plutôt une **base de données SQLite embarquée** (`cloudreve.db`)
ainsi qu'un `conf.ini` généré et des fichiers téléchargés, tous stockés sous son
répertoire de travail `/cloudreve` (téléchargements et avatars dans `/cloudreve/data/`, que
le point d'entrée lie en place car l'image déclare `/cloudreve/uploads`
et `/cloudreve/avatar` comme VOLUMEs, que GKE soutient avec un disque de nœud éphémère) sur le volume persistant (un partage NFS sur Cloud
Run par défaut, un PVC de bloc sur GKE). Il n'y a donc pas de job `db-init` non plus :

```hcl
# main.tf
initialization_jobs = length(var.initialization_jobs) > 0 ? [ ... ] : []
```

`Cloudreve_Common` n'injecte jamais de job par défaut ici — seuls les jobs fournis par l'opérateur
s'exécutent. Au premier démarrage, Cloudreve lui-même crée le schéma SQLite sur le
volume monté et initialise le compte administrateur initial (voir §2) ; il n'y a pas
d'étape de migration distincte à exécuter ou à surveiller.

Pour inspecter directement le fichier SQLite :

```bash
# Cloud Run — no shell access to the running container; use a one-off exec
# via the platform's job mechanism, or GCS FUSE from an authorized workstation.
gcloud storage ls gs://<data-bucket>/

# GKE — exec into the pod directly
kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /cloudreve
kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- sqlite3 /cloudreve/cloudreve.db ".tables"
```

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

L'image personnalisée encapsule `cloudreve/cloudreve:${CLOUDREVE_VERSION}` — épinglée via
un **ARG de build spécifique à l'application** (`CLOUDREVE_VERSION`, pas le générique
`APP_VERSION` que la Fondation injecte et qui forcerait autrement le
tag non résoluble `latest`). `application_version = "latest"` se résout à la
dernière version v3 vérifiée compatible, `3.8.3`, dont la disposition des données correspond à ce
module (SQLite embarqué à `/cloudreve/cloudreve.db`, téléchargements sous
`/cloudreve/uploads`, mot de passe administrateur imprimé dans les journaux au premier démarrage).

Contrairement à la plupart des modules d'application à build personnalisé, il n'y a **pas de script
de point d'entrée shell** et pas de logique de traduction de variables d'environnement d'exécution. Le Dockerfile
(`modules/Cloudreve_Common/scripts/Dockerfile`) existe uniquement pour corriger un problème de
**masquage de volume** et rien d'autre :

```dockerfile
ARG CLOUDREVE_VERSION=3.8.3
FROM cloudreve/cloudreve:${CLOUDREVE_VERSION} AS src

FROM cloudreve/cloudreve:${CLOUDREVE_VERSION}
COPY --from=src /cloudreve/cloudreve /usr/local/bin/cloudreve
WORKDIR /cloudreve
ENTRYPOINT ["/usr/local/bin/cloudreve"]
```

L'image `cloudreve/cloudreve` d'amont conserve **à la fois** le binaire `cloudreve`
et ses données (`cloudreve.db`, `conf.ini`, `uploads/`) dans le même répertoire,
`/cloudreve`. Monter un nouveau volume persistant (bucket GCS FUSE sur Cloud
Run, PVC de bloc sur GKE) à ce chemin pour persister les données **masquerait également le
binaire en dessous**, produisant `exec ./cloudreve: no such file or
directory` au démarrage du conteneur (une boucle de crash). La solution est un build multi-étapes :
la première étape (`AS src`) est juste un handle sur l'image amont vierge ;
l'étape finale `COPY --from=src` le binaire vers `/usr/local/bin/cloudreve`
— un chemin qui n'est jamais monté par-dessus — et définit `ENTRYPOINT` à ce chemin
absolu, tandis que `WORKDIR` reste `/cloudreve` afin que l'application lise/écrive toujours ses
données persistantes sur le volume exactement comme elle s'y attend. C'est précisément pourquoi
Cloudreve est construit comme une **image personnalisée** (`image_source = "custom"`,
`container_build_config.enabled = true`) plutôt qu'un simple passage direct du
tag amont.

Parce que la correction se trouve dans le Dockerfile, la modifier nécessite une reconstruction de l'image
— un échec de déclenchement de hachage de contenu peut être forcé avec :

```bash
tofu taint 'module.app_<cloudrun|gke>.module.app_build.null_resource.build_and_push_application_image[0]'
```

Aucune traduction de variable d'environnement, correction d'URL ou script de démarrage
ne se produit dans cette couche — `environment_variables` passés depuis le
déploiement de la plateforme atteignent le conteneur complètement non modifiés (voir §5).

---

## 5. Paramètres d'application de base {#5-core-application-settings}

La sortie `Cloudreve_Common` de `config` est délibérément minimale par rapport à la plupart des
modules Common d'application — Cloudreve n'a presque pas besoin d'environnement de base
pour démarrer correctement, car il n'a pas de DSN de base de données piloté par des variables d'environnement, pas de
remplacement de répertoire de données, et pas de bascules de file d'attente/télémétrie :

- **`environment_variables`** — transmis directement depuis la variable `environment_variables`
  du déploiement de la plateforme avec **aucune valeur par défaut
  injectée**. Cloudreve n'a pas de variable d'environnement de répertoire de données (il utilise
  des chemins relatifs depuis son répertoire de travail), donc rien n'a besoin d'être défini pour
  un premier démarrage correct.
- **`container_port`** — codé en dur à `5212` directement dans la sortie `config`
  (non dérivé d'une variable), correspondant au port d'écoute interne fixe de Cloudreve.
- **`database_type` / `db_name` / `db_user`** — codé en dur à `"NONE"` / `""` /
  `""` ; **`enable_cloudsql_volume`** codé en dur à `false`. Aucun de ceux-ci n'est
  configurable par déploiement car Cloudreve n'a pas de base de données.
- **`min_instance_count` / `max_instance_count`** — transmis depuis les
  variables du même nom, toutes deux par défaut à `1`. Cloudreve n'a pas de
  mode multi-nœuds/clustering vérifié, et l'exécution de plus d'une instance
  risque des écritures concurrentes sur le même fichier SQLite à un seul rédacteur.
- **`container_resources`** — fusionne `cpu_limit`/`memory_limit` (ou un
  remplacement complet `container_resources`) avec `cpu_request`/`mem_request`/stockage
  éphémère laissé `null`, permettant à la fondation d'appliquer ses propres valeurs par défaut pour les
  champs non définis.

Ajustement spécifique à la plateforme géré ici (via la variable `enable_gcs_storage_volume`
et la locale `_cloudreve_extra_storage_volumes`) :

- **Cloud Run** définit `enable_gcs_storage_volume = !enable_nfs`. Cloud Run n'a
  pas de volume de bloc, et GCS FUSE ne peut pas héberger la base de données SQLite, donc
  `Cloudreve_CloudRun` par défaut `enable_nfs = true` avec le partage NFS monté
  à `/cloudreve` ; le montage GCS FUSE n'est utilisé que si NFS est désactivé.
- **GKE** définit `enable_gcs_storage_volume = false` chaque fois que
  `stateful_pvc_enabled = true` (la valeur par défaut de la variante GKE), car le
  PVC de bloc est monté au même chemin `/cloudreve` et un deuxième montage GCS FUSE
  là entrerait en conflit. Avec le PVC de bloc en place, le bucket `storage`
  existe toujours (voir §7) mais reste non monté.

---

## 6. Comportement de la sonde de santé {#6-health-probe-behaviour}

`Cloudreve_Common` définit les variables `startup_probe` et `liveness_probe`
que les deux variantes de plateforme transmettent inchangées — il n'y a **pas de différence
CloudRun vs. GKE** dans la configuration de la sonde pour Cloudreve, contrairement aux applications
dont les valeurs par défaut GKE et Cloud Run divergent. Cloudreve n'a pas de point de terminaison de santé dédié
distinct de son interface web ; `/` renvoie HTTP 200 une fois que le serveur
sert les requêtes.

- **Sonde de démarrage** — HTTP `GET /`, `initial_delay_seconds = 15`,
  `timeout_seconds = 5`, `period_seconds = 10`, `failure_threshold = 10`
  (c'est-à-dire jusqu'à ~100 secondes après le délai initial pour être prêt).
- **Sonde de vivacité** — HTTP `GET /`, `initial_delay_seconds = 30`,
  `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

Les deux sondes sont déclarées comme des variables `object` complètes avec des valeurs par défaut dans
`Cloudreve_Common/variables.tf` et transmises via la sortie `config` comme
`startup_probe`/`liveness_probe` ; les variantes de plateforme peuvent les remplacer via
leurs propres variables `startup_probe`/`liveness_probe`, mais sont livrées avec ces
valeurs inchangées.

---

## 7. Stockage d'objets {#7-object-storage}

Un seul bucket **Cloud Storage** (`name_suffix = "storage"`) est déclaré dans
la sortie `storage_buckets` et provisionné par la fondation :

- `location = ""` — laissé vide afin que la fondation le résolve via
  `coalesce(bucket.location, local.region)`, plaçant le bucket dans la
  région de déploiement auto-découverte plutôt que d'épingler un emplacement qui pourrait
  forcer un remplacement destructeur lors d'un nouvel apply dans une région différente.
- `storage_class = "STANDARD"`, `force_destroy = true`,
  `versioning_enabled = false`, `public_access_prevention = "enforced"`, aucune
  règle de cycle de vie.

Le fait que ce bucket soit réellement **monté** dans le conteneur en cours d'exécution
dépend de `enable_gcs_storage_volume` (voir §5) : lorsque `true`, il est ajouté à
`gcs_volumes` comme `{ name = "storage", mount_path = "/cloudreve", read_only =
false }` et monté via GCS FUSE — sur Cloud Run uniquement lorsque NFS est désactivé, et
sur GKE uniquement lorsque le PVC de bloc est désactivé. Lorsqu'il est monté au même chemin qu'un
PVC de bloc GKE, les deux se monteraient en double et entreraient en conflit, ce qui est exactement
la raison pour laquelle la variante GKE désactive ce drapeau par défaut.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

Pour la configuration spécifique à Cloudreve et orientée utilisateur (variables par groupe,
sorties, et comment explorer chaque service depuis la Console et la CLI), consultez les
guides de la plateforme : **[Cloudreve_GKE](Cloudreve_GKE.md)** et
**[Cloudreve_CloudRun](Cloudreve_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Cloudreve sur GKE Autopilot](Cloudreve_GKE.md) — cette configuration déployée sur GKE.
