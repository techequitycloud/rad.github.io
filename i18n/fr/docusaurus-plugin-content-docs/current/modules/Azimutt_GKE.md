---
title: "Azimutt sur GKE Autopilot"
description: "Référence de configuration pour déployer Azimutt sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Azimutt_GKE.md @ 3055034 sha256:3531eba4ab5a -->

# Azimutt sur GKE Autopilot {#azimutt-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Azimutt_GKE.png" alt="Azimutt sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Azimutt est un explorateur de schémas de bases de données de nouvelle génération et un outil d'ERD (diagramme
entité-relation) open source pour les bases de données réelles, construit avec Elixir/Phoenix. Il
permet aux équipes d'explorer, de documenter et de concevoir de grands schémas (des milliers de tables), de rechercher
parmi les colonnes et les relations, et de partager des diagrammes. Ce module déploie Azimutt sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Azimutt et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Azimutt s'exécute comme une unique charge de travail web Elixir/Phoenix à l'écoute sur le port **4000**. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Phoenix, autoscaling horizontal ; facturation du CPU et de la mémoire demandés |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Azimutt ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage de fichiers | Cloud Filestore (NFS) | `enable_nfs = true` par défaut, mais Azimutt écrit toujours les téléversements dans son propre répertoire de travail éphémère plutôt que sur ce montage (voir ci-dessous) |
| Stockage d'objets | Cloud Storage | Un bucket est provisionné (disponible pour un adaptateur de fichiers compatible S3) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` de Phoenix généré automatiquement ; mot de passe de la base de données |
| Build d'image | Cloud Build + Artifact Registry | Enveloppe légère FROM `ghcr.io/azimuttapp/azimutt`, mise en miroir dans Artifact Registry |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; choisir tout autre moteur empêche le démarrage. Toutes les données de projet
  d'Azimutt résident dans Postgres.
- **Azimutt se connecte à Postgres via l'interface loopback de l'Auth Proxy (sans SSL).** Ecto ne sait pas
  analyser le DSN de socket Cloud SQL ; sur GKE, le point d'entrée construit donc `DATABASE_URL`
  sur `127.0.0.1` (le sidecar Cloud SQL Auth Proxy, qui termine le TLS) avec
  `DATABASE_ENABLE_SSL=false`. `enable_cloudsql_volume = true` est obligatoire.
- **`container_port` et les sondes doivent valoir 4000.** Sur GKE, la plateforme n'injecte **pas**
  automatiquement `PORT` ; le point d'entrée définit donc `PORT=4000` par défaut ; le port du Service et les
  sondes doivent correspondre, sinon le pod ne devient jamais Ready alors même que l'application est saine.
- **NFS est activé par défaut** (`enable_nfs = true`), mais il n'est pas actuellement relié
  au chemin de stockage d'Azimutt — `FILE_STORAGE_ADAPTER` reste à `local` ; les téléversements arrivent donc toujours
  sur le disque éphémère du pod plutôt que sur le montage NFS. Les données de projet elles-mêmes
  (schémas, diagrammes, dispositions, utilisateurs) résident dans Postgres et ne sont pas affectées.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager.
  Le renouveler après le premier démarrage déconnecte toutes les sessions actives ; ne le renouvelez que pendant une
  fenêtre de maintenance.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`) — GKE ne prend pas
  en charge la mise à l'échelle jusqu'à zéro, ce qui garde Azimutt toujours joignable.
- **Les migrations s'exécutent automatiquement à chaque démarrage** (`/app/bin/migrate && /app/bin/server`) ;
  prévoyez du temps supplémentaire au premier démarrage.
- **`application_version = "latest"` correspond au tag `main` d'Azimutt.** Épinglez une version
  précise en production.
- **L'inscription est ouverte par défaut.** Restreignez l'accès après avoir créé votre premier compte.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Azimutt {#a-gke-autopilot--the-azimutt-workload}

Les pods Azimutt sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal
et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Azimutt pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep cloud-entrypoint  # resolved DB wiring
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Azimutt stocke toutes les données applicatives (schémas, diagrammes, dispositions, utilisateurs, sources) dans une
instance gérée Cloud SQL for PostgreSQL 15. Les pods l'atteignent via le **sidecar Cloud SQL
Auth Proxy** sur `127.0.0.1` (TLS terminé par le proxy, d'où
`DATABASE_ENABLE_SSL=false`). Lors du premier déploiement, une tâche (Job) d'initialisation crée la
base de données applicative et le rôle ; Azimutt exécute ensuite ses propres migrations Ecto au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes et la rotation des mots de passe, consultez
[App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) et Cloud Storage {#c-cloud-filestore-nfs--cloud-storage}

NFS est **activé par défaut** (`enable_nfs = true`) et monté sur `nfs_mount_path`,
mais il n'est pas actuellement relié au chemin de stockage d'Azimutt — avec la valeur par défaut
`FILE_STORAGE_ADAPTER = local`, Azimutt écrit toujours les téléversements dans son propre répertoire
de travail éphémère plutôt que sur ce montage. Un bucket **Cloud Storage** est également
provisionné (disponible si vous basculez Azimutt vers un adaptateur de fichiers compatible S3).
Les données de projet elles-mêmes (schémas, diagrammes, dispositions, utilisateurs) résident dans Postgres et ne sont
affectées dans aucun des deux cas.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Le **`SECRET_KEY_BASE`** de Phoenix est généré automatiquement et stocké dans Secret
Manager (il sert à signer et chiffrer les cookies de session). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Cloud Build et Artifact Registry {#e-cloud-build--artifact-registry}

L'image d'Azimutt est une enveloppe légère construite FROM `ghcr.io/azimuttapp/azimutt` ; Cloud Build
produit l'image enveloppée, qui est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`). Comme il s'agit d'une image reconstruite/mise en miroir, App_GKE définit
`imagePullPolicy = Always` afin que les nœuds ne servent jamais une couche en cache obsolète.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags
  ```

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.
`session_affinity = ClientIP` maintient un client sur un même pod.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Le stdout/stderr des pods arrive dans Cloud Logging ; les métriques de GKE et de Cloud SQL arrivent dans Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles. Les lignes
`cloud-entrypoint` indiquent le chemin `DATABASE_URL` résolu, `PHX_HOST` et `PORT`.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Azimutt {#3-azimutt-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec
  `postgres:15-alpine`. Il crée de manière idempotente le rôle applicatif
  (`LOGIN CREATEDB`) et la base de données, accorde `ALL` sur la base de données et le schéma `public`,
  et modifie (`ALTER`) le propriétaire du schéma — Azimutt a besoin de droits DDL complets car il
  exécute ses propres migrations. La tâche signale ensuite au sidecar Auth Proxy de s'arrêter
  (`/quitquitquit`) afin que le pod de la tâche se termine. Réexécutable sans risque.
- **Les migrations s'exécutent au démarrage.** La commande du conteneur est
  `/app/bin/migrate && /app/bin/server` ; Ecto applique donc les migrations en attente à chaque
  démarrage avant que le point de terminaison Phoenix ne se lie au port. Mettre à niveau `application_version` applique
  automatiquement les modifications de schéma.
- **Le câblage de la base de données à l'exécution est composé par le point d'entrée.** Sur GKE, `DATABASE_URL` est construite
  sur l'interface loopback de l'Auth Proxy (`127.0.0.1`) avec `DATABASE_ENABLE_SSL=false`, et
  `PORT` vaut 4000 par défaut (GKE ne l'injecte pas automatiquement). `PHX_HOST` est dérivé
  de l'URL du service injectée.
- **`SECRET_KEY_BASE` est stable et, en pratique, immuable.** Le renouveler invalide
  tous les cookies de session actifs — tous les utilisateurs sont déconnectés. Ne le renouvelez que pendant une fenêtre
  de maintenance.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine Phoenix `/` avec un
  délai initial de 60 secondes. Les sondes et `container_port` doivent tous deux valoir **4000**, sinon
  le pod ne devient jamais Ready.
- **Configuration initiale.** Atteignez le service via son IP LoadBalancer externe (ou votre domaine
  personnalisé) et créez le premier compte Azimutt via la page d'inscription. L'inscription est
  ouverte par défaut — restreignez l'accès ensuite.
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Azimutt ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `azimutt` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Azimutt` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Tag de l'image Azimutt ; `latest` correspond au tag `main`. Épinglez une version en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne prend pas en charge la mise à l'échelle jusqu'à zéro. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. |
| `container_port` | `4000` | Phoenix écoute sur 4000 ; les sondes et le port du Service doivent correspondre. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour la connexion à la base de données sur `127.0.0.1` ; obligatoire. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Deployment par défaut ; se résout automatiquement en StatefulSet si `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client reste sur un même pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez non défini — Azimutt s'appuie sur NFS et stocke les données de projet dans Postgres. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai 60s, fenêtre d'échec 30 × 15s | Sonde de démarrage ; prévoyez du temps pour les migrations du premier démarrage. Doit cibler le port 4000. |
| `liveness_probe` | HTTP `/`, délai 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, sondes d'infrastructure au niveau d'App_GKE | Sondes structurées. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring facultatif. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Cloud Filestore (activé par défaut), mais il n'est pas actuellement relié au chemin de stockage d'Azimutt — les téléversements vont toujours sur le disque éphémère du pod. |
| `nfs_mount_path` | `/opt/azimutt/storage` | Chemin de montage dans le conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut — Azimutt utilise PostgreSQL (Oban) pour les tâches d'arrière-plan, et non Redis. |
| `redis_host` | `""` | Point de terminaison Redis (uniquement si une fonctionnalité en aval l'exige). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `azimutt` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `azimutt` | Utilisateur applicatif de la base de données. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupes 19–22 — Domaine personnalisé, IAP, Cloud Armor, VPC-SC {#groups-1922--custom-domain-iap-cloud-armor-vpc-sc}

Comportement standard d'App_GKE — `enable_custom_domain`, `reserve_static_ip`,
`enable_iap`, `enable_cloud_armor`, `enable_vpc_sc`, `enable_audit_logging`. Consultez
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Azimutt. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage, un `quota_memory_*` exprimé en entier nu. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais le renouveler hors d'une fenêtre de maintenance | Critical | Le renouveler invalide tous les cookies de session actifs — tous les utilisateurs sont déconnectés. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et rend orphelines toutes les données d'Azimutt. |
| `container_port` | `4000` | Critical | Le point d'entrée définit `PORT=4000` par défaut sur GKE ; un port de Service ou de sonde non concordant frappe un port mort et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | Critical | Le sidecar Auth Proxy fournit la connexion à la base de données sur `127.0.0.1` ; le désactiver laisse Azimutt sans base de données et bloque l'amorçage `db-init`. |
| `enable_nfs` | `true` | Low | Provisionne Filestore, mais n'a aucun effet sur Azimutt lui-même — `FILE_STORAGE_ADAPTER` n'est jamais dirigé vers le montage NFS ; les téléversements arrivent donc toujours sur le disque éphémère du pod quel que soit ce paramètre (les données de projet elles-mêmes sont en sécurité dans Postgres). |
| `min_instance_count` | `1` | High | GKE exige min ≥ 1 ; la validation rejette les valeurs invalides. |
| `application_version` | Épingler une version | High | `latest` correspond au tag mobile `main` ; un changement inattendu en amont peut casser un redéploiement. |
| `session_affinity` | `ClientIP` | Medium | Sans persistance, les sessions de l'interface rebondissent d'un pod à l'autre. |
| `enable_iap` / domaine personnalisé | Restreindre après le premier compte | High | L'inscription est ouverte par défaut ; laisser le LoadBalancer accessible publiquement permet à n'importe qui de créer un compte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_redis` | `false` | Low | Azimutt utilise Postgres/Oban, pas Redis — l'activer n'a aucun effet sur Azimutt lui-même. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Azimutt partagée avec la variante Cloud Run est décrite dans
**[Azimutt_Common](Azimutt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Azimutt sur GKE Autopilot](../labs/Azimutt_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Azimutt sur Google Cloud Run](Azimutt_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Azimutt Common — Configuration applicative partagée](Azimutt_Common.md) — la configuration partagée par les deux cibles de déploiement.
