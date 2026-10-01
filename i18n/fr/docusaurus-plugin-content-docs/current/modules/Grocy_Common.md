---
title: "Grocy Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Grocy — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Grocy_Common.md @ 3055034 sha256:aab035c05d16 -->

# Grocy Common — Configuration applicative partagée {#grocy-common--shared-application-configuration}

`Grocy_Common` est la **couche applicative partagée** de Grocy. Elle n'est pas déployée seule ; elle fournit la configuration propre à Grocy sur laquelle s'appuie [Grocy_CloudRun](Grocy_CloudRun.md) (et sur laquelle s'appuiera un futur `Grocy_GKE` une fois celui-ci déployé et vérifié), afin que les variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais cette couche directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Grocy, consultez le guide de la plateforme ([Grocy_CloudRun](Grocy_CloudRun.md)) et les guides du socle ([App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Grocy_Common | Où cela apparaît |
|---|---|---|
| Authentification | Livré avec l'identifiant par défaut LinuxServer `admin` / `admin` (à changer à la première connexion). Il n'existe pas d'identifiant administrateur injectable. | Interface web de Grocy au premier accès |
| Secrets du service | **Aucun.** `secret_ids` et `secret_values` sont tous deux des maps volontairement vides. | n/a |
| Image de conteneur | Encapsule légèrement l'image officielle `lscr.io/linuxserver/grocy` afin que le socle puisse la mettre en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Grocy utilise une base de données SQLite interne sous `/config` (`database_type = "NONE"`), confirmée comme réellement exclusivement SQLite d'après le code source amont | §3 |
| Initialisation de la base de données | **Aucune** — il n'y a pas de tâche `db-init` ; Grocy gère son propre schéma SQLite au premier démarrage | n/a |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` | Sortie `storage_buckets` |
| Paramètres principaux | Définit `PUID = 1000`, `PGID = 1000`, `TZ = Etc/UTC` et le port de conteneur `80` | Comportement de l'application dans le guide de la plateforme |
| Contrôles de santé | Fournit les sondes de démarrage et de disponibilité par défaut ciblant `/` (la page de connexion, `200`) | §5 |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Grocy n'a **aucun secret de service** — les sorties `secret_ids` et `secret_values` sont toutes deux des maps volontairement vides. Les identifiants administrateur de Grocy reposent entièrement sur des fichiers (`config.php` sur le volume persistant `/config`), et l'image amont de LinuxServer.io est livrée avec les identifiants par défaut `admin` / `admin` que l'opérateur modifie via l'interface web (Users → admin → Edit) à la première connexion. Grocy ne lit aucune variable d'environnement pour définir ou remplacer ce mot de passe ; il n'y a donc rien à provisionner ni à injecter dans Secret Manager pour lui — le même modèle que les autres applications SQLite à authentification autogérée de ce catalogue (Cloudreve, Prowlarr).

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de Workload Identity utilisé par les applications qui *ont* des secrets.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Grocy n'utilise **pas** de base de données externe. Tout son état — la base de données SQLite embarquée (`grocy.db`), `config.php`, les images et pièces jointes téléversées et les sauvegardes — réside sous `/config`. Confirmé par la lecture du code source amont de Grocy (`services/DatabaseService.php`) : il est réellement exclusivement SQLite, sans aucune prise en charge de MySQL/Postgres, et n'active jamais le mode WAL — il n'existe aucun PRAGMA `journal_mode` nulle part dans le code (Grocy utilise le mode de journal par défaut de SQLite, DELETE/rollback-journal). En conséquence :

- `database_type = "NONE"` — aucune instance Cloud SQL, base de données ni utilisateur n'est créé.
- Il n'y a **pas de tâche `db-init`** — Grocy initialise sa propre base de données SQLite au premier démarrage ; rien ne doit être préparé à l'avance.
- Aucune extension PostgreSQL, aucun `pgvector` et aucun Redis n'entrent en jeu.

Comme la base de données est un fichier sur le volume persistant `/config`, sa durabilité dépend du backend de stockage, et non d'un service de base de données géré (voir §5).

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Grocy utilise un **Dockerfile de simple encapsulation** — il n'ajoute pas de script de point d'entrée personnalisé et exécute tel quel le point d'entrée de l'image amont :

```dockerfile
ARG GROCY_VERSION=v4.6.0-ls333
FROM lscr.io/linuxserver/grocy:${GROCY_VERSION}
```

- **`image_source = "custom"`** — défini uniquement pour que le socle construise/mette en miroir l'image dans Artifact Registry ; aucun code applicatif n'est ajouté par-dessus.
- **ARG de build propre à l'application** — le Dockerfile lit `GROCY_VERSION`, et **non** l'`APP_VERSION` générique que le socle injecte (et qu'il forcerait à `latest`). Lorsque `application_version = "latest"`, la couche Common épingle le build sur `v4.6.0-ls333` ; sinon, elle transmet telle quelle la version demandée.
- **Aucune traduction du point d'entrée** — Grocy n'a besoin d'aucun câblage de base de données ni de réécriture d'URL au démarrage ; le démarrage par défaut de l'image amont est donc utilisé tel quel.

---

## 5. Paramètres applicatifs principaux et câblage du stockage {#5-core-application-settings-and-storage-wiring}

`Grocy_Common` établit l'environnement minimal dont Grocy a besoin pour démarrer la première fois et écrire son état sur le volume persistant :

- **`PUID = "1000"` / `PGID = "1000"`** — l'utilisateur/groupe sous lequel s'exécute l'image LinuxServer ; il possède le montage `/config` afin que Grocy puisse lire et écrire sa base de données SQLite.
- **`TZ = "Etc/UTC"`** — fuseau horaire du conteneur ; à remplacer via `environment_variables`.
- **Port de conteneur `80`** — Grocy sert le HTTP sur le port 80 par défaut.
- **`enable_gcs_storage_volume`** — une variable de ce module Common (vaut `true` par défaut ici), qui détermine si `Grocy_Common` injecte lui-même le bucket GCS `storage` comme volume GCS FUSE sur `/config`. Chaque variante de plateforme qui encapsule ce module la définit à `false` et monte `/config` par un autre mécanisme (voir ci-dessous), car GCS FUSE ne peut pas soutenir le schéma d'écriture de Grocy.

**Pourquoi pas GCS FUSE sur `/config`, et ce que fait chaque variante de plateforme à la place :**

Grocy écrit dans `data/grocy.db-journal` toutes les 1 à 2 secondes. La couche de traduction vers le stockage d'objets de GCS FUSE ne peut pas soutenir cette fréquence d'écriture — confirmé en conditions réelles sur `Grocy_CloudRun` sur 12 cycles de démarrage complets en plus de 20 minutes : `BufferedWriteHandler.OutOfOrderError` répétés, limitation de débit HTTP `429` de la part de GCS et erreurs de descripteur de fichier obsolète, produisant une boucle permanente de plantage et redémarrage. Il s'agit d'une cause racine **différente** de l'autre incident SQLite-sur-stockage-partagé de ce catalogue (UptimeKuma, qui s'est heurté à une incompatibilité des verrous en mode WAL sur NFS) — Grocy n'utilise jamais le mode WAL, son problème tient donc à la fréquence d'écriture, pas à la sémantique des verrous. Lus ensemble, ces cas élargissent la leçon : gcsfuse peut casser SQLite pour plus d'une raison, pas seulement à cause du verrouillage WAL.

- **`Grocy_CloudRun`** monte `/config` via la prise en charge native des volumes **NFS** du socle (`enable_nfs = true`, `nfs_mount_path = "/config"`). La vraie sémantique de fichiers POSIX de NFS (rename/fsync/verrous consultatifs) soutient le schéma d'écriture de Grocy là où GCS FUSE échoue. **Vérifié en conditions réelles :** `https://grocycr31ffe08b-kj6qcu2rxa-uc.a.run.app` — 16 échantillons curl sur environ 5 minutes contre une seule révision stable, servant systématiquement `<title>Login | Grocy</title>`, sans aucune entrée de journal présentant une signature de corruption après le correctif.
- **`Grocy_GKE`** (échafaudé, **pas encore déployé ni vérifié**) doit monter `/config` sur un **PVC en mode bloc** de StatefulSet — un véritable stockage en mode bloc, sans aucun système de fichiers réseau — selon le modèle général de ce catalogue pour les variantes GKE d'applications fortement dépendantes de SQLite (p. ex. CalibreWeb_GKE).

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de disponibilité envoient toutes deux une requête **HTTP GET `/`**, qui renvoie la page de connexion de Grocy (`200`) et ne requiert **aucune authentification** — les sondes réussissent donc dès que le serveur répond, indépendamment de toute connexion administrateur.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`, `failure_threshold = 10`.
- **Sonde de disponibilité (liveness)** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`, `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par le socle, qui accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**, avec `public_access_prevention = "enforced"`.
- Sur `Grocy_CloudRun`, ce bucket est provisionné mais **n'est pas utilisé** pour adosser `/config` par défaut — ce montage passe par NFS à la place (voir §5). Il reste disponible pour tout `gcs_volumes` personnalisé qu'un opérateur ajoute.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

---

Pour la configuration propre à Grocy destinée aux utilisateurs (variables par groupe, sorties et manière d'explorer chaque service depuis la console et la CLI), consultez le guide de la plateforme : **[Grocy_CloudRun](Grocy_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Grocy sur Google Cloud Run](Grocy_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Grocy sur GKE Autopilot](Grocy_GKE.md) — cette configuration déployée sur GKE.
