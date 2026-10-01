---
title: "Uptime Kuma Common — Configuration applicative partagée"
description: "Référence de configuration partagée pour le module Uptime Kuma — paramètres de la couche applicative utilisés à la fois par les déploiements Cloud Run et GKE Autopilot."
---

<!-- translated-from: docs/modules/UptimeKuma_Common.md @ 3055034 sha256:7508eff7fe71 -->

# Uptime Kuma Common — Configuration applicative partagée {#uptime-kuma-common--shared-application-configuration}

`UptimeKuma_Common` est la **couche applicative partagée** d'Uptime Kuma. Elle n'est pas déployée seule ; elle fournit la configuration propre à Uptime Kuma sur laquelle s'appuient à la fois [UptimeKuma_CloudRun](UptimeKuma_CloudRun.md) et la variante GKE, afin que les deux variantes de plateforme se comportent de manière identique là où cela compte. Les utilisateurs finaux ne configurent jamais directement cette couche — elle ne possède aucune entrée propre dans l'interface de déploiement — mais comprendre ce qu'elle fournit explique les valeurs par défaut que vous voyez dans la documentation des plateformes.

Pour l'infrastructure qui provisionne et exécute réellement Uptime Kuma, consultez le guide de la plateforme ([UptimeKuma_CloudRun](UptimeKuma_CloudRun.md)) et les guides du socle ([App_CloudRun](App_CloudRun.md), [App_GKE](App_GKE.md), [App_Common](App_Common.md)).

---

## 1. Ce que fournit cette couche {#1-what-this-layer-provides}

| Domaine | Fourni par UptimeKuma_Common | Où cela apparaît |
|---|---|---|
| Image de conteneur | Construit via Cloud Build une fine image **personnalisée** `FROM louislam/uptime-kuma:<tag>` (tag `1`, la branche stable v1), en corrigeant le mode de journalisation codé en dur de SQLite pour la sécurité sur NFS (voir §2), avec la duplication dans Artifact Registry activée | Sortie `container_image` du déploiement de la plateforme |
| Moteur de base de données | Fixe **`database_type = "NONE"`** — Uptime Kuma v1 utilise une base de données SQLite intégrée sous `/app/data` ; ni Cloud SQL, ni Auth Proxy | §Base de données dans le guide de la plateforme |
| Secrets | Expose une **map `secret_ids` vide** — aucun secret applicatif n'existe ; les identifiants administrateur sont stockés dans la base de données SQLite | Sortie `secret_ids` |
| Stockage d'objets | Expose une **liste `storage_buckets` vide** — la persistance provient du volume NFS du socle, pas de GCS | Sortie `storage_buckets` |
| Jobs d'initialisation | Aucun par défaut — Uptime Kuma crée son schéma SQLite au premier démarrage ; les jobs fournis par l'utilisateur sont transmis s'il y en a | `initialization_jobs` dans la configuration |
| Port du conteneur | `3001` — le port d'écoute natif d'Uptime Kuma | Câblage du service et des sondes |
| Sondes de santé | Sondes HTTP par défaut de démarrage (`/`, délai initial de 30 s, 30 échecs à 10 s) et de vivacité (`/`, délai de 30 s, 3 échecs à 30 s) sur le port 3001 | §Observabilité dans le guide de la plateforme |

---

## 2. Image de conteneur — le build personnalisé corrige SQLite pour la sécurité sur NFS {#2-container-image--custom-build-patches-sqlite-for-nfs-safety}

`UptimeKuma_Common` définit `image_source = "custom"` et un véritable `container_build_config` (`enabled = true`, `dockerfile_path = "Dockerfile"`, `context_path = "."`) pointant vers `UptimeKuma_Common/scripts/Dockerfile`. Ce Dockerfile est une fine couche `FROM louislam/uptime-kuma:${APPLICATION_VERSION}` qui corrige une seule ligne du code source : Uptime Kuma définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans `server/database.js`, non configurable par variable d'environnement). WAL repose sur un verrouillage par plages d'octets en mémoire partagée entre le fichier de base de données et son fichier annexe `-wal`, que le volume `/app/data` adossé à NFS, utilisé par cette application pour la durabilité, ne fournit pas de manière fiable — cette combinaison a provoqué des erreurs `SQLITE_CORRUPT` constatées. Le build fait plutôt passer le PRAGMA en mode `DELETE`, qui n'a besoin que du verrouillage standard du fichier entier, que NFS gère correctement (au prix d'un fsync par commit — un compromis acceptable pour une application de supervision peu gourmande en écritures). L'`ENTRYPOINT`/`CMD` de l'image de base reste par ailleurs inchangé. `enable_image_mirroring = true` pousse ensuite l'image construite dans l'Artifact Registry du projet, afin que les téléchargements en production ne dépendent jamais de la disponibilité ni des limites de débit de Docker Hub.

La valeur par défaut de `application_version` est `1` — la branche stable v1, qui stocke tout l'état dans SQLite intégré. Inspectez l'image construite/mise en miroir :

```bash
gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo>" \
  --filter="package~uptime-kuma"
```

---

## 3. Ni base de données, ni secrets {#3-no-database-no-secrets}

Uptime Kuma v1 conserve tout — moniteurs, historique des vérifications, paramètres de notification, pages de statut et utilisateur administrateur — dans une **base de données SQLite intégrée** sous `/app/data`. Par conséquent, cette couche :

- fixe `database_type = "NONE"` et `enable_cloudsql_volume = false` (pas d'instance Cloud SQL, pas de sidecar Auth Proxy, pas de job `db-init`) ;
- renvoie `secret_ids = {}` et `secret_values = {}` — il n'y a rien à créer dans Secret Manager. Le seul identifiant est le compte administrateur que vous créez de manière interactive lors du premier accès, stocké dans SQLite.

Vérifiez qu'aucun secret propre à l'application ni aucune instance SQL n'existe pour le déploiement :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~uptimekuma"
gcloud sql instances list --project "$PROJECT"
```

---

## 4. Persistance — SQLite sur le volume NFS {#4-persistence--sqlite-on-the-nfs-volume}

Comme l'état est un fichier SQLite, la durabilité dépend de **l'emplacement de ce fichier**. Les modules applicatifs utilisent par défaut `enable_nfs = true` avec `nfs_mount_path = "/app/data"`, si bien que le socle monte un partage Cloud Filestore (NFS) sur le répertoire de données d'Uptime Kuma. La base de données, les fichiers téléversés et les paramètres survivent alors aux redémarrages, aux nouvelles révisions et aux événements de mise à l'échelle.

Deux règles d'exploitation découlent directement de SQLite sur NFS :

1. **Le chemin de montage doit rester `/app/data`.** Tout autre chemin conduit Uptime Kuma à écrire sur le disque éphémère du conteneur — perte totale des données au prochain redémarrage.
2. **N'exécutez qu'un seul écrivain.** SQLite est une base de données à écrivain unique et repose sur le respect des verrous de fichiers par le serveur NFS ; conservez `max_instance_count = 1` en production pour éviter les conflits de verrouillage ou la corruption.

```bash
gcloud filestore instances list --project "$PROJECT"
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
  --format="yaml(spec.template.spec.volumes)"
```

---

## 5. Valeurs d'exécution par défaut {#5-runtime-defaults}

Les valeurs par défaut des ressources et de la mise à l'échelle de cette couche sont dimensionnées pour une charge de travail de supervision typique :

- **CPU/mémoire** — `1000m` / `512Mi` par instance ; largement suffisant pour des dizaines de moniteurs.
- **Mise à l'échelle** — `min_instance_count = 1` / `max_instance_count = 10` dans cette couche ; la variante CloudRun les remplace (`min = 0`, `max = 3`) — consultez les pièges du guide de la plateforme pour comprendre pourquoi une supervision de production demande `min = 1` et `max = 1`.
- **CPU toujours allouée** — définie dans la variante de plateforme (`cpu_always_allocated = true`) : le planificateur de vérifications d'Uptime Kuma s'exécute dans le processus sans requête entrante, la CPU ne doit donc pas être bridée entre les requêtes.

---

## 6. Comportement des sondes de santé {#6-health-probe-behaviour}

Les deux sondes sont des requêtes HTTP `GET /` sur le port `3001` — Uptime Kuma sert son chemin racine sans authentification avec un HTTP 200 dès que le serveur Node.js est démarré.

- **Sonde de démarrage** — HTTP `/`, délai initial de 30 s, période de 10 s, seuil d'échec de 30. Cela laisse jusqu'à 30 + (30 × 10) = 330 secondes à partir du démarrage du conteneur, ce qui couvre la création du schéma SQLite au premier démarrage sur un montage NFS à froid.
- **Sonde de vivacité** — HTTP `/`, délai initial de 30 s, période de 30 s, seuil d'échec de 3.

Il n'existe pas de point de terminaison de santé authentifié distinct dont il faudrait se soucier — le chemin racine est public, si bien que les sondes réussissent sur Cloud Run comme sur GKE sans traitement particulier.

---

Pour la configuration propre à Uptime Kuma exposée aux utilisateurs (variables par groupe, sorties, et comment explorer chaque service depuis la console et la CLI), consultez le guide de la plateforme :
**[UptimeKuma_CloudRun](UptimeKuma_CloudRun.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) — cette configuration déployée sur Cloud Run.
- [Uptime Kuma sur GKE Autopilot](UptimeKuma_GKE.md) — cette configuration déployée sur GKE.
