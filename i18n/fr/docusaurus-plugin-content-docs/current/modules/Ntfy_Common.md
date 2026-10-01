---
title: "Ntfy Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Ntfy — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Ntfy_Common.md @ 3055034 sha256:08d8336e4fb8 -->

# Ntfy Common — Configuration applicative partagée {#ntfy-common--shared-application-configuration}

`Ntfy_Common` est la **couche applicative partagée** de ntfy. Elle n'est pas déployée
seule ; elle fournit la configuration propre à ntfy sur laquelle s'appuient à la fois
[Ntfy_GKE](Ntfy_GKE.md) et [Ntfy_CloudRun](Ntfy_CloudRun.md), afin que les deux
variantes de plateforme se comportent de manière identique là où cela compte. Les
utilisateurs finaux ne configurent jamais cette couche directement — elle ne possède
aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle
fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement ntfy, consultez les guides
de plateforme ([Ntfy_GKE](Ntfy_GKE.md), [Ntfy_CloudRun](Ntfy_CloudRun.md)) et les
guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Ntfy_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `binwiederhier/ntfy` avec un script de point d'entrée personnalisé ; build via Cloud Build | Sortie `container_image` du déploiement de plateforme |
| Moteur de base de données | **Aucun** — `database_type = "NONE"`. ntfy n'a pas de base de données externe ; son cache de messages est un fichier SQLite local | §Base de données dans les guides de plateforme |
| Amorçage de la base de données | **Aucun** — aucune tâche `db-init` n'est injectée. `initialization_jobs` est transmis tel quel (vide par défaut) | Sortie `initialization_jobs` |
| Secrets cryptographiques | **Aucun** — `secret_ids` est vide. ntfy n'a besoin d'aucun identifiant au moment du déploiement ; le contrôle d'accès se configure après le déploiement dans le magasin d'utilisateurs/jetons propre à ntfy | — |
| Stockage d'objets | **Aucun** — `storage_buckets` est vide | Sortie `storage_buckets` |
| Paramètres principaux | Définit l'environnement ntfy de base : adresse d'écoute (`:80`) et chemin du cache SQLite (`NTFY_CACHE_FILE`) | Comportement de l'application dans les guides de plateforme |
| Contrôles de santé | Fournit la sonde de démarrage/de vivacité par défaut ciblant `/v1/health` | §Observabilité dans les guides de plateforme |

La forme de la sortie `config` (l'objet consommé par les deux variantes) est fixée ici :
`container_port = 80`, `database_type = "NONE"`, `image_source = "custom"`,
`enable_image_mirroring = true`, et un ensemble `initialization_jobs` /
`secret_ids` / `storage_buckets` vide.

---

## 2. Pas de secrets, pas de base de données, pas de buckets {#2-no-secrets-no-database-no-buckets}

Contrairement à la plupart des modules applicatifs, `Ntfy_Common` ne génère **rien**
dans Secret Manager et ne provisionne **aucune** instance Cloud SQL ni aucun bucket GCS :

- `secret_ids = {}` et `secret_values = {}` — il n'y a aucun identifiant généré
  automatiquement à injecter. ntfy est un relais pub/sub sans état ; il ne se connecte
  à aucune base de données externe et n'a besoin ni de mot de passe d'amorçage ni de clé de chiffrement.
- `storage_buckets = []` — ntfy conserve tout ce dont il a besoin (son cache de messages
  et, s'il est activé, sa base d'authentification) dans un fichier SQLite local, et non dans un stockage d'objets.
- `database_type = "NONE"` — aucune instance Cloud SQL for PostgreSQL/MySQL n'est créée. Les
  variables liées à la base de données qui apparaissent dans les guides de plateforme (`db_name`,
  `db_user`, `enable_cloudsql_volume`, `database_password_length`, …) sont inertes
  sauf si vous optez explicitement pour une base de données externe, ce dont ntfy n'a pas besoin.

**Le contrôle d'accès est une étape postérieure au déploiement.** Si vous souhaitez exiger une
authentification pour publier sur des sujets (topics) ou s'y abonner, configurez les utilisateurs et
les jetons de contrôle d'accès propres à ntfy après le déploiement à l'aide de sa CLI (`ntfy user add`, `ntfy access …`) ou des
variables d'environnement `NTFY_AUTH_*`. Ils résident dans le fichier d'authentification SQLite de ntfy, et non dans
Secret Manager.

---

## 3. Image de conteneur et point d'entrée {#3-container-image-and-entrypoint}

L'image personnalisée est une fine surcouche de l'image officielle du serveur ntfy :

```dockerfile
ARG NTFY_VERSION=v2.11.0
FROM binwiederhier/ntfy:${NTFY_VERSION}
USER root
COPY ntfy-entrypoint.sh /usr/local/bin/ntfy-entrypoint.sh
RUN chmod +x /usr/local/bin/ntfy-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/ntfy-entrypoint.sh"]
```

- **ARG de build propre à l'application.** Le tag de base est piloté par `NTFY_VERSION`, **et non** par le
  `APP_VERSION` générique qu'injecte le socle. ntfy publie des tags préfixés par `v`
  (par ex. `v2.11.0`) et n'a pas de variante `latest-<x>` ; `application_version =
  "latest"` correspond donc à une version récente épinglée (`v2.11.0`) — un nouveau build ne
  résout jamais un tag inexistant. Ce comportement est défini dans `Ntfy_Common` via
  `ntfy_image_version = var.application_version == "latest" ? "v2.11.0" : var.application_version`.
- **Construite via Cloud Build et dupliquée.** `image_source = "custom"` avec
  `enable_image_mirroring = true`, de sorte que l'image construite est placée dans l'Artifact Registry
  du projet au lieu d'être tirée de Docker Hub à l'exécution.
- **Le point d'entrée exécute `ntfy serve`** en tant que PID 1 après avoir préparé le répertoire de cache
  (voir ci-dessous).

---

## 4. Paramètres principaux de l'application et cache SQLite {#4-core-application-settings-and-the-sqlite-cache}

`Ntfy_Common` établit l'environnement ntfy de base afin que le serveur démarre
correctement dès le premier lancement :

- **`NTFY_LISTEN_HTTP = ":80"`** — l'adresse d'écoute, correspondant à `container_port = 80`.
- **`NTFY_CACHE_FILE = "/var/cache/ntfy/cache.db"`** — le cache de messages SQLite. Son
  répertoire doit être accessible en écriture avant que ntfy n'ouvre la base de données.

Le point d'entrée (`ntfy-entrypoint.sh`) gère la seule particularité de la plateforme qui
casserait autrement, sans bruit, un déploiement de base :

> Cloud Run exécute le conteneur avec un **système de fichiers racine en lecture seule** ; ainsi
> `mkdir -p /var/cache/ntfy` échoue avec « Read-only file system » et, sous `set -e`,
> ferait quitter le conteneur avant même le démarrage de ntfy (ce qui apparaît comme un
> dépassement du délai de la sonde de démarrage). Le point d'entrée tente de créer le répertoire de cache configuré et d'y écrire ; s'il
> n'est pas accessible en écriture, il **se rabat sur `/tmp/ntfy`** (le seul chemin accessible en écriture sur un
> rootfs en lecture seule). Cela maintient en bonne santé un déploiement sans NFS tout en respectant
> un montage NFS ou PVC en mode bloc accessible en écriture lorsqu'il est fourni.

**Modèle de persistance.** Avec le cache éphémère par défaut, l'historique des messages est perdu à
chaque redémarrage/redéploiement du conteneur — ce qui convient pour un relais purement temps réel. Pour un
**historique des messages durable**, adossez `NTFY_CACHE_FILE` à un stockage persistant :

- **Cloud Run / GKE :** activez NFS (`enable_nfs = true`) et faites pointer le répertoire de cache vers
  le point de montage.
- **GKE uniquement :** utilisez un PVC en mode bloc de StatefulSet (`stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"`).

---

## 5. Comportement des sondes de santé {#5-health-probe-behaviour}

Les sondes de démarrage et de vivacité par défaut ciblent **`/v1/health`** — le point de terminaison
de santé intégré à ntfy, qui renvoie un HTTP 200 avec `{"healthy":true}` dès que le serveur
écoute. Comme ntfy n'a ni migrations de base de données ni initialisation lourde, il
devient sain en quelques secondes après le démarrage ; la fenêtre de démarrage par défaut généreuse
(délai initial de 30 secondes, 30 tentatives) est une marge prudente plutôt qu'une
exigence.

---

Pour la configuration propre à ntfy destinée aux utilisateurs (variables par groupe, sorties et
manière d'explorer chaque service depuis la console et la CLI), consultez les guides de plateforme :
**[Ntfy_GKE](Ntfy_GKE.md)** et **[Ntfy_CloudRun](Ntfy_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Ntfy sur GKE Autopilot](Ntfy_GKE.md) — cette configuration déployée sur GKE.
