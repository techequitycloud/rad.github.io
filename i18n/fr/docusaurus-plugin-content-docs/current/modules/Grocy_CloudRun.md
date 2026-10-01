---
title: "Grocy sur Google Cloud Run"
description: "Référence de configuration pour déployer Grocy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Grocy_CloudRun.md @ 3055034 sha256:15ccb2b851e9 -->

# Grocy sur Google Cloud Run {#grocy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Grocy_CloudRun.png" alt="Grocy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Grocy](https://grocy.info/) est un ERP domestique et de gestion des courses auto-hébergé : suivi des stocks avec lecture de codes-barres, gestion des corvées et des tâches, listes de courses et planification des repas. Il se distingue du module `Mealie` de ce catalogue, qui couvre uniquement les recettes et la planification des repas — Grocy est l'outil d'ERP domestique plus large. Ce module déploie Grocy sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée ; `Grocy_CloudRun` est une fine surcouche qui fournit la configuration propre à Grocy (image, port, sondes, câblage du stockage) et transmet tout le reste tel quel.

Ce guide se concentre sur les services cloud utilisés par Grocy et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Grocy s'exécute sous forme d'un conteneur nginx + php-fpm (l'image `grocy` amont de LinuxServer.io, non modifiée) sur Cloud Run v2. Le déploiement assemble un ensemble restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 1 GiB par défaut, `min=max=1` (pas d'autoscaling — SQLite à écrivain unique) |
| Base de données | Aucune | Grocy utilise une base de données SQLite embarquée — aucune instance Cloud SQL n'est créée |
| État persistant | Cloud Filestore (NFS) | `/config` (base de données SQLite, configuration, téléversements, sauvegardes) est monté via NFS, **pas** via GCS FUSE — voir §4 |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné mais inutilisé par défaut (voir §4) |
| Secrets | Secret Manager | Aucun n'est généré pour Grocy — il n'existe pas d'identifiant administrateur injectable |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge par Grocy.** Confirmé par la lecture du code source amont de Grocy (`services/DatabaseService.php`) — il n'existe aucun embranchement vers un pilote MySQL/Postgres. `database_type` est fixé à `NONE`.
- **`/config` est persisté via NFS, pas via GCS FUSE — un correctif délibéré, et non la valeur par défaut habituelle du catalogue.** Grocy écrit dans `data/grocy.db-journal` toutes les 1 à 2 secondes ; la couche de traduction vers le stockage d'objets de GCS FUSE ne peut pas soutenir ce schéma d'écriture. Un `/config` reposant sur GCS FUSE a tourné en boucle de plantages en production (confirmé en conditions réelles sur 12 cycles de démarrage / plus de 20 minutes — `BufferedWriteHandler.OutOfOrderError` répétés, limitation de débit HTTP `429`, erreurs de descripteur de fichier obsolète). `Grocy_CloudRun` définit à la place `enable_nfs = true`, `nfs_mount_path = "/config"`. Voir §4 pour l'histoire complète.
- **Il s'agit d'une classe de bug réellement différente de l'incident SQLite-sur-NFS d'UptimeKuma.** Le problème d'UptimeKuma était une incompatibilité des verrous en mode WAL. Grocy n'active jamais le mode WAL (aucun PRAGMA `journal_mode` nulle part dans son code source) — son problème tient à la *fréquence* d'écriture, pas à la sémantique des verrous. Ensemble, ces deux cas montrent que « gcsfuse casse SQLite » est une leçon plus large que le seul verrouillage WAL.
- **Instance unique uniquement.** `min_instance_count = 1`, `max_instance_count = 1`. La base de données SQLite de Grocy est à écrivain unique, sans prise en charge du clustering — exécuter plusieurs réplicas sur le même volume n'est pas sûr.
- **Aucun identifiant administrateur injectable.** L'image amont est livrée avec les identifiants par défaut `admin` / `admin`, modifiés via l'interface web à la première connexion. Aucun secret Secret Manager n'est créé pour Grocy.
- **Les sondes de santé ciblent `/`, pas `/health`.** Grocy n'a pas de point de terminaison de santé dédié ; la page de connexion (`200`, sans authentification) sert à la fois pour la sonde de démarrage et pour la sonde de vivacité (liveness).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#6-outputs) du déploiement.

### A. Cloud Run — le service Grocy {#a-cloud-run--the-grocy-service}

Grocy s'exécute sous forme d'un service Cloud Run v2 à instance unique. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Filestore (NFS) — le volume `/config` {#b-cloud-filestore-nfs--the-config-volume}

Tout l'état de Grocy — la base de données SQLite embarquée (`grocy.db`), `config.php`, les images et pièces jointes téléversées et les sauvegardes — se trouve sous `/config`, monté sur une instance Cloud Filestore (NFS) plutôt que via GCS FUSE. C'est la décision de stockage déterminante de ce module (voir §4) ; perdre ou mal configurer ce montage fait perdre toutes les données de Grocy.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT" --zone "$REGION-a"
  gcloud filestore instances describe <instance-name> --project "$PROJECT" --zone "$REGION-a"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la découverte automatique et le provisionnement NFS.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `storage` dédié est provisionné automatiquement, mais par défaut il n'est **pas** utilisé pour adosser `/config` — ce montage passe par NFS à la place (voir §4). Il reste disponible pour tout `gcs_volumes` personnalisé qu'un opérateur ajoute.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run à Cloud Monitoring, avec en option des tests de disponibilité et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Grocy {#3-grocy-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Grocy n'a ni base de données externe ni tâche `db-init` — il crée et migre son propre schéma SQLite embarqué sous `/config` au premier démarrage.
- **La durabilité de `/config` dépend du montage NFS, pas d'une base de données gérée.** Comme tout l'état de Grocy (base de données, configuration, téléversements, sauvegardes) réside dans des fichiers sur `/config`, la fiabilité du montage NFS *est* la fiabilité du déploiement. Vérifiez que le montage est sain avant de vous fier aux données qui y sont écrites.
- **Aucun identifiant administrateur n'est généré ni injectable.** L'image amont est livrée avec les identifiants par défaut `admin` / `admin`. Connectez-vous avec ceux-ci au premier accès et changez immédiatement le mot de passe via Users → admin → Edit dans l'interface de Grocy — aucune variable d'environnement ni valeur Secret Manager ne le définit à votre place.
- **Chemin de santé.** Les sondes de démarrage et de disponibilité envoient toutes deux une requête HTTP `GET /`, qui renvoie la page de connexion de Grocy (`200`) sans authentification. Ce n'est pas un point de terminaison de santé dédié — Grocy n'en a pas — mais cela indique de façon fiable que la pile nginx + php-fpm répond.
- **La contrainte d'écrivain unique est architecturale, pas un réglage de mise à l'échelle.** Comme la base de données SQLite de Grocy n'a pas d'équivalent MySQL/Postgres ni de prise en charge du clustering, `max_instance_count` doit rester à `1`. Aucune configuration ne permet d'activer sans risque la mise à l'échelle horizontale pour ce module.
- **Vérifié en conditions réelles.** `https://grocycr31ffe08b-kj6qcu2rxa-uc.a.run.app` — 16 échantillons curl sur environ 5 minutes contre une seule révision stable (`grocycr31ffe08b-00003-h4w`), servant systématiquement `<title>Login | Grocy</title>`, sans aucune entrée de journal présentant une signature de corruption (`OutOfOrderError` / `429` / `stale file` / `database is locked` / `disk I/O error` tous absents) après le correctif NFS décrit au §4.

---

## 4. Pourquoi `/config` utilise NFS plutôt que GCS FUSE — l'histoire réelle {#4-why-config-uses-nfs-instead-of-gcs-fuse--the-real-story}

Le câblage du stockage persistant de ce module n'est pas la valeur par défaut habituelle de ce catalogue, et la raison mérite d'être comprise avant de le modifier.

Grocy écrit dans `data/grocy.db-journal` à chaque transaction de base de données — confirmé en conditions réelles, environ toutes les 1 à 2 secondes en usage léger. La couche de traduction vers le stockage d'objets de GCS FUSE repose sur une cohérence à terme et une sémantique d'objet entier ; elle ne soutient pas ce type d'écritures petites et très fréquentes. `Grocy_CloudRun` montait à l'origine `/config` sur un bucket adossé à GCS FUSE — le modèle habituel de ce catalogue pour la configuration persistante des applications — et il a tourné en boucle de plantages en production. Confirmé en conditions réelles sur 12 cycles de démarrage complets en plus de 20 minutes, sans que les vrais contrôles HTTP ne renvoient une seule fois une page fonctionnelle :

- `BufferedWriteHandler.OutOfOrderError` répétés
- Réponses HTTP `429` de limitation de débit de la part de GCS
- Erreurs de descripteur de fichier obsolète
- Une boucle permanente de plantage et redémarrage

Le correctif : faire passer `/config` de GCS FUSE à la prise en charge native des volumes **NFS** du socle — `enable_nfs = true`, `nfs_mount_path = "/config"` — avec `enable_gcs_storage_volume` de `Grocy_Common` défini à `false` pour éviter un double montage au même chemin. NFS implémente une vraie sémantique de fichiers POSIX (rename/fsync/verrous consultatifs) que la couche de traduction de GCS FUSE n'offre pas, et il soutient sans difficulté le schéma d'écriture de Grocy.

**Pourquoi il s'agit d'un bug réellement différent de l'autre incident SQLite-sur-stockage-partagé du catalogue (UptimeKuma) :** le problème d'UptimeKuma était une incompatibilité des **verrous en mode WAL** avec NFS. Grocy n'active jamais le mode WAL — il n'existe aucun PRAGMA `journal_mode` dans son code source (vérifié par rapport à `DatabaseService.php` en amont) ; il utilise le mode de journal par défaut de SQLite, DELETE/rollback-journal. L'échec de Grocy sur GCS FUSE n'avait donc rien à voir avec le verrouillage — c'était purement un problème de *fréquence* d'écriture que la sémantique de stockage d'objets de GCS FUSE ne peut pas absorber. Lus ensemble, ces cas élargissent la leçon générale : **gcsfuse peut casser une base de données SQLite embarquée pour plus d'une raison** — non seulement le verrouillage en mode WAL, mais aussi les schémas d'écriture très fréquents en général, indépendamment du mode de journal.

Un second bug, sans rapport, a été corrigé au passage lors du build de ce module : une surcharge parasite `container_image_source = "prebuilt"` dans `deploy.tfvars` contournait silencieusement l'intégralité du build du Dockerfile personnalisé — la même classe de piège déjà documentée dans ce catalogue pour UptimeKuma.

**La variante GKE adopte une approche différente du même problème de fond.** `Grocy_GKE` est échafaudé mais n'a **pas encore été déployé ni vérifié**. Son correctif prévu est un **PVC en mode bloc** de StatefulSet sur `/config` — un véritable stockage en mode bloc, et non un système de fichiers réseau — conformément au modèle général de ce catalogue pour les variantes GKE d'applications fortement dépendantes de SQLite (p. ex. CalibreWeb_GKE). Ce guide sera mis à jour une fois cette variante déployée et vérifiée.

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Grocy ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `grocy` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Grocy` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image LinuxServer. `"latest"` se résout en `v4.6.0-ls333` épinglé (l'ARG de build `GROCY_VERSION`, et non l'`APP_VERSION` générique). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Grocy est léger ; la mémoire par défaut laisse de la marge pour les téléversements d'images et de pièces jointes. |
| `min_instance_count` | `1` | Maintient l'instance active — évite les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`.** La base de données SQLite de Grocy est à écrivain unique, sans prise en charge du clustering. |
| `container_port` | `80` | Port HTTP par défaut de Grocy. |
| `container_protocol` | `http1` | Grocy sert du HTTP/1.1 simple ; `h2c` n'est pas nécessaire. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_cloudsql_volume` | `false` | Grocy n'a pas de Cloud SQL — conservez `false`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionnée avec les valeurs par défaut de `Grocy_Common` : `PUID=1000`, `PGID=1000`, `TZ=Etc/UTC`. |
| `secret_environment_variables` | `{}` | Aucun secret par défaut n'existe pour Grocy — cette map est entièrement fournie par l'opérateur. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Vaut `true` par défaut pour ce module** — requis pour que `/config` puisse soutenir le schéma d'écriture SQLite de Grocy (voir §4). Ne le désactivez pas, sauf pour le remplacer par un montage tout aussi durable et conforme à POSIX. |
| `nfs_mount_path` | `/config` | Grocy conserve tout son état (base de données, configuration, téléversements, sauvegardes) ici. Ne le modifiez pas, sauf si le chemin de données de l'image amont change. |
| `create_cloud_storage` | `true` | Le bucket `storage` est tout de même créé (inutilisé pour `/config` par défaut ; disponible pour des `gcs_volumes` personnalisés). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Grocy n'a aucune base de données SQL. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation par défaut — Grocy initialise son propre schéma SQLite au premier démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` , délai de 15 s, 10 tentatives | Page de connexion de Grocy — il n'existe pas de point de terminaison de santé dédié. |
| `liveness_probe` | HTTP `/` , délai de 30 s, 3 tentatives | Même point de terminaison que la sonde de démarrage. |

Toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

---

## 6. Sorties {#6-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `grocy_url` | URL de l'interface de Grocy (port 80). Joignable uniquement depuis le VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage`, inutilisé pour `/config` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. La plupart des entrées hors limites ou contradictoires sont détectées avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Le désactiver sans montage POSIX tout aussi durable ramène `/config` sur GCS FUSE (ou sur un chemin éphémère dans le conteneur), ce qui reproduit la boucle de plantage et redémarrage confirmée (`BufferedWriteHandler.OutOfOrderError`, des `429`, erreurs de descripteur de fichier obsolète) — ou fait perdre silencieusement tout l'état à chaque redémarrage. |
| `nfs_mount_path` | `/config` | Critique | Grocy code en dur son chemin de données sur `/config`. Modifier le chemin de montage sans modification correspondante de l'image fait perdre l'accès à la base de données, à la configuration et aux téléversements. |
| `max_instance_count` | `1` | Critique | La base de données SQLite de Grocy est à écrivain unique, sans prise en charge du clustering. Toute valeur supérieure à `1` expose à une corruption de la base par des écrivains concurrents. |
| `container_image_source` | `custom` (la valeur par défaut du module) | Élevé | Une surcharge parasite `"prebuilt"` contourne silencieusement le build du Dockerfile personnalisé (déjà rencontré une fois lors du build de ce module, et documenté pour UptimeKuma) — Cloud Run pointe alors vers un chemin Artifact Registry jamais construit. |
| `database_type` | `NONE` | Moyen | Grocy l'ignore totalement (aucun chemin de code ne le lit), mais toute autre valeur provisionne une instance Cloud SQL inutilisée et facturée. |
| Mot de passe administrateur | À changer à la première connexion | Élevé | Les identifiants par défaut `admin` / `admin` de l'image amont sont documentés publiquement ; les laisser inchangés sur un déploiement public `ingress_settings = "all"` constitue une réelle exposition. |
| `min_instance_count` | `1` | Faible | Le définir à `0` réduit les coûts mais réintroduit des démarrages à froid sur la pile nginx + php-fpm de Grocy. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Grocy est décrite dans **[Grocy_Common](Grocy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Grocy sur Cloud Run](../labs/Grocy_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Grocy sur GKE Autopilot](Grocy_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Grocy Common — Configuration applicative partagée](Grocy_Common.md) — la configuration partagée par les deux cibles de déploiement.
