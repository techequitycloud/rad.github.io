---
title: "Spoolman Common — Configuration applicative partagée"
description: "Référence de la configuration partagée du module Spoolman — paramètres de la couche applicative utilisés par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Spoolman_Common.md @ 3055034 sha256:b4cdcf11a32d -->

# Spoolman Common — Configuration applicative partagée {#spoolman-common--shared-application-configuration}

`Spoolman_Common` est la **couche applicative partagée** de Spoolman. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Spoolman sur laquelle
s'appuient à la fois [Spoolman_GKE](Spoolman_GKE.md) et [Spoolman_CloudRun](Spoolman_CloudRun.md),
afin que les deux variantes de plateforme se comportent de manière identique là où
c'est important. Les utilisateurs finaux ne configurent jamais cette couche
directement — elle n'a aucune entrée propre dans l'interface de déploiement — mais
comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la
documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute effectivement Spoolman, consultez les
guides des plateformes ([Spoolman_GKE](Spoolman_GKE.md), [Spoolman_CloudRun](Spoolman_CloudRun.md))
et les guides des socles ([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par Spoolman_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | `ghcr.io/donkie/spoolman` — image officielle préconstruite, aucun build personnalisé | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **Cloud SQL pour PostgreSQL 15** comme seul moteur pris en charge | §Base de données dans les guides des plateformes |
| Amorçage de la base de données | Aucun n'est nécessaire — le socle crée automatiquement le rôle/la base de données, et Spoolman se migre lui-même au démarrage | Aucun `initialization_jobs` déclaré |
| Stockage objet | Aucun — Spoolman conserve tout son état dans Cloud SQL | Output `storage_buckets` (toujours `[]`) |
| Paramètres principaux | Définit `SPOOLMAN_DB_TYPE=postgres` et une échappatoire `SPOOLMAN_DB_QUERY` vide | Comportement de l'application dans les guides des plateformes |
| Contrôles de santé | Fournit la sonde de démarrage/vivacité par défaut ciblant `/api/health` | §Observabilité dans les guides des plateformes |

---

## 2. Aucun secret cryptographique {#2-no-cryptographic-secrets}

Contrairement à la plupart des modules applicatifs de ce catalogue, `Spoolman_Common`
ne génère **aucun** secret Secret Manager propre à l'application. Spoolman n'a aucune
authentification propre à amorcer — il n'y a ni compte administrateur, ni clé API,
ni clé de chiffrement à générer et à stocker. Le seul identifiant existant est le mot
de passe de la base de données, qui est généré et géré entièrement par le socle
(`App_CloudRun` / `App_GKE`), et non par cette couche.

```bash
# Confirm no app-specific secrets exist beyond the DB password:
gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
```

Consultez [App_Common](App_Common.md) pour le modèle partagé des secrets et de
Workload Identity.

---

## 3. Moteur de base de données et amorçage {#3-database-engine-and-bootstrap}

Spoolman requiert **PostgreSQL 15** dans ce module ; le moteur est fixe. Aucun job
d'initialisation n'est déclaré — le socle crée automatiquement le rôle et la base de
données Postgres pour `database_type = "POSTGRES_15"`, et Spoolman applique
automatiquement ses propres migrations de schéma Alembic à **chaque** démarrage du
conteneur (y compris le premier). Il s'agit d'une simplification délibérée par rapport
à la plupart des modules Common de ce catalogue, qui ont besoin d'un job `db-init`
pour la création du rôle/de la base de données, les droits ou l'installation
d'extensions — Spoolman n'a besoin de rien de tout cela.

Le câblage de la connexion mérite une remarque particulière : la couche SQLAlchemy de
Spoolman construit l'URL de sa base de données via `URL.create()` — un objet structuré
doté de champs distincts `host`/`port`/`username`/`password`/`database`/`query`, et
non une chaîne de connexion concaténée. C'est important, car le chemin du répertoire
du socket Unix du Cloud SQL Auth Proxy (`/cloudsql/<project>:<region>:<instance>`)
contient des deux-points dans le nom de connexion de l'instance, ce qui casse
l'analyse naïve des chaînes d'URL dans d'autres frameworks (une classe de bugs
récurrente et documentée dans ce catalogue — voir Vikunja et Logto). Spoolman y est
insensible : le chemin du socket est transmis tel quel dans le champ structuré `host`,
sans aucune analyse. Cloud Run (socket Unix) comme GKE (boucle locale du sidecar
cloud-sql-proxy) se connectent donc sans qu'aucune configuration TLS/`sslmode` soit
nécessaire.

```bash
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Les noms de l'instance, de la base de données et de l'utilisateur figurent dans les
outputs du déploiement de la plateforme.

---

## 4. Image de conteneur {#4-container-image}

`Spoolman_Common` définit `image_source = "prebuilt"` et `container_image =
"ghcr.io/donkie/spoolman"` — aucune étape Cloud Build n'est exécutée. Il s'agit d'une
véritable image préconstruite en amont ; ce module ne comporte ni Dockerfile, ni
script d'entrypoint, ni épinglage de version par build-arg. Spoolman écoute sur le
port `8000`.

---

## 5. Paramètres principaux de l'application {#5-core-application-settings}

`Spoolman_Common` établit l'environnement minimal nécessaire pour que Spoolman se
connecte correctement à Postgres :

- **`SPOOLMAN_DB_TYPE = "postgres"`** — toujours injectée. Sans elle, Spoolman se
  rabat silencieusement sur sa valeur par défaut intégrée (un fichier SQLite local au
  conteneur, effacé à chaque redémarrage) **sans la moindre erreur**. Ne l'omettez
  jamais.
- **`SPOOLMAN_DB_QUERY = ""`** — une échappatoire vide pour des paramètres de requête
  DSN supplémentaires (par exemple `sslmode=require`). Laissée vide, car les deux
  plateformes se connectent via un socket local/une boucle locale sans TLS requis ;
  ne la renseignez que si un déploiement en production doit forcer une connexion TCP
  à la place.

Les variables d'environnement `SPOOLMAN_DB_HOST` / `SPOOLMAN_DB_PORT` /
`SPOOLMAN_DB_USERNAME` / `SPOOLMAN_DB_PASSWORD` / `SPOOLMAN_DB_NAME` ne sont **pas**
définies par cette couche Common — elles sont des alias directs des variables
standard du socle `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME`, via
les variables `db_*_env_var_name` déclarées dans `Spoolman_CloudRun` et
`Spoolman_GKE`.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les sondes par défaut ciblent `/api/health` — un point de terminaison public et non
authentifié qui renvoie un statut JSON 200/OK une fois le serveur entièrement
initialisé et connecté à PostgreSQL.

- **Cloud Run** utilise des sondes HTTP ciblant `/api/health` avec un délai initial de
  10 secondes.
- **GKE** utilise la même cible de sonde HTTP et le même calendrier.

---

## 7. Stockage objet {#7-object-storage}

Aucun bucket GCS n'est déclaré — `storage_buckets` renvoie toujours une liste vide.
Spoolman conserve tout son état (bobines, filaments, fournisseurs, historique de
consommation) dans Cloud SQL PostgreSQL ; il n'y a rien à persister sur un volume
distinct.

---

Pour la configuration propre à Spoolman et visible par l'utilisateur (variables par
groupe, outputs et exploration de chaque service depuis la console et la CLI),
consultez les guides des plateformes : **[Spoolman_GKE](Spoolman_GKE.md)** et
**[Spoolman_CloudRun](Spoolman_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Spoolman sur Google Cloud Run](Spoolman_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Spoolman sur GKE Autopilot](Spoolman_GKE.md) — cette configuration déployée sur GKE.
