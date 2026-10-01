---
title: "LubeLogger Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module LubeLogger — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/LubeLogger_Common.md @ 3055034 sha256:0bd1092f94a0 -->

# LubeLogger Common — Configuration applicative partagée {#lubelogger-common--shared-application-configuration}

`LubeLogger_Common` est la **couche applicative partagée** de LubeLogger. Elle ne se
déploie pas seule ; elle fournit la configuration propre à LubeLogger sur laquelle
s'appuient à la fois [LubeLogger_GKE](LubeLogger_GKE.md) et
[LubeLogger_CloudRun](LubeLogger_CloudRun.md), afin que les deux variantes de
plateforme se comportent de manière identique là où cela compte. Les utilisateurs
finaux ne configurent jamais cette couche directement — elle n'a pas d'entrées
propres dans l'interface de déploiement — mais comprendre ce qu'elle fournit
explique les valeurs par défaut que vous voyez dans la documentation des
plateformes.

Pour l'infrastructure qui provisionne et exécute réellement LubeLogger, consultez
les guides des plateformes ([LubeLogger_GKE](LubeLogger_GKE.md),
[LubeLogger_CloudRun](LubeLogger_CloudRun.md)) et les guides des fondations
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par LubeLogger_Common | Où cela apparaît |
|---|---|---|
| Authentification | **Aucun secret généré** — le premier compte est créé par inscription en libre-service via le formulaire Register de `/Login` | Page `/Login` de LubeLogger lors du premier accès |
| Image de conteneur | Pointe directement sur l'image officielle préconstruite `ghcr.io/hargata/lubelogger` — aucun Dockerfile personnalisé ni étape Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun par défaut** — le mode par défaut de LubeLogger utilise un fichier de base de données LiteDB intégré sous `/App/data` (`database_type = "NONE"`) | §Base de données des guides des plateformes |
| Amorçage de la base de données | **Aucun** — il n'y a pas de job `db-init` ; LubeLogger gère son propre stockage | s.o. |
| Stockage objet | Déclare deux buckets Cloud Storage : `storage` (le fichier de base de données LiteDB ainsi que les photos/reçus/documents téléversés) et `dpkeys` (clés ASP.NET Core Data Protection) | Sortie `storage_buckets` |
| Paramètres principaux | Définit `EnableAuth = "true"` (sécurisé par défaut) et le port de conteneur `8080` | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit les sondes de démarrage et de vivacité par défaut, qui ciblent `/Login` | §Observabilité des guides des plateformes |

---

## 2. Secrets {#2-secrets}

Le mode par défaut de LubeLogger (LiteDB intégré) ne génère **aucun secret**.
L'authentification repose entièrement sur l'**inscription en libre-service** : la
première personne qui soumet le formulaire Register sur `/Login` peut utiliser
l'application. Tous les jetons et sessions d'authentification sont ensuite émis et
stockés par LubeLogger lui-même.

Les sorties `secret_ids` et `secret_values` de `LubeLogger_Common` sont donc codées
en dur sous forme de maps vides — les variantes CloudRun/GKE les référencent
néanmoins (pour câbler `module_secret_env_vars` / des valeurs de secret explicites)
afin de respecter un contrat de module uniforme, mais rien n'est jamais créé ni
injecté.

Voir [App_Common](App_Common.md) pour le modèle partagé des secrets et de Workload
Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Le mode par défaut de LubeLogger n'utilise **pas** de base de données externe. Tout
son état — dossiers de véhicules, historiques d'entretien et de carburant, comptes
utilisateurs et paramètres — réside dans un unique **fichier de base de données
LiteDB interne** écrit sous `/App/data`. Par conséquent :

- `database_type = "NONE"` — aucune instance Cloud SQL, base de données ni
  utilisateur n'est créé.
- Il n'y a **pas de job `db-init`** — LubeLogger initialise lui-même son fichier de
  base de données au premier démarrage.
- Aucune extension PostgreSQL, aucun Redis et aucune file d'attente ni worker
  n'interviennent.

LubeLogger prend aussi en charge un backend **Postgres** externe facultatif,
configuré entièrement via une unique variable d'environnement DSN de type
clé-valeur :

```
POSTGRES_CONNECTION = "Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;"
```

`LubeLogger_Common` ne le câble **pas** par défaut — aucune instance Cloud SQL n'est
provisionnée pour cela. Un opérateur qui souhaite le backend Postgres doit disposer
de sa propre instance Postgres et peut définir `POSTGRES_CONNECTION` via
`secret_environment_variables` ou `environment_variables` sur le déploiement de la
plateforme.

Inspectez les données persistées directement (PVC bloc sur GKE, ou bucket GCS sur
Cloud Run) plutôt qu'au moyen d'un client de base de données, car LiteDB est un
moteur intégré, à base de fichiers, sans protocole réseau.

---

## 4. Image de conteneur {#4-container-image}

LubeLogger utilise l'**image officielle préconstruite** sans aucune modification :

```
ghcr.io/hargata/lubelogger:<version>
```

- **`image_source = "prebuilt"`** — aucun Dockerfile, aucun script de point d'entrée
  personnalisé et aucune étape Cloud Build ; le conteneur exécuté est l'image amont
  non modifiée.
- **`enable_image_mirroring = true`** par défaut copie l'image dans Artifact Registry
  pour éviter les limites de débit de GHCR.
- Vérifié directement sur l'image (`docker inspect`) : `CMD ["./CarCareTracker"]`,
  `WorkingDir /App`, `ExposedPorts 8080/tcp`, aucune directive `USER` (s'exécute en
  root).

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`LubeLogger_Common` établit l'environnement minimal dont LubeLogger a besoin pour
démarrer de manière sécurisée dès le premier lancement et écrire son état sur le
volume persistant :

- **`EnableAuth = "true"`** — remplace la valeur par défaut de `appsettings.json` de
  LubeLogger, `EnableAuth=false` (accès entièrement ouvert, sans aucune connexion).
- **`/App/data` comme répertoire de données** — vérifié directement sur l'image en
  cours d'exécution : au premier démarrage, LubeLogger crée automatiquement les
  sous-répertoires `config/`, `documents/`, `images/`,
  `temp/`, `themes/` et `translations/` sous `/App/data`.
- **Port de conteneur `8080`** — correspond à la valeur par défaut
  `ASPNETCORE_HTTP_PORTS` de l'image elle-même.
- **Aucun paramètre de télémétrie, de file d'attente ou de mode d'exécution** — le
  premier compte est créé par inscription en libre-service ; rien d'autre n'est
  configuré au démarrage.

Montage de `/App/data` propre à chaque plateforme :

- **Cloud Run** monte le bucket Cloud Storage `storage` sur `/App/data` via GCS FUSE.
- **GKE** avec `stateful_pvc_enabled = true` (la valeur par défaut du module) monte
  un PVC bloc sur `/App/data` et définit `enable_gcs_storage_volume = false` pour
  éviter un double montage sur le même chemin.

Un second petit bucket (`dpkeys`) est **toujours** monté sur le chemin fixe
`/root/.aspnet/DataProtection-Keys`, indépendamment du mode de montage de
`/App/data` — voir §7.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes de démarrage et de vivacité émettent toutes deux un **HTTP GET `/Login`**,
la page publique et non authentifiée de LubeLogger — vérifié directement sur l'image
en cours d'exécution (`/`
renvoie `302` lorsque `EnableAuth=true`, puisqu'elle est protégée par
`[Authorize]` ; `/Login` renvoie `200`).

- **Sonde de démarrage** — `initial_delay = 15s`, `timeout = 5s`, `period = 10s`,
  `failure_threshold = 10`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`, `period = 30s`,
  `failure_threshold = 3`.

---

## 7. Stockage objet {#7-object-storage}

Deux buckets **Cloud Storage** dédiés sont déclarés ici et provisionnés par la
fondation, qui accorde également l'accès au compte de service de la charge de
travail :

- **`storage`** — le fichier de base de données LiteDB intégré de LubeLogger ainsi
  que les photos/reçus/documents téléversés. Sur Cloud Run, il sert de support à
  `/App/data` via GCS FUSE ; sur GKE, il est remplacé par défaut par un PVC bloc de
  StatefulSet sur le même chemin.
- **`dpkeys`** — les clés de signature des cookies et des sessions d'ASP.NET Core
  Data Protection, montées sur le chemin fixe `/root/.aspnet/DataProtection-Keys`
  sur **les deux** plateformes, toujours, quelle que soit la manière dont
  `/App/data` est monté. Ce chemin n'est pas configurable via une variable
  d'environnement dans l'image.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
```

**Remarque sur le type de stockage.** La base de données LiteDB de LubeLogger
requiert idéalement un **stockage bloc** pour un verrouillage de fichiers fiable.
Sur GKE, le PVC bloc (`stateful_pvc_enabled = true`) est le choix le mieux adapté.
Le montage GCS FUSE de Cloud Run fonctionne, mais sa latence est plus élevée et il
convient mieux à un usage léger.

---

Pour la configuration propre à LubeLogger destinée aux utilisateurs (variables par
groupe, sorties, et manière d'explorer chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[LubeLogger_GKE](LubeLogger_GKE.md)** et
**[LubeLogger_CloudRun](LubeLogger_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [LubeLogger sur Google Cloud Run](LubeLogger_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) — cette configuration déployée sur GKE.
