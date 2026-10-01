---
title: "Miniflux sur GKE Autopilot"
description: "Référence de configuration pour déployer Miniflux sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Miniflux_GKE.md @ 3055034 sha256:8c4ef4304ab5 -->

# Miniflux sur GKE Autopilot {#miniflux-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Miniflux_GKE.png" alt="Miniflux sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Miniflux est un lecteur de flux RSS/Atom minimaliste et auto-hébergé — un unique
binaire Go statique qui stocke tout son état dans PostgreSQL. Ce module déploie
Miniflux sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Miniflux et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Miniflux s'exécute comme une charge de travail web Go à conteneur unique. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul binaire Go dans un Deployment, mis à l'échelle horizontalement entre `min`/`max` réplicas |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Miniflux stocke **tout** son état ici ; pas de MySQL ni d'autre moteur |
| Stockage objet | Cloud Storage (aucun) | Miniflux n'a besoin d'aucun bucket ; un montage NFS Filestore facultatif est disponible mais inutilisé par défaut |
| Cache et file d'attente | Aucun | Miniflux ne dépend pas de Redis et n'a pas de worker séparé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` généré automatiquement (propriétaire initial) ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec affinité de session `ClientIP`, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Le collecteur de flux s'exécute dans le processus.** Miniflux n'a pas de worker
  séparé — le même pod sert l'interface et actualise les flux selon
  `POLLING_FREQUENCY`. Gardez au moins un réplica actif pour que la collecte se
  poursuive (GKE ne descend pas à zéro).
- **Le propriétaire initial est pré-créé, pas auto-inscrit.** `CREATE_ADMIN = 1` crée
  le compte `admin` à partir du secret `ADMIN_PASSWORD` au premier démarrage ;
  l'inscription libre en libre-service reste désactivée. Récupérez le mot de passe
  dans Secret Manager pour vous connecter.
- **Les migrations de schéma s'exécutent au démarrage** (`RUN_MIGRATIONS = 1`) — il
  n'existe pas de job de migration séparé, de sorte que la mise à niveau de la version
  applique automatiquement les changements de schéma.
- **Pas de Redis.** `enable_redis = false` — Miniflux conserve chaque flux, entrée et
  session dans PostgreSQL. Laissez-le désactivé. Comme il n'y a pas de file d'attente
  partagée, exécuter plusieurs réplicas revient simplement à répartir la charge des
  requêtes (chacune continue de collecter les flux indépendamment).
- **L'affinité de session est `ClientIP`.** Elle maintient un client sur un même pod
  pour une session d'interface cohérente.
- **`DATABASE_URL` est composée à l'exécution** par le point d'entrée du conteneur
  (forme mot-clé/valeur de libpq), selon le loopback de l'Auth Proxy GKE
  (`127.0.0.1`, `sslmode=disable`), afin que la même image fonctionne sur Cloud Run et
  GKE.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Miniflux {#a-gke-autopilot--the-miniflux-workload}

Les pods Miniflux s'exécutent comme un Deployment sur Autopilot qui écoute sur le
port **8080**, facturé selon la CPU et la mémoire qu'ils demandent. L'autoscaling
horizontal des pods dimensionne le déploiement entre le nombre minimal et le nombre
maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Miniflux pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Miniflux stocke **toutes** les données applicatives (flux, entrées, utilisateurs,
sessions, catégories) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods
y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur le loopback
(`127.0.0.1`) ; aucune IP publique n'est exposée. Au premier déploiement, le Job
`db-init` crée la base de données et le rôle `miniflux` et installe l'extension
`hstore`, dont le rôle applicatif est propriétaire.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=miniflux --database=miniflux --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage et NFS {#c-cloud-storage--nfs}

Miniflux n'a besoin d'**aucun** stockage objet — il conserve tout son état dans
PostgreSQL, de sorte que la couche applicative ne provisionne aucun bucket de
données. La variante définit toutefois par défaut `enable_nfs = true` (un montage
Cloud Filestore sur `/opt/miniflux/storage`) pour les opérateurs qui souhaitent un
stockage partagé des pièces jointes, mais Miniflux n'en a pas besoin ; désactivez-le
pour réduire les coûts si vous n'en avez pas l'usage.

- **Console :** Filestore → Instances (si NFS est activé) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement : `ADMIN_PASSWORD` — le mot de passe du
propriétaire initial, injecté dans Miniflux au premier démarrage. Le mot de passe de
la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~miniflux"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
avec une affinité de session `ClientIP`. Un domaine personnalisé avec un certificat
géré par Google peut être activé, et une IP statique peut être réservée afin que
l'adresse survive aux redéploiements. Lorsqu'un domaine personnalisé est utilisé,
définissez `BASE_URL` pour que Miniflux produise des liens absolus corrects.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les IP
statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
et Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles. Le point d'entrée journalise au
démarrage son mode de connexion `DATABASE_URL` — utile pour diagnostiquer la
connectivité à la base de données.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Miniflux {#3-miniflux-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth
  Proxy et crée de manière idempotente la base de données et le rôle `miniflux`,
  accorde les privilèges, réattribue la propriété du schéma `public` et installe
  l'extension `hstore` **dont le rôle applicatif est propriétaire** (afin que la
  migration Miniflux `v119`, qui supprime `hstore`, réussisse). Le job envoie ensuite
  une requête à `/quitquitquit` sur le sidecar du proxy pour que le pod du Job se
  termine ; il peut être relancé sans risque.
- **Migrations de schéma au démarrage.** Le point d'entrée définit `RUN_MIGRATIONS=1`,
  de sorte que Miniflux applique ses propres migrations de schéma à chaque démarrage —
  pas d'étape de migration séparée. Prévoyez un délai supplémentaire au premier
  démarrage pour la construction initiale du schéma.
- **Le propriétaire initial est pré-créé.** `CREATE_ADMIN=1` crée le compte `admin`
  (`ADMIN_USERNAME`) à partir du secret `ADMIN_PASSWORD`. L'opération est idempotente
  — les démarrages suivants journalisent « user already exists ». Récupérez le mot de
  passe pour vous connecter :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<resource-prefix>-miniflux-admin-password --project "$PROJECT"
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité de ce module ciblent par
  défaut HTTP `/` (la page de connexion, un `200 OK` sans authentification). Miniflux
  renvoie également un `200 OK` sans authentification sur `/healthcheck` si vous
  préférez un chemin de sonde dédié. Ne dirigez pas les sondes vers des pages
  authentifiées.
- **Le collecteur de flux s'exécute dans le processus.** Les flux sont actualisés
  selon `POLLING_FREQUENCY` dans chaque pod. Gardez `min_instance_count >= 1` pour que
  la collecte s'exécute ; les réplicas supplémentaires collectent chacune
  indépendamment (aucune file d'attente partagée ne les coordonne).
- **`BASE_URL` détermine les liens absolus.** Sa valeur par défaut est l'URL du
  service interne injectée ; définissez-la explicitement (via `environment_variables`)
  sur l'URL du LoadBalancer externe ou du domaine personnalisé une fois l'adresse
  connue.
- **Inspecter le job db-init et les pods :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Miniflux ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

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
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `miniflux` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Miniflux ; épinglez une version (p. ex. `2.2.15`) en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; gardez 1 pour que le collecteur de flux reste actif. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. Miniflux n'a pas de file d'attente partagée — les pods supplémentaires ne font que répartir la charge des requêtes. |
| `container_port` | `8080` | Miniflux écoute sur 8080. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité (obligatoire sur GKE). |
| `enable_image_mirroring` | `true` | Met en miroir l'image Miniflux dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (p. ex. `BASE_URL`, `POLLING_FREQUENCY`). Ne définissez pas `DATABASE_URL` (composée à l'exécution). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation Secret Manager. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout automatiquement en Deployment sans état (Miniflux stocke tout son état dans PostgreSQL — aucun StatefulSet n'est nécessaire). |
| `session_affinity` | `ClientIP` | Maintient un client sur un même pod pour une session d'interface cohérente. |
| `container_protocol` | `http1` | HTTP/1.1 standard. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant SIGKILL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez désactivé — Miniflux conserve tout son état dans PostgreSQL, aucun PVC par pod n'est donc requis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 60s delay, 15s period, 30 failures | Sonde de démarrage. Fenêtre généreuse pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `/`, 60s delay, 30s period | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif ; activez-le pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (rôle/base de données/`hstore`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés facultatifs. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Miniflux requiert PostgreSQL. |
| `application_database_name` | `miniflux` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `miniflux` | Utilisateur applicatif de la base de données. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un montage NFS Filestore sur `/opt/miniflux/storage`. Facultatif — Miniflux stocke son état dans PostgreSQL ; désactivez-le pour réduire les coûts. |
| `nfs_mount_path` | `/opt/miniflux/storage` | Chemin de montage dans le conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; complétez la liste si vous en avez besoin de davantage. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définis)_ | Règle de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Miniflux n'utilise pas Redis — laissez-le désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Non utilisés par Miniflux. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

`backup_schedule`, `backup_retention_days`, `enable_backup_import`, `backup_source`,
`backup_uri`, `backup_format` — sauvegarde automatisée de Cloud SQL et restauration
au déploiement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré (une Gateway avec une IP statique est provisionnée automatiquement). |
| `application_domains` | `[]` | Noms d'hôte à servir (définissez `BASE_URL` en conséquence). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Miniflux (bloque les clients API Fever/Reader qui utilisent des jetons). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn` —
associent une règle WAF / un CDN au backend de l'Ingress. Consultez
[App_GKE](App_GKE.md).

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `enable_audit_logging` —
consultez [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Miniflux. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative (`miniflux`). |
| `database_user` | Utilisateur de la base de données applicative (`miniflux`). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (un bucket `data` par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'import (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, des valeurs `quota_memory_*` en entiers bruts. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Miniflux ne prend en charge que PostgreSQL ; tout autre moteur empêche le démarrage. |
| `application_database_name` / `application_database_user` | Défini une fois (`miniflux`) | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les flux et entrées. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans source de sauvegarde valide fait échouer le job d'import. |
| `ADMIN_PASSWORD` (généré automatiquement) | À récupérer dans Secret Manager | Élevé | C'est le seul identifiant de propriétaire créé au premier démarrage ; sans lui, vous ne pouvez pas vous connecter tant que vous ne l'avez pas réinitialisé dans la base de données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE ; le désactiver rompt la connexion à la base de données. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; garder 1 garantit que le collecteur de flux intégré continue d'actualiser les flux. |
| `enable_redis` | `false` | Moyen | Redis n'est pas utilisé ; l'activer gaspille des ressources sans rien changer. |
| `session_affinity` | `ClientIP` | Moyen | Sans affinité, les requêtes d'un client passent d'un pod à l'autre, ce qui perturbe la session d'interface. |
| `startup_probe.path` | `/healthcheck` | Élevé | Diriger la sonde vers une page authentifiée renvoie 401/403 et le pod ne devient jamais Ready. |
| `enable_iap` | désactivé sauf si l'interface doit être protégée | Moyen | IAP place l'interface/API derrière une connexion Google, ce qui bloque les clients API Fever/Reader qui utilisent des jetons. |
| `BASE_URL` (env) | URL du LoadBalancer externe / du domaine | Moyen | Une URL de base obsolète ou erronée produit des liens absolus et des URL d'images de proxy de flux cassés. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Miniflux, partagée
avec la variante Cloud Run, est décrite dans **[Miniflux_Common](Miniflux_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Miniflux sur GKE Autopilot](../labs/Miniflux_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Miniflux sur Google Cloud Run](Miniflux_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Miniflux Common — Configuration applicative partagée](Miniflux_Common.md) — la configuration partagée par les deux cibles de déploiement.
