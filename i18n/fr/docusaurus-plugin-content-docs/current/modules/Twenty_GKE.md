---
title: "Twenty CRM sur GKE Autopilot"
description: "Référence de configuration pour déployer Twenty CRM sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Twenty_GKE.md @ 3055034 sha256:4c9255c9ff04 -->

# Twenty CRM sur GKE Autopilot {#twenty-crm-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Twenty_GKE.png" alt="Twenty CRM sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Twenty est un CRM open source qui compte plus de 25 000 étoiles sur GitHub, conçu
comme une alternative moderne et adaptée aux développeurs à Salesforce et HubSpot.
Ce module déploie Twenty sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Twenty et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Twenty s'exécute en tant que charge de travail Node.js. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 1 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Twenty ne prend pas en charge MySQL |
| Stockage d'objets | Cloud Storage | Facultatif ; un bucket de stockage dédié lorsque `enable_gcs_storage = true` |
| Tâches d'arrière-plan | Redis (facultatif) | bull-mq lorsqu'il est activé ; pg-boss (adossé à PostgreSQL) par défaut, sans infrastructure supplémentaire |
| Secrets | Secret Manager | Secret applicatif généré automatiquement (`APP_SECRET` / `ENCRYPTION_KEY`) et mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé ;
  choisir MySQL ou `NONE` empêche le démarrage.
- **Redis est activé par défaut.** Twenty v0.4+ impose Redis pour le stockage des
  sessions et du cache — sans connexion Redis valide, Twenty ne démarre pas. Lorsque
  `redis_host` est laissé vide, l'IP de la VM NFS de la plateforme est utilisée
  (nécessite `enable_nfs = true` ou un `redis_host` explicite).
- **pg-boss est la file de tâches lorsque Redis est désactivé.** Il ne nécessite
  aucune infrastructure supplémentaire et utilise directement la base PostgreSQL.
- **Les pièces jointes sont stockées par défaut sur un stockage local éphémère.**
  Activez `enable_gcs_storage` pour un stockage d'objets persistant sur GCS.
- **Trois jobs d'initialisation s'exécutent avant le démarrage du serveur.**
  `db-init` crée la base de données et l'utilisateur ; `twenty-migrate` exécute les
  migrations de schéma TypeORM ; `twenty-verify` est une tâche de garde qui fait
  échouer l'apply si le schéma `core` ne contient aucune table, signalant
  bruyamment une migration concurrente ou échouée au lieu de livrer un pod en bonne
  santé pointant vers une base vide. Les migrations de base de données sont
  désactivées dans le conteneur principal (`DISABLE_DB_MIGRATIONS=true`) afin de
  garder des démarrages à froid rapides après le premier démarrage.
- **`SERVER_URL` et `FRONT_BASE_URL` doivent être définis manuellement.** Sans eux,
  les liens d'API, le CORS et les invitations par e-mail ne fonctionnent pas.
- Le **APP_SECRET / ENCRYPTION_KEY** est généré automatiquement et stocké dans
  Secret Manager ; vous ne le définissez jamais en clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Twenty {#a-gke-autopilot--the-twenty-workload}

Les pods Twenty sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods (Horizontal Pod
Autoscaling) dimensionne le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Twenty pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Twenty stocke toutes les données applicatives (contacts, pipelines, objets
personnalisés) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y
accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy**, par un socket
Unix, de sorte qu'aucune IP publique n'est exposée. Au premier déploiement, trois
Jobs d'initialisation s'exécutent à la suite : `db-init` crée la base de données et
l'utilisateur, `twenty-migrate` exécute les migrations de schéma à l'aide du point
d'entrée propre à Twenty, et `twenty-verify` protège contre un schéma vide en
faisant échouer l'apply si les migrations n'ont créé aucune table.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage (stockage de fichiers facultatif) {#c-cloud-storage-optional-file-storage}

Lorsque `enable_gcs_storage = true`, un bucket **Cloud Storage** dédié est
provisionné et Twenty est configuré pour utiliser l'API compatible S3 de GCS
(`STORAGE_TYPE=s3`). Sans cela, les pièces jointes sont stockées dans le système de
fichiers local éphémère du pod et sont perdues lors d'un redémarrage ou d'une mise
à jour progressive.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Remarque : lorsque `enable_gcs_storage = true`, vous devez fournir des clés HMAC
GCS via `secret_environment_variables` (`STORAGE_S3_ACCESS_KEY_ID` et
`STORAGE_S3_SECRET_ACCESS_KEY`). Générez-les dans la console sous Cloud Storage →
Settings → Interoperability.

### D. Redis (tâches d'arrière-plan) {#d-redis-background-jobs}

Redis assure le stockage des sessions et du cache de Twenty à partir de la v0.4 et,
lorsqu'il est activé, fait passer le traitement d'arrière-plan à **bull-mq**. Sans
Redis, Twenty utilise **pg-boss** (une file de tâches adossée à PostgreSQL) sans
infrastructure supplémentaire. Lorsque `redis_host` est vide et que
`enable_nfs = true`, l'IP de la VM NFS est utilisée comme hôte Redis.

Lorsque `enable_redis = true`, un Deployment worker dédié doit être configuré via
`additional_services` pour consommer la file bull-mq.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le secret applicatif de Twenty (`APP_SECRET` / `ENCRYPTION_KEY`) et le mot de passe
de la base de données sont stockés en tant que secrets Secret Manager et injectés
dans les pods à l'exécution via Workload Identity ; aucune valeur en clair
n'apparaît dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Twenty {#3-twenty-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Trois Jobs
  d'initialisation s'exécutent l'un après l'autre avant le démarrage de
  l'application :
  1. `db-init` — se connecte à Cloud SQL via le socket Unix de l'Auth Proxy, crée
     la base de données PostgreSQL et l'utilisateur, accorde les privilèges et
     installe l'extension `uuid-ossp`. Il est idempotent et peut être réexécuté
     sans risque.
  2. `twenty-migrate` — exécute le point d'entrée propre à Twenty
     (`twenty-entrypoint.sh`) avec `DISABLE_DB_MIGRATIONS=false`, ce qui lance les
     migrations de schéma TypeORM et enregistre les tâches cron d'arrière-plan.
     `max_retries = 3`, car l'instance Cloud SQL d'un nouveau tenant peut être encore
     en cours de stabilisation lorsque cette tâche démarre.
  3. `twenty-verify` — attend la fin de `twenty-migrate` et **fait échouer l'apply**
     si le schéma `core` ne contient aucune table. Elle existe parce qu'un échec de
     job d'initialisation NE fait PAS échouer à lui seul l'apply du module — sans
     cette garde, un `twenty-migrate` concurrent ou échoué pourrait laisser en
     silence l'application tourner sur une base de données VIDE (chaque requête
     backend échoue alors avec `relation "core.keyValuePair" does not
     exist"`, et l'interface affiche « Unable to Reach Back-end »). C'est aussi l'un
     des deux modules (avec `CalDiy_GKE`) qui ont mis en évidence un correctif
     d'ordonnancement `depends_on_jobs` à 3 niveaux dans `App_GKE` — une tâche
     dépendant d'une autre tâche elle-même dépendante (et pas seulement d'une tâche
     de base comme `db-init`) pouvait auparavant démarrer en concurrence et se
     terminer avant son prérequis.
  Inspectez-les après le déploiement :
  ```bash
  kubectl get jobs -n "$NAMESPACE" --sort-by=.metadata.creationTimestamp
  kubectl logs -n "$NAMESPACE" job/db-init
  kubectl logs -n "$NAMESPACE" job/twenty-migrate
  kubectl logs -n "$NAMESPACE" job/twenty-verify
  ```
- **Migrations désactivées au démarrage normal.** Le conteneur principal s'exécute
  avec `DISABLE_DB_MIGRATIONS=true`, de sorte que les migrations ne s'exécutent que
  via la tâche `twenty-migrate`. Cela réduit le temps de démarrage à froid de
  plusieurs minutes à quelques secondes lors des démarrages suivants.
- **Tâches d'arrière-plan.** Lorsque Redis est désactivé (mode pg-boss), les tâches
  d'arrière-plan — envoi d'e-mails, livraison de webhooks, synchronisation des
  données — sont traitées par le service Twenty principal. Lorsque Redis est activé
  (mode bull-mq), un Deployment worker distinct doit être déployé via
  `additional_services`, pointant vers la même image avec la commande worker.
  Vérifiez le traitement des tâches :
  ```bash
  kubectl get pods -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<worker-service-name>
  ```
- **Chemin de santé.** La sonde de démarrage interroge `/healthz` avec un délai
  initial de 120 secondes et jusqu'à 40 échecs (10 minutes au total) afin de laisser
  le temps aux migrations du premier démarrage. La sonde de vivacité interroge
  `/healthz` avec un délai initial de 30 secondes.
- **`SERVER_URL` est obligatoire.** Sans lui, Twenty génère des liens d'API
  incorrects, des erreurs CORS se produisent sur tous les appels d'API et les
  invitations par e-mail échouent. Définissez-le via `environment_variables` :
  ```bash
  environment_variables = {
    SERVER_URL     = "https://crm.example.com"
    FRONT_BASE_URL = "https://crm.example.com"
  }
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Twenty ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `twenty` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Twenty CRM` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image Twenty. **Épinglez une version précise en production** (p. ex. `0.50.0`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | `custom` (Cloud Build) ou `prebuilt` (URI d'image existante). |
| `container_image` | `""` | URI d'image de remplacement. Laissez vide pour que Cloud Build la gère. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Limites CPU/mémoire du pod et requêtes facultatives. Passez à `2Gi` en production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Gardez ≥ 1 pour éviter les démarrages à froid sur les charges de travail de webhooks/tâches. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `3000` | Twenty écoute sur le port 3000. Ne le modifiez pas, sauf si vous utilisez une image personnalisée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_image_mirroring` | `true` | Copie miroir de l'image Twenty dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres en clair. **Définissez ici `SERVER_URL` et `FRONT_BASE_URL`.** |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. À utiliser pour `STORAGE_S3_ACCESS_KEY_ID` et `STORAGE_S3_SECRET_ACCESS_KEY` lorsque le stockage GCS est activé. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage des pods. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | `None` (round-robin) ou `ClientIP` (sessions persistantes). Twenty utilise des JWT (sans état) — les sessions persistantes ne sont pas nécessaires. |
| `gke_cluster_name` | `""` | Cluster cible. Découvert automatiquement s'il est vide. |
| `prereq_gke_subnet_cidr` | `10.201.0.0/24` | CIDR du sous-réseau GKE intégré. Doit être unique pour chaque déploiement partageant le même VPC. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Généré automatiquement s'il est vide. |
| `network_tags` | `[]` | Tags de nœud/pod pour le ciblage des règles de pare-feu. |
| `additional_services` | `[]` | Deployments Kubernetes supplémentaires. Requis pour un worker bull-mq dédié lorsque `enable_redis = true`. |

### Groupe 7 — Interruption des pods et topologie {#group-7--pod-disruption--topology}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Protège la disponibilité pendant les mises à niveau des nœuds. À activer lorsque `max_instance_count > 1`. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin d'une marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. Recommandé en production. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent la planification. |

### Groupe 11 — Cloud Storage et Artifact Registry {#group-11--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisionne un bucket GCS pour un stockage de fichiers persistant via l'API compatible S3. |
| `create_cloud_storage` | `true` | Provisionne les entrées supplémentaires de `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires, en plus du bucket de stockage provisionné automatiquement. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Volume NFS (Filestore). Non requis pour Twenty ; activez-le uniquement si l'IP NFS sert d'hôte Redis. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les tâches intégrées `db-init`, `twenty-migrate` et `twenty-verify`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes récurrents supplémentaires. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/healthz`, délai de 120 s, 40 échecs | Interroge `/healthz` ; laisse jusqu'à ~10 minutes pour les migrations du premier démarrage. |
| `health_check_config` | HTTP `/healthz`, délai de 30 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/healthz` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 15 — Backend de base de données {#group-15--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne le modifiez pas. Options : `POSTGRES_15`, `POSTGRES_14`, `POSTGRES_13`. |
| `application_database_name` | `twenty` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `twenty` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `false` | Installe des extensions PostgreSQL supplémentaires pendant `db-init`. |
| `postgres_extensions` | `[]` | Liste des extensions à installer (p. ex. `['pgvector', 'pg_trgm']`). |

### Groupe 16 — Charge de travail avec état (PVC) {#group-16--stateful-workload-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Crée un PVC et sélectionne automatiquement StatefulSet. Définir `workload_type = "Deployment"` en parallèle échoue au moment du plan. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du conteneur où le PVC est monté. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de rétention ; passez à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. Doivent correspondre à `SERVER_URL`. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Twenty. Utile pour un accès interne au CRM. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis. Requis pour Twenty v0.4+ ; le désactiver impose pg-boss. |
| `redis_host` | `""` | Point de terminaison Redis. S'il est vide, l'IP de la VM NFS est utilisée (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite un `organization_id` explicite). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Twenty. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SERVER_URL` / `FRONT_BASE_URL` (dans `environment_variables`) | URL publique du déploiement | Critical | Les liens d'API sont incorrects, des erreurs CORS bloquent toutes les requêtes, les invitations par e-mail échouent. À définir avant la première utilisation. |
| `database_type` | `POSTGRES_15` | Critical | Twenty exige PostgreSQL ; MySQL ou `NONE` font échouer les migrations de schéma et le démarrage. |
| `application_database_name` / `_user` | défini une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit les données. |
| `enable_cloudsql_volume` | `true` | Critical | Twenty se connecte via le socket Unix de l'Auth Proxy ; le désactiver supprime le socket et coupe toutes les connexions à la base. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import ; le réactiver sur un déploiement en service écrase les données. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Les entiers nus sont des octets et bloquent toute planification. |
| `APP_SECRET` / `ENCRYPTION_KEY` (générés automatiquement) | ne pas faire de rotation manuelle | Critical | La rotation du secret invalide toutes les sessions JWT actives et déconnecte immédiatement tous les utilisateurs. |
| `enable_redis` | `true` (requis en v0.4+) | High | Sans Redis, Twenty v0.4+ ne démarre pas ; le stockage des sessions et du cache est imposé sur Redis. |
| `redis_host` | hôte explicite ou `enable_nfs = true` | High | Lorsque `enable_redis = true` et que `redis_host` est vide sans VM NFS, l'URL Redis est vide et Twenty ne parvient pas à se connecter. |
| `additional_services` (worker) | configuré lors de l'utilisation de Redis | High | Lorsque `enable_redis = true`, bull-mq est actif mais aucun worker ne traite la file ; les tâches d'arrière-plan (e-mail, webhooks) ne s'exécutent jamais. |
| `enable_gcs_storage` | `true` en production | High | Sans stockage GCS, les pièces jointes sont stockées dans le stockage local éphémère du pod et perdues au redémarrage. |
| `STORAGE_S3_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | via `secret_environment_variables` | High | Lorsque le stockage GCS est activé, les clés HMAC ne sont pas générées automatiquement ; toutes les opérations sur les fichiers échouent sans elles. |
| `container_resources.memory_limit` | `2Gi` en production | High | En dessous de 1 GiB, le processus Node.js est tué pour OOM sous charge. |
| `application_version` | version épinglée (p. ex. `0.50.0`) | High | `latest` se résout en une image différente à chaque exécution de Cloud Build, ce qui rend les retours arrière imprévisibles. |
| `prereq_gke_subnet_cidr` | unique par déploiement | High | Des CIDR qui chevauchent un sous-réseau existant font échouer le provisionnement du pool de nœuds GKE. |
| `min_instance_count` | `1` | Medium | `0` autorise la mise à l'échelle à zéro ; les démarrages à froid de Twenty prennent 30–60 secondes et peuvent faire manquer des webhooks entrants. |
| `enable_iap` / `enable_cloud_armor` | à activer pour les déploiements non publics | Medium | Sinon, l'interface du CRM est accessible publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de rétention liées à la conformité. |
| `pdb_min_available` vs `min_instance_count` | laisser une marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (un pod unique ne peut pas être évincé). |
| `organization_id` | défini explicitement pour VPC-SC | Medium | Sans lui, le périmètre VPC-SC n'est pas activé — `enable_vpc_sc = true` n'a aucun effet. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et copie miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Twenty, partagée
avec la variante Cloud Run, est décrite dans **[Twenty_Common](Twenty_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Twenty sur GKE Autopilot](../labs/Twenty_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Twenty CRM sur Google Cloud Run](Twenty_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Twenty Common — Configuration applicative partagée](Twenty_Common.md) — la configuration partagée par les deux cibles de déploiement.
