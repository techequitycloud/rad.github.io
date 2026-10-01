---
title: "Focalboard sur GKE Autopilot"
description: "Référence de configuration pour déployer Focalboard sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Focalboard_GKE.md @ 3055034 sha256:9f8868e4a161 -->

# Focalboard sur GKE Autopilot {#focalboard-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Focalboard_GKE.png" alt="Focalboard sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Focalboard est un outil open source et auto-hébergé de gestion de projets et de
tableaux Kanban, édité par Mattermost — une alternative à Trello, Asana ou aux tableaux
de Notion, avec plusieurs vues de tableau (kanban, table, galerie, calendrier) pour
organiser les tâches au moyen de tableaux et de cartes. Ce module déploie Focalboard sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Focalboard et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Focalboard s'exécute comme une unique charge de travail web Go/React. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | **StatefulSet** par défaut (voir ci-dessous), serveur Focalboard sur le port `8000`, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — moteur limité à PostgreSQL 13/14/15 (ou `NONE`) ; MySQL est rejeté au moment du plan |
| Stockage en mode bloc | Persistent Disk (PVC par pod) | PVC `10Gi` `standard-rwo` (SSD) monté sur `/data`, qui sert de stockage des pièces jointes de Focalboard (`FOCALBOARD_FILESPATH`) |
| Persistance des fichiers | Cloud Filestore (NFS) | Provisionné par défaut (`enable_nfs = true`) sur `/opt/focalboard/storage`, mais ce n'est pas le chemin où Focalboard écrit réellement les pièces jointes — voir les pièges |
| Stockage d'objets | Cloud Storage | Un bucket suffixé `storage` est toujours provisionné ; il n'est monté via gcsfuse sur le répertoire de données que lorsque le PVC en mode bloc est désactivé |
| Secrets | Secret Manager | `FOCALBOARD_ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; routage par domaine personnalisé activé par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL uniquement.** `database_type` vaut `POSTGRES_15` par défaut ; une
  précondition au moment du plan dans `validation.tf` rejette toute valeur autre que
  `POSTGRES_13`, `POSTGRES_14`, `POSTGRES_15` ou `NONE` — MySQL n'est pas pris en charge.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface de bouclage.** Sur
  GKE, `DB_HOST` se résout en `127.0.0.1` (le sidecar cloud-sql-proxy), et le point
  d'entrée construit dans ce cas un DSN libpq en clair (`sslmode=disable`).
- **La charge de travail est par défaut un StatefulSet, et non un Deployment.**
  `stateful_pvc_enabled
  = true` par défaut, ce qui résout automatiquement `workload_type` en `StatefulSet`
  (selon la convention de l'ensemble du dépôt — voir [App_GKE](App_GKE.md), groupe 7).
  Chaque réplica de pod reçoit son **propre** PVC **isolé** `10Gi` `standard-rwo` monté
  sur `/data` — les pièces jointes ne sont **pas** partagées entre les réplicas.
- **`min_instance_count = 1`, `max_instance_count = 5` par défaut** — mais comme le
  stockage est un PVC par pod (et non un système de fichiers partagé), passer à plus
  d'un réplica répartit les pièces jointes téléversées entre des volumes isolés ;
  consultez le tableau des pièges avant d'augmenter `max_instance_count`.
- **NFS est provisionné par défaut mais n'est pas utilisé par le chemin de stockage
  propre à Focalboard.** `enable_nfs = true` monte Filestore sur `nfs_mount_path`
  (`/opt/focalboard/storage`), un chemin différent du `FOCALBOARD_FILESPATH` (`/data`)
  adossé au PVC en mode bloc que le point d'entrée configure réellement.
- **L'affinité de session est `ClientIP`**, afin que les requêtes d'un client
  atteignent le même pod.
- **Aucun job de migration distinct.** Focalboard exécute ses propres migrations de
  schéma au démarrage en tant qu'utilisateur de base de données applicatif (voir
  `Focalboard_Common/main.tf`) ; le job `db-init` se contente de créer la base de
  données et le rôle, et d'accorder les droits.
- **`FOCALBOARD_ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret
  Manager, puis injecté comme variable d'environnement secrète du conteneur — voir la
  réserve formulée à la [section 3](#3-focalboard-application-behaviour) quant à son
  utilisation effective par le serveur Focalboard lui-même.
- **L'URL du service est renseignée automatiquement.** Le `serverRoot` du point
  d'entrée se rabat successivement sur `FOCALBOARD_SERVER_ROOT` → `CLOUDRUN_SERVICE_URL` →
  `GKE_SERVICE_URL` → `http://localhost:8000` ; App_GKE injecte `GKE_SERVICE_URL`
  pour chaque charge de travail GKE, si bien qu'aucune étape manuelle de définition de
  l'URL n'est requise après le déploiement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Focalboard {#a-gke-autopilot--the-focalboard-workload}

Par défaut, Focalboard s'exécute comme un **StatefulSet** (car `stateful_pvc_enabled =
true` est la valeur par défaut du module), ce qui donne à l'unique pod une identité
stable et son propre PVC. Si vous désactivez le PVC en mode bloc, la charge de travail
se résout en `Deployment`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Focalboard pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" -l app=focalboard --tail=100
  ```

Consultez [App_GKE](App_GKE.md), groupe 6 (Backend Config) et groupe 7
(StatefulSet/PVC), pour savoir comment sont résolus le type de charge de travail et la
mise à l'échelle Autopilot.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Focalboard stocke toutes les données de l'application (tableaux, cartes, blocs,
utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent
via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est
exposée. Lors du premier déploiement, le job `db-init` (`postgres:15-alpine`) crée de
manière idempotente la base de données, le rôle et les droits de l'application — le
binaire de Focalboard exécute ensuite lui-même les migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et la
rotation des mots de passe.

### C. Stockage en mode bloc (PVC) et Cloud Storage {#c-block-storage-pvc--cloud-storage}

Les pièces jointes téléversées dans les tableaux sont conservées sous
`FOCALBOARD_FILESPATH` (par défaut `/data`), sur un PVC `10Gi` `standard-rwo`
(Persistent Disk équilibré de classe SSD) créé pour chaque pod par le StatefulSet. Un
bucket Cloud Storage distinct est toujours provisionné, mais il n'est monté via gcsfuse
sur le répertoire de données que lorsque le PVC en mode bloc est désactivé (pour éviter
un double montage, car gcsfuse peut corrompre les fichiers d'index et de médias de
Focalboard).

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims ; Cloud Storage →
  Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud storage buckets list --project "$PROJECT" --filter="name~focalboard"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md), groupe 7 (StatefulSet/PVC), groupe 13 (NFS) et
groupe 14 (Cloud Storage/GCS Fuse), pour les mécanismes généraux et les options CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret propre à Focalboard est généré automatiquement et stocké dans Secret
Manager : `FOCALBOARD_ADMIN_PASSWORD` (un mot de passe aléatoire de 24 caractères). Le
mot de passe de la base de données est géré séparément par le socle. Sur GKE, les
secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~focalboard"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements), avec un Ingress Kubernetes activé pour le routage par domaine
personnalisé (`enable_custom_domain = true`).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles (`uptime_check_config.enabled` vaut
`false` par défaut).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Focalboard {#3-focalboard-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Il attend que Cloud SQL accepte les
  connexions, crée de manière idempotente le rôle applicatif (privilège `CREATEDB`) et
  la base de données, accorde tous les privilèges sur la base de données,
  accorde/transfère le schéma `public` à l'utilisateur applicatif (le transfert de
  propriété du schéma n'est pas bloquant en cas d'échec), puis signale au sidecar Cloud
  SQL Auth Proxy de s'arrêter (`quitquitquit`) afin que le pod du Job se termine. Le
  job peut être relancé sans risque (`execute_on_apply = true`).
- **Aucun job de migration distinct — Focalboard se migre lui-même au démarrage.**
  Le commentaire du module `Focalboard_Common` l'indique explicitement : « Focalboard
  runs its own schema migrations on boot; no Postgres extensions are required. »
  L'utilisateur applicatif doit être pleinement propriétaire du schéma `public` pour
  que cela fonctionne, ce que `db-init.sh` lui accorde.
- **Compte administrateur — TODO : non entièrement confirmé à partir du code source.**
  Un secret `FOCALBOARD_ADMIN_
  PASSWORD` est généré et injecté comme variable d'environnement secrète du conteneur,
  mais le script `entrypoint.sh` n'y fait **pas** référence lorsqu'il écrit
  `config.json` (`authMode` est défini sur `"native"`). Il n'a pas pu être confirmé à
  partir du code source de ce module si le binaire Focalboard amont utilise lui-même
  `FOCALBOARD_ADMIN_PASSWORD` pour amorcer un compte administrateur, ou si (comme
  c'est souvent le cas avec l'authentification native de Focalboard) le premier
  utilisateur qui s'inscrit via l'interface devient simplement l'administrateur de
  l'espace de travail. Récupérez le secret et essayez-le lors de la première connexion ;
  s'il ne s'applique pas, enregistrez le premier compte via l'interface.
- **Raccordement des variables d'environnement de la base de données.** `entrypoint.sh`
  construit un unique DSN libpq à mots-clés (`dbconfig` dans `config.json`) à partir
  des variables `DB_HOST`/`DB_IP`/
  `DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` injectées par le socle, en choisissant
  selon l'hôte *résolu* : un répertoire de socket Unix Cloud Run privilégie `DB_IP`
  avec `sslmode=require` ; un hôte de bouclage (le sidecar proxy de GKE, `127.0.0.1`)
  utilise `sslmode=disable` ; toute autre IP réelle utilise `sslmode=require`. Sur GKE,
  cela se résout toujours dans le cas du bouclage, en clair jusqu'au sidecar.
- **Le `DB_PASSWORD` que porte ce DSN est un secret dédié, uniquement alphanumérique,
  et non `database_password_secret`.** Le mot de passe de base de données standard du
  socle, commun à toute la flotte (jeu de caractères `_%@`), peut contenir un `%` qui
  fait planter le pilote postgres Go de Focalboard — sa validation de DSN basée sur
  `url.Parse` et son connecteur `lib/pq` effectif ne décodent pas les pourcentages de la
  même façon, si bien qu'aucun encodage unique de ce mot de passe ne satisfait les deux.
  `Focalboard_Common` génère un mot de passe distinct
  (`secret-<resource_prefix>-focalboard-safe-db-password`), remplace par celui-ci le
  `DB_PASSWORD` du SERVICE et le transmet à `db-init` sous
  `FOCALBOARD_SAFE_DB_PASSWORD`, qui est la valeur réellement attribuée comme mot de
  passe du rôle Postgres. Ce comportement est identique à celui de Cloud Run, puisque
  `db-init.sh` est partagé via `Focalboard_Common`. La sortie `database_password_secret`
  (§5) indique le nom du secret commun à la flotte, qui ne permet pas de s'authentifier
  auprès de ce rôle.
- **Chemin de stockage des pièces jointes.** `FOCALBOARD_FILESPATH` est défini sur
  `data_dir`, que la variante GKE raccorde à `stateful_pvc_mount_path` (par défaut
  `/data`) — le même chemin que celui sur lequel est monté le PVC en mode bloc de chaque
  pod. Le Dockerfile crée à l'avance `/data` avec `chmod 0777` afin qu'un montage de PVC
  neuf soit accessible en écriture au démarrage, même si le pod s'exécute avec un UID
  non root.
- **Sondes de santé.** Sonde de démarrage : **HTTP** `GET /`,
  `initial_delay_seconds=60`, `timeout_seconds=10`, `period_seconds=15`,
  `failure_threshold=30` (jusqu'à ~8,5 minutes de marge au démarrage). Sonde de
  vivacité : **HTTP** `GET /`, `initial_delay_seconds=60`, `timeout_seconds=5`,
  `period_seconds=30`, `failure_threshold=3`. Une sonde de disponibilité (readiness) (**HTTP**
  `GET /`, `initial_delay=30s`, `period=10s`, `failure_threshold=3`) est également codée
  en dur dans `Focalboard_Common` et n'est pas exposée en tant que variable.
- **L'URL du service se résout automatiquement.** Le `serverRoot` de `config.json` se
  rabat sur `GKE_SERVICE_URL`, qu'App_GKE injecte pour chaque charge de travail GKE —
  contrairement à certains autres modules, aucun correctif manuel de
  `environment_variables` n'est requis après le déploiement, sauf si vous souhaitez
  plutôt une URL de domaine personnalisé spécifique.
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- cat /opt/focalboard/config.json
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Focalboard ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `focalboard` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `7.11.4` | Tag de l'image `mattermost/focalboard` utilisée comme base de la build personnalisée. Incrémentez-le pour déclencher une nouvelle build ; `latest` est figé sur `7.11.4` au moment du build (ce n'est pas un tag amont publié). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `8000` | Port d'écoute natif de Focalboard. |
| `container_resources` | `2000m` CPU / `4Gi` mémoire | Limites par défaut ; aucune demande explicite n'est définie. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (bouclage `127.0.0.1:5432`) — obligatoire sur GKE. |
| `container_image_source` | `custom` | Construite `FROM mattermost/focalboard` comme encapsulation légère qui ajoute le point d'entrée cloud. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface Focalboard. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet`, car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Donne à chaque pod son propre PVC en mode bloc pour `/data` (pièces jointes), ce qui évite la corruption des fichiers d'index et de médias par gcsfuse. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Doit correspondre au `filespath` de Focalboard ; également transmis comme `data_dir` à `Focalboard_Common`, qui définit `FOCALBOARD_FILESPATH`. |
| `stateful_pvc_storage_class` | `standard-rwo` | PD équilibré adossé à du SSD ; consomme le quota `SSD_TOTAL_GB`, plus restreint (voir [App_GKE](App_GKE.md) / les conventions du dépôt sur le passage à un HDD). |

### Groupe 10 — Observabilité {#group-10--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60 s, 30 tentatives toutes les 15 s | Régit la sonde de démarrage effective du conteneur (raccordée via `Focalboard_Common`, et non via le `startup_probe_config` générique). |
| `liveness_probe` | HTTP `/`, délai de 60 s, 3 tentatives toutes les 30 s | Régit la sonde de vivacité effective du conteneur. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore, mais le chemin des pièces jointes propre à Focalboard (`FOCALBOARD_FILESPATH`) est le PVC en mode bloc sur `stateful_pvc_mount_path`, et non le montage NFS — voir la [section 1](#1-overview). |
| `nfs_mount_path` | `/opt/focalboard/storage` | Emplacement de montage du volume NFS (actuellement inutilisé par Focalboard). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Limité à PostgreSQL 13/14/15 (ou `NONE`) par une précondition au moment du plan — MySQL est rejeté. |
| `application_database_name` | `focalboard` | Nom de la base de données. Immuable dans les faits après le premier déploiement (le renommer rend orphelines les données existantes). |
| `application_database_user` | `focalboard` | Utilisateur de base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | L'Ingress pour le routage par domaine personnalisé est activé par défaut (contrairement à de nombreux autres modules, où il est désactivé par défaut). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Focalboard. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de base de données standard commun à toute la flotte — **pas** l'identifiant avec lequel s'authentifie le rôle Postgres de Focalboard (voir la [section 3](#3-focalboard-application-behaviour)) ; utilisez plutôt `secret-<resource_prefix>-focalboard-safe-db-password`. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé en même temps qu'un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Une précondition de `validation.tf` rejette MySQL et les autres moteurs non Postgres au moment du plan. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables dans les faits après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelins tous les tableaux et toutes les cartes. |
| `max_instance_count` | `1`, sauf si vous revoyez l'architecture du stockage | Critique | Avec la valeur par défaut `stateful_pvc_enabled = true`, chaque réplica reçoit son **propre** PVC **isolé** — les pièces jointes téléversées sur un pod sont invisibles depuis un autre. Passer à plus de 1 répartit silencieusement les données, sans aucune erreur. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est indispensable à la connectivité de la base de données sur GKE. |
| `stateful_pvc_enabled` | `true` | Élevé | Le désactiver (et s'appuyer sur gcsfuse à la place) expose à la corruption des fichiers d'index et de médias de Focalboard en cas d'écritures concurrentes — c'est précisément pour cette raison que le module Common ignore le montage gcsfuse lorsque le PVC en mode bloc est activé. |
| `stateful_pvc_mount_path` | `/data` (doit être égal au `filespath` de Focalboard) | Élevé | Le modifier sans mettre à jour également le raccordement de `FOCALBOARD_FILESPATH` monte le PVC à un emplacement où Focalboard n'écrit jamais, ce qui le rend éphémère dans les faits. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les requêtes passent d'un pod à l'autre, ce qui importe davantage dès qu'il existe plusieurs réplicas. |
| `enable_nfs` | `true` (mais envisagez `false`) | Moyen | Provisionne une instance Filestore que le chemin des pièces jointes propre à Focalboard n'utilise pas — un coût évitable, sauf si un autre élément de votre déploiement en a besoin. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Moyen | Consomme le quota restreint `SSD_TOTAL_GB` (Qwiklabs ≈ 500 GB) ; une série de modules avec état peut l'épuiser. Remplacez-la par `standard` (HDD `pd-standard`) si les IOPS ne sont pas nécessaires. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `FOCALBOARD_ADMIN_PASSWORD` (généré automatiquement) | À récupérer avant la première connexion | Moyen | Il n'est pas confirmé qu'il permette à lui seul d'amorcer une connexion (voir la [section 3](#3-focalboard-application-behaviour)) — en pratique, la première étape peut plutôt consister à enregistrer le premier utilisateur via l'interface. |
| Sortie `database_password_secret` | Ne pas l'utiliser pour se connecter | Élevé | Indique le secret `DB_PASSWORD` commun à la flotte, qui ne permet pas de s'authentifier auprès du rôle Postgres de Focalboard. Récupérez `secret-<resource_prefix>-focalboard-safe-db-password` pour obtenir un identifiant fonctionnel. |
| `reserve_static_ip` | `true` | Moyen | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toute URL enregistrée en favori. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les obligations de conservation liées à la conformité. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Focalboard partagée
avec la variante Cloud Run est décrite dans **[Focalboard_Common](Focalboard_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Focalboard sur GKE Autopilot](../labs/Focalboard_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Focalboard sur Google Cloud Run](Focalboard_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Focalboard Common — Configuration applicative partagée](Focalboard_Common.md) — la configuration partagée par les deux cibles de déploiement.
