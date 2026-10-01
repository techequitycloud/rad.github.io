---
title: "Seerr Common — configuration applicative partagée"
description: "Référence de configuration partagée pour le module Seerr — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/Seerr_Common.md @ 3055034 sha256:b85af01d9239 -->

# Seerr Common — configuration applicative partagée {#seerr-common--shared-application-configuration}

`Seerr_Common` est la **couche applicative partagée** de Seerr. Elle n'est pas
déployée seule ; elle fournit la configuration propre à Seerr sur laquelle
s'appuient à la fois [Seerr_GKE](Seerr_GKE.md) et
[Seerr_CloudRun](Seerr_CloudRun.md), afin que les deux variantes de plateforme
se comportent de manière identique là où cela compte. Les utilisateurs finaux ne
configurent jamais directement cette couche — elle n'a aucune entrée propre dans
l'interface de déploiement — mais comprendre ce qu'elle fournit explique les
valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Seerr, consultez les
guides des plateformes ([Seerr_GKE](Seerr_GKE.md),
[Seerr_CloudRun](Seerr_CloudRun.md)) et les guides du socle
([App_GKE](App_GKE.md), [App_CloudRun](App_CloudRun.md),
[App_Common](App_Common.md)).

---

## 1. Ce qu'est Seerr {#1-what-seerr-is}

Seerr est la **fusion, en février 2026, de Jellyseerr et d'Overseerr** en un
seul projet — une interface de demandes sous licence MIT, forte d'environ
11.9k étoiles (chiffre antérieur à la fusion), placée devant un serveur
multimédia Jellyfin, Plex ou Emby. Les utilisateurs parcourent et demandent des
titres ; un administrateur approuve la demande, et Seerr appelle les API de
Sonarr et Radarr pour déclencher l'acquisition. L'image officielle est
`ghcr.io/seerr-team/seerr` — ce catalogue utilise correctement ce chemin, et non
l'ancien `ghcr.io/fallenbagel/jellyseerr`, désormais remplacé.

## 2. Ce que fournit cette couche {#2-what-this-layer-provides}

| Domaine | Fourni par Seerr_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | L'image réellement préconstruite `ghcr.io/seerr-team/seerr` — aucun build personnalisé | Output `container_image` du déploiement de la plateforme |
| Moteur de base de données | PostgreSQL 15, avec la variable d'environnement `DB_TYPE=postgres` définie sans condition | §3 ci-dessous |
| Authentification | **Aucun identifiant amorcé** — le premier administrateur de Seerr provient de son propre assistant de configuration web | Output `secret_ids` (vide, `{}`) |
| Stockage d'objets | Déclare le bucket **Cloud Storage** `storage` qui sous-tend `/app/config`, avec un correctif de permissions propre à GKE | Output `storage_buckets` ; §5 ci-dessous |
| Vérifications de santé | Fournit les sondes de démarrage et de vivacité par défaut ciblant `/api/v1/status` | §6 ci-dessous |

## 3. Le piège DB_TYPE {#3-the-db_type-trap}

La logique de sélection de la source de données de Seerr, confirmée par la
lecture de `/app/dist/datasource.js` dans l'image réellement en cours
d'exécution :

```js
exports.isPgsql = process.env.DB_TYPE === 'postgres';
```

Si `DB_TYPE` n'est pas défini exactement à `postgres`, Seerr se rabat
silencieusement sur un fichier de base de données SQLite interne au conteneur —
aucune erreur, aucun avertissement, et un déploiement qui paraît par ailleurs
parfaitement sain. Chaque écriture, y compris la configuration initiale de
Seerr, aboutit dans un fichier effacé au prochain redémarrage ou démarrage à
froid. Il s'agit de la même catégorie de bug, « le déploiement semble réussi,
les données ne vont silencieusement nulle part de durable », que ce catalogue a
documentée pour d'autres modules (`SYMFONY__ENV__DATABASE_DRIVER` de Wallabag,
les vérifications fragiles « est-ce installé ? » de Nextcloud et de Twenty).

`Seerr_Common` comble cette lacune sans condition :

```hcl
environment_variables = merge(
  { DB_TYPE = "postgres" },
  var.environment_variables
)
```

`DB_TYPE` figure en premier dans l'appel à `merge()`, de sorte que les
`environment_variables` propres à un appelant ne peuvent pas le supprimer
silencieusement, à moins de définir explicitement `DB_TYPE` à une autre valeur.

Pour le reste, les variables de connexion de Seerr suivent la nomenclature
standard du socle — `DB_HOST` / `DB_PORT` (par défaut `5432`) / `DB_USER` /
`DB_NAME` (par défaut `seerr`) — **à l'exception du mot de passe**, que Seerr
lit sous le nom `DB_PASS`, et non `DB_PASSWORD` (confirmé à partir du même code
source `datasource.js`). Les deux modules applicatifs définissent
`db_password_env_var_name = "DB_PASS"` en conséquence. Les migrations
s'exécutent automatiquement : le fichier `dist/index.js` de Seerr appelle
`dbConnection.runMigrations()` à chaque démarrage, si bien qu'**aucun job
`db-init`/de migration distinct n'existe dans ce module.**

## 4. Deux éléments d'état distincts {#4-two-distinct-pieces-of-state}

C'est le fait le plus important, et le moins évident, du modèle de stockage de
Seerr, découvert par l'inspection directe du conteneur plutôt que dans la
documentation :

```bash
docker exec <container> ls /app/config
# settings.json  settings.old.json  db/  logs/
```

Même avec PostgreSQL entièrement configuré et connecté, Seerr écrit toujours
ses **propres paramètres applicatifs** — serveurs multimédias connectés
(Jellyfin/Plex/Emby), curseurs de découverte, agents de notification — dans un
simple fichier `settings.json` sous `CONFIG_DIRECTORY` (par défaut
`/app/config`). PostgreSQL contient les données de demandes et d'utilisateurs ;
`settings.json` contient tout le reste, et cela vaut **quel que soit le backend
de base de données**. Un volume persistant sur `/app/config` est nécessaire en
plus de la connexion Postgres ; à défaut, chaque choix de configuration
applicative est perdu au prochain démarrage à froid, alors même que
l'historique des demandes dans Postgres survit intact.

`Seerr_Common` monte un volume adossé à GCS sur ce chemin dès que
`enable_gcs_storage_volume = true` (la valeur par défaut sur les deux
plateformes).

## 5. Le bug UID/GID de GCS-FUSE sur GKE {#5-the-gke-gcs-fuse-uidgid-bug}

Le conteneur de Seerr s'exécute en tant que `uid=1000/gid=1000` (l'utilisateur
`node` — confirmé via `docker run ghcr.io/seerr-team/seerr id`) et, au premier
démarrage, tente un `mkdir '/app/config/logs/'`.

- **Sur Cloud Run**, l'intégration gcsfuse propre à la plateforme applique
  automatiquement `uid:1000/gid:1000` au volume monté — cela fonctionne sans
  aucune configuration supplémentaire.
- **Sur GKE**, le **pilote CSI GCS FUSE n'utilise pas par défaut un UID
  disposant des droits d'écriture.** Sans correctif explicite, le montage
  appartient à root et le conteneur non root redémarre en boucle avec
  `EACCES: permission denied`.

`Seerr_Common` corrige ce problème de manière uniforme pour les deux plateformes
avec des `mount_options` explicites sur le volume de stockage qu'il déclare :

```hcl
locals {
  _seerr_extra_storage_volumes = var.enable_gcs_storage_volume ? [
    {
      name       = "storage"
      mount_path = "/app/config"
      read_only  = false
      mount_options = [
        "implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
        "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775",
      ]
    }
  ] : []
}
```

Les options `uid`/`gid`/`file-mode`/`dir-mode` sont sans effet et sans danger
sur Cloud Run, et indispensables sur GKE. Il s'agit d'une catégorie de bug
connue dans ce catalogue — le constat « GKE gcsfuse UID/GID permission denied »,
commun à l'ensemble du parc, avait déjà été rencontré et corrigé sur les
variantes GKE de Paperless, CodeServer et CloudBeaver ; Seerr en est le dernier
cas confirmé, désormais corrigé dans cette couche partagée afin que les deux
modules applicatifs en héritent à l'identique.

## 6. Valeurs par défaut des sondes de santé {#6-health-probe-defaults}

Les sondes de démarrage et de vivacité ciblent toutes deux
**`GET /api/v1/status`**, qui renvoie un `200` non authentifié avec du JSON
(`{"version":...,"commitTag":...}`) une fois l'application prête — confirmé par
des tests locaux du conteneur et par un déploiement réel sur les deux
plateformes.

- **Sonde de démarrage** — `initial_delay = 20s`, `timeout = 10s`,
  `period = 15s`, `failure_threshold = 20`.
- **Sonde de vivacité** — `initial_delay = 30s`, `timeout = 5s`,
  `period = 30s`, `failure_threshold = 3`.

## 7. Image préconstruite — aucun build personnalisé {#7-prebuilt-image--no-custom-build}

Contrairement aux applications de ce catalogue qui ajoutent un Dockerfile
personnalisé léger à une image amont, `Seerr_Common` définit
`image_source = "prebuilt"` et `container_build_config.enabled = false`. Le
sous-répertoire `scripts/` est vide — ni Dockerfile, ni point d'entrée cloud,
ni étape de build. Le socle déploie directement `ghcr.io/seerr-team/seerr` avec
le tag `application_version` demandé.

## 8. Aucun identifiant amorcé — par conception {#8-no-credentials-seeded--by-design}

`secret_ids` renvoie une **map vide (`{}`)**. Contrairement à de nombreuses
applications de ce catalogue qui génèrent un mot de passe administrateur dans
Secret Manager, `Seerr_Common` n'en amorce aucun — le premier compte
administrateur de Seerr est créé entièrement via l'assistant de configuration
web de l'application lors du premier accès, en s'appuyant sur la base de données
PostgreSQL déjà provisionnée. Le seul secret Secret Manager associé à un
déploiement Seerr est le mot de passe de base de données généré par le socle.

## 9. Concurrence à écrivain unique {#9-single-writer-concurrency}

La variable `max_instance_count` propre à `Seerr_Common` vaut `1` par défaut,
car `settings.json` est un unique fichier modifiable plutôt qu'une base de
données à écritures transactionnelles — des instances concurrentes risquent une
situation de concurrence entraînant une écriture perdue sur ce fichier.

**Ce n'est toutefois pas cette valeur par défaut qui parvient réellement à un
déploiement** : les variables `max_instance_count` propres à `Seerr_CloudRun` et
à `Seerr_GKE` valent toutes deux `5` par défaut, et chaque variante transmet
`var.max_instance_count` à `Seerr_Common`, écrasant sa valeur par défaut interne
de `1`. Les opérateurs qui ont besoin du comportement prudent, sûr pour un
écrivain unique, doivent définir explicitement `max_instance_count = 1` au
niveau du module applicatif.

---

Pour la configuration propre à Seerr destinée aux utilisateurs (variables par
groupe, outputs et manière d'explorer chaque service depuis la console et la
CLI), consultez les guides des plateformes : **[Seerr_GKE](Seerr_GKE.md)** et
**[Seerr_CloudRun](Seerr_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Seerr sur Google Cloud Run](Seerr_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Seerr sur GKE Autopilot](Seerr_GKE.md) — cette configuration déployée sur GKE.
