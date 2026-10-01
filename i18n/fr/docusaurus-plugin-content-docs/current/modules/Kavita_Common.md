---
title: "Kavita Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Kavita — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Kavita_Common.md @ 3055034 sha256:1cdcffce63ec -->

# Kavita Common — Configuration applicative partagée {#kavita-common--shared-application-configuration}

`Kavita_Common` est la **couche applicative partagée** de Kavita. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Kavita sur laquelle
s'appuient à la fois [Kavita_GKE](Kavita_GKE.md) et
[Kavita_CloudRun](Kavita_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais cette couche directement — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Kavita, consultez les
guides des plateformes ([Kavita_GKE](Kavita_GKE.md),
[Kavita_CloudRun](Kavita_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Kavita_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré** — le compte administrateur est créé via l'assistant de configuration du premier lancement de Kavita sur `/` | Interface web de Kavita au premier accès |
| Clé de signature JWT | **Non injectable** — Kavita génère automatiquement le `TokenKey` de `appsettings.json` au premier démarrage et le persiste sur le volume `/kavita/config` | Gérée en interne par Kavita ; rien à injecter |
| Image de conteneur | Fine surcouche de l'image officielle `jvmilazz0/kavita`, afin que le socle puisse la mettre en miroir dans Artifact Registry | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — Kavita utilise une base de données SQLite interne (`kavita.db`) sous `/kavita/config` (`database_type = "NONE"`) | Section Base de données des guides des plateformes |
| Amorçage de la base de données | **Aucun** — il n'existe pas de job `db-init` ; Kavita gère son propre stockage | s.o. |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui sert de support à `/kavita/config` sur Cloud Run | Sortie `storage_buckets` |
| Paramètres principaux | Définit `DOTNET_gcServer = "0"` et le port de conteneur `5000` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage et d'activité par défaut, qui ciblent `/api/health` | Section Observabilité des guides des plateformes |

---

## 2. Secrets dans Secret Manager {#2-secrets-in-secret-manager}

Kavita n'a **aucun secret de service injectable**. Contrairement aux applications
adossées à une base de données, il ne nécessite pas qu'une clé de chiffrement, un
jeton administrateur ou un secret de signature JWT fourni par l'opérateur soit
créé à l'avance :

- **Le compte administrateur** est créé de manière interactive via
  l'**assistant de configuration du premier lancement**, la première fois que
  vous ouvrez l'interface web sur `/`.
- **La clé de signature JWT** (`appsettings.json` → `TokenKey`) est **générée
  automatiquement par Kavita au premier démarrage** et persistée sur le volume
  `/kavita/config`. Elle n'est jamais créée par Terraform et n'est pas stockée
  dans Secret Manager.

En conséquence, les deux sorties de secrets de la couche Common sont vides :

- `secret_ids` — `{}` (transmis au socle en tant que `module_secret_env_vars`)
- `secret_values` — `{}` (transmis en tant que table explicite des valeurs de secrets)

Elles sont conservées comme sorties uniquement pour que les surcouches
CloudRun/GKE puissent les câbler de manière uniforme, aux côtés des applications
qui *ont* des secrets générés. Il n'y a rien à récupérer dans Secret Manager pour
un déploiement Kavita standard ; les seules entrées que vous y trouverez sont les
secrets que vous ajoutez manuellement via l'entrée `secret_environment_variables`
de la plateforme :

```bash
# List secrets for this deployment (names include the resource prefix):
gcloud secrets list --project "$PROJECT" --filter="name~kavita"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé de secrets et de
Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Kavita n'utilise **pas** de base de données externe. Tout son état — l'index de
la bibliothèque, les comptes utilisateur, la progression de lecture, les signets,
les collections et les paramètres — réside dans une **base de données SQLite
interne** (`kavita.db`) écrite sous `/kavita/config`, aux côtés des images de
couverture, des miniatures générées, des sauvegardes et des journaux. Par
conséquent :

- `database_type = "NONE"` — aucune instance, base de données ni aucun
  utilisateur Cloud SQL n'est créé pour Kavita.
- Il n'existe **pas de job `db-init`** — Kavita crée et migre lui-même son
  schéma SQLite au premier démarrage ; rien n'a besoin d'être amorcé à l'avance.
- Aucune extension PostgreSQL, aucun `pgvector` et **aucun Redis** n'entrent en
  jeu (`enable_redis = false` est imposé par les deux surcouches de plateforme).

Comme la base de données est un fichier sur le volume persistant
`/kavita/config`, sa durabilité dépend du backend de stockage et non d'un service
de base de données géré (voir §5 et §7). Si vous avez besoin de tâches
personnalisées de chargement de données ou de migration, vous pouvez fournir vos
propres `initialization_jobs` ; aucune n'est fournie par défaut.

---

## 4. Image de conteneur et point d'entrée {#4-container-image-and-entrypoint}

Kavita utilise un **Dockerfile de fine surcouche** — il n'ajoute pas de script de
point d'entrée personnalisé et exécute sans modification le point d'entrée de
l'image amont :

```dockerfile
ARG KAVITA_VERSION=0.8.7
FROM jvmilazz0/kavita:${KAVITA_VERSION}
```

- **`image_source = "custom"`** — ce paramètre est défini uniquement pour que le
  socle construise/mette en miroir l'image dans Artifact Registry ; aucun code
  applicatif n'y est ajouté.
- **ARG de build propre à l'application** — le Dockerfile lit `KAVITA_VERSION`,
  **et non** l'`APP_VERSION` générique qu'injecte le socle (et qu'il forcerait à
  `latest`). Lorsque `application_version = "latest"`, la couche Common épingle le
  build sur `0.8.7` ; sinon, elle transmet telle quelle la version demandée. Cela
  évite de résoudre au moment du build un tag dérivé de `kavita:latest` qui
  n'existe pas.
- **Aucune traduction du point d'entrée** — comme Kavita n'a besoin d'aucun
  câblage de base de données ni d'aucune réécriture d'URL au démarrage, le
  démarrage par défaut de l'image amont est utilisé tel quel.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Kavita_Common` établit l'environnement minimal dont Kavita a besoin pour
démarrer la première fois et écrire son état sur le volume persistant :

- **`DOTNET_gcServer = "0"`** — sélectionne le ramasse-miettes .NET de type
  *workstation* plutôt que le GC serveur, ce qui maintient l'empreinte mémoire de
  Kavita faible et stable dans un petit conteneur à instance unique.
- **Port de conteneur `5000`** — Kavita sert le HTTP sur le port 5000 par défaut,
  ce qui correspond au `container_port` du module.
- **Répertoire d'état fixe `/kavita/config`** — la configuration de Kavita, sa
  base de données SQLite, les images de couverture, les signets, les sauvegardes
  et les journaux résident tous dans ce répertoire unique, intégré à l'image.
  Tout ce que Kavita persiste se trouve ici.
- **Aucun paramètre de télémétrie, de file d'attente ou de mode d'exécution** —
  il n'y a rien d'autre à configurer au démarrage ; le reste de la configuration
  (compte administrateur, bibliothèques) s'effectue via l'assistant du premier
  lancement de l'interface web.

Montage de `/kavita/config` selon la plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/kavita/config` via
  GCS FUSE (`enable_gcs_storage_volume = true`).
- **GKE**, avec `stateful_pvc_enabled = true` (valeur par défaut), monte un PVC
  bloc sur `/kavita/config` et définit `enable_gcs_storage_volume = false` pour
  éviter un double montage au même chemin (gcsfuse corromprait en outre la base
  de données SQLite et les fichiers d'index de Kavita).

Notez que ce module ne persiste que le répertoire d'**état** de Kavita. Le
contenu réel de la bibliothèque (bandes dessinées, mangas, livres numériques) est
censé être fourni par des volumes montés — des `gcs_volumes` supplémentaires ou
un montage NFS — que vous enregistrez ensuite comme bibliothèques dans
l'interface de Kavita.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et d'activité émettent toutes deux une requête
**HTTP GET `/api/health`**, le point de terminaison public et non authentifié de
Kavita qui renvoie `200` dès que le serveur répond — les sondes réussissent donc
indépendamment de toute connexion administrateur ou de toute analyse de la
bibliothèque.

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage d'objets {#7-object-storage}

Un unique bucket **Cloud Storage** est déclaré ici et provisionné par le socle,
qui accorde également l'accès au compte de service de la charge de travail :

- **`name_suffix = "storage"`**, classe de stockage **STANDARD**,
  `force_destroy = true`, gestion des versions désactivée, avec
  `public_access_prevention = "enforced"`.
- La `location` du bucket est laissée vide afin que le socle la résolve à partir
  de la région de déploiement découverte automatiquement (ce qui évite un
  remplacement forcé du bucket, dont l'emplacement est immuable, lors d'un
  nouvel apply dans une autre région).
- Sur Cloud Run, il sert de support à `/kavita/config` via GCS FUSE ; il contient
  donc la base de données SQLite de Kavita, les images de couverture, les
  signets, les sauvegardes et les journaux.

Listez-le avec :

```bash
gcloud storage buckets list --project "$PROJECT"
```

**Remarque sur le type de stockage.** Le répertoire `/kavita/config` de Kavita
sollicite fortement SQLite et tire profit d'un **stockage bloc** pour des E/S
aléatoires à faible latence. Sur GKE, le PVC bloc (`stateful_pvc_enabled = true`)
est le choix le plus adapté. Le montage GCS FUSE de Cloud Run fonctionne, mais
présente une latence plus élevée et convient mieux aux petites bibliothèques ;
les grandes bibliothèques et les analyses fréquentes de métadonnées se portent
bien mieux sur le PVC bloc de GKE.

---

Pour la configuration propre à Kavita destinée aux utilisateurs (variables par
groupe, sorties et manière d'explorer chaque service depuis la console et la
CLI), consultez les guides des plateformes :
**[Kavita_GKE](Kavita_GKE.md)** et **[Kavita_CloudRun](Kavita_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Kavita sur Google Cloud Run](Kavita_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Kavita sur GKE Autopilot](Kavita_GKE.md) — cette configuration déployée sur GKE.
