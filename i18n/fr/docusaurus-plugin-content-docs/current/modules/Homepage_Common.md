---
title: "Homepage Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Homepage — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Homepage_Common.md @ 3055034 sha256:134afb9a4186 -->

# Homepage Common — Configuration applicative partagée {#homepage-common--shared-application-configuration}

`Homepage_Common` est la **couche applicative partagée** de Homepage. Elle n'est
pas déployée seule ; elle fournit la configuration propre à Homepage sur laquelle
reposent [Homepage_CloudRun](Homepage_CloudRun.md) (et, une fois déployé,
`Homepage_GKE`), afin que les deux variantes de plateforme se comportent de
manière identique là où cela compte. Les utilisateurs finaux ne configurent
jamais cette couche directement — elle n'a aucune entrée propre dans l'interface
de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par
défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Homepage, consultez le
guide de plateforme ([Homepage_CloudRun](Homepage_CloudRun.md)) et les guides de
fondation ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Homepage_Common | Où cela apparaît |
|---|---|---|
| Authentification / secrets | **Aucun.** Homepage n'a pas de connexion propre et n'a besoin d'aucun identifiant généré | n/a — `secret_ids` et `secret_values` sont tous deux vides |
| Image de conteneur | Référence directement l'image réellement préconstruite `ghcr.io/gethomepage/homepage` — pas de Dockerfile, pas d'étape Cloud Build | Sortie `container_image` |
| Moteur de base de données | **Aucun** — toute la configuration et l'état de Homepage sont un ensemble de fichiers YAML sur disque (`database_type = "NONE"`) | §Base de données dans le guide de plateforme |
| Amorçage de la base de données | **Aucun** — pas de job `db-init` ; rien ne doit exister avant le premier démarrage de Homepage | n/a |
| Stockage objet | Déclare le bucket **Cloud Storage** `storage` qui soutient `/app/config` | Sortie `storage_buckets` |
| Paramètres de base | Fixe le port du conteneur à `3000` ; définit `PUID=1000`/`PGID=1000` ; définit `HOMEPAGE_ALLOWED_HOSTS` | Comportement de l'application dans le guide de plateforme |
| Contrôles de santé | Fournit des sondes de démarrage/vivacité par défaut ciblant `GET /api/healthcheck` — une valeur par défaut exacte, et non un paramètre fictif | §Observabilité dans le guide de plateforme |

---

## 2. Secrets {#2-secrets}

Homepage n'a **aucun secret**. Les sorties `secret_ids` et `secret_values` de ce
module sont toutes deux codées en dur sous forme de maps vides. Il n'y a ni
identifiant de base de données, ni clé de chiffrement, ni mot de passe
administrateur, ni jeton d'API — Homepage n'a pas de système d'authentification
propre. Si vous devez restreindre qui peut accéder au tableau de bord, cela doit
se faire au niveau de la plateforme (IAP, un VPN ou un reverse proxy devant le
service Cloud Run), et non dans ce module.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity utilisé par les applications qui, elles, *ont* des secrets.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Homepage n'utilise aucune base de données, ni externe ni intégrée. Toute sa
configuration et son comportement proviennent d'une poignée de fichiers YAML
(`settings.yaml`, `services.yaml`, `bookmarks.yaml`, `widgets.yaml`,
`docker.yaml`) lus en direct sur le disque à chaque requête ; il n'y a aucun
schéma à migrer ni aucun cache dans le processus à invalider.

- `database_type = "NONE"` — aucune instance Cloud SQL, base de données ni
  utilisateur n'est créé.
- Aucun job `db-init`, et aucun amorçage au premier démarrage hormis le point
  d'entrée de l'image amont, qui amorce lui-même à chaque démarrage tout fichier
  de configuration par défaut *manquant* à partir des valeurs par défaut fournies
  — cela exige que `/app/config` soit réellement accessible en écriture (voir §6).
- Pas de Redis. Le `main.tf` de `Homepage_CloudRun` code en dur
  `enable_redis = false`, remplaçant la valeur par défaut `true` d'`App_CloudRun`.

---

## 4. Image de conteneur {#4-container-image}

Contrairement à la plupart des modules Common de ce catalogue, `Homepage_Common`
référence directement l'image amont plutôt que d'en construire une
personnalisée :

- **`image_source = "prebuilt"`**, `container_build_config.enabled = false`
  — pas de Dockerfile, pas d'étape Cloud Build pour l'image de l'application.
- **`enable_image_mirroring = true`** par défaut copie tout de même l'image tirée
  dans Artifact Registry (pour éviter les limites de débit de GHCR) — un miroir,
  pas un build.
- `ghcr.io/gethomepage/homepage` publie un véritable tag `latest` fonctionnel
  ainsi que de véritables tags semver, si bien que `application_version` est
  transmis tel quel, sans aucune logique d'épinglage.

---

## 5. Paramètres de base de l'application {#5-core-application-settings}

`Homepage_Common` établit l'environnement minimal dont Homepage a besoin au
premier démarrage :

- **`PUID=1000` / `PGID=1000`** — l'image de Homepage s'exécute en tant que root
  par défaut, mais prend en charge les variables `PUID`/`PGID` de style
  LinuxServer pour abandonner ses privilèges ; le `docker-entrypoint.sh` amont
  applique un chown à `/app/config`, `/app/config/logs` et `/app/.next` en
  conséquence. Ces valeurs sont reprises dans les `mount_options` du montage GCS
  FUSE (voir §7).
- **`HOMEPAGE_ALLOWED_HOSTS = "*"`** par défaut — conditionne uniquement
  l'en-tête `Host` sur les appels `/api/*` de données des widgets de Homepage.
  `"*"` est l'échappatoire documentée par l'amont lui-même, utilisée ici parce
  qu'il n'est pas fiable de prédire, au moment du plan, le nom d'hôte exact
  attribué par la plateforme.
- **Rien d'autre à configurer au démarrage** — pas d'indicateur de télémétrie,
  pas de mode file d'attente, pas de paramètre de mode d'exécution, et aucun
  compte administrateur à amorcer.

Montage de `/app/config` propre à chaque plateforme :

- **Cloud Run** monte le bucket `storage` sur `/app/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE**, une fois déployé, utilisera un PVC de StatefulSet sur le même chemin
  lorsque `stateful_pvc_enabled = true`, en définissant
  `enable_gcs_storage_volume = false` pour éviter un double montage.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

`Homepage_Common` déclare des variables `startup_probe`/`liveness_probe` ciblant
**`GET /api/healthcheck`** — il s'agit d'une valeur par défaut réellement exacte
(correspondant à la directive `HEALTHCHECK` intégrée à l'image elle-même),
contrairement à plusieurs autres modules Common de ce catalogue dont les sondes
par défaut fictives sont remplacées en aval. `Homepage_CloudRun` les transmet sans
modification :

- **Sonde de démarrage** — `initial_delay = 10s`, `timeout = 5s`,
  `period = 10s`, `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`,
  `period = 30s`, `failure_threshold = 3`.

Confirmé en conditions réelles : `GET /api/healthcheck` renvoie un `200 "up"` non
authentifié.

---

## 7. Stockage objet {#7-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par la
fondation, qui accorde également l'accès au compte de service de la charge de
travail :

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
```

**Remarque sur l'UID/GID du montage.** `Homepage_Common` demande
`uid=1000,gid=1000` (correspondant à `PUID`/`PGID`) ainsi que `file-mode=0664`/
`dir-mode=0775` dans les `mount_options` du volume GCS. Sur un déploiement Cloud
Run réel, ce n'est **pas** ce qui est effectivement monté — l'intégration gcsfuse
intégrée de Cloud Run substitue silencieusement ses propres `uid=2000,gid=2000`,
quelles que soient les `mount_options` configurées (confirmé par la ligne de
journal GCSFuse « CLI Flags » au moment du déploiement). Cela n'a eu aucun impact
fonctionnel en production — le montage est resté cohérent et accessible en
écriture — mais cela signifie que l'UID/GID des `mount_options` configurées n'est
pas respecté à la lettre sur Cloud Run. Ceci est propre à l'intégration gcsfuse
de Cloud Run ; le pilote CSI GCS FUSE distinct de GKE n'effectue pas de
remplacement équivalent et exige réellement que l'UID/GID configuré corresponde à
l'utilisateur du conteneur (voir le constat « GKE gcsfuse UID/GID permission
denied » mentionné ailleurs dans ce dépôt).

---

Pour la configuration propre à Homepage destinée aux utilisateurs (variables par
groupe, sorties, et comment explorer chaque service depuis la console et la CLI),
consultez le guide de plateforme : **[Homepage_CloudRun](Homepage_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Homepage sur Google Cloud Run](Homepage_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Homepage sur GKE Autopilot](Homepage_GKE.md) — cette configuration déployée sur GKE.
