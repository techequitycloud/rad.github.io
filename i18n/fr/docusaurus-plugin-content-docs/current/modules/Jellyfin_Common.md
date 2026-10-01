---
title: "Jellyfin Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Jellyfin — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Jellyfin_Common.md @ 3055034 sha256:0ba20a1dade0 -->

# Jellyfin Common — Configuration applicative partagée {#jellyfin-common--shared-application-configuration}

`Jellyfin_Common` est la **couche applicative partagée** de Jellyfin. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Jellyfin sur laquelle
s'appuient à la fois [Jellyfin_GKE](Jellyfin_GKE.md) et
[Jellyfin_CloudRun](Jellyfin_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle ne possède aucune entrée propre
dans l'interface de déploiement —, mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Jellyfin, consultez les
guides des plateformes ([Jellyfin_GKE](Jellyfin_GKE.md),
[Jellyfin_CloudRun](Jellyfin_CloudRun.md)) et les guides des socles
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Jellyfin_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré obligatoire** — le compte administrateur est créé via l'assistant de premier démarrage de Jellyfin | Interface web de Jellyfin au premier accès |
| Clé d'API facultative | Lorsque `enable_api_key = true`, génère une clé d'API aléatoire de 32 caractères et la stocke dans **Secret Manager** | Injectée automatiquement ; à récupérer via Secret Manager (voir ci-dessous) |
| Image de conteneur | Enveloppe finement l'image officielle `jellyfin/jellyfin` afin que le socle puisse la copier en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Jellyfin utilise des bases SQLite internes sous `/config` (`database_type = "NONE"`) | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | **Aucun** — il n'y a pas de job `db-init` ; Jellyfin gère son propre stockage | n/a |
| Stockage objet | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/config` sur Cloud Run | Sortie `storage_buckets` |
| Paramètres essentiels | Définit `JELLYFIN_CONFIG_DIR = /config` et le port de conteneur `8096` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage et de vivacité par défaut ciblant `/health` | §Observabilité dans les guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Jellyfin n'a **aucun secret généré obligatoire**. Contrairement aux applications
adossées à une base de données, il n'utilise ni clé de chiffrement ni secret de
signature JWT — l'authentification se configure entièrement via l'**assistant de
premier démarrage**, où vous créez le compte administrateur lors du premier accès à
l'interface web.

Le **seul secret facultatif** est une clé d'API, conditionnée par `enable_api_key`
(par défaut `false`) :

- Lorsque `enable_api_key = true`, une valeur aléatoire de 32 caractères est générée
  et stockée dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key` (par
  exemple `secret-<prefix>-jellyfin-api-key`).
- Lorsque `enable_api_key = false` (la valeur par défaut), aucun secret n'est créé et
  la table des secrets du module est vide.

**Bogue connu — ce secret n'est pas réellement utilisable par Jellyfin.** Les
sorties `secret_ids` et `secret_values` associent toutes deux la valeur générée au nom
de variable d'environnement `QDRANT__SERVICE__API_KEY` — un reste de copier-coller du
module Qdrant_Common dont ce module a été cloné (voir le commentaire `# Injected as QDRANT__SERVICE__API_KEY env
var` dans `main.tf`). Jellyfin ne lit jamais cette variable, ni aucune autre variable
d'environnement, pour l'authentification par clé d'API — il n'a pas de script de point
d'entrée personnalisé (voir §4), et les clés d'API ne peuvent être créées que par un
appel authentifié au Dashboard ou à l'API REST. Aujourd'hui, `enable_api_key = true`
ne crée donc qu'un secret Secret Manager **orphelin** ; il ne provisionne pas à
l'avance une clé d'API fonctionnelle. Jellyfin crée et gère lui-même les clés d'API
via **Dashboard → API Keys** dans l'interface web — cela reste le seul moyen
d'obtenir une clé utilisable.

Récupérez le secret après le déploiement (uniquement lorsque `enable_api_key = true`) :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~api-key"

# Read a secret version:
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Jellyfin n'utilise **pas** de base de données externe. Tout son état — l'index de la
médiathèque, les comptes utilisateurs, l'historique de lecture et les paramètres — se
trouve dans des **bases SQLite internes** écrites sous `/config`. Par conséquent :

- `database_type = "NONE"` — aucune instance Cloud SQL, aucune base de données ni
  aucun utilisateur n'est créé pour Jellyfin.
- Il n'y a **pas de job `db-init`** — Jellyfin initialise ses propres fichiers SQLite
  au premier démarrage ; rien n'a besoin d'être amorcé à l'avance.
- Aucune extension PostgreSQL, aucun `pgvector` et aucun Redis n'interviennent.

Les bases de données étant des fichiers sur le volume persistant `/config`, leur
durabilité dépend du backend de stockage, et non d'un service de base de données géré
(voir §5 et §7). Si vous avez besoin de tâches personnalisées de chargement de données
ou de migration, vous pouvez fournir vos propres `initialization_jobs` ; aucune n'est
fournie par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Jellyfin utilise un **Dockerfile de type enveloppe fine** — il n'ajoute aucun script de
point d'entrée personnalisé et exécute tel quel le point d'entrée de l'image amont :

```dockerfile
ARG JELLYFIN_VERSION=10.10.3
FROM jellyfin/jellyfin:${JELLYFIN_VERSION}
```

- **`image_source = "custom"`** — défini uniquement pour que le socle construise ou
  copie en miroir l'image dans Artifact Registry ; aucun code applicatif n'y est
  ajouté.
- **ARG de build propre à l'application** — le Dockerfile lit `JELLYFIN_VERSION`, et
  **non** le `APP_VERSION` générique qu'injecte le socle (et qu'il forcerait à
  `latest`). Lorsque `application_version = "latest"`, la couche Common épingle le
  build sur `10.10.3` ; sinon, elle transmet directement la version demandée.
- **Aucune traduction du point d'entrée** — comme Jellyfin n'a besoin d'aucun câblage
  de base de données ni d'aucune réécriture d'URL au démarrage, le démarrage par défaut
  de l'image amont est utilisé tel quel.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Jellyfin_Common` établit l'environnement minimal dont Jellyfin a besoin pour démarrer
la première fois et écrire son état sur le volume persistant :

- **`JELLYFIN_CONFIG_DIR = "/config"`** — dirige la configuration, les bases SQLite,
  les métadonnées, les plugins, le cache de transcodage et les journaux de Jellyfin
  vers le volume persistant. Tout ce que Jellyfin conserve se trouve dans ce
  répertoire unique.
- **Port de conteneur `8096`** — Jellyfin sert le HTTP sur le port 8096 par défaut,
  ce qui correspond au `container_port` du module.
- **Aucun paramètre de télémétrie, de file d'attente ou de mode d'exécution** — il n'y
  a rien d'autre à configurer au démarrage ; le reste de la configuration (compte
  administrateur, bibliothèques) s'effectue via l'assistant de premier démarrage de
  l'interface web.

Montage de `/config` selon la plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/config` via GCS FUSE
  (`enable_gcs_storage_volume = true`).
- **GKE** avec `stateful_pvc_enabled = true` monte un PVC en mode bloc sur `/config` et
  définit `enable_gcs_storage_volume = false` pour éviter un double montage sur le
  même chemin.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux une requête **HTTP GET
`/health`**, qui renvoie la simple chaîne `Healthy` avec un statut `200` et ne
nécessite **aucune authentification** — les sondes réussissent donc dès que le serveur
répond, indépendamment de toute connexion administrateur.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par le socle, qui
accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, avec
  `public_access_prevention = "enforced"`.
- Sur Cloud Run, il sert de support à `/config` via GCS FUSE ; il contient donc les
  bases SQLite, les métadonnées, le cache et les journaux de Jellyfin.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Remarque sur le type de stockage.** Un serveur multimédia a idéalement besoin d'un
**stockage en mode bloc** pour son répertoire `/config`, très sollicité par SQLite, et
pour son cache de transcodage. Sur GKE, le PVC en mode bloc
(`stateful_pvc_enabled = true`) est le plus adapté — des E/S aléatoires à faible
latence sur les fichiers SQLite. Le montage GCS FUSE de Cloud Run fonctionne, mais sa
latence est plus élevée et il convient mieux à un usage léger ; les grandes
bibliothèques et le transcodage actif se portent bien mieux sur le PVC en mode bloc de
GKE.

Le PVC en mode bloc de GKE utilise par défaut la StorageClass `standard-rwo` adossée à
des SSD, qui puise dans le quota régional restreint `SSD_TOTAL_GB` — et la mise à
l'échelle de l'application à zéro ne libère **pas** le PVC : une série de modules avec
état peut donc épuiser ce quota. Jellyfin correspond exactement au cas multimédia/SQLite
concerné : il n'a pas besoin des IOPS d'un SSD ; sur un projet contraint par les
quotas, basculez donc vers du HDD avec `-var stateful_pvc_storage_class=standard`
(`pd-standard`, qui puise plutôt dans le quota bien plus large `DISKS_TOTAL_GB`) — il
s'agit toujours d'un véritable périphérique en mode bloc, qui préserve donc l'intégrité
du verrouillage en écriture de SQLite pour laquelle le PVC en mode bloc existe.

---

Pour la configuration propre à Jellyfin destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Jellyfin_GKE](Jellyfin_GKE.md)** et
**[Jellyfin_CloudRun](Jellyfin_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Jellyfin sur Google Cloud Run](Jellyfin_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md) — cette configuration déployée sur GKE.
