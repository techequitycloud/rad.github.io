---
title: "Radicale Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Radicale — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Radicale_Common.md @ 3055034 sha256:314a41c5bf4b -->

# Radicale Common — Configuration applicative partagée {#radicale-common--shared-application-configuration}

`Radicale_Common` est la **couche applicative partagée** de Radicale. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Radicale sur
laquelle s'appuient à la fois [Radicale_GKE](Radicale_GKE.md) et [Radicale_CloudRun](Radicale_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique
là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle ne possède aucune entrée propre dans l'interface de
déploiement —, mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Radicale, consultez
les guides des plateformes ([Radicale_GKE](Radicale_GKE.md), [Radicale_CloudRun](Radicale_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Radicale_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Enveloppe finement `ghcr.io/kozea/radicale` avec un build personnalisé afin d'y ajouter le point d'entrée cloud | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Radicale est un pur stockage sur système de fichiers (`database_type = "NONE"`) | §3 ci-dessous et guides des plateformes |
| Authentification | **Aucun compte administrateur intégré par défaut** — génère un véritable secret `ADMIN_PASSWORD` et le hache dans un fichier htpasswd à chaque démarrage | §2 ci-dessous |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui sous-tend `/var/lib/radicale` | Sortie `storage_buckets` |
| Amorçage des collections | Définit la tâche d'initialisation par défaut `seed-default-collections` qui contourne la restriction MKCOL de Cloud Run | §4 ci-dessous |
| Contrôles de santé | Fournit les sondes de démarrage et de vivacité par défaut ciblant `/` | §Observabilité dans les guides des plateformes |

---

## 2. Aucun compte administrateur par défaut — un véritable secret généré {#2-no-default-admin-account--a-real-generated-secret}

Radicale se distingue parmi les applications de ce catalogue en ce qu'il ne
possède **absolument aucun identifiant par défaut en amont contre lequel mettre
en garde**. Son paramètre `auth.type` vaut `denyall` par défaut — chaque
requête est rejetée — tant qu'un fichier htpasswd n'est pas explicitement
configuré. Aucun « admin/admin » ni mot de passe de première connexion bien
connu n'est intégré à l'image.

`Radicale_Common` comble lui-même ce manque :

- Génère un véritable `random_password.admin_password` aléatoire de 24
  caractères.
- Le stocke dans Secret Manager sous le nom `secret-<wrapper_prefix>-admin-password`.
- Le publie en sortie sous la forme `secret_ids = { ADMIN_PASSWORD = ... }`
  (transmis comme `module_secret_env_vars`) et `secret_values = { ADMIN_PASSWORD = ... }`
  (transmis comme `module_explicit_secret_values` / `explicit_secret_values`
  pour le chemin SecretSync de GKE).
- Injecte également une variable d'environnement simple `ADMIN_USERNAME`,
  dont la valeur par défaut est `admin`.

Le point d'entrée cloud (intégré à l'image personnalisée, voir le §4 des guides
des plateformes et `scripts/entrypoint.sh`) hache `ADMIN_PASSWORD` avec
**bcrypt** (le module Python `bcrypt`, déjà inclus dans le venv de l'image
officielle) en une ligne au format htpasswd, et réécrit à la fois le fichier
htpasswd et la configuration INI de Radicale **à chaque démarrage du
conteneur** — pas seulement au premier. Radicale ne possède aucune table
d'utilisateurs permettant de vérifier si l'initialisation a déjà eu lieu ;
régénérer à chaque démarrage est donc la conception la plus simple qui (a)
répare automatiquement un fichier htpasswd perdu ou corrompu et (b) prend en
compte un `ADMIN_PASSWORD` ayant fait l'objet d'une rotation dès le redémarrage
suivant, sans étape de réconciliation distincte.

```bash
gcloud secrets versions access latest --secret=secret-<wrapper_prefix>-admin-password --project "$PROJECT"
```

---

## 3. Moteur de base de données — aucun {#3-database-engine--none}

Radicale n'utilise **aucune** base de données, quelle qu'elle soit — SQL,
NoSQL ou embarquée. Chaque agenda et carnet d'adresses (« collection ») est un
simple répertoire sur disque contenant un fichier iCalendar (`.ics`) ou vCard
(`.vcf`) par élément, ainsi qu'un fichier de métadonnées JSON
`.Radicale.props` décrivant la collection elle-même. Il s'agit du format sur
disque documenté et stable de Radicale (le backend de stockage
`multifilesystem`), et non d'un détail d'implémentation privé.

Le chemin réel sur disque comporte un segment supplémentaire facile à manquer,
confirmé dans `_get_collection_root_folder()` de
`radicale/storage/multifilesystem/base.py` :

```
<filesystem_folder>/collection-root/<username>/<collection-name>/
```

`filesystem_folder` est défini sur `/var/lib/radicale/collections` par le point
d'entrée cloud. En conséquence :

- `database_type = "NONE"` — aucune instance Cloud SQL, aucune base de données
  ni aucun utilisateur n'est créé pour Radicale.
- Il n'existe **aucune tâche `db-init`**, de quelque nature que ce soit.
- Aucune extension PostgreSQL, aucun plugin MySQL et aucun Redis ne sont
  impliqués (`enable_redis` est forcé à `false` par les deux modules
  applicatifs).

---

## 4. Image de conteneur et build personnalisé {#4-container-image-and-the-custom-build}

Contrairement aux applications de ce catalogue qui déploient directement une
image officielle (`container_image_source = "prebuilt"`), `Radicale_Common`
utilise un **build personnalisé à enveloppe fine** :

```dockerfile
ARG RADICALE_VERSION=3.7.7
FROM ghcr.io/kozea/radicale:${RADICALE_VERSION}

USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER radicale

ENTRYPOINT ["/entrypoint.sh"]
CMD ["--hosts", "0.0.0.0:5232,[::]:5232"]
```

Le build existe **uniquement** pour ajouter le point d'entrée cloud ; aucun
autre code de l'application n'est modifié.

- **ARG de build propre à l'application.** Le Dockerfile lit
  `RADICALE_VERSION`, **et non** l'`APP_VERSION` générique injecté par le
  socle (qui forcerait le tag résolu à `latest`). Lorsque
  `application_version = "latest"`, la couche Common épingle le build sur
  `RADICALE_VERSION=3.7.7` ; sinon, la version demandée est transmise telle
  quelle.
- **Les tags GHCR n'ont pas de préfixe `v`.** La page *Releases* GitHub de
  Radicale affiche des tags comme `v3.7.7`, mais l'image de conteneur sur
  `ghcr.io/kozea/radicale` est publiée **sans** le `v` (`3.7.7`). Construire à
  partir du tag préfixé par `v` échoue avec `MANIFEST_UNKNOWN` — constaté lors
  d'une des premières tentatives de build de ce module.
- **Responsabilités du point d'entrée cloud.** Radicale ne propose **aucune
  configuration native par variables d'environnement** — il lit uniquement un
  fichier de configuration INI, localisé via la variable d'environnement
  `RADICALE_CONFIG` (confirmé dans `radicale/__main__.py`) ou un chemin par
  défaut compilé. `entrypoint.sh` écrit ce fichier INI ainsi que le fichier
  htpasswd à chaque démarrage (voir le §2), puis passe la main au point
  d'entrée CLI de l'image elle-même (`/app/bin/python /app/bin/radicale`).

---

## 5. Le problème MKCOL / Cloud Run {#5-the-mkcol--cloud-run-problem}

Il s'agit du comportement propre à la plateforme ayant le plus de conséquences
dans ce module — le résultat de trois passes de débogage distinctes sur des
déploiements réels pour isoler la cause racine à chaque couche.

**Le problème.** La création d'une *nouvelle* collection (agenda ou carnet
d'adresses) via le protocole standard CalDAV/CardDAV nécessite la méthode HTTP
WebDAV `MKCOL`. Confirmé en conditions réelles :

- **Sur Cloud Run**, le frontal de Google (GFE) rejette `MKCOL` en périphérie
  avec une page d'erreur Google générique « 400 Bad Request » — la requête
  n'atteint jamais le conteneur Radicale. Toutes les autres méthodes testées
  (GET, PUT, PROPFIND) passent sans problème ; cette restriction concerne
  spécifiquement MKCOL. Les services Cloud Run n'offrent par ailleurs **aucun
  accès shell/exec**, si bien qu'un opérateur n'a pas non plus de moyen de
  créer manuellement une collection après coup. Sans contournement, un nouveau
  déploiement `Radicale_CloudRun` serait incapable de créer *le moindre*
  agenda — via un client standard (Apple Calendar, Thunderbird, DAVx5) ou même
  via l'interface web de Radicale, qui émet elle aussi MKCOL en interne.
- **Sur GKE**, un simple Service LoadBalancer L4 ne présente **pas** cette
  restriction — `MKCOL` fonctionne nativement (confirmé en conditions réelles :
  `201 Created`).

**Le correctif — `seed-default-collections`.** `Radicale_Common` définit une
tâche d'initialisation par défaut (`execute_on_apply = true`, qui exécute
`scripts/seed-default-collections.sh` dans un simple conteneur `alpine:3`) qui
crée un « Default Calendar » et un « Default Address Book » pour l'utilisateur
administrateur en écrivant l'arborescence des répertoires et le fichier de
métadonnées `.Radicale.props` **directement sur le volume de stockage** — un
simple conteneur avec un accès direct au système de fichiers, sans aucune
couche HTTP/GFE. Vérifié en conditions réelles : après l'exécution de cette
tâche, un `PROPFIND` sur le principal de l'utilisateur administrateur liste
correctement les deux collections amorcées avec les bons resourcetypes
CalDAV/CardDAV, et un véritable événement d'agenda (`VEVENT`) peut être envoyé
par `PUT` puis récupéré par `GET` avec succès.

**La réserve GKE + PVC.** La tâche d'amorçage est une tâche du module Common
partagée entre Cloud Run et GKE et ne monte que le bucket GCS `storage`
(`mount_gcs_volumes = ["storage"]`) — elle ne peut pas s'attacher au PVC bloc
d'un StatefulSet (un Job Kubernetes ne peut pas monter un PVC `ReadWriteOnce`
déjà détenu par un Pod en cours d'exécution). Ainsi, sur `Radicale_GKE` avec
`stateful_pvc_enabled = true` (le paramètre recommandé en production), les
écritures de la tâche d'amorçage aboutissent dans le bucket GCS par ailleurs
inutilisé, et les collections par défaut n'apparaissent **pas**
automatiquement. C'est sans conséquence (aucune erreur, aucun plantage) — cela
signifie simplement que les opérateurs GKE+PVC doivent créer leur premier
agenda via un véritable client CalDAV ou un appel direct `curl -X MKCOL`
(dont le fonctionnement est confirmé) au lieu de compter sur les collections
pré-amorcées. Sur GKE **sans** PVC (mode Deployment adossé à GCS — qui n'est
pas la configuration de production recommandée), les écritures de la tâche
d'amorçage aboutissent dans le même bucket que celui utilisé par
l'application, si bien que les collections par défaut y apparaissent
également.

Si vous fournissez vos propres `initialization_jobs`, cette valeur par défaut
est entièrement remplacée — il vous appartient alors d'amorcer (ou non) les
collections vous-même.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux une requête
**HTTP GET `/`**. Radicale ne dispose d'aucun point de terminaison de santé
dédié ; le chemin racine renvoie une redirection `302` non authentifiée vers
son interface web (`/.web`) — confirmé en conditions réelles — et Cloud Run
comme Kubernetes considèrent toute réponse 2xx–3xx comme un résultat de sonde
sain.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage d'objets et fonctionnement à instance unique {#7-object-storage-and-single-instance-operation}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par le socle :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, avec
  `public_access_prevention = "enforced"`.
- Sur Cloud Run, il sous-tend toujours `/var/lib/radicale` via GCS FUSE.
- Sur GKE, il sous-tend `/var/lib/radicale` via GCS FUSE **sauf si**
  `stateful_pvc_enabled = true`, auquel cas un véritable PVC bloc prend le
  relais sur le même chemin de montage (`enable_gcs_storage_volume` est
  automatiquement défini sur `false` pour éviter un double montage) et le
  bucket GCS n'est plus utilisé comme montage (même si la tâche d'amorçage
  peut encore y écrire — voir le §5).

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
```

**Pourquoi l'instance unique est importante ici.** Le backend de stockage
`multifilesystem` de Radicale utilise le **verrouillage de fichiers au niveau
du système d'exploitation**, que GCS FUSE ne prend pas en charge de manière
fiable. `max_instance_count` est fixé à `1` sur les deux plateformes
précisément pour que cela ne devienne jamais un véritable problème de
concurrence — Radicale documente lui-même une variante de stockage
`multifilesystem_nolock` explicitement limitée à un seul processus, ce qui
confirme qu'il s'agit d'une véritable contrainte en amont et non d'une valeur
par défaut prudente de la plateforme. Pour un déploiement de production,
privilégiez `Radicale_GKE` avec `stateful_pvc_enabled = true`, qui offre à
Radicale un véritable verrouillage de fichiers POSIX au lieu de la sémantique
plus faible de GCS FUSE.

---

Pour la configuration de Radicale destinée aux utilisateurs (variables par
groupe, sorties et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Radicale_GKE](Radicale_GKE.md)** et
**[Radicale_CloudRun](Radicale_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Radicale sur Google Cloud Run](Radicale_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Radicale sur GKE Autopilot](Radicale_GKE.md) — cette configuration déployée sur GKE.
