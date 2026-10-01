---
title: "Activepieces sur GKE Autopilot"
description: "Référence de configuration pour déployer Activepieces sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Activepieces_GKE.md @ 3055034 sha256:a3f3054e1aa2 -->

# Activepieces sur GKE Autopilot {#activepieces-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Activepieces_GKE.png" alt="Activepieces sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Activepieces est une plateforme open source d'automatisation de workflows sans
code, sous licence Apache 2.0, permettant de connecter applications, API et
sources de données. Ce module déploie Activepieces sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Activepieces et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Activepieces s'exécute comme une charge de travail web Node.js. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Activepieces ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Cache et file d'attente | Redis (facultatif) | Requis pour la mise à l'échelle horizontale ; le mode de file d'attente en mémoire est la valeur par défaut |
| Secrets | Secret Manager | `AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par
  la couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Le mode de file d'attente en mémoire est la valeur par défaut.**
  `AP_QUEUE_MODE = MEMORY` signifie que toutes les tâches de workflow s'exécutent
  dans le processus. Cela fonctionne pour un seul réplica, mais dépasser un pod
  nécessite Redis (`enable_redis = true`).
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont générés automatiquement** et
  stockés dans Secret Manager. Ces clés ne doivent jamais faire l'objet d'une
  rotation après le premier démarrage sans fenêtre de maintenance — la rotation de
  `AP_ENCRYPTION_KEY` corrompt tous les identifiants de connexion stockés, et celle
  de `AP_JWT_SECRET` invalide toutes les sessions utilisateur actives.
- **L'affinité de session est `ClientIP` par défaut.** Activepieces utilise des
  connexions WebSocket persistantes pour les mises à jour des flux en temps réel ;
  les requêtes d'un même client doivent atteindre le même pod.
- **NFS est désactivé par défaut.** Contrairement aux applications centrées sur les
  fichiers, Activepieces stocke tout l'état des workflows dans PostgreSQL. N'activez
  NFS que si vous hébergez Redis sur la VM du serveur NFS.
- **L'extension `pgvector` est installée automatiquement** lors de la tâche de
  configuration de la base de données au premier déploiement, ce qui active les
  pièces de workflow alimentées par l'IA.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise à
  l'échelle à zéro) afin que les points de terminaison de webhooks restent toujours
  joignables.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Activepieces {#a-gke-autopilot--the-activepieces-workload}

Les pods Activepieces sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Activepieces pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Activepieces stocke toutes les données applicatives (flux, connexions, historique
d'exécution, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Les
pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur un
socket Unix ; aucune IP publique n'est exposée. Au premier déploiement, une Job
d'initialisation crée la base de données et l'utilisateur de l'application et
installe l'extension `pgvector`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour le
stockage de fichiers d'Activepieces. Le compte de service de la charge de travail
reçoit l'accès. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (mode file d'attente) {#d-redis-queue-mode}

Redis est **désactivé par défaut** (`AP_QUEUE_MODE = MEMORY`). Lorsque
`enable_redis = true` est défini, le backend de file d'attente passe à
`AP_QUEUE_MODE = REDIS`, ce qui est requis avant de dépasser un réplica. Lorsque
`redis_host` est laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur
NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm queue mode injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep AP_QUEUE_MODE
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `AP_ENCRYPTION_KEY` (utilisé pour chiffrer tous les identifiants de
connexion stockés) et `AP_JWT_SECRET` (utilisé pour signer les jetons de session
utilisateur). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing. Un domaine personnalisé avec certificat géré par Google peut être activé,
et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Activepieces {#3-activepieces-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une Job
  d'initialisation exécute `db-init.sh` à l'aide de `postgres:15-alpine`. Elle se
  connecte via le Cloud SQL Auth Proxy et crée de façon idempotente la base de
  données et l'utilisateur de l'application, accorde les privilèges et installe
  l'extension `pgvector` pour les pièces de flux alimentées par l'IA. La tâche peut
  être relancée sans risque.
- **Migrations de la base de données au démarrage.** Activepieces applique
  automatiquement ses propres migrations de schéma à chaque démarrage ; la mise à
  niveau de la version de l'application applique donc les changements de schéma
  sans étape de migration distincte.
- **`AP_ENCRYPTION_KEY` et `AP_JWT_SECRET` sont immuables après le premier
  démarrage.** Ces clés sont générées une seule fois et écrites dans Secret Manager.
  Modifier `AP_ENCRYPTION_KEY` corrompt définitivement tous les identifiants de
  connexion stockés. Modifier `AP_JWT_SECRET` invalide toutes les sessions
  utilisateur actives. N'effectuez de rotation que pendant une fenêtre de
  maintenance planifiée.
- **Les points de terminaison de webhooks nécessitent une IP externe.** La valeur
  par défaut `service_type = LoadBalancer` expose une IP externe pour les appels de
  webhooks entrants. Définissez `AP_FRONTEND_URL` et `AP_WEBHOOK_URL_PREFIX` sur
  l'URL externe une fois l'IP du LoadBalancer attribuée :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"activepieces","env":[
      {"name":"AP_FRONTEND_URL","value":"https://activepieces.example.com"},
      {"name":"AP_WEBHOOK_URL_PREFIX","value":"https://activepieces.example.com"}
    ]}]}}}}'
  ```
  Vous pouvez aussi définir `environment_variables` dans la configuration du module
  avant le déploiement.
- **L'inscription est ouverte par défaut.** `AP_SIGN_UP_ENABLED = "true"` est
  injecté automatiquement. Après avoir créé le compte administrateur initial,
  désactivez l'inscription en ajoutant `AP_SIGN_UP_ENABLED = "false"` à
  `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/`
  par défaut. Le point de terminaison `/api/v1/flags` ne répond que lorsque le
  serveur est entièrement initialisé et connecté à PostgreSQL — envisagez de définir
  `path = "/api/v1/flags"` pour un signal de santé plus précis.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Activepieces ou notables pour lui
sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `activepieces` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Étiquette de suivi du déploiement pour l'image construite. **Ne fige pas la version amont** : le Dockerfile d'`Activepieces_Common` construit toujours `FROM activepieces/activepieces:latest` sans ARG de version ; modifier cette valeur ne fait donc que réétiqueter le tag poussé dans Artifact Registry. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; gardez 1 pour que les points de terminaison de webhooks restent toujours joignables. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. **N'augmentez que lorsque `enable_redis = true`.** |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Duplique l'image Activepieces dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs `AP_*` principales sont définies automatiquement — ne définissez pas `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET` ni `AP_POSTGRES_*` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `Deployment` | `Deployment` (sans état, par défaut) ou `StatefulSet` (avec des PVC par pod). |
| `session_affinity` | `ClientIP` | Routage persistant requis pour les connexions WebSocket et les sessions de l'interface. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Active les modèles de PVC. Déconseillé — Activepieces stocke tout son état dans PostgreSQL. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_headless_service` | `true` | Crée un Service headless pour des noms DNS de pods stables. |
| `stateful_pod_management_policy` | `OrderedReady` | Ordre de création des pods : `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `RollingUpdate` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms de l'application. **Déclarée mais non transmise** dans `main.tf` — sans effet sur le déploiement de ce module. |
| `quota_cpu_requests` | `""` | Total des requêtes CPU autorisées pour l'ensemble des pods de l'espace de noms. Non transmise — sans effet. |
| `quota_cpu_limits` | `""` | Total des limites CPU autorisées pour l'ensemble des pods de l'espace de noms. Non transmise — sans effet. |
| `quota_memory_requests` | `""` | Total des requêtes mémoire autorisées ; nécessite un suffixe binaire (p. ex. `4Gi`, `8192Mi`) par convention. Non transmise — sans effet. |
| `quota_memory_limits` | `""` | Total des limites mémoire autorisées ; nécessite un suffixe binaire. Non transmise — sans effet. |
| `quota_max_pods` | `""` | Nombre maximal de pods autorisés dans l'espace de noms. Non transmise — sans effet. |
| `quota_max_services` | `""` | Nombre maximal de Services Kubernetes autorisés dans l'espace de noms. Non transmise — sans effet. |
| `quota_max_pvcs` | `""` | Nombre maximal de PersistentVolumeClaims autorisés. Non transmise — sans effet. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 60s | Sonde de démarrage. Envisagez de définir `path = "/api/v1/flags"` pour un signal précis au premier démarrage. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | TCP 240s | Sonde d'infrastructure au niveau d'App_GKE. |
| `health_check_config` | HTTP `/` | Sonde de vivacité au niveau d'App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés d'Activepieces. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. Ne l'activez que si vous hébergez Redis sur la VM du serveur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires en plus du bucket de données provisionné automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours au-delà duquel les images peuvent être supprimées. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fait passer `AP_QUEUE_MODE` de `MEMORY` à `REDIS`. Requis lorsque `max_instance_count > 1`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `activepieces_db` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `ap_user` | Utilisateur de base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** activer IAP exige une authentification par identité Google pour
> **toutes** les requêtes entrantes, y compris les rappels de webhooks provenant de
> services externes. N'activez IAP que lorsque les webhooks publics ne sont pas
> nécessaires.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Activepieces. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Activepieces. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la supervision et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et (facultative) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AP_ENCRYPTION_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation corrompt définitivement tous les identifiants de connexion stockés — ils ne peuvent plus être déchiffrés. |
| `AP_JWT_SECRET` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critical | Sa rotation invalide toutes les sessions utilisateur actives et oblige tout le monde à se reconnecter immédiatement. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `AP_FRONTEND_URL` / `AP_WEBHOOK_URL_PREFIX` | URL du LoadBalancer externe | Critical | Une URL incorrecte casse toutes les intégrations de webhooks et les rappels OAuth. |
| `max_instance_count` | `1` sauf si Redis est activé | High | Dépasser 1 en mode file d'attente en mémoire répartit la file des tâches entre les pods, ce qui provoque des exécutions en double et des exécutions perdues. |
| `enable_redis` | `true` avant de mettre à l'échelle | High | Sans Redis, chaque pod gère sa propre file d'attente en mémoire — exécution incohérente au-delà d'un réplica. |
| `redis_host` | `""` (NFS) ou explicite | High | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, la chaîne de connexion Redis est vide et l'application ne démarre pas. |
| `memory_limit` | `2Gi` | High | Des valeurs inférieures à 1 GiB provoquent des arrêts OOM lors d'exécutions de flux concurrentes. |
| `session_affinity` | `ClientIP` | High | Sans persistance de session, les reconnexions WebSocket sont routées vers des pods différents, ce qui perturbe les mises à jour des flux en temps réel dans l'interface. |
| `min_instance_count` | `1` | High | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. Garder 1 garantit que les webhooks sont toujours disponibles. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `AP_SIGN_UP_ENABLED` (injecté automatiquement à `"true"`) | Désactiver après le premier administrateur | High | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | High | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhooks externes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés comme des octets et bloquent l'ordonnancement de tous les pods de l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Medium | La désactivation permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Activepieces partagée avec la variante Cloud Run est décrite dans
**[Activepieces_Common](Activepieces_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Activepieces sur GKE Autopilot](../labs/Activepieces_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Activepieces sur Google Cloud Run](Activepieces_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Activepieces Common — Configuration applicative partagée](Activepieces_Common.md) — la configuration partagée par les deux cibles de déploiement.
