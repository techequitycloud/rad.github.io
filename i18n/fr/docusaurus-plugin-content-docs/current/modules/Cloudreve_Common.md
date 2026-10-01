---
title: "Cloudreve Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Cloudreve — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Cloudreve_Common.md @ 3055034 sha256:7a243b9894dc -->

# Cloudreve Common — Configuration applicative partagée {#cloudreve-common--shared-application-configuration}

`Cloudreve_Common` est la **couche applicative partagée** de Cloudreve. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Cloudreve sur laquelle
reposent à la fois [Cloudreve_GKE](Cloudreve_GKE.md) et
[Cloudreve_CloudRun](Cloudreve_CloudRun.md), de sorte que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a aucune entrée
d'interface de déploiement qui lui soit propre — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Cloudreve, consultez les
guides de plateforme ([Cloudreve_GKE](Cloudreve_GKE.md),
[Cloudreve_CloudRun](Cloudreve_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Cloudreve_Common | Où cela apparaît |
|---|---|---|
| Secrets cryptographiques | **Aucun n'est généré.** Cloudreve crée en interne son propre mot de passe administrateur initial au premier démarrage et l'affiche dans les journaux du conteneur | Uniquement dans les journaux du conteneur — les outputs `secret_ids` / `secret_values` sont tous deux des maps vides |
| Image de conteneur | Encapsule l'image officielle `cloudreve/cloudreve` dans un Dockerfile multi-étapes qui sort le binaire `cloudreve` du répertoire de données monté ; build via Cloud Build | Output `container_image` du déploiement de plateforme |
| Moteur de base de données | Fixe `database_type = "NONE"` — Cloudreve utilise une base SQLite intégrée sur son volume persistant, jamais Cloud SQL | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | Aucun. Aucun job `db-init`/`db-create` par défaut n'est injecté ; `initialization_jobs` n'exécute que les jobs fournis explicitement par l'opérateur | Output `initialization_jobs` (vide par défaut) |
| Stockage objet | Déclare un unique bucket Cloud Storage `storage`, monté sous condition sur `/cloudreve` via GCS FUSE | Output `storage_buckets` |
| Paramètres de base | Minimaux — `environment_variables` est transmis tel quel sans valeurs par défaut injectées ; `container_port` est fixé à `5212`, `database_type`/`db_name`/`db_user`/`enable_cloudsql_volume` sont désactivés en dur | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit les sondes de démarrage/vivacité par défaut ciblant `/` — Cloudreve n'a pas de point de terminaison de santé dédié | §Observabilité dans les guides de plateforme |

---

## 2. Secrets cryptographiques dans Secret Manager {#2-cryptographic-secrets-in-secret-manager}

`Cloudreve_Common` ne crée **aucun** secret Secret Manager. Cloudreve v3 n'a ni
identifiant administrateur injectable ni variable d'environnement de clé d'API côté
serveur : il génère en interne son propre compte et mot de passe administrateur
initiaux au premier démarrage et affiche le mot de passe sur la sortie
stdout/stderr du conteneur. Cette couche n'a rien à générer, stocker ni faire
tourner.

Les outputs `secret_ids` et `secret_values` sont tous deux des **maps
volontairement vides** — conservées uniquement pour que `Cloudreve_CloudRun` et
`Cloudreve_GKE` puissent câbler `module_secret_env_vars` / `explicit_secret_values`
de manière uniforme avec tous les autres modules applicatifs, comme si un véritable
secret existait.

Comme le mot de passe n'est jamais stocké dans Secret Manager, aucune commande
`gcloud secrets` ne permet de le récupérer. Capturez-le dans les journaux
immédiatement après le premier déploiement, avant la rotation du tampon de
journaux :

```bash
# Cloud Run
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 200 \
  | grep -i "admin\|password"

# GKE
kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200 | grep -i "admin\|password"
```

Une fois récupéré, changez le mot de passe via l'interface web de Cloudreve — il
n'existe aucune autre voie de récupération s'il est perdu.

Si l'opérateur fournit `secret_environment_variables` sur le déploiement de
plateforme (pour un usage sans rapport avec les identifiants propres à Cloudreve),
ceux-ci restent injectés par le mécanisme Secret Manager standard géré par le
socle — voir [App_Common](App_Common.md).

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Cloudreve ne nécessite **aucune base de données externe**. `database_type` est fixé
à `"NONE"` dans l'output `config` du module (avec `db_name = ""` et
`db_user = ""`), et `enable_cloudsql_volume` est fixé en dur à `false` — aucune
instance, base ou utilisateur Cloud SQL n'est jamais provisionné pour cette
application, quelle que soit la valeur donnée à une variable `database_*`/`db_*`/`sql_*`
sur le déploiement de plateforme (ces variables ne sont transmises que pour la
compatibilité avec l'interface du socle et sont ici sans effet).

Cloudreve utilise à la place une **base SQLite intégrée** (`cloudreve.db`), avec un
`conf.ini` généré et les fichiers téléversés, tous stockés directement sous son
répertoire de travail `/cloudreve` sur le volume persistant (GCS FUSE sur Cloud
Run, un PVC bloc sur GKE). Il n'y a donc pas non plus de job `db-init` :

```hcl
# main.tf
initialization_jobs = length(var.initialization_jobs) > 0 ? [ ... ] : []
```

`Cloudreve_Common` n'injecte jamais de job par défaut ici — seuls les jobs fournis
par l'opérateur s'exécutent. Au premier démarrage, Cloudreve crée lui-même le schéma
SQLite sur le volume monté et initialise le compte administrateur (voir §2) ; il
n'y a aucune étape de migration distincte à exécuter ou à surveiller.

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

L'image personnalisée encapsule `cloudreve/cloudreve:${CLOUDREVE_VERSION}` — épinglée
via un **ARG de build propre à l'application** (`CLOUDREVE_VERSION`, et non
l'`APP_VERSION` générique que le socle injecte et qui forcerait sinon le tag
introuvable `latest`). `application_version = "latest"` correspond à la dernière
version v3 dont la compatibilité a été vérifiée, `3.8.3`, dont l'organisation des
données correspond à ce module (SQLite intégré dans `/cloudreve/cloudreve.db`,
téléversements sous `/cloudreve/uploads`, mot de passe administrateur affiché dans
les journaux au premier démarrage).

Contrairement à la plupart des modules applicatifs à build personnalisé, il n'y a
**aucun script shell de point d'entrée** ni aucune logique de traduction des
variables d'environnement à l'exécution. Le Dockerfile
(`modules/Cloudreve_Common/scripts/Dockerfile`) existe uniquement pour corriger un
problème de **masquage par volume**, et rien d'autre :

```dockerfile
ARG CLOUDREVE_VERSION=3.8.3
FROM cloudreve/cloudreve:${CLOUDREVE_VERSION} AS src

FROM cloudreve/cloudreve:${CLOUDREVE_VERSION}
COPY --from=src /cloudreve/cloudreve /usr/local/bin/cloudreve
WORKDIR /cloudreve
ENTRYPOINT ["/usr/local/bin/cloudreve"]
```

L'image amont `cloudreve/cloudreve` conserve **à la fois** le binaire `cloudreve`
et ses données (`cloudreve.db`, `conf.ini`, `uploads/`) dans le même répertoire,
`/cloudreve`. Monter un volume persistant neuf (bucket GCS FUSE sur Cloud Run, PVC
bloc sur GKE) à cet emplacement pour conserver les données **masquerait aussi le
binaire situé en dessous**, produisant `exec ./cloudreve: no such file or
directory` au démarrage du conteneur (boucle de plantage). La correction consiste en
un build multi-étapes : la première étape (`AS src`) n'est qu'une référence à
l'image amont intacte ; l'étape finale copie le binaire via `COPY --from=src` vers
`/usr/local/bin/cloudreve`
— un chemin sur lequel rien n'est jamais monté — et définit `ENTRYPOINT` sur ce
chemin absolu, tandis que `WORKDIR` reste `/cloudreve` afin que l'application lise
et écrive toujours ses données persistantes sur le volume exactement comme elle
l'attend. C'est précisément pourquoi Cloudreve est construit comme une **image
personnalisée** (`image_source = "custom"`,
`container_build_config.enabled = true`) plutôt que comme une simple reprise du tag
amont.

Comme la correction réside dans le Dockerfile, le modifier exige un nouveau build
de l'image — un déclencheur basé sur l'empreinte du contenu qui ne détecte pas le
changement peut être forcé avec :

```bash
tofu taint 'module.app_<cloudrun|gke>.module.app_build.null_resource.build_and_push_application_image[0]'
```

Aucune traduction de variables d'environnement, correction d'URL ni script de
démarrage n'intervient dans cette couche — les `environment_variables` transmises
par le déploiement de plateforme atteignent le conteneur sans aucune modification
(voir §5).

---

## 5. Paramètres applicatifs de base {#5-core-application-settings}

L'output `config` de `Cloudreve_Common` est volontairement minimal par rapport à la
plupart des modules applicatifs Common — Cloudreve n'a besoin de presque aucun
environnement de base pour démarrer correctement, car il n'a ni DSN de base de
données piloté par variable d'environnement, ni surcharge du répertoire de données,
ni bascules de file d'attente ou de télémétrie :

- **`environment_variables`** — transmise telle quelle depuis la variable
  `environment_variables` du déploiement de plateforme, **sans aucune valeur par
  défaut injectée**. Cloudreve n'a pas de variable d'environnement de répertoire de
  données (il utilise des chemins relatifs à son répertoire de travail) ; rien n'a
  donc besoin d'être défini pour un premier démarrage correct.
- **`container_port`** — fixé en dur à `5212` directement dans l'output `config`
  (et non dérivé d'une variable), ce qui correspond au port d'écoute interne fixe de
  Cloudreve.
- **`database_type` / `db_name` / `db_user`** — fixés en dur à `"NONE"` / `""` /
  `""` ; **`enable_cloudsql_volume`** fixé en dur à `false`. Aucun d'eux n'est
  configurable par déploiement, puisque Cloudreve n'a pas de base de données.
- **`min_instance_count` / `max_instance_count`** — transmises depuis les
  variables du même nom, toutes deux à `1` par défaut. Cloudreve n'a pas de mode
  multi-nœud/clustering vérifié, et exécuter plus d'une instance expose à des
  écrivains concurrents sur le même fichier SQLite à écrivain unique.
- **`container_resources`** — fusionne `cpu_limit`/`memory_limit` (ou une
  surcharge complète de `container_resources`) avec `cpu_request`/`mem_request`/le
  stockage éphémère laissés à `null`, ce qui permet au socle d'appliquer ses propres
  valeurs par défaut aux champs non définis.

Ajustement propre à chaque plateforme géré ici (via la variable
`enable_gcs_storage_volume` et la valeur locale `_cloudreve_extra_storage_volumes`) :

- **Cloud Run** laisse toujours `enable_gcs_storage_volume = true` — Cloud Run
  n'offre aucune option de volume bloc ; le bucket `storage` créé automatiquement est
  donc toujours monté via GCS FUSE sur `/cloudreve`.
- **GKE** définit `enable_gcs_storage_volume = false` dès que
  `stateful_pvc_enabled = true` (la valeur par défaut de la variante GKE), car le
  PVC bloc est monté sur le même chemin `/cloudreve` et un second montage GCS FUSE à
  cet endroit entrerait en conflit. Avec le PVC bloc en place, le bucket `storage`
  existe toujours (voir §7) mais reste non monté.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`Cloudreve_Common` définit les variables `startup_probe` et `liveness_probe` que les
deux variantes de plateforme transmettent sans modification — il n'y a **aucune
différence entre CloudRun et GKE** dans la configuration des sondes de Cloudreve,
contrairement aux applications dont les valeurs par défaut GKE et Cloud Run
divergent. Cloudreve n'a pas de point de terminaison de santé distinct de son
interface web ; `/` renvoie HTTP 200 dès que le serveur traite les requêtes.

- **Sonde de démarrage** — HTTP `GET /`, `initial_delay_seconds = 15`,
  `timeout_seconds = 5`, `period_seconds = 10`, `failure_threshold = 10`
  (soit jusqu'à ~100 secondes après le délai initial pour être prêt).
- **Sonde de vivacité** — HTTP `GET /`, `initial_delay_seconds = 30`,
  `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

Les deux sondes sont déclarées comme des variables `object` complètes avec des
valeurs par défaut dans `Cloudreve_Common/variables.tf` et transmises via l'output
`config` sous les noms `startup_probe`/`liveness_probe` ; les variantes de plateforme
peuvent les surcharger via leurs propres variables `startup_probe`/`liveness_probe`,
mais sont livrées avec ces valeurs inchangées.

---

## 7. Stockage objet {#7-object-storage}

Un unique bucket **Cloud Storage** (`name_suffix = "storage"`) est déclaré dans
l'output `storage_buckets` et provisionné par le socle :

- `location = ""` — laissé vide afin que le socle le résolve via
  `coalesce(bucket.location, local.region)`, ce qui place le bucket dans la région de
  déploiement découverte automatiquement plutôt que d'épingler un emplacement qui
  pourrait forcer un remplacement destructif lors d'un nouvel apply dans une autre
  région.
- `storage_class = "STANDARD"`, `force_destroy = true`,
  `versioning_enabled = false`, `public_access_prevention = "enforced"`, aucune
  règle de cycle de vie.

Le fait que ce bucket soit réellement **monté** dans le conteneur en cours
d'exécution dépend de `enable_gcs_storage_volume` (voir §5) : lorsqu'il vaut `true`,
le bucket est ajouté à `gcs_volumes` sous la forme `{ name = "storage", mount_path = "/cloudreve", read_only =
false }` et monté via GCS FUSE — c'est toujours le cas sur Cloud Run, et sur GKE
uniquement lorsque le PVC bloc est désactivé. Monté sur le même chemin qu'un PVC bloc
GKE, les deux se superposeraient et entreraient en conflit, ce qui explique
précisément pourquoi la variante GKE désactive cet indicateur par défaut.

Listez le bucket avec :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
```

---

Pour la configuration de Cloudreve visible par l'utilisateur (variables par groupe,
outputs et manière d'explorer chaque service depuis la console et la CLI), consultez
les guides de plateforme : **[Cloudreve_GKE](Cloudreve_GKE.md)** et
**[Cloudreve_CloudRun](Cloudreve_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Cloudreve sur Google Cloud Run](Cloudreve_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Cloudreve sur GKE Autopilot](Cloudreve_GKE.md) — cette configuration déployée sur GKE.
