---
title: "Gatus Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Gatus — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Gatus_Common.md @ 3055034 sha256:ba3a5b406406 -->

# Gatus Common — Configuration applicative partagée {#gatus-common--shared-application-configuration}

`Gatus_Common` est la **couche applicative partagée** de Gatus. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Gatus sur laquelle
s'appuient à la fois [Gatus_GKE](Gatus_GKE.md) et [Gatus_CloudRun](Gatus_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
cela compte. Les utilisateurs finaux ne configurent jamais directement cette
couche — elle ne possède aucune entrée propre dans l'interface de déploiement —
mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez
dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Gatus, consultez les
guides des plateformes ([Gatus_GKE](Gatus_GKE.md), [Gatus_CloudRun](Gatus_CloudRun.md))
et les guides du socle ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Gatus_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Encapsule l'image officielle `ghcr.io/twin/gatus` — un binaire statique véritablement distroless — avec un `config.yaml` intégré et un répertoire `/data` vide accessible en écriture ; construite via Cloud Build | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | **Aucun** — `database_type = "NONE"`. Gatus n'a pas de base de données externe ; son stockage d'historique facultatif est un fichier SQLite local | §Base de données dans les guides des plateformes |
| Initialisation de la base de données | **Aucune** — aucun job d'initialisation n'est injecté. `initialization_jobs` est transmis tel quel (vide par défaut) | Sortie `initialization_jobs` |
| Secrets cryptographiques | **Aucun** — `secret_ids` est vide. Gatus n'a besoin d'aucun identifiant au moment du déploiement ; la protection facultative par basic-auth/OIDC se configure directement dans `config.yaml` | — |
| Stockage d'objets | **Aucun** — `storage_buckets` est vide | Sortie `storage_buckets` |
| Paramètres de base | Fixe `container_port = 8080` ; les points de terminaison, les alertes et le stockage reposent entièrement sur un fichier (`config.yaml`), et non sur des variables d'environnement | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde par défaut de démarrage/d'activité ciblant `/health` | §Observabilité dans les guides des plateformes |

La forme de l'output `config` (l'objet consommé par les deux variantes) est fixée
ici : `container_port = 8080`, `database_type = "NONE"`, `image_source = "custom"`,
`enable_image_mirroring = true`, ainsi qu'un ensemble vide pour `initialization_jobs` /
`secret_ids` / `storage_buckets`.

---

## 2. Aucun secret, aucune base de données, aucun bucket {#2-no-secrets-no-database-no-buckets}

Contrairement à la plupart des modules applicatifs, `Gatus_Common` ne génère **rien**
dans Secret Manager et ne provisionne **aucune** instance Cloud SQL ni aucun bucket
GCS :

- `secret_ids = {}` et `secret_values = {}` — il n'y a aucun identifiant généré
  automatiquement à injecter. Gatus n'a pas de système de comptes utilisateurs
  intégré ; il ne se connecte à aucune base de données externe et n'a besoin ni de
  mot de passe d'initialisation ni de clé de chiffrement.
- `storage_buckets = []` — Gatus conserve tout ce dont il a besoin (son stockage
  d'historique facultatif) dans un fichier SQLite local, et non dans un stockage
  d'objets.
- `database_type = "NONE"` — aucune instance Cloud SQL for PostgreSQL/MySQL n'est
  créée. Les variables liées à la base de données qui apparaissent dans les guides
  des plateformes (`db_name`, `db_user`, `enable_cloudsql_volume`,
  `database_password_length`, …) sont inertes, sauf si vous choisissez explicitement
  une base de données externe, ce dont Gatus n'a pas besoin.

**Le contrôle d'accès est une étape du fichier de configuration, et non une étape
postérieure au déploiement.** Si vous souhaitez exiger une authentification pour
consulter la page de statut, configurez le bloc `security` de Gatus (basic auth ou
OIDC) directement dans `modules/Gatus_Common/scripts/config.yaml` et reconstruisez
l'image — il n'existe ni API d'exécution ni interface d'administration pour cela.

---

## 3. Image de conteneur — une base véritablement distroless, sans wrapper de point d'entrée {#3-container-image--a-genuinely-distroless-base-no-entrypoint-wrapper}

L'image personnalisée est un wrapper léger autour de l'image serveur officielle de
Gatus :

```dockerfile
ARG GATUS_VERSION=v5.36.0

FROM alpine:3.20 AS builder
RUN mkdir -p /data

FROM ghcr.io/twin/gatus:${GATUS_VERSION}
COPY config.yaml /config/config.yaml
COPY --from=builder /data /data

EXPOSE 8080
```

- **ARG de build propre à l'application.** Le tag de base est piloté par
  `GATUS_VERSION`, **et non** par l'`APP_VERSION` générique que le socle injecte.
  Gatus publie des tags préfixés par `v` (p. ex. `v5.36.0`) et ne propose aucune
  variante `latest-<x>`, si bien que `application_version =
  "latest"` correspond à une version récente épinglée (`v5.36.0`) — un nouveau build
  ne résout jamais un tag inexistant. Ce comportement est défini dans `Gatus_Common`
  via `gatus_image_version = var.application_version == "latest" ? "v5.36.0" : var.application_version`.
- **Construite via Cloud Build et mise en miroir.** `image_source = "custom"` avec
  `enable_image_mirroring = true`, si bien que l'image construite est placée dans
  l'Artifact Registry du projet au lieu d'être récupérée depuis GHCR à l'exécution.
- **Aucun shell, aucun wrapper de point d'entrée — confirmé via `docker export`.**
  Contrairement à tous les autres modules de ce catalogue qui utilisent un build
  personnalisé, `ghcr.io/twin/gatus` est véritablement distroless : l'image finale ne
  contient que le binaire statique `/gatus`, `/config/config.yaml` et les fichiers
  standard `passwd`/`group`/`hosts` — aucun shell, aucun busybox, aucun éditeur de
  liens dynamique. Une étape `RUN` sur l'étape finale échouerait purement et
  simplement, et il n'existe aucun moyen (ni aucun besoin) d'y greffer un point
  d'entrée basé sur un shell. Les instructions `EXPOSE 8080` et
  `ENTRYPOINT ["/gatus"]` de l'image de base restent totalement intactes ; ce
  Dockerfile ajoute uniquement deux couches `COPY`. Une minuscule étape **builder**
  Alpine existe uniquement pour créer un répertoire `/data` vide que
  `COPY --from=builder` peut transporter dans l'image finale distroless (l'étape
  finale n'a pas de shell pour exécuter elle-même `mkdir`).

---

## 4. La configuration repose entièrement sur un fichier — `config.yaml`, et non des variables d'environnement {#4-configuration-is-entirely-file-based--configyaml-not-environment-variables}

Contrairement à presque tous les autres modules applicatifs de ce catalogue, Gatus
n'a **aucune convention de variable d'environnement par paramètre**. Chaque point de
terminaison surveillé, chaque intégration d'alerte et chaque paramètre de stockage se
trouve dans un unique fichier YAML — `modules/Gatus_Common/scripts/config.yaml` —
intégré à l'image au moment du build Cloud Build :

```yaml
storage:
  type: sqlite
  path: /data/data.db

endpoints:
  - name: example
    url: "https://example.org"
    interval: 5m
    conditions:
      - "[STATUS] == 200"
      - "[RESPONSE_TIME] < 5000"
```

- **Aucune API de rechargement de la configuration à l'exécution et aucune interface
  d'administration pour modifier les vérifications.** Pour ajouter, supprimer ou
  modifier un point de terminaison surveillé, éditez ce fichier et redéployez (ce qui
  reconstruit l'image personnalisée via Cloud Build) — il est impossible de le faire
  via l'application en cours d'exécution.
- **`environment_variables`** (transmis depuis les variables de la plateforme) sert
  aux substitutions de type `${VAR}` propres à Gatus, référencées *à l'intérieur* de
  `config.yaml` (p. ex. un jeton de webhook d'alerte), et non à des surcharges par
  paramètre comme dans la plupart des autres modules.

---

## 5. Le stockage d'historique SQLite — mode de journalisation WAL codé en dur, une vraie réserve sur la persistance {#5-the-sqlite-history-store--hardcoded-wal-journal-mode-a-real-persistence-caveat}

Il est confirmé (par une vérification `sqlite3 PRAGMA journal_mode;` en conditions
réelles sur un conteneur en cours d'exécution) que le stockage d'historique
facultatif de Gatus (`storage.type: sqlite`) **code en dur le mode de journalisation
WAL** — aucun paramètre de `config.yaml` ni aucun paramètre de chaîne de connexion
SQLite (`?_journal_mode=DELETE`, testé et confirmé inefficace) ne le désactive. La
documentation de SQLite elle-même indique que WAL **n'est pas pris en charge sur les
systèmes de fichiers réseau**.

Cela a une conséquence directe sur les options de persistance :

- **Par défaut : éphémère.** `/data` est un simple répertoire accessible en écriture
  intégré à l'image, sans aucun montage — l'historique est réinitialisé à chaque
  redémarrage ou redéploiement. C'est délibérément la valeur par défaut du module sur
  les deux plateformes, plutôt que de risquer une corruption silencieuse.
- **Cloud Run :** le seul mécanisme de persistance facultatif est NFS (`enable_nfs =
  true`), qui présente le risque lié à WAL sur un système de fichiers réseau décrit
  ci-dessus. Cloud Run ne propose aucune option de PVC en mode bloc, si bien qu'**il
  n'existe aucun moyen totalement sûr de rendre persistant l'historique de Gatus sur
  Cloud Run**.
- **GKE :** `stateful_pvc_enabled = true` provisionne un véritable périphérique bloc
  (et non gcsfuse) — c'est la **seule option de ce catalogue dont la sûreté a été
  vérifiée** pour le fichier SQLite en mode WAL de Gatus. Associez-la à
  `stateful_pvc_storage_class = "standard"` (HDD), car le stockage d'historique de
  Gatus n'a pas besoin des IOPS d'un SSD, et le HDD évite le quota régional serré
  `SSD_TOTAL_GB` sur lequel puise la classe par défaut adossée au SSD.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut de démarrage et d'activité ciblent **`/health`** — le point de
terminaison de santé intégré de Gatus, qui renvoie HTTP 200 dès que le serveur HTTP
Fiber se lie à son port. Comme Gatus n'a ni migrations de base de données ni
initialisation lourde, il devient sain quelques secondes après le démarrage.

---

Pour la configuration propre à Gatus destinée aux utilisateurs (variables par groupe,
outputs, et manière d'explorer chaque service depuis la console et la CLI), consultez
les guides des plateformes : **[Gatus_GKE](Gatus_GKE.md)** et
**[Gatus_CloudRun](Gatus_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Gatus sur Google Cloud Run](Gatus_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Gatus sur GKE Autopilot](Gatus_GKE.md) — cette configuration déployée sur GKE.
